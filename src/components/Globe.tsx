"use client";
// The 3D planet you paint on (track A). Renders the sim's tiles as one low-poly mesh,
// the people as tiny instanced figures and the villages as clusters of houses.
// Left-drag paints with the current power; right-drag (or the Hand tool) rotates.
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { D, PlanetSim, T } from "@/sim/planet";
import { tileRand } from "@/sim/noise";
import type { GodPower } from "@/types/world";

export type Tool = GodPower | "hand";

const COLORS: Record<T, string> = {
  [T.Deep]: "#1d4e89",
  [T.Shallow]: "#2f7fc1",
  [T.Sand]: "#e3cf8f",
  [T.Grass]: "#6fbf5a",
  [T.Forest]: "#2f7d3f",
  [T.Desert]: "#d8a95c",
  [T.Rock]: "#8a8178",
  [T.Snow]: "#eef3f7",
};
const FARM = new THREE.Color("#c9cf5b");
// Deposits are speckled onto some of their tiles so the player can spot them.
const DEPOSIT: Record<D, THREE.Color | null> = { [D.None]: null, [D.Metal]: new THREE.Color("#5b6f8f"), [D.Gold]: new THREE.Color("#ffd447"), [D.Herbs]: new THREE.Color("#b066d6") };
const WHITE = new THREE.Color("#ffffff");
const SCORCH = new THREE.Color("#3a2f2a");
const FIRE = [new THREE.Color("#ff6a1a"), new THREE.Color("#ffc23a")];
const LAND_HEIGHT = 0.07; // how far mountains stand out from the sea

// Painting with a held mouse repeats at most this often.
const PAINT_EVERY_MS = 70;
const ONE_SHOT: Tool[] = ["spawn", "meteor"];

function PlanetMesh({ sim, tool, onPaint, onHover }: { sim: PlanetSim; tool: Tool; onPaint: (power: GodPower, face: number) => void; onHover?: (face: number | null, x: number, y: number) => void }) {
  const geometry = useMemo(() => {
    const g = sim.geometry.clone();
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.getAttribute("position").count * 3), 3));
    return g;
  }, [sim]);
  const base = sim.geometry.getAttribute("position");
  const shown = useRef(-1);
  const flicker = useRef(0);
  const painting = useRef(false);
  const lastPaint = useRef(0);

  // Rebuild colours and heights whenever the terrain changes (and to animate fire).
  useFrame((_, dt) => {
    flicker.current += dt;
    const fireTick = sim.burning.size > 0 && flicker.current > 0.15;
    if (shown.current === sim.version && !fireTick) return;
    shown.current = sim.version;
    flicker.current = 0;

    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    // Corner height = highest land among the tiles that share it, so land has no cracks.
    const corner = new Float32Array(sim.cornerCount);
    for (let i = 0; i < pos.count; i++) {
      const h = Math.max(0, sim.elevation[Math.floor(i / 3)]);
      const c = sim.vertexId[i];
      if (h > corner[c]) corner[c] = h;
    }
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    const nationCols = sim.nations.map((n) => new THREE.Color(n.color));
    for (let f = 0; f < sim.n; f++) {
      const t = sim.terrain[f] as T;
      if (sim.fire[f] > 0) c.copy(FIRE[Math.random() < 0.5 ? 0 : 1]);
      else {
        c.set(COLORS[t]);
        if (sim.farm[f] && (t === T.Grass || t === T.Forest || t === T.Desert || t === T.Sand)) c.lerp(FARM, 0.55);
        const dep = DEPOSIT[sim.deposit[f] as D];
        if (dep && tileRand(f, 3) < 0.45) c.lerp(dep, 0.5);
        if (sim.scorch[f] > 0) c.lerp(SCORCH, Math.min(0.8, sim.scorch[f] / 20));
        // Nation territory: a light wash of its colour, with a strong line along the border.
        const o = sim.owner[f];
        if (o >= 0) {
          let edge = false;
          for (let k = 0; k < 3; k++) if (sim.owner[sim.neighbours[f * 3 + k]] !== o) edge = true;
          c.lerp(nationCols[o], edge ? 0.7 : 0.18);
        }
        // Small per-tile variation gives a hand-painted, pixel-art feel.
        c.offsetHSL(0, 0, (tileRand(f) - 0.5) * 0.06);
      }
      for (let k = 0; k < 3; k++) {
        const i = f * 3 + k;
        col.setXYZ(i, c.r, c.g, c.b);
        v.fromBufferAttribute(base, i).normalize().multiplyScalar(1 + corner[sim.vertexId[i]] * LAND_HEIGHT);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  });

  const paint = (e: ThreeEvent<PointerEvent>, first: boolean) => {
    if (tool === "hand" || e.faceIndex == null) return;
    if (!first && (ONE_SHOT.includes(tool) || performance.now() - lastPaint.current < PAINT_EVERY_MS)) return;
    lastPaint.current = performance.now();
    onPaint(tool, e.faceIndex);
  };

  useEffect(() => {
    const stop = () => (painting.current = false);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  return (
    <mesh
      geometry={geometry}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        painting.current = true;
        paint(e, true);
      }}
      onPointerMove={(e) => {
        if (painting.current) paint(e, false);
        onHover?.(e.faceIndex ?? null, e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerOut={() => onHover?.(null, 0, 0)}
    >
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  );
}

// A soft glow of water just above the sea, so oceans read as water, not blue land.
function Atmosphere() {
  return (
    <mesh scale={1.06}>
      <sphereGeometry args={[1, 48, 48]} />
      <meshBasicMaterial color="#6fb6ff" transparent opacity={0.07} side={THREE.BackSide} />
    </mesh>
  );
}

const MAX_FIGURES = 1500;
const MAX_HOUSES = 1200;

// Where on the surface a tile is, lifted to its land height.
function surface(sim: PlanetSim, f: number, out: THREE.Vector3) {
  out.set(sim.centroids[f * 3], sim.centroids[f * 3 + 1], sim.centroids[f * 3 + 2]);
  return out.multiplyScalar(1 + Math.max(0, sim.elevation[f]) * LAND_HEIGHT);
}

function People({ sim }: { sim: PlanetSim }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const a = useMemo(() => new THREE.Vector3(), []);
  const b = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const cols = useMemo(() => sim.nations.map((n) => new THREE.Color(n.color).lerp(WHITE, 0.25)), [sim]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const people = sim.people;
    const count = Math.min(people.length, MAX_FIGURES);
    for (let i = 0; i < count; i++) {
      const p = people[i];
      // Walk smoothly from one tile to the next, standing upright on the sphere.
      surface(sim, p.from, a);
      surface(sim, p.face, b);
      a.lerp(b, Math.min(1, p.t));
      const n = b.copy(a).normalize();
      q.setFromUnitVectors(up, n);
      a.addScaledVector(n, 0.006);
      s.setScalar(p.age < 14 ? 0.6 : 1);
      m.compose(a, q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, cols[p.nation] ?? WHITE);
    }
    mesh.count = count;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_FIGURES]} frustumCulled={false}>
      <capsuleGeometry args={[0.0035, 0.007, 2, 6]} />
      <meshStandardMaterial color="#ffffff" emissive="#3a2a20" emissiveIntensity={0.4} />
    </instancedMesh>
  );
}

function Houses({ sim }: { sim: PlanetSim }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const centre = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const t1 = useMemo(() => new THREE.Vector3(), []);
  const t2 = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const cols = useMemo(() => sim.nations.map((n) => new THREE.Color(n.color).multiplyScalar(0.8)), [sim]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    let i = 0;
    for (const v of sim.villages) {
      surface(sim, v.face, centre);
      const n = p.copy(centre).normalize();
      // Two directions along the ground, to spread houses around the village centre.
      t1.set(0, 1, 0).cross(n);
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
      t1.normalize();
      t2.copy(n).cross(t1);
      q.setFromUnitVectors(up, n);
      for (let k = 0; k < v.houses && i < MAX_HOUSES; k++, i++) {
        // A golden-angle spiral packs houses evenly.
        const r = 0.012 * Math.sqrt(k);
        const ang = k * 2.39996 + v.id;
        p.copy(centre).addScaledVector(t1, Math.cos(ang) * r).addScaledVector(t2, Math.sin(ang) * r);
        p.addScaledVector(n, 0.004);
        s.setScalar(k === 0 ? 1.6 : 1); // the first house is the shrine
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, k === 0 ? WHITE : (cols[v.nation] ?? WHITE));
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, MAX_HOUSES]} frustumCulled={false}>
      <boxGeometry args={[0.01, 0.011, 0.01]} />
      <meshStandardMaterial color="#ffffff" roughness={0.8} />
    </instancedMesh>
  );
}

// Start with the camera looking at where the people are.
function FaceStart({ sim }: { sim: PlanetSim }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const f = sim.people[0]?.face ?? 0;
    camera.position.set(sim.centroids[f * 3], sim.centroids[f * 3 + 1] + 0.35, sim.centroids[f * 3 + 2]).setLength(3.1);
    camera.lookAt(0, 0, 0);
  }, [sim, camera]);
  return null;
}

// Runs the simulation in step with rendering, at `speed` years per second.
function Clock({ sim, speed }: { sim: PlanetSim; speed: number }) {
  useFrame((_, dt) => {
    if (speed > 0) sim.step(Math.min(dt, 0.1) * speed);
  });
  return null;
}

export default function Globe({ sim, tool, speed, onPaint, onHover }: { sim: PlanetSim; tool: Tool; speed: number; onPaint: (power: GodPower, face: number) => void; onHover?: (face: number | null, x: number, y: number) => void }) {
  return (
    <Canvas camera={{ position: [0, 0.6, 2.6], fov: 45 }} onContextMenu={(e) => e.preventDefault()} style={{ cursor: tool === "hand" ? "grab" : "crosshair" }}>
      <color attach="background" args={["#04050c"]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 2, 3]} intensity={1.8} />
      <Stars radius={60} depth={30} count={3000} factor={3} fade />
      <Clock sim={sim} speed={speed} />
      <FaceStart sim={sim} />
      <PlanetMesh sim={sim} tool={tool} onPaint={onPaint} onHover={onHover} />
      <People sim={sim} />
      <Houses sim={sim} />
      <Atmosphere />
      <OrbitControls
        enablePan={false}
        minDistance={1.25}
        maxDistance={5}
        rotateSpeed={0.5}
        // Left button paints unless the Hand tool is picked; right button always rotates.
        mouseButtons={{ LEFT: tool === "hand" ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE), MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      />
    </Canvas>
  );
}

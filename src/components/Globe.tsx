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
const WALL = new THREE.Color("#efe3cf");
const SHRINE = new THREE.Color("#ffd447");
const SCORCH = new THREE.Color("#3a2f2a");
const FIRE = [new THREE.Color("#ff6a1a"), new THREE.Color("#ffc23a")];
const LAND_HEIGHT = 0.07; // how far mountains stand out from the sea
const SEA = 1.004; // radius of the water surface; land sits just above it, the sea floor below
// Height of a tile above the planet's core radius of 1.
const lift = (e: number) => (e > 0 ? SEA - 1 + 0.002 + e * LAND_HEIGHT : e * 0.03);

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
    const corner = new Float32Array(sim.cornerCount).fill(-1);
    for (let i = 0; i < pos.count; i++) {
      const h = lift(sim.elevation[Math.floor(i / 3)]);
      const c = sim.vertexId[i];
      if (h > corner[c]) corner[c] = h;
    }
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    const nationCols = sim.nations.map((n) => new THREE.Color(n.color));
    // 1. Each tile's own colour.
    const tile = new Float32Array(sim.n * 3);
    for (let f = 0; f < sim.n; f++) {
      const t = sim.terrain[f] as T;
      if (sim.fire[f] > 0) c.copy(FIRE[Math.random() < 0.5 ? 0 : 1]);
      else {
        c.set(COLORS[t]);
        if (sim.farm[f] && (t === T.Grass || t === T.Forest || t === T.Desert || t === T.Sand)) c.lerp(FARM, 0.55);
        const dep = DEPOSIT[sim.deposit[f] as D];
        if (dep && tileRand(f, 3) < 0.45) c.lerp(dep, 0.6);
        if (sim.scorch[f] > 0) c.lerp(SCORCH, Math.min(0.8, sim.scorch[f] / 20));
        // Nation territory: a light wash of its colour, stronger along the border.
        const o = sim.owner[f];
        if (o >= 0) {
          let edge = false;
          for (let k = 0; k < 3; k++) if (sim.owner[sim.neighbours[f * 3 + k]] !== o) edge = true;
          c.lerp(nationCols[o], edge ? 0.8 : 0.25);
        }
      }
      tile[f * 3] = c.r;
      tile[f * 3 + 1] = c.g;
      tile[f * 3 + 2] = c.b;
    }
    // 2. Positions, colours, and smooth normals shared by every tile at a corner (smooth hills, crisp colours).
    const normal = new Float32Array(sim.cornerCount * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(base, i).normalize().multiplyScalar(1 + corner[sim.vertexId[i]]);
      pos.setXYZ(i, v.x, v.y, v.z);
      const f = Math.floor(i / 3);
      col.setXYZ(i, tile[f * 3], tile[f * 3 + 1], tile[f * 3 + 2]); // crisp: one colour per tile
    }
    for (let f = 0; f < sim.n; f++) {
      a.fromBufferAttribute(pos, f * 3);
      b.fromBufferAttribute(pos, f * 3 + 1).sub(a);
      d.fromBufferAttribute(pos, f * 3 + 2).sub(a);
      b.cross(d);
      for (let k = 0; k < 3; k++) {
        const cc = sim.vertexId[f * 3 + k] * 3;
        normal[cc] += b.x;
        normal[cc + 1] += b.y;
        normal[cc + 2] += b.z;
      }
    }
    const nor = geometry.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const cc = sim.vertexId[i] * 3;
      v.set(normal[cc], normal[cc + 1], normal[cc + 2]).normalize();
      nor.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    nor.needsUpdate = true;
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
      <meshStandardMaterial vertexColors roughness={0.9} />
    </mesh>
  );
}

// A soft glow of water just above the sea, so oceans read as water, not blue land.
// A soft glow around the planet: brighter towards the edge (a fresnel rim).
function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color("#5fb0ff") } },
        vertexShader: `varying vec3 vN; varying vec3 vV;
          void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
          void main() { float rim = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(color, rim * 0.9); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  );
  return (
    <mesh scale={1.14} material={material}>
      <sphereGeometry args={[1, 64, 64]} />
    </mesh>
  );
}

// The sea: a glossy, see-through shell, so shallow water shows the sea floor beneath.
function Ocean() {
  return (
    <mesh scale={SEA}>
      <sphereGeometry args={[1, 96, 96]} />
      <meshPhysicalMaterial color="#2a7fd4" transparent opacity={0.62} roughness={0.12} metalness={0.05} clearcoat={1} clearcoatRoughness={0.1} depthWrite={false} />
    </mesh>
  );
}

// Puffy low-poly clouds drifting slowly around the planet.
const CLOUDS = 46;
function Clouds() {
  const group = useRef<THREE.Group>(null);
  const ref = useRef<THREE.InstancedMesh>(null);
  const PUFFS = 5;
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
    let i = 0;
    for (let c = 0; c < CLOUDS; c++) {
      dir.randomDirection();
      side.randomDirection().cross(dir).normalize();
      for (let k = 0; k < PUFFS; k++) {
        p.copy(dir).addScaledVector(side, (k - PUFFS / 2) * 0.018).normalize().multiplyScalar(1.13 + Math.random() * 0.01);
        const r = 0.012 + Math.random() * 0.014 * (1 - Math.abs(k - PUFFS / 2) / PUFFS);
        s.set(r, r * 0.7, r);
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());
        m.compose(p, q, s);
        mesh.setMatrixAt(i++, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.01;
  });
  return (
    <group ref={group}>
      <instancedMesh ref={ref} args={[undefined, undefined, CLOUDS * PUFFS]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#ffffff" flatShading transparent opacity={0.7} roughness={1} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

// A little low-poly tree on most forest tiles (pines on cold, high ground).
const MAX_TREES = 9000;
function Trees({ sim }: { sim: PlanetSim }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const shown = useRef(-1);
  const geometry = useMemo(() => {
    const g = new THREE.ConeGeometry(0.005, 0.016, 5);
    g.translate(0, 0.008, 0);
    return g;
  }, []);
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh || shown.current === sim.version) return;
    shown.current = sim.version;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let i = 0;
    for (let f = 0; f < sim.n && i < MAX_TREES; f++) {
      if (sim.terrain[f] !== T.Forest || sim.fire[f] > 0 || sim.farm[f] || tileRand(f, 7) < 0.25) continue;
      surface(sim, f, p);
      const n = p.clone().normalize();
      q.setFromUnitVectors(up, n);
      const size = 0.7 + tileRand(f, 9) * 0.6;
      s.set(size, size * (0.9 + tileRand(f, 11) * 0.5), size);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      c.setHSL(0.3 + tileRand(f, 13) * 0.06, 0.5, 0.18 + tileRand(f, 15) * 0.1);
      mesh.setColorAt(i, c);
      i++;
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, MAX_TREES]} frustumCulled={false}>
      <meshStandardMaterial flatShading roughness={0.9} />
    </instancedMesh>
  );
}

const MAX_FIGURES = 1500;
const MAX_HOUSES = 1200;

// Where on the surface a tile is, lifted to its land height.
function surface(sim: PlanetSim, f: number, out: THREE.Vector3) {
  out.set(sim.centroids[f * 3], sim.centroids[f * 3 + 1], sim.centroids[f * 3 + 2]);
  return out.multiplyScalar(1 + Math.max(SEA - 1, lift(sim.elevation[f])));
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
  const roofs = useRef<THREE.InstancedMesh>(null);
  const roof = useMemo(() => {
    const g = new THREE.ConeGeometry(0.0085, 0.008, 4);
    g.rotateY(Math.PI / 4);
    return g;
  }, []);
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
    const top = roofs.current;
    if (!mesh || !top) return;
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
        mesh.setColorAt(i, WALL);
        // The roof sits on top, in the nation's colour (the shrine's is gold).
        p.addScaledVector(n, 0.0095 * s.x);
        m.compose(p, q, s);
        top.setMatrixAt(i, m);
        top.setColorAt(i, k === 0 ? SHRINE : (cols[v.nation] ?? WHITE));
      }
    }
    for (const x of [mesh, top]) {
      x.count = i;
      x.instanceMatrix.needsUpdate = true;
      if (x.instanceColor) x.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={ref} args={[undefined, undefined, MAX_HOUSES]} frustumCulled={false}>
        <boxGeometry args={[0.009, 0.01, 0.009]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[roof, undefined, MAX_HOUSES]} frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" flatShading roughness={0.7} />
      </instancedMesh>
    </>
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

// Flies the camera to a tile when `focus` changes (clicking a nation in the HUD).
function FlyTo({ sim, focus }: { sim: PlanetSim; focus?: { face: number; key: number } | null }) {
  const camera = useThree((s) => s.camera);
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3; t: number } | null>(null);
  useEffect(() => {
    if (!focus) return;
    const f = focus.face;
    const dist = Math.min(camera.position.length(), 2.4);
    const to = new THREE.Vector3(sim.centroids[f * 3], sim.centroids[f * 3 + 1], sim.centroids[f * 3 + 2]).setLength(dist);
    anim.current = { from: camera.position.clone(), to, t: 0 };
  }, [focus, sim, camera]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (!a) return;
    a.t = Math.min(1, a.t + dt / 0.9);
    const k = a.t * a.t * (3 - 2 * a.t); // ease in and out
    // Swing around the globe (not through it), easing the distance too.
    const dir = a.from.clone().normalize().lerp(a.to.clone().normalize(), k).normalize();
    camera.position.copy(dir.multiplyScalar(a.from.length() + (a.to.length() - a.from.length()) * k));
    camera.lookAt(0, 0, 0);
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

// The sun follows the camera from above and to one side, so the side you look at is lit.
function Sun() {
  const ref = useRef<THREE.DirectionalLight>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const light = ref.current;
    if (!light) return;
    const right = new THREE.Vector3().crossVectors(camera.up, camera.position).normalize();
    light.position.copy(camera.position).addScaledVector(camera.up, 1.6).addScaledVector(right, -1.4);
  });
  return <directionalLight ref={ref} intensity={2.3} color="#fff1dc" />;
}

// Runs the simulation in step with rendering, at `speed` years per second.
function Clock({ sim, speed }: { sim: PlanetSim; speed: number }) {
  useFrame((_, dt) => {
    if (speed > 0) sim.step(Math.min(dt, 0.1) * speed);
  });
  return null;
}

export default function Globe({ sim, tool, speed, onPaint, onHover, focus }: { sim: PlanetSim; tool: Tool; speed: number; focus?: { face: number; key: number } | null; onPaint: (power: GodPower, face: number) => void; onHover?: (face: number | null, x: number, y: number) => void }) {
  return (
    <Canvas camera={{ position: [0, 0.6, 2.6], fov: 45 }} onContextMenu={(e) => e.preventDefault()} style={{ cursor: tool === "hand" ? "grab" : "crosshair" }}>
      <color attach="background" args={["#04050c"]} />
      <hemisphereLight args={["#cfe6ff", "#2a1e14", 0.7]} />
      <Sun />
      <directionalLight position={[-3, -1, -2]} intensity={0.25} color="#7aa7ff" />
      <Stars radius={60} depth={30} count={3000} factor={3} fade />
      <Clock sim={sim} speed={speed} />
      <FaceStart sim={sim} />
      <FlyTo sim={sim} focus={focus} />
      <PlanetMesh sim={sim} tool={tool} onPaint={onPaint} onHover={onHover} />
      <People sim={sim} />
      <Houses sim={sim} />
      <Trees sim={sim} />
      <Ocean />
      <Clouds />
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

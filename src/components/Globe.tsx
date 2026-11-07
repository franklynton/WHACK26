"use client";
// The 3D planet you paint on (track A). Renders the sim's tiles as one low-poly mesh,
// the people as tiny instanced figures and the villages as clusters of houses.
// Left-drag paints with the current power; right-drag (or the Hand tool) rotates.
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { D, isWater, PlanetSim, T } from "@/sim/planet";
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
const DEPOSIT: Record<D, THREE.Color | null> = { [D.None]: null, [D.Metal]: new THREE.Color("#5b6f8f"), [D.Gold]: new THREE.Color("#ffd447"), [D.Herbs]: new THREE.Color("#3fd6b0") };
const WHITE = new THREE.Color("#ffffff");
const WALL = new THREE.Color("#efe3cf");
const SHRINE = new THREE.Color("#ffd447");
const SCORCH = new THREE.Color("#3a2f2a");
const PARCHED = new THREE.Color("#e0b25c"); // sun-baked land after a drought
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
    const count = g.getAttribute("position").count;
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    // For curved borders (see SmoothBorders): the neighbours' colour and how much of each corner is "ours".
    g.setAttribute("other", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("share", new THREE.BufferAttribute(new Float32Array(count), 1));
    const bary = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) bary[i * 3 + (i % 3)] = 1;
    g.setAttribute("bary", new THREE.BufferAttribute(bary, 3));
    return g;
  }, [sim]);
  // Which tiles meet at each corner (compressed: tiles of corner c are cornerTiles[start[c]..start[c+1])).
  const corners = useMemo(() => {
    const start = new Int32Array(sim.cornerCount + 1);
    for (let i = 0; i < sim.n * 3; i++) start[sim.vertexId[i] + 1]++;
    for (let c = 0; c < sim.cornerCount; c++) start[c + 1] += start[c];
    const fill = start.slice(0, sim.cornerCount);
    const tiles = new Int32Array(sim.n * 3);
    for (let i = 0; i < sim.n * 3; i++) tiles[fill[sim.vertexId[i]]++] = Math.floor(i / 3);
    return { start, tiles };
  }, [sim]);
  const material = useMemo(() => smoothBordersMaterial(), []);
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
    // Corner height = average of the tiles that share it, so coasts slope smoothly into the sea (curved shorelines).
    const corner = new Float32Array(sim.cornerCount);
    const cornerN = new Float32Array(sim.cornerCount);
    for (let i = 0; i < pos.count; i++) {
      const c = sim.vertexId[i];
      corner[c] += lift(sim.elevation[Math.floor(i / 3)]);
      cornerN[c]++;
    }
    for (let c = 0; c < sim.cornerCount; c++) corner[c] /= cornerN[c];
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
        if (sim.parched[f] > 0) c.lerp(PARCHED, Math.min(0.75, sim.parched[f] / 25));
        // Nation territory: a light wash of its colour, stronger along the border.
        const o = sim.owner[f];
        if (o >= 0) {
          let edge = false;
          for (let k = 0; k < 3; k++) if (sim.owner[sim.neighbours[f * 3 + k]] !== o) edge = true;
          c.lerp(nationCols[o], edge ? 0.95 : 0.3);
        }
      }
      tile[f * 3] = c.r;
      tile[f * 3 + 1] = c.g;
      tile[f * 3 + 2] = c.b;
    }
    // 2. Positions, colours, and smooth normals shared by every tile at a corner (smooth hills, crisp colours).
    const normal = new Float32Array(sim.cornerCount * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    const other = geometry.getAttribute("other") as THREE.BufferAttribute;
    const share = geometry.getAttribute("share") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(base, i).normalize().multiplyScalar(1 + corner[sim.vertexId[i]]);
      pos.setXYZ(i, v.x, v.y, v.z);
      const f = Math.floor(i / 3);
      const r = tile[f * 3], g = tile[f * 3 + 1], bl = tile[f * 3 + 2];
      col.setXYZ(i, r, g, bl); // each tile keeps one crisp colour...
      // ...but at each corner, note what fraction of the tiles there look the same, and the average colour of the rest.
      const cid = sim.vertexId[i];
      let same = 0, n = 0, or = 0, og = 0, ob = 0;
      for (let j = corners.start[cid]; j < corners.start[cid + 1]; j++) {
        const t = corners.tiles[j];
        n++;
        if (tile[t * 3] === r && tile[t * 3 + 1] === g && tile[t * 3 + 2] === bl) same++;
        else {
          or += tile[t * 3];
          og += tile[t * 3 + 1];
          ob += tile[t * 3 + 2];
        }
      }
      const diff = n - same;
      share.setX(i, same / n);
      if (diff) other.setXYZ(i, or / diff, og / diff, ob / diff);
      else other.setXYZ(i, r, g, bl);
    }
    other.needsUpdate = true;
    share.needsUpdate = true;
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
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// Curved borders: instead of drawing every tile as a hard triangle, each fragment asks "is this point
// mostly ours?" using a smooth field built from the corners (how many tiles there share our colour) plus
// a bump at the tile's centre. Where the field drops below one half we show the neighbours' colour instead.
// Along an edge both tiles see the same corner values, so the curves meet up seamlessly.
function smoothBordersMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 other;\nattribute float share;\nattribute vec3 bary;\nvarying vec3 vOther;\nvarying float vShare;\nvarying vec3 vBary;")
      .replace("#include <color_vertex>", "#include <color_vertex>\nvOther = other;\nvShare = share;\nvBary = bary;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOther;\nvarying float vShare;\nvarying vec3 vBary;")
      .replace(
        "#include <color_fragment>",
        `float centre = 27.0 * vBary.x * vBary.y * vBary.z; // 1 in the middle of the tile, 0 on its edges
        float field = vShare + centre * (1.0 - vShare) * 0.4; // lone tiles stay as small round dots
        float aa = fwidth(field) * 0.75;
        diffuseColor.rgb *= mix(vOther, vColor.rgb, smoothstep(0.5 - aa, 0.5 + aa, field));`,
      );
  };
  return m;
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

// Fair-weather clouds: the same puffy cluster as rain clouds, but white and see-through, drifting slowly.
const CLOUDS = 40;
function Clouds() {
  const group = useRef<THREE.Group>(null);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), n = new THREE.Vector3(), x = new THREE.Vector3(), z = new THREE.Vector3(), spin = new THREE.Quaternion();
    let i = 0;
    for (let c = 0; c < CLOUDS; c++) {
      n.randomDirection();
      // Random twist about the vertical so the clouds don't all face the same way.
      q.setFromUnitVectors(UP, n).multiply(spin.setFromAxisAngle(UP, Math.random() * Math.PI * 2));
      x.set(1, 0, 0).applyQuaternion(q);
      z.set(0, 0, 1).applyQuaternion(q);
      const size = 0.8 + Math.random() * 0.4;
      for (const [ox, oy, oz, r] of PUFF_OFFSETS) {
        p.copy(n).multiplyScalar(1.12 + oy).addScaledVector(x, ox * size).addScaledVector(z, oz * size);
        const rr = r * size;
        m.compose(p, q, s.set(rr, rr * 0.65, rr));
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
      <instancedMesh ref={ref} args={[undefined, undefined, CLOUDS * WX_PUFFS]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#ffffff" flatShading transparent opacity={0.38} roughness={1} depthWrite={false} />
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
  const cols = useMemo(() => sim.nations.map((n) => new THREE.Color(n.color).lerp(WHITE, 0.25)), [sim, sim.nations.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // A pitched (gable) roof: a triangle extruded along the house, so from above it reads as a roof, not a diamond.
    const shape = new THREE.Shape([new THREE.Vector2(-0.0068, 0), new THREE.Vector2(0.0068, 0), new THREE.Vector2(0, 0.0065)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0145, bevelEnabled: false });
    g.translate(0, 0, -0.00725);
    return g;
  }, []);
  const n = useMemo(() => new THREE.Vector3(), []);
  const turn = useMemo(() => new THREE.Quaternion(), []);
  const qh = useMemo(() => new THREE.Quaternion(), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const centre = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const t1 = useMemo(() => new THREE.Vector3(), []);
  const t2 = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const cols = useMemo(() => sim.nations.map((n) => new THREE.Color(n.color).multiplyScalar(0.8)), [sim, sim.nations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const mesh = ref.current;
    const top = roofs.current;
    if (!mesh || !top) return;
    let i = 0;
    for (const v of sim.villages) {
      surface(sim, v.face, centre);
      n.copy(centre).normalize();
      // Two directions along the ground, to spread houses around the village centre.
      t1.set(0, 1, 0).cross(n);
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
      t1.normalize();
      t2.copy(n).cross(t1);
      q.setFromUnitVectors(up, n);
      // Cities pack houses tighter; spots that land in the sea are skipped.
      const spacing = v.tier === 2 ? 0.0105 : 0.012;
      for (let k = 0, slot = 0; k < v.houses && i < MAX_HOUSES && slot < v.houses * 2 + 4; slot++) {
        // A golden-angle spiral packs houses evenly.
        const r = spacing * Math.sqrt(slot);
        const ang = slot * 2.39996 + v.id;
        p.copy(centre).addScaledVector(t1, Math.cos(ang) * r).addScaledVector(t2, Math.sin(ang) * r);
        if (slot > 0 && isWater(sim.terrain[sim.faceToward(v.face, p)] as T)) continue;
        s.setScalar(k === 0 ? 1.6 : 1); // the first house is the shrine
        // Each house faces its own way, so the village doesn't look like a grid.
        qh.copy(q).multiply(turn.setFromAxisAngle(up, ang * 3.7));
        p.addScaledVector(n, 0.0035 * s.x);
        m.compose(p, qh, s);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, WALL);
        // The roof sits on top of the walls, in the nation's colour (the shrine's is gold).
        p.addScaledVector(n, 0.0045 * s.x);
        m.compose(p, qh, s);
        top.setMatrixAt(i, m);
        top.setColorAt(i, k === 0 ? SHRINE : (cols[v.nation] ?? WHITE));
        k++;
        i++;
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
        <boxGeometry args={[0.011, 0.009, 0.013]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={roofs} args={[roof, undefined, MAX_HOUSES]} frustumCulled={false}>
        <meshStandardMaterial color="#ffffff" flatShading roughness={0.7} />
      </instancedMesh>
    </>
  );
}

// Bigger villages put up landmark buildings beside their houses: a hall, then a temple, then a watchtower.
const LANDMARKS = [
  { at: 5, body: [0.016, 0.011, 0.012], roof: [0.013, 0.008], wall: "#d9c7a8" }, // town hall
  { at: 9, body: [0.012, 0.022, 0.012], roof: [0.011, 0.014], wall: "#f4efe6" }, // temple, gold roof
  { at: 14, body: [0.007, 0.03, 0.007], roof: [0.008, 0.012], wall: "#a59a8c" }, // watchtower
  { at: 28, body: [0.022, 0.018, 0.022], roof: [0.019, 0.016], wall: "#cfc4b2" }, // castle (only cities get this big)
] as const;
const MAX_LANDMARKS = 200;
function Landmarks({ sim }: { sim: PlanetSim }) {
  const bodies = useRef<(THREE.InstancedMesh | null)[]>([]);
  const roofs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const roofGeo = useMemo(() => LANDMARKS.map((l, j) => {
    if (j === 0) {
      // The hall gets a long pitched roof like the houses.
      const shape = new THREE.Shape([new THREE.Vector2(-0.0072, -l.roof[1] / 2), new THREE.Vector2(0.0072, -l.roof[1] / 2), new THREE.Vector2(0, l.roof[1] / 2)]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false });
      g.translate(0, 0, -0.009);
      g.rotateY(Math.PI / 2);
      return g;
    }
    const g = new THREE.ConeGeometry(l.roof[0], l.roof[1], 4);
    g.rotateY(Math.PI / 4);
    return g;
  }), []);
  const cols = useMemo(() => sim.nations.map((n) => new THREE.Color(n.color).multiplyScalar(0.8)), [sim, sim.nations.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Vector3(), p: new THREE.Vector3(), n: new THREE.Vector3(), t1: new THREE.Vector3(), t2: new THREE.Vector3(), q: new THREE.Quaternion(), one: new THREE.Vector3(1, 1, 1) }), []);
  useFrame(() => {
    const { m, c, p, n, t1, t2, q, one } = tmp;
    const counts = LANDMARKS.map(() => 0);
    for (const v of sim.villages) {
      surface(sim, v.face, c);
      n.copy(c).normalize();
      t1.set(0, 1, 0).cross(n);
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
      t1.normalize();
      t2.copy(n).cross(t1);
      q.setFromUnitVectors(UP_Y, n);
      LANDMARKS.forEach((l, j) => {
        const body = bodies.current[j], roof = roofs.current[j];
        if (!body || !roof || v.houses < l.at || counts[j] >= MAX_LANDMARKS) return;
        // Just outside the houses' spiral, each landmark on its own side of the village.
        const r = 0.012 * Math.sqrt(v.houses) + 0.01;
        const ang = v.id + j * 2.1;
        p.copy(c).addScaledVector(t1, Math.cos(ang) * r).addScaledVector(t2, Math.sin(ang) * r).addScaledVector(n, l.body[1] / 2 - 0.001);
        m.compose(p, q, one);
        body.setMatrixAt(counts[j], m);
        p.addScaledVector(n, l.body[1] / 2 + l.roof[1] / 2);
        m.compose(p, q, one);
        roof.setMatrixAt(counts[j], m);
        roof.setColorAt(counts[j], j === 1 ? SHRINE : (cols[v.nation] ?? WHITE));
        counts[j]++;
      });
    }
    LANDMARKS.forEach((_, j) => {
      for (const x of [bodies.current[j], roofs.current[j]]) {
        if (!x) continue;
        x.count = counts[j];
        x.instanceMatrix.needsUpdate = true;
        if (x.instanceColor) x.instanceColor.needsUpdate = true;
      }
    });
  });
  return (
    <>
      {LANDMARKS.map((l, j) => (
        <group key={j}>
          <instancedMesh ref={(el) => { bodies.current[j] = el; }} args={[undefined, undefined, MAX_LANDMARKS]} frustumCulled={false}>
            {j === 2 ? <cylinderGeometry args={[l.body[0] / 2, l.body[0] / 2, l.body[1], 8]} /> : <boxGeometry args={[l.body[0], l.body[1], l.body[2]]} />}
            <meshStandardMaterial color={l.wall} roughness={0.8} />
          </instancedMesh>
          <instancedMesh ref={(el) => { roofs.current[j] = el; }} args={[roofGeo[j], undefined, MAX_LANDMARKS]} frustumCulled={false}>
            <meshStandardMaterial color="#ffffff" flatShading roughness={0.7} />
          </instancedMesh>
        </group>
      ))}
    </>
  );
}
const UP_Y = new THREE.Vector3(0, 1, 0);

// Cities get a ring of stone walls with towers, and towns and cities get name labels (★ marks each nation's capital).
const WALL_SEGS = 28;
const MAX_WALLS = 40 * WALL_SEGS;
function Cities({ sim }: { sim: PlanetSim }) {
  const walls = useRef<THREE.InstancedMesh>(null);
  const towers = useRef<THREE.InstancedMesh>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const camera = useThree((s) => s.camera);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Vector3(), p: new THREE.Vector3(), n: new THREE.Vector3(), t1: new THREE.Vector3(), t2: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), s: new THREE.Vector3(), cam: new THREE.Vector3() }), []);
  // Which settlements get a label; refreshed from the frame loop when towns appear, grow or fall.
  const [towns, setTowns] = useState<{ id: number; face: number; name: string; tier: number; nation: number; capital: boolean }[]>([]);
  const townKey = useRef("");
  useFrame(() => {
    const list = sim.villages.filter((v) => v.tier > 0).map((v) => ({ id: v.id, face: v.face, name: v.name, tier: v.tier, nation: v.nation, capital: sim.capital(v.nation)?.id === v.id }));
    const key = list.map((v) => `${v.id}:${v.tier}:${v.nation}:${v.capital}`).join(",");
    if (key !== townKey.current) {
      townKey.current = key;
      setTowns(list);
    }
  });
  useFrame(() => {
    const w = walls.current, tw = towers.current;
    if (!w || !tw) return;
    const { m, c, p, n, t1, t2, q, q2, s, cam } = tmp;
    let i = 0, j = 0;
    for (const v of sim.villages) {
      if (v.tier < 2) continue;
      surface(sim, v.face, c);
      n.copy(c).normalize();
      t1.set(0, 1, 0).cross(n);
      if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
      t1.normalize();
      t2.copy(n).cross(t1);
      q.setFromUnitVectors(UP_Y, n);
      const R = 0.0105 * Math.sqrt(v.houses * 1.4) + 0.016;
      const seg = (2 * Math.PI * R) / WALL_SEGS;
      for (let k = 0; k < WALL_SEGS && i < MAX_WALLS; k++) {
        const a = (k / WALL_SEGS) * Math.PI * 2;
        p.copy(c).addScaledVector(t1, Math.cos(a) * R).addScaledVector(t2, Math.sin(a) * R);
        if (isWater(sim.terrain[sim.faceToward(v.face, p)] as T)) continue;
        // Each segment runs along the circle: x points outwards, y up, z along the wall.
        s.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a));
        q2.setFromRotationMatrix(m.makeBasis(s, n, s.clone().cross(n)));
        p.addScaledVector(n, 0.002);
        m.compose(p, q2, s.set(0.0022, 0.006, seg * 1.05));
        w.setMatrixAt(i++, m);
        if (k % 4 === 0) {
          p.addScaledVector(n, 0.002);
          m.compose(p, q, s.set(1, 1, 1));
          tw.setMatrixAt(j++, m);
        }
      }
    }
    w.count = i;
    tw.count = j;
    w.instanceMatrix.needsUpdate = true;
    tw.instanceMatrix.needsUpdate = true;
    // Fade labels on the far side of the planet.
    cam.copy(camera.position).normalize();
    towns.forEach((v, k) => {
      const el = labels.current[k];
      if (!el) return;
      const d = sim.centroids[v.face * 3] * cam.x + sim.centroids[v.face * 3 + 1] * cam.y + sim.centroids[v.face * 3 + 2] * cam.z;
      el.style.opacity = String(Math.max(0, Math.min(1, (d - 0.25) * 3)));
    });
  });
  return (
    <>
      <instancedMesh ref={walls} args={[undefined, undefined, MAX_WALLS]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#b9ad9b" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={towers} args={[undefined, undefined, MAX_WALLS / 4]} frustumCulled={false}>
        <cylinderGeometry args={[0.0028, 0.0032, 0.011, 6]} />
        <meshStandardMaterial color="#a89c8a" roughness={0.9} flatShading />
      </instancedMesh>
      {towns.map((v, k) => {
        const pos = surface(sim, v.face, new THREE.Vector3()).multiplyScalar(1.035);
        const capital = v.capital;
        return (
          <Html key={v.id} position={pos} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div ref={(el) => { labels.current[k] = el; }} className="city-label" style={{ borderColor: sim.nations[v.nation]?.color }}>
              {capital ? "★ " : ""}
              {v.name}
              {v.tier === 2 ? "" : <span className="opacity-60"> · town</span>}
            </div>
          </Html>
        );
      })}
    </>
  );
}

// Big landmasses carry their names, written across the land like a map; they fade on the far side.
function ContinentLabels({ sim }: { sim: PlanetSim }) {
  const camera = useThree((s) => s.camera);
  const list = useMemo(() => sim.continents(), [sim]);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const cam = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    cam.copy(camera.position).normalize();
    const far = camera.position.length();
    list.forEach((c, k) => {
      const el = refs.current[k];
      if (!el) return;
      const d = sim.centroids[c.face * 3] * cam.x + sim.centroids[c.face * 3 + 1] * cam.y + sim.centroids[c.face * 3 + 2] * cam.z;
      // Shown when facing you, and only from a distance (they'd crowd the villages up close).
      el.style.opacity = String(Math.max(0, Math.min(1, (d - 0.3) * 2.5)) * Math.max(0, Math.min(1, (far - 1.7) * 2)) * 0.85);
    });
  });
  return (
    <>
      {list.map((c, k) => (
        <Html key={c.name} position={surface(sim, c.face, new THREE.Vector3()).multiplyScalar(1.02)} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
          <div ref={(el) => { refs.current[k] = el; }} className="continent-label">
            {c.name}
          </div>
        </Html>
      ))}
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

// ---- Weather and catastrophes: drawn straight from the sim's lists each frame ----

const WX_PUFFS = 9;
const DROPS = 70;
const MAX_WX = 8;
// Fixed puff offsets in a cloud's local frame (x, z across the surface; y up).
const PUFF_OFFSETS = Array.from({ length: WX_PUFFS }, (_, k) => {
  const a = (k / WX_PUFFS) * Math.PI * 2 + tileRand(k, 1);
  const r = k === 0 ? 0 : 0.012 + tileRand(k, 2) * 0.022;
  return [Math.cos(a) * r, tileRand(k, 3) * 0.006, Math.sin(a) * r, 0.016 + tileRand(k, 4) * 0.012] as const;
});
const DROP_OFFSETS = Array.from({ length: DROPS }, (_, k) => {
  const a = tileRand(k, 5) * Math.PI * 2, r = Math.sqrt(tileRand(k, 6)) * 0.03;
  return [Math.cos(a) * r, Math.sin(a) * r, tileRand(k, 7)] as const;
});
const UP = new THREE.Vector3(0, 1, 0);

// Dark rain clouds and storms, with falling rain and lightning bolts.
function Weather({ sim }: { sim: PlanetSim }) {
  const puffs = useRef<THREE.InstancedMesh>(null);
  const rain = useRef<THREE.LineSegments>(null);
  const bolt = useRef<THREE.LineSegments>(null);
  const flash = useRef<THREE.PointLight>(null);
  const rainGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_WX * DROPS * 6), 3));
    return g;
  }, []);
  const boltGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_WX * 6 * 6), 3));
    return g;
  }, []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color(), x: new THREE.Vector3(), z: new THREE.Vector3(), n: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() }), []);
  useFrame(({ clock }) => {
    const mesh = puffs.current, rl = rain.current, bl = bolt.current;
    if (!mesh || !rl || !bl) return;
    const { m, q, p, s, c, x, z, n, a, b } = tmp;
    const rp = rainGeo.getAttribute("position") as THREE.BufferAttribute;
    const bp = boltGeo.getAttribute("position") as THREE.BufferAttribute;
    let i = 0, d = 0, k = 0, lit = 0;
    const t = clock.elapsedTime;
    for (const w of sim.weather) {
      n.set(...w.pos);
      q.setFromUnitVectors(UP, n);
      x.set(1, 0, 0).applyQuaternion(q);
      z.set(0, 0, 1).applyQuaternion(q);
      // Grow in, shrink out.
      const life = Math.min(1, w.age / 1.5, (w.life - w.age) / 1.5);
      const flashing = w.flash && sim.year - w.flash.at < 0.25;
      c.set(w.storm ? (flashing ? "#c9d4ff" : "#3a3f4d") : "#6f7889");
      const spread = w.storm ? 1.9 : 1, grow = w.storm ? 1.7 : 1; // storms are much bigger than rain clouds
      for (const [ox, oy, oz, r] of PUFF_OFFSETS) {
        p.copy(n).multiplyScalar(1.1 + oy).addScaledVector(x, ox * spread).addScaledVector(z, oz * spread);
        const rr = r * life * grow;
        m.compose(p, q, s.set(rr, rr * 0.65, rr));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i++, c);
      }
      // Rain: short streaks falling from the cloud base to the ground, looping.
      for (const [ox, oz, ph] of DROP_OFFSETS) {
        const f = (ph + t * (w.storm ? 1.6 : 1.1)) % 1;
        const h = 1.095 - f * 0.085;
        a.copy(n).multiplyScalar(h).addScaledVector(x, ox * spread).addScaledVector(z, oz * spread);
        b.copy(a).addScaledVector(n, -0.012);
        const o = d * 6;
        if (life < 0.3) a.copy(b); // no rain while forming
        rp.array[o] = a.x; rp.array[o + 1] = a.y; rp.array[o + 2] = a.z;
        rp.array[o + 3] = b.x; rp.array[o + 4] = b.y; rp.array[o + 5] = b.z;
        d++;
      }
      // Lightning: a jagged bolt from the cloud to the strike tile.
      if (flashing && w.flash) {
        surface(sim, w.flash.face, b);
        a.copy(n).multiplyScalar(1.095);
        let prev = a.clone();
        for (let j = 1; j <= 6; j++) {
          const cur = a.clone().lerp(b, j / 6);
          if (j < 6) cur.addScaledVector(x, (Math.random() - 0.5) * 0.012).addScaledVector(z, (Math.random() - 0.5) * 0.012);
          const o = k * 6;
          bp.array[o] = prev.x; bp.array[o + 1] = prev.y; bp.array[o + 2] = prev.z;
          bp.array[o + 3] = cur.x; bp.array[o + 4] = cur.y; bp.array[o + 5] = cur.z;
          prev = cur;
          k++;
        }
        if (flash.current && !lit) {
          flash.current.position.copy(b).multiplyScalar(1.05);
          lit = 1;
        }
      }
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    rainGeo.setDrawRange(0, d * 2);
    rp.needsUpdate = true;
    boltGeo.setDrawRange(0, k * 2);
    bp.needsUpdate = true;
    if (flash.current) flash.current.intensity = lit ? 3 : 0;
  });
  return (
    <>
      <instancedMesh ref={puffs} args={[undefined, undefined, MAX_WX * WX_PUFFS]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial flatShading transparent opacity={0.92} roughness={1} />
      </instancedMesh>
      <lineSegments ref={rain} geometry={rainGeo} frustumCulled={false}>
        <lineBasicMaterial color="#9cc7ff" transparent opacity={0.55} />
      </lineSegments>
      <lineSegments ref={bolt} geometry={boltGeo} frustumCulled={false}>
        <lineBasicMaterial color="#f4f7ff" />
      </lineSegments>
      <pointLight ref={flash} color="#cfd8ff" intensity={0} distance={0.6} />
    </>
  );
}

// Tsunami rings, falling meteors with a fiery trail, and smoke rising from volcanoes.
const MAX_WAVES = 4, MAX_METEORS = 4, MAX_VOLCANOES = 8, SMOKE = 14;
function Catastrophes({ sim }: { sim: PlanetSim }) {
  const waves = useRef<(THREE.Mesh | null)[]>([]);
  const rocks = useRef<(THREE.Group | null)[]>([]);
  const smoke = useRef<THREE.InstancedMesh>(null);
  const cones = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<(THREE.PointLight | null)[]>([]);
  const tmp = useMemo(() => ({ n: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3(), side: new THREE.Vector3(), cone: new THREE.Color() }), []);
  useFrame(({ clock }) => {
    const { n, q, m, p, s, side, cone } = tmp;
    // Tsunami: a flat ring hugging the sea, whose radius is the wave front.
    waves.current.forEach((mesh, i) => {
      const w = sim.waves[i];
      if (!mesh) return;
      mesh.visible = !!w;
      if (!w) return;
      n.set(...sim.c(w.face));
      // A ring of angular radius r on a sphere sits at height cos(r) with radius sin(r).
      const r = Math.max(0.005, w.r);
      mesh.position.copy(n).multiplyScalar(Math.cos(r) * (SEA + 0.004));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      mesh.scale.setScalar(Math.sin(r) * (SEA + 0.004));
      (mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - (sim.year - w.at) / 5.5);
    });
    // Meteors: fall from far out along the tile's normal, slightly slanted.
    rocks.current.forEach((g, i) => {
      const mt = sim.meteors[i];
      if (!g) return;
      g.visible = !!mt;
      if (!mt) return;
      n.set(...sim.c(mt.face));
      side.set(0, 1, 0).cross(n).normalize();
      const k = Math.min(1, (sim.year - mt.at) / mt.fall);
      const h = 1 + 1.6 * (1 - k) * (1 - k);
      g.position.copy(n).multiplyScalar(h).addScaledVector(side, 0.5 * (1 - k));
      g.lookAt(0, 0, 0); // the trail (+z behind) points away from the planet
      const scale = 0.7 + 0.5 * k;
      g.scale.setScalar(scale);
    });
    // Every volcano keeps its cone (glowing red while live); smoke and glow only while erupting.
    const sm = smoke.current, cn = cones.current;
    if (sm && cn) {
      let i = 0;
      const t = clock.elapsedTime;
      sim.volcanoes.slice(0, MAX_VOLCANOES).forEach((v, vi) => {
        surface(sim, v.face, p);
        n.copy(p).normalize();
        q.setFromUnitVectors(UP, n);
        side.set(1, 0, 0).applyQuaternion(q);
        m.compose(n.clone().multiplyScalar(p.length() + 0.01), q, s.set(1, 1, 1));
        cn.setMatrixAt(vi, m);
        cn.setColorAt(vi, cone.set(v.active ? "#a8321a" : "#4a3f3a"));
        const l = glow.current[vi];
        if (!v.active) {
          if (l) l.intensity = 0;
          return;
        }
        const fade = Math.min(1, (v.life - (sim.year - v.at)) / 3, (sim.year - v.at) / 1);
        for (let j = 0; j < SMOKE; j++) {
          const f = (j / SMOKE + t * 0.25) % 1;
          const r = (0.008 + f * 0.022) * fade;
          const pos = p.clone().addScaledVector(n, 0.01 + f * 0.12).addScaledVector(side, f * 0.03 * Math.sin(j * 2.3));
          m.compose(pos, q, s.set(r, r, r));
          sm.setMatrixAt(i++, m);
        }
        if (l) {
          l.position.copy(p).multiplyScalar(1.02);
          l.intensity = (1.2 + Math.sin(t * 9) * 0.4) * fade;
        }
      });
      for (let vi = sim.volcanoes.length; vi < MAX_VOLCANOES; vi++) if (glow.current[vi]) glow.current[vi]!.intensity = 0;
      sm.count = i;
      sm.instanceMatrix.needsUpdate = true;
      cn.count = Math.min(sim.volcanoes.length, MAX_VOLCANOES);
      cn.instanceMatrix.needsUpdate = true;
      if (cn.instanceColor) cn.instanceColor.needsUpdate = true;
    }
  });
  return (
    <>
      {Array.from({ length: MAX_WAVES }, (_, i) => (
        <mesh key={`w${i}`} ref={(el) => { waves.current[i] = el; }} visible={false}>
          <ringGeometry args={[0.93, 1, 96]} />
          <meshBasicMaterial color="#d8f6ff" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {Array.from({ length: MAX_METEORS }, (_, i) => (
        <group key={`m${i}`} ref={(el) => { rocks.current[i] = el; }} visible={false}>
          <mesh>
            <icosahedronGeometry args={[0.025, 0]} />
            <meshStandardMaterial color="#5a4632" emissive="#ff7a1a" emissiveIntensity={1.4} flatShading />
          </mesh>
          {/* Fiery trail behind the rock (away from the planet). */}
          <mesh position={[0, 0, -0.09]} rotation={[-Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.022, 0.18, 10, 1, true]} />
            <meshBasicMaterial color="#ffb347" transparent opacity={0.75} depthWrite={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {/* Volcano cones, sitting on the peak with the tip pointing out. */}
      <instancedMesh ref={cones} args={[undefined, undefined, MAX_VOLCANOES]} frustumCulled={false}>
        <coneGeometry args={[0.022, 0.03, 9, 1, true]} />
        <meshStandardMaterial flatShading roughness={1} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={smoke} args={[undefined, undefined, MAX_VOLCANOES * SMOKE]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#3b3533" flatShading transparent opacity={0.85} roughness={1} />
      </instancedMesh>
      {Array.from({ length: MAX_VOLCANOES }, (_, i) => (
        <pointLight key={`g${i}`} ref={(el) => { glow.current[i] = el; }} color="#ff5a1a" intensity={0} distance={0.25} />
      ))}
    </>
  );
}

// Drought: a hot glow over the baked land, with rings of heat haze rising and fading.
const MAX_DROUGHTS = 3, HAZE = 3;
function Droughts({ sim }: { sim: PlanetSim }) {
  const glows = useRef<(THREE.Mesh | null)[]>([]);
  const hazes = useRef<(THREE.Mesh | null)[]>([]);
  const n = useMemo(() => new THREE.Vector3(), []);
  const Z = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < MAX_DROUGHTS; i++) {
      const d = sim.droughts[i];
      const glow = glows.current[i];
      if (glow) glow.visible = !!d;
      for (let j = 0; j < HAZE; j++) {
        const h = hazes.current[i * HAZE + j];
        if (h) h.visible = !!d;
      }
      if (!d || !glow) continue;
      n.set(...sim.c(d.face));
      const age = sim.year - d.at;
      const fade = Math.min(1, age / 1.5, (d.life - age) / 4);
      // A disc of angular radius r sits at height cos(r) with radius sin(r).
      glow.position.copy(n).multiplyScalar(Math.cos(d.r) * 1.075);
      glow.quaternion.setFromUnitVectors(Z, n);
      glow.scale.setScalar(Math.sin(d.r) * 1.075);
      (glow.material as THREE.MeshBasicMaterial).opacity = (0.1 + 0.04 * Math.sin(t * 2)) * fade;
      for (let j = 0; j < HAZE; j++) {
        const h = hazes.current[i * HAZE + j];
        if (!h) continue;
        const k = (t * 0.35 + j / HAZE) % 1; // each ring rises, widens and fades, then starts again
        const r = d.r * (0.35 + 0.5 * k);
        h.position.copy(n).multiplyScalar(Math.cos(r) * (1.08 + 0.06 * k));
        h.quaternion.setFromUnitVectors(Z, n);
        h.scale.setScalar(Math.sin(r) * (1.08 + 0.06 * k));
        (h.material as THREE.MeshBasicMaterial).opacity = 0.22 * Math.sin(Math.PI * k) * fade;
      }
    }
  });
  return (
    <>
      {Array.from({ length: MAX_DROUGHTS }, (_, i) => (
        <group key={i}>
          <mesh ref={(el) => { glows.current[i] = el; }} visible={false}>
            <circleGeometry args={[1, 48]} />
            <meshBasicMaterial color="#ffb347" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
          {Array.from({ length: HAZE }, (_, j) => (
            <mesh key={j} ref={(el) => { hazes.current[i * HAZE + j] = el; }} visible={false}>
              <ringGeometry args={[0.94, 1, 64]} />
              <meshBasicMaterial color="#ffc46b" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

// Warships: a dark hull and a sail in the nation's colour, sailing between sea tiles.
const MAX_SHIPS_DRAWN = 80;
function Ships({ sim }: { sim: PlanetSim }) {
  const hulls = useRef<THREE.InstancedMesh>(null);
  const sails = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), a: new THREE.Vector3(), b: new THREE.Vector3(), up: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), p: new THREE.Vector3(), c: new THREE.Color(), s: new THREE.Vector3(), q: new THREE.Quaternion(), sail: new THREE.Matrix4() }), []);
  useFrame(({ clock }) => {
    const h = hulls.current, sl = sails.current;
    if (!h || !sl) return;
    const { m, a, b, up, fwd, right, p, c, s, q, sail } = tmp;
    const ships = sim.ships.slice(0, MAX_SHIPS_DRAWN);
    ships.forEach((sh, i) => {
      a.set(...sim.c(sh.from));
      b.set(...sim.c(sh.face));
      up.copy(a).lerp(b, Math.min(1, sh.t)).normalize();
      fwd.copy(b).sub(a);
      if (fwd.lengthSq() < 1e-9) fwd.set(0, 1, 0).cross(up);
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      right.crossVectors(up, fwd).normalize();
      const bob = Math.sin(clock.elapsedTime * 2 + sh.id) * 0.0006;
      p.copy(up).multiplyScalar(SEA + 0.002 + bob);
      m.makeBasis(right, up, fwd).setPosition(p);
      q.setFromRotationMatrix(m);
      h.setMatrixAt(i, m.compose(p, q, s.set(1, 1, 1)));
      sail.compose(p.addScaledVector(up, 0.012), q, s.set(1, 1, 1));
      sl.setMatrixAt(i, sail);
      sl.setColorAt(i, c.set(sim.nations[sh.nation]?.color ?? "#ffffff"));
    });
    h.count = sl.count = ships.length;
    h.instanceMatrix.needsUpdate = true;
    sl.instanceMatrix.needsUpdate = true;
    if (sl.instanceColor) sl.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={hulls} args={[undefined, undefined, MAX_SHIPS_DRAWN]} frustumCulled={false}>
        <boxGeometry args={[0.012, 0.006, 0.032]} />
        <meshStandardMaterial color="#4a3426" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={sails} args={[undefined, undefined, MAX_SHIPS_DRAWN]} frustumCulled={false}>
        <boxGeometry args={[0.02, 0.018, 0.0015]} />
        <meshStandardMaterial roughness={0.8} emissive="#222222" />
      </instancedMesh>
    </>
  );
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
      <Landmarks sim={sim} />
      <Cities sim={sim} />
      <ContinentLabels sim={sim} />
      <Trees sim={sim} />
      <Ocean />
      <Clouds />
      <Weather sim={sim} />
      <Catastrophes sim={sim} />
      <Droughts sim={sim} />
      <Ships sim={sim} />
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

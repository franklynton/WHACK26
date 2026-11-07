"use client";
// The 3D planet (track A). A low-poly sphere split into 12 regions; each region is
// coloured by its terrain and raised a little if it's a mountain. Click to act on a region.
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { useMemo, useState } from "react";
import * as THREE from "three";
import type { Region, Terrain } from "@/types/world";

const COLORS: Record<Terrain, string> = {
  ocean: "#2b6cb0",
  plains: "#68b36b",
  forest: "#2f7d4f",
  mountain: "#9a8f86",
  desert: "#d9b26f",
};
const HEIGHT: Record<Terrain, number> = { ocean: 0.97, plains: 1, forest: 1.01, mountain: 1.08, desert: 1 };

// The 12 vertices of an icosahedron are the region centres.
const CENTRES: THREE.Vector3[] = (() => {
  const pos = new THREE.IcosahedronGeometry(1, 0).getAttribute("position");
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    if (!out.some((o) => o.distanceTo(v) < 1e-4)) out.push(v);
  }
  return out;
})();

const nearestRegion = (p: THREE.Vector3) => {
  let best = 0;
  CENTRES.forEach((c, i) => {
    if (c.distanceToSquared(p) < CENTRES[best].distanceToSquared(p)) best = i;
  });
  return best;
};

function Globe({ regions, hover, onHover, onPick }: { regions: Region[]; hover: number | null; onHover: (id: number | null) => void; onPick: (id: number) => void }) {
  // Which region each triangle belongs to; fixed for the life of the planet.
  const base = useMemo(() => new THREE.IcosahedronGeometry(1, 4).toNonIndexed(), []);
  const faceRegion = useMemo(() => {
    const pos = base.getAttribute("position");
    const out: number[] = [];
    for (let f = 0; f < pos.count / 3; f++) {
      const c = new THREE.Vector3();
      for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k));
      out.push(nearestRegion(c.normalize()));
    }
    return out;
  }, [base]);

  // Recolour and reshape whenever the terrain changes.
  const geometry = useMemo(() => {
    const g = base.clone();
    const pos = g.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const r = regions[faceRegion[Math.floor(i / 3)]];
      col.set(COLORS[r.terrain]);
      if (r.id === hover) col.offsetHSL(0, 0, 0.12);
      colors.set([col.r, col.g, col.b], i * 3);
      v.fromBufferAttribute(base.getAttribute("position"), i).normalize().multiplyScalar(HEIGHT[r.terrain]);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [base, faceRegion, regions, hover]);

  const regionOf = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.faceIndex != null ? faceRegion[e.faceIndex] : null);

  return (
    <mesh
      geometry={geometry}
      onPointerMove={(e) => {
        e.stopPropagation();
        onHover(regionOf(e));
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        const id = regionOf(e);
        if (id !== null) onPick(id);
      }}
    >
      <meshStandardMaterial vertexColors flatShading roughness={0.9} />
    </mesh>
  );
}

export default function Planet({ regions, onPick }: { regions: Region[]; onPick: (regionId: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <Canvas camera={{ position: [0, 0, 3.2], fov: 45 }} style={{ cursor: hover !== null ? "pointer" : "grab" }}>
      <color attach="background" args={["#05060f"]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 2, 4]} intensity={1.6} />
      <Stars radius={60} depth={30} count={2500} factor={3} fade />
      <Globe regions={regions} hover={hover} onHover={setHover} onPick={onPick} />
      <OrbitControls enablePan={false} minDistance={2} maxDistance={6} autoRotate autoRotateSpeed={0.4} />
    </Canvas>
  );
}

/**
 * Superficie approssimata da nuvola punti: campo scalare su griglia (THREE.MarchingCubes)
 * + blur integrato + Laplaciano su mesh.
 */

import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type FootSurfaceOptions = {
  /** Risoluzione griglia marching cubes (consigliato 36–52) */
  resolution: number;
  maxPolyCount: number;
  /** Metaball per punto */
  strength: number;
  subtract: number;
  /** Isosuperficie (deve intersecare il campo accumulato) */
  isolation: number;
  /** Passate blur sul campo scalare prima di polygonize */
  fieldBlurPasses: number;
  /** Iterazioni Laplaciano mesh */
  smoothIterations: number;
  lambda: number;
  /** Max punti sorgente (sottocampionamento stride) */
  maxSourcePoints: number;
};

export const DEFAULT_FOOT_SURFACE_OPTIONS: FootSurfaceOptions = {
  resolution: 46,
  maxPolyCount: 180000,
  strength: 0.95,
  subtract: 16,
  isolation: 42,
  fieldBlurPasses: 2,
  smoothIterations: 5,
  lambda: 0.42,
  maxSourcePoints: 3200,
};

function buildNeighborSets(index: THREE.BufferAttribute, vertexCount: number): Set<number>[] {
  const neighbors: Set<number>[] = Array.from({ length: vertexCount }, () => new Set());
  const arr = index.array as ArrayLike<number>;
  const len = index.count;
  for (let i = 0; i < len; i += 3) {
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + 2];
    neighbors[a].add(b);
    neighbors[a].add(c);
    neighbors[b].add(a);
    neighbors[b].add(c);
    neighbors[c].add(a);
    neighbors[c].add(b);
  }
  return neighbors;
}

/**
 * Laplacian smoothing (mesh triangolare indicizzata).
 */
export function laplacianSmoothGeometry(
  geometry: THREE.BufferGeometry,
  iterations: number,
  lambda: number
): THREE.BufferGeometry {
  if (iterations <= 0) {
    geometry.computeVertexNormals();
    return geometry;
  }

  const merged = mergeVertices(geometry, 1e-5);
  if (merged !== geometry) geometry.dispose();

  const indexAttr = merged.index;
  if (!indexAttr) {
    merged.computeVertexNormals();
    return merged;
  }

  const vertexCount = merged.attributes.position.count;
  const neighbors = buildNeighborSets(indexAttr, vertexCount);
  const pos = merged.attributes.position.array as Float32Array;
  const newPos = new Float32Array(pos.length);

  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < vertexCount; v++) {
      const nbr = neighbors[v];
      if (nbr.size === 0) {
        newPos[v * 3] = pos[v * 3];
        newPos[v * 3 + 1] = pos[v * 3 + 1];
        newPos[v * 3 + 2] = pos[v * 3 + 2];
        continue;
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      nbr.forEach((j) => {
        sx += pos[j * 3];
        sy += pos[j * 3 + 1];
        sz += pos[j * 3 + 2];
      });
      const k = nbr.size;
      const ox = pos[v * 3];
      const oy = pos[v * 3 + 1];
      const oz = pos[v * 3 + 2];
      newPos[v * 3] = (1 - lambda) * ox + lambda * (sx / k);
      newPos[v * 3 + 1] = (1 - lambda) * oy + lambda * (sy / k);
      newPos[v * 3 + 2] = (1 - lambda) * oz + lambda * (sz / k);
    }
    pos.set(newPos);
  }

  merged.attributes.position.needsUpdate = true;
  merged.computeVertexNormals();
  return merged;
}

/**
 * Taubin fairing: passata con λ>0 poi con μ<0 per attenuare rumore e spike
 * mantenendo il volume meglio di un Laplaciano ripetuto (meno “crollo” globale).
 */
export function taubinSmoothGeometry(
  geometry: THREE.BufferGeometry,
  iterations: number,
  lambda: number,
  mu: number
): THREE.BufferGeometry {
  if (iterations <= 0) {
    geometry.computeVertexNormals();
    return geometry;
  }

  const merged = mergeVertices(geometry, 1e-5);
  if (merged !== geometry) geometry.dispose();

  const indexAttr = merged.index;
  if (!indexAttr) {
    merged.computeVertexNormals();
    return merged;
  }

  const vertexCount = merged.attributes.position.count;
  const neighbors = buildNeighborSets(indexAttr, vertexCount);
  const pos = merged.attributes.position.array as Float32Array;
  const newPos = new Float32Array(pos.length);

  const step = (factor: number) => {
    for (let v = 0; v < vertexCount; v++) {
      const nbr = neighbors[v];
      if (nbr.size === 0) {
        newPos[v * 3] = pos[v * 3]!;
        newPos[v * 3 + 1] = pos[v * 3 + 1]!;
        newPos[v * 3 + 2] = pos[v * 3 + 2]!;
        continue;
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      nbr.forEach((j) => {
        sx += pos[j * 3]!;
        sy += pos[j * 3 + 1]!;
        sz += pos[j * 3 + 2]!;
      });
      const k = nbr.size;
      const ox = pos[v * 3]!;
      const oy = pos[v * 3 + 1]!;
      const oz = pos[v * 3 + 2]!;
      const cx = sx / k;
      const cy = sy / k;
      const cz = sz / k;
      newPos[v * 3] = ox + factor * (cx - ox);
      newPos[v * 3 + 1] = oy + factor * (cy - oy);
      newPos[v * 3 + 2] = oz + factor * (cz - oz);
    }
    pos.set(newPos);
  };

  for (let it = 0; it < iterations; it++) {
    step(lambda);
    step(mu);
  }

  merged.attributes.position.needsUpdate = true;
  merged.computeVertexNormals();
  return merged;
}

/**
 * Costruisce geometria chiusa/organica da coordinate mondo (già scalate).
 */
export function buildFootSurfaceFromPositions(
  positions: Float32Array,
  pointCount: number,
  options?: Partial<FootSurfaceOptions>
): THREE.BufferGeometry | null {
  const opt = { ...DEFAULT_FOOT_SURFACE_OPTIONS, ...options };
  if (pointCount < 8) return null;

  const stride = pointCount > opt.maxSourcePoints ? Math.ceil(pointCount / opt.maxSourcePoints) : 1;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < pointCount; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const pad = 1e-4;
  const rx = Math.max(maxX - minX, 1e-6);
  const ry = Math.max(maxY - minY, 1e-6);
  const rz = Math.max(maxZ - minZ, 1e-6);

  const dummyMat = new THREE.MeshBasicMaterial({ visible: false });
  const mc = new MarchingCubes(
    opt.resolution,
    dummyMat,
    false,
    false,
    opt.maxPolyCount
  );

  mc.isolation = opt.isolation;
  mc.reset();

  for (let i = 0; i < pointCount; i += stride) {
    const o = i * 3;
    const nx = (positions[o] - minX) / rx;
    const ny = (positions[o + 1] - minY) / ry;
    const nz = (positions[o + 2] - minZ) / rz;
    const px = Math.min(1 - pad, Math.max(pad, nx));
    const py = Math.min(1 - pad, Math.max(pad, ny));
    const pz = Math.min(1 - pad, Math.max(pad, nz));
    mc.addBall(px, py, pz, opt.strength, opt.subtract);
  }

  for (let b = 0; b < opt.fieldBlurPasses; b++) {
    mc.blur(1.15);
  }

  mc.update();

  const raw = mc.geometry.clone();
  dummyMat.dispose();
  mc.geometry.dispose();

  if (!raw.attributes.position || raw.attributes.position.count < 9) {
    raw.dispose();
    return null;
  }

  let geom = laplacianSmoothGeometry(raw, opt.smoothIterations, opt.lambda);
  geom = centerAndNormalizeFootMesh(geom);
  return geom;
}

function computeBoundingBoxFromPoints(positions: Float32Array, count: number): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    box.expandByPoint(v);
  }
  return box;
}

/**
 * Normalizza i punti nello stesso ordine di grandezza della mesh (centro nuvola + scala 0.85/maxDim).
 * Usato per l’intro: target visivo coerente con la forma a nuvola.
 */
export function transformPointPositionsLikeMesh(
  positions: Float32Array,
  count: number
): Float32Array {
  const box = computeBoundingBoxFromPoints(positions, count);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = 0.85 / maxDim;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = (positions[i * 3] - center.x) * scale;
    out[i * 3 + 1] = (positions[i * 3 + 1] - center.y) * scale;
    out[i * 3 + 2] = (positions[i * 3 + 2] - center.z) * scale;
  }
  return out;
}

/**
 * Centra la mesh e scala per adattarla a ~unità visiva (piede ~1 uomo).
 */
export function centerAndNormalizeFootMesh(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return geometry;

  const center = new THREE.Vector3();
  box.getCenter(center);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] -= center.x;
    arr[i + 1] -= center.y;
    arr[i + 2] -= center.z;
  }
  pos.needsUpdate = true;

  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox!.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = 0.85 / maxDim;
  for (let i = 0; i < arr.length; i++) {
    arr[i] *= scale;
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

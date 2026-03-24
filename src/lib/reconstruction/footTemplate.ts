/**
 * Template-based foot reconstruction.
 *
 * Pipeline:
 *  1. extractFootMeasurements   – compute length, width, arch height, volume from point cloud
 *  2. buildTemplateFootGeometry  – generate a clean procedural foot mesh scaled to those measurements
 *  3. smoothTemplateGeometry     – apply Laplacian smoothing to remove any artifacts
 *
 * The base mesh is a parametric surface defined by:
 *  - A spine curve (x-axis: heel→toe) with foot-like plantar curvature
 *  - Cross-section ellipses that vary in width/height along the spine
 *  - A dorsal (top) arch curve
 *  - Toe box rounding at the front
 *
 * This always produces a clean, anatomically plausible result even when
 * the source point cloud is sparse or noisy.
 */

import * as THREE from "three";
import { laplacianSmoothGeometry } from "./footSurfaceMesh";
import type { PointCloud } from "./types";

// ─── Public types ──────────────────────────────────────────────────────────────

export type FootMeasurements = {
  /** Foot length: heel to longest toe (mm) */
  lengthMm: number;
  /** Maximum forefoot width (mm) */
  widthMm: number;
  /** Arch height: maximum vertical offset of arch from ground plane (mm) */
  archHeightMm: number;
  /** Volume estimate used to scale overall thickness (normalised 0..1) */
  volumeNorm: number;
};

export type FootTemplateOptions = {
  /** Circumferential segments around each cross-section ring */
  radialSegments: number;
  /** Segments along the foot length (spine subdivisions) */
  lengthSegments: number;
  /** Laplacian smooth iterations after mesh build */
  smoothIterations: number;
  /** Laplacian λ */
  smoothLambda: number;
};

export const DEFAULT_FOOT_TEMPLATE_OPTIONS: FootTemplateOptions = {
  radialSegments: 28,
  lengthSegments: 52,
  smoothIterations: 4,
  smoothLambda: 0.35,
};

// ─── Step 1: measurement extraction ──────────────────────────────────────────

/**
 * Extract anatomical measurements from a raw point cloud (mm coords).
 * Falls back to average adult foot dimensions when cloud is empty/degenerate.
 */
export function extractFootMeasurements(cloud: PointCloud): FootMeasurements {
  const FALLBACK: FootMeasurements = {
    lengthMm: 265,
    widthMm: 95,
    archHeightMm: 18,
    volumeNorm: 0.5,
  };

  if (!cloud || cloud.pointCount < 20) return FALLBACK;

  const n = cloud.pointCount;
  const pos = cloud.positions;

  // Bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const rangeZ = maxZ - minZ;

  if (rangeX < 1e-3 || rangeY < 1e-3 || rangeZ < 1e-3) return FALLBACK;

  // The longest axis is the foot length
  const dims = [rangeX, rangeY, rangeZ].sort((a, b) => b - a);
  const longestMm = dims[0];
  const midMm = dims[1];
  const shortestMm = dims[2];

  // Clamp to realistic foot dimensions (adult range ±30 %)
  const lengthMm = Math.min(Math.max(longestMm, 180), 350);
  const widthMm = Math.min(Math.max(midMm * 0.9, 60), 130);

  // Arch height: sample points in the medial third of length to find max Y elevation
  // above the ground plane (we treat minY as floor).
  let archHeightMm = 0;
  const floorY = minY;
  const longAxis = rangeX >= rangeY && rangeX >= rangeZ ? 0 : (rangeZ >= rangeY ? 2 : 1);
  const longMin = longAxis === 0 ? minX : (longAxis === 1 ? minY : minZ);
  const longRange = dims[0];

  for (let i = 0; i < n; i++) {
    const lv = (pos[i * 3 + longAxis] - longMin) / longRange;
    if (lv < 0.25 || lv > 0.65) continue; // medial arch region
    const heightAxis = longAxis === 1 ? 0 : 1;
    const ht = pos[i * 3 + heightAxis] - floorY;
    if (ht > archHeightMm) archHeightMm = ht;
  }

  // Fallback arch proportional to length
  if (archHeightMm < 4) archHeightMm = lengthMm * 0.07;

  // Volume normalisation: ratio of filled bounding box
  const bboxVol = rangeX * rangeY * rangeZ;
  const voxelVol = bboxVol / Math.max(n, 1);
  const totalVol = n * voxelVol;
  const volumeNorm = Math.min(1, Math.max(0, totalVol / bboxVol));

  // Scale arch height to realistic range
  const archClamped = Math.min(Math.max(archHeightMm, 8), 35);

  return {
    lengthMm,
    widthMm,
    archHeightMm: archClamped,
    volumeNorm: isFinite(volumeNorm) ? volumeNorm : 0.5,
  };
}

// ─── Step 2: procedural foot mesh ─────────────────────────────────────────────

/**
 * Spine point + cross-section parameters at each longitudinal station.
 */
type SpineStation = {
  /** Normalised position 0 (heel) → 1 (toe tip) */
  t: number;
  /** Position of the spine in normalised foot space */
  cx: number;
  cy: number;
  cz: number;
  /** Half-width of the cross-section ellipse */
  hw: number;
  /** Half-height of the cross-section ellipse */
  hh: number;
  /** Twist angle of the cross-section (radians, for toe splay) */
  twist: number;
};

/**
 * Hermite cubic interpolation (value only).
 */
function hermite(t: number, p0: number, p1: number, m0: number, m1: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p1 +
    (t3 - t2) * m1
  );
}

/**
 * Smooth step 0→1.
 */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Build a clean, smooth foot geometry scaled to measured proportions.
 *
 * Coordinate convention (normalised, ~1 unit long):
 *  +X = lateral (outward right foot)
 *  +Y = dorsal (upward)
 *  +Z = heel → toe (anterior)
 *
 * The geometry is centred at the origin after construction.
 */
export function buildTemplateFootGeometry(
  measurements: FootMeasurements,
  options?: Partial<FootTemplateOptions>
): THREE.BufferGeometry {
  const opt = { ...DEFAULT_FOOT_TEMPLATE_OPTIONS, ...options };

  // Physical scale factors (in normalised units where length = 1)
  const L = 1.0; // normalised foot length = 1
  const W = measurements.widthMm / measurements.lengthMm; // width / length ratio
  const H = (measurements.archHeightMm / measurements.lengthMm) * 3.5; // scaled height
  const thick = 0.10 + 0.08 * measurements.volumeNorm; // dorsoplantar thickness

  // ── Spine curve (heel → toe along Z) ────────────────────────────────────────
  // The spine follows the plantar surface lift:
  //  - heel: ground level
  //  - arch: elevated by arch height
  //  - ball: drops slightly to ground
  //  - toe: slightly elevated again

  const NS = opt.lengthSegments;
  const NR = opt.radialSegments;

  const stations: SpineStation[] = [];

  for (let si = 0; si <= NS; si++) {
    const t = si / NS; // 0 = heel, 1 = toe

    // ── Spine Z (anterior direction) ──
    const cz = t * L;

    // ── Spine Y (height / arch curve) ──
    // Plantar curvature: heel pad, arch rise, metatarsal drop, toe lift
    let cy = 0;
    if (t < 0.12) {
      // heel pad — slightly elevated ball at back
      cy = H * 0.08 * smoothstep(t / 0.12);
    } else if (t < 0.45) {
      // heel to arch
      const u = (t - 0.12) / (0.45 - 0.12);
      cy = H * hermite(u, 0.08, 1.0, 0, 0);
    } else if (t < 0.65) {
      // arch to metatarsal head
      const u = (t - 0.45) / (0.65 - 0.45);
      cy = H * hermite(u, 1.0, 0.18, 0, -1.8);
    } else if (t < 0.85) {
      // metatarsal to ball of toe
      const u = (t - 0.65) / (0.85 - 0.65);
      cy = H * hermite(u, 0.18, 0.05, -1.8, 0);
    } else {
      // toes — slight lift at tip
      const u = (t - 0.85) / 0.15;
      cy = H * 0.05 * (1 + 0.6 * u);
    }

    // ── Spine X (medial/lateral offset) ──
    // Foot has a slight natural outward curve (lateral arch)
    const cx = W * 0.02 * Math.sin(t * Math.PI);

    // ── Cross-section half-width (varies heel→toe) ──
    let hw = 0;
    if (t < 0.08) {
      // narrow heel
      hw = W * 0.22 * smoothstep(t / 0.08);
    } else if (t < 0.18) {
      // heel body
      const u = (t - 0.08) / 0.10;
      hw = W * hermite(u, 0.22, 0.30, 0.5, 0.3);
    } else if (t < 0.60) {
      // midfoot narrows (arch)
      const u = (t - 0.18) / 0.42;
      hw = W * hermite(u, 0.30, 0.26, 0.0, 0.0);
    } else if (t < 0.78) {
      // forefoot widens to ball
      const u = (t - 0.60) / 0.18;
      hw = W * hermite(u, 0.26, 0.38, 0.5, 0.5);
    } else if (t < 0.88) {
      // taper to toes
      const u = (t - 0.78) / 0.10;
      hw = W * hermite(u, 0.38, 0.28, -0.5, -1.0);
    } else {
      // toe convergence
      const u = (t - 0.88) / 0.12;
      hw = W * 0.28 * (1 - u * 0.85);
    }
    hw = Math.max(hw, 0.005);

    // ── Cross-section half-height (dorsoplantar thickness) ──
    let hh = 0;
    if (t < 0.05) {
      hh = thick * 0.40 * smoothstep(t / 0.05);
    } else if (t < 0.20) {
      hh = thick * hermite((t - 0.05) / 0.15, 0.40, 0.80, 1.0, 0.5);
    } else if (t < 0.55) {
      hh = thick * hermite((t - 0.20) / 0.35, 0.80, 0.72, 0.0, 0.0);
    } else if (t < 0.78) {
      hh = thick * hermite((t - 0.55) / 0.23, 0.72, 0.55, 0.0, -1.2);
    } else {
      const u = (t - 0.78) / 0.22;
      hh = thick * 0.55 * (1 - u * 0.80);
    }
    hh = Math.max(hh, 0.005);

    // ── Twist: slight toe splay (hallux valgus tendency) ──
    const twist = t > 0.75 ? (t - 0.75) / 0.25 * 0.15 : 0;

    stations.push({ t, cx, cy, cz, hw, hh, twist });
  }

  // ── Build vertex positions via swept elliptic cross-sections ──────────────

  // Each ring has NR vertices; the body has (NS+1) rings.
  // We also add a heel cap (1 pole vertex at the back) and a toe cap (1 pole at front).
  // Total vertices: 1 + (NS+1)*NR + 1

  const heelPoleIdx = 0;
  const toePoleIdx = 1 + (NS + 1) * NR;
  const totalVerts = toePoleIdx + 1;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);

  // Helper: write position
  const setPos = (idx: number, x: number, y: number, z: number) => {
    positions[idx * 3] = x;
    positions[idx * 3 + 1] = y;
    positions[idx * 3 + 2] = z;
  };

  // Heel pole: first station, centre of the cross-section ring
  const s0 = stations[0];
  setPos(heelPoleIdx, s0.cx, s0.cy, s0.cz - s0.hw * 0.3);

  // Toe pole: last station, tapered centre
  const sLast = stations[NS];
  setPos(toePoleIdx, sLast.cx, sLast.cy, sLast.cz + sLast.hh * 0.2);

  // Body rings
  for (let si = 0; si <= NS; si++) {
    const sta = stations[si];
    // Local tangent (for frame orientation) — finite difference
    const tPrev = si > 0 ? stations[si - 1] : sta;
    const tNext = si < NS ? stations[si + 1] : sta;
    const tanZ = tNext.cz - tPrev.cz;
    const tanY = tNext.cy - tPrev.cy;
    const tanLen = Math.sqrt(tanZ * tanZ + tanY * tanY) || 1;
    const tZ = tanZ / tanLen;
    const tY = tanY / tanLen;

    // Up = dorsal direction (rotated from world Y by tangent)
    // Normal to spine in Y-Z plane
    const upY = tZ;  // tangent.z → up.y
    const upZ = -tY; // -tangent.y → up.z

    for (let ri = 0; ri < NR; ri++) {
      const theta = (ri / NR) * Math.PI * 2 + sta.twist;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Ellipse in cross-section plane:
      //  lateral offset:  cosT → X
      //  dorsal offset:   sinT → (up direction in Y-Z plane)
      // We shape the cross-section to be more realistic:
      //  - bottom (plantar) is flatter
      //  - top (dorsal) is more rounded
      const dorsalBias = sinT > 0 ? 1.0 : 0.7; // plantar is 70 % height
      const ex = sta.hw * cosT;
      const ey = sta.hh * sinT * dorsalBias * upY;
      const ez = sta.hh * sinT * dorsalBias * upZ;

      const vIdx = 1 + si * NR + ri;
      setPos(vIdx, sta.cx + ex, sta.cy + ey, sta.cz + ez);
    }
  }

  // ── Build index buffer ──────────────────────────────────────────────────────

  // Heel cap: heel pole → first ring
  const heelCapTris = NR * 3;
  // Body quads: NS rings × NR quads × 2 tris
  const bodyTris = NS * NR * 2 * 3;
  // Toe cap
  const toeCapTris = NR * 3;
  const totalIndices = heelCapTris + bodyTris + toeCapTris;

  const indices = new Uint32Array(totalIndices);
  let ip = 0;

  const ringBase = (si: number) => 1 + si * NR;

  // Heel cap (winding: pole is behind ring — faces outward towards -Z)
  for (let ri = 0; ri < NR; ri++) {
    const a = ringBase(0) + ri;
    const b = ringBase(0) + (ri + 1) % NR;
    indices[ip++] = heelPoleIdx;
    indices[ip++] = b;
    indices[ip++] = a;
  }

  // Body quads (each quad = two triangles)
  for (let si = 0; si < NS; si++) {
    for (let ri = 0; ri < NR; ri++) {
      const a = ringBase(si) + ri;
      const b = ringBase(si) + (ri + 1) % NR;
      const c = ringBase(si + 1) + ri;
      const d = ringBase(si + 1) + (ri + 1) % NR;
      indices[ip++] = a;
      indices[ip++] = b;
      indices[ip++] = d;
      indices[ip++] = a;
      indices[ip++] = d;
      indices[ip++] = c;
    }
  }

  // Toe cap
  for (let ri = 0; ri < NR; ri++) {
    const a = ringBase(NS) + ri;
    const b = ringBase(NS) + (ri + 1) % NR;
    indices[ip++] = toePoleIdx;
    indices[ip++] = a;
    indices[ip++] = b;
  }

  // ── Assemble BufferGeometry ─────────────────────────────────────────────────

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  // ── Step 3: Laplacian smoothing ─────────────────────────────────────────────
  const smoothed = laplacianSmoothGeometry(geometry, opt.smoothIterations, opt.smoothLambda);

  // ── Centre and scale to visual unit (~0.85 longest dim) ────────────────────
  smoothed.computeBoundingBox();
  const box = smoothed.boundingBox!;
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = 0.85 / maxDim;

  const posAttr = smoothed.attributes.position as THREE.BufferAttribute;
  const posArr = posAttr.array as Float32Array;
  for (let i = 0; i < posArr.length; i += 3) {
    posArr[i] = (posArr[i] - center.x) * scale;
    posArr[i + 1] = (posArr[i + 1] - center.y) * scale;
    posArr[i + 2] = (posArr[i + 2] - center.z) * scale;
  }
  posAttr.needsUpdate = true;
  smoothed.computeVertexNormals();

  return smoothed;
}

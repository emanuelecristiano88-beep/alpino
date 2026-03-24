/**
 * Extract foot parameters from a merged 3D point cloud (PointCloud from reconstruction pipeline).
 *
 * Outputs FootParameters with source = "point_cloud_3d".
 *
 * Algorithm
 * ---------
 * 1. Centroid + PCA to find the Oriented Bounding Box (OBB).
 *    - Largest eigenvector  → longitudinal axis (heel↔toe)
 *    - Second eigenvector   → medio-lateral axis
 *    - Third eigenvector    → dorso-plantar (height)
 * 2. Project all points onto OBB axes → [min,max] extents →
 *    lengthMm, maxWidthMm (at metatarsal zone), heelWidthMm.
 * 3. Arch analysis:
 *    a. Identify the plantar (bottom) surface: points with smallest Y in world frame.
 *    b. Compute navicular height from OBB floor plane.
 *    c. Estimate medial arch angle from three key positions along the axis.
 * 4. Toe analysis from distal 20 % of the point cloud projected on the XY plantar plane.
 *
 * Note: this module reuses `src/lib/reconstruction/pca3.ts` utilities (already in the project).
 */

import {
  covarianceSym3,
  symmetricEigen3Descending,
} from "../reconstruction/pca3";
import type { PointCloud } from "../reconstruction/types";
import type {
  FootParameters,
  FootDimensions,
  ArchAnalysis,
  ArchType,
  ToeAlignment,
  ToeShape,
  ToeRelativeLengths,
} from "./types";

// ---------------------------------------------------------------------------
// OBB helpers
// ---------------------------------------------------------------------------

function cloudCentroid(pos: Float32Array, count: number): [number, number, number] {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < count; i++) {
    sx += pos[i * 3];
    sy += pos[i * 3 + 1];
    sz += pos[i * 3 + 2];
  }
  const inv = 1 / Math.max(1, count);
  return [sx * inv, sy * inv, sz * inv];
}

/** Centre positions in-place (subtract centroid). Returns centroid. */
function centrePositions(pos: Float32Array, count: number): [number, number, number] {
  const [cx, cy, cz] = cloudCentroid(pos, count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] -= cx;
    pos[i * 3 + 1] -= cy;
    pos[i * 3 + 2] -= cz;
  }
  return [cx, cy, cz];
}

type OBBResult = {
  /** Axes col-major 9 floats: [axis0 | axis1 | axis2]. axis0 = longest. */
  axes: Float32Array;
  /** Half-extents in each axis direction (mm). */
  halfExtents: [number, number, number];
  centroid: [number, number, number];
};

function computeOBB(pos: Float32Array, count: number): OBBResult {
  // Work on a copy so we don't mutate the caller's data.
  const work = new Float32Array(pos.subarray(0, count * 3));
  const centroid = centrePositions(work, count);
  const C = covarianceSym3(work, count);
  const { V } = symmetricEigen3Descending(C);

  // Project all points onto each axis, compute extents.
  let e0min = Infinity, e0max = -Infinity;
  let e1min = Infinity, e1max = -Infinity;
  let e2min = Infinity, e2max = -Infinity;

  for (let i = 0; i < count; i++) {
    const x = work[i * 3];
    const y = work[i * 3 + 1];
    const z = work[i * 3 + 2];
    const p0 = x * V[0] + y * V[1] + z * V[2];
    const p1 = x * V[3] + y * V[4] + z * V[5];
    const p2 = x * V[6] + y * V[7] + z * V[8];
    if (p0 < e0min) e0min = p0;
    if (p0 > e0max) e0max = p0;
    if (p1 < e1min) e1min = p1;
    if (p1 > e1max) e1max = p1;
    if (p2 < e2min) e2min = p2;
    if (p2 > e2max) e2max = p2;
  }

  return {
    axes: V,
    halfExtents: [
      (e0max - e0min) / 2,
      (e1max - e1min) / 2,
      (e2max - e2min) / 2,
    ],
    centroid,
  };
}

/** Project a point (relative to centroid) onto an OBB axis. */
function project(
  x: number, y: number, z: number,
  ax: number, ay: number, az: number
): number {
  return x * ax + y * ay + z * az;
}

// ---------------------------------------------------------------------------
// Slice width at a cross-section along axis0
// ---------------------------------------------------------------------------

/**
 * Measure width (extent along axis1) for points within ±bandMm of t along axis0.
 */
function sliceWidth3D(
  pos: Float32Array,
  count: number,
  centroid: [number, number, number],
  V: Float32Array,
  tAlong0: number,
  bandMm: number
): number {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3] - centroid[0];
    const y = pos[i * 3 + 1] - centroid[1];
    const z = pos[i * 3 + 2] - centroid[2];
    const p0 = project(x, y, z, V[0], V[1], V[2]);
    if (Math.abs(p0 - tAlong0) > bandMm) continue;
    const p1 = project(x, y, z, V[3], V[4], V[5]);
    if (p1 < mn) mn = p1;
    if (p1 > mx) mx = p1;
  }
  return isFinite(mn) ? mx - mn : 0;
}

// ---------------------------------------------------------------------------
// Arch analysis
// ---------------------------------------------------------------------------

/**
 * Find navicular height: the maximum height (axis2) of points in the medial-midfoot zone.
 * Zone: 40–60 % of length from heel, medial half of width.
 */
function computeNavicularHeight(
  pos: Float32Array,
  count: number,
  centroid: [number, number, number],
  V: Float32Array,
  footLength: number,
  e0min: number
): number {
  const zoneStart = e0min + 0.40 * footLength;
  const zoneEnd = e0min + 0.60 * footLength;
  const bandMm = footLength * 0.12;
  let maxHeight = -Infinity;

  for (let i = 0; i < count; i++) {
    const x = pos[i * 3] - centroid[0];
    const y = pos[i * 3 + 1] - centroid[1];
    const z = pos[i * 3 + 2] - centroid[2];
    const p0 = project(x, y, z, V[0], V[1], V[2]);
    if (p0 < zoneStart || p0 > zoneEnd) continue;
    // Medial half: negative axis1 by convention (medial side)
    const p1 = project(x, y, z, V[3], V[4], V[5]);
    if (p1 > bandMm) continue;
    const p2 = project(x, y, z, V[6], V[7], V[8]);
    if (p2 > maxHeight) maxHeight = p2;
  }
  return isFinite(maxHeight) ? maxHeight : -1;
}

/**
 * Medial arch angle (degrees) from three landmarks along the arch curve:
 *   - Heel:        t = 0.15 × L from heel on axis0, plantar surface (min axis2 in that zone)
 *   - Navicular:   t = 0.45 × L, max axis2 in medial strip
 *   - 1st metatarsal head: t = 0.35 × L from heel, plantar
 *
 * Returns −1 when insufficient data.
 */
function computeArchAngle(
  pos: Float32Array,
  count: number,
  centroid: [number, number, number],
  V: Float32Array,
  footLength: number,
  e0min: number
): number {
  // Sample three positions along axis0
  const tHeel = e0min + 0.15 * footLength;
  const tNav = e0min + 0.45 * footLength;
  const tMeta = e0min + 0.35 * footLength;
  const bandMm = footLength * 0.06;

  const heightAtT = (targetT: number): number => {
    let mx = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = pos[i * 3] - centroid[0];
      const y = pos[i * 3 + 1] - centroid[1];
      const z = pos[i * 3 + 2] - centroid[2];
      const p0 = project(x, y, z, V[0], V[1], V[2]);
      if (Math.abs(p0 - targetT) > bandMm) continue;
      const p2 = project(x, y, z, V[6], V[7], V[8]);
      if (p2 > mx) mx = p2;
    }
    return isFinite(mx) ? mx : NaN;
  };

  const hHeel = heightAtT(tHeel);
  const hNav = heightAtT(tNav);
  const hMeta = heightAtT(tMeta);

  if (isNaN(hHeel) || isNaN(hNav) || isNaN(hMeta)) return -1;

  // Vectors from navicular to heel and navicular to metatarsal
  const AX = tHeel - tNav;
  const AY = hHeel - hNav;
  const BX = tMeta - tNav;
  const BY = hMeta - hNav;
  const dot = AX * BX + AY * BY;
  const magA = Math.sqrt(AX * AX + AY * AY);
  const magB = Math.sqrt(BX * BX + BY * BY);
  if (magA < 1e-3 || magB < 1e-3) return -1;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magA * magB)));
  return (Math.acos(cosAngle) * 180) / Math.PI;
}

function archTypeFromCSIAndAngle(csi: number, angleDeg: number): ArchType {
  if (csi >= 0) {
    if (csi >= 45) return "flat";
    if (csi < 30) return "high";
    return "normal";
  }
  // Fallback: arch angle classification (normal arch ~130–160 °, flat > 160 °, high < 130 °)
  if (angleDeg < 0) return "normal";
  if (angleDeg > 160) return "flat";
  if (angleDeg < 130) return "high";
  return "normal";
}

// ---------------------------------------------------------------------------
// Toe detection from 3D cloud (top-view projection)
// ---------------------------------------------------------------------------

function detectToeTips3D(
  pos: Float32Array,
  count: number,
  centroid: [number, number, number],
  V: Float32Array,
  footLength: number,
  e0min: number
): number[] {
  // Distal zone: last 22 % of length
  const toeStart = e0min + 0.78 * footLength;
  const toeEnd = e0min + footLength;
  const toePts: [number, number][] = [];

  for (let i = 0; i < count; i++) {
    const x = pos[i * 3] - centroid[0];
    const y = pos[i * 3 + 1] - centroid[1];
    const z = pos[i * 3 + 2] - centroid[2];
    const p0 = project(x, y, z, V[0], V[1], V[2]);
    if (p0 < toeStart || p0 > toeEnd) continue;
    const p1 = project(x, y, z, V[3], V[4], V[5]);
    toePts.push([p0, p1]);
  }

  if (toePts.length < 10) return [];

  // Build bucket profile along axis1 (medial-lateral), record max axis0 in each bucket
  let mnP1 = Infinity;
  let mxP1 = -Infinity;
  for (const [, p1] of toePts) {
    if (p1 < mnP1) mnP1 = p1;
    if (p1 > mxP1) mxP1 = p1;
  }
  const BUCKETS = 20;
  const bw = (mxP1 - mnP1) / BUCKETS;
  if (bw < 0.1) return [];

  const maxP0: (number | null)[] = new Array(BUCKETS).fill(null);
  for (const [p0, p1] of toePts) {
    const b = Math.min(BUCKETS - 1, Math.floor((p1 - mnP1) / bw));
    if (maxP0[b] === null || p0 > (maxP0[b] as number)) {
      maxP0[b] = p0;
    }
  }

  // Detect local maxima = toe protrusion peaks
  const tips: number[] = [];
  for (let i = 1; i < BUCKETS - 1; i++) {
    const cur = maxP0[i];
    const prev = maxP0[i - 1];
    const next = maxP0[i + 1];
    if (cur === null) continue;
    const pv = prev ?? cur - 1;
    const nx = next ?? cur - 1;
    if (cur > pv && cur > nx) {
      tips.push(cur - toeStart);
    }
  }
  return tips;
}

function mapToFiveToes3D(sortedTips: number[]): ToeRelativeLengths {
  const get = (i: number): number => {
    if (i < sortedTips.length) return Math.max(0, sortedTips[i]);
    const prev = i > 0 ? get(i - 1) : 0;
    return Math.max(0, prev * 0.96);
  };
  return { t1: get(0), t2: get(1), t3: get(2), t4: get(3), t5: get(4) };
}

function classifyToeShape(rel: ToeRelativeLengths): ToeShape {
  const { t1, t2, t3, t4, t5 } = rel;
  const max = Math.max(t1, t2, t3, t4, t5);
  if (max < 1e-3) return "egyptian";
  const n1 = t1 / max;
  const n2 = t2 / max;
  const n3 = t3 / max;
  if (n2 > n1 + 0.05) return "greek";
  const spread = Math.max(n1, n2, n3) - Math.min(n1, n2, n3);
  if (spread < 0.10) return "roman";
  return "egyptian";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract foot parameters from a 3D point cloud produced by the reconstruction pipeline.
 *
 * @param cloud PointCloud with positions Float32Array (xyz interleaved, mm) and pointCount.
 */
export function extractFootParametersFromPointCloud(
  cloud: PointCloud
): FootParameters {
  const warnings: string[] = [];
  const { positions, pointCount: count } = cloud;

  if (count < 20) {
    warnings.push("Point cloud has fewer than 20 points; results are unreliable.");
  }

  // ---- OBB -----------------------------------------------------------------
  const obb = computeOBB(positions, count);
  const { axes: V, halfExtents, centroid } = obb;

  // The three half-extents: sort descending to assign semantic axes.
  // PCA already returns axes in descending eigenvalue order so:
  //   V col0 = longest   → longitudinal (heel-toe)
  //   V col1 = medium    → medial-lateral (width)
  //   V col2 = smallest  → dorso-plantar (height)
  const footLength = 2 * halfExtents[0];
  const footWidth  = 2 * halfExtents[1];

  // Get the actual min/max along axis0 so we can position slices
  let e0min = Infinity;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3] - centroid[0];
    const y = positions[i * 3 + 1] - centroid[1];
    const z = positions[i * 3 + 2] - centroid[2];
    const p0 = project(x, y, z, V[0], V[1], V[2]);
    if (p0 < e0min) e0min = p0;
  }

  const bandMm = Math.max(4, footLength * 0.04);

  // Widths at fractions along longitudinal axis (relative to centred frame)
  const tMeta = e0min + 0.38 * footLength;
  const tMid  = e0min + 0.57 * footLength;
  const tHeel = e0min + 0.85 * footLength;

  const metaWidthMm  = sliceWidth3D(positions, count, centroid, V, tMeta, bandMm);
  const midWidthMm   = sliceWidth3D(positions, count, centroid, V, tMid,  bandMm);
  const heelWidthMm  = sliceWidth3D(positions, count, centroid, V, tHeel, bandMm);

  const maxWidthMm     = Math.max(metaWidthMm, footWidth);
  const midfootWidthMm = midWidthMm;

  // ---- Arch ----------------------------------------------------------------
  const navH      = computeNavicularHeight(positions, count, centroid, V, footLength, e0min);
  const archAngle = computeArchAngle(positions, count, centroid, V, footLength, e0min);

  // 2D CSI not available from pure 3D cloud without a plantar mask — approximate from midfoot/meta
  const csi = maxWidthMm > 0 ? (midfootWidthMm / maxWidthMm) * 100 : -1;
  const archType = archTypeFromCSIAndAngle(csi, archAngle);

  // ---- Toes ----------------------------------------------------------------
  const tipRaw = detectToeTips3D(positions, count, centroid, V, footLength, e0min);
  const sortedTips = [...tipRaw].sort((a, b) => b - a);
  const tipPosMm = mapToFiveToes3D(sortedTips);
  const maxTipMm = Math.max(tipPosMm.t1, tipPosMm.t2, tipPosMm.t3, tipPosMm.t4, tipPosMm.t5, 1);
  const relLengths: ToeRelativeLengths = {
    t1: tipPosMm.t1 / maxTipMm,
    t2: tipPosMm.t2 / maxTipMm,
    t3: tipPosMm.t3 / maxTipMm,
    t4: tipPosMm.t4 / maxTipMm,
    t5: tipPosMm.t5 / maxTipMm,
  };
  const toeConf = tipRaw.length >= 3 ? 0.7 : tipRaw.length >= 1 ? 0.45 : 0.2;
  if (tipRaw.length < 3) {
    warnings.push(
      `Only ${tipRaw.length} toe lobe(s) detected in point cloud. Toe shape classification may be inaccurate.`
    );
  }
  const toeShape = classifyToeShape(relLengths);

  // ---- Assemble ------------------------------------------------------------
  const dimensions: FootDimensions = {
    lengthMm: footLength,
    maxWidthMm,
    midfootWidthMm,
    heelWidthMm,
    ballGirthMm: Math.PI * maxWidthMm,
  };

  const arch: ArchAnalysis = {
    csi,
    archAngleDeg: archAngle,
    navicularHeightMm: navH,
    archType,
  };

  const toes: ToeAlignment = {
    relativeLengths: relLengths,
    tipPositionsMm: tipPosMm,
    toeShape,
    confidence: toeConf,
  };

  let quality = 1.0;
  if (count < 100) quality -= 0.3;
  else if (count < 500) quality -= 0.15;
  if (maxWidthMm < 1) quality -= 0.3;
  if (tipRaw.length < 2) quality -= 0.2;
  quality = Math.max(0, Math.min(1, quality));

  return {
    schema: "neuma.foot-parameters.v1",
    source: "point_cloud_3d",
    dimensions,
    arch,
    toes,
    qualityScore: quality,
    extractedAt: new Date().toISOString(),
    warnings,
  };
}

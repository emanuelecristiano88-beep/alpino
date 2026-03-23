/**
 * Lightweight multi-view point cloud alignment (no ICP):
 * per view — centroid + uniform scale + PCA basis from reference view;
 * optional 2–3 pooled PCA refinements to reduce residual twist/scale drift.
 */

import {
  covarianceSym3,
  symmetricEigen3Descending,
  transformPositionsInPlace,
  pcaRotationMatrix3,
} from "./pca3";

export type PerViewCloud = {
  positions: Float32Array;
  colors?: Uint8Array;
  count: number;
};

function centroid(positions: Float32Array, count: number): [number, number, number] {
  if (count === 0) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    sx += positions[o];
    sy += positions[o + 1];
    sz += positions[o + 2];
  }
  const inv = 1 / count;
  return [sx * inv, sy * inv, sz * inv];
}

function centerInPlace(positions: Float32Array, count: number, cx: number, cy: number, cz: number): void {
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    positions[o] -= cx;
    positions[o + 1] -= cy;
    positions[o + 2] -= cz;
  }
}

function maxBBoxDim(positions: Float32Array, count: number): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
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
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
}

function scaleInPlace(positions: Float32Array, count: number, s: number): void {
  const inv = 1 / s;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    positions[o] *= inv;
    positions[o + 1] *= inv;
    positions[o + 2] *= inv;
  }
}

function globalMaxBBoxDim(clouds: PerViewCloud[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const c of clouds) {
    for (let i = 0; i < c.count; i++) {
      const o = i * 3;
      const x = c.positions[o];
      const y = c.positions[o + 1];
      const z = c.positions[o + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
}

function concatPositions(clouds: PerViewCloud[]): { buf: Float32Array; total: number } {
  let total = 0;
  for (const c of clouds) total += c.count;
  const buf = new Float32Array(total * 3);
  let off = 0;
  for (const c of clouds) {
    buf.set(c.positions.subarray(0, c.count * 3), off);
    off += c.count * 3;
  }
  return { buf, total };
}

export type MultiViewAlignOptions = {
  /** Vista di riferimento per la base PCA iniziale (dopo centroide + scala per vista). */
  referenceCloudIndex: number;
  /** Passate di raffinamento globale (pooled centroid + scale + PCA), 0–3. */
  refinementIterations: number;
};

const DEFAULT_ALIGN: MultiViewAlignOptions = {
  referenceCloudIndex: 0,
  refinementIterations: 3,
};

/**
 * Allinea più nuvole in un frame comune approssimato (veloce, senza ICP).
 */
export function alignPointCloudsMultiView(
  clouds: PerViewCloud[],
  options?: Partial<MultiViewAlignOptions>
): PerViewCloud[] {
  const opt = { ...DEFAULT_ALIGN, ...options };
  if (clouds.length === 0) return [];

  const refIdx = Math.min(Math.max(0, opt.referenceCloudIndex | 0), clouds.length - 1);
  const refinementIters = Math.min(3, Math.max(0, opt.refinementIterations | 0));

  const work: PerViewCloud[] = clouds.map((c) => ({
    positions: new Float32Array(c.positions),
    colors: c.colors,
    count: c.count,
  }));

  /** Per vista: centroid → scala unitaria (max lato bbox) */
  for (let i = 0; i < work.length; i++) {
    const { positions, count } = work[i];
    if (count === 0) continue;
    const [cx, cy, cz] = centroid(positions, count);
    centerInPlace(positions, count, cx, cy, cz);
    const s = maxBBoxDim(positions, count);
    scaleInPlace(positions, count, s);
  }

  /** PCA sulla sola nuvola di riferimento (assi principali del piede in quella vista) */
  const ref = work[refIdx];
  let Vref: Float32Array;
  if (ref.count < 4) {
    Vref = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  } else {
    Vref = pcaRotationMatrix3(ref.positions, ref.count);
  }

  /** Stessa rotazione per tutte le viste → frame comune */
  for (let i = 0; i < work.length; i++) {
    const { positions, count } = work[i];
    if (count === 0) continue;
    transformPositionsInPlace(positions, count, Vref);
  }

  /** Raffinamento: pooled centroid + scala globale + PCA (2–3 iterazioni max) */
  for (let iter = 0; iter < refinementIters; iter++) {
    const { buf, total } = concatPositions(work);
    if (total < 4) break;

    const [gx, gy, gz] = centroid(buf, total);
    for (const c of work) {
      centerInPlace(c.positions, c.count, gx, gy, gz);
    }

    const gs = globalMaxBBoxDim(work);
    for (const c of work) {
      scaleInPlace(c.positions, c.count, gs);
    }

    const { buf: buf2, total: total2 } = concatPositions(work);
    const C = covarianceSym3(buf2, total2);
    const { V: Vg } = symmetricEigen3Descending(C);

    for (const c of work) {
      if (c.count === 0) continue;
      transformPositionsInPlace(c.positions, c.count, Vg);
    }
  }

  return work;
}

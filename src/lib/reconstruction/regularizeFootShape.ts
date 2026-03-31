import type { FootShapeRegularizeOptions, PointCloud } from "./types";
import { computeBoundingBox } from "./footMetrics";
import { neighborAverageSmoothing } from "./cleanPointCloud";

function cellKey(x: number, y: number, z: number, inv: number): string {
  return `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)}`;
}

function medianSorted(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) * 0.5;
}

/** Indice asse con estensione minima nel bbox (spessore piede approssimato). */
function thinnestAxisIndex(
  positions: Float32Array,
  count: number
): 0 | 1 | 2 {
  const bbox = computeBoundingBox(positions, count);
  const dx = Math.max(0, bbox.max.x - bbox.min.x);
  const dy = Math.max(0, bbox.max.y - bbox.min.y);
  const dz = Math.max(0, bbox.max.z - bbox.min.z);
  if (dx <= dy && dx <= dz) return 0;
  if (dy <= dz) return 1;
  return 2;
}

/**
 * Riduce picchi estremi: se un punto è troppo lontano dal centroide dei vicini,
 * viene tirato verso il centroide fino a un raggio massimo (shell clamp).
 */
export function clampSpikesTowardNeighborCentroid(
  positions: Float32Array,
  count: number,
  searchRadiusMm: number,
  maxNeighbors: number,
  /** max distanza dal centroide = max(minClampMm, relative * diagonal bbox) */
  maxDeviationRelativeToDiagonal: number,
  minClampMm: number
): Float32Array {
  if (count === 0) return positions;
  const bbox = computeBoundingBox(positions, count);
  const dx = bbox.max.x - bbox.min.x;
  const dy = bbox.max.y - bbox.min.y;
  const dz = bbox.max.z - bbox.min.z;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const maxD = Math.max(minClampMm, maxDeviationRelativeToDiagonal * diag);

  const inv = 1 / Math.max(searchRadiusMm, 1e-6);
  const r2 = searchRadiusMm * searchRadiusMm;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const k = cellKey(positions[o], positions[o + 1], positions[o + 2], inv);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(i);
  }

  const out = new Float32Array(count * 3);
  const tmp: { j: number; d: number }[] = [];

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    let x = positions[o];
    let y = positions[o + 1];
    let z = positions[o + 2];
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    tmp.length = 0;
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        for (let gz = -1; gz <= 1; gz++) {
          const arr = buckets.get(`${cx + gx},${cy + gy},${cz + gz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const oj = j * 3;
            const ddx = positions[oj] - x;
            const ddy = positions[oj + 1] - y;
            const ddz = positions[oj + 2] - z;
            const dd = ddx * ddx + ddy * ddy + ddz * ddz;
            if (dd <= r2 && dd > 1e-12) tmp.push({ j, d: Math.sqrt(dd) });
          }
        }
      }
    }

    if (tmp.length === 0) {
      out[o] = x;
      out[o + 1] = y;
      out[o + 2] = z;
      continue;
    }
    tmp.sort((a, b) => a.d - b.d);
    const kUse = Math.min(maxNeighbors, tmp.length);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let t = 0; t < kUse; t++) {
      const j = tmp[t]!.j;
      const oj = j * 3;
      sx += positions[oj];
      sy += positions[oj + 1];
      sz += positions[oj + 2];
    }
    const ik = 1 / kUse;
    const mx = sx * ik;
    const my = sy * ik;
    const mz = sz * ik;
    let vx = x - mx;
    let vy = y - my;
    let vz = z - mz;
    const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (dist > maxD && dist > 1e-9) {
      const s = maxD / dist;
      x = mx + vx * s;
      y = my + vy * s;
      z = mz + vz * s;
    }
    out[o] = x;
    out[o + 1] = y;
    out[o + 2] = z;
  }

  return out;
}

/**
 * Limita variazioni “di spessore” lungo l’asse più sottile del bbox: vicini → mediana locale,
 * poi clamp a ±maxDev rispetto alla mediana.
 */
export function clampLocalDepthAlongThinAxis(
  positions: Float32Array,
  count: number,
  searchRadiusMm: number,
  maxNeighbors: number,
  axis: 0 | 1 | 2,
  maxDeviationMm: number
): Float32Array {
  if (count === 0) return positions;
  const inv = 1 / Math.max(searchRadiusMm, 1e-6);
  const r2 = searchRadiusMm * searchRadiusMm;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const k = cellKey(positions[o], positions[o + 1], positions[o + 2], inv);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(i);
  }

  const out = new Float32Array(count * 3);
  const coords: number[] = [];

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    coords.length = 0;
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        for (let gz = -1; gz <= 1; gz++) {
          const arr = buckets.get(`${cx + gx},${cy + gy},${cz + gz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const oj = j * 3;
            const ddx = positions[oj] - x;
            const ddy = positions[oj + 1] - y;
            const ddz = positions[oj + 2] - z;
            const dd = ddx * ddx + ddy * ddy + ddz * ddz;
            if (dd <= r2) {
              coords.push(positions[oj + axis]);
            }
          }
        }
      }
    }

    let nx = x;
    let ny = y;
    let nz = z;
    let coord = axis === 0 ? x : axis === 1 ? y : z;
    if (coords.length > 0) {
      const med = medianSorted(coords);
      const lo = med - maxDeviationMm;
      const hi = med + maxDeviationMm;
      if (coord < lo) coord = lo;
      else if (coord > hi) coord = hi;
    }
    if (axis === 0) nx = coord;
    else if (axis === 1) ny = coord;
    else nz = coord;

    out[o] = nx;
    out[o + 1] = ny;
    out[o + 2] = nz;
  }

  return out;
}

export const DEFAULT_FOOT_SHAPE_REGULARIZE_OPTIONS: FootShapeRegularizeOptions = {
  spikeClamp: true,
  spikeSearchRadiusMm: 5,
  spikeMaxNeighbors: 22,
  // Spike clamp più aggressivo per evitare "punte" fuori scala.
  spikeMaxDeviationFromDiagonal: 0.028,
  spikeMinClampMm: 3.0,

  depthClamp: true,
  depthSearchRadiusMm: 4.5,
  depthMaxNeighbors: 24,
  thinAxis: "auto",
  // Clamp più stretto della variazione di profondità lungo l'asse sottile.
  maxDepthDeviationMm: 4.0,
  maxDepthDeviationRelativeToThinExtent: 0.13,
  maxDepthDeviationCapMm: 8.0,

  // Smoothing extra leggero (numero passate + blend) per superfici più continue.
  surfaceSmoothPasses: 3,
  surfaceSmoothRadiusMm: 5.5,
  surfaceSmoothK: 20,
  surfaceSmoothBlend: 0.22,
};

/**
 * Regolarizza forma piede dopo pulizia: picchi → clamp locale, profondità realistica,
 * smoothing continuo (riduce spigoli).
 */
export function regularizeFootPointCloud(
  cloud: PointCloud,
  opt: Partial<FootShapeRegularizeOptions> = {}
): PointCloud {
  const o = { ...DEFAULT_FOOT_SHAPE_REGULARIZE_OPTIONS, ...opt };
  const count = cloud.pointCount;
  if (count === 0) return cloud;

  let positions = cloud.positions;
  const colors = cloud.colors;

  if (o.spikeClamp) {
    positions = clampSpikesTowardNeighborCentroid(
      positions,
      count,
      o.spikeSearchRadiusMm,
      o.spikeMaxNeighbors,
      o.spikeMaxDeviationFromDiagonal,
      o.spikeMinClampMm
    );
  }

  if (o.depthClamp) {
    const bbox = computeBoundingBox(positions, count);
    const dx = bbox.max.x - bbox.min.x;
    const dy = bbox.max.y - bbox.min.y;
    const dz = bbox.max.z - bbox.min.z;
    const extents = [dx, dy, dz];
    const thin =
      o.thinAxis === "auto"
        ? thinnestAxisIndex(positions, count)
        : (o.thinAxis as 0 | 1 | 2);
    const thinExtent = extents[thin] || 1;
    let maxDev = Math.min(
      o.maxDepthDeviationCapMm,
      Math.max(
        o.maxDepthDeviationMm,
        o.maxDepthDeviationRelativeToThinExtent * thinExtent
      )
    );
    maxDev = Math.min(maxDev, thinExtent * 0.45);

    positions = clampLocalDepthAlongThinAxis(
      positions,
      count,
      o.depthSearchRadiusMm,
      o.depthMaxNeighbors,
      thin,
      maxDev
    );
  }

  const passes = Math.max(0, Math.min(6, o.surfaceSmoothPasses | 0));
  for (let p = 0; p < passes; p++) {
    positions = neighborAverageSmoothing(
      positions,
      count,
      o.surfaceSmoothRadiusMm,
      o.surfaceSmoothK,
      o.surfaceSmoothBlend
    );
  }

  return {
    positions,
    colors,
    pointCount: count,
  };
}

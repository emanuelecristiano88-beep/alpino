import type { PointCloud } from "./types";

function cellKey(x: number, y: number, z: number, inv: number): string {
  return `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)}`;
}

/**
 * Rimuove punti isolati: meno di `minNeighbors` entro `radiusMm` (hash spaziale, cella = raggio).
 */
export function radiusOutlierRemoval(
  positions: Float32Array,
  count: number,
  radiusMm: number,
  minNeighbors: number,
  colors?: Uint8Array
): { positions: Float32Array; colors?: Uint8Array; count: number } {
  if (count === 0) return { positions, colors, count: 0 };
  const inv = 1 / Math.max(radiusMm, 1e-6);
  const r2 = radiusMm * radiusMm;
  const buckets = new Map<string, number[]>();

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    const k = cellKey(x, y, z, inv);
    let arr = buckets.get(k);
    if (!arr) {
      arr = [];
      buckets.set(k, arr);
    }
    arr.push(i);
  }

  const keep = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    let neigh = 0;
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          const arr = buckets.get(key);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const oj = j * 3;
            const ddx = positions[oj] - x;
            const ddy = positions[oj + 1] - y;
            const ddz = positions[oj + 2] - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) neigh++;
            if (neigh >= minNeighbors) break outer;
          }
        }
      }
    }
    if (neigh >= minNeighbors) keep[i] = 1;
  }

  let outCount = 0;
  for (let i = 0; i < count; i++) if (keep[i]) outCount++;
  const out = new Float32Array(outCount * 3);
  const outColors = colors ? new Uint8Array(outCount * 3) : undefined;
  let w = 0;
  for (let i = 0; i < count; i++) {
    if (!keep[i]) continue;
    const o = i * 3;
    out[w] = positions[o];
    out[w + 1] = positions[o + 1];
    out[w + 2] = positions[o + 2];
    if (outColors && colors) {
      outColors[w] = colors[o];
      outColors[w + 1] = colors[o + 1];
      outColors[w + 2] = colors[o + 2];
    }
    w += 3;
  }
  return { positions: out, colors: outColors, count: outCount };
}

/**
 * Outlier statistico: distanza media ai k vicini più vicini entro raggio; scarta sopra media + std·moltiplicatore.
 */
export function statisticalOutlierRemoval(
  positions: Float32Array,
  count: number,
  radiusMm: number,
  kNeighbors: number,
  stdMultiplier: number,
  colors?: Uint8Array
): { positions: Float32Array; colors?: Uint8Array; count: number } {
  if (count < kNeighbors + 2) {
    return { positions, colors, count };
  }
  const inv = 1 / Math.max(radiusMm, 1e-6);
  const r2 = radiusMm * radiusMm;
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

  const meanDist = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    const dists: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!arr) continue;
          for (const j of arr) {
            if (j === i) continue;
            const oj = j * 3;
            const ddx = positions[oj] - x;
            const ddy = positions[oj + 1] - y;
            const ddz = positions[oj + 2] - z;
            const dd = ddx * ddx + ddy * ddy + ddz * ddz;
            if (dd <= r2 && dd > 1e-12) dists.push(Math.sqrt(dd));
          }
        }
      }
    }
    dists.sort((a, b) => a - b);
    let s = 0;
    const kk = Math.min(kNeighbors, dists.length);
    for (let t = 0; t < kk; t++) s += dists[t];
    meanDist[i] = kk > 0 ? s / kk : 1e6;
  }

  let m = 0;
  for (let i = 0; i < count; i++) m += meanDist[i];
  m /= count;
  let v = 0;
  for (let i = 0; i < count; i++) {
    const d = meanDist[i] - m;
    v += d * d;
  }
  const sigma = Math.sqrt(v / Math.max(count - 1, 1));
  const thr = m + stdMultiplier * sigma;

  let outCount = 0;
  for (let i = 0; i < count; i++) if (meanDist[i] <= thr) outCount++;
  const out = new Float32Array(outCount * 3);
  const outColors = colors ? new Uint8Array(outCount * 3) : undefined;
  let wi = 0;
  for (let i = 0; i < count; i++) {
    if (meanDist[i] > thr) continue;
    const o = i * 3;
    out[wi] = positions[o];
    out[wi + 1] = positions[o + 1];
    out[wi + 2] = positions[o + 2];
    if (outColors && colors) {
      outColors[wi] = colors[o];
      outColors[wi + 1] = colors[o + 1];
      outColors[wi + 2] = colors[o + 2];
    }
    wi += 3;
  }
  return { positions: out, colors: outColors, count: outCount };
}

/** Mantiene solo voxel connessi al cluster più grande (26-vicini tra celle adiacenti). */
export function keepLargestVoxelCluster(
  positions: Float32Array,
  count: number,
  voxelSizeMm: number,
  colors?: Uint8Array
): { positions: Float32Array; colors?: Uint8Array; count: number } {
  if (count === 0) return { positions, colors, count: 0 };
  const inv = 1 / Math.max(voxelSizeMm, 1e-6);
  const voxelCounts = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const k = cellKey(positions[o], positions[o + 1], positions[o + 2], inv);
    let arr = voxelCounts.get(k);
    if (!arr) {
      arr = [];
      voxelCounts.set(k, arr);
    }
    arr.push(i);
  }

  let bestSize = 0;
  let bestKeys: string[] = [];
  const seen = new Set<string>();

  for (const start of voxelCounts.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const q: string[] = [start];
    seen.add(start);
    let qi = 0;
    while (qi < q.length) {
      const cur = q[qi++]!;
      comp.push(cur);
      const [vx, vy, vz] = cur.split(",").map(Number);
      for (const d of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const nk = `${vx + d[0]},${vy + d[1]},${vz + d[2]}`;
        if (seen.has(nk) || !voxelCounts.has(nk)) continue;
        seen.add(nk);
        q.push(nk);
      }
    }
    let sz = 0;
    for (const key of comp) sz += voxelCounts.get(key)!.length;
    if (sz > bestSize) {
      bestSize = sz;
      bestKeys = comp;
    }
  }

  let outCount = 0;
  for (const k of bestKeys) outCount += voxelCounts.get(k)!.length;
  const out = new Float32Array(outCount * 3);
  const outColors = colors ? new Uint8Array(outCount * 3) : undefined;
  let w = 0;
  for (const k of bestKeys) {
    for (const i of voxelCounts.get(k)!) {
      const o = i * 3;
      out[w] = positions[o];
      out[w + 1] = positions[o + 1];
      out[w + 2] = positions[o + 2];
      if (outColors && colors) {
        outColors[w] = colors[o];
        outColors[w + 1] = colors[o + 1];
        outColors[w + 2] = colors[o + 2];
      }
      w += 3;
    }
  }
  return { positions: out, colors: outColors, count: outCount };
}

/**
 * Smoothing leggero: ogni punto si sposta verso il centroide dei vicini entro `searchRadiusMm` (max `maxNeighbors`).
 */
export function neighborAverageSmoothing(
  positions: Float32Array,
  count: number,
  searchRadiusMm: number,
  maxNeighbors: number,
  blend: number
): Float32Array {
  if (count === 0) return positions;
  const inv = 1 / Math.max(searchRadiusMm, 1e-6);
  const r2 = searchRadiusMm * searchRadiusMm;
  const b = Math.min(1, Math.max(0, blend));
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
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    tmp.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
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
    const invK = 1 / kUse;
    const mx = sx * invK;
    const my = sy * invK;
    const mz = sz * invK;
    out[o] = x + b * (mx - x);
    out[o + 1] = y + b * (my - y);
    out[o + 2] = z + b * (mz - z);
  }

  return out;
}

/** Media su griglia voxel (downsample + smoothing). */
export function voxelSmoothing(
  positions: Float32Array,
  count: number,
  voxelSizeMm: number,
  colors?: Uint8Array
): PointCloud {
  type Acc = { sx: number; sy: number; sz: number; n: number; cr: number; cg: number; cb: number; cn: number };
  const map = new Map<string, Acc>();
  const inv = 1 / Math.max(voxelSizeMm, 1e-6);

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    const k = cellKey(x, y, z, inv);
    let a = map.get(k);
    if (!a) {
      a = { sx: 0, sy: 0, sz: 0, n: 0, cr: 0, cg: 0, cb: 0, cn: 0 };
      map.set(k, a);
    }
    a.sx += x;
    a.sy += y;
    a.sz += z;
    a.n += 1;
    if (colors) {
      a.cr += colors[o];
      a.cg += colors[o + 1];
      a.cb += colors[o + 2];
      a.cn += 1;
    }
  }

  const nOut = map.size;
  const pos = new Float32Array(nOut * 3);
  const col = new Uint8Array(nOut * 3);
  let j = 0;
  for (const a of map.values()) {
    pos[j * 3] = a.sx / a.n;
    pos[j * 3 + 1] = a.sy / a.n;
    pos[j * 3 + 2] = a.sz / a.n;
    if (a.cn > 0) {
      col[j * 3] = Math.round(a.cr / a.cn);
      col[j * 3 + 1] = Math.round(a.cg / a.cn);
      col[j * 3 + 2] = Math.round(a.cb / a.cn);
    } else {
      col[j * 3] = 180;
      col[j * 3 + 1] = 180;
      col[j * 3 + 2] = 190;
    }
    j++;
  }

  return { positions: pos, colors: col, pointCount: nOut };
}

export type CleanPointCloudOptions = {
  radiusOutlierMm: number;
  minNeighbors: number;
  statisticalRadiusMm: number;
  statisticalK: number;
  statisticalStd: number;
  clusterVoxelMm: number;
  /** > 0: downsampling voxel finale (opzionale). 0 = solo smoothing sui vicini. */
  smoothVoxelMm: number;
  /** Raggio ricerca vicini per smoothing (mm). */
  neighborSearchRadiusMm: number;
  /** Numero massimo di vicini da mediare. */
  neighborSmoothK: number;
  /** 0–1: quanto tirare verso il centroide dei vicini (consigliato 0.25–0.4). */
  neighborSmoothBlend: number;
  /** Seconda passata vicini (ancora più morbida). 0 = disabilitata. */
  neighborSecondPassBlend: number;
};

export const DEFAULT_CLEAN_OPTIONS: CleanPointCloudOptions = {
  // Outlier removal: conservativo (evita di erodere dettagli sottili),
  // ma abbastanza aggressivo da rimuovere isolate/spike fuori gruppo.
  radiusOutlierMm: 5.0,
  minNeighbors: 3,
  statisticalRadiusMm: 5.2,
  statisticalK: 10,
  statisticalStd: 1.12,

  // Keep only main cluster: voxel più grande = meno “frammentazione”
  // e maggiore stabilita del gruppo principale.
  clusterVoxelMm: 5.8,
  smoothVoxelMm: 0,
  // Smoothing: leggero (media verso i vicini) per ridurre jitter,
  // senza appiattire eccessivamente la forma.
  neighborSearchRadiusMm: 3.8,
  neighborSmoothK: 12,
  neighborSmoothBlend: 0.22,
  neighborSecondPassBlend: 0.0,
};

/**
 * Catena: outlier statistico → rimozione isolati → solo cluster principale → smoothing con vicini → (opz.) voxel.
 */
export function cleanPointCloudPipeline(
  cloud: PointCloud,
  opt: Partial<CleanPointCloudOptions> = {}
): PointCloud {
  const o = { ...DEFAULT_CLEAN_OPTIONS, ...opt };
  let positions = cloud.positions;
  let count = cloud.pointCount;
  let colors = cloud.colors;

  let s1 = statisticalOutlierRemoval(
    positions,
    count,
    o.statisticalRadiusMm,
    o.statisticalK,
    o.statisticalStd,
    colors
  );
  positions = s1.positions;
  colors = s1.colors;
  count = s1.count;

  let r1 = radiusOutlierRemoval(positions, count, o.radiusOutlierMm, o.minNeighbors, colors);
  positions = r1.positions;
  colors = r1.colors;
  count = r1.count;

  let cl = keepLargestVoxelCluster(positions, count, o.clusterVoxelMm, colors);
  positions = cl.positions;
  colors = cl.colors;
  count = cl.count;

  let smoothedPos = neighborAverageSmoothing(
    positions,
    count,
    o.neighborSearchRadiusMm,
    o.neighborSmoothK,
    o.neighborSmoothBlend
  );
  if (o.neighborSecondPassBlend > 0 && count > 0) {
    smoothedPos = neighborAverageSmoothing(
      smoothedPos,
      count,
      o.neighborSearchRadiusMm * 1.05,
      o.neighborSmoothK,
      o.neighborSecondPassBlend
    );
  }

  if (o.smoothVoxelMm > 0) {
    return voxelSmoothing(smoothedPos, count, o.smoothVoxelMm, colors);
  }

  return {
    positions: smoothedPos,
    colors,
    pointCount: count,
  };
}

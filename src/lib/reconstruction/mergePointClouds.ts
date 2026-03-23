import type { PointCloud } from "./types";

function voxelKey(x: number, y: number, z: number, voxelSize: number): string {
  const vx = Math.floor(x / voxelSize);
  const vy = Math.floor(y / voxelSize);
  const vz = Math.floor(z / voxelSize);
  return `${vx},${vy},${vz}`;
}

/**
 * Unisce più nuvole campionando una media per voxel (downsampling + riduzione rumore).
 */
export function mergePointCloudsVoxelAverage(
  clouds: { positions: Float32Array; colors?: Uint8Array; count: number }[],
  voxelSizeMm: number
): PointCloud {
  type Acc = { sx: number; sy: number; sz: number; n: number; cr: number; cg: number; cb: number; cn: number };
  const map = new Map<string, Acc>();

  for (const c of clouds) {
    const { positions, colors, count } = c;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const x = positions[o];
      const y = positions[o + 1];
      const z = positions[o + 2];
      const k = voxelKey(x, y, z, voxelSizeMm);
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
  }

  const nOut = map.size;
  const positions = new Float32Array(nOut * 3);
  const outColors = new Uint8Array(nOut * 3);
  let j = 0;
  for (const a of map.values()) {
    positions[j * 3] = a.sx / a.n;
    positions[j * 3 + 1] = a.sy / a.n;
    positions[j * 3 + 2] = a.sz / a.n;
    if (a.cn > 0) {
      outColors[j * 3] = Math.round(a.cr / a.cn);
      outColors[j * 3 + 1] = Math.round(a.cg / a.cn);
      outColors[j * 3 + 2] = Math.round(a.cb / a.cn);
    } else {
      outColors[j * 3] = 180;
      outColors[j * 3 + 1] = 180;
      outColors[j * 3 + 2] = 190;
    }
    j++;
  }

  return {
    positions,
    colors: outColors,
    pointCount: nOut,
  };
}

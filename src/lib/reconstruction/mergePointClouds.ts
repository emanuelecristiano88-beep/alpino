import type { PointCloud } from "./types";

function voxelKey(x: number, y: number, z: number, voxelSize: number): string {
  const vx = Math.floor(x / voxelSize);
  const vy = Math.floor(y / voxelSize);
  const vz = Math.floor(z / voxelSize);
  return `${vx},${vy},${vz}`;
}

/**
 * Unisce più nuvole campionando una media per voxel (downsampling + riduzione rumore).
 *
 * @param cloudWeights — opzionale, un peso per **nuvola** (stesso ordine di `clouds`).
 *   Ogni punto della nuvola `i` contribuisce con `cloudWeights[i]` alla media pesata nel voxel.
 *   Se omesso o lunghezza errata, tutti i punti pesano 1.
 */
export function mergePointCloudsVoxelAverage(
  clouds: { positions: Float32Array; colors?: Uint8Array; count: number }[],
  voxelSizeMm: number,
  cloudWeights?: number[]
): PointCloud {
  type Acc = {
    sx: number;
    sy: number;
    sz: number;
    wSum: number;
    cr: number;
    cg: number;
    cb: number;
    cw: number;
  };
  const map = new Map<string, Acc>();
  const useWeights =
    cloudWeights != null &&
    cloudWeights.length === clouds.length &&
    clouds.length > 0;

  for (let ci = 0; ci < clouds.length; ci++) {
    const c = clouds[ci]!;
    let wCloud = useWeights ? cloudWeights[ci]! : 1;
    if (!Number.isFinite(wCloud) || wCloud < 0) wCloud = 0;
    if (wCloud === 0) continue;

    const { positions, colors, count } = c;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const x = positions[o];
      const y = positions[o + 1];
      const z = positions[o + 2];
      const k = voxelKey(x, y, z, voxelSizeMm);
      let a = map.get(k);
      if (!a) {
        a = { sx: 0, sy: 0, sz: 0, wSum: 0, cr: 0, cg: 0, cb: 0, cw: 0 };
        map.set(k, a);
      }
      a.sx += wCloud * x;
      a.sy += wCloud * y;
      a.sz += wCloud * z;
      a.wSum += wCloud;
      if (colors) {
        a.cr += wCloud * colors[o];
        a.cg += wCloud * colors[o + 1];
        a.cb += wCloud * colors[o + 2];
        a.cw += wCloud;
      }
    }
  }

  const nOut = map.size;
  const positions = new Float32Array(nOut * 3);
  const outColors = new Uint8Array(nOut * 3);
  let j = 0;
  for (const a of map.values()) {
    const inv = a.wSum > 0 ? 1 / a.wSum : 0;
    positions[j * 3] = a.sx * inv;
    positions[j * 3 + 1] = a.sy * inv;
    positions[j * 3 + 2] = a.sz * inv;
    if (a.cw > 0) {
      const ic = 1 / a.cw;
      outColors[j * 3] = Math.round(a.cr * ic);
      outColors[j * 3 + 1] = Math.round(a.cg * ic);
      outColors[j * 3 + 2] = Math.round(a.cb * ic);
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

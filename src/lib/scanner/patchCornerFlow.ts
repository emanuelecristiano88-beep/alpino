/**
 * Continuità tra frame senza detection: tracking “feature-like” a patch (SSD).
 * Equivalente pratico a optical flow sparso sui 4 angoli del foglio.
 */

export type CornerNorm = { x: number; y: number };

export function rgbaToGrayLuma(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    out[i] = v < 0 ? 0 : v > 255 ? 255 : (Math.round(v) as number);
  }
  return out;
}

function ssdPatch(
  prev: Uint8Array,
  curr: Uint8Array,
  w: number,
  h: number,
  px0: number,
  py0: number,
  cx0: number,
  cy0: number,
  ph: number
): number {
  let s = 0;
  for (let j = -ph; j <= ph; j++) {
    const pry = py0 + j;
    const cry = cy0 + j;
    if (pry < 0 || pry >= h || cry < 0 || cry >= h) return Number.POSITIVE_INFINITY;
    for (let i = -ph; i <= ph; i++) {
      const prx = px0 + i;
      const crx = cx0 + i;
      if (prx < 0 || prx >= w || crx < 0 || crx >= w) return Number.POSITIVE_INFINITY;
      const d = prev[pry * w + prx] - curr[cry * w + crx];
      s += d * d;
    }
  }
  return s;
}

function quadAreaNorm(c: CornerNorm[]): number {
  if (c.length < 4) return 0;
  const shoelace = (i: number, j: number) => c[i].x * c[j].y - c[j].x * c[i].y;
  let a = 0;
  for (let i = 0; i < 4; i++) a += shoelace(i, (i + 1) % 4);
  return Math.abs(a) * 0.5;
}

/**
 * Per ogni angolo: cerca il miglior match SSD del patch del frame precedente nel frame corrente.
 */
export function trackCornersPatchFlow(
  prevGray: Uint8Array,
  currGray: Uint8Array,
  width: number,
  height: number,
  cornersNorm: CornerNorm[],
  opts?: {
    patchHalf?: number;
    searchRadius?: number;
    step?: number;
    maxMoveNorm?: number;
    maxSsdPerPixel?: number;
  }
): CornerNorm[] | null {
  const ph = opts?.patchHalf ?? 8;
  const sr = opts?.searchRadius ?? 14;
  const step = opts?.step ?? 2;
  const maxMoveNorm = opts?.maxMoveNorm ?? 0.09;
  const maxSsd = (opts?.maxSsdPerPixel ?? 900) * (2 * ph + 1) * (2 * ph + 1);

  if (cornersNorm.length < 4) return null;

  const out: CornerNorm[] = [];
  const maxMovePx = maxMoveNorm * Math.max(width, height);

  for (let k = 0; k < 4; k++) {
    const cn = cornersNorm[k];
    const ox = Math.round(cn.x * width);
    const oy = Math.round(cn.y * height);
    if (ox < ph + sr || ox >= width - ph - sr || oy < ph + sr || oy >= height - ph - sr) {
      return null;
    }

    let bestSsd = Number.POSITIVE_INFINITY;
    let bestX = ox;
    let bestY = oy;

    for (let dy = -sr; dy <= sr; dy += step) {
      for (let dx = -sr; dx <= sr; dx += step) {
        const cx = ox + dx;
        const cy = oy + dy;
        if (cx < ph || cx >= width - ph || cy < ph || cy >= height - ph) continue;
        const s = ssdPatch(prevGray, currGray, width, height, ox, oy, cx, cy, ph);
        if (s < bestSsd) {
          bestSsd = s;
          bestX = cx;
          bestY = cy;
        }
      }
    }

    if (bestSsd > maxSsd) return null;
    if (Math.hypot(bestX - ox, bestY - oy) > maxMovePx) return null;

    out.push({ x: bestX / width, y: bestY / height });
  }

  const a0 = quadAreaNorm(cornersNorm);
  const a1 = quadAreaNorm(out);
  if (a0 < 1e-5 || a1 < 1e-5) return null;
  const ratio = a1 / a0;
  if (ratio < 0.35 || ratio > 2.85) return null;

  return out;
}

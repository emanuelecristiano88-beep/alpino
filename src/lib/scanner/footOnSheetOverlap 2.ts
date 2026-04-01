/**
 * Stima frazione dell’area bbox piede (foreground) che cade dentro il poligono foglio (ArUco).
 * Griglia fissa su bbox — sufficiente per soglia 15–20%.
 */

import type { NormPoint } from "./sheetQuadFromAruco";

export type FootBBoxNorm = { x: number; y: number; w: number; h: number };

function pointInPolygon(x: number, y: number, poly: NormPoint[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect =
      (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-14) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const GRID_N = 8;

/**
 * Rapporto campioni bbox dentro il poligono / campioni totali ≈ frazione area bbox sul foglio.
 */
export function estimateFootBBoxOverlapFractionOnPolygon(
  foot: FootBBoxNorm,
  poly: NormPoint[]
): number {
  if (poly.length < 3) return 0;
  const fw = Math.max(1e-6, foot.w);
  const fh = Math.max(1e-6, foot.h);
  let inside = 0;
  const total = GRID_N * GRID_N;
  for (let iy = 0; iy < GRID_N; iy++) {
    for (let ix = 0; ix < GRID_N; ix++) {
      const px = foot.x + ((ix + 0.5) / GRID_N) * fw;
      const py = foot.y + ((iy + 0.5) / GRID_N) * fh;
      if (pointInPolygon(px, py, poly)) inside++;
    }
  }
  return inside / total;
}

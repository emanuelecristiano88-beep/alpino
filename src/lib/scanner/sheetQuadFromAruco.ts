/**
 * Poligono foglio A4 in coordinate normalizzate video (0–1) da quadrilateri ArUco.
 * Per ogni marker: angolo esterno = vertice più lontano dal centro della configurazione.
 */

export type NormPoint = { x: number; y: number };

export type ArucoQuadNorm = { id: number; corners: NormPoint[] };

/** Ordina i vertici in senso antiorario attorno al centro (robusto con foglio ruotato). */
function orderConvexCCW(pts: NormPoint[]): NormPoint[] {
  if (pts.length < 3) return pts;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
}

/**
 * Restituisce 3–4 vertici del contorno foglio (ordine TL, TR, BR, BL se 4 punti).
 */
export function sheetQuadCornersNormFromMarkerQuads(quads: ArucoQuadNorm[] | null | undefined): NormPoint[] | null {
  if (!quads || quads.length < 1) return null;

  const withCentroids: { corners: NormPoint[]; cx: number; cy: number }[] = [];
  for (const q of quads) {
    const c = q.corners;
    if (c.length < 4) continue;
    const cx = c.reduce((s, p) => s + p.x, 0) / 4;
    const cy = c.reduce((s, p) => s + p.y, 0) / 4;
    withCentroids.push({ corners: c, cx, cy });
  }
  if (withCentroids.length < 1) return null;

  const sx = withCentroids.reduce((s, m) => s + m.cx, 0) / withCentroids.length;
  const sy = withCentroids.reduce((s, m) => s + m.cy, 0) / withCentroids.length;

  const outerCorners = withCentroids.map((m) => {
    let best = m.corners[0];
    let bestD = -1;
    for (const p of m.corners) {
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  });

  if (outerCorners.length < 3) return null;
  return orderConvexCCW(outerCorners);
}

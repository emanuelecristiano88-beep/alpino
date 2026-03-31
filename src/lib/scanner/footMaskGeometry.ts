/**
 * Geometria da maschera binaria piede (per classificazione vista, no ML).
 */

export type NormBBox = { x: number; y: number; w: number; h: number };
export type NormPoint = { x: number; y: number };

export type FootViewZoneMetrics = {
  /** Bounding box normalizzato 0–1 */
  bboxNorm: NormBBox;
  /** Aspect ratio larghezza / altezza del bbox */
  bboxAspectRatio: number;
  /** Centroide maschera normalizzato */
  centroidNorm: NormPoint;
  /** Punti sul contorno (semplificati, ordinati per angolo dal centroide) */
  contourNorm: NormPoint[];
  /** Numero punti contorno campionati */
  contourPointCount: number;
  /** Indice curvatura 0–1: media |Δangolo| lungo il contorno / π */
  curvatureIndex: number;
  /** Bias orientamento: (μ20−μ02)/(μ20+μ02), >0 → più dispersione orizzontale */
  horizontalVerticalBias: number;
  /** Area maschera / area bbox */
  fillRatio: number;
  /** 4π·area/perimetro² (1 = cerchio) */
  compactness: number;
  /** Pixel foreground */
  areaPx: number;
};

function isBoundaryPixel(mask: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  if (!mask[y * w + x]) return false;
  return (
    !mask[y * w + (x - 1)] ||
    !mask[y * w + (x + 1)] ||
    !mask[(y - 1) * w + x] ||
    !mask[(y + 1) * w + x]
  );
}

/**
 * Estrae bbox, centroide, momenti, contorno ordinato (campione angolare), curvatura semplificata.
 */
export function extractFootMaskGeometry(mask: Uint8Array, w: number, h: number): FootViewZoneMetrics | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let pixels = 0;
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      pixels += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  const minPx = 160;
  if (pixels < minPx || maxX < minX || maxY < minY) return null;

  const cx = sumX / pixels;
  const cy = sumY / pixels;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const dx = x - cx;
      const dy = y - cy;
      mu20 += dx * dx;
      mu02 += dy * dy;
      mu11 += dx * dy;
    }
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const bboxArea = bw * bh;
  const fillRatio = bboxArea > 0 ? pixels / bboxArea : 0;

  let perimeter = 0;
  const edgePoints: { x: number; y: number; ang: number }[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!isBoundaryPixel(mask, w, h, x, y)) continue;
      perimeter += 1;
      const ang = Math.atan2(y - cy, x - cx);
      edgePoints.push({ x, y, ang });
    }
  }

  if (edgePoints.length < 12) return null;

  edgePoints.sort((a, b) => a.ang - b.ang);

  const maxContourPts = 48;
  const step = Math.max(1, Math.floor(edgePoints.length / maxContourPts));
  const contourNorm: NormPoint[] = [];
  for (let i = 0; i < edgePoints.length; i += step) {
    const p = edgePoints[i];
    contourNorm.push({ x: p.x / w, y: p.y / h });
  }
  if (contourNorm.length < 3) return null;

  const n = contourNorm.length;
  let turnSum = 0;
  for (let i = 0; i < n; i++) {
    const p0 = contourNorm[(i - 1 + n) % n];
    const p1 = contourNorm[i];
    const p2 = contourNorm[(i + 1) % n];
    const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turnSum += Math.abs(d);
  }
  const curvatureIndex = Math.min(1, turnSum / (n * Math.PI));

  const perimEff = Math.max(perimeter, 1);
  const compactness = (4 * Math.PI * pixels) / (perimEff * perimEff);
  const denom = mu20 + mu02 + 1e-9;
  const horizontalVerticalBias = (mu20 - mu02) / denom;

  const bboxNorm: NormBBox = {
    x: minX / w,
    y: minY / h,
    w: bw / w,
    h: bh / h,
  };

  return {
    bboxNorm,
    bboxAspectRatio: bw / Math.max(1, bh),
    centroidNorm: { x: cx / w, y: cy / h },
    contourNorm,
    contourPointCount: contourNorm.length,
    curvatureIndex,
    horizontalVerticalBias,
    fillRatio,
    compactness: Math.min(1, compactness),
    areaPx: pixels,
  };
}

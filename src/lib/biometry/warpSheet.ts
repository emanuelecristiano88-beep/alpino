/**
 * Campiona il foglio in una vista canonica (asse allineato al bordo A4) per segmentazione piede.
 */
import { applyHomographyCartesian, type Mat3 } from "./homography";
import { SHEET_H_MM, SHEET_W_MM } from "./sheetGeometry";

export type CanonicalSheetFrame = {
  /** Larghezza in pixel */
  width: number;
  height: number;
  /** mm per pixel nella vista canonica (= 1 / pxPerMm) */
  mmPerPixel: number;
  /** ImageData RGBA della regione foglio raddrizzata */
  imageData: ImageData;
};

/**
 * pxPerMm: es. 4 → 840×1188 px per A4.
 */
export function warpImageToCanonicalSheet(
  source: ImageData,
  H_worldMm_to_imagePx: Mat3,
  pxPerMm = 4
): CanonicalSheetFrame {
  const w = Math.round(SHEET_W_MM * pxPerMm);
  const h = Math.round(SHEET_H_MM * pxPerMm);
  const out = new ImageData(w, h);
  out.data.fill(255);

  const srcW = source.width;
  const srcH = source.height;
  const src = source.data;

  const sampleBilinear = (u: number, v: number): [number, number, number, number] => {
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, srcW - 1);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const tx = u - x0;
    const ty = v - y0;
    const idx = (xx: number, yy: number) => (yy * srcW + xx) * 4;
    const p = (a: number, b: number, c: number, d: number) => a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    const r = p(src[idx(x0, y0)], src[idx(x1, y0)], src[idx(x0, y1)], src[idx(x1, y1)]);
    const g = p(src[idx(x0, y0) + 1], src[idx(x1, y0) + 1], src[idx(x0, y1) + 1], src[idx(x1, y1) + 1]);
    const b = p(src[idx(x0, y0) + 2], src[idx(x1, y0) + 2], src[idx(x0, y1) + 2], src[idx(x1, y1) + 2]);
    const al = p(src[idx(x0, y0) + 3], src[idx(x1, y0) + 3], src[idx(x0, y1) + 3], src[idx(x1, y1) + 3]);
    return [r, g, b, al];
  };

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const xMm = (i + 0.5) / pxPerMm;
      const yMm = (j + 0.5) / pxPerMm;
      const p = applyHomographyCartesian(H_worldMm_to_imagePx, xMm, yMm);
      if (Number.isNaN(p.x) || p.x < 0 || p.y < 0 || p.x > srcW - 1 || p.y > srcH - 1) continue;
      const [r, g, b, a] = sampleBilinear(p.x, p.y);
      const o = (j * w + i) * 4;
      out.data[o] = r;
      out.data[o + 1] = g;
      out.data[o + 2] = b;
      out.data[o + 3] = a;
    }
  }

  return { width: w, height: h, mmPerPixel: 1 / pxPerMm, imageData: out };
}

import { extractFootMask, extractFootMaskAi } from "./segmentFoot";
import { downscaleImageDataMaxSide } from "./imageResize";

export type FootMaskMode = "heuristic" | "ai";

/**
 * Azzera RGB fuori maschera (riduce rumore per depth / modelli).
 */
export function clearBackgroundOutsideMask(imageData: ImageData, mask: Uint8Array): void {
  const d = imageData.data;
  const n = mask.length;
  for (let i = 0; i < n; i++) {
    if (mask[i]) continue;
    const o = i * 4;
    d[o] = 0;
    d[o + 1] = 0;
    d[o + 2] = 0;
  }
}

/**
 * Normalizza luminosità sulla regione mascherata (media → target ~128).
 */
export function normalizeBrightnessMasked(imageData: ImageData, mask: Uint8Array): void {
  const d = imageData.data;
  const n = mask.length;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    const g = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    sum += g;
    cnt++;
  }
  if (cnt < 8) return;
  const mean = sum / cnt;
  const target = 128;
  let scale = target / Math.max(mean, 1e-3);
  scale = Math.max(0.45, Math.min(2.2, scale));
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const o = i * 4;
    d[o] = Math.min(255, Math.max(0, d[o] * scale));
    d[o + 1] = Math.min(255, Math.max(0, d[o + 1] * scale));
    d[o + 2] = Math.min(255, Math.max(0, d[o + 2] * scale));
  }
}

export type PreprocessedFootFrame = {
  imageData: ImageData;
  mask: Uint8Array;
};

/**
 * Preprocess: resize → maschera piede → sfondo azzerato → luminanza normalizzata.
 */
export async function preprocessFootCapture(
  imageData: ImageData,
  maxSide: number,
  maskMode: FootMaskMode = "heuristic"
): Promise<PreprocessedFootFrame> {
  const small = downscaleImageDataMaxSide(imageData, maxSide);
  const mask =
    maskMode === "ai" ? await extractFootMaskAi(small) : extractFootMask(small);
  clearBackgroundOutsideMask(small, mask);
  normalizeBrightnessMasked(small, mask);
  return { imageData: small, mask };
}

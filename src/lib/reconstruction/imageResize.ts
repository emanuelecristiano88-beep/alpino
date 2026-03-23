/**
 * Ridimensiona ImageData con nearest o bilinear (semplice) per pipeline veloce.
 */
export function downscaleImageDataMaxSide(src: ImageData, maxSide: number): ImageData {
  const { width: w, height: h } = src;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  if (scale >= 1) return src;
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = nw;
  c.height = nh;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return src;
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  if (!tctx) return src;
  tctx.putImageData(src, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(tmp, 0, 0, nw, nh);
  return ctx.getImageData(0, 0, nw, nh);
}

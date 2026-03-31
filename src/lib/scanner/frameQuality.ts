import type { ArucoMarkerDetection } from "../aruco/a4MarkerGeometry";

/**
 * Varianza Laplaciana (proxy nitidezza) sul ROI marker — valori più alti = meno motion blur.
 * Usata per gate qualità live e validazione post-cattura.
 */
export function markerSharpnessScore(imageData: ImageData, marker: ArucoMarkerDetection): number {
  const xs = marker.corners.map((p) => p.x);
  const ys = marker.corners.map((p) => p.y);
  const pad = 8;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const x1 = Math.min(imageData.width - 1, Math.ceil(Math.max(...xs) + pad));
  const y1 = Math.min(imageData.height - 1, Math.ceil(Math.max(...ys) + pad));
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const gray = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const center = gray(x, y);
      const lap = gray(x - 1, y) + gray(x + 1, y) + gray(x, y - 1) + gray(x, y + 1) - 4 * center;
      n += 1;
      sum += lap;
      sumSq += lap * lap;
    }
  }
  if (n < 8) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

import { estimateRelativeDepthNormalized } from "./depthEstimation";

export type DepthBackendId = "pseudo" | "midas";

/**
 * Profondità normalizzata [0,1] con backend selezionabile.
 * `midas` → placeholder: usa pseudo finché non è integrato ONNX/MiDaS (vedi `depthEstimation.ts`).
 */
export async function estimateDepthNormalizedAsync(
  imageData: ImageData,
  backend: DepthBackendId = "pseudo"
): Promise<Float32Array> {
  if (backend === "midas") {
    // TODO: integrare onnxruntime-web + modello depth leggero (MiDaS / Depth Anything v2)
    return estimateRelativeDepthNormalized(imageData);
  }
  return estimateRelativeDepthNormalized(imageData);
}

/** Azzera depth fuori dalla maschera (riduce rumore strutturato). */
export function multiplyDepthByMask(depth01: Float32Array, mask: Uint8Array): void {
  const n = Math.min(depth01.length, mask.length);
  for (let i = 0; i < n; i++) {
    if (!mask[i]) depth01[i] = 0;
  }
}

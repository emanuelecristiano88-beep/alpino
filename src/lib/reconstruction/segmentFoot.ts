import { buildFootBinaryMask, buildFootBinaryMaskAi } from "../biometry/footMask";

/**
 * Maschera binaria piede (1) vs sfondo (0), riusa euristica biometria NEUMA.
 */
export function extractFootMask(imageData: ImageData): Uint8Array {
  return buildFootBinaryMask(imageData);
}

/**
 * Segmentazione AI (MediaPipe) con fallback automatico all'euristica colore.
 */
export async function extractFootMaskAi(imageData: ImageData): Promise<Uint8Array> {
  return buildFootBinaryMaskAi(imageData);
}

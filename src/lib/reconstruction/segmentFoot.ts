import { buildFootBinaryMask } from "../biometry/footMask";

/**
 * Maschera binaria piede (1) vs sfondo (0), riusa euristica biometria NEUMA.
 */
export function extractFootMask(imageData: ImageData): Uint8Array {
  return buildFootBinaryMask(imageData);
}

import type { ScanPhaseId } from "../../constants/scanCapturePhases";

/**
 * Pesi per fusione voxel tra zone (TOP / OUTER / INNER / HEEL).
 * INNER (arco) pesa di più per accuratezza forma plantare; HEEL / OUTER meno (più rumorosi).
 */
export const SCAN_PHASE_MERGE_WEIGHT: Record<ScanPhaseId, number> = {
  0: 1.0, // TOP
  1: 0.8, // OUTER
  2: 1.2, // INNER (arch)
  3: 0.7, // HEEL
};

/** Un peso per nuvola, allineato all’ordine delle nuvole in merge (stesso indice di `phaseIds`). */
export function mergeWeightsForPhaseIds(phaseIds: ScanPhaseId[]): number[] {
  return phaseIds.map((id) => SCAN_PHASE_MERGE_WEIGHT[id]);
}

import type { ScanFrameTilt } from "../../hooks/useScanFrameOrientation";
import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import {
  footViewZoneToPhase,
  type FootViewZone,
} from "./footViewZoneClassifier";

type FootId = "LEFT" | "RIGHT";

export function sheetCenterFromMarkers(markerCentersNorm: { x: number; y: number }[] | null): { x: number; y: number } {
  if (!markerCentersNorm || markerCentersNorm.length < 4) {
    return { x: 0.5, y: 0.5 };
  }
  let sx = 0;
  let sy = 0;
  for (const p of markerCentersNorm) {
    sx += p.x;
    sy += p.y;
  }
  const n = markerCentersNorm.length;
  return { x: sx / n, y: sy / n };
}

/**
 * Riconoscimento fasi interne (0–3) con logica semplice e zone larghe → più stabile.
 * Non usa ML: solo posizione piede nel frame rispetto al foglio, bbox piede, inclinazione leggera.
 *
 * Convenzione immagine (x → destra, y → basso):
 * - piede centrato sul foglio → TOP
 * - centroid spostato a destra → OUTER (per piede sinistro; invertito per destro)
 * - centroid spostato a sinistra → INNER
 * - tallone “in basso” nel frame + piede basso → HEEL
 */
export function inferScanViewPhaseFromSensors(args: {
  tilt: ScanFrameTilt;
  footBBox: { x: number; y: number; w: number; h: number } | null;
  footCentroidNorm: { x: number; y: number } | null;
  markerCentersNorm: { x: number; y: number }[] | null;
  currentFoot: FootId;
}): ScanPhaseId | null {
  const { tilt, footBBox, footCentroidNorm, markerCentersNorm, currentFoot } = args;
  const fc = footCentroidNorm;
  if (!fc) return null;

  const { x: sheetCx, y: sheetCy } = sheetCenterFromMarkers(markerCentersNorm);
  const dx = fc.x - sheetCx;
  const dy = fc.y - sheetCy;

  const rx = tilt.rotateX;
  const rz = tilt.rotateZ;

  const footBottom = footBBox ? footBBox.y + footBBox.h : 0;
  const footTop = footBBox ? footBBox.y : 1;

  // HEEL: tallone visibile — piede “ancorato” in basso nel frame, centro leggermente sotto il centro foglio
  const heelLike =
    footBBox != null &&
    footBottom > 0.62 &&
    fc.y > sheetCy + 0.08 &&
    Math.abs(dx) < 0.13 &&
    footTop < 0.78;
  if (heelLike) return 3;

  // TOP: centrato sul foglio + telefono non fortemente rollato/pitchato (evita falsi TOP da lato)
  const centered = Math.abs(dx) < 0.1 && Math.abs(dy) < 0.11;
  const mildTilt = Math.abs(rx) <= 12 && Math.abs(rz) <= 16;
  if (centered && mildTilt) return 0;

  // Lateralità: spostamento orizzontale netto (fascia morta centrale → meno flip-flop)
  const outerOnPositiveDx = currentFoot === "LEFT";
  if (dx >= 0.12) return outerOnPositiveDx ? 1 : 2;
  if (dx <= -0.12) return outerOnPositiveDx ? 2 : 1;

  return null;
}

export function viewAngleMatchesTargetPhase(
  targetPhase: ScanPhaseId,
  tilt: ScanFrameTilt,
  footCentroidNorm: { x: number; y: number } | null,
  footBBox: { x: number; y: number; w: number; h: number } | null,
  markerCentersNorm: { x: number; y: number }[] | null,
  currentFoot: FootId,
  /** Se disponibile (maschera + euristica), ha priorità sul fallback tilt/centroide */
  detectedFootViewZone: FootViewZone | null
): boolean {
  if (detectedFootViewZone != null) {
    return footViewZoneToPhase(detectedFootViewZone) === targetPhase;
  }
  const inferred = inferScanViewPhaseFromSensors({
    tilt,
    footBBox,
    footCentroidNorm,
    markerCentersNorm,
    currentFoot,
  });
  return inferred === targetPhase;
}

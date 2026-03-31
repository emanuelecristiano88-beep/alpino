import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import type { FootViewZoneMetrics } from "./footMaskGeometry";

export type FootViewZone = "TOP" | "OUTER" | "INNER" | "HEEL";

export const FOOT_VIEW_ZONE_TO_PHASE: Record<FootViewZone, ScanPhaseId> = {
  TOP: 0,
  OUTER: 1,
  INNER: 2,
  HEEL: 3,
};

/** Fase interna → zona attesa (per acquisizione mirata) */
export const SCAN_PHASE_TARGET_ZONE: Record<ScanPhaseId, FootViewZone> = {
  0: "TOP",
  1: "OUTER",
  2: "INNER",
  3: "HEEL",
};

export type FootZoneClassifyContext = {
  metrics: FootViewZoneMetrics;
  /** Centro foglio (marker) normalizzato; fallback 0.5,0.5 */
  sheetCenterNorm: { x: number; y: number };
  currentFoot: "LEFT" | "RIGHT";
};

/**
 * Euristica leggera: aspect ratio, centroide vs foglio, curvatura contorno, bias H/V.
 */
export function classifyFootViewZone(ctx: FootZoneClassifyContext): FootViewZone | null {
  const { metrics, sheetCenterNorm, currentFoot } = ctx;
  const c = metrics.centroidNorm;
  const dx = c.x - sheetCenterNorm.x;
  const dy = c.y - sheetCenterNorm.y;
  const ar = metrics.bboxAspectRatio;
  const curv = metrics.curvatureIndex;
  const hv = metrics.horizontalVerticalBias;
  const bottomY = metrics.bboxNorm.y + metrics.bboxNorm.h;

  const outerOnPositiveDx = currentFoot === "LEFT";

  // HEEL: centroide basso, bbox ancorato in basso, poco offset laterale
  if (dy > 0.072 && bottomY > 0.56 && Math.abs(dx) < 0.15) {
    return "HEEL";
  }

  // TOP: centrato sul foglio, silhouette più “alta” che larga, contorno relativamente liscio
  if (
    Math.abs(dx) < 0.098 &&
    Math.abs(dy) < 0.105 &&
    ar < 0.9 &&
    curv < 0.45 &&
    metrics.fillRatio > 0.28
  ) {
    return "TOP";
  }

  // Laterali: spostamento orizzontale netto del centroide
  if (dx >= 0.105) {
    return outerOnPositiveDx ? "OUTER" : "INNER";
  }
  if (dx <= -0.105) {
    return outerOnPositiveDx ? "INNER" : "OUTER";
  }

  // Zona grigia: usa bias H/V + aspect (profilo spesso più largo che alto in bbox)
  if (ar > 0.95 && hv > 0.1 && curv > 0.32) {
    return outerOnPositiveDx ? "OUTER" : "INNER";
  }
  if (ar > 0.95 && hv < -0.1 && curv > 0.32) {
    return outerOnPositiveDx ? "INNER" : "OUTER";
  }

  return null;
}

export function footViewZoneToPhase(zone: FootViewZone): ScanPhaseId {
  return FOOT_VIEW_ZONE_TO_PHASE[zone];
}

/** Prima zona ancora senza burst completo (ordine TOP → HEEL). */
export function firstMissingFootZone(
  zonesComplete: readonly [boolean, boolean, boolean, boolean]
): FootViewZone | null {
  const order: FootViewZone[] = ["TOP", "OUTER", "INNER", "HEEL"];
  for (let i = 0; i < 4; i++) {
    if (!zonesComplete[i]) return order[i];
  }
  return null;
}

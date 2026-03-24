/**
 * Extract foot parameters from a NeumaBiometryResult (2D keypoints + plantar contour in mm).
 *
 * This path benefits from metric calibration (mm/pixel known from ArUco homography) and
 * semantic keypoints (hallux_tip, arch_medial, metatarsal_medial/lateral, heel_center, etc.)
 * computed in `src/lib/biometry/`.
 *
 * Outputs FootParameters with source = "biometry_keypoints".
 *
 * Algorithm
 * ---------
 * 1. Length: Euclidean distance hallux_tip → heel_center.
 * 2. Max forefoot width: metatarsal_lateral.xMm − metatarsal_medial.xMm (signed; use abs).
 *    Falls back to contour-width at 38 % fraction if keypoints absent.
 * 3. Midfoot width: minimum width of contour around arch_medial y-coordinate.
 * 4. Heel width: contour width at heel_center y + 15 % of length.
 * 5. CSI from (3) / (2).
 * 6. Toe detection from contour distal points.
 * 7. Arch angle: not available from 2D (set to −1); CSI used instead.
 */

import type { NeumaBiometryResult, NeumaPoint3D } from "../biometry/types";
import type {
  FootParameters,
  FootDimensions,
  ArchAnalysis,
  ArchType,
  ToeAlignment,
  ToeShape,
  ToeRelativeLengths,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findKp(keypoints: NeumaPoint3D[], id: string): NeumaPoint3D | undefined {
  return keypoints.find((k) => k.id === id);
}

function dist2D(a: { xMm: number; yMm: number }, b: { xMm: number; yMm: number }): number {
  const dx = a.xMm - b.xMm;
  const dy = a.yMm - b.yMm;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Width of contour at a given Y (mm) ± bandMm. Returns 0 if no points found. */
function contourWidthAtY(
  contour: { xMm: number; yMm: number }[],
  targetY: number,
  bandMm: number
): number {
  const pts = contour.filter((p) => Math.abs(p.yMm - targetY) <= bandMm);
  if (pts.length < 2) return 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (const p of pts) {
    if (p.xMm < mn) mn = p.xMm;
    if (p.xMm > mx) mx = p.xMm;
  }
  return mx - mn;
}

/** Minimum width over a range of Y values. */
function minContourWidthInRange(
  contour: { xMm: number; yMm: number }[],
  yMin: number,
  yMax: number,
  stepMm: number,
  bandMm: number
): number {
  let best = Infinity;
  for (let y = yMin; y <= yMax; y += stepMm) {
    const w = contourWidthAtY(contour, y, bandMm);
    if (w > 0 && w < best) best = w;
  }
  return isFinite(best) ? best : 0;
}

// ---------------------------------------------------------------------------
// Toe detection from contour
// ---------------------------------------------------------------------------

/**
 * Collect toe lobe peaks in the proximal (top) portion of the contour.
 * In the canonical sheet frame Y increases downward; toe region = lowest yMm values.
 */
function detectToeTipsFromContour(
  contour: { xMm: number; yMm: number }[],
  toeY: number,
  zoneHeightMm: number
): number[] {
  // Filter to toe zone (0..zoneHeightMm below toeY)
  const toePts = contour.filter(
    (p) => p.yMm >= toeY && p.yMm <= toeY + zoneHeightMm
  );
  if (toePts.length < 4) return [];

  // Discretise into X-buckets and find local maxima (smallest Y → furthest toe protrusion)
  const BUCKETS = 20;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const p of toePts) {
    if (p.xMm < xMin) xMin = p.xMm;
    if (p.xMm > xMax) xMax = p.xMm;
  }
  const bw = (xMax - xMin) / BUCKETS;
  if (bw < 0.1) return [];

  // For each bucket, record the minimum Y (= most distal point in that column)
  const minY: (number | null)[] = new Array(BUCKETS).fill(null);
  for (const p of toePts) {
    const b = Math.min(BUCKETS - 1, Math.floor((p.xMm - xMin) / bw));
    if (minY[b] === null || p.yMm < (minY[b] as number)) {
      minY[b] = p.yMm;
    }
  }

  // Smooth + find local minima (= tip peaks)
  const tips: number[] = [];
  for (let i = 1; i < BUCKETS - 1; i++) {
    const prev = minY[i - 1];
    const cur = minY[i];
    const next = minY[i + 1];
    if (cur === null) continue;
    const pv = prev ?? cur + 1;
    const nx = next ?? cur + 1;
    if (cur < pv && cur < nx) {
      // Distance from toe zone start in mm (= how far the toe protrudes)
      tips.push(zoneHeightMm - (cur - toeY));
    }
  }
  return tips;
}

function classifyToeShapeFromRelLengths(rel: ToeRelativeLengths): ToeShape {
  const { t1, t2, t3, t4, t5 } = rel;
  const max = Math.max(t1, t2, t3, t4, t5);
  if (max < 1e-3) return "egyptian";
  const n1 = t1 / max;
  const n2 = t2 / max;
  const n3 = t3 / max;
  if (n2 > n1 + 0.05) return "greek";
  const spread = Math.max(n1, n2, n3) - Math.min(n1, n2, n3);
  if (spread < 0.10) return "roman";
  return "egyptian";
}

function classifyArch(csi: number): ArchType {
  if (csi < 0) return "normal";
  if (csi >= 45) return "flat";
  if (csi < 30) return "high";
  return "normal";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract foot parameters from a calibrated biometry result.
 *
 * @param biometry  Result of computeNeumaBiometryFromImageData().
 */
export function extractFootParametersFromBiometry(
  biometry: NeumaBiometryResult
): FootParameters {
  const warnings: string[] = [...biometry.calibration.warnings];
  const kps = biometry.keypoints;
  const contour = biometry.footContourMm;

  if (!biometry.calibration.ok) {
    warnings.push("Biometry calibration failed; parameters will be zero/default.");
  }

  // ------ 1. Length --------------------------------------------------------
  const hallux = findKp(kps, "hallux_tip");
  const heel = findKp(kps, "heel_center");
  let lengthMm = 0;
  if (hallux && heel) {
    lengthMm = dist2D(hallux, heel);
  } else if (contour.length >= 4) {
    // Fallback: bounding box height of contour
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const p of contour) {
      if (p.yMm < yMin) yMin = p.yMm;
      if (p.yMm > yMax) yMax = p.yMm;
    }
    lengthMm = yMax - yMin;
    warnings.push("hallux_tip or heel_center keypoint missing; foot length estimated from bounding box.");
  }

  // ------ 2. Forefoot width -------------------------------------------------
  const metaMed = findKp(kps, "metatarsal_medial");
  const metaLat = findKp(kps, "metatarsal_lateral");
  let maxWidthMm = 0;
  let metaYMm = 0;
  if (metaMed && metaLat) {
    maxWidthMm = Math.abs(metaLat.xMm - metaMed.xMm);
    metaYMm = (metaMed.yMm + metaLat.yMm) / 2;
  } else if (contour.length >= 4 && lengthMm > 0) {
    // Estimate from contour at 38 % of length from toe
    let yMin = Infinity;
    for (const p of contour) if (p.yMm < yMin) yMin = p.yMm;
    metaYMm = yMin + 0.38 * lengthMm;
    maxWidthMm = contourWidthAtY(contour, metaYMm, lengthMm * 0.04);
    warnings.push("Metatarsal keypoints missing; forefoot width estimated from contour.");
  }

  // ------ 3. Midfoot width --------------------------------------------------
  const archKp = findKp(kps, "arch_medial");
  let midfootWidthMm = 0;
  if (archKp && contour.length >= 4 && lengthMm > 0) {
    const bandMm = lengthMm * 0.04;
    midfootWidthMm = contourWidthAtY(contour, archKp.yMm, bandMm);
  } else if (contour.length >= 4 && lengthMm > 0) {
    let yMin = Infinity;
    for (const p of contour) if (p.yMm < yMin) yMin = p.yMm;
    const midY = yMin + 0.57 * lengthMm;
    const bandMm = lengthMm * 0.04;
    midfootWidthMm = minContourWidthInRange(
      contour,
      midY - 0.05 * lengthMm,
      midY + 0.05 * lengthMm,
      bandMm / 2,
      bandMm
    );
  }

  // ------ 4. Heel width -----------------------------------------------------
  let heelWidthMm = 0;
  if (heel && contour.length >= 4 && lengthMm > 0) {
    const bandMm = lengthMm * 0.04;
    heelWidthMm = contourWidthAtY(contour, heel.yMm, bandMm);
  } else if (contour.length >= 4 && lengthMm > 0) {
    let yMin = Infinity;
    for (const p of contour) if (p.yMm < yMin) yMin = p.yMm;
    heelWidthMm = contourWidthAtY(contour, yMin + 0.85 * lengthMm, lengthMm * 0.04);
  }

  // ------ 5. CSI ------------------------------------------------------------
  const csi = maxWidthMm > 0 ? (midfootWidthMm / maxWidthMm) * 100 : -1;

  // ------ 6. Toe detection --------------------------------------------------
  let toeConf = 0.3;
  let tipProtrusions: number[] = [];
  if (hallux && contour.length >= 4 && lengthMm > 0) {
    const toeZoneHeightMm = lengthMm * 0.20;
    const toeYStart = hallux.yMm - toeZoneHeightMm;
    tipProtrusions = detectToeTipsFromContour(contour, toeYStart, toeZoneHeightMm);
    toeConf = tipProtrusions.length >= 3 ? 0.7 : tipProtrusions.length >= 1 ? 0.45 : 0.25;
    if (tipProtrusions.length < 3) {
      warnings.push(
        `Only ${tipProtrusions.length} toe lobe(s) found in contour. Toe classification may be inaccurate.`
      );
    }
  } else {
    warnings.push("Insufficient data for toe detection.");
  }

  // Map to 5-toe model — sorted descending, extrapolate with decay
  const sorted = [...tipProtrusions].sort((a, b) => b - a);
  const getTip = (i: number): number => {
    if (i < sorted.length) return Math.max(0, sorted[i]);
    const prev = i > 0 ? (getTip(i - 1)) : 0;
    return Math.max(0, prev * 0.96);
  };
  const tipPosMm: ToeRelativeLengths = {
    t1: getTip(0),
    t2: getTip(1),
    t3: getTip(2),
    t4: getTip(3),
    t5: getTip(4),
  };
  const maxTipMm = Math.max(tipPosMm.t1, tipPosMm.t2, tipPosMm.t3, tipPosMm.t4, tipPosMm.t5, 1);
  const relLengths: ToeRelativeLengths = {
    t1: tipPosMm.t1 / maxTipMm,
    t2: tipPosMm.t2 / maxTipMm,
    t3: tipPosMm.t3 / maxTipMm,
    t4: tipPosMm.t4 / maxTipMm,
    t5: tipPosMm.t5 / maxTipMm,
  };
  const toeShape = classifyToeShapeFromRelLengths(relLengths);

  // ------ Assemble ----------------------------------------------------------
  const dimensions: FootDimensions = {
    lengthMm,
    maxWidthMm,
    midfootWidthMm,
    heelWidthMm,
    ballGirthMm: Math.PI * maxWidthMm,
  };

  const arch: ArchAnalysis = {
    csi,
    archAngleDeg: -1,
    navicularHeightMm: -1,
    archType: classifyArch(csi),
  };

  const toes: ToeAlignment = {
    relativeLengths: relLengths,
    tipPositionsMm: tipPosMm,
    toeShape,
    confidence: toeConf,
  };

  // Quality: penalise missing keypoints and zero dimensions
  let quality = 1.0;
  if (!biometry.calibration.ok) quality -= 0.5;
  if (kps.length < 4) quality -= 0.2;
  if (maxWidthMm < 1) quality -= 0.2;
  if (tipProtrusions.length < 2) quality -= 0.15;
  quality = Math.max(0, Math.min(1, quality));

  return {
    schema: "neuma.foot-parameters.v1",
    source: "biometry_keypoints",
    dimensions,
    arch,
    toes,
    qualityScore: quality,
    extractedAt: new Date().toISOString(),
    warnings,
  };
}

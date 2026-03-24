/**
 * Extract foot parameters from a binary plantar mask.
 *
 * Inputs
 * ------
 * - mask      : Uint8Array, 0/1 values, row-major, width × height pixels
 * - mmPerPixel: physical scale (mm per pixel in the canonical sheet space)
 *
 * Outputs
 * -------
 * FootParameters with source = "mask_2d"
 *
 * Algorithm overview
 * ------------------
 * 1. Bounding box + longitudinal axis via principal axis (PCA on silhouette pixels).
 * 2. Project silhouette onto longitudinal axis → heel/toe endpoints → length.
 * 3. Slice perpendicular to longitudinal axis at four fractional positions
 *    (metatarsal ~38 %, midfoot ~55-60 %, heel ~85 %) → widths.
 * 4. Chippaux-Smirak Index (CSI) = midfootWidth / metatarsalWidth × 100.
 * 5. Toe detection: scan narrow strip at top (distal) end for individual lobes.
 * 6. Classify toe shape from lobe tip positions.
 */

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

type Pt2 = { x: number; y: number };

function centroid2D(mask: Uint8Array, w: number, h: number): Pt2 {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  if (n === 0) return { x: w / 2, y: h / 2 };
  return { x: sx / n, y: sy / n };
}

/** 2×2 covariance of foreground pixels. Returns [cxx, cxy, cyy]. */
function covariance2D(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number
): [number, number, number] {
  let cxx = 0;
  let cxy = 0;
  let cyy = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        const dx = x - cx;
        const dy = y - cy;
        cxx += dx * dx;
        cxy += dx * dy;
        cyy += dy * dy;
        n++;
      }
    }
  }
  if (n < 2) return [1, 0, 1];
  const inv = 1 / n;
  return [cxx * inv, cxy * inv, cyy * inv];
}

/**
 * Largest eigenvector of a 2×2 symmetric matrix [a, b; b, c].
 * Returns unit vector along the principal (long) axis.
 */
function principalAxis2D(a: number, b: number, c: number): Pt2 {
  const trace = a + c;
  const det = a * c - b * b;
  const disc = Math.max(0, (trace * trace) / 4 - det);
  const lambda1 = trace / 2 + Math.sqrt(disc);
  const dx = lambda1 - c;
  const dy = b;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/** Project every foreground pixel onto axis `dir` (unit vector) through `origin`. Returns [min, max]. */
function projectMaskOnAxis(
  mask: Uint8Array,
  w: number,
  h: number,
  origin: Pt2,
  dir: Pt2
): { min: number; max: number; minPt: Pt2; maxPt: Pt2 } {
  let mn = Infinity;
  let mx = -Infinity;
  let mnx = 0;
  let mny = 0;
  let mxx = 0;
  let mxy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const t = (x - origin.x) * dir.x + (y - origin.y) * dir.y;
      if (t < mn) {
        mn = t;
        mnx = x;
        mny = y;
      }
      if (t > mx) {
        mx = t;
        mxx = x;
        mxy = y;
      }
    }
  }
  return { min: mn, max: mx, minPt: { x: mnx, y: mny }, maxPt: { x: mxx, y: mxy } };
}

/** Width of the foreground slice at a cross-section perpendicular to `dir` at parameter `t`. */
function sliceWidthAtT(
  mask: Uint8Array,
  w: number,
  h: number,
  origin: Pt2,
  dir: Pt2,
  perp: Pt2,
  t: number,
  bandHalf: number
): number {
  let mn = Infinity;
  let mx = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const proj = (x - origin.x) * dir.x + (y - origin.y) * dir.y;
      if (Math.abs(proj - t) > bandHalf) continue;
      const s = (x - origin.x) * perp.x + (y - origin.y) * perp.y;
      if (s < mn) mn = s;
      if (s > mx) mx = s;
    }
  }
  if (!isFinite(mn)) return 0;
  return mx - mn;
}

// ---------------------------------------------------------------------------
// Toe detection
// ---------------------------------------------------------------------------

/**
 * Detect individual toe tips from the distal 20 % of the foot silhouette.
 * Returns up to 5 lobe tip positions (in the longitudinal direction, pixels from heel).
 */
function detectToeTips(
  mask: Uint8Array,
  w: number,
  h: number,
  origin: Pt2,
  dir: Pt2,
  perp: Pt2,
  footLengthPx: number,
  toeZoneStart: number,
  bandHalf: number
): number[] {
  // Build a profile: for each scan-line along `dir`, record how many pixels are on.
  // We step finely through the toe zone and measure cross-section width at each t.
  const STEPS = 80;
  const profile: { t: number; width: number }[] = [];
  for (let s = 0; s <= STEPS; s++) {
    const t = toeZoneStart + (s / STEPS) * footLengthPx * 0.22;
    const width = sliceWidthAtT(mask, w, h, origin, dir, perp, t, bandHalf);
    profile.push({ t, width });
  }

  // Detect local maxima (toe lobes widen then narrow)
  const tips: number[] = [];
  for (let i = 1; i < profile.length - 1; i++) {
    if (
      profile[i].width > profile[i - 1].width &&
      profile[i].width > profile[i + 1].width &&
      profile[i].width > 2
    ) {
      tips.push(profile[i].t);
    }
  }
  return tips;
}

/**
 * Map detected tip positions to 5-toe model.
 * When fewer than 5 tips are found the array is extrapolated with decreasing offsets.
 */
function mapToFiveToes(tipsPx: number[], baseT: number): ToeRelativeLengths {
  // sort descending (longest first)
  const sorted = [...tipsPx].sort((a, b) => b - a);

  const get = (i: number): number => {
    if (i < sorted.length) return Math.max(0, sorted[i] - baseT);
    // Extrapolate: each missing toe ~4 % shorter than previous
    const prev = i > 0 ? Math.max(0, sorted[Math.min(i - 1, sorted.length - 1)] - baseT) : 0;
    return Math.max(0, prev * 0.96);
  };

  return { t1: get(0), t2: get(1), t3: get(2), t4: get(3), t5: get(4) };
}

function classifyToeShape(rel: ToeRelativeLengths): ToeShape {
  const { t1, t2, t3 } = rel;
  const max = Math.max(t1, t2, t3, rel.t4, rel.t5);
  if (max < 1e-3) return "egyptian";

  const n1 = t1 / max;
  const n2 = t2 / max;
  const n3 = t3 / max;

  // Greek: t2 clearly longer than t1
  if (n2 > n1 + 0.05) return "greek";

  // Roman: t1, t2, t3 within 10 % of each other
  const spread = Math.max(n1, n2, n3) - Math.min(n1, n2, n3);
  if (spread < 0.10) return "roman";

  // Egyptian: t1 longest and clearly decreasing
  return "egyptian";
}

// ---------------------------------------------------------------------------
// Arch analysis from mask (2D only → CSI)
// ---------------------------------------------------------------------------

function classifyArchFromCSI(csi: number): ArchType {
  if (csi < 0) return "normal";
  if (csi >= 45) return "flat";
  if (csi < 30) return "high";
  return "normal";
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type MaskExtractionOptions = {
  /** Width of horizontal band (pixels) used for each cross-section measurement. Default: 3. */
  bandHalfPx?: number;
};

/**
 * Extract structured foot parameters from a plantar binary mask.
 *
 * @param mask       Uint8Array (0 or 1) of size width × height, row-major.
 * @param width      Image width in pixels.
 * @param height     Image height in pixels.
 * @param mmPerPixel Physical scale factor.
 * @param options    Tunable extraction parameters.
 */
export function extractFootParametersFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  mmPerPixel: number,
  options: MaskExtractionOptions = {}
): FootParameters {
  const warnings: string[] = [];
  const bandHalf = options.bandHalfPx ?? 3;

  const pixelCount = mask.reduce((s, v) => s + v, 0);
  if (pixelCount < 50) {
    warnings.push("Mask has too few foreground pixels; results unreliable.");
  }

  // 1. Centroid and principal axis
  const cen = centroid2D(mask, width, height);
  const [cxx, cxy, cyy] = covariance2D(mask, width, height, cen.x, cen.y);
  const dir = principalAxis2D(cxx, cxy, cyy);
  const perp: Pt2 = { x: -dir.y, y: dir.x };

  // 2. Foot extent along principal axis
  const extent = projectMaskOnAxis(mask, width, height, cen, dir);
  const footLengthPx = extent.max - extent.min;

  // Convention: heel = minPt side (more negative t), toe = maxPt side.
  // For an upward-oriented scan the principal axis points heel→toe.
  // (We do not enforce orientation here; downstream callers or biometry can refine.)
  const heelT = extent.min;
  const toeT = extent.max;

  // 3. Cross-section widths at fractions of foot length
  const fMetatarsal = 0.38;
  const fMidfoot = 0.57;
  const fHeel = 0.85;

  const tMeta = heelT + fMetatarsal * footLengthPx;
  const tMid = heelT + fMidfoot * footLengthPx;
  const tHeel = heelT + fHeel * footLengthPx;

  const metaWidthPx = sliceWidthAtT(mask, width, height, cen, dir, perp, tMeta, bandHalf);
  const midWidthPx = sliceWidthAtT(mask, width, height, cen, dir, perp, tMid, bandHalf);
  const heelWidthPx = sliceWidthAtT(mask, width, height, cen, dir, perp, tHeel, bandHalf);

  const lengthMm = footLengthPx * mmPerPixel;
  const maxWidthMm = metaWidthPx * mmPerPixel;
  const midfootWidthMm = midWidthPx * mmPerPixel;
  const heelWidthMm = heelWidthPx * mmPerPixel;

  if (maxWidthMm < 1) warnings.push("Metatarsal width near zero — scale may be incorrect.");

  // 4. Chippaux-Smirak Index
  const csi = maxWidthMm > 0 ? (midfootWidthMm / maxWidthMm) * 100 : -1;

  // 5. Toe detection (distal 20 % of silhouette)
  const tipsPx = detectToeTips(
    mask,
    width,
    height,
    cen,
    dir,
    perp,
    footLengthPx,
    heelT,
    bandHalf
  );

  const toeConf = tipsPx.length >= 3 ? 0.65 : tipsPx.length >= 1 ? 0.4 : 0.2;
  if (tipsPx.length < 3) {
    warnings.push(
      `Only ${tipsPx.length} toe lobe(s) detected — toe shape classification may be inaccurate.`
    );
  }

  const toeAbsMm = mapToFiveToes(tipsPx, heelT);
  const scale = mmPerPixel;
  const tipPosMm: ToeRelativeLengths = {
    t1: toeAbsMm.t1 * scale,
    t2: toeAbsMm.t2 * scale,
    t3: toeAbsMm.t3 * scale,
    t4: toeAbsMm.t4 * scale,
    t5: toeAbsMm.t5 * scale,
  };
  const maxTipMm = Math.max(tipPosMm.t1, tipPosMm.t2, tipPosMm.t3, tipPosMm.t4, tipPosMm.t5, 1);
  const relLengths: ToeRelativeLengths = {
    t1: tipPosMm.t1 / maxTipMm,
    t2: tipPosMm.t2 / maxTipMm,
    t3: tipPosMm.t3 / maxTipMm,
    t4: tipPosMm.t4 / maxTipMm,
    t5: tipPosMm.t5 / maxTipMm,
  };

  const toeShape = classifyToeShape(relLengths);

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
    archType: classifyArchFromCSI(csi),
  };

  const toes: ToeAlignment = {
    relativeLengths: relLengths,
    tipPositionsMm: tipPosMm,
    toeShape,
    confidence: toeConf,
  };

  // Quality score: penalise low pixel count, missing toes, zero widths
  let quality = 1.0;
  if (pixelCount < 500) quality -= 0.3;
  if (tipsPx.length < 3) quality -= 0.2;
  if (maxWidthMm < 1) quality -= 0.3;
  quality = Math.max(0, Math.min(1, quality));

  return {
    schema: "neuma.foot-parameters.v1",
    source: "mask_2d",
    dimensions,
    arch,
    toes,
    qualityScore: quality,
    extractedAt: new Date().toISOString(),
    warnings,
  };
}

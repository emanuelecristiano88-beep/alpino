/**
 * Neutral, smooth parametric foot — deterministic, no sampling noise.
 * Used for 3D preview base mesh and fallback point clouds.
 */

import type { PointCloud } from "@/lib/reconstruction/types";
import type { FootVolume, ToeType } from "@/lib/visualization/footParams";

export type TemplatePreviewMeasurementsMm = {
  footLengthMm: number;
  maxWidthMm: number;
  forefootWidthMm: number;
  footHeightMm: number;
  archHeightMm: number;
  archCurvatureIndex: number;
  heelWidthMm: number;
  toeWidthMm: number;
  toeAlignmentScore: number;
  toeType: ToeType;
  volumeType: FootVolume;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Half-width (unit square template) along normalized length t ∈ [0,1]. */
export function footHalfWidth01(t: number): number {
  const sinT = Math.sin(Math.PI * t);
  let halfW = 0.162 + 0.277 * Math.pow(Math.max(0, sinT), 0.89);
  halfW += 0.028 * Math.exp(-Math.pow((t - 0.905) / 0.092, 2));
  halfW += 0.024 * Math.exp(-Math.pow((t - 0.095) / 0.092, 2));
  return halfW;
}

/** Neutral adult template priors (mm / indices). */
export const NEUTRAL_TEMPLATE_MEASUREMENTS: TemplatePreviewMeasurementsMm = {
  footLengthMm: 262,
  maxWidthMm: 98,
  forefootWidthMm: 96,
  footHeightMm: 52,
  archHeightMm: 17,
  archCurvatureIndex: 0.038,
  heelWidthMm: 78,
  toeWidthMm: 90,
  toeAlignmentScore: 0.72,
  toeType: "roman",
  volumeType: "normal",
};

/** Derive a calm template prior from only length + width (reconstruction fallback). */
export function templateMeasurementsFromMetrics(metrics: {
  footLengthMm: number;
  forefootWidthMm: number;
}): TemplatePreviewMeasurementsMm {
  const L = Math.max(120, metrics.footLengthMm);
  const W = Math.max(50, metrics.forefootWidthMm);
  const ratio = W / L;
  const vol: FootVolume = ratio < 0.34 ? "slim" : ratio > 0.41 ? "wide" : "normal";
  return {
    footLengthMm: L,
    maxWidthMm: W * 1.02,
    forefootWidthMm: W,
    footHeightMm: clamp01(L / 265) * 52,
    archHeightMm: 14 + 5 * (1 - ratio * 2.2),
    archCurvatureIndex: 0.036,
    heelWidthMm: W * 0.82,
    toeWidthMm: W * 0.94,
    toeAlignmentScore: 0.72,
    toeType: "roman",
    volumeType: vol,
  };
}

function lerp(a: number, b: number, w: number) {
  return a + (b - a) * w;
}

/**
 * Pulls noisy scan estimates toward neutral so the preview stays smooth and readable.
 * `scanWeight` ∈ [0,1]: 1 = full scan estimate, 0 = neutral only.
 */
/**
 * Dimensioni usate per adattare il template alla scansione (mm).
 * Lunghezza / larghezza / altezza da estensioni e bin della stima nuvola.
 */
export function templateFitDimensionsFromMeasurements(m: TemplatePreviewMeasurementsMm): {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
} {
  const lengthMm = Math.max(118, m.footLengthMm);
  const widthMm = Math.max(48, Math.max(m.forefootWidthMm, m.maxWidthMm));
  const heightMm = Math.max(22, m.footHeightMm);
  return { lengthMm, widthMm, heightMm };
}

/**
 * @param scanWeight 0..1 blend for arch / tallone / classificazioni (modello più pulito).
 * @param principalScanWeight 0..1 blend per lunghezza, larghezze e altezza (fit alla scansione).
 */
export function blendMeasurementsTowardNeutral(
  estimated: TemplatePreviewMeasurementsMm,
  scanWeight: number,
  principalScanWeight: number = Math.min(1, scanWeight + 0.34)
): TemplatePreviewMeasurementsMm {
  const w = clamp01(scanWeight);
  const wp = clamp01(principalScanWeight);
  const n = NEUTRAL_TEMPLATE_MEASUREMENTS;
  return {
    footLengthMm: lerp(n.footLengthMm, estimated.footLengthMm, wp),
    maxWidthMm: lerp(n.maxWidthMm, estimated.maxWidthMm, wp),
    forefootWidthMm: lerp(n.forefootWidthMm, estimated.forefootWidthMm, wp),
    footHeightMm: lerp(n.footHeightMm, estimated.footHeightMm, wp),
    archHeightMm: lerp(n.archHeightMm, estimated.archHeightMm, w),
    archCurvatureIndex: lerp(n.archCurvatureIndex, estimated.archCurvatureIndex, w),
    heelWidthMm: lerp(n.heelWidthMm, estimated.heelWidthMm, w),
    toeWidthMm: lerp(n.toeWidthMm, estimated.toeWidthMm, w),
    toeAlignmentScore: lerp(n.toeAlignmentScore, estimated.toeAlignmentScore, w),
    toeType: w > 0.55 ? estimated.toeType : n.toeType,
    volumeType: w > 0.55 ? estimated.volumeType : n.volumeType,
  };
}

/**
 * Regular grid on the top surface — no random jitter (clean input for template fitting).
 */
export function buildSmoothFootPointCloudMm(metrics: {
  footLengthMm: number;
  forefootWidthMm: number;
}): PointCloud {
  const length = Math.max(120, metrics.footLengthMm);
  const width = Math.max(50, metrics.forefootWidthMm);
  const height = Math.max(28, Math.min(76, Math.round(length * 0.21)));

  const nu = 54;
  const nv = 30;
  const count = nu * nv;
  const pos = new Float32Array(count * 3);

  let w = 0;
  for (let iu = 0; iu < nu; iu++) {
    const t = (iu + 0.5) / nu;
    const z = (t - 0.5) * length;

    const hw = footHalfWidth01(t) * width;
    const halfW = hw * 0.5;

    const sinT = Math.sin(Math.PI * t);
    const archGate = smoothstep(0.22, 0.50, t) * smoothstep(0.8, 0.58, t);
    const midArch = Math.pow(Math.max(0, sinT), 1.48);

    for (let iv = 0; iv < nv; iv++) {
      const vn = (iv + 0.5) / nv;
      const v = vn * 2 - 1;
      const x = v * halfW;

      const medial = Math.exp(-Math.pow(v / 0.6, 2));
      const archShape = archGate * midArch * medial;

      const toeW = Math.exp(-Math.pow((t - 0.93) / 0.095, 2));
      const heelW = Math.exp(-Math.pow((t - 0.07) / 0.095, 2));
      const toeHeel = 0.84 * toeW + 0.88 * heelW;

      const yNorm = 0.72 * toeHeel + 0.5 * archShape;
      const y = yNorm * height;

      pos[w++] = x;
      pos[w++] = y;
      pos[w++] = z;
    }
  }

  return { positions: pos, pointCount: count };
}

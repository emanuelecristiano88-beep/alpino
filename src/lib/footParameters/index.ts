/**
 * Foot Parameters — public API
 *
 * Three extraction paths (use whichever data is available):
 *
 * 1. From binary plantar mask (fastest, 2D only):
 *      extractFootParametersFromMask(mask, w, h, mmPerPixel)
 *
 * 2. From calibrated biometry result (best 2D accuracy, metric keypoints):
 *      extractFootParametersFromBiometry(biometryResult)
 *
 * 3. From merged 3D point cloud (full 3D — arch angle, navicular height):
 *      extractFootParametersFromPointCloud(cloud)
 *
 * 4. Fused (2D biometry + 3D cloud — recommended when both are available):
 *      extractFootParameters({ biometry, cloud })
 *
 * All functions return `FootParameters` — a schema-versioned structured object
 * ready to drive parametric model deformation.
 */

export type {
  FootParameters,
  FootDimensions,
  ArchAnalysis,
  ArchType,
  ToeAlignment,
  ToeShape,
  ToeRelativeLengths,
  ExtractionSource,
} from "./types";

export { extractFootParametersFromMask } from "./fromMask";
export type { MaskExtractionOptions } from "./fromMask";

export { extractFootParametersFromBiometry } from "./fromBiometry";

export { extractFootParametersFromPointCloud } from "./fromPointCloud";

// ---------------------------------------------------------------------------
// Fusion: combine 2D biometry and 3D point cloud
// ---------------------------------------------------------------------------

import type { NeumaBiometryResult } from "../biometry/types";
import type { PointCloud } from "../reconstruction/types";
import type { FootParameters, ToeRelativeLengths } from "./types";
import { extractFootParametersFromBiometry } from "./fromBiometry";
import { extractFootParametersFromPointCloud } from "./fromPointCloud";

export type ExtractFootParametersInput = {
  /** Pass a calibrated biometry result for best 2D metric accuracy. */
  biometry?: NeumaBiometryResult;
  /** Pass a merged 3D point cloud for arch angle, navicular height, and 3D widths. */
  cloud?: PointCloud;
};

/**
 * Convenience function that fuses 2D biometry and 3D point cloud when both are provided.
 *
 * Fusion strategy:
 * - Dimensions: prefer 2D biometry (metric calibration from ArUco) for length / forefoot width.
 *   Complement with 3D cloud for heel width and ball girth.
 * - Arch: take arch angle + navicular height from 3D (unavailable in 2D);
 *   use biometry CSI when cloud CSI is unreliable.
 * - Toes: use whichever source has higher confidence.
 * - Quality: weighted average of both quality scores.
 */
export function extractFootParameters(input: ExtractFootParametersInput): FootParameters {
  const { biometry, cloud } = input;

  if (!biometry && !cloud) {
    throw new Error("extractFootParameters: provide at least one of `biometry` or `cloud`.");
  }

  if (biometry && !cloud) {
    return extractFootParametersFromBiometry(biometry);
  }

  if (cloud && !biometry) {
    return extractFootParametersFromPointCloud(cloud);
  }

  // Both available — fuse.
  const b = extractFootParametersFromBiometry(biometry!);
  const c = extractFootParametersFromPointCloud(cloud!);

  const warnings: string[] = [
    ...b.warnings.map((w) => `[biometry] ${w}`),
    ...c.warnings.map((w) => `[cloud] ${w}`),
  ];

  // Dimensions: 2D biometry for length/metatarsal width (calibrated mm), 3D for heel
  const lengthMm = b.dimensions.lengthMm > 0 ? b.dimensions.lengthMm : c.dimensions.lengthMm;
  const maxWidthMm = b.dimensions.maxWidthMm > 0 ? b.dimensions.maxWidthMm : c.dimensions.maxWidthMm;
  const midfootWidthMm =
    b.dimensions.midfootWidthMm > 0 ? b.dimensions.midfootWidthMm : c.dimensions.midfootWidthMm;
  const heelWidthMm =
    c.dimensions.heelWidthMm > 0 ? c.dimensions.heelWidthMm : b.dimensions.heelWidthMm;
  const ballGirthMm = Math.PI * maxWidthMm;

  // Arch: 3D provides angle + navicular height; use biometry CSI when available
  const csi = b.arch.csi >= 0 ? b.arch.csi : c.arch.csi;
  const archAngleDeg = c.arch.archAngleDeg;
  const navicularHeightMm = c.arch.navicularHeightMm;

  // Re-classify arch with best available data
  const archType = (() => {
    if (csi >= 0) {
      if (csi >= 45) return "flat" as const;
      if (csi < 30) return "high" as const;
      return "normal" as const;
    }
    return c.arch.archType;
  })();

  // Toes: pick higher-confidence source
  const toes = b.toes.confidence >= c.toes.confidence ? b.toes : c.toes;

  // Quality: weighted average (biometry slightly down-weighted since it's 2D only)
  const quality = Math.min(1, 0.45 * b.qualityScore + 0.55 * c.qualityScore);

  return {
    schema: "neuma.foot-parameters.v1",
    source: "combined",
    dimensions: { lengthMm, maxWidthMm, midfootWidthMm, heelWidthMm, ballGirthMm },
    arch: { csi, archAngleDeg, navicularHeightMm, archType },
    toes,
    qualityScore: quality,
    extractedAt: new Date().toISOString(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Utility: human-readable summary string (useful for debugging / UI tooltips)
// ---------------------------------------------------------------------------

/**
 * Return a compact human-readable summary of foot parameters for debugging or display.
 */
export function formatFootParametersSummary(p: FootParameters): string {
  const { dimensions: d, arch: a, toes: t } = p;
  const toeShapeLabel = t.toeShape.charAt(0).toUpperCase() + t.toeShape.slice(1);
  const archLabel = a.archType.charAt(0).toUpperCase() + a.archType.slice(1);

  const lines = [
    `Source: ${p.source}  |  Quality: ${Math.round(p.qualityScore * 100)} %`,
    `Length: ${d.lengthMm.toFixed(1)} mm  |  Width: ${d.maxWidthMm.toFixed(1)} mm  |  Heel: ${d.heelWidthMm.toFixed(1)} mm`,
    `Midfoot: ${d.midfootWidthMm.toFixed(1)} mm  |  Ball girth ≈ ${d.ballGirthMm.toFixed(1)} mm`,
    `Arch: ${archLabel}  (CSI ${a.csi >= 0 ? a.csi.toFixed(1) + " %" : "n/a"}${a.archAngleDeg >= 0 ? "  angle " + a.archAngleDeg.toFixed(1) + "°" : ""}${a.navicularHeightMm >= 0 ? "  nav " + a.navicularHeightMm.toFixed(1) + " mm" : ""})`,
    `Toe shape: ${toeShapeLabel}  (conf ${Math.round(t.confidence * 100)} %)`,
    toeRelLengthsSummary(t.relativeLengths),
  ];
  if (p.warnings.length) lines.push(`Warnings: ${p.warnings.join("; ")}`);
  return lines.join("\n");
}

function toeRelLengthsSummary(r: ToeRelativeLengths): string {
  const fmt = (v: number) => (v * 100).toFixed(0) + "%";
  return `Toes (rel): T1=${fmt(r.t1)}  T2=${fmt(r.t2)}  T3=${fmt(r.t3)}  T4=${fmt(r.t4)}  T5=${fmt(r.t5)}`;
}

export type ToeType = "egyptian" | "roman" | "greek";
export type FootVolume = "slim" | "normal" | "wide";

export type FootDeformParams = {
  /** Uniform scales applied to template axes (unitless). */
  lengthScale: number;
  widthScale: number;
  heightScale: number;

  /** Arch height bucket derived from scan. */
  archHeight: "low" | "medium" | "high";
  /** Volume bucket derived from scan. */
  footVolume: FootVolume;
  /** Heel width scale relative to template heel width (unitless). */
  heelWidth: number;

  toeType: ToeType;
};

export type ScanFootMeasurementsMm = {
  footLengthMm: number;
  forefootWidthMm: number;
  footHeightMm: number;
  archHeightMm: number;
  heelWidthMm: number;
  toeType: ToeType;
  volumeType: FootVolume;
};

export type TemplateFootReference = {
  baseLength: number;
  baseWidth: number;
  baseHeightNorm: number;
  baseHeelWidth: number;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function computeFootDeformParams(
  measurements: ScanFootMeasurementsMm,
  template: TemplateFootReference
): FootDeformParams {
  const footLen = Math.max(1e-6, measurements.footLengthMm);
  const forefootWidth = Math.max(1e-6, measurements.forefootWidthMm);
  const footHeight = Math.max(1e-6, measurements.footHeightMm);
  const archHeightMm = Math.max(0, measurements.archHeightMm);

  const lengthScale = footLen / Math.max(1e-6, template.baseLength);
  const widthScale = forefootWidth / Math.max(1e-6, template.baseWidth);
  // template Z is normalized (0..1): map to mm through baseHeightNorm
  const heightScale = footHeight / Math.max(1e-6, template.baseHeightNorm);

  const archRatio = archHeightMm / footHeight;
  const archHeight: FootDeformParams["archHeight"] =
    archRatio < 0.22 ? "low" : archRatio < 0.32 ? "medium" : "high";

  const heelWidthScale = measurements.heelWidthMm / Math.max(1e-6, template.baseHeelWidth);

  return {
    lengthScale: clamp(lengthScale, 0.7, 1.6),
    widthScale: clamp(widthScale, 0.75, 1.55),
    heightScale: clamp(heightScale, 0.7, 1.8),
    archHeight,
    footVolume: measurements.volumeType,
    heelWidth: clamp(heelWidthScale, 0.75, 1.55),
    toeType: measurements.toeType,
  };
}


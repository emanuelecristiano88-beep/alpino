/**
 * Foot scan parameters — structured output for driving parametric model deformation.
 *
 * Units: millimetres unless noted. Coordinate system for 2D contour:
 *   origin top-left of canonical sheet, X right, Y down.
 * For 3D point cloud the coordinate frame is the merged world frame from reconstruction.
 */

// ---------------------------------------------------------------------------
// Toe shape classification
// ---------------------------------------------------------------------------

/**
 * Classic clinical toe-shape taxonomy based on relative digit lengths.
 *
 * - Egyptian:  hallux (big toe) is longest, decreasing series
 * - Roman:     first three toes roughly equal in length
 * - Greek:     second toe longer than hallux (index toe protrusion)
 */
export type ToeShape = "egyptian" | "roman" | "greek";

// ---------------------------------------------------------------------------
// Arch classification
// ---------------------------------------------------------------------------

/**
 * Simplified arch type derived from the Chippaux-Smirak Index (CSI) or
 * the medial arch angle when 3D data is available.
 *
 * - flat:   CSI ≥ 45 %  (pes planus)
 * - normal: CSI 30–44 %
 * - high:   CSI < 30 %  (pes cavus)
 */
export type ArchType = "flat" | "normal" | "high";

// ---------------------------------------------------------------------------
// Toe alignment
// ---------------------------------------------------------------------------

/** Relative lengths (mm) for each toe estimated from the 2D contour. */
export type ToeRelativeLengths = {
  /** Hallux (big toe), always present. */
  t1: number;
  /** Index toe. */
  t2: number;
  /** Middle toe. */
  t3: number;
  /** Ring toe. */
  t4: number;
  /** Little toe — least reliable from top-view silhouette. */
  t5: number;
};

export type ToeAlignment = {
  /** Normalised relative lengths (ratio vs longest toe, 0–1). */
  relativeLengths: ToeRelativeLengths;
  /** Absolute tip positions in mm along the longitudinal axis (0 = heel). */
  tipPositionsMm: ToeRelativeLengths;
  /** Classified toe shape. */
  toeShape: ToeShape;
  /** Confidence 0–1 (lower when silhouette resolution is poor). */
  confidence: number;
};

// ---------------------------------------------------------------------------
// Arch analysis
// ---------------------------------------------------------------------------

export type ArchAnalysis = {
  /**
   * Chippaux-Smirak Index (%) = (midfoot_width / metatarsal_width) × 100.
   * Computed from 2D plantar silhouette. −1 when not computable.
   */
  csi: number;
  /**
   * Medial arch angle (degrees) from 3D point cloud heel–navicular–metatarsal triangle.
   * −1 when 3D data is unavailable.
   */
  archAngleDeg: number;
  /**
   * Navicular height above ground plane (mm), from 3D data.
   * −1 when unavailable.
   */
  navicularHeightMm: number;
  /** Derived arch classification. */
  archType: ArchType;
};

// ---------------------------------------------------------------------------
// Foot dimensions
// ---------------------------------------------------------------------------

export type FootDimensions = {
  /** Heel-to-toe length along the longitudinal axis (mm). */
  lengthMm: number;
  /** Maximum forefoot width at the metatarsal heads (mm). */
  maxWidthMm: number;
  /** Width at the midfoot (arch waist), used for CSI (mm). */
  midfootWidthMm: number;
  /** Heel width (mm). */
  heelWidthMm: number;
  /**
   * Ball girth — perimeter of the foot at metatarsal level from plantar view (mm).
   * Approximated as π × maxWidthMm when full 3D is unavailable.
   */
  ballGirthMm: number;
};

// ---------------------------------------------------------------------------
// Full structured parameter output
// ---------------------------------------------------------------------------

/** Source of data used for extraction — useful for confidence weighting. */
export type ExtractionSource =
  | "mask_2d"
  | "biometry_keypoints"
  | "point_cloud_3d"
  | "combined";

export type FootParameters = {
  /** Schema version for forward-compatibility. */
  schema: "neuma.foot-parameters.v1";
  /**
   * Which data source was used for this extraction.
   * "combined" means 2D biometry + 3D point cloud were fused.
   */
  source: ExtractionSource;

  dimensions: FootDimensions;
  arch: ArchAnalysis;
  toes: ToeAlignment;

  /**
   * Overall extraction quality 0–1.
   * Reflects contour coverage, point-cloud density, etc.
   */
  qualityScore: number;

  /** ISO timestamp of extraction. */
  extractedAt: string;

  /** Non-critical warnings produced during extraction. */
  warnings: string[];
};

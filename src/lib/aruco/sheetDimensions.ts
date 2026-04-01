/**
 * Physical dimensions of the A4 reference sheet used as the scanning target.
 * These values are the authoritative source shared between pose estimation
 * (world corners in poseEstimation.ts) and the scan payload builder.
 */
export const A4_SHEET_DIMS_MM = {
  widthMm:  297,   // long side (landscape orientation)
  heightMm: 210,   // short side
} as const;

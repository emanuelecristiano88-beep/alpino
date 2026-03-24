export {
  estimateRelativeDepthNormalized,
  normalizeDepth01,
} from "./depthEstimation";
export type { DepthBackend } from "./depthEstimation";

export { extractFootMask, extractFootMaskAi } from "./segmentFoot";
export { depthMapToPointCloud } from "./depthToPointCloud";
export { transformPointByPhase, phaseGroup } from "./phaseAlignment";
export { mergePointCloudsVoxelAverage } from "./mergePointClouds";
export { alignPointCloudsMultiView } from "./multiViewAlign";
export type { MultiViewAlignOptions, PerViewCloud } from "./multiViewAlign";
export { downscaleImageDataMaxSide } from "./imageResize";

export {
  reconstructFootFromCapturedViews,
  reconstructFootFromBlobs,
  blobToImageData,
} from "./pipeline";

export type {
  Vec3,
  PointCloud,
  CapturedView,
  ReconstructionOptions,
  ReconstructionResult,
} from "./types";
export { DEFAULT_RECONSTRUCTION_OPTIONS } from "./types";

export {
  buildFootSurfaceFromPositions,
  laplacianSmoothGeometry,
  centerAndNormalizeFootMesh,
  DEFAULT_FOOT_SURFACE_OPTIONS,
} from "./footSurfaceMesh";
export type { FootSurfaceOptions } from "./footSurfaceMesh";

// ---------------------------------------------------------------------------
// Base foot mesh + regions + deformation
// ---------------------------------------------------------------------------

export {
  buildFootBaseGeometry,
  DEFAULT_FOOT_BASE_GEOMETRY_OPTIONS,
  DEFAULT_FOOT_PROPORTIONS,
} from "./footBaseGeometry";
export type {
  FootProportions,
  FootBaseGeometryOptions,
} from "./footBaseGeometry";

export {
  classifyFootMeshRegions,
  paintRegionColors,
  describeRegions,
  FOOT_REGION_IDS,
  DEFAULT_REGION_THRESHOLDS,
  REGION_DEBUG_COLORS,
} from "./footMeshRegions";
export type {
  FootRegionId,
  VertexGroup,
  FootMeshRegions,
  RegionThresholds,
} from "./footMeshRegions";

export {
  applyRegionDeformations,
  deformGeometryInPlace,
  DEFORM_PRESETS,
} from "./footMeshDeform";
export type {
  RegionDeformParams,
  RegionDeformMap,
  DeformOptions,
} from "./footMeshDeform";

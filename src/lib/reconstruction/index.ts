export {
  estimateRelativeDepthNormalized,
  normalizeDepth01,
} from "./depthEstimation";
export type { DepthBackend } from "./depthEstimation";

export { extractFootMask, extractFootMaskAi } from "./segmentFoot";
export { depthMapToPointCloud } from "./depthToPointCloud";
export { transformPointByPhase, phaseGroup } from "./phaseAlignment";
export { mergePointCloudsVoxelAverage } from "./mergePointClouds";
export {
  SCAN_PHASE_MERGE_WEIGHT,
  mergeWeightsForPhaseIds,
} from "./zoneMergeWeights";
export { fuseBurstFramesPerScanPhase } from "./zoneFrameAverage";
export { alignPointCloudsMultiView } from "./multiViewAlign";
export type { MultiViewAlignOptions, PerViewCloud } from "./multiViewAlign";
export { downscaleImageDataMaxSide } from "./imageResize";

export {
  reconstructFootFromCapturedViews,
  reconstructFootFromBlobs,
  blobToImageData,
} from "./pipeline";

export { applyMetricScaleToPointCloud } from "./metricScale";

export {
  reconstructStableFootPointCloud,
  DEFAULT_STABLE_FOOT_PIPELINE_OPTIONS,
} from "./stableFootPipeline";
export type {
  StableFootPipelineInput,
  StableFootPipelineResult,
  StableFootPipelineOptions,
  StableFootPipelineFrame,
} from "./stableFootPipeline";

export {
  preprocessFootCapture,
  clearBackgroundOutsideMask,
  normalizeBrightnessMasked,
} from "./preprocessFootImage";
export type { PreprocessedFootFrame, FootMaskMode } from "./preprocessFootImage";

export { transformPointStableZone, STABLE_ZONE_DEGREES } from "./stableZoneTransforms";

export {
  estimateDepthNormalizedAsync,
  multiplyDepthByMask,
} from "./depthMasked";
export type { DepthBackendId } from "./depthMasked";

export {
  cleanPointCloudPipeline,
  radiusOutlierRemoval,
  statisticalOutlierRemoval,
  keepLargestVoxelCluster,
  neighborAverageSmoothing,
  voxelSmoothing,
  DEFAULT_CLEAN_OPTIONS,
} from "./cleanPointCloud";
export type { CleanPointCloudOptions } from "./cleanPointCloud";

export {
  computeBoundingBox,
  computeBoundingBoxFromPointCloud,
  computeFootDimensionsMm,
} from "./footMetrics";
export type { AxisAlignedBoundingBox } from "./footMetrics";

export { pointCloudToPlyAscii, downloadPlyAscii } from "./exportPly";

export {
  regularizeFootPointCloud,
  DEFAULT_FOOT_SHAPE_REGULARIZE_OPTIONS,
} from "./regularizeFootShape";

export type {
  Vec3,
  PointCloud,
  CapturedView,
  ReconstructionOptions,
  ReconstructionResult,
  FootShapeRegularizeOptions,
} from "./types";
export { DEFAULT_RECONSTRUCTION_OPTIONS } from "./types";

export {
  buildFootSurfaceFromPositions,
  laplacianSmoothGeometry,
  centerAndNormalizeFootMesh,
  DEFAULT_FOOT_SURFACE_OPTIONS,
} from "./footSurfaceMesh";
export type { FootSurfaceOptions } from "./footSurfaceMesh";

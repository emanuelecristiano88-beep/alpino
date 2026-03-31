import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import { multiplyDepthByMask, estimateDepthNormalizedAsync, type DepthBackendId } from "./depthMasked";
import { depthMapToPointCloud } from "./depthToPointCloud";
import { preprocessFootCapture, type FootMaskMode } from "./preprocessFootImage";
import { transformPointStableZone } from "./stableZoneTransforms";
import { alignPointCloudsMultiView, type PerViewCloud } from "./multiViewAlign";
import { mergePointCloudsVoxelAverage } from "./mergePointClouds";
import { mergeWeightsForPhaseIds } from "./zoneMergeWeights";
import { fuseBurstFramesPerScanPhase } from "./zoneFrameAverage";
import { cleanPointCloudPipeline, type CleanPointCloudOptions } from "./cleanPointCloud";
import { applyMetricScaleToPointCloud } from "./metricScale";
import {
  computeBoundingBoxFromPointCloud,
  computeFootDimensionsMm,
  type AxisAlignedBoundingBox,
} from "./footMetrics";
import { blobToImageData } from "./pipeline";
import type { FootShapeRegularizeOptions, PointCloud } from "./types";
import {
  regularizeFootPointCloud,
} from "./regularizeFootShape";

export type StableFootPipelineFrame = {
  blob: Blob;
  phaseId: ScanPhaseId;
};

export type StableFootPipelineInput = {
  /** Burst / multi-frame per zona: ogni item ha `phaseId` TOP/OUTER/INNER/HEEL (0–3). */
  frames: StableFootPipelineFrame[];
  maskMode?: FootMaskMode;
  depthBackend?: DepthBackendId;
  /**
   * Scala metrica reale (moltiplicatore uniforme su XYZ), es. da ArUco / lato corto A4 210 mm.
   * Se omesso, la nuvola resta in unità relative coerenti con depthNear/Far.
   */
  metricScaleFactor?: number;
  /** Nuvole da sessioni precedenti: mediate con merge voxel per ridurre jitter. */
  stabilizeWithClouds?: PointCloud[];
  options?: Partial<StableFootPipelineOptions>;
};

export type StableFootPipelineOptions = {
  maxImageSide: number;
  depthNearMm: number;
  depthFarMm: number;
  focalLengthNorm: number;
  sampleStep: number;
  mergeVoxelMm: number;
  multiViewAlign: boolean;
  multiViewRefinementIterations: number;
  multiViewReferenceCloudIndex: number;
  /** Media burst per stessa fase prima dell’allineamento (default: true). */
  intraZoneFrameAverage?: boolean;
  /** Voxel mm per media intra-zona; default `min(3, mergeVoxelMm * 0.55)`. */
  intraZoneFrameVoxelMm?: number;
  /** Merge voxel tra zone con pesi per fase (default: true). */
  phaseWeightedMerge?: boolean;
  /** Regolarizza forma dopo pulizia (picchi, profondità, smoothing). Default: true. */
  footShapeRegularize?: boolean;
  footShapeRegularizeOptions?: Partial<FootShapeRegularizeOptions>;
  clean: Partial<CleanPointCloudOptions>;
};

export const DEFAULT_STABLE_FOOT_PIPELINE_OPTIONS: StableFootPipelineOptions = {
  maxImageSide: 384,
  depthNearMm: 40,
  depthFarMm: 120,
  focalLengthNorm: 0.65,
  sampleStep: 2,
  mergeVoxelMm: 3.5,
  multiViewAlign: true,
  multiViewRefinementIterations: 3,
  multiViewReferenceCloudIndex: 0,
  intraZoneFrameAverage: true,
  phaseWeightedMerge: true,
  footShapeRegularize: true,
  clean: {},
};

export type StableFootPipelineResult = {
  pointCloud: PointCloud;
  boundingBox: AxisAlignedBoundingBox;
  dimensionsMm: { length: number; width: number; height: number };
  meta: {
    viewCount: number;
    pointsPerView: number[];
    durationMs: number;
    depthBackend: DepthBackendId;
    cleaningApplied: boolean;
    metricScaleApplied: boolean;
    stabilizationClouds: number;
    pointsPerInputFrame?: number[];
    intraZoneFrameAverageApplied?: boolean;
    zoneCloudCount?: number;
    zonePhaseIds?: ScanPhaseId[];
    phaseWeightedMergeApplied?: boolean;
    footShapeRegularizeApplied?: boolean;
  };
};

function toPerView(cloud: PointCloud): PerViewCloud {
  return {
    positions: cloud.positions,
    colors: cloud.colors,
    count: cloud.pointCount,
  };
}

/**
 * Pipeline stabile end-to-end: preprocess → depth (mask) → point cloud per frame con trasformazioni zona →
 * allineamento multi-vista → merge voxel → pulizia → regolarizzazione forma → scala metrica opzionale → (opz.) media sessioni.
 * Ottimizzata per fitting calzature, non per rendering fotorealistico.
 */
export async function reconstructStableFootPointCloud(
  input: StableFootPipelineInput
): Promise<StableFootPipelineResult> {
  if (!input.frames?.length) {
    throw new Error("reconstructStableFootPointCloud: servono uno o più frame { blob, phaseId }.");
  }

  const opt: StableFootPipelineOptions = {
    ...DEFAULT_STABLE_FOOT_PIPELINE_OPTIONS,
    ...input.options,
    clean: { ...DEFAULT_STABLE_FOOT_PIPELINE_OPTIONS.clean, ...input.options?.clean },
  };

  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const perView: PerViewCloud[] = [];
  const pointsPerView: number[] = [];

  for (let i = 0; i < input.frames.length; i++) {
    const { blob, phaseId } = input.frames[i];
    const raw = await blobToImageData(blob);
    const { imageData: proc, mask } = await preprocessFootCapture(
      raw,
      opt.maxImageSide,
      input.maskMode ?? "heuristic"
    );
    const depthBackend = input.depthBackend ?? "pseudo";
    let depth = await estimateDepthNormalizedAsync(proc, depthBackend);
    multiplyDepthByMask(depth, mask);

    const cloud = depthMapToPointCloud({
      depth01: depth,
      mask,
      imageData: proc,
      phaseId,
      depthNearMm: opt.depthNearMm,
      depthFarMm: opt.depthFarMm,
      focalLengthNorm: opt.focalLengthNorm,
      sampleStep: opt.sampleStep,
      transformPoint: (p) => transformPointStableZone(p, phaseId),
    });
    perView.push(cloud);
    pointsPerView.push(cloud.count);
  }

  const pointsPerInputFrame = [...pointsPerView];
  let zonePhaseIds: ScanPhaseId[] | undefined;
  let cloudsForAlign = perView;
  let intraFuseApplied = false;

  if (opt.intraZoneFrameAverage !== false && input.frames.length > 0) {
    const intraVoxel =
      opt.intraZoneFrameVoxelMm ??
      // leggermente più grande della media precedente: riduce jitter tra frame
      // quando l'offset di camera introduce piccole differenze di traslazione.
      Math.min(3.2, opt.mergeVoxelMm * 0.65);
    const { fused, zonePhaseIds: zids } = fuseBurstFramesPerScanPhase(
      perView,
      input.frames.map((f) => f.phaseId),
      intraVoxel
    );
    if (fused.length > 0 && fused.length < perView.length) {
      intraFuseApplied = true;
    }
    cloudsForAlign = fused;
    zonePhaseIds = zids;
    pointsPerView.length = 0;
    for (const c of fused) pointsPerView.push(c.count);
  }

  const refIdxRaw = opt.multiViewReferenceCloudIndex;
  const refIdx =
    cloudsForAlign.length > 0
      ? Math.min(Math.max(0, refIdxRaw), cloudsForAlign.length - 1)
      : 0;

  const aligned = opt.multiViewAlign
    ? alignPointCloudsMultiView(cloudsForAlign, {
        referenceCloudIndex: refIdx,
        refinementIterations: opt.multiViewRefinementIterations,
      })
    : cloudsForAlign;

  const phaseIdsForMerge: ScanPhaseId[] =
    zonePhaseIds ?? input.frames.map((f) => f.phaseId);
  const mergeWeights =
    opt.phaseWeightedMerge !== false &&
    phaseIdsForMerge.length === aligned.length
      ? mergeWeightsForPhaseIds(phaseIdsForMerge)
      : undefined;

  let merged = mergePointCloudsVoxelAverage(
    aligned,
    opt.mergeVoxelMm,
    mergeWeights
  );

  const stabilizeClouds = input.stabilizeWithClouds ?? [];
  if (stabilizeClouds.length > 0) {
    const combined = [
      toPerView(merged),
      ...stabilizeClouds.map((c) => ({
        positions: c.positions,
        colors: c.colors,
        count: c.pointCount,
      })),
    ];
    merged = mergePointCloudsVoxelAverage(combined, opt.mergeVoxelMm * 1.15);
  }

  let cleaned = cleanPointCloudPipeline(merged, opt.clean);

  let shaped = cleaned;
  if (opt.footShapeRegularize !== false) {
    shaped = regularizeFootPointCloud(cleaned, opt.footShapeRegularizeOptions ?? {});
  }

  const metricScaleFactor = input.metricScaleFactor;
  let outCloud = shaped;
  if (
    metricScaleFactor != null &&
    metricScaleFactor > 0 &&
    Number.isFinite(metricScaleFactor)
  ) {
    outCloud = applyMetricScaleToPointCloud(shaped, metricScaleFactor);
  }

  const bbox = computeBoundingBoxFromPointCloud(outCloud);
  const dimensionsMm = computeFootDimensionsMm(bbox.min, bbox.max);

  const durationMs =
    typeof performance !== "undefined" ? performance.now() - t0 : 0;

  return {
    pointCloud: outCloud,
    boundingBox: bbox,
    dimensionsMm,
    meta: {
      viewCount: input.frames.length,
      pointsPerView,
      durationMs,
      depthBackend: input.depthBackend ?? "pseudo",
      cleaningApplied: true,
      metricScaleApplied: metricScaleFactor != null && metricScaleFactor > 0,
      stabilizationClouds: stabilizeClouds.length,
      pointsPerInputFrame,
      intraZoneFrameAverageApplied: intraFuseApplied,
      zoneCloudCount: cloudsForAlign.length,
      zonePhaseIds,
      phaseWeightedMergeApplied: mergeWeights != null,
      footShapeRegularizeApplied: opt.footShapeRegularize !== false,
    },
  };
}

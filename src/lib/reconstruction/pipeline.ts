import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import { estimateRelativeDepthNormalized } from "./depthEstimation";
import { depthMapToPointCloud } from "./depthToPointCloud";
import { downscaleImageDataMaxSide } from "./imageResize";
import { alignPointCloudsMultiView } from "./multiViewAlign";
import { mergePointCloudsVoxelAverage } from "./mergePointClouds";
import { mergeWeightsForPhaseIds } from "./zoneMergeWeights";
import { fuseBurstFramesPerScanPhase } from "./zoneFrameAverage";
import { extractFootMask } from "./segmentFoot";
import { regularizeFootPointCloud } from "./regularizeFootShape";
import {
  DEFAULT_RECONSTRUCTION_OPTIONS,
  type CapturedView,
  type ReconstructionOptions,
  type ReconstructionResult,
} from "./types";

/**
 * Pipeline (semplificata, solida) — ordine concettuale:
 *
 *   IMMAGINI → maschera piede → depth (approssimata) → point cloud / frame →
 *   fusione (allinea + merge voxel) → pulizia (implicita nel merge / mesh opzionale) →
 *   scaling reale (opzionale: `applyMetricScaleToPointCloud` dopo calibrazione ArUco/A4).
 *
 * @see ./README.md
 */

export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Pipeline completa: per ogni vista → maschera → depth → point cloud →
 * allineamento leggero multi-vista (centroide + scala + PCA riferimento + raffinamento) → merge voxel (pulizia/downsampling).
 * La rotazione per `phaseId` resta in `depthToPointCloud`; qui si riduce il disallineamento residuo senza ICP.
 */
export async function reconstructFootFromCapturedViews(
  views: CapturedView[],
  options?: Partial<ReconstructionOptions>
): Promise<ReconstructionResult> {
  const opt = { ...DEFAULT_RECONSTRUCTION_OPTIONS, ...options };
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;

  const perView: { positions: Float32Array; colors: Uint8Array; count: number }[] = [];
  const pointsPerView: number[] = [];

  for (let vi = 0; vi < views.length; vi++) {
    const v = views[vi];
    const small = downscaleImageDataMaxSide(v.imageData, opt.maxImageSide);
    const mask = extractFootMask(small);
    const depth = estimateRelativeDepthNormalized(small);
    const cloud = depthMapToPointCloud({
      depth01: depth,
      mask,
      imageData: small,
      phaseId: v.phaseId,
      depthNearMm: opt.depthNearMm,
      depthFarMm: opt.depthFarMm,
      focalLengthNorm: opt.focalLengthNorm,
      sampleStep: opt.sampleStep,
    });
    perView.push(cloud);
    pointsPerView.push(cloud.count);
  }

  const pointsPerInputFrame = [...pointsPerView];
  let zonePhaseIds: ScanPhaseId[] | undefined;
  let intraFuseApplied = false;

  let cloudsForAlign = perView;
  if (opt.intraZoneFrameAverage !== false && views.length > 0) {
    const intraVoxel =
      opt.intraZoneFrameVoxelMm ??
      Math.min(3, opt.voxelSizeMm * 0.55);
    const { fused, zonePhaseIds: zids } = fuseBurstFramesPerScanPhase(
      perView,
      views.map((v) => v.phaseId),
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

  const alignOn = opt.multiViewAlign !== false;
  const refinementIters = Math.min(3, Math.max(0, opt.multiViewRefinementIterations ?? 3));
  const refIdxRaw = opt.multiViewReferenceCloudIndex ?? 0;
  const refIdx =
    cloudsForAlign.length > 0
      ? Math.min(Math.max(0, refIdxRaw), cloudsForAlign.length - 1)
      : 0;

  const toMerge = alignOn
    ? alignPointCloudsMultiView(cloudsForAlign, {
        referenceCloudIndex: refIdx,
        refinementIterations: refinementIters,
      })
    : cloudsForAlign;

  const phaseIdsForMerge: ScanPhaseId[] =
    zonePhaseIds ?? views.map((v) => v.phaseId);
  const mergeWeights =
    opt.phaseWeightedMerge !== false &&
    phaseIdsForMerge.length === toMerge.length
      ? mergeWeightsForPhaseIds(phaseIdsForMerge)
      : undefined;

  let merged = mergePointCloudsVoxelAverage(
    toMerge,
    opt.voxelSizeMm,
    mergeWeights
  );

  if (opt.footShapeRegularize) {
    merged = regularizeFootPointCloud(merged, opt.footShapeRegularizeOptions ?? {});
  }

  const durationMs =
    typeof performance !== "undefined" ? performance.now() - t0 : 0;

  return {
    cloud: merged,
    meta: {
      viewCount: views.length,
      pointsPerView,
      durationMs,
      depthBackend: "pseudo",
      multiViewAlignApplied: alignOn,
      multiViewRefinementIterations: alignOn ? refinementIters : 0,
      pointsPerInputFrame,
      intraZoneFrameAverageApplied: intraFuseApplied,
      zoneCloudCount: cloudsForAlign.length,
      zonePhaseIds,
      phaseWeightedMergeApplied: mergeWeights != null,
      footShapeRegularizeApplied: !!opt.footShapeRegularize,
    },
  };
}

/**
 * Da blob JPEG acquisiti in sessione (con `phaseId` per frame).
 */
export async function reconstructFootFromBlobs(
  items: { blob: Blob; phaseId: ScanPhaseId }[],
  options?: Partial<ReconstructionOptions>
): Promise<ReconstructionResult> {
  const views: CapturedView[] = [];
  for (let i = 0; i < items.length; i++) {
    const imageData = await blobToImageData(items[i].blob);
    views.push({
      imageData,
      phaseId: items[i].phaseId,
      sourceIndex: i,
    });
  }
  return reconstructFootFromCapturedViews(views, options);
}

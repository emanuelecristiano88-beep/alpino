import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import { estimateRelativeDepthNormalized } from "./depthEstimation";
import { depthMapToPointCloud } from "./depthToPointCloud";
import { downscaleImageDataMaxSide } from "./imageResize";
import { alignPointCloudsMultiView } from "./multiViewAlign";
import { mergePointCloudsVoxelAverage } from "./mergePointClouds";
import { extractFootMask } from "./segmentFoot";
import {
  DEFAULT_RECONSTRUCTION_OPTIONS,
  type CapturedView,
  type ReconstructionOptions,
  type ReconstructionResult,
} from "./types";

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
 * Pipeline completa: depth → maschera → point cloud per vista →
 * allineamento leggero multi-vista (centroide + scala + PCA riferimento + raffinamento) → merge voxel.
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
    const depth = estimateRelativeDepthNormalized(small);
    const mask = extractFootMask(small);
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

  const alignOn = opt.multiViewAlign !== false;
  const refinementIters = Math.min(3, Math.max(0, opt.multiViewRefinementIterations ?? 3));
  const refIdx = opt.multiViewReferenceCloudIndex ?? 0;

  const toMerge = alignOn
    ? alignPointCloudsMultiView(perView, {
        referenceCloudIndex: refIdx,
        refinementIterations: refinementIters,
      })
    : perView;

  const merged = mergePointCloudsVoxelAverage(toMerge, opt.voxelSizeMm);

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

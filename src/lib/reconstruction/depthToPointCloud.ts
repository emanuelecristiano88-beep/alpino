import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import { transformPointByPhase } from "./phaseAlignment";
import type { Vec3 } from "./types";

export type DepthToCloudParams = {
  depth01: Float32Array;
  mask: Uint8Array;
  imageData: ImageData;
  phaseId: ScanPhaseId;
  depthNearMm: number;
  depthFarMm: number;
  focalLengthNorm: number;
  sampleStep: number;
};

/**
 * Camera pinhole: focale normalizzata, centro immagine = centro CCD.
 * Coordinate camera mm → rotazione per fase → mondo.
 */
export function depthMapToPointCloud(params: DepthToCloudParams): {
  positions: Float32Array;
  colors: Uint8Array;
  count: number;
} {
  const { depth01, mask, imageData, phaseId, depthNearMm, depthFarMm, focalLengthNorm, sampleStep } = params;
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const step = Math.max(1, sampleStep | 0);

  const tmp: number[] = [];
  const col: number[] = [];

  const fx = focalLengthNorm * w;
  const fy = focalLengthNorm * w;
  const cx = w / 2;
  const cy = h / 2;

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const d = depth01[i];
      const zMm = depthFarMm - d * (depthFarMm - depthNearMm);

      const xc = ((x - cx) * zMm) / fx;
      const yc = -((y - cy) * zMm) / fy;
      const zc = zMm;

      const p0: Vec3 = { x: xc, y: yc, z: zc };
      const pw = transformPointByPhase(p0, phaseId);

      tmp.push(pw.x, pw.y, pw.z);
      const o = i * 4;
      col.push(data[o], data[o + 1], data[o + 2]);
    }
  }

  const count = tmp.length / 3;
  const positions = new Float32Array(tmp);
  const colors = new Uint8Array(col);
  return { positions, colors, count };
}

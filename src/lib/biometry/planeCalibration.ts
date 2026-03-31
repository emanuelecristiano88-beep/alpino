/**
 * Calibrazione piano Z=0 da 4 marker ArUco + omografia immagine → foglio (mm).
 */
import type { ArucoMarkerDetection } from "../aruco/a4MarkerGeometry";
import { getMarkerCentroid } from "../aruco/a4MarkerGeometry";
import { applyHomographyCartesian, homographyFromImageToWorldMm, invert3x3, type Mat3 } from "./homography";
import type { NeumaPlaneCalibration } from "./types";
import { MARKER_CENTER_MM, SHEET_H_MM, SHEET_W_MM } from "./sheetGeometry";

function estimateMmPerPixel(H: Mat3, u0: number, v0: number): number {
  const p = applyHomographyCartesian(H, u0, v0);
  const pdx = applyHomographyCartesian(H, u0 + 1, v0);
  const pdy = applyHomographyCartesian(H, u0, v0 + 1);
  if (Number.isNaN(p.x) || Number.isNaN(pdx.x)) return 0.1;
  const dux = Math.hypot(pdx.x - p.x, pdx.y - p.y);
  const duy = Math.hypot(pdy.x - p.x, pdy.y - p.y);
  return (dux + duy) / 2;
}

/**
 * Costruisce calibrazione da 4 detection con id 0,1,2,3.
 * H: pixel → mm sul piano foglio (Z=0).
 */
export function calibratePlaneFromMarkers(markers: ArucoMarkerDetection[]): NeumaPlaneCalibration {
  const warnings: string[] = [];
  const byId = new Map<number, ArucoMarkerDetection>();
  for (const m of markers) {
    byId.set(m.id, m);
  }

  const need = [0, 1, 2, 3] as const;
  const srcPx: [number, number][] = [];
  const dstMm: [number, number][] = [];

  for (const id of need) {
    const m = byId.get(id);
    const centerMm = MARKER_CENTER_MM[id];
    if (!m || !centerMm) {
      warnings.push(`Marker mancante o ID non previsto: ${id}`);
      continue;
    }
    const c = getMarkerCentroid(m);
    srcPx.push([c.x, c.y]);
    dstMm.push([centerMm[0], centerMm[1]]);
  }

  if (srcPx.length < 4) {
    return {
      ok: false,
      homographyWorldMmToImagePx: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      homographyImagePxToWorldMm: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      mmPerPixelEstimate: 0,
      warnings,
    };
  }

  const H_img_to_world = homographyFromImageToWorldMm(srcPx, dstMm);
  if (!H_img_to_world) {
    warnings.push("Omografia non risolvibile (punti degeneri?)");
    return {
      ok: false,
      homographyWorldMmToImagePx: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      homographyImagePxToWorldMm: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      mmPerPixelEstimate: 0,
      warnings,
    };
  }

  const H_world_to_img = invert3x3(H_img_to_world);
  if (!H_world_to_img) {
    warnings.push("Inversione omografia fallita");
    return {
      ok: false,
      homographyWorldMmToImagePx: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      homographyImagePxToWorldMm: H_img_to_world,
      mmPerPixelEstimate: 0,
      warnings,
    };
  }

  const cx = SHEET_W_MM / 2;
  const cy = SHEET_H_MM / 2;
  const centerImg = applyHomographyCartesian(H_world_to_img, cx, cy);
  const mmPerPx = estimateMmPerPixel(H_img_to_world, centerImg.x, centerImg.y);

  if (mmPerPx < 0.01 || mmPerPx > 2) {
    warnings.push("Scala mm/pixel fuori range atteso; controlla distanza e risoluzione.");
  }

  return {
    ok: true,
    homographyWorldMmToImagePx: H_world_to_img,
    homographyImagePxToWorldMm: H_img_to_world,
    mmPerPixelEstimate: mmPerPx,
    warnings,
  };
}

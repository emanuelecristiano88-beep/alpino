/**
 * Pipeline principale: ArUco → piano Z=0 → vista canonica → maschera piede → keypoint [x,y,z] (mm).
 */
import { detectArucoOnImageData, ensureArucoDetector } from "../aruco/arucoWasm";
import type { ArucoMarkerDetection } from "../aruco/a4MarkerGeometry";
import { boundaryPixels, keypointsFromContourMm } from "./contourAndKeypoints";
import { mat3ToRowMajor } from "./homography";
import { calibratePlaneFromMarkers } from "./planeCalibration";
import type { NeumaBiometryExportPayload, NeumaBiometryResult, NeumaPlaneCalibration } from "./types";
import { SHEET_H_MM, SHEET_W_MM } from "./sheetGeometry";
import { buildFootBinaryMaskAi } from "./footMask";
import { warpImageToCanonicalSheet } from "./warpSheet";

function buildExportPayload(
  cal: NeumaPlaneCalibration,
  keypoints: NeumaBiometryResult["keypoints"],
  contourMm: { xMm: number; yMm: number }[]
): NeumaBiometryExportPayload {
  const H = cal.homographyWorldMmToImagePx;
  const row = [H[0][0], H[0][1], H[0][2], H[1][0], H[1][1], H[1][2], H[2][0], H[2][1], H[2][2]];
  const maxPts = 480;
  const step = Math.max(1, Math.ceil(contourMm.length / maxPts));
  const contourSampled = contourMm.filter((_, i) => i % step === 0);
  return {
    schema: "neuma.biometry.v1",
    sheetMm: { width: SHEET_W_MM, height: SHEET_H_MM },
    homographyWorldMmToImageRowMajor: row,
    points: keypoints.map((p) => ({
      id: String(p.id),
      x: p.xMm,
      y: p.yMm,
      z: p.zMm,
      confidence: p.confidence,
    })),
    contour: contourSampled.map((c) => ({ x: c.xMm, y: c.yMm })),
  };
}

function emptyResult(warnings: string[]): NeumaBiometryResult {
  const cal: NeumaPlaneCalibration = {
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
  return {
    version: "1.0",
    calibration: cal,
    keypoints: [],
    footContourMm: [],
    exportPayload: {
      schema: "neuma.biometry.v1",
      sheetMm: { width: SHEET_W_MM, height: SHEET_H_MM },
      homographyWorldMmToImageRowMajor: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      points: [],
      contour: [],
    },
  };
}

function maskTouchesRectifiedBorder(mask: Uint8Array, w: number, h: number): boolean {
  const border = Math.max(2, Math.floor(Math.min(w, h) * 0.01));
  let hits = 0;
  const minHits = Math.max(24, Math.floor(w * h * 0.0008));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const onBorder = x < border || y < border || x >= w - border || y >= h - border;
      if (!onBorder) continue;
      if (mask[y * w + x]) {
        hits += 1;
        if (hits >= minHits) return true;
      }
    }
  }
  return false;
}

export type ComputeNeumaBiometryOptions = {
  /** Marker già rilevati (evita doppio detect) */
  markers?: ArucoMarkerDetection[];
  /** Risoluzione vista canonica (px per mm) */
  pxPerMm?: number;
};

/**
 * Elabora un frame RGBA (es. da canvas scanner) e restituisce keypoint 3D sul piano foglio (Z=0) + payload export.
 */
export async function computeNeumaBiometryFromImageData(
  imageData: ImageData,
  options: ComputeNeumaBiometryOptions = {}
): Promise<NeumaBiometryResult> {
  await ensureArucoDetector();
  const markers = options.markers ?? detectArucoOnImageData(imageData);

  const cal = calibratePlaneFromMarkers(markers);
  const warnings = [...cal.warnings];

  if (!cal.ok) {
    warnings.push("Calibrazione non valida: servono i 4 marker ArUco 0–3 nel frame.");
    return emptyResult(warnings);
  }

  const pxPerMm = options.pxPerMm ?? 4;
  // OpenCV-like top-down rectification: homography + perspective warp.
  const canon = warpImageToCanonicalSheet(imageData, cal.homographyWorldMmToImagePx, pxPerMm);
  const mask = await buildFootBinaryMaskAi(canon.imageData);
  if (maskTouchesRectifiedBorder(mask, canon.width, canon.height)) {
    warnings.push("Piede parzialmente fuori dal foglio raddrizzato: rifare la scansione.");
    const fail = emptyResult(warnings);
    fail.calibration = { ...cal, warnings };
    fail.exportPayload = buildExportPayload(cal, [], []);
    return fail;
  }
  const contourPx = boundaryPixels(mask, canon.width, canon.height);

  if (contourPx.length < 12) {
    warnings.push("Segmentazione piede debole: prova luce uniforme e contrasto pelle/carta.");
    const fail = emptyResult(warnings);
    fail.calibration = cal;
    fail.exportPayload = buildExportPayload(cal, [], []);
    return fail;
  }

  const { keypoints, contourMm } = keypointsFromContourMm(contourPx, canon.mmPerPixel);

  const result: NeumaBiometryResult = {
    version: "1.0",
    calibration: { ...cal, warnings },
    keypoints,
    footContourMm: contourMm,
    exportPayload: buildExportPayload(cal, keypoints, contourMm),
  };
  return result;
}

/** Serializza per invio HTTP / file JSON verso Mac */
export function serializeBiometryForMac(result: NeumaBiometryResult): string {
  return JSON.stringify(result.exportPayload, null, 2);
}

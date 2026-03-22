/**
 * Biometria NEUMA — piano foglio A4 (Z=0), keypoint e export verso pipeline Mac (.obj).
 */
export type {
  NeumaBiometryExportPayload,
  NeumaBiometryResult,
  NeumaKeypointId,
  NeumaPlaneCalibration,
  NeumaPoint3D,
} from "./types";
export { NEUMA_SHEET_MARKER_IDS } from "./types";
export { MARKER_CENTER_MM, SHEET_H_MM, SHEET_W_MM } from "./sheetGeometry";
export { computeNeumaBiometryFromImageData, serializeBiometryForMac, type ComputeNeumaBiometryOptions } from "./computeNeumaBiometry";
export { calibratePlaneFromMarkers } from "./planeCalibration";

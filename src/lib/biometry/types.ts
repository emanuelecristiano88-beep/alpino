/**
 * Biometria NEUMA — coordinate sul piano foglio A4 (Z=0) + metadati per pipeline Mac (.obj).
 * Unità: millimetri nel sistema mondo del foglio; origine in alto a sinistra, asse X verso destra, Y verso il basso.
 */

/** ID marker ArUco stampati sul foglio (angoli) — allineati a `ScannerTarget` / `aruco4x4_50`. */
export const NEUMA_SHEET_MARKER_IDS = [0, 1, 2, 3] as const;

/** Keypoint semantici (plantare / contorno in vista dall’alto). */
export type NeumaKeypointId =
  | "hallux_tip"
  | "metatarsal_medial"
  | "metatarsal_lateral"
  | "heel_center"
  | "heel_curve_left"
  | "heel_curve_right"
  /** Stima 2.5D: richiede vista laterale in pipeline estesa */
  | "ankle_neck_lateral";

export type NeumaPoint3D = {
  id: NeumaKeypointId | string;
  /** mm sul piano foglio */
  xMm: number;
  yMm: number;
  /** Piano foglio = 0; valori ≠ 0 solo se integrata vista laterale / stereoscopia */
  zMm: number;
  /** 0–1 */
  confidence: number;
  notes?: string;
};

export type NeumaPlaneCalibration = {
  ok: boolean;
  /** Omografia 3×3: p_img ~ H * p_world (p_world = [xMm, yMm, 1]^T) */
  homographyWorldMmToImagePx: number[][];
  /** Inv(H): da pixel immagine a coordinate mondo omogenee (mm) */
  homographyImagePxToWorldMm: number[][];
  /** Scala media approssimativa lungo X (mm/pixel) vicino al centro foglio */
  mmPerPixelEstimate: number;
  warnings: string[];
};

export type NeumaBiometryResult = {
  version: "1.0";
  calibration: NeumaPlaneCalibration;
  /** Punti biometrici principali (vista plantare / dall’alto) */
  keypoints: NeumaPoint3D[];
  /** Contorno piede in mm (polilinea chiusa), utile per Mac / mesh */
  footContourMm: { xMm: number; yMm: number }[];
  /** JSON-serializzabile per export verso MacBook */
  exportPayload: NeumaBiometryExportPayload;
};

/** Payload stabile per tool esterni (Blender, MeshLab, script .obj). */
export type NeumaBiometryExportPayload = {
  schema: "neuma.biometry.v1";
  sheetMm: { width: number; height: number };
  /** H row-major 9 elementi: world mm homogeneous → image px */
  homographyWorldMmToImageRowMajor: number[];
  points: { id: string; x: number; y: number; z: number; confidence: number }[];
  contour: { x: number; y: number }[];
};

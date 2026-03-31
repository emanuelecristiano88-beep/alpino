/**
 * Geometria stampa NEUMA — allineata a `ScannerTarget.tsx` (A4 210×297 mm, margini marker).
 */
export const SHEET_W_MM = 210;
export const SHEET_H_MM = 297;
export const MARGIN_MM = 10;
export const MARKER_SIDE_MM = 24;

const markerCenter = (originX: number, originY: number): [number, number] => [
  originX + MARKER_SIDE_MM / 2,
  originY + MARKER_SIDE_MM / 2,
];

/** Centri marker ArUco id 0..3 in mm (sistema foglio: origine alto-sinistra, Y verso il basso). */
export const MARKER_CENTER_MM: Record<number, [number, number]> = {
  0: markerCenter(MARGIN_MM, MARGIN_MM),
  1: markerCenter(SHEET_W_MM - MARGIN_MM - MARKER_SIDE_MM, MARGIN_MM),
  2: markerCenter(MARGIN_MM, SHEET_H_MM - MARGIN_MM - MARKER_SIDE_MM),
  3: markerCenter(SHEET_W_MM - MARGIN_MM - MARKER_SIDE_MM, SHEET_H_MM - MARGIN_MM - MARKER_SIDE_MM),
};

/** Distanza nota tra centri marker su lato corto (mm) — per controllo scala / debug */
export function interMarkerWidthMm(): number {
  const [x0] = MARKER_CENTER_MM[0];
  const [x1] = MARKER_CENTER_MM[1];
  return Math.abs(x1 - x0);
}

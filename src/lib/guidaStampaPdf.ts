import { jsPDF } from "jspdf";
import { ARUCO_4X4_50 } from "../components/scannerTarget/aruco4x4_50";
import {
  MARKER_CENTER_MM,
  MARGIN_MM,
  MARKER_SIDE_MM,
  SHEET_H_MM,
  SHEET_W_MM,
} from "./biometry/sheetGeometry";

const W = SHEET_W_MM;
const H = SHEET_H_MM;
/** Bordo superiore dei marker ArUco in basso (mm, origine in alto) — il testo non deve invadere questa fascia */
const BOTTOM_MARKER_TOP_Y_MM = SHEET_H_MM - MARGIN_MM - MARKER_SIDE_MM;

/**
 * Marker ArUco DICT_4X4_50 (griglia 6×6 come OpenCV generateImageMarker) — stesso layout di `ScannerTarget.tsx`.
 */
function drawArucoMarker(
  doc: jsPDF,
  id: 0 | 1 | 2 | 3,
  originX: number,
  originY: number,
  sizeMm: number
) {
  const grid = ARUCO_4X4_50[id];
  const cell = sizeMm / 6;
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const v = grid[row][col];
      const isBlack = v === 0;
      doc.setFillColor(isBlack ? 0 : 255, isBlack ? 0 : 255, isBlack ? 0 : 255);
      doc.rect(originX + col * cell, originY + row * cell, cell, cell, "F");
    }
  }
}

function drawMillimeterGrid(doc: jsPDF) {
  // Bianco/nero forte: niente scala di grigi, solo linee nere principali.
  doc.setLineWidth(0.16);
  doc.setDrawColor(0, 0, 0);
  for (let x = 0; x <= W; x += 5) {
    doc.line(x, 0, x, H);
  }
  for (let y = 0; y <= H; y += 5) {
    doc.line(0, y, W, y);
  }

  doc.setLineWidth(0.36);
  doc.setDrawColor(0, 0, 0);
  for (let x = 0; x <= W; x += 10) {
    doc.line(x, 0, x, H);
  }
  for (let y = 0; y <= H; y += 10) {
    doc.line(0, y, W, y);
  }
}

/** Documento PDF pronto (browser: `.save()`; Node: `.output('arraybuffer')`). */
export function createGuidaStampaPdf(): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  drawMillimeterGrid(doc);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text("NEUMA — Guida stampa · Target A4", W / 2, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  const dx = Math.abs(MARKER_CENTER_MM[1][0] - MARKER_CENTER_MM[0][0]);
  const dy = Math.abs(MARKER_CENTER_MM[2][1] - MARKER_CENTER_MM[0][1]);
  const subLines = doc.splitTextToSize(
    `Marker ArUco DICT_4X4_50 (ID 0–3), margine ${MARGIN_MM} mm, lato ${MARKER_SIDE_MM} mm — interasse tra centri ~${dx.toFixed(0)} × ${dy.toFixed(0)} mm (allineato a Scanner target / biometria)`,
    188
  );
  doc.text(subLines, W / 2, 20, { align: "center" });

  /* Area piede (centrale) */
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.35);
  doc.setLineDashPattern([2.5, 2], 0);
  try {
    doc.roundedRect(40, 58, 130, 175, 4, 4, "S");
  } catch {
    doc.rect(40, 58, 130, 175, "S");
  }
  doc.setLineDashPattern([], 0);
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text("Posiziona il piede nudo qui (vista dall’alto)", W / 2, 54, { align: "center" });

  const origins: { ox: number; oy: number; id: 0 | 1 | 2 | 3 }[] = [
    { ox: MARGIN_MM, oy: MARGIN_MM, id: 0 },
    { ox: W - MARGIN_MM - MARKER_SIDE_MM, oy: MARGIN_MM, id: 1 },
    { ox: MARGIN_MM, oy: H - MARGIN_MM - MARKER_SIDE_MM, id: 2 },
    { ox: W - MARGIN_MM - MARKER_SIDE_MM, oy: H - MARGIN_MM - MARKER_SIDE_MM, id: 3 },
  ];
  for (const o of origins) {
    drawArucoMarker(doc, o.id, o.ox, o.oy, MARKER_SIDE_MM);
  }

  /* Istruzioni in basso: fascia tra area piede (~233 mm) e marker inferiori (da 263 mm) */
  const footerBandTopY = BOTTOM_MARKER_TOP_Y_MM - 28;
  const footerBandMidY = BOTTOM_MARKER_TOP_Y_MM - 10;

  const istruzioni =
    "Stampa questo foglio al 100% della scala (senza adattamenti), poggia il piede e scansiona con tutti e 4 i marker ArUco visibili.";
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  const lines = doc.splitTextToSize(istruzioni, 188);
  doc.text(lines, W / 2, footerBandTopY, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  const foot = doc.splitTextToSize(
    "Non ridimensionare alla stampa. Inquadra sempre tutti e quattro i marker ArUco (stesso foglio della sezione Scanner target).",
    188
  );
  doc.text(foot, W / 2, footerBandMidY, { align: "center" });

  return doc;
}

export function downloadGuidaStampaPdf() {
  createGuidaStampaPdf().save("neuma-guida-stampa-a4.pdf");
}

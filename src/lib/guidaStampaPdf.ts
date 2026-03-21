import { jsPDF } from "jspdf";

const W = 210;
const H = 297;
/** Raggio marker: centri esattamente agli angoli foglio (0,0)…(210,297) → interasse 210×297 mm */
const MARKER_R_MM = 11;

/**
 * 4 “coded target” stile fiduciale: cerchio nero con punti bianchi diversi per angolo.
 */
function drawCodedMarker(doc: jsPDF, cx: number, cy: number, r: number, cornerId: number) {
  doc.setFillColor(0, 0, 0);
  doc.circle(cx, cy, r, "F");

  doc.setFillColor(255, 255, 255);
  const sr = r * 0.2;
  const d = r * 0.42;
  const patterns: [number, number][][] = [
    [
      [-d, -d],
      [d, -d],
      [-d, d],
      [d, d],
    ],
    [
      [0, -d],
      [-d, 0],
      [d, 0],
      [0, d],
    ],
    [
      [-d, -d],
      [d, -d],
      [0, 0],
      [d, d],
    ],
    [
      [-d, 0],
      [d, 0],
      [0, -d],
      [0, d],
    ],
  ];
  const pat = patterns[cornerId % 4];
  for (const [dx, dy] of pat) {
    doc.circle(cx + dx, cy + dy, sr, "F");
  }

  doc.setFillColor(180, 180, 180);
  doc.circle(cx, cy, r * 0.12, "F");
}

function drawMillimeterGrid(doc: jsPDF) {
  doc.setLineWidth(0.04);
  doc.setDrawColor(250, 250, 250);
  for (let x = 0; x <= W; x += 1) {
    doc.line(x, 0, x, H);
  }
  for (let y = 0; y <= H; y += 1) {
    doc.line(0, y, W, y);
  }

  doc.setLineWidth(0.08);
  doc.setDrawColor(238, 238, 238);
  for (let x = 0; x <= W; x += 5) {
    doc.line(x, 0, x, H);
  }
  for (let y = 0; y <= H; y += 5) {
    doc.line(0, y, W, y);
  }

  doc.setLineWidth(0.14);
  doc.setDrawColor(220, 220, 220);
  for (let x = 0; x <= W; x += 10) {
    doc.line(x, 0, x, H);
  }
  for (let y = 0; y <= H; y += 10) {
    doc.line(0, y, W, y);
  }
}

export function downloadGuidaStampaPdf() {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  drawMillimeterGrid(doc);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(25, 25, 25);
  doc.text("ALPINO — Guida stampa · Target A4", W / 2, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  const subLines = doc.splitTextToSize(
    "Centri marker agli angoli foglio: interasse orizzontale 210 mm · verticale 297 mm (formato A4)",
    188
  );
  doc.text(subLines, W / 2, 20, { align: "center" });

  /* Area piede (centrale) */
  doc.setDrawColor(70, 70, 70);
  doc.setLineWidth(0.35);
  doc.setLineDashPattern([2.5, 2], 0);
  try {
    doc.roundedRect(40, 58, 130, 175, 4, 4, "S");
  } catch {
    doc.rect(40, 58, 130, 175, "S");
  }
  doc.setLineDashPattern([], 0);
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text("Posiziona il piede nudo qui (vista dall’alto)", W / 2, 54, { align: "center" });

  const corners: { x: number; y: number; id: number }[] = [
    { x: 0, y: 0, id: 0 },
    { x: W, y: 0, id: 1 },
    { x: 0, y: H, id: 2 },
    { x: W, y: H, id: 3 },
  ];
  for (const c of corners) {
    drawCodedMarker(doc, c.x, c.y, MARKER_R_MM, c.id);
  }

  const istruzioni =
    "Stampa questo foglio al 100% della scala (senza adattamenti), poggia il piede e scansiona inclusi i 4 cerchi.";
  doc.setFontSize(9.5);
  doc.setTextColor(15, 15, 15);
  const lines = doc.splitTextToSize(istruzioni, 188);
  doc.text(lines, W / 2, 275, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  const foot = doc.splitTextToSize(
    "Non ridimensionare alla stampa. Inquadra sempre tutti e quattro i cerchi neri negli angoli.",
    188
  );
  doc.text(foot, W / 2, 291, { align: "center" });

  doc.save("alpino-guida-stampa-a4.pdf");
}

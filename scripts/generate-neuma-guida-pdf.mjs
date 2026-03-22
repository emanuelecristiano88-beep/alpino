/**
 * Stesso output di `src/lib/guidaStampaPdf.ts` — eseguibile con Node senza tsx:
 *   node scripts/generate-neuma-guida-pdf.mjs
 *   npm run pdf:guida   (genera + apre Anteprima su macOS)
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

/** Allineato a `aruco4x4_50.ts` */
const ARUCO_4X4_50 = {
  0: [
    [0, 0, 0, 0, 0, 0],
    [0, 255, 0, 255, 255, 0],
    [0, 0, 255, 0, 255, 0],
    [0, 0, 0, 255, 255, 0],
    [0, 0, 0, 255, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  1: [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0],
    [0, 255, 255, 255, 255, 0],
    [0, 255, 0, 0, 255, 0],
    [0, 255, 0, 255, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  2: [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 0, 255, 255, 0],
    [0, 0, 0, 255, 255, 0],
    [0, 0, 0, 255, 0, 0],
    [0, 255, 255, 0, 255, 0],
    [0, 0, 0, 0, 0, 0],
  ],
  3: [
    [0, 0, 0, 0, 0, 0],
    [0, 255, 0, 0, 255, 0],
    [0, 255, 0, 0, 255, 0],
    [0, 0, 255, 0, 0, 0],
    [0, 0, 255, 255, 0, 0],
    [0, 0, 0, 0, 0, 0],
  ],
};

const W = 210;
const H = 297;
const MARGIN_MM = 10;
const MARKER_SIDE_MM = 24;
/** Bordo superiore marker in basso — testo sopra questa Y */
const BOTTOM_MARKER_TOP_Y_MM = H - MARGIN_MM - MARKER_SIDE_MM;

const MARKER_CENTER_MM = {
  0: [MARGIN_MM + MARKER_SIDE_MM / 2, MARGIN_MM + MARKER_SIDE_MM / 2],
  1: [W - MARGIN_MM - MARKER_SIDE_MM / 2, MARGIN_MM + MARKER_SIDE_MM / 2],
  2: [MARGIN_MM + MARKER_SIDE_MM / 2, H - MARGIN_MM - MARKER_SIDE_MM / 2],
  3: [W - MARGIN_MM - MARKER_SIDE_MM / 2, H - MARGIN_MM - MARKER_SIDE_MM / 2],
};

function drawArucoMarker(doc, id, originX, originY, sizeMm) {
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

function drawMillimeterGrid(doc) {
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

function buildPdf() {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  drawMillimeterGrid(doc);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(25, 25, 25);
  doc.text("NEUMA — Guida stampa · Target A4", W / 2, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  const dx = Math.abs(MARKER_CENTER_MM[1][0] - MARKER_CENTER_MM[0][0]);
  const dy = Math.abs(MARKER_CENTER_MM[2][1] - MARKER_CENTER_MM[0][1]);
  const subLines = doc.splitTextToSize(
    `Marker ArUco DICT_4X4_50 (ID 0–3), margine ${MARGIN_MM} mm, lato ${MARKER_SIDE_MM} mm — interasse tra centri ~${dx.toFixed(0)} × ${dy.toFixed(0)} mm (allineato a Scanner target / biometria)`,
    188
  );
  doc.text(subLines, W / 2, 20, { align: "center" });

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

  const origins = [
    { ox: MARGIN_MM, oy: MARGIN_MM, id: 0 },
    { ox: W - MARGIN_MM - MARKER_SIDE_MM, oy: MARGIN_MM, id: 1 },
    { ox: MARGIN_MM, oy: H - MARGIN_MM - MARKER_SIDE_MM, id: 2 },
    { ox: W - MARGIN_MM - MARKER_SIDE_MM, oy: H - MARGIN_MM - MARKER_SIDE_MM, id: 3 },
  ];
  for (const o of origins) {
    drawArucoMarker(doc, o.id, o.ox, o.oy, MARKER_SIDE_MM);
  }

  const footerBandTopY = BOTTOM_MARKER_TOP_Y_MM - 28;
  const footerBandMidY = BOTTOM_MARKER_TOP_Y_MM - 10;

  const istruzioni =
    "Stampa questo foglio al 100% della scala (senza adattamenti), poggia il piede e scansiona con tutti e 4 i marker ArUco visibili.";
  doc.setFontSize(9.5);
  doc.setTextColor(15, 15, 15);
  const lines = doc.splitTextToSize(istruzioni, 188);
  doc.text(lines, W / 2, footerBandTopY, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  const foot = doc.splitTextToSize(
    "Non ridimensionare alla stampa. Inquadra sempre tutti e quattro i marker ArUco (stesso foglio della sezione Scanner target).",
    188
  );
  doc.text(foot, W / 2, footerBandMidY, { align: "center" });

  return doc;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "..", "neuma-guida-stampa-a4.pdf");
const doc = buildPdf();
writeFileSync(outPath, Buffer.from(doc.output("arraybuffer")));
console.log("Creato:", outPath);

const shouldOpen = process.argv.includes("--open") || process.env.OPEN_PDF === "1";
if (shouldOpen && process.platform === "darwin") {
  const { execFileSync } = await import("node:child_process");
  execFileSync("open", [outPath]);
}

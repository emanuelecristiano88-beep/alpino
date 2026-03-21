import React, { useCallback, useMemo, useRef } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "./ui/button";
import { ARUCO_4X4_50 } from "./scannerTarget/aruco4x4_50";
import "./ScannerTarget.print.css";

const W_MM = 210;
const H_MM = 297;
const MARGIN_MM = 10;
/** Lato quadrato marker ArUco (mm) — lascia spazio tra i marker e l’area piede */
const MARKER_MM = 24;
const GRID_LIGHT = "#e5e7eb";
const GRID_DARK = "#9ca3af";

function ArucoMarkerSvg({
  id,
  originX,
  originY,
  sizeMm,
}: {
  id: 0 | 1 | 2 | 3;
  originX: number;
  originY: number;
  sizeMm: number;
}) {
  const grid = ARUCO_4X4_50[id];
  const cell = sizeMm / 6;
  const rects: React.ReactNode[] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const v = grid[row][col];
      const fill = v === 0 ? "#000000" : "#ffffff";
      rects.push(
        <rect
          key={`${id}-${row}-${col}`}
          x={originX + col * cell}
          y={originY + row * cell}
          width={cell}
          height={cell}
          fill={fill}
        />
      );
    }
  }
  return <g aria-label={`ArUco ID ${id}`}>{rects}</g>;
}

/** Outline piede (vista dall’alto), tratteggiata, molto leggera */
function FootGuide() {
  return (
    <g
      fill="none"
      stroke="#cbd5e1"
      strokeWidth={0.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="1.8 1.4"
      opacity={0.95}
    >
      <path d="M 105 102 c -24 2 -40 22 -38 48 c 2 28 14 52 38 62 c 24 -10 36 -34 38 -62 c 2 -26 -14 -46 -38 -48 z" />
      <path
        d="M 88 138 q -4 18 -2 32 M 105 142 L 105 188 M 122 138 q 4 18 2 32"
        strokeWidth={0.28}
        opacity={0.85}
      />
    </g>
  );
}

function buildGridLines(): { v: React.ReactNode[]; h: React.ReactNode[] } {
  const v: React.ReactNode[] = [];
  const h: React.ReactNode[] = [];
  for (let x = 0; x <= W_MM; x += 1) {
    const is10 = x % 10 === 0;
    v.push(
      <line
        key={`vx-${x}`}
        x1={x}
        y1={0}
        x2={x}
        y2={H_MM}
        stroke={is10 ? GRID_DARK : GRID_LIGHT}
        strokeWidth={is10 ? 0.22 : 0.06}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  for (let y = 0; y <= H_MM; y += 1) {
    const is10 = y % 10 === 0;
    h.push(
      <line
        key={`hy-${y}`}
        x1={0}
        y1={y}
        x2={W_MM}
        y2={y}
        stroke={is10 ? GRID_DARK : GRID_LIGHT}
        strokeWidth={is10 ? 0.22 : 0.06}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return { v, h };
}

/** Etichette cm (5…25) sui bordi — posizioni ogni 50 mm */
function EdgeCmLabels() {
  const labels = [5, 10, 15, 20, 25];
  const fs = 2.8;
  const fill = "#6b7280";
  const topY = 5.5;
  const botY = H_MM - 3.2;
  const sideX = 5.5;
  const rightX = W_MM - 5.5;

  const topBottom = [5, 10, 15, 20].map((cm, i) => {
    const x = (i + 1) * 50;
    return (
      <g key={`tb-${cm}`}>
        <text x={x} y={topY} textAnchor="middle" fontSize={fs} fill={fill} fontFamily="system-ui, sans-serif">
          {cm}
        </text>
        <text x={x} y={botY} textAnchor="middle" fontSize={fs} fill={fill} fontFamily="system-ui, sans-serif">
          {cm}
        </text>
      </g>
    );
  });

  const sides = labels.map((cm) => {
    const y = cm * 10;
    if (y > H_MM) return null;
    return (
      <g key={`side-${cm}`}>
        <text
          x={sideX}
          y={y + 1}
          textAnchor="middle"
          fontSize={fs}
          fill={fill}
          fontFamily="system-ui, sans-serif"
          transform={`rotate(-90 ${sideX} ${y})`}
        >
          {cm}
        </text>
        <text
          x={rightX}
          y={y + 1}
          textAnchor="middle"
          fontSize={fs}
          fill={fill}
          fontFamily="system-ui, sans-serif"
          transform={`rotate(90 ${rightX} ${y})`}
        >
          {cm}
        </text>
      </g>
    );
  });

  return (
    <g pointerEvents="none" aria-hidden>
      {topBottom}
      {sides}
    </g>
  );
}

const SVG_TITLE_ID = "scanner-target-svg-title";
const SVG_DESC_ID = "scanner-target-svg-desc";

export function ScannerTarget() {
  const svgRef = useRef<SVGSVGElement>(null);

  const { v, h } = useMemo(() => buildGridLines(), []);

  const markerRight = W_MM - MARGIN_MM - MARKER_MM;
  const markerBottom = H_MM - MARGIN_MM - MARKER_MM;

  const downloadSvg = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", `${W_MM}mm`);
    clone.setAttribute("height", `${H_MM}mm`);
    clone.setAttribute("viewBox", `0 0 ${W_MM} ${H_MM}`);
    const serialized = new XMLSerializer().serializeToString(clone);
    const preamble = '<?xml version="1.0" encoding="UTF-8"?>\n';
    const blob = new Blob([preamble + serialized], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "alpino-scanner-target-a4.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const printSheet = useCallback(() => {
    document.documentElement.classList.add("print-scanner-target");
    document.body.classList.add("print-scanner-target");
    const cleanup = () => {
      document.documentElement.classList.remove("print-scanner-target");
      document.body.classList.remove("print-scanner-target");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.setTimeout(() => window.print(), 0);
  }, []);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap gap-2">
        <Button type="button" variant="secondary" className="gap-2" onClick={downloadSvg}>
          <Download className="h-4 w-4" />
          Scarica SVG
        </Button>
        <Button type="button" className="gap-2 font-bold uppercase tracking-wide" onClick={printSheet}>
          <Printer className="h-4 w-4" />
          Stampa PDF
        </Button>
      </div>

      <p className="no-print text-xs text-muted-foreground">
        In stampa scegli <strong>scala 100%</strong> (nessun adattamento alla pagina) e, se disponibile, &quot;Dimensioni
        effettive&quot; / margini nulli. Il foglio è progettato per A4 verticale 210×297 mm.
      </p>

      <div className="scanner-target-printable overflow-hidden rounded-lg border border-border bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
        <svg
          ref={svgRef}
          role="img"
          aria-labelledby={`${SVG_TITLE_ID} ${SVG_DESC_ID}`}
          width={W_MM}
          height={H_MM}
          viewBox={`0 0 ${W_MM} ${H_MM}`}
          className="mx-auto block h-auto max-w-full"
          style={{ width: "min(100%, 210mm)", aspectRatio: `${W_MM} / ${H_MM}` }}
        >
          <title id={SVG_TITLE_ID}>Foglio calibrazione A4 Officina Alpino</title>
          <desc id={SVG_DESC_ID}>
            Griglia millimetrata, marker ArUco agli angoli e area piede centrale per scansione precisa.
          </desc>

          <rect x={0} y={0} width={W_MM} height={H_MM} fill="#ffffff" />

          <g className="scanner-grid">{v}{h}</g>

          <EdgeCmLabels />

          <FootGuide />

          <ArucoMarkerSvg id={0} originX={MARGIN_MM} originY={MARGIN_MM} sizeMm={MARKER_MM} />
          <ArucoMarkerSvg id={1} originX={markerRight} originY={MARGIN_MM} sizeMm={MARKER_MM} />
          <ArucoMarkerSvg id={2} originX={MARGIN_MM} originY={markerBottom} sizeMm={MARKER_MM} />
          <ArucoMarkerSvg id={3} originX={markerRight} originY={markerBottom} sizeMm={MARKER_MM} />
        </svg>
      </div>
    </div>
  );
}

export default ScannerTarget;

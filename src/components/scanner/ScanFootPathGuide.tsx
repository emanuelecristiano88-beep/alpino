import React, { useMemo } from "react";
import { cn } from "../../lib/utils";

export type PhaseIndexScan = 0 | 1 | 2 | 3;

/** Angolo centro settore (gradi, 0° = destra, senso antiorario SVG) */
const PHASE_CENTER_DEG: Record<PhaseIndexScan, number> = {
  0: -90,
  1: 0,
  3: 90,
  2: 180,
};

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, deg0: number, deg1: number) {
  const p0 = polar(cx, cy, r, deg0);
  const p1 = polar(cx, cy, r, deg1);
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0;
  const sweep = deg1 > deg0 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** Spicchio dal centro fino all’arco (riempimento progresso, senza etichette) */
function wedgePath(cx: number, cy: number, r: number, deg0: number, deg1: number) {
  const p0 = polar(cx, cy, r, deg0);
  const p1 = polar(cx, cy, r, deg1);
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0;
  const sweep = deg1 > deg0 ? 1 : 0;
  return `M ${cx} ${cy} L ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} Z`;
}

export type ScanFootPathGuideProps = {
  className?: string;
  /** Centro piede normalizzato 0–1 (stesso spazio del video analizzato) */
  footCentroidNorm: { x: number; y: number } | null;
  visible: boolean;
  /** phaseId → burst completato per quel punto di vista (piede corrente) */
  zonesComplete: [boolean, boolean, boolean, boolean];
  /** Evidenziazione leggera della parte “attiva” (nessun testo) */
  activePhase: PhaseIndexScan;
};

/**
 * Progresso circolare attorno al piede: segmenti che si riempiono man mano (nessuna etichetta zona).
 */
export default function ScanFootPathGuide({
  className,
  footCentroidNorm,
  visible,
  zonesComplete,
  activePhase,
}: ScanFootPathGuideProps) {
  const layout = useMemo(() => {
    const cx = 100;
    const cy = 100;
    const r = 74;
    const rTrack = 82;
    const segments: { phase: PhaseIndexScan; start: number; end: number }[] = [
      { phase: 0, start: -135, end: -45 },
      { phase: 1, start: -45, end: 45 },
      { phase: 3, start: 45, end: 135 },
      { phase: 2, start: 135, end: 225 },
    ];

    const pathOrder: PhaseIndexScan[] = [0, 1, 3, 2];
    const nextPhase = pathOrder.find((p) => !zonesComplete[p]) ?? activePhase;
        const arrowDeg = PHASE_CENTER_DEG[nextPhase];
    const tangentDeg = arrowDeg + 90;
    const tip = polar(cx, cy, r + 6, tangentDeg);
    const tail = polar(cx, cy, r - 10, tangentDeg);
    const wingA = polar(cx, cy, r + 2, tangentDeg + 28);
    const wingB = polar(cx, cy, r + 2, tangentDeg - 28);

    const completedCount = zonesComplete.filter(Boolean).length;
    const allDone = completedCount >= 4;

    return { cx, cy, r, rTrack, segments, tip, tail, wingA, wingB, completedCount, allDone };
  }, [activePhase, zonesComplete]);

  if (!visible) return null;

  const leftPct = (footCentroidNorm?.x ?? 0.5) * 100;
  const topPct = (footCentroidNorm?.y ?? 0.5) * 100;

  return (
    <div
      className={cn("pointer-events-none", className)}
      style={{
        position: "absolute",
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: "translate(-50%, -50%)",
        width: "min(52vmin, 280px)",
        height: "min(52vmin, 280px)",
      }}
    >
      <span className="sr-only">
        Avanzamento scansione continua: {layout.completedCount} viste su quattro raccolte.
      </span>
      <svg
        viewBox="0 0 200 200"
        className="h-full w-full overflow-visible drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)]"
        aria-hidden
      >
        <defs>
          <filter id="scan-path-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="scan-progress-fill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgb(52 211 153)" stopOpacity="0.38" />
            <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0.52" />
          </linearGradient>
        </defs>

        {/* Anello esterno continuo: percorso totale (senso di “giro” unico) */}
        <circle
          cx={layout.cx}
          cy={layout.cy}
          r={layout.rTrack}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={3}
          strokeDasharray="6 10"
          strokeLinecap="round"
          className="opacity-90"
        />

        {/* Riempimento spicchi completati */}
        {layout.segments.map((seg) => {
          if (!zonesComplete[seg.phase]) return null;
          const d = wedgePath(layout.cx, layout.cy, layout.r, seg.start, seg.end);
          return (
            <path
              key={`fill-${seg.phase}`}
              d={d}
              fill="url(#scan-progress-fill)"
              className="transition-[opacity] duration-500 ease-out"
              style={{ filter: "url(#scan-path-glow)" }}
            />
          );
        })}

        {/* Contorno segmenti: completato = tratto pieno; attivo = accento soft */}
        {layout.segments.map((seg) => {
          const done = zonesComplete[seg.phase];
          const d = arcPath(layout.cx, layout.cy, layout.r, seg.start, seg.end);
          return (
            <path
              key={`stroke-${seg.phase}`}
              d={d}
              fill="none"
              // UX: non evidenziamo quale “fase” sia attiva.
              // Mostriamo solo: completato (più pieno) oppure incompleto (stile neutro).
              strokeWidth={done ? 8 : 5}
              strokeLinecap="round"
              className={cn(
                "transition-[stroke,stroke-opacity,stroke-width] duration-500",
                done
                  ? "stroke-emerald-300/95"
                  : "stroke-white/25"
              )}
              filter={done ? "url(#scan-path-glow)" : undefined}
            />
          );
        })}

        {/* Freccia solo se non tutto completato */}
        {!layout.allDone && (
          <g style={{ transformOrigin: "100px 100px" }} className="animate-pulse">
            <line
              x1={layout.tail.x}
              y1={layout.tail.y}
              x2={layout.tip.x}
              y2={layout.tip.y}
              stroke="rgba(255,255,255,0.92)"
              strokeWidth={3.5}
              strokeLinecap="round"
            />
            <path
              d={`M ${layout.tip.x} ${layout.tip.y} L ${layout.wingA.x} ${layout.wingA.y} M ${layout.tip.x} ${layout.tip.y} L ${layout.wingB.x} ${layout.wingB.y}`}
              stroke="rgba(255,255,255,0.92)"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
      </svg>
    </div>
  );
}

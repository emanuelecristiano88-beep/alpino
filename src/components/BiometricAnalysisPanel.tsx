import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import type { ScanMetricsPayload, FootSideMetrics } from "../types/scanMetrics";

const MM_THRESHOLD = 3;
const CIRCONFERENZA_THRESHOLD = 5;
const VOL_THRESHOLD = 50;

function diffDetected(left: FootSideMetrics, right: FootSideMetrics) {
  return (
    Math.abs(left.lunghezzaMm - right.lunghezzaMm) > MM_THRESHOLD ||
    Math.abs(left.larghezzaMm - right.larghezzaMm) > MM_THRESHOLD ||
    Math.abs(left.altezzaArcoMm - right.altezzaArcoMm) > MM_THRESHOLD ||
    Math.abs(left.circonferenzaColloMm - right.circonferenzaColloMm) > CIRCONFERENZA_THRESHOLD ||
    Math.abs(left.volumeCm3 - right.volumeCm3) > VOL_THRESHOLD
  );
}

/** Percentile lineare su range antropometrico adulto (semplificato) — solo per L. */
function lengthPercentile(mm: number) {
  const min = 220;
  const max = 310;
  return Math.min(100, Math.max(0, Math.round(((mm - min) / (max - min)) * 100)));
}

function barWidthMetatarsal(mm: number) {
  return Math.min(100, (mm / 120) * 100);
}
/** Arco: range tipico indicativo 8–42 mm (solo visualizzazione barra). */
function barWidthArco(mm: number) {
  const lo = 8;
  const hi = 42;
  return Math.min(100, Math.max(0, ((mm - lo) / (hi - lo)) * 100));
}
/** Circonferenza collo / instep: range indicativo 200–300 mm. */
function barWidthCollo(mm: number) {
  const lo = 200;
  const hi = 300;
  return Math.min(100, Math.max(0, ((mm - lo) / (hi - lo)) * 100));
}

type ProRowProps = {
  symbol: string;
  title: string;
  subtitle: string;
  dx: number;
  sx: number;
  unit: string;
  fillPercent: number;
  showPercentile?: boolean;
  percentile?: number;
  highlight: "dx" | "sx";
};

function ProMetricRow({
  symbol,
  title,
  subtitle,
  dx,
  sx,
  unit,
  fillPercent,
  showPercentile,
  percentile,
  highlight,
}: ProRowProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-bold tabular-nums text-sky-400/95">{symbol}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{title}</span>
        </div>
        <p className="text-[9px] leading-snug text-zinc-500">{subtitle}</p>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[11px] tabular-nums sm:text-xs">
          <span className={cn("font-semibold", highlight === "dx" ? "text-sky-300" : "text-zinc-300")}>
            Dx {dx} {unit}
          </span>
          <span className="text-zinc-600">|</span>
          <span className={cn("font-semibold", highlight === "sx" ? "text-sky-300" : "text-zinc-300")}>
            Sx {sx} {unit}
          </span>
          {showPercentile && percentile !== undefined ? (
            <span className="ml-auto text-[10px] font-normal text-blue-400/90">P{percentile}</span>
          ) : null}
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800/90">
        <div
          className="h-full rounded-full bg-gradient-to-r from-blue-800 via-sky-500 to-cyan-400 shadow-[0_0_12px_rgba(56,189,248,0.35)] transition-[width] duration-500 ease-out"
          style={{ width: `${fillPercent}%` }}
        />
      </div>
    </div>
  );
}

export type BiometricAnalysisPanelProps = {
  metrics: ScanMetricsPayload;
  className?: string;
  hideConfirmButton?: boolean;
  onConfirm?: () => void;
  confirmLabel?: string;
};

/**
 * Confronto biometrico professionale: L, W, altezza arco, circonferenza collo (da mesh 3D / script Mac).
 */
export default function BiometricAnalysisPanel({
  metrics,
  className,
  hideConfirmButton = true,
  onConfirm,
  confirmLabel = "Conferma",
}: BiometricAnalysisPanelProps) {
  const [mode, setMode] = useState<"before" | "after">("after");
  const highlight: "dx" | "sx" = mode === "after" ? "dx" : "sx";
  const L = metrics.left;
  const R = metrics.right;
  const showDiff = useMemo(() => diffDetected(L, R), [L, R]);

  const lungPctDx = lengthPercentile(R.lunghezzaMm);
  const lungPctSx = lengthPercentile(L.lunghezzaMm);
  const lungPctBar = Math.max(lungPctDx, lungPctSx);

  const rows = useMemo(
    () =>
      [
        {
          symbol: "L",
          title: "Lunghezza totale",
          subtitle: "Dal tallone alla punta del dito più lungo (mesh 3D).",
          dx: R.lunghezzaMm,
          sx: L.lunghezzaMm,
          unit: "mm",
          fillPercent: lungPctBar,
          showPercentile: true,
          percentile: Math.round((lungPctDx + lungPctSx) / 2),
        },
        {
          symbol: "W",
          title: "Larghezza metatarsale",
          subtitle: "Punto più largo della pianta — riferimento avampiede.",
          dx: R.larghezzaMm,
          sx: L.larghezzaMm,
          unit: "mm",
          fillPercent: Math.max(barWidthMetatarsal(R.larghezzaMm), barWidthMetatarsal(L.larghezzaMm)),
        },
        {
          symbol: "H",
          title: "Altezza arco",
          subtitle: "Profilo plantare: utile per classificare piede più piatto o più cavo.",
          dx: R.altezzaArcoMm,
          sx: L.altezzaArcoMm,
          unit: "mm",
          fillPercent: Math.max(barWidthArco(R.altezzaArcoMm), barWidthArco(L.altezzaArcoMm)),
        },
        {
          symbol: "C",
          title: "Circonferenza collo",
          subtitle: "Per calibrare quanto deve essere stretta la tomaia stampata in TPU.",
          dx: R.circonferenzaColloMm,
          sx: L.circonferenzaColloMm,
          unit: "mm",
          fillPercent: Math.max(barWidthCollo(R.circonferenzaColloMm), barWidthCollo(L.circonferenzaColloMm)),
        },
      ],
    [L, R, lungPctBar, lungPctDx, lungPctSx]
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4 shadow-inner backdrop-blur-sm",
        className
      )}
    >
      <div className="mb-3 text-center">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-200">Confronto</h3>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-500">Comparison</p>
        <p className="mx-auto mt-2 max-w-[260px] text-[9px] leading-relaxed text-zinc-500">
          Valori da mesh 3D (pipeline Mac). Simboli: L lunghezza, W pianta, H arco, C tomaia.
        </p>
      </div>

      <div className="mb-3 flex rounded-full border border-zinc-800 bg-zinc-950/80 p-0.5">
        <button
          type="button"
          onClick={() => setMode("before")}
          className={cn(
            "flex-1 rounded-full py-2 text-center text-xs font-semibold transition-colors",
            mode === "before" ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          Before
        </button>
        <button
          type="button"
          onClick={() => setMode("after")}
          className={cn(
            "flex-1 rounded-full py-2 text-center text-xs font-semibold transition-colors",
            mode === "after" ? "bg-blue-600 text-white shadow-md shadow-blue-600/30" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          After
        </button>
      </div>
      <p className="mb-3 text-center text-[10px] text-zinc-500">
        {mode === "after" ? "Focus piede destro (Dx)" : "Focus piede sinistro (Sx)"} · ultima scansione
      </p>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {rows.map((r) => (
          <ProMetricRow
            key={r.symbol}
            symbol={r.symbol}
            title={r.title}
            subtitle={r.subtitle}
            dx={r.dx}
            sx={r.sx}
            unit={r.unit}
            fillPercent={r.fillPercent}
            showPercentile={"showPercentile" in r ? r.showPercentile : false}
            percentile={"percentile" in r ? r.percentile : undefined}
            highlight={highlight}
          />
        ))}
      </div>

      {showDiff ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/[0.08] px-3 py-2.5 text-[11px] leading-snug text-amber-100"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden />
          <span>
            <strong className="font-semibold tracking-wide">DIFFERENZA RILEVATA</strong>
            <span className="text-amber-200/90">
              {" "}
              — i due piedi differiscono oltre soglia su lunghezza, larghezza, arco o circonferenza collo.
            </span>
          </span>
        </div>
      ) : null}

      {!hideConfirmButton ? (
        <div className="mt-4 border-t border-zinc-800/80 pt-4">
          <Button
            type="button"
            className="w-full rounded-full bg-blue-600 py-6 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 hover:bg-blue-700"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

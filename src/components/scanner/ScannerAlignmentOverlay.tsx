import React from "react";
import { cn } from "../../lib/utils";
import type { ScanAlignmentResult } from "../../hooks/useScanAlignmentAnalysis";
import ScanVolumePrism3D from "./ScanVolumePrism3D";

const GUIDE_COPY: Record<ScanAlignmentResult["guide"], string> = {
  default: "INQUADRA IL FOGLIO A4 CON I QUATTRO MARKER",
  too_close: "ALLONTANATI — Il foglio deve essere interamente visibile",
  aligned: "POSIZIONE OTTIMALE",
};

export type ScannerAlignmentOverlayProps = {
  alignment: ScanAlignmentResult;
  className?: string;
};

/**
 * Overlay stile Snapfeet: prisma 3D centrale, pin ArUco sul video, guida dark/trasparente.
 */
export default function ScannerAlignmentOverlay({ alignment, className }: ScannerAlignmentOverlayProps) {
  const { guide, footInFrame, isPositionCorrect } = alignment;

  const borderWarning = guide === "too_close";
  const borderYellow = !borderWarning && !footInFrame;
  const borderBlueFoot = !borderWarning && footInFrame && !isPositionCorrect;
  const borderBlueLocked = !borderWarning && isPositionCorrect;

  return (
    <div className={cn("pointer-events-none flex min-h-0 flex-1 flex-col", className)}>
      {/* Guida contestuale — dark glass */}
      <div className="shrink-0 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-center">
        <p
          className={cn(
            "mx-auto max-w-lg rounded-xl border px-4 py-2.5 font-mono text-[10px] font-bold uppercase leading-snug tracking-wide shadow-lg backdrop-blur-md sm:text-[11px]",
            "border-white/10 bg-black/40 text-zinc-100",
            guide === "aligned" && "border-emerald-500/35 bg-emerald-500/10 text-emerald-100",
            guide === "too_close" && "border-amber-500/40 bg-amber-500/10 text-amber-100",
            guide === "default" && "text-zinc-200"
          )}
        >
          {GUIDE_COPY[guide]}
        </p>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-2">
        {/* Prisma 3D + alone leggero */}
        <div
          className={cn(
            "relative flex w-[min(92vw,380px)] max-w-full flex-col items-center justify-center transition-[filter,opacity] duration-300",
            borderWarning && "opacity-90",
            borderYellow && "opacity-95"
          )}
        >
          <ScanVolumePrism3D />

          {/* Bordo “volume di scansione” — hint rettangolo A4 intorno al prisma */}
          <div
            className={cn(
              "pointer-events-none absolute inset-0 mx-auto aspect-[210/297] w-[min(78vw,300px)] max-h-[min(52dvh,420px)] rounded-md transition-[box-shadow,border-color] duration-300",
              borderWarning &&
                "border-2 border-dashed border-amber-400/55 shadow-[0_0_24px_rgba(251,191,36,0.2)]",
              borderYellow &&
                "border-2 border-dashed border-yellow-300/45 bg-yellow-300/[0.04] shadow-[0_0_18px_rgba(250,204,21,0.12)]",
              borderBlueFoot && "scanner-bbox-foot rounded-md border-2 border-sky-400/75 border-solid",
              borderBlueLocked && "scanner-bbox-aligned rounded-md border-2 border-solid border-sky-300"
            )}
          />

          {/* Mirino centrale */}
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <svg width="32" height="32" viewBox="0 0 36 36" aria-hidden className="text-sky-400/80">
              <line x1="18" y1="6" x2="18" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="18" y1="22" x2="18" y2="30" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="6" y1="18" x2="14" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="22" y1="18" x2="30" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import {
  SCAN_PHASE_GUIDE_COPY,
  SCAN_PHASE_REFERENCE_PHOTO,
  type ScanPhaseId,
} from "../../constants/scanCapturePhases";
import ScanPhaseGuideIllustration from "./ScanPhaseGuideIllustration";

export type PhaseId = ScanPhaseId;
type FootId = "LEFT" | "RIGHT";

export type ScannerPhaseGuidePanelProps = {
  phaseId: PhaseId;
  foot: FootId;
  onContinue: () => void;
};

/**
 * Schermata prima di ogni fase: illustrazione vettoriale stile NEUMA + testi cliente/operatore.
 */
export default function ScannerPhaseGuidePanel({ phaseId, foot, onContinue }: ScannerPhaseGuidePanelProps) {
  const copy = SCAN_PHASE_GUIDE_COPY[phaseId];
  const ref = SCAN_PHASE_REFERENCE_PHOTO[phaseId];

  return (
    <div className="fixed inset-0 z-[96] flex flex-col bg-zinc-950/97">
      <div className="shrink-0 border-b border-white/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#2563eb]">
          Fase {phaseId + 1}/4 · {foot === "LEFT" ? "Piede sinistro" : "Piede destro"}
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">{copy.title}</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <figure className="mx-auto max-w-lg overflow-hidden rounded-xl border border-white/10 bg-zinc-900/80 shadow-lg shadow-black/40">
          <div className="relative bg-[#0a0a0f]">
            <span className="absolute left-2 top-2 z-[1] rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
              Guida visiva
            </span>
            <p className="sr-only">{ref.alt}</p>
            <ScanPhaseGuideIllustration phaseId={phaseId} variant="panel" className="block" />
          </div>
          <figcaption className="border-t border-white/10 bg-zinc-900/90 px-3 py-2.5 text-left text-[12px] leading-snug text-zinc-300">
            <span className="font-medium text-white">{copy.title}</span>
            <span className="mx-1.5 text-zinc-600">·</span>
            {ref.caption}
          </figcaption>
        </figure>

        <div className="mx-auto mt-3 max-w-lg space-y-2 text-left text-sm leading-relaxed text-zinc-300">
          <p className={cn("rounded-lg border border-white/10 bg-black/35 px-3 py-2 text-xs text-zinc-400")}>
            {copy.hint}
          </p>
        </div>
      </div>

      <div className="shrink-0 border-t border-white/10 bg-zinc-950 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="mb-3 text-center text-[11px] text-zinc-500">
          Segui i riferimenti visivi con un movimento lento e fluido.
        </p>
        <Button
          type="button"
          className="h-14 w-full rounded-xl bg-[#2563eb] text-base font-bold uppercase tracking-wide text-white shadow-lg hover:brightness-110"
          onClick={onContinue}
        >
          Inizia
        </Button>
      </div>
    </div>
  );
}

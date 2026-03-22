"use client";

import React from "react";
import { Camera } from "lucide-react";
import ScanPhaseGuideIllustration from "./scanner/ScanPhaseGuideIllustration";
import { SCAN_PHASE_GUIDE_COPY, SCAN_PHASE_REFERENCE_PHOTO, type ScanPhaseId } from "../constants/scanCapturePhases";

const PHASE_IDS: ScanPhaseId[] = [0, 1, 2, 3];

export type ScanPhaseReferenceGridProps = {
  className?: string;
};

/**
 * Griglia 2×2 con illustrazioni vettoriali stile NEUMA (stesse del pannello pre-fase).
 */
export default function ScanPhaseReferenceGrid({ className }: ScanPhaseReferenceGridProps) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-center gap-2">
        <Camera className="h-4 w-4 text-blue-600" aria-hidden />
        <h2 className="text-sm font-semibold text-zinc-900">Come inquadrare (4 fasi)</h2>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-zinc-600">
        Schema stilizzato come nello scanner: cornice blu, mirino e foglio con marker. Stesso ordine delle fasi nell’app.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {PHASE_IDS.map((id) => {
          const title = SCAN_PHASE_GUIDE_COPY[id].title;
          const { alt, caption } = SCAN_PHASE_REFERENCE_PHOTO[id];
          return (
            <figure
              key={id}
              className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-950 shadow-sm ring-1 ring-black/[0.04]"
            >
              <div className="relative bg-[#0a0a0f] px-1 pt-1">
                <span className="absolute left-2 top-2 z-[1] rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 shadow-sm">
                  {id + 1}/4
                </span>
                <ScanPhaseGuideIllustration phaseId={id} variant="compact" className="mx-auto" />
              </div>
              <figcaption className="border-t border-zinc-800 bg-zinc-900 p-3">
                <p className="text-xs font-semibold text-zinc-100">{title}</p>
                <p className="mt-1 text-[11px] leading-snug text-zinc-400">{caption}</p>
                <p className="sr-only">{alt}</p>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

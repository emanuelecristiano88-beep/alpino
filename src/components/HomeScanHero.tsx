"use client";

import React from "react";
import { Button } from "./ui/button";
import { HoneycombLatticeVisual } from "./HoneycombLatticeVisual";
import { ChevronDown, ScanLine } from "lucide-react";
import BarefootBenefitsSection from "./BarefootBenefitsSection";

export type HomeScanHeroProps = {
  onOpenScanner: () => void;
};

/**
 * Hero home: scan-to-print + CTA (senza immagine PNG piedi in alto).
 */
export default function HomeScanHero({ onOpenScanner }: HomeScanHeroProps) {
  return (
    <section
      className="relative -mx-5 mb-8 overflow-hidden border-y border-neutral-300 bg-neutral-200 sm:mx-0 sm:rounded-2xl sm:border"
      aria-label="Home: scan-to-print"
    >
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[0.22]">
        <HoneycombLatticeVisual />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_35%,rgba(59,130,246,0.14),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-neutral-200/90 via-neutral-200/50 to-neutral-200" />

      <div className="relative z-20 border-b border-neutral-300 bg-neutral-200/95 px-5 pb-10 pt-10 backdrop-blur-sm sm:pt-12">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-800">
              <ScanLine className="h-3.5 w-3.5" strokeWidth={2} />
              Scan-to-print
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl sm:leading-tight">
              Dalla scansione alla stampa 3D su misura
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-zinc-700 sm:text-lg">
              Due piedi, geometria che si compone e reticolo pronto per il TPU — esperienza home in stile{" "}
              <span className="font-medium text-zinc-900">footwear digitale</span>.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            <Button
              type="button"
              size="lg"
              className="w-full bg-blue-600 px-8 text-base text-white shadow-lg shadow-blue-600/35 hover:bg-blue-700 sm:w-auto"
              onClick={onOpenScanner}
            >
              Scansiona ora
            </Button>
            <span className="text-center text-[11px] text-zinc-600 sm:text-right">TPU · stampa additiva · Alpino</span>
            <a
              href="#benefici-piede"
              className="inline-flex items-center justify-center gap-1 text-center text-sm font-medium text-blue-600 underline-offset-4 hover:text-blue-700 hover:underline sm:text-right"
            >
              Scopri i benefici
              <ChevronDown className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>
      </div>

      <BarefootBenefitsSection className="rounded-b-2xl border-t border-neutral-300" />
    </section>
  );
}

"use client";

import React from "react";
import { Link } from "react-router-dom";
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
      className="-mx-5 mb-8 overflow-hidden border-y border-white/10 bg-black sm:mx-0 sm:rounded-2xl sm:border"
      aria-label="Home: scan-to-print"
    >
      {/*
        Overlay (honeycomb + gradient) SOLO sul blocco hero: se copre tutta la section,
        finisce sopra la sezione benefici e schiarisce il testo (illeggibile).
      */}
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-0 opacity-[0.18]">
          <HoneycombLatticeVisual />
        </div>
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_35%,rgba(255,255,255,0.06),transparent_55%)]" />
        <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-black via-black/85 to-black" />

        <div className="relative z-20 border-b border-white/10 bg-black/80 px-5 pb-10 pt-10 backdrop-blur-sm sm:pt-12">
          <div className="mx-auto flex max-w-3xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/85">
                <ScanLine className="h-3.5 w-3.5" strokeWidth={2} />
                Scan-to-print
              </div>
              <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl sm:leading-tight">
                Dalla scansione alla stampa 3D su misura
              </h2>
              <p className="max-w-xl text-base leading-relaxed text-[#e5e5e5] sm:text-lg">
                Due piedi, geometria che si compone e intersuola pronta per il TPU — un percorso fluido dall&apos;app alla
                produzione.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:items-end">
              <Button
                type="button"
                size="lg"
                className="w-full rounded-full border border-white/20 bg-white/10 px-8 text-base font-semibold text-white backdrop-blur-sm hover:bg-white/15 sm:w-auto"
                onClick={onOpenScanner}
              >
                Scansiona ora
              </Button>
              <span className="text-center text-[11px] text-white/45 sm:text-right">TPU · stampa additiva · NEUMA</span>
              <div className="flex flex-col gap-2 sm:items-end">
                <a
                  href="#benefici-piede"
                  className="inline-flex items-center justify-center gap-1 text-center text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline sm:text-right"
                >
                  Scopri i benefici
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </a>
                <Link
                  to="/guida-scansione"
                  className="text-center text-[11px] font-medium text-white/50 underline-offset-4 hover:text-white hover:underline sm:text-right"
                >
                  Prima volta? Guida alla scansione del piede
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BarefootBenefitsSection className="rounded-b-2xl border-t border-white/10" />
    </section>
  );
}

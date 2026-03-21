"use client";

import React from "react";
import { motion } from "framer-motion";
import { Button } from "./ui/button";
import { HoneycombLatticeVisual } from "./HoneycombLatticeVisual";
import { ScanLine } from "lucide-react";

/** Piede visto dall’alto (forma semplificata) — coordinate locali 0–220 × 0–300 */
const FOOT_PATH_D =
  "M 108 268 C 32 248 8 168 38 88 C 62 28 118 4 168 22 C 208 38 218 108 198 178 C 182 238 152 278 108 268 Z";

export type HomeScanHeroProps = {
  onOpenScanner: () => void;
};

/**
 * Home hero ispirato alle landing scan-to-print (es. VivoBiome): piedi grandi + mesh che si “costruisce”.
 * Tutto in SVG/CSS — nessun WebGL, così è sempre visibile in browser.
 */
export default function HomeScanHero({ onOpenScanner }: HomeScanHeroProps) {
  return (
    <section
      className="relative -mx-5 mb-8 overflow-hidden border-y border-zinc-800/90 bg-zinc-950 sm:mx-0 sm:rounded-2xl sm:border"
      aria-label="Home: scan-to-print con piedi e mesh"
    >
      {/* Sfondo full-width su mobile */}
      <div className="pointer-events-none absolute inset-0 z-0 opacity-[0.18]">
        <HoneycombLatticeVisual />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_35%,rgba(59,130,246,0.2),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-zinc-950 via-zinc-950/40 to-zinc-950" />

      {/* Area visiva alta — tipo hero marketing */}
      <div className="relative z-10 flex min-h-[min(72dvh,640px)] flex-col items-center justify-center px-4 pb-6 pt-10 sm:min-h-[min(68dvh,560px)] sm:px-8">
        {/* Fascio di scansione */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="hero-vivo-scan-beam absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-transparent via-blue-500/25 to-transparent" />
        </div>

        <motion.div
          className="relative w-full max-w-4xl"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <svg
            viewBox="0 0 900 380"
            className="h-auto w-full drop-shadow-[0_0_40px_rgba(59,130,246,0.15)]"
            role="img"
            aria-label="Due piedi con mesh di scansione e linee di costruzione"
          >
            <title>Piedi e mesh scan-to-print</title>
            <defs>
              <linearGradient id="footSkin" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#1c1410" />
                <stop offset="55%" stopColor="#8b5a3c" />
                <stop offset="100%" stopColor="#c9a27e" />
              </linearGradient>
              <linearGradient id="footStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(59,130,246,0.9)" />
                <stop offset="100%" stopColor="rgba(96,165,250,0.5)" />
              </linearGradient>
              <pattern id="meshGrid" width="14" height="14" patternUnits="userSpaceOnUse">
                <path
                  d="M 14 0 L 0 0 0 14"
                  fill="none"
                  stroke="rgba(59,130,246,0.45)"
                  strokeWidth="0.6"
                  className="hero-vivo-mesh-line"
                />
              </pattern>
              <clipPath id="clipFootL" clipPathUnits="userSpaceOnUse">
                <path d={FOOT_PATH_D} transform="translate(140 40)" />
              </clipPath>
              <clipPath id="clipFootR" clipPathUnits="userSpaceOnUse">
                <path d={FOOT_PATH_D} transform="translate(540 40)" />
              </clipPath>
              <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Griglia mesh “dentro” il piede — animata via CSS */}
            <g className="hero-vivo-mesh-pulse" filter="url(#softGlow)">
              <rect
                x="0"
                y="0"
                width="900"
                height="380"
                fill="url(#meshGrid)"
                clipPath="url(#clipFootL)"
                opacity={0.85}
              />
              <rect
                x="0"
                y="0"
                width="900"
                height="380"
                fill="url(#meshGrid)"
                clipPath="url(#clipFootR)"
                opacity={0.85}
              />
            </g>

            {/* Contorno piede */}
            <g fill="url(#footSkin)" stroke="url(#footStroke)" strokeWidth="2.2" strokeLinejoin="round">
              <path d={FOOT_PATH_D} transform="translate(140 40)" />
              <path d={FOOT_PATH_D} transform="translate(540 40)" />
            </g>

            {/* Linee di costruzione / triangoli (effetto CAD) */}
            <g stroke="rgba(147,197,253,0.35)" strokeWidth="0.8" fill="none" opacity={0.9}>
              <path d="M 180 200 L 250 120 L 320 200" transform="translate(0,0)" />
              <path d="M 580 200 L 650 120 L 720 200" />
              <line x1="200" y1="280" x2="260" y2="200" strokeDasharray="4 6" />
              <line x1="640" y1="280" x2="700" y2="200" strokeDasharray="4 6" />
            </g>

            {/* Punti “vertici” mesh */}
            <g fill="#60a5fa">
              <circle cx="248" cy="148" r="3" className="hero-vivo-dot" />
              <circle cx="318" cy="198" r="2.5" className="hero-vivo-dot" style={{ animationDelay: "0.2s" }} />
              <circle cx="648" cy="148" r="3" className="hero-vivo-dot" style={{ animationDelay: "0.4s" }} />
              <circle cx="718" cy="198" r="2.5" className="hero-vivo-dot" style={{ animationDelay: "0.6s" }} />
            </g>
          </svg>
        </motion.div>

        <p className="relative z-10 mt-2 max-w-lg text-center text-xs text-zinc-500">
          Mesh e linee sono illustrative — come nelle landing scan-to-print professionali.
        </p>
      </div>

      {/* Blocco testi + CTA — come fascia in basso sulle hero tipo VivoBiome */}
      <div className="relative z-20 border-t border-zinc-800/80 bg-zinc-950/95 px-5 py-8 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/35 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-blue-300">
              <ScanLine className="h-3.5 w-3.5" strokeWidth={2} />
              Scan-to-print
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl sm:leading-tight">
              Dalla scansione alla stampa 3D su misura
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
              Due piedi, geometria che si compone e reticolo pronto per il TPU — esperienza home in stile{" "}
              <span className="text-zinc-300">footwear digitale</span>, sempre visibile senza plugin.
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
          </div>
        </div>
      </div>
    </section>
  );
}

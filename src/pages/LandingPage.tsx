"use client";

import React from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";

function FadeIn({
  children,
  delayMs = 0,
  className,
}: {
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.65, ease: "easeOut", delay: delayMs / 1000 }}
      viewport={{ once: true, margin: "-80px" }}
    >
      {children}
    </motion.div>
  );
}

function DecoShoe() {
  // Decorative SVG (no heavy WebGL): subtle, premium silhouette.
  return (
    <svg className="h-full w-full opacity-[0.9]" viewBox="0 0 1200 600" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="shoeGlow" x1="140" y1="140" x2="980" y2="520" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>
        <radialGradient id="shoeCore" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(720 270) rotate(90) scale(200 260)">
          <stop stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="softBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <g filter="url(#softBlur)">
        <path
          d="M245 330c40 14 96 18 156 10 72-10 132-40 198-74 62-31 109-55 162-45 49 9 79 41 111 77 32 36 67 71 102 98 20 16 33 30 34 42 1 10-7 19-22 27-26 14-71 22-140 26-109 6-249 4-372-12-102-13-193-39-227-67-14-12-21-22-19-32 3-12 20-22 26-23z"
          fill="url(#shoeGlow)"
        />
        <path
          d="M320 345c22 7 53 9 95 4 68-8 129-39 196-74 59-31 108-58 165-50 46 7 74 39 105 73 33 37 69 72 103 98 18 14 27 24 27 34 0 7-5 14-15 19-23 11-65 18-133 22-107 6-245 4-365-12-93-13-177-38-204-58-11-8-17-15-16-22 1-7 8-14 12-14z"
          fill="url(#shoeCore)"
        />
      </g>
    </svg>
  );
}

function IconStep({ type }: { type: "scan" | "shape" | "print" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  if (type === "scan") {
    return (
      <svg viewBox="0 0 64 64" className="h-6 w-6" aria-hidden="true">
        <path {...common} d="M18 24c0-4 3-7 7-7h14c4 0 7 3 7 7v16c0 4-3 7-7 7H25c-4 0-7-3-7-7V24z" />
        <path {...common} d="M24 32h16" />
        <path {...common} d="M32 24v16" opacity="0.9" />
        <path {...common} d="M20 14l4 4M44 14l-4 4M20 50l4-4M44 50l-4-4" opacity="0.85" />
      </svg>
    );
  }

  if (type === "shape") {
    return (
      <svg viewBox="0 0 64 64" className="h-6 w-6" aria-hidden="true">
        <path {...common} d="M32 10l18 10v24L32 54 14 44V20l18-10z" />
        <path {...common} d="M32 10v44" opacity="0.9" />
        <path {...common} d="M14 20l18 10 18-10" opacity="0.9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" className="h-6 w-6" aria-hidden="true">
      <path {...common} d="M16 26V18h32v8" />
      <path {...common} d="M20 50h24v-8H20v8z" />
      <path {...common} d="M20 26h24l6 10v14H14V36l6-10z" />
      <path {...common} d="M24 34h16" opacity="0.9" />
    </svg>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen bg-black text-white">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.10),transparent_45%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_15%,rgba(255,255,255,0.06),transparent_40%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.04),transparent_22%,rgba(255,255,255,0.02))]" />
      </div>

      {/* HERO */}
      <section className="relative flex min-h-[100dvh] items-center justify-center px-5">
        <div className="pointer-events-none absolute inset-0 opacity-25">
          <DecoShoe />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
          <motion.h1
            className="text-4xl font-semibold tracking-tight sm:text-6xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            Scarpe create sul tuo piede
          </motion.h1>
          <motion.p
            className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-[#e5e5e5] sm:text-lg"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.08 }}
          >
            Scansiona. Genera. Indossa.
          </motion.p>

          <FadeIn className="mt-8" delayMs={130}>
            <div className="flex flex-col items-center gap-3">
              <Button
                type="button"
                size="lg"
                onClick={() => navigate("/prepara-scansione")}
                className="rounded-full border border-white/25 bg-white/5 px-8 text-base font-semibold text-white backdrop-blur-sm hover:bg-white/10"
              >
                Inizia la scansione
              </Button>
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="rounded-full border border-white/15 bg-white/[0.06] px-5 text-xs font-medium text-white/90 hover:bg-white/[0.12]"
              >
                <a href="/neuma-guida-stampa-a4.pdf" target="_blank" rel="noopener noreferrer">
                  Stampa il foglio A4
                </a>
              </Button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* SECTION 2: HOW IT WORKS */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20">
        <FadeIn>
          <div className="flex items-baseline justify-between gap-6">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Come funziona</h2>
            <p className="max-w-md text-sm text-[#e5e5e5] sm:text-base">Un percorso semplice, pensato per te.</p>
          </div>
        </FadeIn>

        <div className="mt-10 grid gap-10 sm:grid-cols-3">
          <FadeIn delayMs={60}>
            <div className="flex flex-col gap-4">
              <div className="text-white/95">
                <IconStep type="scan" />
              </div>
              <div className="space-y-2">
                <div className="text-base font-semibold tracking-tight">Scansiona il piede</div>
                <div className="text-sm text-[#e5e5e5] sm:text-base">Raccogliamo la forma, in pochi istanti.</div>
              </div>
            </div>
          </FadeIn>

          <FadeIn delayMs={120}>
            <div className="flex flex-col gap-4">
              <div className="text-white/95">
                <IconStep type="shape" />
              </div>
              <div className="space-y-2">
                <div className="text-base font-semibold tracking-tight">Generiamo la forma</div>
                <div className="text-sm text-[#e5e5e5] sm:text-base">Calzata personalizzata, geometria precisa.</div>
              </div>
            </div>
          </FadeIn>

          <FadeIn delayMs={180}>
            <div className="flex flex-col gap-4">
              <div className="text-white/95">
                <IconStep type="print" />
              </div>
              <div className="space-y-2">
                <div className="text-base font-semibold tracking-tight">Stampiamo la tua scarpa</div>
                <div className="text-sm text-[#e5e5e5] sm:text-base">Produzione su richiesta, pronta per te.</div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* SECTION 3: VALUE */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-20">
        <FadeIn>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Valore</h2>
        </FadeIn>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {[
            "Nessuna taglia standard",
            "Calzata personalizzata",
            "Design generativo",
            "Produzione su richiesta",
          ].map((s, idx) => (
            <FadeIn key={s} delayMs={idx * 70} className="text-white">
              <div className="text-base font-semibold tracking-tight sm:text-lg">{s}</div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* SECTION 4: PRODUCT FOCUS */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-24">
        <FadeIn>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">NEUMA 01</h2>
        </FadeIn>

        <div className="mt-10 grid gap-10 items-center sm:grid-cols-2">
          <FadeIn className="order-2 sm:order-1" delayMs={90}>
            <div className="relative overflow-hidden">
              <div className="absolute inset-0 opacity-[0.12]">
                <DecoShoe />
              </div>
              <div className="relative mx-auto aspect-[4/3] w-full max-w-md">
                <svg className="h-full w-full" viewBox="0 0 520 390" fill="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="neuma01" x1="40" y1="50" x2="470" y2="340" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#ffffff" stopOpacity="0.35" />
                      <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" />
                      <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
                    </linearGradient>
                    <filter id="gblur" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="10" />
                    </filter>
                  </defs>
                  <path
                    d="M110 220c30 10 75 14 125 6 56-9 104-31 152-57 44-24 79-42 124-35 39 6 60 30 84 56 22 25 48 49 73 67 14 10 24 20 24 30 0 9-8 17-20 24-22 12-57 18-115 21-90 5-206 3-307-10-80-11-153-30-171-46-10-9-14-17-12-24 3-10 13-16 14-17z"
                    fill="url(#neuma01)"
                    filter="url(#gblur)"
                  />
                  <path
                    d="M145 232c18 6 42 8 78 4 52-7 99-30 147-56 42-23 76-44 120-39 34 4 54 25 75 48 24 26 49 51 73 69 11 9 18 16 18 24 0 6-5 12-13 16-17 9-49 13-99 16-83 5-194 3-286-9-68-9-130-28-143-38-7-5-10-10-9-15 1-5 4-9 7-9z"
                    fill="#ffffff"
                    opacity="0.06"
                  />
                </svg>
              </div>
            </div>
          </FadeIn>

          <FadeIn delayMs={120} className="text-center sm:text-left">
            <p className="mt-4 text-base leading-relaxed text-[#e5e5e5] sm:text-lg">
              Un modello essenziale, progettato per adattarsi alla tua impronta. Linee pulite, comfort reale.
            </p>
            <div className="mt-8">
              <Button
                type="button"
                size="lg"
                onClick={() => navigate("/su-misura")}
                className="rounded-full border border-white/25 bg-white/5 px-8 text-base font-semibold text-white backdrop-blur-sm hover:bg-white/10"
              >
                Scopri
              </Button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* SECTION 5: FINAL CTA */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-28">
        <FadeIn className="flex flex-col items-center text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">
            Prova la tua prima scarpa su misura
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#e5e5e5] sm:text-base">
            Parti dalla scansione e arriva al fitting. Tutto in pochi passi.
          </p>
          <div className="mt-8">
            <Button
              type="button"
              size="lg"
              onClick={() => navigate("/prepara-scansione")}
              className="rounded-full border border-white/25 bg-white/5 px-10 text-base font-semibold text-white backdrop-blur-sm hover:bg-white/10"
            >
              Scansiona il tuo piede
            </Button>
          </div>
        </FadeIn>
      </section>
    </div>
  );
}


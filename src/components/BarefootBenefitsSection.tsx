"use client";

import React from "react";
import { cn } from "../lib/utils";

/** Striscia orizzontale: 5 pannelli uguali (screenshot composito) */
const BENEFITS_STRIP_IMG = "/images/benefits-feet-strip.png";

/** Pannello immagine su tema scuro */
const PANEL_BG = "#141414" as const;

const BENEFITS: {
  id: number;
  panelIndex: number;
  label: string;
  title: string;
  body: string;
  imageAlt: string;
}[] = [
  {
    id: 1,
    panelIndex: 0,
    label: "Beneficio 1",
    title: "Piedi più forti e sani e maggiore mobilità",
    body: "Camminare a piedi nudi rafforza i muscoli dei piedi, migliorando il movimento, l'agilità e la resilienza, non solo nei piedi, ma in tutto il corpo.",
    imageAlt: "Piede reale in punta di piedi, vista laterale",
  },
  {
    id: 2,
    panelIndex: 1,
    label: "Beneficio 2",
    title: "Migliora la postura, l'equilibrio e la stabilità",
    body: "I piedi sono le fondamenta del tuo corpo: una base solida migliora postura, equilibrio e controllo a ogni passo.",
    imageAlt: "Modello 3D wireframe del piede su griglia",
  },
  {
    id: 3,
    panelIndex: 2,
    label: "Beneficio 3",
    title: "Previene e migliora alluce valgo e fascite plantare",
    body: "Le calzature a forma di piede aiutano a prevenire deformità come alluce valgo e piedi piatti, lasciando che i piedi si muovano senza restrizioni.",
    imageAlt: "Piede reale da dietro con arco e tallone sollevato",
  },
  {
    id: 4,
    panelIndex: 3,
    label: "Beneficio 4",
    title: "Riduce il rischio di stress articolare e condizioni correlate",
    body: "Indossare calzature minimal riduce il carico sulle articolazioni, in particolare ginocchia e anche, e può aiutare a prevenire condizioni come l'artrosi.",
    imageAlt: "Scansione anatomica semi-trasparente del piede",
  },
  {
    id: 5,
    panelIndex: 4,
    label: "Beneficio 5",
    title: "Migliore feedback sensoriale e funzione del piede",
    body: "Sentire il terreno sotto i piedi migliora propriocezione, tempi di reazione, coordinazione ed efficienza del movimento.",
    imageAlt: "Plantare del piede visto dal basso",
  },
];

/**
 * Un pannello della striscia (5 colonne uguali nell’immagine sorgente).
 */
function BenefitStripPanel({ panelIndex, alt }: { panelIndex: number; alt: string }) {
  return (
    <div
      className="relative h-full min-h-[200px] w-full overflow-hidden rounded-lg"
      style={{ backgroundColor: PANEL_BG }}
    >
      <div
        className="relative isolate h-full min-h-[196px] w-full overflow-hidden rounded-md"
        style={{ backgroundColor: PANEL_BG }}
      >
        <img
          src={BENEFITS_STRIP_IMG}
          alt={alt}
          width={2500}
          height={500}
          className="absolute left-0 top-0 h-full w-[500%] max-w-none origin-center object-cover object-[center_38%] opacity-92 brightness-[0.95] contrast-[1.05] saturate-[1.02]"
          style={{
            transform: `translateX(-${panelIndex * 20}%) scale(1.04)`,
          }}
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>
  );
}

export type BarefootBenefitsSectionProps = {
  className?: string;
};

/**
 * Sezione benefici — immagini da striscia a 5 pannelli (foto + mesh + scan), non più SVG blob.
 */
export default function BarefootBenefitsSection({ className }: BarefootBenefitsSectionProps) {
  return (
    <section
      id="benefici-piede"
      className={cn(
        "barefoot-benefits scroll-mt-24 border-t border-white/10 px-5 pb-8 pt-10 sm:scroll-mt-28",
        "bg-black text-white",
        className
      )}
      aria-labelledby="barefoot-benefits-heading"
    >
      <h2
        id="barefoot-benefits-heading"
        className="benefit-section-title mb-8 max-w-3xl text-2xl font-semibold tracking-tight text-white sm:text-3xl"
      >
        I benefici del vivere a piedi nudi
      </h2>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-5 xl:gap-6">
        {BENEFITS.map(({ id, panelIndex, label, title, body, imageAlt }) => (
          <article
            key={id}
            className="benefit-card flex flex-col border-b border-white/10 pb-8 last:border-b-0 sm:border-b-0 sm:pb-0 xl:border-0"
          >
            <div
              className="relative mb-4 aspect-square w-full overflow-hidden rounded-xl border border-white/10 shadow-none"
              style={{ backgroundColor: PANEL_BG }}
            >
              <BenefitStripPanel panelIndex={panelIndex} alt={imageAlt} />
            </div>
            <p className="benefit-label mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">{label}</p>
            <h3 className="benefit-title mb-2 text-base font-semibold leading-snug text-white">{title}</h3>
            <p className="benefit-body text-sm font-normal leading-relaxed text-[#e5e5e5]">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

"use client";

import React from "react";

/** Illustrazioni stilizzate (SVG) — ispirate al layout “benefits” tipo landing scan-to-print */

function IllustrationToesStrong() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="b1skin" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3f2d22" />
          <stop offset="50%" stopColor="#a67c5c" />
          <stop offset="100%" stopColor="#d4a574" />
        </linearGradient>
        <radialGradient id="b1spot" cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="rgba(59,130,246,0.35)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill="#0a0a0b" />
      <rect width="200" height="200" fill="url(#b1spot)" />
      {/* Piede di profilo in punta di piedi */}
      <path
        d="M 40 155 Q 45 95 78 72 Q 95 58 118 62 Q 142 68 152 88 Q 162 108 158 135 Q 154 165 128 172 Q 95 178 72 168 Q 48 162 40 155 Z"
        fill="url(#b1skin)"
        stroke="rgba(59,130,246,0.45)"
        strokeWidth="1.2"
      />
      <ellipse cx="118" cy="78" rx="22" ry="14" fill="rgba(0,0,0,0.2)" transform="rotate(-15 118 78)" />
      <path d="M 95 100 Q 110 88 128 95" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
    </svg>
  );
}

function IllustrationWireframeGrid() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
      <defs>
        <pattern id="b2grid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M 12 0 L 0 0 0 12" fill="none" stroke="rgba(82,82,91,0.6)" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="200" height="200" fill="#18181b" />
      <rect width="200" height="200" fill="url(#b2grid)" />
      <g transform="translate(100 108) scale(0.85)" stroke="#60a5fa" strokeWidth="1.2" fill="none">
        <path d="M -35 45 Q -50 10 -20 -35 Q 5 -55 35 -40 Q 55 -20 50 15 Q 48 40 35 45 Z" />
        <path d="M -20 -35 L -5 -50 L 15 -48" opacity="0.7" />
        <path d="M 0 0 L 0 35" strokeDasharray="3 4" opacity="0.5" />
        <circle cx="-8" cy="5" r="3" fill="rgba(96,165,250,0.3)" stroke="none" />
      </g>
    </svg>
  );
}

function IllustrationHeelLift() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="b3g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#27272a" />
          <stop offset="100%" stopColor="#09090b" />
        </linearGradient>
        <linearGradient id="b3skin" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#c9a27e" />
          <stop offset="100%" stopColor="#6d4c38" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill="url(#b3g)" />
      {/* Tallone e polpaccio da dietro */}
      <ellipse cx="100" cy="118" rx="38" ry="52" fill="url(#b3skin)" opacity={0.95} />
      <path d="M 72 95 Q 100 78 128 95" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
      <ellipse cx="100" cy="168" rx="28" ry="12" fill="#1a1410" />
      <path d="M 85 165 Q 100 148 115 165" fill="none" stroke="rgba(59,130,246,0.4)" strokeWidth="1" />
    </svg>
  );
}

function IllustrationGhostStructure() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
      <rect width="200" height="200" fill="#121214" />
      <g opacity="0.35" stroke="rgba(148,163,184,0.5)" strokeWidth="0.8" fill="none">
        <ellipse cx="100" cy="100" rx="70" ry="24" />
        <ellipse cx="100" cy="100" rx="50" ry="16" />
      </g>
      <g transform="translate(100 102)" stroke="rgba(147,197,253,0.55)" fill="rgba(59,130,246,0.08)">
        <path d="M -40 38 Q -55 5 -25 -38 Q 0 -52 28 -38 Q 48 -15 45 18 Q 42 38 25 42 Z" strokeWidth="1.2" fill="rgba(59,130,246,0.06)" />
        <path d="M -15 -25 L -5 -40 L 12 -38" fill="none" strokeWidth="0.9" />
        <path d="M 0 -10 L 0 25" strokeDasharray="2 3" opacity="0.8" />
        <path d="M -20 10 Q 0 -5 20 10" fill="none" opacity="0.6" />
      </g>
      <circle cx="100" cy="88" r="40" fill="none" stroke="rgba(59,130,246,0.15)" strokeWidth="1" />
    </svg>
  );
}

function IllustrationSoleView() {
  return (
    <svg viewBox="0 0 200 200" className="h-full w-full" aria-hidden>
      <defs>
        <radialGradient id="b5sole" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#3d2d24" />
          <stop offset="100%" stopColor="#1a1512" />
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill="#0c0c0e" />
      <ellipse cx="100" cy="105" rx="52" ry="78" fill="url(#b5sole)" stroke="rgba(59,130,246,0.35)" strokeWidth="1" />
      {/* Dita / cushion */}
      {[0, 1, 2, 3, 4].map((i) => (
        <ellipse
          key={i}
          cx={58 + i * 18}
          cy={48 + (i % 2) * 4}
          rx={i === 4 ? 9 : 11}
          ry={14}
          fill="rgba(201,162,126,0.35)"
          stroke="rgba(96,165,250,0.25)"
          strokeWidth="0.8"
        />
      ))}
      <ellipse cx="100" cy="128" rx="22" ry="32" fill="rgba(0,0,0,0.2)" />
    </svg>
  );
}

const BENEFITS: {
  id: number;
  label: string;
  title: string;
  body: string;
  Visual: () => React.JSX.Element;
}[] = [
  {
    id: 1,
    label: "[BENEFICIO 1]",
    title: "Piedi più forti e sani e maggiore mobilità",
    body: "Camminare a piedi nudi rafforza i muscoli dei piedi, migliorando il movimento, l'agilità e la resilienza, non solo nei piedi, ma in tutto il corpo.",
    Visual: IllustrationToesStrong,
  },
  {
    id: 2,
    label: "[BENEFICIO 2]",
    title: "Migliora la postura, l'equilibrio e la stabilità",
    body: "I piedi sono le fondamenta del tuo corpo: una base solida migliora postura, equilibrio e controllo a ogni passo.",
    Visual: IllustrationWireframeGrid,
  },
  {
    id: 3,
    label: "[BENEFICIO 3]",
    title: "Previene e migliora alluce valgo e fascite plantare",
    body: "Le calzature a forma di piede aiutano a prevenire deformità come alluce valgo e piedi piatti, lasciando che i piedi si muovano senza restrizioni.",
    Visual: IllustrationHeelLift,
  },
  {
    id: 4,
    label: "[BENEFICIO 4]",
    title: "Riduce il rischio di stress articolare e condizioni correlate",
    body: "Indossare calzature minimal riduce il carico sulle articolazioni, in particolare ginocchia e anche, e può aiutare a prevenire condizioni come l'artrosi.",
    Visual: IllustrationGhostStructure,
  },
  {
    id: 5,
    label: "[BENEFICIO 5]",
    title: "Migliore feedback sensoriale e funzione del piede",
    body: "Sentire il terreno sotto i piedi migliora propriocezione, tempi di reazione, coordinazione ed efficienza del movimento.",
    Visual: IllustrationSoleView,
  },
];

/**
 * Sezione “benefici del piede naturale” con testi in italiano e immagini stilizzate (SVG).
 * Layout ispirato alle landing tipo [VivoBiome](https://vivobiome.vivobarefoot.com/) — adattato al tema dark Alpino.
 */
export default function BarefootBenefitsSection() {
  return (
    <section
      className="mb-10 mt-2 border-t border-zinc-800/80 pt-10"
      aria-labelledby="barefoot-benefits-heading"
    >
      <h2
        id="barefoot-benefits-heading"
        className="mb-8 max-w-3xl text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl"
      >
        I benefici del vivere a piedi nudi
      </h2>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-5 xl:gap-6">
        {BENEFITS.map(({ id, label, title, body, Visual }) => (
          <article
            key={id}
            className="flex flex-col border-b border-zinc-800/60 pb-8 last:border-b-0 sm:border-b-0 sm:pb-0 xl:border-0"
          >
            <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-inner ring-1 ring-white/5">
              <Visual />
            </div>
            <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-wider text-blue-400/90">{label}</p>
            <h3 className="mb-2 text-base font-semibold leading-snug text-zinc-100">{title}</h3>
            <p className="text-sm leading-relaxed text-zinc-400">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

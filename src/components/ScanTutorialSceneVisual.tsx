"use client";

import React from "react";

/**
 * Illustrazioni tutorial scansione — stile pulito da prodotto (figure astratte,
 * palette coerente, leggibilità su sfondo chiaro nelle card del modale).
 */
const PW = 268;
const PH = 228;

function Defs() {
  return (
    <defs>
      <linearGradient id="sts-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f1f5f9" />
        <stop offset="100%" stopColor="#e2e8f0" />
      </linearGradient>
      <linearGradient id="sts-paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f8fafc" />
      </linearGradient>
      <filter id="sts-soft" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="b" />
        <feOffset dx="0" dy="1" in="b" result="o" />
        <feFlood floodColor="#0f172a" floodOpacity="0.06" />
        <feComposite in2="o" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <linearGradient id="sts-orbit" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
        <stop offset="50%" stopColor="#60a5fa" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.4" />
      </linearGradient>
    </defs>
  );
}

function PanelTopDown() {
  const paperX = 58;
  const paperY = 44;
  const paperW = 92;
  const paperH = 128;
  const cx = paperX + paperW / 2;
  const cy = paperY + paperH / 2;

  return (
    <g>
      <rect x={6} y={6} width={PW - 12} height={PH - 12} rx={14} fill="url(#sts-floor)" stroke="#e2e8f0" strokeWidth={1} />

      {/* Titolo pill */}
      <rect x={PW / 2 - 52} y={16} width={104} height={22} rx={11} fill="#fff" stroke="#e2e8f0" strokeWidth={0.8} />
      <text
        x={PW / 2}
        y={30.5}
        textAnchor="middle"
        fill="#334155"
        fontSize={10.5}
        fontWeight={650}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing={0.2}
      >
        Vista dall&apos;alto
      </text>

      {/* Foglio */}
      <rect
        x={paperX}
        y={paperY}
        width={paperW}
        height={paperH}
        rx={4}
        fill="url(#sts-paper)"
        stroke="#93c5fd"
        strokeWidth={1.1}
        filter="url(#sts-soft)"
      />
      {Array.from({ length: 8 }).map((_, i) => (
        <line
          key={`g-${i}`}
          x1={paperX + (i * paperW) / 7}
          y1={paperY}
          x2={paperX + (i * paperW) / 7}
          y2={paperY + paperH}
          stroke="#e2e8f0"
          strokeWidth={0.25}
          opacity={0.85}
        />
      ))}
      {Array.from({ length: 7 }).map((_, i) => (
        <line
          key={`h-${i}`}
          x1={paperX}
          y1={paperY + (i * paperH) / 6}
          x2={paperX + paperW}
          y2={paperY + (i * paperH) / 6}
          stroke="#e2e8f0"
          strokeWidth={0.25}
          opacity={0.85}
        />
      ))}
      <line x1={cx} y1={paperY} x2={cx} y2={paperY + paperH} stroke="#bfdbfe" strokeWidth={0.45} strokeDasharray="4 3" />
      <line x1={paperX} y1={cy} x2={paperX + paperW} y2={cy} stroke="#bfdbfe" strokeWidth={0.45} strokeDasharray="4 3" />
      <circle cx={cx} cy={cy} r={3.2} fill="none" stroke="#3b82f6" strokeWidth={0.75} opacity={0.85} />

      {/* Piede sul foglio — forma morbida */}
      <ellipse
        cx={cx + 0.5}
        cy={cy + 7}
        rx={13.5}
        ry={20}
        fill="#cbd5e1"
        stroke="#94a3b8"
        strokeWidth={0.75}
        transform={`rotate(-5 ${cx + 0.5} ${cy + 7})`}
        opacity={0.95}
      />
      <path
        d={`M ${cx - 5} ${cy - 7} Q ${cx} ${cy - 12} ${cx + 6} ${cy - 7}`}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={0.75}
        strokeLinecap="round"
      />

      {/* Altro piede — stile “ghost” elegante */}
      <ellipse cx={34} cy={cy + 14} rx={11} ry={17} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={0.8} strokeDasharray="3 2.5" />
      <text
        x={34}
        y={cy + 38}
        textAnchor="middle"
        fill="#64748b"
        fontSize={6.8}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        a terra
      </text>

      {/* Figura cliente: busto arrotondato + testa (no stick) */}
      <ellipse cx={cx} cy={paperY - 14} rx={11} ry={10} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.85} />
      <rect x={cx - 14} y={paperY - 6} width={28} height={22} rx={10} fill="#cbd5e1" stroke="#94a3b8" strokeWidth={0.75} />
      <path
        d={`M ${cx} ${paperY + 16} L ${cx + 3} ${cy - 6}`}
        stroke="#94a3b8"
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <path d={`M ${cx} ${paperY + 16} L ${34} ${cy + 2}`} stroke="#94a3b8" strokeWidth={3.2} strokeLinecap="round" />
      <text
        x={cx}
        y={paperY - 26}
        textAnchor="middle"
        fill="#475569"
        fontSize={7.5}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Cliente
      </text>

      {/* Orbita fluida */}
      <path
        d={`M ${paperX + paperW + 10} ${cy + 22} A 54 46 0 1 1 ${paperX - 8} ${cy - 12}`}
        fill="none"
        stroke="url(#sts-orbit)"
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.95}
      />
      <polygon points={`${paperX - 6},${cy - 10} ${paperX - 2},${cy - 4} ${paperX - 10},${cy - 6}`} fill="#60a5fa" opacity={0.9} />

      {/* Operatore dall’alto */}
      <ellipse cx={206} cy={54} rx={10} ry={9} fill="#dbeafe" stroke="#60a5fa" strokeWidth={0.9} />
      <rect x={196} y={62} width={20} height={24} rx={9} fill="#bfdbfe" stroke="#60a5fa" strokeWidth={0.75} />
      <path d="M 196 70 L 172 58" stroke="#60a5fa" strokeWidth={2.6} strokeLinecap="round" />
      <path d="M 216 70 L 228 78" stroke="#60a5fa" strokeWidth={2.6} strokeLinecap="round" />
      <g transform="translate(158, 50) rotate(-22)">
        <rect width={16} height={28} rx={3} fill="#1e293b" opacity={0.92} />
        <rect x={2} y={2} width={12} height={20} rx={1.5} fill="#334155" opacity={0.9} />
        <rect x={4} y={4} width={8} height={4} rx={1} fill="#60a5fa" opacity={0.35} />
      </g>
      <text
        x={206}
        y={112}
        textAnchor="middle"
        fill="#1d4ed8"
        fontSize={7.5}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Operatore
      </text>
      <text
        x={206}
        y={122}
        textAnchor="middle"
        fill="#64748b"
        fontSize={6.8}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        movimento lento
      </text>
    </g>
  );
}

function PanelSideView() {
  const groundY = 174;
  return (
    <g transform={`translate(${PW}, 0)`}>
      <rect x={6} y={6} width={PW - 12} height={PH - 12} rx={14} fill="url(#sts-floor)" stroke="#e2e8f0" strokeWidth={1} />

      <rect x={PW / 2 - 42} y={16} width={84} height={22} rx={11} fill="#fff" stroke="#e2e8f0" strokeWidth={0.8} />
      <text
        x={PW / 2}
        y={30.5}
        textAnchor="middle"
        fill="#334155"
        fontSize={10.5}
        fontWeight={650}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing={0.2}
      >
        Vista laterale
      </text>

      {/* Pavimento + ombra */}
      <ellipse cx={118} cy={groundY + 3} rx={108} ry={5} fill="#cbd5e1" opacity={0.35} />
      <line x1={14} y1={groundY} x2={PW - 14} y2={groundY} stroke="#94a3b8" strokeWidth={1.2} strokeLinecap="round" />

      {/* Foglio (sul pavimento) */}
      <rect x={78} y={groundY - 5} width={76} height={5} rx={1} fill="#fff" stroke="#93c5fd" strokeWidth={0.9} filter="url(#sts-soft)" />

      {/* Cliente — forme arrotondate, piede appoggiato sul foglio */}
      <ellipse cx={111} cy={groundY - 9} rx={15} ry={6.5} fill="#cbd5e1" stroke="#94a3b8" strokeWidth={0.75} />
      <rect x={92} y={58} width={26} height={56} rx={13} fill="#cbd5e1" stroke="#94a3b8" strokeWidth={0.75} />
      <path
        d="M 105 114 L 108 150 L 111 165"
        fill="none"
        stroke="#94a3b8"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 105 114 L 92 158 L 88 172"
        fill="none"
        stroke="#94a3b8"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <ellipse cx={88} cy={groundY - 4} rx={13} ry={5.5} fill="#cbd5e1" stroke="#94a3b8" strokeWidth={0.75} />
      <ellipse cx={105} cy={46} rx={14} ry={13} fill="#e2e8f0" stroke="#94a3b8" strokeWidth={0.85} />
      <text
        x={105}
        y={34}
        textAnchor="middle"
        fill="#475569"
        fontSize={7.5}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Cliente
      </text>

      {/* Operatore in piedi, inclinato verso il soggetto */}
      <ellipse cx={196} cy={groundY + 1} rx={12} ry={5} fill="#cbd5e1" opacity={0.4} />
      <rect x={184} y={62} width={24} height={96} rx={11} fill="#bfdbfe" stroke="#60a5fa" strokeWidth={0.85} />
      <ellipse cx={196} cy={50} rx={15} ry={14} fill="#dbeafe" stroke="#60a5fa" strokeWidth={0.9} />
      <path
        d="M 190 78 Q 168 88 142 92"
        fill="none"
        stroke="#60a5fa"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <g transform="translate(112, 74) rotate(-8)">
        <rect width={24} height={38} rx={4} fill="#1e293b" />
        <rect x={3} y={4} width={18} height={26} rx={2} fill="#475569" />
        <rect x={6} y={8} width={12} height={3} rx={1} fill="#60a5fa" opacity={0.4} />
      </g>

      {/* Indicazione campo visivo verso piede + foglio */}
      <path
        d={`M 128 86 L 108 ${groundY - 11} L 118 ${groundY - 8} Z`}
        fill="#3b82f6"
        opacity={0.1}
      />
      <line
        x1={128}
        y1={90}
        x2={108}
        y2={groundY - 10}
        stroke="#60a5fa"
        strokeWidth={0.9}
        strokeDasharray="4 3"
        opacity={0.55}
      />
      <text
        x={196}
        y={188}
        textAnchor="middle"
        fill="#1d4ed8"
        fontSize={7.5}
        fontWeight={600}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Operatore
      </text>
      <text
        x={196}
        y={198}
        textAnchor="middle"
        fill="#64748b"
        fontSize={6.8}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        foglio + piede in inquadratura
      </text>
    </g>
  );
}

export type ScanTutorialSceneVisualProps = {
  className?: string;
};

export default function ScanTutorialSceneVisual({ className }: ScanTutorialSceneVisualProps) {
  const totalW = PW * 2;
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
        <svg
          viewBox={`0 0 ${totalW} ${PH}`}
          className="mx-auto block h-auto w-full max-w-xl"
          role="img"
          aria-label="Schema: cliente con un piede sul foglio; operatore con telefono che si sposta lentamente inquadrando foglio e piede"
        >
          <title>Posizione cliente e operatore per la scansione del piede</title>
          <Defs />
          <PanelTopDown />
          <PanelSideView />
        </svg>
      </div>
      <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
        Un piede resta sul foglio; l&apos;altro a terra. Nello scanner segui{" "}
        <span className="font-medium text-foreground">4 inquadrature</span> nell&apos;ordine: dall&apos;alto, laterale
        esterna, laterale interna con arco, poi posteriore/tallone — sempre con{" "}
        <span className="font-medium text-foreground">foglio e 4 marker</span> visibili.
      </p>
    </div>
  );
}

"use client";

import React from "react";

/**
 * Illustrazioni didattiche per il tutorial scansione: omino con un piede sul foglio,
 * compagno/operatore con telefono e orbita per inquadrare il piede.
 */
const PW = 240;
const PH = 208;

function PanelTopDown() {
  const paperX = 58;
  const paperY = 38;
  const paperW = 92;
  const paperH = 130;
  const cx = paperX + paperW / 2;
  const cy = paperY + paperH / 2;

  return (
    <g>
      <rect x={4} y={4} width={PW - 8} height={PH - 8} rx={10} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={0.8} />
      <text x={PW / 2} y={22} textAnchor="middle" fill="#0f172a" fontSize={11} fontWeight={700} fontFamily="system-ui, sans-serif">
        Dall&apos;alto
      </text>

      {/* Foglio A4 */}
      <rect x={paperX} y={paperY} width={paperW} height={paperH} rx={2} fill="#fff" stroke="#2563eb" strokeWidth={1.2} />
      {/* Griglia leggera */}
      {Array.from({ length: 10 }).map((_, i) => (
        <line
          key={`g-${i}`}
          x1={paperX + (i * paperW) / 9}
          y1={paperY}
          x2={paperX + (i * paperW) / 9}
          y2={paperY + paperH}
          stroke="#e2e8f0"
          strokeWidth={0.35}
        />
      ))}
      {Array.from({ length: 8 }).map((_, i) => (
        <line
          key={`h-${i}`}
          x1={paperX}
          y1={paperY + (i * paperH) / 7}
          x2={paperX + paperW}
          y2={paperY + (i * paperH) / 7}
          stroke="#e2e8f0"
          strokeWidth={0.35}
        />
      ))}
      <line x1={cx} y1={paperY} x2={cx} y2={paperY + paperH} stroke="#3b82f6" strokeWidth={0.5} strokeDasharray="3 2" opacity={0.55} />
      <line x1={paperX} y1={cy} x2={paperX + paperW} y2={cy} stroke="#3b82f6" strokeWidth={0.5} strokeDasharray="3 2" opacity={0.55} />
      <circle cx={cx} cy={cy} r={3.5} fill="none" stroke="#2563eb" strokeWidth={0.9} />

      {/* Piede sul foglio (vista plantare semplificata) */}
      <ellipse
        cx={cx + 1}
        cy={cy + 8}
        rx={14}
        ry={22}
        fill="#e2e8f0"
        stroke="#64748b"
        strokeWidth={1}
        transform={`rotate(-6 ${cx + 1} ${cy + 8})`}
      />
      <path
        d={`M ${cx - 6} ${cy - 8} Q ${cx} ${cy - 14} ${cx + 7} ${cy - 8}`}
        fill="none"
        stroke="#64748b"
        strokeWidth={1}
        strokeLinecap="round"
      />

      {/* Secondo piede a terra (fuori foglio) */}
      <ellipse cx={38} cy={cy + 18} rx={12} ry={18} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 1.5" />
      <text x={38} y={cy + 42} textAnchor="middle" fill="#64748b" fontSize={6.5} fontFamily="system-ui, sans-serif">
        altro piede
      </text>

      {/* Omino dall'alto: testa, busto, braccia, gambe */}
      <circle cx={cx} cy={paperY - 12} r={10} fill="#fef3c7" stroke="#b45309" strokeWidth={1.2} />
      {/* Spalle */}
      <line x1={cx - 18} y1={paperY - 2} x2={cx + 18} y2={paperY - 2} stroke="#b45309" strokeWidth={2.2} strokeLinecap="round" />
      <line x1={cx} y1={paperY - 2} x2={cx} y2={paperY + 22} stroke="#b45309" strokeWidth={2.2} strokeLinecap="round" />
      {/* Gamba verso piede sul foglio */}
      <line x1={cx} y1={paperY + 22} x2={cx + 4} y2={cy - 2} stroke="#b45309" strokeWidth={2.2} strokeLinecap="round" />
      {/* Gamba verso piede fuori */}
      <line x1={cx} y1={paperY + 22} x2={38} y2={cy + 5} stroke="#b45309" strokeWidth={2.2} strokeLinecap="round" />
      <text x={cx} y={paperY - 22} textAnchor="middle" fill="#92400e" fontSize={7} fontWeight={600} fontFamily="system-ui, sans-serif">
        Cliente
      </text>

      {/* Orbita operatore + telefono */}
      <path
        d={`M ${paperX + paperW + 8} ${cy + 25} A 52 48 0 1 1 ${paperX - 5} ${cy - 15}`}
        fill="none"
        stroke="#2563eb"
        strokeWidth={1.4}
        strokeDasharray="5 4"
        opacity={0.9}
      />
      {/* Operatore (dall'alto) */}
      <circle cx={198} cy={52} r={9} fill="#dbeafe" stroke="#1d4ed8" strokeWidth={1.2} />
      <line x1={198} y1={61} x2={198} y2={92} stroke="#1d4ed8" strokeWidth={2} strokeLinecap="round" />
      <line x1={198} y1={72} x2={175} y2={62} stroke="#1d4ed8" strokeWidth={1.8} strokeLinecap="round" />
      {/* Telefono verso il piede */}
      <g transform="translate(158, 48) rotate(-25)">
        <rect x={0} y={0} width={14} height={26} rx={2} fill="#1e293b" stroke="#2563eb" strokeWidth={0.8} />
        <rect x={2} y={3} width={10} height={16} rx={1} fill="#334155" />
      </g>
      <text x={198} y={108} textAnchor="middle" fill="#1e40af" fontSize={7} fontWeight={600} fontFamily="system-ui, sans-serif">
        Operatore
      </text>
      <text x={198} y={118} textAnchor="middle" fill="#64748b" fontSize={6} fontFamily="system-ui, sans-serif">
        orbita lenta
      </text>
    </g>
  );
}

function PanelSideView() {
  const groundY = 168;
  return (
    <g transform={`translate(${PW}, 0)`}>
      <rect x={4} y={4} width={PW - 8} height={PH - 8} rx={10} fill="#f8fafc" stroke="#e2e8f0" strokeWidth={0.8} />
      <text x={PW / 2} y={22} textAnchor="middle" fill="#0f172a" fontSize={11} fontWeight={700} fontFamily="system-ui, sans-serif">
        Di lato
      </text>

      {/* Pavimento */}
      <line x1={12} y1={groundY} x2={PW - 12} y2={groundY} stroke="#94a3b8" strokeWidth={1.5} strokeLinecap="round" />

      {/* Foglio sul pavimento */}
      <rect x={72} y={groundY - 5} width={78} height={5} rx={0.5} fill="#fff" stroke="#2563eb" strokeWidth={0.9} />
      <line x1={76} y1={groundY - 2.5} x2={146} y2={groundY - 2.5} stroke="#e2e8f0" strokeWidth={0.3} />

      {/* Piede sul foglio (profilo) */}
      <ellipse cx={111} cy={groundY - 12} rx={16} ry={7} fill="#e2e8f0" stroke="#64748b" strokeWidth={1} />
      {/* Gamba sul foglio */}
      <line x1={108} y1={groundY - 12} x2={105} y2={95} stroke="#b45309" strokeWidth={3} strokeLinecap="round" />
      {/* Busto e testa cliente */}
      <line x1={105} y1={95} x2={102} y2={58} stroke="#b45309" strokeWidth={3} strokeLinecap="round" />
      <circle cx={100} cy={48} r={12} fill="#fef3c7" stroke="#b45309" strokeWidth={1.2} />
      {/* Gamba dietro (appoggio) */}
      <line x1={105} y1={95} x2={88} y2={groundY - 3} stroke="#b45309" strokeWidth={3} strokeLinecap="round" />
      <ellipse cx={84} cy={groundY - 5} rx={13} ry={6} fill="#e2e8f0" stroke="#64748b" strokeWidth={0.9} />
      <text x={95} y={38} textAnchor="middle" fill="#92400e" fontSize={6.5} fontWeight={600} fontFamily="system-ui, sans-serif">
        Cliente
      </text>

      {/* Operatore di fronte al piede, telefono puntato */}
      <circle cx={188} cy={52} r={11} fill="#dbeafe" stroke="#1d4ed8" strokeWidth={1.2} />
      <line x1={188} y1={63} x2={188} y2={155} stroke="#1d4ed8" strokeWidth={3} strokeLinecap="round" />
      <line x1={188} y1={78} x2={155} y2={72} stroke="#1d4ed8" strokeWidth={2.5} strokeLinecap="round" />
      {/* Telefono */}
      <g transform="translate(128, 62) rotate(-8)">
        <rect width={22} height={36} rx={3} fill="#1e293b" stroke="#2563eb" strokeWidth={1} />
        <rect x={3} y={4} width={16} height={24} rx={1} fill="#475569" />
      </g>
      {/* Cono / linee di mira verso il piede */}
      <line x1={138} y1={78} x2={108} y2={groundY - 14} stroke="#3b82f6" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.85} />
      <line x1={145} y1={88} x2={112} y2={groundY - 12} stroke="#3b82f6" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.85} />
      <text x={188} y={178} textAnchor="middle" fill="#1e40af" fontSize={7} fontWeight={600} fontFamily="system-ui, sans-serif">
        Operatore
      </text>
      <text x={188} y={188} textAnchor="middle" fill="#64748b" fontSize={6} fontFamily="system-ui, sans-serif">
        inquadra foglio + piede
      </text>

      {/* Freccia curva: movimento attorno */}
      <path
        d={`M 165 ${groundY - 35} A 38 28 0 1 1 165 ${groundY - 8}`}
        fill="none"
        stroke="#2563eb"
        strokeWidth={1.2}
        strokeDasharray="4 3"
        opacity={0.75}
      />
      <polygon points="168,92 172,98 164,96" fill="#2563eb" opacity={0.8} />
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
      <div className="overflow-hidden rounded-xl border border-blue-200/80 bg-white shadow-sm">
        <svg
          viewBox={`0 0 ${totalW} ${PH}`}
          className="mx-auto block h-auto w-full max-w-lg"
          role="img"
          aria-label="Schema: cliente con un piede sul foglio; operatore con telefono che orbita e inquadra il piede"
        >
          <title>Posizione cliente e operatore per la scansione del piede</title>
          <PanelTopDown />
          <PanelSideView />
        </svg>
      </div>
      <p className="mt-2 text-center text-xs leading-snug text-muted-foreground">
        Un piede resta interamente sul foglio (tallone verso il centro); l&apos;altro è a terra accanto. L&apos;operatore si
        sposta lentamente mantenendo inquadrati insieme foglio e piede.
      </p>
    </div>
  );
}

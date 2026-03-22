"use client";

import React from "react";
import { cn } from "../../lib/utils";
import { SCAN_PHASE_REFERENCE_PHOTO, type ScanPhaseId } from "../../constants/scanCapturePhases";

const BLUE = "#2563eb";
const SCREEN_BG = "#0f172a";

/** Marker ArUco stilizzato (pattern a scacchiera) */
function ArucoMarker({ x, y, s = 14 }: { x: number; y: number; s?: number }) {
  const u = s / 4;
  return (
    <g transform={`translate(${x},${y})`} aria-hidden>
      <rect width={s} height={s} fill="#0a0a0a" stroke="#1e293b" strokeWidth={0.5} rx={1} />
      <rect width={u * 2} height={u * 2} fill="#fafafa" x={u} y={u} />
      <rect width={u} height={u} fill="#0a0a0a" />
      <rect width={u} height={u} fill="#0a0a0a" x={u * 3} />
      <rect width={u} height={u} fill="#0a0a0a" y={u * 3} />
      <rect width={u} height={u} fill="#fafafa" x={u * 3} y={u * 3} />
    </g>
  );
}

function PhoneShell({ pid, children }: { pid: string; children: React.ReactNode }) {
  return (
    <g>
      <defs>
        <linearGradient id={`${pid}-bezel`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#27272a" />
          <stop offset="100%" stopColor="#18181b" />
        </linearGradient>
        <linearGradient id={`${pid}-screen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor={SCREEN_BG} />
        </linearGradient>
      </defs>
      {/* Cornice telefono */}
      <rect x="28" y="16" width="304" height="368" rx="36" fill={`url(#${pid}-bezel)`} stroke="#3f3f46" strokeWidth="1.2" />
      <rect x="40" y="36" width="280" height="320" rx="24" fill={`url(#${pid}-screen)`} stroke="#334155" strokeWidth="0.8" />
      {/* Notch */}
      <rect x="148" y="40" width="64" height="5" rx="2.5" fill="#0f172a" opacity={0.9} />
      {children}
    </g>
  );
}

/** Overlay NEUMA: rettangolo blu semitrasparente + mirino (come in camera) */
function ScannerOverlay({
  x,
  y,
  w,
  h,
  rx = 28,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={rx}
        fill={BLUE}
        fillOpacity={0.22}
        stroke={BLUE}
        strokeOpacity={0.55}
        strokeWidth={2}
      />
      <g transform={`translate(${x + w / 2}, ${y + h / 2})`}>
        <circle r="52" fill="none" stroke={BLUE} strokeWidth={1.8} strokeOpacity={0.85} />
        <circle r="38" fill="none" stroke={BLUE} strokeWidth={1.2} strokeOpacity={0.5} />
        <circle r="26" fill="none" stroke={BLUE} strokeWidth={0.9} strokeOpacity={0.35} />
        <circle r="5" fill={BLUE} fillOpacity={0.35} />
      </g>
    </g>
  );
}

function Phase0Top({ pid }: { pid: string }) {
  const px = 62;
  const py = 108;
  const pw = 236;
  const ph = 200;
  return (
    <g>
      {/* Foglio A4 stilizzato (vista dall’alto) */}
      <rect x={px} y={py} width={pw} height={ph} rx={4} fill="#fafafa" stroke="#93c5fd" strokeWidth={1.2} />
      {Array.from({ length: 12 }).map((_, i) => (
        <line
          key={`gx-${i}`}
          x1={px + (i * pw) / 11}
          y1={py}
          x2={px + (i * pw) / 11}
          y2={py + ph}
          stroke="#e2e8f0"
          strokeWidth={0.35}
        />
      ))}
      {Array.from({ length: 10 }).map((_, i) => (
        <line
          key={`gy-${i}`}
          x1={px}
          y1={py + (i * ph) / 9}
          x2={px + pw}
          y2={py + (i * ph) / 9}
          stroke="#e2e8f0"
          strokeWidth={0.35}
        />
      ))}
      <ArucoMarker x={px + 4} y={py + 4} />
      <ArucoMarker x={px + pw - 18} y={py + 4} />
      <ArucoMarker x={px + 4} y={py + ph - 18} />
      <ArucoMarker x={px + pw - 18} y={py + ph - 18} />
      {/* Piede plantare */}
      <ellipse cx="180" cy="218" rx="38" ry="58" fill="#cbd5e1" stroke="#64748b" strokeWidth={1.2} />
      <path
        d="M 152 168 Q 180 155 208 168"
        fill="none"
        stroke="#64748b"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <ScannerOverlay x={72} y={118} w={216} h={180} rx={20} />
      {/* Icona telefono sopra */}
      <g transform="translate(180 78)">
        <rect x="-16" y="-22" width="32" height="44" rx="5" fill="#1e293b" stroke={BLUE} strokeWidth={1.2} />
        <rect x="-12" y="-16" width="24" height="30" rx={2} fill="#334155" opacity={0.9} />
        <text x="0" y="38" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="ui-sans-serif, system-ui">
          sopra il piede
        </text>
      </g>
    </g>
  );
}

function Phase1Outer({ pid }: { pid: string }) {
  return (
    <g>
      {/* Pavimento */}
      <line x1="52" y1="288" x2="308" y2="288" stroke="#475569" strokeWidth={2} strokeLinecap="round" />
      <rect x="78" y="278" width="204" height="10" rx={1} fill="#fafafa" stroke="#93c5fd" strokeWidth={0.8} />
      <ArucoMarker x={82} y={268} s={12} />
      <ArucoMarker x={266} y={268} s={12} />
      {/* Piede profilo esterno (mignolo a destra) */}
      <path
        d="M 155 278 L 158 200 Q 162 175 175 165 Q 195 158 210 175 L 218 278 Z"
        fill="#cbd5e1"
        stroke="#64748b"
        strokeWidth={1.2}
      />
      <ellipse cx="188" cy="172" rx="14" ry="10" fill="#cbd5e1" stroke="#64748b" strokeWidth={0.8} />
      <ScannerOverlay x={70} y={130} w={220} h={168} rx={22} />
      {/* Telefono basso a destra */}
      <g transform="translate(248 198) rotate(-12)">
        <rect x="-11" y="-26" width="22" height="48" rx="4" fill="#1e293b" stroke={BLUE} strokeWidth={1} />
        <text x="0" y="38" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="ui-sans-serif, system-ui">
          lato mignolo
        </text>
      </g>
      <path d="M 235 210 L 210 205" stroke={BLUE} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.7} markerEnd={`url(#${pid}-arr)`} />
      <defs>
        <marker id={`${pid}-arr`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <polygon points="0 0, 5 2.5, 0 5" fill={BLUE} opacity={0.8} />
        </marker>
      </defs>
    </g>
  );
}

function Phase2InnerArc({ pid }: { pid: string }) {
  return (
    <g>
      <line x1="52" y1="288" x2="308" y2="288" stroke="#475569" strokeWidth={2} strokeLinecap="round" />
      <rect x="78" y="278" width="204" height="10" rx={1} fill="#fafafa" stroke="#93c5fd" strokeWidth={0.8} />
      <ArucoMarker x={82} y={268} s={12} />
      <ArucoMarker x={266} y={268} s={12} />
      {/* Piede lato interno — arco */}
      <path
        d="M 205 278 L 200 210 Q 195 185 175 175 Q 145 168 130 195 L 125 278 Z"
        fill="#cbd5e1"
        stroke="#64748b"
        strokeWidth={1.2}
      />
      <path
        d="M 138 210 Q 165 188 192 205"
        fill="none"
        stroke="#64748b"
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.85}
      />
      <ScannerOverlay x={68} y={125} w={224} h={178} rx={22} />
      {/* Arco movimento telefono */}
      <path
        d="M 118 215 Q 155 165 205 175"
        fill="none"
        stroke={BLUE}
        strokeWidth={2}
        strokeDasharray="6 5"
        strokeLinecap="round"
        opacity={0.9}
      />
      <g transform="translate(108 218) rotate(18)">
        <rect x="-11" y="-26" width="22" height="48" rx="4" fill="#1e293b" stroke={BLUE} strokeWidth={1} />
      </g>
      <text x="180" y="100" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="ui-sans-serif, system-ui">
        arco plantare
      </text>
    </g>
  );
}

function Phase3Heel({ pid }: { pid: string }) {
  return (
    <g>
      <line x1="52" y1="298" x2="308" y2="298" stroke="#475569" strokeWidth={2} strokeLinecap="round" />
      <rect x="88" y="288" width="184" height="10" rx={1} fill="#fafafa" stroke="#93c5fd" strokeWidth={0.8} />
      <ArucoMarker x={92} y={278} s={12} />
      <ArucoMarker x={256} y={278} s={12} />
      {/* Retro piede / tallone */}
      <path
        d="M 165 298 L 168 220 Q 170 195 180 175 Q 180 155 180 140"
        fill="none"
        stroke="#94a3b8"
        strokeWidth={14}
        strokeLinecap="round"
      />
      <ellipse cx="180" cy="285" rx="22" ry="12" fill="#cbd5e1" stroke="#64748b" strokeWidth={1} />
      <circle cx="180" cy="148" r="16" fill="#cbd5e1" stroke="#64748b" strokeWidth={1} />
      <ScannerOverlay x={72} y={118} w={216} h={198} rx={24} />
      <g transform="translate(180 330)">
        <text x="0" y="0" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="ui-sans-serif, system-ui">
          dietro al tallone
        </text>
      </g>
      <g transform="translate(180 72) rotate(8)">
        <rect x="-13" y="-28" width="26" height="52" rx="4" fill="#1e293b" stroke={BLUE} strokeWidth={1.2} />
      </g>
      <path d="M 180 118 L 180 165" stroke={BLUE} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
    </g>
  );
}

export type ScanPhaseGuideIllustrationProps = {
  phaseId: ScanPhaseId;
  className?: string;
  /** Pannello scanner full | compatto per griglia guida */
  variant?: "panel" | "compact";
};

/**
 * Illustrazioni vettoriali stile NEUMA: cornice telefono, overlay blu, mirino, foglio + marker, piede per fase.
 */
export default function ScanPhaseGuideIllustration({
  phaseId,
  className,
  variant = "panel",
}: ScanPhaseGuideIllustrationProps) {
  const pid = `spg-${phaseId}`;
  const ref = SCAN_PHASE_REFERENCE_PHOTO[phaseId];
  const titleId = `${pid}-title`;

  const body =
    phaseId === 0 ? (
      <Phase0Top pid={pid} />
    ) : phaseId === 1 ? (
      <Phase1Outer pid={pid} />
    ) : phaseId === 2 ? (
      <Phase2InnerArc pid={pid} />
    ) : (
      <Phase3Heel pid={pid} />
    );

  return (
    <svg
      viewBox="0 0 360 400"
      className={cn(
        "h-auto w-full text-zinc-400",
        variant === "panel" ? "max-h-[min(52vh,440px)]" : "max-h-[210px]",
        className
      )}
      role="img"
      aria-labelledby={titleId}
    >
      <title id={titleId}>{ref.alt}</title>
      <PhoneShell pid={pid}>{body}</PhoneShell>
      {/* Etichetta stile app */}
      <text
        x="180"
        y="392"
        textAnchor="middle"
        fill="#64748b"
        fontSize="10"
        fontFamily="ui-monospace, monospace"
        letterSpacing="0.08em"
      >
        NEUMA · schema inquadratura
      </text>
    </svg>
  );
}

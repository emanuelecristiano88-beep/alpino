"use client";

import React, { useId } from "react";

/**
 * Piedi stilizzati ma riconoscibili: plantare con 5 dita + tallone, profilo, tallone posteriore.
 */

const STROKE = "rgba(59,130,246,0.75)";
const STROKE_W = 1.8;

type ComposedProps = {
  /** solo linee (mesh) */
  wireframe?: boolean;
  /** più trasparente (effetto “fantasma”) */
  ghost?: boolean;
};

/**
 * Plantare sinistro (vista dal basso): alluce a destra, mignolo a sinistra.
 */
export function FootPlantarLeftComposed({ wireframe, ghost }: ComposedProps) {
  const uid = useId().replace(/:/g, "");
  const skinId = `skin-${uid}`;
  const fill = wireframe ? "none" : `url(#${skinId})`;
  const opacity = ghost ? 0.45 : 1;

  return (
    <g opacity={opacity}>
      <defs>
        <linearGradient id={skinId} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#3d2a1f" />
          <stop offset="50%" stopColor="#9d6b4a" />
          <stop offset="100%" stopColor="#d4a574" />
        </linearGradient>
      </defs>

      {/* Tallone */}
      <ellipse cx="100" cy="168" rx="30" ry="14" fill={fill} stroke={STROKE} strokeWidth={STROKE_W} />

      {/* Avampiede / arco */}
      <ellipse cx="100" cy="118" rx="44" ry="56" fill={fill} stroke={STROKE} strokeWidth={STROKE_W} />

      {/* Alluce (mediale) */}
      <ellipse cx="142" cy="54" rx="22" ry="17" fill={fill} stroke={STROKE} strokeWidth={STROKE_W} />

      {/* 2ª–5ª dita */}
      <ellipse cx="118" cy="48" rx="12" ry="11" fill={fill} stroke={STROKE} strokeWidth={STROKE_W} />
      <ellipse cx="100" cy="46" rx="11" ry="11" fill={fill} stroke={STROKE} strokeWidth={STROKE_W} />
      <ellipse cx="82" cy="50" rx="10" ry="11" fill={fill} stroke={STROKE} strokeWidth={STROKE_W} />
      <ellipse cx="64" cy="58" rx="9" ry="11" fill={fill} stroke={STROKE} strokeWidth={STROKE_W} />

      {/* Solchi tra le dita (solo versione piena) */}
      {!wireframe && !ghost ? (
        <g stroke="rgba(0,0,0,0.28)" strokeWidth="1.2" fill="none" strokeLinecap="round">
          <path d="M 78 58 Q 88 90 92 118" />
          <path d="M 96 52 Q 98 90 98 118" />
          <path d="M 112 52 Q 106 90 104 118" />
          <path d="M 128 58 Q 118 95 114 120" />
        </g>
      ) : null}
    </g>
  );
}

/** Plantare destro = speculare (alluce a sinistra) */
export function FootPlantarRightComposed(props: ComposedProps) {
  return (
    <g transform="translate(200 0) scale(-1 1)">
      <FootPlantarLeftComposed {...props} />
    </g>
  );
}

/** Profilo in punta di piedi — tallone sollevato, avampiede a terra */
export function FootSideEnPointe() {
  const uid = useId().replace(/:/g, "");
  const skinId = `sk2-${uid}`;
  return (
    <g>
      <defs>
        <linearGradient id={skinId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#3d2a1f" />
          <stop offset="100%" stopColor="#d4a574" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill="#0a0a0b" />
      <path
        d="M 48 172 C 42 130 48 78 72 48 C 88 28 118 18 142 28 C 168 40 178 78 172 118 C 168 152 148 172 118 178 C 98 182 72 178 48 172 Z"
        fill={`url(#${skinId})`}
        stroke={STROKE}
        strokeWidth={STROKE_W}
        strokeLinejoin="round"
      />
      {/* Dita a contatto */}
      <path
        d="M 118 178 L 132 168 L 148 162 L 158 168"
        fill="none"
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Tallone in alto */}
      <ellipse cx="72" cy="52" rx="22" ry="28" fill="rgba(0,0,0,0.15)" />
    </g>
  );
}

/** Tallone + gamba da dietro */
export function FootHeelBackView() {
  const uid = useId().replace(/:/g, "");
  const skinId = `sk3-${uid}`;
  return (
    <g>
      <defs>
        <linearGradient id={skinId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#c9a27e" />
          <stop offset="100%" stopColor="#5c4030" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill="#0c0c0e" />
      {/* Polpaccio */}
      <path
        d="M 72 42 Q 100 22 128 42 L 138 120 Q 100 132 62 120 Z"
        fill={`url(#${skinId})`}
        stroke={STROKE}
        strokeWidth={1.5}
      />
      {/* Tallone */}
      <ellipse cx="100" cy="148" rx="36" ry="44" fill={`url(#${skinId})`} stroke={STROKE} strokeWidth={STROKE_W} />
      <ellipse cx="100" cy="178" rx="28" ry="10" fill="#1a1410" />
    </g>
  );
}

"use client";

import React from "react";
import { NEUMA_A4_TARGET_PREVIEW } from "../lib/neumaAssets";

/**
 * Guida visiva: anteprima foglio NEUMA (target A4 + ArUco); fallback SVG se l’asset manca.
 */
export default function TutorialA4GuideVisual() {
  const [useRaster, setUseRaster] = React.useState(true);

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-zinc-900/40">
      {useRaster ? (
        <img
          src={NEUMA_A4_TARGET_PREVIEW}
          alt="Foglio NEUMA: muovi il telefono in orbita tenendo visibili foglio e marker agli angoli"
          className="h-full w-full object-contain"
          onError={() => setUseRaster(false)}
        />
      ) : (
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 240" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="tutorial-a4-paper" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fafafa" />
              <stop offset="100%" stopColor="#e4e4e7" />
            </linearGradient>
            <filter id="tutorial-a4-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.25" />
            </filter>
          </defs>

          {/* Foglio A4 (~210×297 mm) */}
          <rect
            x="92"
            y="18"
            width="136"
            height="192"
            rx="2"
            fill="url(#tutorial-a4-paper)"
            stroke="#2563eb"
            strokeOpacity={0.45}
            strokeWidth="2"
            filter="url(#tutorial-a4-shadow)"
          />

          {/* Sagoma piede */}
          <ellipse cx="160" cy="128" rx="34" ry="52" fill="#d4d4d8" stroke="#71717a" strokeWidth="1.5" />
          <path
            d="M142 88 Q160 78 178 88"
            stroke="#71717a"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />

          {/* Orbita camera */}
          <ellipse
            cx="160"
            cy="118"
            rx="118"
            ry="88"
            stroke="#2563eb"
            strokeWidth="2"
            strokeDasharray="6 5"
            fill="none"
            opacity="0.85"
          />

          {Array.from({ length: 10 }).map((_, i) => {
            const t = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const x = 160 + Math.cos(t) * 118;
            const y = 118 + Math.sin(t) * 88;
            return (
              <circle key={i} cx={x} cy={y} r="3.5" fill="#2563eb" opacity={0.5 + (i % 3) * 0.15} />
            );
          })}

          <g transform="translate(248, 72) rotate(18)">
            <rect x="-10" y="-18" width="20" height="36" rx="3" fill="#27272a" stroke="#2563eb" strokeWidth="1.5" />
            <rect x="-6" y="-12" width="12" height="20" rx="1" fill="#3f3f46" />
          </g>

          <text
            x="160"
            y="228"
            textAnchor="middle"
            fill="hsl(var(--muted-foreground))"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
          >
            Orbita · foglio A4 visibile
          </text>
        </svg>
      )}
    </div>
  );
}

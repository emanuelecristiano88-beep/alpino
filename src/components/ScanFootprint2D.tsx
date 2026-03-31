import React from "react";
import { cn } from "../lib/utils";

/** Plantare stilizzato visto dall’alto — bordo neon blu (come ref. “medical dashboard”). */
const SOLE_PATH =
  "M 108 268 C 32 248 8 168 38 88 C 62 28 118 4 168 22 C 208 38 218 108 198 178 C 182 238 152 278 108 268 Z";

export type ScanFootprint2DProps = {
  className?: string;
};

export default function ScanFootprint2D({ className }: ScanFootprint2DProps) {
  return (
    <svg
      viewBox="0 0 220 300"
      className={cn("h-full w-full max-h-[200px]", className)}
      aria-hidden
    >
      <defs>
        <filter id="sole-neon" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="sole-stroke-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d={SOLE_PATH}
        fill="none"
        stroke="url(#sole-stroke-grad)"
        strokeWidth="3"
        strokeLinejoin="round"
        filter="url(#sole-neon)"
        opacity={0.95}
      />
      <path
        d={SOLE_PATH}
        fill="none"
        stroke="rgba(56,189,248,0.35)"
        strokeWidth="6"
        strokeLinejoin="round"
        className="blur-[0.5px]"
      />
    </svg>
  );
}

"use client";

import React from "react";
import { cn } from "@/lib/utils";

export type FootVisualizationMode = "real" | "pressure";

type Props = {
  mode: FootVisualizationMode;
  onChange: (mode: FootVisualizationMode) => void;
  className?: string;
  disabled?: boolean;
};

/**
 * Segmented control: photographic / texture view vs pseudo-pressure height map (B→G→R).
 */
export function FootVisualizationModeToggle({ mode, onChange, className, disabled }: Props) {
  return (
    <div
      className={cn(
        "inline-flex rounded-xl border border-white/15 bg-black/45 p-1 shadow-lg backdrop-blur-md",
        disabled && "pointer-events-none opacity-50",
        className
      )}
      role="tablist"
      aria-label="Visualization mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "real"}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors",
          mode === "real"
            ? "bg-white/20 text-white shadow-sm"
            : "text-white/65 hover:text-white/90"
        )}
        onClick={() => onChange("real")}
      >
        Real view
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "pressure"}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors",
          mode === "pressure"
            ? "bg-emerald-500/25 text-emerald-100 shadow-sm ring-1 ring-emerald-400/35"
            : "text-white/65 hover:text-white/90"
        )}
        onClick={() => onChange("pressure")}
      >
        Pressure view
      </button>
    </div>
  );
}

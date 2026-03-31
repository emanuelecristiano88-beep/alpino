import React from "react";
import { cn } from "../../lib/utils";

const R = 44;
const CIRC = 2 * Math.PI * R;

type Props = {
  /** 0–1 progresso acquisizione (es. foto correnti / 32) */
  progress: number;
  onClick?: () => void;
  disabled?: boolean;
  /** true = acquisizione automatica in corso */
  capturing?: boolean;
  label?: string;
  className?: string;
};

/**
 * Pulsante stile otturatore con anello di progresso blu (32 foto).
 */
export default function ScannerShutterButton({
  progress,
  onClick,
  disabled,
  capturing,
  label,
  className,
}: Props) {
  const p = Math.max(0, Math.min(1, progress));
  const dash = p * CIRC;

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "relative flex h-[92px] w-[92px] shrink-0 items-center justify-center rounded-full",
          "border border-sky-500/25 bg-black/50 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md",
          "transition-transform active:scale-[0.97]",
          disabled && "opacity-40",
          !disabled && !capturing && "hover:border-sky-400/50"
        )}
        aria-label={label || "Scatta o avvia fase"}
      >
        <svg width="92" height="92" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle
            cx="46"
            cy="46"
            r={R}
            fill="none"
            stroke="rgba(56,189,248,0.18)"
            strokeWidth="5"
          />
          <circle
            cx="46"
            cy="46"
            r={R}
            fill="none"
            stroke="rgb(56,189,248)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRC}`}
            className="transition-[stroke-dasharray] duration-300 ease-out"
          />
        </svg>
        <span
          className={cn(
            "relative z-[1] h-14 w-14 rounded-full border-2 border-sky-400/90 bg-sky-500/20",
            capturing && "animate-pulse border-sky-300"
          )}
        />
      </button>
      {label ? (
        <span className="max-w-[200px] text-center font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400/90">
          {label}
        </span>
      ) : null}
    </div>
  );
}

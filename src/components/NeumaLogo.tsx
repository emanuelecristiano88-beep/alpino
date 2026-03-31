"use client";

import { cn } from "../lib/utils";

export type NeumaLogoProps = {
  className?: string;
  /** Altezza visiva (Tailwind: es. h-8, h-9) */
  size?: "sm" | "md" | "lg";
  /**
   * `light` = wordmark scuro su grigio chiaro (`neuma-logo.png`) — header home / pagine chiare.
   * `dark` = wordmark bianco su trasparente (`neuma-logo-white.png`) — UI scure / camera overlay.
   */
  variant?: "light" | "dark";
};

const sizeClass = {
  sm: "h-6 max-w-[160px] sm:h-7",
  md: "h-8 max-w-[200px] sm:h-9",
  lg: "h-10 max-w-[260px] sm:h-11",
} as const;

const SRC: Record<NonNullable<NeumaLogoProps["variant"]>, string> = {
  light: "/images/neuma-logo.png",
  dark: "/images/neuma-logo-white.png",
};

/**
 * Wordmark NEUMA — asset in `/public/images/`: chiaro per sfondi chiari, bianco trasparente per scuri.
 */
export default function NeumaLogo({ className, size = "md", variant = "light" }: NeumaLogoProps) {
  return (
    <img
      src={SRC[variant]}
      alt="NEUMA"
      width={320}
      height={80}
      className={cn("w-auto object-contain object-left", sizeClass[size], className)}
      loading="eager"
      decoding="async"
    />
  );
}

import React from "react";
import { cn } from "../../lib/utils";

/**
 * Prisma rettangolare (bounding box) in vista isometrica + leggera prospettiva CSS,
 * effetto “appoggiato” sul pavimento.
 */
export default function ScanVolumePrism3D({
  className,
  accentClassName = "stroke-[#38bdf8]",
}: {
  className?: string;
  accentClassName?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none flex select-none items-center justify-center",
        "[perspective:880px] [perspective-origin:50%_62%]",
        className
      )}
      aria-hidden
    >
      <div
        className="origin-bottom transform-gpu transition-transform duration-700 ease-out will-change-transform"
        style={{ transform: "rotateX(14deg) rotateY(-10deg) translateZ(0)" }}
      >
        <svg
          viewBox="0 0 220 280"
          className="h-[min(48dvh,320px)] w-[min(72vw,260px)] max-w-[90vw] drop-shadow-[0_14px_42px_rgba(56,189,248,0.14)]"
          fill="none"
        >
          <ellipse cx="110" cy="258" rx="74" ry="11" className="fill-black/40" opacity={0.55} />

          <path
            d="M 52 88 L 168 72 L 168 198 L 52 214 Z"
            className={cn("fill-sky-500/[0.06]", accentClassName)}
            strokeWidth={1.2}
            strokeOpacity={0.35}
          />
          <path
            d="M 168 72 L 188 108 L 188 232 L 168 198 Z"
            className={cn("fill-sky-400/[0.07]", accentClassName)}
            strokeWidth={1.2}
            strokeOpacity={0.45}
          />
          <path
            d="M 52 88 L 72 52 L 188 36 L 168 72 Z"
            className={cn("fill-sky-300/[0.09]", accentClassName)}
            strokeWidth={1.35}
            strokeOpacity={0.55}
          />
          <path
            d="M 52 88 L 72 52 L 72 176 L 52 214 Z"
            className={cn("fill-sky-500/[0.05]", accentClassName)}
            strokeWidth={1.35}
            strokeOpacity={0.5}
          />
          <path d="M 72 52 L 188 36" className={accentClassName} strokeWidth={1.5} strokeOpacity={0.65} />
          <path d="M 72 52 L 72 176" className={accentClassName} strokeWidth={1.5} strokeOpacity={0.65} />
          <path d="M 188 36 L 188 232" className={accentClassName} strokeWidth={1.2} strokeOpacity={0.45} />
          <path d="M 52 214 L 168 198" className={accentClassName} strokeWidth={1.2} strokeOpacity={0.4} />
        </svg>
      </div>
    </div>
  );
}

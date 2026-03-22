import React, { useMemo } from "react";
import { cn } from "../../lib/utils";
import type { ScanAlignmentResult } from "../../hooks/useScanAlignmentAnalysis";
import type { ScanFrameTilt } from "../../hooks/useScanFrameOrientation";

const ELECTRIC = "#2563eb";

export type PhaseIndexScan = 0 | 1 | 2 | 3;

export type ScannerAlignmentOverlayProps = {
  alignment: ScanAlignmentResult;
  className?: string;
  /** Inclinazione live dal giroscopio — il rettangolo segue il telefono (stile scan documenti) */
  frameTilt?: ScanFrameTilt | null;
  /** Forma del frame leggermente diversa per fase (tallone / lati / dall’alto) */
  phaseIndex?: PhaseIndexScan;
};

/**
 * Overlay scansione: bounding box 2D centrale, mirino, trasformazione 3D in base all’orientamento device.
 */
export default function ScannerAlignmentOverlay({
  alignment,
  className,
  frameTilt,
  phaseIndex = 0,
}: ScannerAlignmentOverlayProps) {
  const { guide, markerCentersNorm, arucoEngine } = alignment;

  const borderWarning = guide === "too_close";

  const arucoLocked = arucoEngine === "ready" && markerCentersNorm != null && markerCentersNorm.length >= 4;

  const tilt = frameTilt ?? { rotateX: 0, rotateY: 0, rotateZ: 0 };

  /** Fase 0 = dall’alto (cornice larga); 1–2 = laterali; 3 = posteriore/tallone (cornice più alta) */
  const bboxShapeClass = useMemo(() => {
    switch (phaseIndex) {
      case 0:
        return "h-[50dvh] w-[64vw] max-h-[min(72dvh,600px)] max-w-[min(92vw,560px)]";
      case 1:
      case 2:
        return "h-[56dvh] w-[58vw] max-h-[min(76dvh,660px)] max-w-[min(90vw,480px)]";
      case 3:
        return "h-[58dvh] w-[52vw] max-h-[min(78dvh,680px)] max-w-[min(88vw,420px)]";
      default:
        return "h-[60dvh] w-[60vw] max-h-[min(80dvh,720px)] max-w-[min(92vw,520px)]";
    }
  }, [phaseIndex]);

  return (
    <div className={cn("pointer-events-none flex min-h-0 flex-1 flex-col", className)}>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 pt-2">
        <div
          className="flex items-center justify-center"
          style={{ perspective: "1000px", transformStyle: "preserve-3d" }}
        >
          <div
            className="will-change-transform"
            style={{
              transform: `rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg) rotateZ(${tilt.rotateZ}deg)`,
              transformStyle: "preserve-3d",
            }}
          >
            <div
              className={cn(
                "relative box-border rounded-3xl border-2 transition-[border-color,box-shadow] duration-300",
                bboxShapeClass,
                "bg-[#2563eb]/50",
                borderWarning
                  ? "border-amber-400/80 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]"
                  : "border-[#2563eb]/50 shadow-[0_0_40px_rgba(37,99,235,0.18)]"
              )}
              aria-hidden
            >
              <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
                <svg
                  width="140"
                  height="140"
                  viewBox="0 0 140 140"
                  aria-hidden
                  className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]"
                >
                  <circle
                    cx="70"
                    cy="70"
                    r="58"
                    fill="none"
                    stroke={ELECTRIC}
                    strokeWidth="2.5"
                    strokeOpacity={0.85}
                  />
                  <circle cx="70" cy="70" r="46" fill="none" stroke={ELECTRIC} strokeWidth="1.5" strokeOpacity={0.45} />
                  <circle cx="70" cy="70" r="34" fill="none" stroke={ELECTRIC} strokeWidth="1" strokeOpacity={0.35} />
                  {arucoLocked ? (
                    <circle cx="70" cy="70" r="22" fill={ELECTRIC} fillOpacity={0.5} />
                  ) : (
                    <circle cx="70" cy="70" r="6" fill="none" stroke={ELECTRIC} strokeWidth="2" strokeOpacity={0.9} />
                  )}
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

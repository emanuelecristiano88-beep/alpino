import React, { useMemo } from "react";
import { cn } from "../../lib/utils";
import type { ScanAlignmentResult } from "../../hooks/useScanAlignmentAnalysis";
import type { ScanFrameTilt } from "../../hooks/useScanFrameOrientation";

const ELECTRIC = "#2563eb";
const PARTIAL = "#facc15";
const LOCKED = "#22c55e";
const BAD = "#ef4444";

/** Bracket + quadratino agli angoli: allinea i 4 marker ArUco del foglio a questo riquadro blu */
function ArucoCornerHint({
  position,
  locked,
  partial,
}: {
  position: "tl" | "tr" | "bl" | "br";
  locked: boolean;
  partial: boolean;
}) {
  const ring = locked
    ? "border-emerald-400/90 shadow-[0_0_10px_rgba(52,211,153,0.5)]"
    : partial
      ? "border-yellow-300/90 shadow-[0_0_10px_rgba(250,204,21,0.45)]"
    : "border-white/[0.92] shadow-[0_1px_2px_rgba(0,0,0,0.2)]";
  const sq = locked
    ? "border-emerald-300/80 bg-emerald-400/20"
    : partial
      ? "border-yellow-200/80 bg-yellow-400/20"
      : "border-white/80 bg-white/10";

  const outer = {
    tl: "left-2.5 top-2.5",
    tr: "right-2.5 top-2.5",
    bl: "bottom-2.5 left-2.5",
    br: "bottom-2.5 right-2.5",
  }[position];

  const bracket = {
    tl: "rounded-tl-2xl border-l-[2.5px] border-t-[2.5px]",
    tr: "rounded-tr-2xl border-r-[2.5px] border-t-[2.5px]",
    bl: "rounded-bl-2xl border-b-[2.5px] border-l-[2.5px]",
    br: "rounded-br-2xl border-b-[2.5px] border-r-[2.5px]",
  }[position];

  const squarePos = {
    tl: "left-1 top-1",
    tr: "right-1 top-1",
    bl: "bottom-1 left-1",
    br: "bottom-1 right-1",
  }[position];

  return (
    <div className={cn("pointer-events-none absolute z-[5] h-[2.75rem] w-[2.75rem]", outer)}>
      <div className={cn("relative h-11 w-11 border-transparent", bracket, ring)} />
      <div className={cn("absolute h-3.5 w-3.5 rounded-sm border-[1.5px]", sq, squarePos)} />
    </div>
  );
}

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

  const arucoLocked = arucoEngine === "ready" && markerCentersNorm != null && markerCentersNorm.length >= 4;
  const arucoPartial = arucoEngine === "ready" && alignment.markerCount >= 1 && !arucoLocked;
  const arucoBad = guide === "too_close" || (arucoEngine === "ready" && alignment.markerCount < 1);
  const isArucoLandscape = useMemo(() => {
    if (!arucoLocked || !markerCentersNorm || markerCentersNorm.length < 4) return false;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of markerCentersNorm) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const spanX = Math.max(0, maxX - minX);
    const spanY = Math.max(0, maxY - minY);
    return spanX > spanY * 1.08;
  }, [arucoLocked, markerCentersNorm]);

  const tilt = frameTilt ?? { rotateX: 0, rotateY: 0, rotateZ: 0 };

  /** Fase 0 = dall’alto (cornice larga); 1–2 = laterali; 3 = posteriore/tallone (cornice più alta) */
  const bboxShapeClass = useMemo(() => {
    const landscapeByAruco = isArucoLandscape;
    switch (phaseIndex) {
      case 0:
        return landscapeByAruco
          ? "h-[48dvh] w-[82vw] max-h-[min(68dvh,600px)] max-w-[min(96vw,740px)]"
          : "h-[56dvh] w-[72vw] max-h-[min(76dvh,680px)] max-w-[min(94vw,640px)]";
      case 1:
      case 2:
        return landscapeByAruco
          ? "h-[44dvh] w-[74vw] max-h-[min(64dvh,560px)] max-w-[min(96vw,700px)]"
          : "h-[56dvh] w-[58vw] max-h-[min(76dvh,660px)] max-w-[min(90vw,480px)]";
      case 3:
        return landscapeByAruco
          ? "h-[46dvh] w-[70vw] max-h-[min(66dvh,580px)] max-w-[min(94vw,640px)]"
          : "h-[58dvh] w-[52vw] max-h-[min(78dvh,680px)] max-w-[min(88vw,420px)]";
      default:
        return landscapeByAruco
          ? "h-[46dvh] w-[74vw] max-h-[min(66dvh,600px)] max-w-[min(96vw,700px)]"
          : "h-[60dvh] w-[60vw] max-h-[min(80dvh,720px)] max-w-[min(92vw,520px)]";
    }
  }, [isArucoLandscape, phaseIndex]);

  const frameStrokeClass = arucoBad
    ? "border-red-400/85 shadow-[0_0_24px_rgba(239,68,68,0.25)]"
    : arucoLocked
      ? "border-emerald-400/80 shadow-[0_0_32px_rgba(34,197,94,0.24)]"
      : arucoPartial
        ? "border-yellow-300/85 shadow-[0_0_36px_rgba(250,204,21,0.2)]"
        : "border-[#2563eb]/50 shadow-[0_0_40px_rgba(37,99,235,0.18)]";

  const frameBgClass = arucoLocked
    ? "bg-emerald-500/30"
    : arucoPartial
      ? "bg-yellow-500/25"
      : arucoBad
        ? "bg-red-500/22"
        : "bg-[#2563eb]/50";
  const pulseClass = arucoPartial ? "animate-pulse" : "";
  const reticleColor = arucoLocked ? LOCKED : arucoPartial ? PARTIAL : arucoBad ? BAD : ELECTRIC;

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
                pulseClass,
                bboxShapeClass,
                frameBgClass,
                frameStrokeClass
              )}
              aria-hidden
            >
              <span className="sr-only">
                Allinea i quattro marker ArUco stampati sugli angoli di questo riquadro blu.
              </span>
              <ArucoCornerHint position="tl" locked={arucoLocked} partial={arucoPartial} />
              <ArucoCornerHint position="tr" locked={arucoLocked} partial={arucoPartial} />
              <ArucoCornerHint position="bl" locked={arucoLocked} partial={arucoPartial} />
              <ArucoCornerHint position="br" locked={arucoLocked} partial={arucoPartial} />
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
                    stroke={reticleColor}
                    strokeWidth="2.5"
                    strokeOpacity={0.85}
                  />
                  <circle cx="70" cy="70" r="46" fill="none" stroke={reticleColor} strokeWidth="1.5" strokeOpacity={0.45} />
                  <circle cx="70" cy="70" r="34" fill="none" stroke={reticleColor} strokeWidth="1" strokeOpacity={0.35} />
                  {arucoLocked ? (
                    <circle cx="70" cy="70" r="22" fill={reticleColor} fillOpacity={0.5} />
                  ) : (
                    <circle cx="70" cy="70" r="6" fill="none" stroke={reticleColor} strokeWidth="2" strokeOpacity={0.9} />
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

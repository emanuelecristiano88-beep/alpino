import React, { useMemo } from "react";
import { cn } from "../../lib/utils";
import type { ScanAlignmentResult } from "../../hooks/useScanAlignmentAnalysis";
import type { ScanFrameTilt } from "../../hooks/useScanFrameOrientation";
import ScanFootPathGuide from "./ScanFootPathGuide";

export type CaptureReadinessTone = "red" | "yellow" | "green";

/**
 * Angoli guida — colore segue readiness (rosso / giallo / verde).
 */
function CornerBracket({
  position,
  tone,
}: {
  position: "tl" | "tr" | "bl" | "br";
  tone: CaptureReadinessTone | "blue";
}) {
  const ring =
    tone === "red"
      ? "border-[#fca5a5]/65"
      : tone === "yellow"
        ? "border-[#fcd34d]/62"
        : tone === "green"
          ? "border-[#22d3ee]/72"
          : "border-[#22d3ee]/32";

  const outer = {
    tl: "left-3 top-3",
    tr: "right-3 top-3",
    bl: "bottom-3 left-3",
    br: "bottom-3 right-3",
  }[position];

  const bracket = {
    tl: "rounded-tl-xl border-l-[1.5px] border-t-[1.5px]",
    tr: "rounded-tr-xl border-r-[1.5px] border-t-[1.5px]",
    bl: "rounded-bl-xl border-b-[1.5px] border-l-[1.5px]",
    br: "rounded-br-xl border-b-[1.5px] border-r-[1.5px]",
  }[position];

  return (
    <div className={cn("pointer-events-none absolute z-[5] h-[1.6rem] w-[1.6rem]", outer)}>
      <div className={cn("relative h-[1.6rem] w-[1.6rem] border-transparent", bracket, ring)} />
    </div>
  );
}

export type PhaseIndexScan = 0 | 1 | 2 | 3;

export type ScanPathGuideConfig = {
  visible: boolean;
  footCentroidNorm: { x: number; y: number } | null;
  zonesComplete: [boolean, boolean, boolean, boolean];
  activePhase: PhaseIndexScan;
};

export type ScannerAlignmentOverlayProps = {
  alignment: ScanAlignmentResult;
  className?: string;
  /** Inclinazione live dal giroscopio — il rettangolo segue il telefono (stile scan documenti) */
  frameTilt?: ScanFrameTilt | null;
  /** Forma del frame leggermente diversa per fase (tallone / lati / dall’alto) — non legata alla detection */
  phaseIndex?: PhaseIndexScan;
  /** Cerchio attorno al piede + zone completate (solo scansione continua) */
  pathGuide?: ScanPathGuideConfig | null;
  /** Feedback cattura: rosso non pronto, giallo quasi, verde imminente / in corso. */
  captureReadiness?: CaptureReadinessTone | null;
};

/** Scala tipica tracking (~0.35–0.45) → factor vicino a 1 attorno al centro guida */
const TRACKING_SCALE_REF = 0.4;

/**
 * Overlay scansione: design unico; posizione / rotazione / scala da `alignment.tracking` + tilt device.
 */
export default function ScannerAlignmentOverlay({
  alignment,
  className,
  frameTilt,
  phaseIndex = 0,
  pathGuide = null,
  captureReadiness = null,
}: ScannerAlignmentOverlayProps) {
  const { guide, tracking } = alignment;

  const tooClose = guide === "too_close";

  const readinessTone: CaptureReadinessTone | "blue" | null =
    captureReadiness ?? (tooClose ? "red" : null);

  const frameStrokeClass = useMemo(() => {
    if (readinessTone === "red")
      return "border-[#f87171]/55 shadow-[0_0_14px_rgba(248,113,113,0.16)]";
    if (readinessTone === "yellow")
      return "border-[#fbbf24]/52 shadow-[0_0_12px_rgba(251,191,36,0.14)]";
    if (readinessTone === "green")
      return "border-[#22d3ee]/68 shadow-[0_0_18px_rgba(34,211,238,0.18)]";
    return tooClose
      ? "border-[#ff8a8a]/50 shadow-[0_0_12px_rgba(255,138,138,0.14)]"
      : "border-[#22d3ee]/[0.22] shadow-[0_0_14px_rgba(34,211,238,0.08)]";
  }, [readinessTone, tooClose]);

  const frameBgClass = useMemo(() => {
    if (readinessTone === "green") return "bg-[#d1fae5]/[0.03]";
    return "bg-transparent";
  }, [readinessTone, tooClose]);

  const bracketTone: CaptureReadinessTone | "blue" = readinessTone ?? "blue";

  const bboxShapeClass = useMemo(() => {
    switch (phaseIndex) {
      case 0:
        return "h-[56dvh] w-[72vw] max-h-[min(76dvh,680px)] max-w-[min(94vw,640px)]";
      case 1:
      case 2:
        return "h-[56dvh] w-[58vw] max-h-[min(76dvh,660px)] max-w-[min(90vw,480px)]";
      case 3:
        return "h-[58dvh] w-[52vw] max-h-[min(78dvh,680px)] max-w-[min(88vw,420px)]";
      default:
        return "h-[60dvh] w-[60vw] max-h-[min(80dvh,720px)] max-w-[min(92vw,520px)]";
    }
  }, [phaseIndex]);

  const tilt = frameTilt ?? { rotateX: 0, rotateY: 0, rotateZ: 0 };

  const sheetTransform = useMemo(() => {
    const conf = tracking.confidence;
    if (conf < 0.04) {
      return { translateXPct: 0, translateYPct: 0, rotateDeg: 0, scale: 1 };
    }
    const tx = (tracking.position.x - 0.5) * 88;
    const ty = (tracking.position.y - 0.5) * 88;
    const rotateDeg = (tracking.rotation * 180) / Math.PI;
    const scale = Math.max(0.82, Math.min(1.22, tracking.scale / TRACKING_SCALE_REF));
    return { translateXPct: tx, translateYPct: ty, rotateDeg, scale };
  }, [tracking.confidence, tracking.position.x, tracking.position.y, tracking.rotation, tracking.scale]);

  return (
    <div className={cn("pointer-events-none relative flex min-h-0 flex-1 flex-col", className)}>
      <style>{`
        @keyframes neumaOverlayBreath {
          0%, 100% { opacity: 0.94; filter: saturate(100%); }
          50% { opacity: 1; filter: saturate(108%); }
        }
      `}</style>
      {pathGuide != null && (
        <ScanFootPathGuide
          className="z-[18]"
          footCentroidNorm={pathGuide.footCentroidNorm}
          visible={pathGuide.visible}
          zonesComplete={pathGuide.zonesComplete}
          activePhase={pathGuide.activePhase}
        />
      )}
      <div className="relative z-[12] flex min-h-0 flex-1 items-center justify-center px-2 pb-2 pt-2">
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
                "relative box-border origin-center rounded-3xl border transition-[border-color,box-shadow,background-color,opacity] duration-300",
                bboxShapeClass,
                frameBgClass,
                frameStrokeClass
              )}
              style={{
                transform: `translate(${sheetTransform.translateXPct}%, ${sheetTransform.translateYPct}%) rotate(${sheetTransform.rotateDeg}deg) scale(${sheetTransform.scale})`,
                transformStyle: "preserve-3d",
                animation: "neumaOverlayBreath 2.6s ease-in-out infinite",
              }}
              aria-hidden
            >
              <span className="sr-only">
                Allinea il piede sul foglio entro questa cornice. La forma resta uguale durante la scansione.
              </span>
              <CornerBracket position="tl" tone={bracketTone} />
              <CornerBracket position="tr" tone={bracketTone} />
              <CornerBracket position="bl" tone={bracketTone} />
              <CornerBracket position="br" tone={bracketTone} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

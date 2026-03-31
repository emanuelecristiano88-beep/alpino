import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanFrameTilt } from "./useScanFrameOrientation";
import { firstMissingFootZone, type FootViewZone } from "../lib/scanner/footViewZoneClassifier";

export type ScanGuidanceMessage =
  | "Muovi intorno al piede"
  | "Muovi il telefono intorno al piede"
  | "Muoviti lentamente"
  | "Alza un po'"
  | "Abbassa un po'"
  | "Sopra"
  | "Ancora un po'"
  | "Vai dietro"
  | "Inquadra il foglio e il piede"
  | "Inquadra il foglio"
  | "Avvicinati"
  | "Allontanati"
  | "Metti il piede nel riquadro"
  | "Perfetto"
  | "Più lentamente"
  | "Tieni fermo"
  | "Gira leggermente"
  | "Allinea i punti";

/** Inclinazione rispetto a ripresa dall’alto (device portrait). */
const TILT_X_PITCH_THRESHOLD = 12;
const TILT_Z_ROLL_THRESHOLD = 16;

const ZONE_MISSING_COPY: Record<FootViewZone, ScanGuidanceMessage> = {
  TOP: "Sopra",
  OUTER: "Gira leggermente",
  INNER: "Ancora un po'",
  HEEL: "Vai dietro",
};

type CameraScanState = "readyPhase" | "capturingPhase" | string;

/**
 * Feedback tempo reale: priorità fissa così l’utente sa cosa correggere per primo.
 */
export function useScanGuidance(args: {
  cameraState: CameraScanState;
  frameTilt: ScanFrameTilt;
  footCentroid: { x: number; y: number } | null;
  currentFoot: "LEFT" | "RIGHT";
  captureReady: boolean;
  geometryReady: boolean;
  angleViewReady: boolean;
  rawScanValid: boolean;
  footDetected: boolean;
  /** Piede interamente nel frame (margine) */
  footFullyVisible: boolean;
  /** Area bbox “realistica” (evita piede troppo piccolo/grande) */
  footSizeOk: boolean;
  /** 4 angoli foglio disponibili (ArUco e/o fusione A4). */
  sheetFullyFramed: boolean;
  /** Da `alignment.guide === "too_close"`. */
  sheetTooClose: boolean;
  /** Foglio troppo piccolo in inquadratura (telefono troppo lontano). */
  sheetTooFar: boolean;
  /** Motore ArUco: finché è "loading" non mostriamo "Inquadra il foglio". */
  arucoEngine: "loading" | "ready" | "fallback";
  /** Copertura zone piede corrente [TOP, OUTER, INNER, HEEL]. */
  zonesComplete: readonly [boolean, boolean, boolean, boolean];
  /** Piede nell’area foglio (non solo bbox generico). */
  footInsideA4: boolean;
  /**
   * Cattura forzata dopo timeout: messaggio “Perfetto” anche se altri check (velocità, foglio) non sono ideali.
   */
  fallbackCaptureMessaging?: boolean;
  /**
   * Flusso unico continuo (stile photogrammetry): solo “Muovi intorno al piede” / “Perfetto”, niente micro-istruzioni.
   */
  continuousScanMode?: boolean;
}) {
  const {
    cameraState,
    frameTilt,
    footCentroid,
    currentFoot,
    captureReady,
    geometryReady,
    angleViewReady,
    rawScanValid,
    footDetected,
    footFullyVisible,
    footSizeOk,
    sheetFullyFramed,
    sheetTooClose,
    sheetTooFar,
    arucoEngine,
    zonesComplete,
    footInsideA4,
    fallbackCaptureMessaging = false,
    continuousScanMode = false,
  } = args;

  const lastRef = useRef<{
    rx: number;
    rz: number;
    cx: number;
    cy: number;
    t: number;
  } | null>(null);
  const emaRef = useRef(0);
  const fastStreakRef = useRef(0);
  const slowStreakRef = useRef(0);
  const [tick, setTick] = useState(0);
  const [tooFast, setTooFast] = useState(false);
  const [tooSlow, setTooSlow] = useState(false);

  useEffect(() => {
    lastRef.current = null;
    emaRef.current = 0;
    fastStreakRef.current = 0;
    slowStreakRef.current = 0;
    setTick(0);
  }, [currentFoot]);

  useEffect(() => {
    const now = performance.now();
    const { rotateX: rx, rotateZ: rz } = frameTilt;
    const cx = footCentroid?.x ?? 0.5;
    const cy = footCentroid?.y ?? 0.5;

    if (cameraState === "capturingPhase") {
      lastRef.current = { rx, rz, cx, cy, t: now };
      setTick((n) => n + 1);
      return;
    }
    if (cameraState !== "readyPhase") {
      lastRef.current = null;
      return;
    }

    const prev = lastRef.current;
    if (prev) {
      const dt = (now - prev.t) / 1000;
      if (dt > 0.008 && dt < 0.45) {
        const dTilt = Math.hypot(rx - prev.rx, rz - prev.rz);
        const dFoot =
          footCentroid != null ? Math.hypot(cx - prev.cx, cy - prev.cy) * 520 : 0;
        const rate = (dTilt + dFoot) / dt;
        emaRef.current = emaRef.current * 0.78 + rate * 0.22;
      }
    }
    lastRef.current = { rx, rz, cx, cy, t: now };

    if (emaRef.current > 52) fastStreakRef.current += 1;
    else fastStreakRef.current = 0;
    setTooFast(fastStreakRef.current >= 5);

    if (cameraState === "readyPhase" && footDetected && !captureReady && emaRef.current < 9) {
      slowStreakRef.current += 1;
    } else {
      slowStreakRef.current = 0;
    }
    setTooSlow(slowStreakRef.current >= 22);

    setTick((n) => n + 1);

  }, [cameraState, captureReady, footCentroid, footDetected, frameTilt]);

  const raiseLowerMsg = useMemo(() => {
    if (Math.abs(frameTilt.rotateX) <= TILT_X_PITCH_THRESHOLD) return null;
    // Convenzione: rotateX positivo => telefono troppo “basso” (serve alzare), negativo => abbassare.
    return frameTilt.rotateX > 0 ? ("Alza un po'" as const) : ("Abbassa un po'" as const);
  }, [frameTilt.rotateX]);

  const turnNeeded = useMemo(() => {
    if (Math.abs(frameTilt.rotateZ) <= TILT_Z_ROLL_THRESHOLD) return false;
    return true;
  }, [frameTilt.rotateZ]);

  const coachLine = useMemo((): ScanGuidanceMessage | null => {
    void tick;
    if (continuousScanMode) {
      if (cameraState === "capturingPhase") return "Perfetto";
      if (cameraState !== "readyPhase") return null;
      if (fallbackCaptureMessaging || captureReady) return "Perfetto";
      return "Muovi intorno al piede";
    }

    if (cameraState === "capturingPhase") return "Tieni fermo";
    if (cameraState !== "readyPhase") return null;

    if (fallbackCaptureMessaging) return "Perfetto";

    if (tooFast) return "Più lentamente";

    const canAssessSheet = arucoEngine !== "loading";
    if (!sheetFullyFramed && !footDetected) {
      return "Inquadra il foglio e il piede";
    }
    if (canAssessSheet && !sheetFullyFramed) {
      return "Inquadra il foglio";
    }

    if (sheetTooClose) return "Allontanati";
    if (sheetTooFar) return "Avvicinati";

    // Correzioni “altezza” / “tilt” (serve prima di tutto per avere angolo corretto)
    if (sheetFullyFramed && !sheetTooClose && !sheetTooFar && raiseLowerMsg) {
      return raiseLowerMsg;
    }
    if (sheetFullyFramed && !sheetTooClose && !sheetTooFar && turnNeeded) {
      return "Gira leggermente";
    }

    if (
      sheetFullyFramed &&
      (!footDetected || !footInsideA4 || (footDetected && (!footFullyVisible || !footSizeOk)))
    ) {
      return "Metti il piede nel riquadro";
    }

    if (captureReady) return "Perfetto";

    // Se l'utente è fermo ma non ha ancora l'angolo valido: guida a muoversi lentamente.
    if (tooSlow) return "Muoviti lentamente";

    // Guidance minimalistica basata sulle zone ancora mancanti.
    if (rawScanValid) {
      const missingZone = firstMissingFootZone(zonesComplete);
      if (missingZone) return ZONE_MISSING_COPY[missingZone];
    }

    if (geometryReady && !angleViewReady && rawScanValid) return "Gira leggermente";

    return "Muovi il telefono intorno al piede";
  }, [
    continuousScanMode,
    angleViewReady,
    arucoEngine,
    footDetected,
    footFullyVisible,
    footInsideA4,
    footSizeOk,
    cameraState,
    captureReady,
    geometryReady,
    rawScanValid,
    zonesComplete,
    sheetFullyFramed,
    sheetTooClose,
    sheetTooFar,
    tick,
    raiseLowerMsg,
    turnNeeded,
    tooFast,
    tooSlow,
    fallbackCaptureMessaging,
  ]);

  return {
    coachLine,
    movementEma: emaRef.current,
    tooFast,
    tooSlow,
  };
}

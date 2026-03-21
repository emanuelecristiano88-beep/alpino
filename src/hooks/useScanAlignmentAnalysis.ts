import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMarkerCentroid,
  markersDominateFrame,
  pickCornerMarkers,
  scoreA4FromMarkers,
  type ArucoMarkerDetection,
} from "../lib/aruco/a4MarkerGeometry";
import { detectArucoOnImageData, ensureArucoDetector, isArucoDetectorReady } from "../lib/aruco/arucoWasm";

export type ScanGuideMode = "default" | "too_close" | "aligned";

export type ScanAlignmentSnapshot = {
  guide: ScanGuideMode;
  /** Almeno 4 marker rilevati (ArUco) oppure euristica angoli */
  markersDetected: boolean;
  /** Area centrale con texture tipo “oggetto” (piede su carta) */
  footInFrame: boolean;
  /** 4 marker + rapporto ~A4 + piede + non troppo vicino */
  isPositionCorrect: boolean;
  /** Stato motore ArUco (per debug UI opzionale) */
  arucoEngine: "loading" | "ready" | "fallback";
  /**
   * Fino a 4 centroidi normalizzati 0–1 sul frame analizzato (stesso aspect del video).
   * Solo con WASM ArUco attivo e ≥4 marker scelti agli angoli.
   */
  markerCentersNorm: { x: number; y: number }[] | null;
};

const DEFAULT_SNAPSHOT: ScanAlignmentSnapshot = {
  guide: "default",
  markersDetected: false,
  footInFrame: false,
  isPositionCorrect: false,
  arucoEngine: "loading",
  markerCentersNorm: null,
};

function serializeMarkerCenters(m: { x: number; y: number }[] | null): string {
  if (!m || m.length === 0) return "";
  return m.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join("|");
}

function gray(i: number, data: Uint8ClampedArray) {
  const o = i * 4;
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
}

function edgeScore(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  let s = 0;
  let n = 0;
  const step = 2;
  for (let y = y0; y < y1 - step; y += step) {
    for (let x = x0; x < x1 - step; x += step) {
      const i = y * w + x;
      const g = gray(i, data);
      const gx = gray(i + step, data);
      const gy = gray(i + step * w, data);
      s += Math.abs(gx - g) + Math.abs(gy - g);
      n += 1;
    }
  }
  return n > 0 ? s / n : 0;
}

function varianceLuma(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const vals: number[] = [];
  const step = 3;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      vals.push(gray(y * w + x, data));
    }
  }
  if (vals.length < 4) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, v) => a + (v - m) * (v - m), 0) / vals.length;
}

function meanLuma(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0;
  let n = 0;
  const step = 4;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      s += gray(y * w + x, data);
      n += 1;
    }
  }
  return n > 0 ? s / n : 0;
}

/** Fallback senza WASM: proxy angoli + piede. */
function analyzeHeuristicOnly(imageData: ImageData): Omit<ScanAlignmentSnapshot, "arucoEngine"> {
  const { width: W, height: H, data } = imageData;
  const cw = W * 0.22;
  const ch = H * 0.22;
  const corners = {
    tl: edgeScore(data, W, 2, 2, cw, ch),
    tr: edgeScore(data, W, W - cw, 2, W - 2, ch),
    bl: edgeScore(data, W, 2, H - ch, cw, H - 2),
    br: edgeScore(data, W, W - cw, H - ch, W - 2, H - 2),
  };
  const cornerVals = [corners.tl, corners.tr, corners.bl, corners.br];
  const maxCorner = Math.max(...cornerVals);

  const cx0 = Math.floor(W * 0.28);
  const cy0 = Math.floor(H * 0.28);
  const cx1 = Math.floor(W * 0.72);
  const cy1 = Math.floor(H * 0.72);
  const centerVar = varianceLuma(data, W, cx0, cy0, cx1, cy1);
  const globalMean = meanLuma(data, W, 0, 0, W, H);
  const innerMean = meanLuma(data, W, cx0, cy0, cx1, cy1);

  const CORNER_STRONG = 18;
  const CORNER_WEAK = 9;
  const VAR_FOOT = 420;
  const BRIGHT = 235;

  const markersDetected = cornerVals.every((c) => c > CORNER_WEAK) && Math.min(...cornerVals) > CORNER_WEAK * 0.85;
  const strongMarkers = cornerVals.every((c) => c > CORNER_STRONG);

  const tooClose =
    globalMean > BRIGHT && innerMean > BRIGHT - 5 && maxCorner < CORNER_STRONG * 1.35;

  const footInFrame = centerVar > VAR_FOOT;
  const isPositionCorrect = strongMarkers && footInFrame && !tooClose;

  let guide: ScanGuideMode = "default";
  if (tooClose) guide = "too_close";
  else if (isPositionCorrect) guide = "aligned";

  return {
    guide,
    markersDetected: markersDetected || strongMarkers,
    footInFrame,
    isPositionCorrect,
  };
}

function combineArucoAndHeuristic(
  imageData: ImageData,
  markers: ArucoMarkerDetection[],
  arucoEngine: "ready" | "fallback"
): ScanAlignmentSnapshot {
  const h = analyzeHeuristicOnly(imageData);
  if (markers.length === 0) {
    return {
      guide: h.guide === "too_close" ? "too_close" : "default",
      markersDetected: false,
      footInFrame: h.footInFrame,
      isPositionCorrect: false,
      arucoEngine,
      markerCentersNorm: null,
    };
  }

  const W = imageData.width;
  const H = imageData.height;
  const picked = pickCornerMarkers(markers, W, H);
  const { count, aspectOk } = scoreA4FromMarkers(picked);
  const fourVisible = count >= 4;
  const tooCloseAruco = markersDominateFrame(picked, W, H);
  const tooClose = h.guide === "too_close" || tooCloseAruco;

  const footInFrame = h.footInFrame;
  const markersDetected = fourVisible;
  const isPositionCorrect = fourVisible && aspectOk && footInFrame && !tooClose;

  let guide: ScanGuideMode = "default";
  if (tooClose) guide = "too_close";
  else if (isPositionCorrect) guide = "aligned";

  return {
    guide,
    markersDetected,
    footInFrame,
    isPositionCorrect,
    arucoEngine,
    markerCentersNorm: null,
  };
}

export type ScanAlignmentResult = ScanAlignmentSnapshot & {
  stableAlignedMs: number;
};

export function useScanAlignmentAnalysis(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  resetToken?: number
): ScanAlignmentResult {
  const [snapshot, setSnapshot] = useState<ScanAlignmentSnapshot>({
    ...DEFAULT_SNAPSHOT,
    arucoEngine: "loading",
  });
  const [stableAlignedMs, setStableAlignedMs] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const alignedSinceRef = useRef<number | null>(null);
  const lastStableUiRef = useRef(0);
  const arucoEngineRef = useRef<ScanAlignmentSnapshot["arucoEngine"]>("loading");

  useEffect(() => {
    if (!enabled) {
      arucoEngineRef.current = "loading";
      return;
    }
    arucoEngineRef.current = "loading";
    setSnapshot((s) => ({ ...s, arucoEngine: "loading" }));
    let cancelled = false;
    void ensureArucoDetector()
      .then(() => {
        if (!cancelled) {
          arucoEngineRef.current = "ready";
          setSnapshot((s) => ({ ...s, arucoEngine: "ready" }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          arucoEngineRef.current = "fallback";
          setSnapshot((s) => ({ ...s, arucoEngine: "fallback" }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setSnapshot({ ...DEFAULT_SNAPSHOT, arucoEngine: arucoEngineRef.current, markerCentersNorm: null });
      alignedSinceRef.current = null;
      lastStableUiRef.current = 0;
      setStableAlignedMs(0);
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const useAruco = isArucoDetectorReady() && arucoEngineRef.current === "ready";
    const maxSide = useAruco ? 480 : 240;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const w = Math.max(32, Math.round(vw * scale));
    const h = Math.max(32, Math.round(vh * scale));

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch {
      return;
    }

    const engine = arucoEngineRef.current;
    let next: ScanAlignmentSnapshot;
    let markerCentersNorm: { x: number; y: number }[] | null = null;

    if (engine === "ready" && isArucoDetectorReady()) {
      const markers = detectArucoOnImageData(imageData);
      next = combineArucoAndHeuristic(imageData, markers, "ready");
      const picked = pickCornerMarkers(markers, w, h);
      if (picked.length >= 4) {
        markerCentersNorm = picked.slice(0, 4).map((m) => {
          const c = getMarkerCentroid(m);
          return { x: c.x / w, y: c.y / h };
        });
      }
    } else if (engine === "fallback" || engine === "loading") {
      const heur = analyzeHeuristicOnly(imageData);
      next = {
        ...heur,
        arucoEngine: engine === "loading" ? "loading" : "fallback",
        markerCentersNorm: null,
      };
    } else {
      next = { ...analyzeHeuristicOnly(imageData), arucoEngine: "fallback", markerCentersNorm: null };
    }

    if (engine === "ready" && isArucoDetectorReady()) {
      next = { ...next, markerCentersNorm };
    }

    const now = performance.now();
    if (next.isPositionCorrect) {
      if (alignedSinceRef.current === null) alignedSinceRef.current = now;
      const ms = now - alignedSinceRef.current;
      if (ms === 0 || Math.abs(ms - lastStableUiRef.current) >= 80 || (ms >= 1000 && lastStableUiRef.current < 1000)) {
        lastStableUiRef.current = ms;
        setStableAlignedMs(ms);
      }
    } else {
      alignedSinceRef.current = null;
      lastStableUiRef.current = 0;
      setStableAlignedMs(0);
    }

    setSnapshot((prev) => {
      if (
        prev.guide === next.guide &&
        prev.markersDetected === next.markersDetected &&
        prev.footInFrame === next.footInFrame &&
        prev.isPositionCorrect === next.isPositionCorrect &&
        prev.arucoEngine === next.arucoEngine &&
        serializeMarkerCenters(prev.markerCentersNorm) === serializeMarkerCenters(next.markerCentersNorm)
      ) {
        return prev;
      }
      return next;
    });
  }, [videoRef]);

  useEffect(() => {
    alignedSinceRef.current = null;
    lastStableUiRef.current = 0;
    setStableAlignedMs(0);
  }, [resetToken]);

  useEffect(() => {
    if (!enabled) {
      setSnapshot({ ...DEFAULT_SNAPSHOT, arucoEngine: "loading", markerCentersNorm: null });
      setStableAlignedMs(0);
      alignedSinceRef.current = null;
      lastStableUiRef.current = 0;
      return;
    }

    let raf = 0;
    let last = 0;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const interval = arucoEngineRef.current === "ready" ? 120 : 140;
      if (t - last < interval) return;
      last = t;
      tick();
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, tick]);

  return { ...snapshot, stableAlignedMs };
}

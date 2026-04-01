"use client";

import * as React from "react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import { PAIR_STORAGE_KEY, SCAN_METRICS_STORAGE_KEY } from "./constants/scan";
import { useScanAlignmentAnalysis } from "./hooks/useScanAlignmentAnalysis";
import { useOpenCvArucoAnalysis } from "./hooks/useOpenCvArucoAnalysis";
import { requestOrientationAccess } from "./hooks/useDeviceTilt";
import { useScanFrameOrientation } from "./hooks/useScanFrameOrientation";
import { useScanGuidance } from "./hooks/useScanGuidance";
import ScannerAlignmentOverlay from "./components/scanner/ScannerAlignmentOverlay";
import ScanDebugOverlay from "./components/scanner/ScanDebugOverlay";
import ArucoMarkerPins from "./components/scanner/ArucoMarkerPins";
import ArucoMarkerBracketsCanvas from "./components/scanner/ArucoMarkerBracketsCanvas";
import ScannerSheetOverlayCanvas from "./components/scanner/ScannerSheetOverlayCanvas";
import { computeNeumaBiometryFromImageData, type NeumaBiometryResult } from "./lib/biometry";
import { pickCornerMarkers, type ArucoMarkerDetection, type ArucoMarkerPoint } from "./lib/aruco/a4MarkerGeometry";
import { markerSharpnessScore } from "./lib/scanner/frameQuality";
// Types only — no runtime Three.js dependency.
import type { PointCloud } from "./lib/reconstruction/types";
import { downsamplePointCloud } from "./lib/visualization/downsamplePointCloud";
import { getThreePerformanceProfile } from "./hooks/useThreePerformanceProfile";
import { getScanMode } from "./lib/scanMode";
import { extractBasicFootMeasurementsFromFrames } from "./lib/biometry/extractBasicFootMeasurements";
import { yieldToMain } from "./lib/utils/yieldToMain";
import { type ScanPhaseId } from "./constants/scanCapturePhases";
import type { ScanMeshViewerStatus } from "./types/scanProcessing";
import { FOOT_VIEW_ZONE_TO_PHASE } from "./lib/scanner/footViewZoneClassifier";
import { sheetQuadCornersNormFromMarkerQuads } from "./lib/scanner/sheetQuadFromAruco";
import { estimateFootBBoxOverlapFractionOnPolygon } from "./lib/scanner/footOnSheetOverlap";
import { discardCameraStreamHandoff, takeCameraStreamHandoff } from "./lib/cameraStreamHandoff";
import { createNewScan, uploadVideoChunk as supabaseUploadChunk, uploadFullScan, updateScan } from "./lib/scanService";
import { normalizedVideoToContainerPercent } from "./lib/scanner/videoOverlayCoords";
import type { FootId, Metrics } from "./types/scan";

// Lazy-load 3D stack (R3F/three) to avoid crashing the live camera path on Android.
const FootPreview = lazy(() => import("./components/FootPreview"));
const FootTemplatePreviewCanvas = lazy(() => import("./components/three/FootTemplatePreviewCanvas"));

type PhaseId = ScanPhaseId;

type Photo = {
  blob: Blob;
  url: string;
  /** Fase di scansione (0–3) a cui appartiene il frame (burst nascosto) */
  phaseId: PhaseId;
};

async function buildFallbackFootPointCloudMm(metrics: Metrics): Promise<PointCloud> {
  const { buildSmoothFootPointCloudMm } = await import("./lib/visualization/neutralFootTemplate");
  return buildSmoothFootPointCloudMm({
    footLengthMm: Math.max(120, metrics.footLengthMm),
    forefootWidthMm: Math.max(50, metrics.forefootWidthMm),
  });
}

/** Stesso riferimento di `orbitAngleDegFromTilt`: gradi orari da nord → radianti per SVG. */
function coverageDegToRad(deg: number): number {
  return (deg / 360) * 2 * Math.PI - Math.PI / 2;
}

function donutWedgePath(cx: number, cy: number, rInner: number, rOuter: number, t0: number, t1: number): string {
  const x0o = cx + rOuter * Math.cos(t0);
  const y0o = cy + rOuter * Math.sin(t0);
  const x1o = cx + rOuter * Math.cos(t1);
  const y1o = cy + rOuter * Math.sin(t1);
  const x0i = cx + rInner * Math.cos(t0);
  const y0i = cy + rInner * Math.sin(t0);
  const x1i = cx + rInner * Math.cos(t1);
  const y1i = cy + rInner * Math.sin(t1);
  const large = t1 - t0 > Math.PI ? 1 : 0;
  return [
    `M ${x0i} ${y0i}`,
    `L ${x0o} ${y0o}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o}`,
    `L ${x1i} ${y1i}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x0i} ${y0i}`,
    "Z",
  ].join(" ");
}

/**
 * Copertura scansione: settori 360° intorno al piede; ogni settore si illumina quando un frame
 * valido è stato acquisito da quell’angolazione (bin = stesso mapping tilt del gate cattura).
 */
function ScanCoverageSegmentRing({
  segmentCount,
  filledBins,
  currentAngleDeg,
  urgent,
  className,
}: {
  segmentCount: number;
  filledBins: ReadonlySet<number>;
  currentAngleDeg: number | null;
  urgent: boolean;
  className?: string;
}) {
  const cx = 46;
  const cy = 46;
  const rOuter = 36;
  const rInner = 28;
  const rGuide = 36;
  const filledColor = urgent ? "rgba(251,191,36,0.88)" : "rgba(52,211,153,0.92)";
  const emptyColor = "rgba(255,255,255,0.12)";
  const gapDeg = 0.55;

  const filledCount = filledBins.size;
  const pct = Math.round((100 * filledCount) / segmentCount);

  const segments: React.ReactNode[] = [];
  for (let i = 0; i < segmentCount; i++) {
    let d0 = (i / segmentCount) * 360;
    let d1 = ((i + 1) / segmentCount) * 360;
    d0 += gapDeg;
    d1 -= gapDeg;
    if (d1 <= d0 + 1e-3) continue;
    const t0 = coverageDegToRad(d0);
    const t1 = coverageDegToRad(d1);
    segments.push(
      <path
        key={i}
        d={donutWedgePath(cx, cy, rInner, rOuter, t0, t1)}
        fill={filledBins.has(i) ? filledColor : emptyColor}
        className="transition-[fill] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      />
    );
  }

  let markerX: number | null = null;
  let markerY: number | null = null;
  if (currentAngleDeg != null && Number.isFinite(currentAngleDeg)) {
    const rad = coverageDegToRad(currentAngleDeg);
    const rm = (rInner + rOuter) * 0.5;
    markerX = cx + rm * Math.cos(rad);
    markerY = cy + rm * Math.sin(rad);
  }

  return (
    <svg
      className={cn("pointer-events-none", className)}
      viewBox="0 0 92 92"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Scansione intorno al piede: ${filledCount} settori su ${segmentCount} acquisiti`}
    >
      <circle cx={cx} cy={cy} r={rGuide} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
      {segments}
      {markerX != null && markerY != null ? (
        <circle
          cx={markerX}
          cy={markerY}
          r={5}
          fill="rgba(255,255,255,0.95)"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="1"
        />
      ) : null}
    </svg>
  );
}

/**
 * Campionamento dal flusso video live (stile “sessione continua”): nessun bottone scatto,
 * frame utili salvati in background mentre l’utente muove il telefono.
 */
const CONTINUOUS_CAPTURE_INTERVAL_MS = 500;
/** Haptico leggero dopo ogni frame salvato (throttle per non disturbare). */
const CAPTURE_HAPTIC_PULSE_MS = 10;
const CAPTURE_HAPTIC_MIN_INTERVAL_MS = 360;
/** Stabilità piede: 500ms consecutivi con condizioni OK (vedi buffer movimento). */
const CAPTURE_STABLE_MS = 500;
/** Ultimi N campioni centro bbox piede (coord. normalizzate) per movimento piccolo = stabile. */
const FOOT_MOTION_WINDOW = 5;
/** Max passo tra frame consecutivi nel buffer (~4% frame — movimento naturale tollerato). */
const FOOT_MOTION_MAX_STEP = 0.042;
/** Se la cattura “normale” non parte, forza burst dopo così tanti ms (nessun blocco utente). */
const CAPTURE_FALLBACK_AFTER_MS = 2000;
/** Ritardo dopo stato “verde” (imminente) prima di avviare il burst — feedback chiaro. */
const CAPTURE_GREEN_DELAY_MS = 220;
/** Movimento camera (diff luminanza frame vs frame): niente scatto se il telefono è fermo. */
const CAMERA_MOTION_SAMPLE_W = 48;
const CAMERA_MOTION_SAMPLE_H = 27;
/** Media |Δ| pixel normalizzata (0–1) sopra questa soglia = movimento. */
const CAMERA_MOTION_DIFF_MEAN_MIN = 0.014;
/** Ms di movimento cumulativo richiesti prima di poter catturare. */
const CAMERA_MOTION_ACCUM_MS = 500;
/** Campiona ogni ~90ms per limitare CPU su mobile. */
const CAMERA_MOTION_SAMPLE_INTERVAL_MS = 90;
/** Se non rileviamo movimento camera per 1s, mostra warning UX. */
const NO_MOVEMENT_WARNING_AFTER_MS = 1000;
const NO_MOVEMENT_VIBRATE_MS = 20;
const NO_MOVEMENT_VIBRATE_COOLDOWN_MS = 1400;
/** Guida movimento scansione: tilt (° da useScanFrameOrientation) oltre soglia = “inclina leggermente”. */
const SCAN_GUIDE_TILT_X_ABS_MAX = 14;
const SCAN_GUIDE_TILT_Z_ABS_MAX = 18;
/** Segmenti angolari (10°) per copertura 360° attorno al foglio (tilt Y/Z). */
const SCAN_ORBIT_ANGLE_BINS = 36;
/** Delta angolare minimo rispetto all’ultimo frame salvato (vista significativamente diversa). */
const CAMERA_DIRECTION_MIN_DELTA_DEG = 22;
/** Settori angolari 360° per fase: massimo un frame salvato per settore (limita duplicati). */
const CAPTURE_ANGLE_BIN_COUNT = 72;
/** Se durante encode JPEG l’angolo cambia oltre questa soglia, il frame è scartato. */
const CAPTURE_MAX_ANGLE_DRIFT_DURING_ENCODE_DEG = 10;
/** Validazione rule-based (no AI): oggetto ampio/centrato + forma stabile. */
const FOOT_CENTER_MAX_DISTANCE = 0.22;
const FOOT_MIN_BBOX_AREA = 0.16;
const FOOT_SHAPE_WINDOW = 6;
const FOOT_SHAPE_AREA_TOL = 0.06;
const FOOT_SHAPE_ASPECT_TOL = 0.28;
/** Piede “per la maggior parte” nel frame (evita capture quando è tagliato). */
const FOOT_INSIDE_FRAME_MIN_FRAC = 0.7;
/** Minima frazione bbox piede sul poligono foglio (ArUco) per consentire scan. */
const FOOT_ON_SHEET_MIN_OVERLAP = 0.18;
/** Dopo copertura completa: messaggio “Fatto” prima di chiudere camera */
const SCAN_FOOT_DONE_DELAY_MS = 300;
/** Burst: 5–8 frame per zona (qualità dati, un solo feedback UX). */
const BURST_FRAMES_MIN = 5;
const BURST_FRAMES_MAX = 8;
const MAX_PHOTOS_PER_FOOT = BURST_FRAMES_MAX * 4;
/** Raccolta frame per ricostruzione: 40–60 per piede. */
const RECON_CAPTURE_INTERVAL_MS = 400;
const RECON_MAX_FRAMES_PER_FOOT = 50;
/** Upload cloud: sottoinsieme per fase per ridurre timeout serverless (es. 3 x 4 x 2 piedi = 24 foto). */
const UPLOAD_PHOTOS_PER_PHASE = 3;
const RECON_PHOTOS_PER_PHASE_DEFAULT = 4;
const RECON_PHOTOS_PER_PHASE_FAST = 5;
/** Ricostruzione preview: meno foto per fase su mobile = meno CPU. */
const RECON_PHOTOS_PER_PHASE_MOBILE = 3;
const ARUCO_MARKER_SIZE_MM = Number(import.meta.env.VITE_ARUCO_MARKER_SIZE_MM || 40);
/** Nominale usato dalla pipeline/biometria (px/mm) quando si assume un riferimento standard. */
const PX_PER_MM_NOMINAL = 4;
const MIN_ARUCO_SHARPNESS = 45;
/** Scala foglio (pose media lati) in coordinate normalizzate — target A4 a distanza tipica. */
const A4_TRACKING_SCALE_MIN = 0.24;
const A4_TRACKING_SCALE_MAX = 0.72;
/** Scala “ideale” vs bersaglio A4 (stesso ordine di `TRACKING_SCALE_REF` in ScannerAlignmentOverlay). */
const A4_SHEET_TARGET_SCALE = 0.4;
const SHEET_GUIDE_SCALE_TOL_LO = 0.075;
const SHEET_GUIDE_SCALE_TOL_HI = 0.11;
const SHEET_GUIDE_X_TOL = 0.03;
/** Tolleranza verticale centro foglio vs bersaglio (stesso frame normalizzato). */
const SHEET_CENTER_TOL_Y = 0.032;
const SHEET_GUIDE_TRACKING_CONF_MIN = 0.1;
const MIN_FULL_ARUCO_PER_FOOT = 2;
const MAX_OUTPUT_DIM = 1024; // compress before upload, keep aspect ratio
const JPEG_QUALITY = 0.5; // aggressive JPEG quality for upload
const MAX_UPLOAD_FILE_BYTES = 200 * 1024; // target < 200KB
const DEFAULT_METRICS: Metrics = { footLengthMm: 265, forefootWidthMm: 95 };
/** UX beginner: niente fasi/numeri/overlay tecnici, solo due righe chiare. */
const SIMPLE_BEGINNER_SCAN_UI = true;
/** Missione NEUMA Zero-Touch: nessun bottone visibile. */
const ZERO_TOUCH_SCANNER = true;
/** Lock UI orientation to avoid layout jitter on rotation. */
const SCANNER_ORIENTATION_LOCK: "portrait" | "landscape" = "portrait";
/** Starlink-like dot-cloud capture: quick, light videos. */
const STARLINK_DOT_CLOUD_MODE = true;
const DOT_CLOUD_COUNT = 40;
const DOME_RADIUS_CM = 25;
const DOME_HEIGHT_CM = 20;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function angularDistanceDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Angolo telefono nel piano Y/Z (stesso sistema dei bin di copertura), 0–360° o null se troppo debole. */
function orbitAngleDegFromTilt(rotateY: number, rotateZ: number): number | null {
  if (!Number.isFinite(rotateY) || !Number.isFinite(rotateZ)) return null;
  if (Math.hypot(rotateY, rotateZ) < 1.2) return null;
  return ((Math.atan2(rotateZ, rotateY) * 180) / Math.PI + 360) % 360;
}

function captureAngleBinIndex(deg: number, binCount: number): number {
  return Math.min(binCount - 1, Math.max(0, Math.floor((deg / 360) * binCount)));
}

function footPhasesSatisfied(photos: Photo[]): boolean {
  for (let pid = 0; pid < 4; pid++) {
    if (photos.filter((p) => p.phaseId === pid).length < BURST_FRAMES_MIN) return false;
  }
  return true;
}

function formatMmSs(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    bin += String.fromCharCode(...part);
  }
  return btoa(bin);
}

async function captureFrameAsJpeg(video: HTMLVideoElement) {
  const vW = video.videoWidth || 1280;
  const vH = video.videoHeight || 720;
  if (!vW || !vH) return null;
  const scale = Math.min(1, MAX_OUTPUT_DIM / Math.max(vW, vH));
  const cW = Math.max(1, Math.round(vW * scale));
  const cH = Math.max(1, Math.round(vH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cW;
  canvas.height = cH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, cW, cH);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
  });
}

function prepareVideoElement(video: HTMLVideoElement) {
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("muted", "true");
  video.setAttribute("autoplay", "true");
}

async function compressBlobForUpload(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_UPLOAD_FILE_BYTES) return blob;

  const bmp = await createImageBitmap(blob);
  const baseMax = Math.max(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    bmp.close?.();
    return blob;
  }

  let best: Blob = blob;
  let quality = JPEG_QUALITY;
  let maxDim = Math.min(MAX_OUTPUT_DIM, baseMax);

  for (let step = 0; step < 4; step++) {
    const scale = Math.min(1, maxDim / baseMax);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(bmp, 0, 0, w, h);

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
    );
    if (out) {
      best = out;
      if (out.size <= MAX_UPLOAD_FILE_BYTES) break;
    }

    quality = Math.max(0.35, quality - 0.07);
    maxDim = Math.max(640, Math.floor(maxDim * 0.85));
  }

  bmp.close?.();
  return best;
}

function selectRepresentativePhaseFrames<T extends { phaseId: PhaseId }>(frames: T[], perPhasePick: number): T[] {
  if (perPhasePick >= BURST_FRAMES_MAX) return frames.slice();
  const byPhase: T[][] = [[], [], [], []];
  for (const f of frames) {
    const pid = f.phaseId;
    if (pid >= 0 && pid < 4) byPhase[pid].push(f);
  }
  const selected: T[] = [];
  for (let pid = 0; pid < 4; pid++) {
    const pf = byPhase[pid];
    const n = pf.length;
    if (n === 0) continue;
    if (perPhasePick >= n) {
      selected.push(...pf);
      continue;
    }
    const maxPick = Math.min(perPhasePick, 3);
    const indices: number[] = [];
    if (maxPick >= 1) indices.push(0);
    if (maxPick >= 2) indices.push(Math.min(n - 1, Math.max(0, Math.floor(n * 0.5))));
    if (maxPick >= 3) indices.push(n - 1);
    const seen = new Set<number>();
    for (const idx of indices) {
      let i = Math.min(n - 1, Math.max(0, idx));
      let guard = 0;
      while (seen.has(i) && guard < n) {
        i = (i + 1) % n;
        guard++;
      }
      if (!seen.has(i)) {
        seen.add(i);
        selected.push(pf[i]);
      }
    }
  }
  return selected;
}

function pointDistance(a: ArucoMarkerPoint, b: ArucoMarkerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function markerMeanEdgePx(marker: ArucoMarkerDetection): number {
  const c = marker.corners;
  if (!c || c.length < 4) return 0;
  return (
    (pointDistance(c[0], c[1]) +
      pointDistance(c[1], c[2]) +
      pointDistance(c[2], c[3]) +
      pointDistance(c[3], c[0])) /
    4
  );
}

async function validateArucoOnPhoto(blob: Blob) {
  const imageData = await blobToImageData(blob);
  // OpenCV.js path: photo-level ArUco validation disabled in Starlink mode.
  // Keeping this function for legacy pipeline, but without aruco-rs dependency.
  return { ok: false as const, reason: "marker_not_found" as const };
  const picked = pickCornerMarkers([], imageData.width, imageData.height);
  if (!picked.length) return { ok: false as const, reason: "marker_not_found" as const };
  const best = [...picked].sort((a, b) => markerMeanEdgePx(b) - markerMeanEdgePx(a))[0];
  if (!best || best.corners.length < 4) return { ok: false as const, reason: "marker_not_found" as const };
  const sharpness = markerSharpnessScore(imageData, best);
  if (sharpness < MIN_ARUCO_SHARPNESS) {
    return { ok: false as const, reason: "marker_blurry" as const, sharpness };
  }
  const meanEdgePx = markerMeanEdgePx(best);
  if (meanEdgePx <= 0) return { ok: false as const, reason: "marker_not_found" as const };
  const pixelsPerMm = meanEdgePx / ARUCO_MARKER_SIZE_MM;
  const hasFullAruco = picked.length >= 4;
  let footLandmarks: {
    halluxTipMm: { x: number; y: number };
    heelCenterMm: { x: number; y: number };
    archMedialMm: { x: number; y: number };
  } | null = null;

  if (hasFullAruco) {
    const biometry = await computeNeumaBiometryFromImageData(imageData, { markers: picked, pxPerMm: 4 });
    const outsideSheet = biometry.calibration.warnings.some((w) =>
      /parzialmente fuori dal foglio raddrizzato/i.test(w)
    );
    if (outsideSheet) {
      return { ok: false as const, reason: "foot_outside_sheet" as const };
    }
    const hallux = biometry.keypoints.find((k) => k.id === "hallux_tip");
    const heel = biometry.keypoints.find((k) => k.id === "heel_center");
    const arch = biometry.keypoints.find((k) => k.id === "arch_medial");
    if (!hallux || !heel || !arch) {
      return { ok: false as const, reason: "foot_points_missing" as const };
    }
    footLandmarks = {
      halluxTipMm: { x: hallux.xMm, y: hallux.yMm },
      heelCenterMm: { x: heel.xMm, y: heel.yMm },
      archMedialMm: { x: arch.xMm, y: arch.yMm },
    };
  }
  return {
    ok: true as const,
    dictionary: "DICT_4X4_50",
    hasFullAruco,
    corners: best.corners.slice(0, 4),
    sharpness,
    pixelsPerMm,
    footLandmarks,
  };
}

function ProcessingView({
  progress,
  isReady,
  scanId,
  statusText,
  onVisualize,
  onBackToGallery,
}: {
  progress: number;
  isReady: boolean;
  scanId: string | null;
  statusText?: string;
  onVisualize: () => void;
  onBackToGallery: () => void;
}) {
  return (
    <div className="absolute inset-0 z-70 flex items-center justify-center bg-zinc-950/75 backdrop-blur-sm px-6">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 text-center backdrop-blur-md">
        <div className="mt-1 font-sans text-3xl font-semibold text-zinc-100">Fatto</div>
        <div className="mt-2 text-sm text-zinc-200/95">Creazione in corso</div>

        <div className="mt-5 h-3 w-full overflow-hidden rounded-full border border-zinc-800 bg-zinc-950/80">
          <div
            className="h-full bg-blue-600 transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-3 font-mono text-[12px] tracking-[0.14em] text-blue-500/90">
          {Math.floor(progress)}%
        </div>

        <div className="mt-5 text-sm text-zinc-400">
          {statusText || (scanId && isReady ? "Pronto." : "Questo può richiedere alcuni secondi.")}
        </div>
      </div>
    </div>
  );
}

export default function ScannerCattura() {
  const BUILD_TAG = "native-cam-2026-03-31";
  const SHOW_DEBUG_OVERLAY = import.meta.env.DEV;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [gyroAlivePing, setGyroAlivePing] = useState(false);
  const gyroAliveRef = useRef(false);
  const [sensorsUnlocked, setSensorsUnlocked] = useState(false);
  const [sensorsPromptVisible, setSensorsPromptVisible] = useState(false);
  const [scanStarted, setScanStarted] = useState(false);
  const [dotCloudSuccessFlash, setDotCloudSuccessFlash] = useState(false);
  const [arucoFallbackArcDeg] = useState(0);

  const [cameraState, setCameraState] = useState<
    | "idle"
    | "starting"
    | "readyPhase"
    | "betweenFeet"
    | "review"
    | "uploading"
    | "visualizing"
    | "error"
  >("idle");
  const [hasLivePreview, setHasLivePreview] = useState(false);
  const [arcDisplayDeg, setArcDisplayDeg] = useState(0);
  const arcTargetDegRef = useRef(0);
  const hapticStepRef = useRef(-1);
  const [dotCloudProgressPct, setDotCloudProgressPct] = useState(0);
  const dotCloudProgressRef = useRef(0);
  const dotCloudHudPctRef = useRef<HTMLSpanElement | null>(null);
  const debugFpsElRef = useRef<HTMLSpanElement | null>(null);
  const debugMarkersElRef = useRef<HTMLSpanElement | null>(null);
  const debugWasmElRef = useRef<HTMLSpanElement | null>(null);
  const debugDetectElRef = useRef<HTMLSpanElement | null>(null);
  const debugErrElRef = useRef<HTMLDivElement | null>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dotCloudRef = useRef<{ id: number; yaw: number; pitch: number; consumed: boolean; pop: number }[]>([]);
  const dotCloudCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dotCloudConsumedRef = useRef(0);
  const dotCloudStartedRef = useRef(false);
  const dotCloudDoneRef = useRef(false);
  const lastArucoSeenAtRef = useRef(0);
  const domeFadeStartAtRef = useRef(0);
  const domeOpacityRef = useRef(0);
  const domeCenterSmoothedRef = useRef<{ x: number; y: number; scale: number } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [portraitOk, setPortraitOk] = useState(true);
  const [hudSizePx, setHudSizePx] = useState(150);
  const [openCvStatus, setOpenCvStatus] = useState<"loading" | "ready" | "error">("loading");
  const [openCvError, setOpenCvError] = useState<string | null>(null);
  const openCvBootStartedAtRef = useRef<number>(0);

  // Freeze layout to full viewport.
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth || 0;
      const h = window.innerHeight || 0;
      setPortraitOk(h >= w);
      const base = Math.min(w, h);
      setHudSizePx(Math.round(Math.max(120, Math.min(190, base * 0.34))));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // Polling: accept OpenCV (cvReady) OR js-aruco2 (AR.Detector) as "ready".
  useEffect(() => {
    openCvBootStartedAtRef.current = performance.now();
    setOpenCvStatus("loading");
    setOpenCvError(null);
    const id = window.setInterval(() => {
      const cv = (window as any).cv;
      const cvOk = cv && !!(window as any).cvReady && typeof cv.Mat === "function";
      const arOk = !!(window as any).AR?.Detector;
      if (cvOk || arOk) {
        setOpenCvStatus("ready");
        setOpenCvError(null);
        window.clearInterval(id);
        // Diagnostic: log cv.aruco status when OpenCV is present.
        if (cv && !cv.aruco) {
          console.log("ERRORE: Modulo ArUco non presente nel file JS (rilevamento via js-aruco2)");
        }
      }
    }, 500);
    const timeout = window.setTimeout(() => {
      const cv = (window as any).cv;
      const arOk = !!(window as any).AR?.Detector;
      if (!arOk && !cv) {
        setOpenCvStatus("error");
        const boot = (window as any).__opencv_boot;
        const errs = boot?.errors?.length ? String(boot.errors.slice(-3).join(" | ")) : "";
        const loaded = boot ? String(!!boot.jsLoaded) : "n/a";
        setOpenCvError(`ERRORE: window.cv non trovato nel DOM (jsLoaded=${loaded}${errs ? `; ${errs}` : ""})`);
      }
    }, 8000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    // Freeze page layout and prevent scroll jitter on rotation.
    const root = document.documentElement;
    const body = document.body;
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevBodyTouch = body.style.touchAction;
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    body.style.touchAction = "none";
    return () => {
      root.style.overflow = prevRootOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
      body.style.touchAction = prevBodyTouch;
    };
  }, []);

  // Debug: confirm video element is present in DOM after mount.
  useEffect(() => {
    if (videoRef.current) {
      console.log("VIDEO_ELEMENT_MOUNTED", videoRef.current);
    } else {
      console.warn("VIDEO_ELEMENT_MOUNTED — ref is null on mount");
    }
  }, []);

  // Camera start: request on user gesture for universal compatibility (iOS requires it).
  const cameraStartedRef = useRef(false);
  useEffect(() => {
    return () => {};
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const restartCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    cameraStartedRef.current = false;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { exact: 1920 },
            height: { exact: 1080 },
          },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      }
      streamRef.current = stream;
      try {
        const track = stream.getVideoTracks?.()[0];
        if ((track as unknown as { applyConstraints?: (c: unknown) => Promise<void> })?.applyConstraints) {
          await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
            advanced: [{ focusMode: "continuous", exposureMode: "continuous" }],
          });
        }
      } catch {
        // ignore
      }
      const videoEl = videoRef.current;
      if (videoEl) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (videoEl as any).srcObject = stream;
        // Fire-and-forget: autoPlay handles playback; awaiting can AbortError on Android
        videoEl.play().catch((e) => {
          console.warn("[ScannerCattura] restartCamera play() soft-failed:", e);
        });
        setHasLivePreview(true);
        cameraStartedRef.current = true;
      }
    } catch (e) {
      console.error("[ScannerCattura] restartCamera failed:", e);
    }
  }, []);

  // Camera re-sync refs (effect lives after `alignment` is created).
  const noMarkersSinceRef = useRef<number | null>(null);
  const lastResyncAtRef = useRef(0);

  const preferredVideoDeviceIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoStreamIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `vs_${Date.now()}`
  );
  const videoChunkIndexRef = useRef(0);
  const videoDriveFolderIdRef = useRef<string | null>(null);
  const videoUploadChainRef = useRef<Promise<void>>(Promise.resolve());
  /** Accumulates MediaRecorder chunks locally; assembled into a single Blob at upload time. */
  const videoChunksRef = useRef<Blob[]>([]);
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  /** 0-100: stability countdown progress before auto-starting recording. */
  const [stabilityPct, setStabilityPct] = useState(0);
  const stableTimerRef = useRef<number | null>(null);
  const stableStartRef = useRef<number>(0);

  /** 0-210: degrees the user has rotated around the foot since recording started. */
  const [gyroArcDeg, setGyroArcDeg] = useState(0);
  const gyroAccRef = useRef(0);
  const gyroLastAlphaRef = useRef<number | null>(null);
  const ARC_TARGET_DEG = 210;
  const [showMotionBlurWarning, setShowMotionBlurWarning] = useState(false);
  const motionBlurScoreRef = useRef<number>(0);
  const blurCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastAngleDegRef = useRef<number | null>(null);
  const lastAngleTsRef = useRef<number>(0);
  const livePreviewLastTimeRef = useRef<number>(0);
  const livePreviewLastAdvanceAtRef = useRef<number>(0);
  const [cameraOverlayError, setCameraOverlayError] = useState<string>("");
  const [cameraOverlayDiagnostics, setCameraOverlayDiagnostics] = useState<string>("");
  const cameraProbeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoStreamKey, setVideoStreamKey] = useState<string>("empty");
  const [firstFootSelection, setFirstFootSelection] = useState<FootId | null>(null);
  const [footSelectionWarning, setFootSelectionWarning] = useState("");

  // URL debug flags (works in production without router hooks).
  const scannerUrlFlags = useMemo(() => {
    try {
      return new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    } catch {
      return new URLSearchParams();
    }
  }, []);
  const NO_SCANNER_OVERLAYS = scannerUrlFlags.has("no-overlays");
  const SHOW_SCANNER_STATE_BADGE = scannerUrlFlags.has("debug-camera");
  const [scannerStateBadge, setScannerStateBadge] = useState<string>("");

  useEffect(() => {
    if (!SHOW_SCANNER_STATE_BADGE) return;
    let cancelled = false;
    const id = window.setInterval(() => {
      if (cancelled) return;
      const v = videoRef.current;
      const s = streamRef.current;
      const t = s?.getVideoTracks?.()?.[0];
      const dims = `${v?.videoWidth || 0}x${v?.videoHeight || 0}`;
      const rs = v ? `${v.readyState}` : "—";
      const paused = v ? String(v.paused) : "—";
      const ct = v ? (v.currentTime || 0).toFixed(3) : "—";
      const tr = t?.readyState ?? "—";
      setScannerStateBadge(`state=${cameraState} live=${hasLivePreview ? "1" : "0"}\nvideo=${dims} rs=${rs} p=${paused} t=${ct}\ntrack=${tr}`);
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [SHOW_SCANNER_STATE_BADGE, cameraState, hasLivePreview]);

  // Minimal UX: auto-start the scan flow as soon as the scanner mounts.
  // (Opening the scanner dialog counts as the user intent for permission prompts.)
  const autoStartOnceRef = useRef(false);

  /** Prima il piede sinistro, poi il destro (stesso ordine / stessa sessione). */
  const [currentFoot, setCurrentFoot] = useState<FootId>("LEFT");
  const [photosLeft, setPhotosLeft] = useState<Photo[]>([]);
  const [photosRight, setPhotosRight] = useState<Photo[]>([]);
  const [error, setError] = useState<string>("");

  const [scanId, setScanId] = useState<string>("");
  const [scanPath, setScanPath] = useState<string>("");
  const supabaseScanIdRef = useRef<number | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [timerSeconds, setTimerSeconds] = useState<number>(0);
  const startAtRef = useRef<number>(0);

  // Frame buffer (in-memory) for reconstruction
  const reconFramesLeftRef = useRef<Blob[]>([]);
  const reconFramesRightRef = useRef<Blob[]>([]);
  const reconFramesCount = useMemo(
    () => ({
      left: reconFramesLeftRef.current.length,
      right: reconFramesRightRef.current.length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cameraState, currentFoot] // coarse invalidation for display/debug if needed
  );

  // Fasi interne 0–3 (top → esterno → interno → tallone), senza UI dedicata
  const [phaseIndex, setPhaseIndex] = useState<PhaseId>(0);

  const photos = useMemo(() => [...photosLeft, ...photosRight], [photosLeft, photosRight]);
  const photosCurrentFoot = useMemo(
    () => (currentFoot === "LEFT" ? photosLeft : photosRight),
    [currentFoot, photosLeft, photosRight]
  );

  /** Settori 360° con almeno un frame salvato (per piede corrente), allineati ai bin tilt. */
  const [footScanCoverageBins, setFootScanCoverageBins] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    setFootScanCoverageBins(new Set());
  }, [currentFoot]);

  useEffect(() => {
    // Reset reconstruction buffer per cambio piede (teniamo buffer separati).
    if (currentFoot === "LEFT") reconFramesLeftRef.current = [];
    else reconFramesRightRef.current = [];
  }, [currentFoot]);

  useEffect(() => {
    if (cameraState !== "readyPhase") {
      setFootScanCoverageBins(new Set());
    }
  }, [cameraState]);

  const pathZonesComplete = useMemo((): [boolean, boolean, boolean, boolean] => {
    const n = (id: PhaseId) =>
      photosCurrentFoot.filter((p) => p.phaseId === id).length >= BURST_FRAMES_MIN;
    return [n(0), n(1), n(2), n(3)];
  }, [photosCurrentFoot]);
  /** Copertura vista per piede corrente (sistema, non UI) */
  const coverage = useMemo(
    () => ({
      top: pathZonesComplete[0],
      outer: pathZonesComplete[1],
      inner: pathZonesComplete[2],
      heel: pathZonesComplete[3],
    }),
    [pathZonesComplete]
  );

  const scanMode = useMemo(() => getScanMode(), []);
  const assistedMode = scanMode === "assistant";
  const selfMode = scanMode === "solo";
  const orbitBinsTarget = assistedMode ? 24 : SCAN_ORBIT_ANGLE_BINS;

  /** Fine piede: tutte le viste fase OPPURE giro completo (360° = tutti i settori). */
  const footScanCoverageComplete =
    (coverage.top && coverage.outer && coverage.inner && coverage.heel) ||
    footScanCoverageBins.size >= orbitBinsTarget;
  /** Persiste tra fasi: consente review/upload se un piede è finito solo con orbita 360°. */
  const [orbitCompleteLeft, setOrbitCompleteLeft] = useState(false);
  const [orbitCompleteRight, setOrbitCompleteRight] = useState(false);
  const pairComplete =
    (footPhasesSatisfied(photosLeft) || orbitCompleteLeft) &&
    (footPhasesSatisfied(photosRight) || orbitCompleteRight);

  // Beginner progress: infer "where you are" around the 360° orbit from completed capture zones.
  const scanZoneCompleteCount = useMemo(
    () => pathZonesComplete.reduce((acc, v) => acc + (v ? 1 : 0), 0),
    [pathZonesComplete]
  );
  const scanProgressMessage = useMemo((): "Inizio" | "Metà giro" | "Quasi finito" | "Perfetto" => {
    if (footScanCoverageComplete) return "Perfetto";
    if (scanZoneCompleteCount >= 3) return "Quasi finito";
    if (scanZoneCompleteCount >= 2) return "Metà giro";
    return "Inizio";
  }, [footScanCoverageComplete, scanZoneCompleteCount]);

  const [biometryResult, setBiometryResult] = useState<NeumaBiometryResult | null>(null);
  const [biometryBusy, setBiometryBusy] = useState(false);
  const [biometrySourceIndex, setBiometrySourceIndex] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingScanId, setProcessingScanId] = useState<string | null>(null);
  const [processingReady, setProcessingReady] = useState(false);
  const [processingStatusText, setProcessingStatusText] = useState<string>("");
  const PROCESSING_MESSAGES = useMemo(() => [
    "Analisi dei frame…",
    "Estrazione misure biometriche…",
    "Generazione modello 3D…",
    "Ottimizzazione superficie…",
    "Quasi pronto…",
  ], []);
  const [processingMsgIndex, setProcessingMsgIndex] = useState(0);
  useEffect(() => {
    if (cameraState !== "visualizing") {
      setProcessingMsgIndex(0);
      return;
    }
    const iv = window.setInterval(() => {
      setProcessingMsgIndex((i) => (i + 1) % PROCESSING_MESSAGES.length);
    }, 1500);
    return () => window.clearInterval(iv);
  }, [cameraState, PROCESSING_MESSAGES]);
  const processingIntervalRef = useRef<number | null>(null);
  const processingCompletionTimeoutRef = useRef<number | null>(null);
  /** Simulazione generazione mesh dopo "VISUALIZZA 3D" (futuro polling API) */
  const meshGenTimeoutRef = useRef<number | null>(null);
  const [scanMeshViewerStatus, setScanMeshViewerStatus] = useState<ScanMeshViewerStatus>("idle");
  const [meshPreviewUrl, setMeshPreviewUrl] = useState<string | null>(null);
  const [reconstructedCloud, setReconstructedCloud] = useState<PointCloud | null>(null);
  const [reconstructedMetrics, setReconstructedMetrics] = useState<Metrics | null>(null);
  const [scanValidationReady, setScanValidationReady] = useState(false);
  const [previewTransitionActive, setPreviewTransitionActive] = useState(false);
  const [previewRevealReady, setPreviewRevealReady] = useState(false);
  const previewTransitionTimeoutsRef = useRef<number[]>([]);

  const continuousCaptureIntervalMs = assistedMode ? 340 : 560;
  /** Dopo CAPTURE_FALLBACK_AFTER_MS senza burst: sblocca cattura e mostra “Perfetto” (con overlay verde). */
  const [captureFallbackArmed, setCaptureFallbackArmed] = useState(false);
  const captureFallbackTimeoutRef = useRef<number | null>(null);
  const [greenDelayArmed, setGreenDelayArmed] = useState(false);
  const greenDelayTimerRef = useRef<number | null>(null);

  /** true se movimento camera sopra soglia per almeno CAMERA_MOTION_ACCUM_MS (no foto da fermo). */
  const [cameraMotionGateOk, setCameraMotionGateOk] = useState(false);
  /** 0–1: accumulo movimento verso soglia (per anello di progresso). */
  const [cameraMotionRingProgress, setCameraMotionRingProgress] = useState(0);
  const [showNoMovementWarning, setShowNoMovementWarning] = useState(false);
  const cameraMotionPrevLumRef = useRef<Uint8Array | null>(null);
  const cameraMotionAccumMsRef = useRef(0);
  const cameraMotionLastSampleAtRef = useRef(0);
  const cameraMotionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraMotionLastDetectedAtRef = useRef(0);
  const cameraMotionLastBuzzAtRef = useRef(0);
  const lastCaptureDirectionRef = useRef<number | null>(null);
  /** Bin angolari già usati nella fase corrente (evita più foto dalla stessa direzione). */
  const captureAngleBinsUsedRef = useRef<Set<number>>(new Set());
  const cameraMotionGateOkRef = useRef(false);
  const captureHapticLastAtRef = useRef(0);

  const currentFootRef = useRef<FootId>("LEFT");
  const firstFootSelectionRef = useRef<FootId | null>(null);
  const phaseIndexRef = useRef<PhaseId>(phaseIndex);
  const burstInFlightRef = useRef(false);
  const burstCancelledRef = useRef(false);
  const photosLeftRef = useRef<Photo[]>(photosLeft);
  const photosRightRef = useRef<Photo[]>(photosRight);
  const continuousCaptureAllowedRef = useRef(false);
  const currentDirectionDegRef = useRef<number | null>(null);
  const cameraStateRef = useRef(cameraState);
  const footScanCoverageCompleteRef = useRef(false);
  const [footScanDoneVisible, setFootScanDoneVisible] = useState(false);
  const prevCameraStateRef = useRef(cameraState);
  const reviewAutoUploadTimeoutRef = useRef<number | null>(null);
  const reviewAutoUploadArmedRef = useRef(false);
  useEffect(() => {
    currentFootRef.current = currentFoot;
  }, [currentFoot]);

  useEffect(() => {
    firstFootSelectionRef.current = firstFootSelection;
  }, [firstFootSelection]);

  useEffect(() => {
    phaseIndexRef.current = phaseIndex;
  }, [phaseIndex]);

  useEffect(() => {
    captureAngleBinsUsedRef.current.clear();
    lastCaptureDirectionRef.current = null;
  }, [phaseIndex, currentFoot]);

  useEffect(() => {
    cameraMotionGateOkRef.current = cameraMotionGateOk;
  }, [cameraMotionGateOk]);

  useEffect(() => {
    photosLeftRef.current = photosLeft;
    photosRightRef.current = photosRight;
  }, [photosLeft, photosRight]);

  useEffect(() => {
    cameraStateRef.current = cameraState;
  }, [cameraState]);

  useEffect(() => {
    footScanCoverageCompleteRef.current = footScanCoverageComplete;
  }, [footScanCoverageComplete]);

  useEffect(() => {
    return () => {
      if (meshGenTimeoutRef.current) {
        clearTimeout(meshGenTimeoutRef.current);
        meshGenTimeoutRef.current = null;
      }
    };
  }, []);

  /** Biometria NEUMA: prova foto rappresentative (fine fase) fino a calibrazione OK */
  useEffect(() => {
    if (!pairComplete) {
      setBiometryResult(null);
      setBiometryBusy(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setBiometryBusy(true);
      const n = photosLeft.length;
      const candidates: number[] = [];
      if (n > 0) {
        const seeds = [
          n - 1,
          Math.floor(n * 0.55),
          0,
          Math.floor(n * 0.25),
          Math.floor(n * 0.8),
          n - 2,
          4,
          8,
          12,
          16,
          20,
        ];
        for (const i of seeds) {
          if (i >= 0 && i < n && !candidates.includes(i)) candidates.push(i);
        }
        for (let i = 0; i < n && candidates.length < 20; i++) {
          if (!candidates.includes(i)) candidates.push(i);
        }
      }
      try {
        for (const idx of candidates) {
          const p = photosLeft[idx];
          if (!p?.blob) continue;
          const imageData = await blobToImageData(p.blob);
          const res = await computeNeumaBiometryFromImageData(imageData);
          if (cancelled) return;
          if (res.calibration.ok) {
            setBiometryResult(res);
            setBiometrySourceIndex(idx);
            break;
          }
        }
      } catch {
        /* silenzioso: overlay opzionale */
      } finally {
        if (!cancelled) setBiometryBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pairComplete, photosLeft]);

  const scanOverlayEnabled = cameraState === "readyPhase";
  /** Keep legacy alignment shape for the rest of the scanner pipeline. Disabled in Starlink/OpenCV mode. */
  const alignmentResetKey = currentFoot === "RIGHT" ? 1 : 0;
  const alignment = useScanAlignmentAnalysis(videoRef, scanOverlayEnabled && !STARLINK_DOT_CLOUD_MODE, alignmentResetKey, currentFoot);
  /** OpenCV-based ArUco for Starlink mode. */
  // Keep analysis loop alive for FPS heartbeat even while OpenCV is loading.
  const openCvAruco = useOpenCvArucoAnalysis(videoRef, scanOverlayEnabled);

  // Bypass React re-render: update debug HUD + draw marker boxes directly.
  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    let raf = 0;
    let lastHudAt = 0;
    // Cache DOM lookups once (explicit bypass requested).
    const fpsEl = document.getElementById("debug-fps") as HTMLSpanElement | null;
    const markersEl = document.getElementById("debug-markers") as HTMLSpanElement | null;
    const wasmEl = document.getElementById("debug-wasm") as HTMLSpanElement | null;
    const detectEl = document.getElementById("debug-detect") as HTMLSpanElement | null;
    const errEl = document.getElementById("debug-err") as HTMLDivElement | null;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const snap = STARLINK_DOT_CLOUD_MODE ? (openCvAruco.liveRef.current as any) : alignment.liveRef.current;
      // HUD update ~5Hz (no React state)
      if (t - lastHudAt > 180) {
        lastHudAt = t;
        if (fpsEl) fpsEl.innerText = String(Math.round(snap.analysisFps ?? 0));
        if (markersEl) markersEl.innerText = String(snap.markerCount ?? 0);
        if (wasmEl) {
          const cvDone = !!(window as any).cvReady;
          const arDone = !!(window as any).AR?.Detector;
          const baseStatus = STARLINK_DOT_CLOUD_MODE ? String(snap.status ?? "") : String(snap.arucoEngine ?? "");
          wasmEl.innerText = cvDone ? "READY" : arDone ? baseStatus : "loading";
        }
        if (detectEl) detectEl.innerText = STARLINK_DOT_CLOUD_MODE ? `${Math.round(snap.detectMs ?? 0)}ms` : `${Math.round(snap.arucoDetectMs ?? 0)}ms`;
        if (errEl) errEl.innerText = STARLINK_DOT_CLOUD_MODE ? (snap.error ?? "") : (snap.arucoDetectError ?? "");
        if (dotCloudHudPctRef.current) dotCloudHudPctRef.current.innerText = `${dotCloudProgressRef.current}%`;
      }

      // Marker boxes: draw directly on a single canvas overlay.
      const c = debugCanvasRef.current;
      const box = videoContainerRef.current;
      const v = videoRef.current;
      if (!c || !box || !v) return;
      const rect = box.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || !v.videoWidth || !v.videoHeight) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (c.width !== targetW || c.height !== targetH) {
        c.width = targetW;
        c.height = targetH;
        c.style.width = `${rect.width}px`;
        c.style.height = `${rect.height}px`;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.scale(dpr, dpr);
      const quads = (STARLINK_DOT_CLOUD_MODE ? snap.quadsNorm : snap.arucoMarkerQuadsNorm) ?? [];
      if (!quads.length) return;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(57,255,20,0.95)";
      ctx.shadowColor = "rgba(57,255,20,0.35)";
      ctx.shadowBlur = 14;
      for (const q of quads) {
        const cs = (q.corners ?? []).slice(0, 4);
        if (cs.length < 4) continue;
        const pts = cs.map((p) => {
          const pos = normalizedVideoToContainerPercent(p.x, p.y, v.videoWidth, v.videoHeight, rect.width, rect.height);
          return { x: (pos.leftPct / 100) * rect.width, y: (pos.topPct / 100) * rect.height };
        });
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.lineTo(pts[3].x, pts[3].y);
        ctx.closePath();
        ctx.stroke();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [alignment.liveRef, cameraState]);

  // Camera re-sync: if no markers are detected for 3s, try to kick autofocus/restart once.
  useEffect(() => {
    if (cameraState !== "readyPhase") {
      noMarkersSinceRef.current = null;
      return;
    }
    if (!scanStarted) {
      noMarkersSinceRef.current = null;
      return;
    }
    if ((alignment.markerCount ?? 0) > 0) {
      noMarkersSinceRef.current = null;
      return;
    }
    const now = performance.now();
    if (noMarkersSinceRef.current == null) noMarkersSinceRef.current = now;
    const elapsed = now - noMarkersSinceRef.current;
    if (elapsed < 3000) return;
    if (now - lastResyncAtRef.current < 7000) return;
    lastResyncAtRef.current = now;
    (async () => {
      try {
        const track = streamRef.current?.getVideoTracks?.()[0];
        if ((track as unknown as { applyConstraints?: (c: unknown) => Promise<void> })?.applyConstraints) {
          await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
            advanced: [{ focusMode: "continuous", exposureMode: "continuous" }],
          });
          return;
        }
      } catch {}
      try {
        await restartCamera();
      } catch {}
    })();
  }, [alignment.markerCount, cameraState, restartCamera, scanStarted]);
  const frameTilt = useScanFrameOrientation(scanOverlayEnabled);

  /** Angolo istantaneo 0–360° (stesso mapping dei settori); null senza foglio o tilt debole. */
  const liveOrbitAngleDeg = useMemo(() => {
    if (cameraState !== "readyPhase") return null;
    if (alignment.markerCount < 2) return null;
    return orbitAngleDegFromTilt(frameTilt.rotateY, frameTilt.rotateZ);
  }, [cameraState, alignment.markerCount, frameTilt.rotateY, frameTilt.rotateZ]);

  const scanCaptureCoverageProgress = useMemo(
    () => Math.min(1, footScanCoverageBins.size / orbitBinsTarget),
    [footScanCoverageBins, orbitBinsTarget]
  );

  const uploadVideoChunk = useCallback(
    async (chunk: Blob, chunkIndex: number) => {
      const sbScanId = supabaseScanIdRef.current;
      if (sbScanId == null) {
        console.warn("[uploadVideoChunk] No Supabase scan ID yet — skipping chunk", chunkIndex);
        return;
      }

      try {
        await supabaseUploadChunk(sbScanId, chunkIndex, chunk);
      } catch (err) {
        console.error("[uploadVideoChunk] Supabase Storage upload failed:", err);
      }
    },
    []
  );

  const stopVideoRecording = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const rec = mediaRecorderRef.current;
      if (!rec || rec.state === "inactive") {
        mediaRecorderRef.current = null;
        setIsVideoRecording(false);
        resolve();
        return;
      }
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
      mediaRecorderRef.current = null;
      setIsVideoRecording(false);
    });
  }, []);

  const recordingStopRequestedRef = useRef(false);
  const recordingStartedAtRef = useRef<number>(0);

  const unlockSensorsFromGesture = useCallback(async () => {
    try {
      await requestOrientationAccess();
    } catch {
      // ignore; some browsers resolve without permission and still emit events
    }
    setSensorsUnlocked(true);
    setSensorsPromptVisible(false);
  }, []);

  const handleStartScan = useCallback(async () => {
    // Must be called from a user gesture.
    try {
      const o = (window.screen as unknown as { orientation?: { lock?: (v: string) => Promise<void> } })?.orientation;
      const lockFn = o?.lock;
      if (typeof lockFn === "function") {
        await lockFn.call(o, "portrait");
      }
    } catch {
      // ignore
    }

    // iOS requires explicit permission calls.
    try {
      const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
      if (typeof DOE?.requestPermission === "function") {
        await DOE.requestPermission().catch(() => "denied");
      }
    } catch {}
    try {
      const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
      if (typeof DME?.requestPermission === "function") {
        await DME.requestPermission().catch(() => "denied");
      }
    } catch {}

    await unlockSensorsFromGesture();
    setScanStarted(true);
  }, [unlockSensorsFromGesture]);

  // stopAndUploadDotCloud is declared later (needs uploadFullScanVideo).

  /**
   * Assembles accumulated video chunks into a single Blob and uploads it to
   * Supabase Storage ("raw-scans/scan_<timestamp>.webm").
   * Updates the existing `scans` row (or creates a new one) with video_url +
   * status "pending" so the Mac Python worker can pick it up.
   */
  const uploadFullScanVideo = useCallback(
    async (onProgress: (p: number) => void): Promise<void> => {
      const chunks = videoChunksRef.current;
      if (!chunks.length) return;

      const mimeType = "video/webm";
      const blob = new Blob(chunks, { type: mimeType });
      const filename = `scan_${Date.now()}.webm`;

      // Simulated progress (Supabase JS client has no progress callback).
      // Estimate: ~150 KB/s on a typical mobile connection.
      const estimatedMs = Math.max(3000, blob.size / 150);
      let fake = 0;
      const ticker = setInterval(() => {
        fake = Math.min(88, fake + (88 / (estimatedMs / 250)));
        onProgress(Math.round(fake));
      }, 250);

      try {
        await uploadFullScan(filename, blob);
        clearInterval(ticker);
        onProgress(97);

        // Update the scan row created at session start, or create a fresh one.
        let existingId = supabaseScanIdRef.current;
        if (!existingId) {
          try {
            existingId = await createNewScan();
            supabaseScanIdRef.current = existingId;
          } catch (e) {
            console.warn("[Supabase] createNewScan failed during upload (non-fatal):", e);
          }
        }
        if (existingId) await updateScan(existingId, { video_url: filename, status: "pending" });

        onProgress(100);
        console.log("[ScannerCattura] video uploaded:", filename);
      } catch (err) {
        clearInterval(ticker);
        console.error("[ScannerCattura] uploadFullScanVideo failed:", err);
        throw err;
      }
    },
    []
  );

  const stopAndUploadDotCloud = useCallback(async () => {
    if (dotCloudDoneRef.current) return;
    dotCloudDoneRef.current = true;
    setCameraState("uploading");
    try {
      await stopVideoRecording();
    } catch {}
    try {
      await uploadFullScanVideo((p) => setVideoUploadProgress(p));
    } catch {}
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("neuma:scan-proceed", {
          detail: { scanId: supabaseScanIdRef.current ?? undefined },
        })
      );
    }
  }, [stopVideoRecording, uploadFullScanVideo]);

  const startVideoRecording = useCallback(() => {
    if (typeof window === "undefined") return;
    const stream = streamRef.current;
    if (!stream) return;
    if (mediaRecorderRef.current) return;
    if (typeof MediaRecorder === "undefined") return;

    const mimeCandidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType = mimeCandidates.find((m) => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    });

    videoChunkIndexRef.current = 0;
    videoStreamIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `vs_${Date.now()}`;
    videoDriveFolderIdRef.current = null;
    videoChunksRef.current = [];
    setShowMotionBlurWarning(false);

    const rec = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 7_000_000, // 6–8 Mbps target: keep <15MB for ~10s
      audioBitsPerSecond: 0,         // nessun audio (scansione)
    });
    mediaRecorderRef.current = rec;
    setIsVideoRecording(true);

    rec.ondataavailable = (ev: BlobEvent) => {
      const blob = ev.data;
      if (!blob || blob.size < 512) return;
      videoChunksRef.current.push(blob);
      videoChunkIndexRef.current++;
    };
    rec.onerror = (e) => {
      console.error("[ScannerCattura] MediaRecorder error", e);
    };
    rec.start(1200); // timeslice: chunk ~1.2s
  }, [uploadVideoChunk]);

  // Starlink requirement: keep video recording running in background once scan starts
  // (but only when at least ONE ArUco marker is visible).
  useEffect(() => {
    if (!STARLINK_DOT_CLOUD_MODE) return;
    if (!scanStarted) return;
    if (cameraState !== "readyPhase") return;
    if (!sensorsUnlocked) return;
    if ((alignment.markerCount ?? 0) < 1) return;
    if (isVideoRecording) return;
    startVideoRecording();
  }, [
    alignment.markerCount,
    cameraState,
    isVideoRecording,
    scanStarted,
    sensorsUnlocked,
    startVideoRecording,
  ]);

  // Stop recording when leaving readyPhase; starting is handled by the stability timer below.
  useEffect(() => {
    if (cameraState !== "readyPhase") {
      void stopVideoRecording();
      if (stableTimerRef.current) {
        clearInterval(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      setStabilityPct(0);
    }
  }, [cameraState, stopVideoRecording]);

  // Track 210° arc progress via DeviceOrientation alpha (relative rotation from start).
  useEffect(() => {
    if (!isVideoRecording) {
      gyroAccRef.current = 0;
      gyroLastAlphaRef.current = null;
      setGyroArcDeg(0);
      gyroAliveRef.current = false;
      setGyroAlivePing(false);
      return;
    }
    gyroAccRef.current = 0;
    gyroLastAlphaRef.current = null;
    gyroAliveRef.current = false;
    setGyroAlivePing(false);

    const onOrientation = (e: DeviceOrientationEvent) => {
      const alpha = e.alpha;
      if (alpha == null) return;
      const last = gyroLastAlphaRef.current;
      if (last === null) {
        gyroLastAlphaRef.current = alpha;
        return;
      }
      let delta = alpha - last;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      gyroAccRef.current += Math.abs(delta);
      gyroLastAlphaRef.current = alpha;

      const clamped = Math.min(ARC_TARGET_DEG, gyroAccRef.current);
      setGyroArcDeg(clamped);

      // Calibration ping: confirm sensor is alive after first ~5°.
      if (!gyroAliveRef.current && clamped >= 5) {
        gyroAliveRef.current = true;
        setGyroAlivePing(true);
        if ("vibrate" in navigator) navigator.vibrate(18);
        window.setTimeout(() => setGyroAlivePing(false), 900);
      }

      // Fill bins proportionally so the existing coverage/upload flow triggers at 210°.
      const bins = orbitBinsTarget;
      const numFill = Math.floor((clamped / ARC_TARGET_DEG) * bins);
      setFootScanCoverageBins((prev) => {
        if (prev.size >= numFill) return prev;
        const next = new Set<number>();
        for (let i = 0; i < numFill; i++) next.add(i);
        const isNewSector = next.size > prev.size;
        const isComplete = next.size >= bins;
        if (isComplete) {
          if (currentFootRef.current === "LEFT") setOrbitCompleteLeft(true);
          else setOrbitCompleteRight(true);
          if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
        } else if (isNewSector) {
          if ("vibrate" in navigator) navigator.vibrate(12);
        }
        return next;
      });
    };

    window.addEventListener("deviceorientation", onOrientation, true);
    return () => window.removeEventListener("deviceorientation", onOrientation, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoRecording, orbitBinsTarget]);

  // Timers removed: Starlink mode completes event-driven when last dot is consumed.

  useEffect(() => {
    if (!isVideoRecording) return;
    let raf = 0;
    let cancelled = false;
    const canvas = (blurCanvasRef.current ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const computeSharpness = (img: ImageData) => {
      // Metricas semplice: energia dei gradienti (più alta = più nitido, più bassa = blur).
      const d = img.data;
      let acc = 0;
      let n = 0;
      const w = img.width;
      const h = img.height;
      for (let y = 1; y < h - 1; y += 2) {
        for (let x = 1; x < w - 1; x += 2) {
          const i = (y * w + x) * 4;
          const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          const iR = (y * w + (x + 1)) * 4;
          const iD = ((y + 1) * w + x) * 4;
          const lumR = 0.2126 * d[iR] + 0.7152 * d[iR + 1] + 0.0722 * d[iR + 2];
          const lumD = 0.2126 * d[iD] + 0.7152 * d[iD + 1] + 0.0722 * d[iD + 2];
          acc += Math.abs(lum - lumR) + Math.abs(lum - lumD);
          n += 2;
        }
      }
      return n ? acc / n : 0;
    };

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      if (!v || v.videoWidth === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const targetW = 160;
      const targetH = Math.max(90, Math.round((targetW * v.videoHeight) / v.videoWidth));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      ctx.drawImage(v, 0, 0, targetW, targetH);
      const img = ctx.getImageData(0, 0, targetW, targetH);
      const sharp = computeSharpness(img);
      motionBlurScoreRef.current = sharp;

      const now = performance.now();
      const angle = typeof liveOrbitAngleDeg === "number" ? liveOrbitAngleDeg : null;
      let speedDegPerS = 0;
      if (angle != null && lastAngleDegRef.current != null && lastAngleTsRef.current > 0) {
        const dt = Math.max(1, now - lastAngleTsRef.current) / 1000;
        let da = angle - lastAngleDegRef.current;
        if (da > 180) da -= 360;
        if (da < -180) da += 360;
        speedDegPerS = Math.abs(da) / dt;
      }
      lastAngleDegRef.current = angle;
      lastAngleTsRef.current = now;

      // Soglia empirica: se stai girando troppo velocemente o la nitidezza scende, avvisa.
      const blurLikely = sharp < 10.5;
      const tooFast = speedDegPerS > 95;
      setShowMotionBlurWarning(blurLikely || tooFast);

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [isVideoRecording, liveOrbitAngleDeg]);

  /**
   * Feedback qualità foglio:
   * GREEN — 4 marker, geometria A4 ok, centratura + scala ok.
   * YELLOW — rilevamento parziale (1–3 marker) oppure 4 marker ma non centrato / scala / geometria.
   * RED — nessun marker, troppo vicino, o fuori range.
   */
  const sheetPoseOkForGreen = useMemo(() => {
    const t = alignment.tracking;
    if (t.confidence < SHEET_GUIDE_TRACKING_CONF_MIN) return false;
    if (alignment.guide === "too_close") return false;
    const dx = Math.abs(t.position.x - 0.5);
    const dy = Math.abs(t.position.y - 0.5);
    if (dx > SHEET_GUIDE_X_TOL || dy > SHEET_CENTER_TOL_Y) return false;
    const scale = t.scale;
    if (scale < A4_SHEET_TARGET_SCALE - SHEET_GUIDE_SCALE_TOL_LO) return false;
    if (scale > A4_SHEET_TARGET_SCALE + SHEET_GUIDE_SCALE_TOL_HI) return false;
    return true;
  }, [
    alignment.guide,
    alignment.tracking.confidence,
    alignment.tracking.position.x,
    alignment.tracking.position.y,
    alignment.tracking.scale,
  ]);

  const sheetDetectionState = useMemo<"red" | "yellow" | "green">(() => {
    const n = alignment.markerCount;
    if (n === 0 || alignment.guide === "too_close") return "red";

    if (n >= 4 && alignment.a4GeometryOk && sheetPoseOkForGreen) return "green";

    if (n >= 1 && n < 4) return "yellow";
    if (n >= 4) return "yellow";

    return "red";
  }, [alignment.markerCount, alignment.a4GeometryOk, alignment.guide, sheetPoseOkForGreen]);

  const sheetLocked = sheetDetectionState === "green";
  /** Poligono foglio: angoli esterni da ArUco (≥3 marker), altrimenti fallback slot/centroidi. */
  const sheetOverlayPoints = useMemo(() => {
    const fromQuads = sheetQuadCornersNormFromMarkerQuads(alignment.arucoMarkerQuadsNorm);
    if (fromQuads && fromQuads.length >= 3) return fromQuads;
    const slots = alignment.arucoSlotCentersNorm ?? [null, null, null, null];
    const slotPts = slots.filter((p): p is { x: number; y: number } => !!p);
    if (slotPts.length >= 3) return slotPts;
    return (alignment.markerCentersNorm ?? []).slice(0, 4);
  }, [alignment.arucoMarkerQuadsNorm, alignment.arucoSlotCentersNorm, alignment.markerCentersNorm]);
  const sheetReadyForCapture = sheetLocked;

  const sheetStatusText = useMemo(() => {
    if (sheetDetectionState === "green") return "Perfetto";
    if (sheetDetectionState === "red") return "Inquadra il foglio A4";
    // Dynamics over rigidity: if we see at least 1 marker, calibration is considered valid.
    // Keep prompts non-blocking.
    return "Centra il foglio";
  }, [sheetDetectionState, alignment.markerCount]);

  /** Confronto foglio rilevato vs bersaglio fisso (centro 0.5, scala target). */
  const sheetPositionGuidanceText = useMemo(() => {
    if (!scanOverlayEnabled) return null;
    if (sheetLocked) return null;
    const t = alignment.tracking;
    if (t.confidence < SHEET_GUIDE_TRACKING_CONF_MIN || alignment.markerCount < 2) return null;
    const dx = t.position.x - 0.5;
    const scale = t.scale;
    if (scale < A4_SHEET_TARGET_SCALE - SHEET_GUIDE_SCALE_TOL_LO) return "Avvicinati";
    // No blocking "allontanati" — we adapt safe zone instead.
    if (dx < -SHEET_GUIDE_X_TOL) return "Sposta a destra";
    if (dx > SHEET_GUIDE_X_TOL) return "Sposta a sinistra";
    return null;
  }, [
    scanOverlayEnabled,
    sheetLocked,
    alignment.markerCount,
    alignment.tracking.confidence,
    alignment.tracking.position.x,
    alignment.tracking.scale,
  ]);

  /** Foglio visto ma non centrato (scala ok): coach unificato. */
  const sheetNeedsCenteringCoach = useMemo(() => {
    if (!scanOverlayEnabled || sheetLocked) return false;
    if (alignment.markerCount < 2) return false;
    if (alignment.guide === "too_close") return false;
    const t = alignment.tracking;
    if (t.confidence < SHEET_GUIDE_TRACKING_CONF_MIN) return false;
    const dx = Math.abs(t.position.x - 0.5);
    const dy = Math.abs(t.position.y - 0.5);
    const scale = t.scale;
    const scaleOk =
      scale >= A4_SHEET_TARGET_SCALE - SHEET_GUIDE_SCALE_TOL_LO &&
      scale <= A4_SHEET_TARGET_SCALE + SHEET_GUIDE_SCALE_TOL_HI;
    if (!scaleOk) return false;
    return dx > SHEET_GUIDE_X_TOL || dy > SHEET_CENTER_TOL_Y;
  }, [
    scanOverlayEnabled,
    sheetLocked,
    alignment.markerCount,
    alignment.guide,
    alignment.tracking.confidence,
    alignment.tracking.position.x,
    alignment.tracking.position.y,
    alignment.tracking.scale,
  ]);

  const footBBox = alignment.footBBoxNorm;
  const rawFootDetected = !!footBBox;
  const footShapeSamplesRef = useRef<{ area: number; aspect: number }[]>([]);
  const [footShapeConsistent, setFootShapeConsistent] = useState(false);
  const footInsideFrameFrac = useMemo(() => {
    if (!footBBox) return 0;
    const x0 = Math.max(0, footBBox.x);
    const y0 = Math.max(0, footBBox.y);
    const x1 = Math.min(1, footBBox.x + footBBox.w);
    const y1 = Math.min(1, footBBox.y + footBBox.h);
    const iw = Math.max(0, x1 - x0);
    const ih = Math.max(0, y1 - y0);
    const inter = iw * ih;
    const area = Math.max(1e-6, footBBox.w * footBBox.h);
    return inter / area;
  }, [footBBox]);
  const footMostlyInsideFrame = footInsideFrameFrac >= FOOT_INSIDE_FRAME_MIN_FRAC;

  useEffect(() => {
    if (cameraState !== "readyPhase") {
      footShapeSamplesRef.current = [];
      setFootShapeConsistent(false);
      return;
    }
    if (!footBBox) {
      footShapeSamplesRef.current = [];
      setFootShapeConsistent(false);
      return;
    }

    const area = footBBox.w * footBBox.h;
    const aspect = footBBox.w / Math.max(footBBox.h, 1e-6);
    const buf = footShapeSamplesRef.current;
    buf.push({ area, aspect });
    while (buf.length > FOOT_SHAPE_WINDOW) buf.shift();

    if (buf.length < 4) {
      setFootShapeConsistent(false);
      return;
    }

    let minArea = Infinity;
    let maxArea = -Infinity;
    let minAspect = Infinity;
    let maxAspect = -Infinity;
    for (const s of buf) {
      minArea = Math.min(minArea, s.area);
      maxArea = Math.max(maxArea, s.area);
      minAspect = Math.min(minAspect, s.aspect);
      maxAspect = Math.max(maxAspect, s.aspect);
    }

    setFootShapeConsistent(
      maxArea - minArea <= FOOT_SHAPE_AREA_TOL && maxAspect - minAspect <= FOOT_SHAPE_ASPECT_TOL
    );
  }, [cameraState, phaseIndex, currentFoot, footBBox]);

  /** Piede interamente nel frame (margine) — solo guida testuale. */
  const footFullyVisible = useMemo(() => {
    if (!footBBox) return false;
    return (
      footBBox.x >= 0.028 &&
      footBBox.y >= 0.028 &&
      footBBox.x + footBBox.w <= 0.972 &&
      footBBox.y + footBBox.h <= 0.972
    );
  }, [footBBox]);

  /** Gate cattura: piede visto + ≥70% in frame (niente ArUco / allineamento obbligatori). */
  const footCenterDistance = useMemo(() => {
    if (!footBBox) return Infinity;
    const cx = footBBox.x + footBBox.w * 0.5;
    const cy = footBBox.y + footBBox.h * 0.5;
    return Math.hypot(cx - 0.5, cy - 0.5);
  }, [footBBox]);
  const sheetCenter = useMemo(() => {
    const m = alignment.markerCentersNorm;
    if (!m || m.length < 2) return { x: 0.5, y: 0.5 };
    const sx = m.reduce((acc, p) => acc + p.x, 0) / m.length;
    const sy = m.reduce((acc, p) => acc + p.y, 0) / m.length;
    return { x: sx, y: sy };
  }, [alignment.markerCentersNorm]);
  const largeCenteredObjectOk = useMemo(() => {
    if (!footBBox) return false;
    const area = footBBox.w * footBBox.h;
    return area >= FOOT_MIN_BBOX_AREA;
  }, [footBBox]);
  const objectCenteredOnSheetOk = useMemo(() => {
    if (!footBBox) return false;
    const cx = footBBox.x + footBBox.w * 0.5;
    const cy = footBBox.y + footBBox.h * 0.5;
    return Math.hypot(cx - sheetCenter.x, cy - sheetCenter.y) <= FOOT_CENTER_MAX_DISTANCE;
  }, [footBBox, sheetCenter.x, sheetCenter.y]);

  /** Bbox piede vs poligono foglio (ArUco): ≥ ~18% area bbox sul foglio. */
  const footOverlapFractionOnSheet = useMemo(() => {
    if (!footBBox) return 0;
    if (sheetOverlayPoints.length < 3) return 0;
    return estimateFootBBoxOverlapFractionOnPolygon(footBBox, sheetOverlayPoints);
  }, [footBBox, sheetOverlayPoints]);

  const footOnSheetOk = footOverlapFractionOnSheet >= FOOT_ON_SHEET_MIN_OVERLAP;

  /**
   * Regola cattura (minimo): foglio OK + piede sul foglio + movimento camera.
   * Senza questi tre → nessuno scatto (burst), anche se altri sotto-check passano.
   */
  const scanTripleGateOk = sheetLocked && footOnSheetOk && cameraMotionGateOk;

  const a4MarkersOk = alignment.markerCount >= 2;
  const scanConditionsOk =
    scanTripleGateOk &&
    a4MarkersOk &&
    rawFootDetected &&
    largeCenteredObjectOk &&
    objectCenteredOnSheetOk &&
    footShapeConsistent;

  const footDetected = scanConditionsOk;
  /** Ultimo frame React: usato nella cattura continua per filtrare i frame. */
  const scanConditionsOkRef = useRef(scanConditionsOk);
  scanConditionsOkRef.current = scanConditionsOk;

  const footFrameOk = footDetected && footMostlyInsideFrame;
  const rawScanValid = footFrameOk;

  const footMotionBufRef = useRef<{ cx: number; cy: number }[]>([]);
  const footStableSinceRef = useRef<number | null>(null);
  const footMotionContextRef = useRef<string>("");
  const [captureStableReady, setCaptureStableReady] = useState(false);

  useEffect(() => {
    const active = cameraState === "readyPhase";
    if (!active) {
      footMotionBufRef.current = [];
      footStableSinceRef.current = null;
      setScanValidationReady(false);
      setCaptureStableReady(false);
      return;
    }
    const ctx = `${currentFoot}:${phaseIndex}`;
    if (footMotionContextRef.current !== ctx) {
      footMotionContextRef.current = ctx;
      footMotionBufRef.current = [];
      footStableSinceRef.current = null;
    }
    if (!footBBox || !footFrameOk) {
      footMotionBufRef.current = [];
      footStableSinceRef.current = null;
      setScanValidationReady(false);
      setCaptureStableReady(false);
      return;
    }

    const cx = footBBox.x + footBBox.w * 0.5;
    const cy = footBBox.y + footBBox.h * 0.5;
    footMotionBufRef.current.push({ cx, cy });
    while (footMotionBufRef.current.length > FOOT_MOTION_WINDOW) {
      footMotionBufRef.current.shift();
    }

    const buf = footMotionBufRef.current;
    const now = performance.now();
    let motionOk = false;
    if (buf.length >= FOOT_MOTION_WINDOW) {
      let maxStep = 0;
      for (let i = 1; i < buf.length; i++) {
        maxStep = Math.max(maxStep, Math.hypot(buf[i].cx - buf[i - 1].cx, buf[i].cy - buf[i - 1].cy));
      }
      motionOk = maxStep <= FOOT_MOTION_MAX_STEP;
    }

    const instantOk = motionOk && buf.length >= FOOT_MOTION_WINDOW;
    setScanValidationReady(instantOk);

    if (!instantOk) {
      footStableSinceRef.current = null;
      setCaptureStableReady(false);
      return;
    }
    if (footStableSinceRef.current === null) footStableSinceRef.current = now;
    setCaptureStableReady(now - footStableSinceRef.current >= CAPTURE_STABLE_MS);
  }, [cameraState, currentFoot, phaseIndex, footBBox, footFrameOk]);

  /** Geometria piede “quasi pronta” (movimento contenuto); 500ms = captureStableReady. */
  const geometryReady = scanValidationReady;
  const phaseCompleteThis = pathZonesComplete[phaseIndex];
  /** Pronto per burst: fase incompleta + piede stabile 500ms. */
  const captureReadyNormal = !phaseCompleteThis && captureStableReady;
  /** Overlay verde: stabile oppure failsafe 2s (mai bloccato). */
  const captureImminentGreen =
    !phaseCompleteThis && (captureStableReady || captureFallbackArmed);
  /** Direzione camera stimata da tilt Y/Z; usata per filtrare scatti dallo stesso angolo. */
  const currentDirectionDeg = useMemo(
    () => orbitAngleDegFromTilt(frameTilt.rotateY, frameTilt.rotateZ),
    [frameTilt.rotateY, frameTilt.rotateZ]
  );
  const directionChangedEnough = useMemo(() => {
    if (currentDirectionDeg == null) return true;
    const prev = lastCaptureDirectionRef.current;
    if (prev == null) return true;
    return angularDistanceDeg(currentDirectionDeg, prev) >= CAMERA_DIRECTION_MIN_DELTA_DEG;
  }, [currentDirectionDeg]);

  /** Cattura silenziosa: movimento camera, foglio+piede validi, angolo nuovo vs ultimo salvato. */
  const continuousCaptureAllowed = useMemo(() => {
    if (cameraState !== "readyPhase") return false;
    if (phaseCompleteThis) return false;
    if (!footDetected) return false;
    if (!cameraMotionGateOk) return false;
    if (!sheetLocked) return false;
    if (!directionChangedEnough) return false;
    return true;
  }, [
    cameraState,
    phaseCompleteThis,
    footDetected,
    cameraMotionGateOk,
    sheetLocked,
    directionChangedEnough,
  ]);

  useEffect(() => {
    continuousCaptureAllowedRef.current = continuousCaptureAllowed;
  }, [continuousCaptureAllowed]);

  useEffect(() => {
    currentDirectionDegRef.current = currentDirectionDeg;
  }, [currentDirectionDeg]);

  const captureReadiness = useMemo((): "red" | "yellow" | "green" | null => {
    if (!scanOverlayEnabled) return null;
    if (cameraState !== "readyPhase") return null;
    if (!footDetected || !footMostlyInsideFrame) return "red";
    if (captureImminentGreen) return "green";
    return "yellow";
  }, [scanOverlayEnabled, cameraState, footDetected, footMostlyInsideFrame, captureImminentGreen]);

  const sheetOkForAutoStart = useMemo(() => {
    // For A4 real-world rotation: don't require 4 markers constantly.
    // We only need at least one marker seen and not "too close".
    if (cameraState !== "readyPhase") return false;
    if ((alignment.markerCount ?? 0) < 1) return false;
    const quads = alignment.arucoMarkerQuadsNorm ?? [];
    for (const q of quads) {
      const cs = (q.corners ?? []).slice(0, 4);
      if (cs.length < 4) continue;
      let minY = 1;
      let maxY = 0;
      for (const p of cs) {
        if (!Number.isFinite(p.y)) continue;
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const heightFrac = Math.max(0, Math.min(1, maxY - minY));
      if (heightFrac > 0.5) return false;
    }
    return true;
  }, [alignment.arucoMarkerQuadsNorm, alignment.markerCount, cameraState]);

  // ── Starlink dot cloud: generate + consume in RAF, anchored to ArUco tracking ──
  useEffect(() => {
    if (!STARLINK_DOT_CLOUD_MODE) return;
    if (cameraState !== "readyPhase") return;
    if (!scanStarted) return;

    // (Re)generate when entering readyPhase or switching foot.
    const seed = Date.now() % 1_000_000;
    const rnd = (n: number) => {
      // cheap deterministic pseudo-rng
      const x = Math.sin((seed + n) * 12_989.23) * 43758.5453;
      return x - Math.floor(x);
    };

    // Dome points: spherical Fibonacci distribution on a spherical cap.
    // Sphere radius R=30cm, cap height h=20cm above ground plane y=0.
    // Sphere center is below ground by d=R-h => 10cm; y = -d + R*cos(theta) with theta in [0, thetaMax].
    const R = DOME_RADIUS_CM;
    const h = DOME_HEIGHT_CM;
    const d = Math.max(0.001, R - h);
    const cosThetaMax = Math.max(-1, Math.min(1, d / R)); // y=0 => cos(theta)=d/R
    const golden = Math.PI * (3 - Math.sqrt(5));
    const dots: { id: number; yaw: number; pitch: number; consumed: boolean; pop: number }[] = [];
    for (let i = 0; i < DOT_CLOUD_COUNT; i++) {
      const u = (i + 0.5) / DOT_CLOUD_COUNT;
      // Uniform area on cap: cos(theta) uniform between [1 .. cosThetaMax]
      const cosT = 1 - u * (1 - cosThetaMax);
      const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
      const phi = (i * golden) % (Math.PI * 2);

      // Convert to dome-local yaw/pitch for later collision/projection:
      // yaw = phi (around y), pitch = arcsin(yNormalized)
      const yNorm = Math.cos(theta); // 0..1
      const pitch = Math.asin(Math.max(0, Math.min(1, yNorm))); // 0..pi/2
      dots.push({ id: i, yaw: phi, pitch, consumed: false, pop: 0 });
    }
    dotCloudRef.current = dots;
    dotCloudConsumedRef.current = 0;
    dotCloudStartedRef.current = false;
    dotCloudDoneRef.current = false;
    setDotCloudProgressPct(0);
    domeFadeStartAtRef.current = 0;
    domeOpacityRef.current = 0;
    domeCenterSmoothedRef.current = null;

    let raf = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      const box = videoContainerRef.current;
      if (!v || !box || v.videoWidth === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const canvas = dotCloudCanvasRef.current;
      const ctx = canvas?.getContext?.("2d") ?? null;

      const now = performance.now();
      const hasAruco = (alignment.markerCount ?? 0) >= 1;
      if (hasAruco) lastArucoSeenAtRef.current = now;
      const arucoRecent = hasAruco || now - lastArucoSeenAtRef.current < 900;
      if (hasAruco && domeFadeStartAtRef.current === 0) domeFadeStartAtRef.current = now;
      const fadeT =
        domeFadeStartAtRef.current > 0 ? Math.min(1, (now - domeFadeStartAtRef.current) / 1000) : 0;
      // Smoothstep for Apple-like fade
      domeOpacityRef.current = fadeT * fadeT * (3 - 2 * fadeT);

      // WORLD ANCHOR: center from visible ArUco points (corners preferred, else marker centers, else tracking position).
      const pts: { x: number; y: number }[] = [];
      const quads = alignment.arucoMarkerQuadsNorm ?? [];
      for (const q of quads) {
        const cs = (q.corners ?? []).slice(0, 4);
        for (const p of cs) {
          if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push({ x: p.x, y: p.y });
        }
      }
      const centers = alignment.markerCentersNorm ?? [];
      for (const c of centers) {
        if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) pts.push({ x: c.x, y: c.y });
      }
      const tp = alignment.tracking?.position;
      if (pts.length === 0 && tp && Number.isFinite(tp.x) && Number.isFinite(tp.y)) pts.push({ x: tp.x, y: tp.y });
      const rawAnchorNormX = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : 0.5;
      const rawAnchorNormY = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : 0.52;

      // Scale by tracking.scale (elastic). Clamp for stability.
      const s = alignment.tracking?.scale;
      const scale = typeof s === "number" && Number.isFinite(s) ? Math.max(0.22, Math.min(0.78, s)) : 0.42;

      // Map anchor to container px (object-fit cover aware).
      const rect = box.getBoundingClientRect();
      if (ctx && canvas) {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const targetW = Math.round(rect.width * dpr);
        const targetH = Math.round(rect.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
          canvas.style.width = `${rect.width}px`;
          canvas.style.height = `${rect.height}px`;
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(dpr, dpr);
      }
      const { leftPct, topPct } = normalizedVideoToContainerPercent(
        rawAnchorNormX,
        rawAnchorNormY,
        v.videoWidth,
        v.videoHeight,
        rect.width,
        rect.height
      );
      const anchorPxRawX = (leftPct / 100) * rect.width;
      const anchorPxRawY = (topPct / 100) * rect.height;

      // Jitter reduction: smooth anchor + scale.
      const prev = domeCenterSmoothedRef.current;
      const kLerp = 0.14; // stable even with fast arm motion
      const sm = prev
        ? {
            x: prev.x + (anchorPxRawX - prev.x) * kLerp,
            y: prev.y + (anchorPxRawY - prev.y) * kLerp,
            scale: prev.scale + (scale - prev.scale) * kLerp,
          }
        : { x: anchorPxRawX, y: anchorPxRawY, scale };
      domeCenterSmoothedRef.current = sm;
      const anchorPxX = sm.x;
      const anchorPxY = sm.y;
      const scaleSmooth = sm.scale;

      // Reticle is always screen center.
      const retX = rect.width * 0.5;
      const retY = rect.height * 0.5;
      // Much more forgiving: user should "sweep" points effortlessly.
      // Kept for reticle drawing only (collision is angular in 3D).
      const hitRadiusPx = Math.max(40, Math.min(76, rect.width * 0.14));

      let consumedThisFrame = false;
      if (ctx) {
        // Reticle (Starlink-like)
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.beginPath();
        ctx.arc(retX, retY, hitRadiusPx * 0.58, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.arc(retX, retY, hitRadiusPx * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        ctx.beginPath();
        ctx.arc(retX, retY, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // FADE-IN: before ArUco is detected, keep UI minimal (reticle only).
      // After detection, dome appears over 1s.
      if (ctx && domeOpacityRef.current > 0) {
        ctx.globalAlpha = domeOpacityRef.current;
      }

      // Dome hint: thin meridians/parallels (very subtle).
      if (ctx) {
        ctx.save();
        ctx.globalAlpha = 0.22 * domeOpacityRef.current;
        ctx.strokeStyle = "rgba(34,211,238,0.18)";
        ctx.lineWidth = 1;
        const meridians = 6;
        const parallels = 4;
        const project = (yaw0: number, pitch0: number) => {
          const vx = Math.cos(pitch0) * Math.cos(yaw0);
          const vy = Math.sin(pitch0);
          const vz = Math.cos(pitch0) * Math.sin(yaw0);
          const right = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
          const up = {
            x: -Math.sin(pitch) * Math.cos(yaw),
            y: Math.cos(pitch),
            z: -Math.sin(pitch) * Math.sin(yaw),
          };
          const sx = vx * right.x + vy * right.y + vz * right.z;
          const sy = vx * up.x + vy * up.y + vz * up.z;
          const sz = vx * fwd.x + vy * fwd.y + vz * fwd.z;
          const k = sz <= 0.05 ? 0.05 : sz;
          return {
            x: anchorPxX + (sx / k) * domeRadiusPx * fov,
            y: anchorPxY - (sy / k) * domeRadiusPx * fov,
          };
        };
        // Parallels (constant pitch)
        for (let j = 1; j <= parallels; j++) {
          const p0 = ((j / (parallels + 1)) * 0.9) * (Math.PI / 2);
          ctx.beginPath();
          for (let k = 0; k <= 40; k++) {
            const t = k / 40;
            const y0 = (150 * Math.PI) / 180 + t * (210 * Math.PI) / 180;
            const pt = project(y0, p0);
            if (k === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();
        }
        // Meridians (constant yaw)
        for (let i = 0; i < meridians; i++) {
          const t = i / Math.max(1, meridians - 1);
          const y0 = (150 + t * 210) * (Math.PI / 180);
          ctx.beginPath();
          for (let k = 0; k <= 28; k++) {
            const s = k / 28;
            const p0 = s * (Math.PI / 2) * 0.95;
            const pt = project(y0, p0);
            if (k === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // If no ArUco, keep drawing reticle only (do not consume points).
      if (!arucoRecent) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // "3D collision": compute phone view direction from tilt (yaw around arc + pitch up/down).
      const yawDeg = orbitAngleDegFromTilt(frameTilt.rotateY, frameTilt.rotateZ) ?? 0;
      const yaw = (yawDeg * Math.PI) / 180;
      // rotateX: positive => phone too low (tilting down). We want pitch up/down around foot.
      const pitch = (-frameTilt.rotateX * Math.PI) / 180;

      // Forward direction in dome-local coords (y up).
      const fwd = {
        x: Math.cos(pitch) * Math.cos(yaw),
        y: Math.sin(pitch),
        z: Math.cos(pitch) * Math.sin(yaw),
      };

      // Visual projection for hints (simple perspective).
      const fov = 0.9; // radians-ish factor, tuned for "AR dome" feel
      // Map physical dome radius (30cm) onto screen using tracking scale (relative to A4).
      // A4 width ~21cm; dome radius 30cm => 1.43× A4 width in world.
      const domeRadiusPx = rect.width * (0.34 * scaleSmooth) * (DOME_RADIUS_CM / 21);

      for (const d of dotCloudRef.current) {
        // Pop animation decay
        if (d.pop > 0) d.pop = Math.max(0, d.pop - 0.06);

        // Dot direction vector on hemisphere (yaw around, pitch up).
        const vx = Math.cos(d.pitch) * Math.cos(d.yaw);
        const vy = Math.sin(d.pitch);
        const vz = Math.cos(d.pitch) * Math.sin(d.yaw);

        // Angle-to-forward controls collision (easy hit).
        const dotp = vx * fwd.x + vy * fwd.y + vz * fwd.z;
        const ang = Math.acos(Math.max(-1, Math.min(1, dotp)));

        // Project to screen for visual hint (approx): map relative to forward onto plane.
        // Build a simple camera basis from yaw/pitch (no roll).
        const right = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
        const up = {
          x: -Math.sin(pitch) * Math.cos(yaw),
          y: Math.cos(pitch),
          z: -Math.sin(pitch) * Math.sin(yaw),
        };
        const rel = { x: vx, y: vy, z: vz };
        const sx = rel.x * right.x + rel.y * right.y + rel.z * right.z;
        const sy = rel.x * up.x + rel.y * up.y + rel.z * up.z;
        const sz = rel.x * fwd.x + rel.y * fwd.y + rel.z * fwd.z;

        // If behind the view, clamp offscreen.
        const k = sz <= 0.05 ? 0.05 : sz;
        const px = anchorPxX + (sx / k) * domeRadiusPx * fov;
        const py = anchorPxY - (sy / k) * domeRadiusPx * fov;

        // Occlusion hint: darker when "behind" (low sz).
        const depth = Math.max(0, Math.min(1, (sz + 0.25) / 1.25));
        const baseSize = 4.2 + (1 - depth) * 0.9;

        if (ctx) {
          if (d.consumed) {
            if (d.pop > 0) {
              const k = d.pop;
              ctx.globalAlpha = 0.65 * k;
              ctx.strokeStyle = "rgba(34,211,238,0.95)";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(px, py, baseSize + (1 - k) * 18, 0, Math.PI * 2);
              ctx.stroke();
              ctx.globalAlpha = 0.22 * k;
              ctx.fillStyle = "rgba(34,211,238,0.95)";
              ctx.beginPath();
              ctx.arc(px, py, Math.max(0.5, baseSize * k), 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            }
          } else {
            ctx.globalAlpha = (0.55 + depth * 0.18) * domeOpacityRef.current;
            ctx.fillStyle = depth < 0.35 ? "rgba(34,211,238,0.52)" : "rgba(34,211,238,0.86)";
            ctx.shadowColor = "rgba(34,211,238,0.40)";
            ctx.shadowBlur = 10 + depth * 6;
            ctx.beginPath();
            ctx.arc(px, py, baseSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
          }
        }

        if (d.consumed) continue;
        // 3D hit: within angular threshold (elastic).
        const hit = ang <= (12 * Math.PI) / 180;
        if (hit) {
          d.consumed = true;
          d.pop = 1;
          consumedThisFrame = true;
          dotCloudConsumedRef.current += 1;
          {
            const pct = Math.round((dotCloudConsumedRef.current / DOT_CLOUD_COUNT) * 100);
            dotCloudProgressRef.current = pct;
            // keep React state for non-debug UI at low frequency only
            if (pct === 0 || pct === 100 || Math.abs(pct - dotCloudProgressPct) >= 10) {
              setDotCloudProgressPct(pct);
            }
          }
          if ("vibrate" in navigator) navigator.vibrate(10);

          // Start video on first consumed dot.
          if (!dotCloudStartedRef.current) {
            dotCloudStartedRef.current = true;
            startVideoRecording();
          }

          // Stop when last dot consumed.
          if (dotCloudConsumedRef.current >= DOT_CLOUD_COUNT) {
            setDotCloudSuccessFlash(true);
            void stopAndUploadDotCloud();
          }
          break; // one dot per frame max
        }
      }

      // Light decay pop for consumed dots (visual only).
      if (!consumedThisFrame) {
        // no-op
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cameraState,
    currentFoot,
    scanStarted,
    frameTilt.rotateY,
    frameTilt.rotateZ,
    alignment.tracking,
    alignment.tracking?.position,
    alignment.tracking?.scale,
    startVideoRecording,
    stopAndUploadDotCloud,
  ]);

  // Auto-start: begin recording only after 1.5s of stable alignment (sheet + foot + stable phone).
  useEffect(() => {
    if (STARLINK_DOT_CLOUD_MODE) return;
    const stable =
      cameraState === "readyPhase" &&
      captureReadiness === "green" &&
      footDetected &&
      sheetOkForAutoStart &&
      cameraMotionGateOk &&
      sensorsUnlocked &&
      !isVideoRecording;

    if (!stable) {
      if (stableTimerRef.current) {
        clearInterval(stableTimerRef.current);
        stableTimerRef.current = null;
      }
      setStabilityPct(0);
      return;
    }

    if (stableTimerRef.current) return; // already counting down

    stableStartRef.current = performance.now();
    stableTimerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - stableStartRef.current;
      const pct = Math.min(100, (elapsed / 500) * 100);
      setStabilityPct(pct);
      if (pct >= 100) {
        clearInterval(stableTimerRef.current!);
        stableTimerRef.current = null;
        setStabilityPct(0);
        // Starlink mode: start on first dot consumed, not on stability.
        if (!STARLINK_DOT_CLOUD_MODE) startVideoRecording();
      }
    }, 80);

    return () => {
      if (stableTimerRef.current) {
        clearInterval(stableTimerRef.current);
        stableTimerRef.current = null;
      }
    };
  }, [
    cameraMotionGateOk,
    cameraState,
    captureReadiness,
    footDetected,
    isVideoRecording,
    sensorsUnlocked,
    sheetOkForAutoStart,
    startVideoRecording,
  ]);
  const sheetTooFar =
    alignment.tracking.confidence >= 0.12 && alignment.tracking.scale < A4_TRACKING_SCALE_MIN;

  const { tooSlow, tooFast } = useScanGuidance({
    cameraState,
    frameTilt,
    footCentroid: alignment.footCentroidNorm,
    currentFoot,
    captureReady: captureImminentGreen,
    geometryReady,
    angleViewReady: captureStableReady || captureFallbackArmed,
    rawScanValid,
    footDetected,
    footFullyVisible: footFullyVisible || footMostlyInsideFrame,
    footSizeOk: true,
    sheetFullyFramed: true,
    sheetTooClose: alignment.guide === "too_close",
    sheetTooFar,
    arucoEngine: alignment.arucoEngine === "error" ? "fallback" : alignment.arucoEngine,
    zonesComplete: pathZonesComplete,
    footInsideA4: footOnSheetOk,
    fallbackCaptureMessaging: captureFallbackArmed,
    continuousScanMode: true,
  });

  const beginnerNudgeActive = !STARLINK_DOT_CLOUD_MODE && tooSlow && !footScanCoverageComplete;

  /** Next uncaptured bin clockwise from current angle — drives the guide orb. */
  const nextMissingBin = useMemo(() => {
    if (!beginnerNudgeActive || footScanCoverageComplete) return null;
    const total = orbitBinsTarget;
    const currentBin =
      liveOrbitAngleDeg != null
        ? Math.floor(((((liveOrbitAngleDeg % 360) + 360) % 360) / 360) * total)
        : 0;
    for (let i = 0; i < total; i++) {
      const bin = (currentBin + i) % total;
      if (!footScanCoverageBins.has(bin)) return bin;
    }
    return null;
  }, [beginnerNudgeActive, footScanCoverageComplete, orbitBinsTarget, liveOrbitAngleDeg, footScanCoverageBins]);

  /** Dynamics over rigidity: never block user with distance warnings. */
  const sheetDistanceWarning = null as "too_close" | "too_far" | null;

  /** Marker size (0–1 of frame height). Used to adapt "safe zone" dynamically (non-blocking). */
  const markerHeightFrac = useMemo(() => {
    const quads = alignment.arucoMarkerQuadsNorm ?? [];
    let best = 0;
    for (const q of quads) {
      const cs = (q.corners ?? []).slice(0, 4);
      if (cs.length < 4) continue;
      let minY = 1;
      let maxY = 0;
      for (const p of cs) {
        if (!Number.isFinite(p.y)) continue;
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const h = Math.max(0, Math.min(1, maxY - minY));
      best = Math.max(best, h);
    }
    return best;
  }, [alignment.arucoMarkerQuadsNorm]);

  /** UX premium: feedback binario (verde=ok, rosso=correggi) */
  const scanBinaryOk = useMemo(() => captureReadiness === "green", [captureReadiness]);

  /** Prompt minimale (utente segue visual, non testo) */
  const scanPrimaryPrompt = useMemo((): "Inquadra il foglio" | "Metti il piede" | "Muoviti intorno" => {
    if (cameraState !== "readyPhase") return "Inquadra il foglio";
    if (!sheetLocked) return "Inquadra il foglio";
    if (!footDetected) return "Metti il piede";
    return "Muoviti intorno";
  }, [cameraState, sheetLocked, footDetected]);

  /** Colore freccia guida movimento (sempre visibile durante la scansione attiva). */
  const moveGuideArrowStroke = useMemo(() => {
    return scanBinaryOk ? "rgba(52,211,153,0.96)" : "rgba(248,113,113,0.9)";
  }, [scanBinaryOk]);

  /**
   * Coach in tempo reale: priorità fissa (foglio → velocità → inclinazione → centratura → movimento).
   */
  const scanMovementGuidance = useMemo((): {
    text: string;
    kind: "sheet" | "motion" | "tilt" | "speed" | "center";
  } | null => {
    if (cameraState !== "readyPhase") return null;
    if (alignment.markerCount === 0) return { text: "Inquadra il foglio", kind: "sheet" };
    if (tooFast) return { text: "Vai più lento", kind: "speed" };
    const tiltExcessive =
      Math.abs(frameTilt.rotateX) > SCAN_GUIDE_TILT_X_ABS_MAX ||
      Math.abs(frameTilt.rotateZ) > SCAN_GUIDE_TILT_Z_ABS_MAX;
    if (tiltExcessive) return { text: "Inclina meno", kind: "tilt" };
    if (sheetNeedsCenteringCoach) return { text: "Centra il foglio", kind: "center" };
    if (showNoMovementWarning) return { text: "Muoviti intorno", kind: "motion" };
    return null;
  }, [
    cameraState,
    alignment.markerCount,
    tooFast,
    frameTilt.rotateX,
    frameTilt.rotateZ,
    sheetNeedsCenteringCoach,
    showNoMovementWarning,
  ]);

  /**
   * Un solo messaggio istantaneo quando non sei in verde: priorità allineata al coach,
   * poi gate scansione (foglio / piede / movimento / inquadratura).
   */
  const scanInstantCorrection = useMemo((): string | null => {
    if (!scanOverlayEnabled || cameraState !== "readyPhase") return null;
    if (captureReadiness === "green") return null;
    if (scanMovementGuidance) return scanMovementGuidance.text;
    if (!a4MarkersOk || !sheetLocked) return "Inquadra il foglio";
    if (sheetNeedsCenteringCoach) return "Centra il foglio";
    if (!cameraMotionGateOk) return "Muoviti intorno";
    if (!footOnSheetOk || !rawFootDetected) return "Metti il piede sul foglio";
    if (!largeCenteredObjectOk || !objectCenteredOnSheetOk || !footShapeConsistent)
      return "Metti il piede sul foglio";
    if (!footMostlyInsideFrame) return "Inquadra tutto il piede";
    return "Tieni fermo il piede";
  }, [
    scanOverlayEnabled,
    cameraState,
    captureReadiness,
    scanMovementGuidance,
    a4MarkersOk,
    sheetLocked,
    sheetNeedsCenteringCoach,
    cameraMotionGateOk,
    footOnSheetOk,
    rawFootDetected,
    largeCenteredObjectOk,
    objectCenteredOnSheetOk,
    footShapeConsistent,
    footMostlyInsideFrame,
  ]);

  /** Vignetta full-frame: verde = OK istantaneo, ambra = quasi, rosso = correggi. */
  const scanFeedbackOverlayBackground = useMemo(() => {
    if (STARLINK_DOT_CLOUD_MODE) return "transparent";
    if (!scanOverlayEnabled) return "transparent";
    const base =
      "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 22%, rgba(0,0,0,0.10) 65%, rgba(0,0,0,0.20) 100%)";
    if (scanBinaryOk) {
      return `${base}, radial-gradient(circle at 50% 48%, rgba(52,211,153,0.10) 0%, transparent 52%)`;
    }
    return base;
  }, [scanOverlayEnabled, scanBinaryOk]);

  const scanFeedbackOverlayShadow = useMemo(() => {
    if (STARLINK_DOT_CLOUD_MODE) return undefined;
    if (!scanOverlayEnabled || !scanBinaryOk) return undefined;
    return "inset 0 0 80px rgba(52,211,153,0.10)";
  }, [scanOverlayEnabled, scanBinaryOk]);

  const reconPhotosPerPhase = useMemo(() => {
    if (typeof navigator === "undefined") return RECON_PHOTOS_PER_PHASE_DEFAULT;
    const perf = getThreePerformanceProfile();
    if (perf.isMobileOrLowTier) {
      return RECON_PHOTOS_PER_PHASE_MOBILE;
    }
    const cores = navigator.hardwareConcurrency ?? 4;
    const maybeMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    return cores >= 6 && maybeMem >= 4
      ? RECON_PHOTOS_PER_PHASE_FAST
      : RECON_PHOTOS_PER_PHASE_DEFAULT;
  }, []);

  // Suggerisce la fase interna in base alla vista (non blocca la cattura).
  useEffect(() => {
    if (cameraState !== "readyPhase") return;

    const z = alignment.detectedFootViewZone;
    if (!z) return;

    const nextPid = FOOT_VIEW_ZONE_TO_PHASE[z];
    if (pathZonesComplete[nextPid]) return;
    if (phaseIndex === nextPid) return;

    setPhaseIndex(nextPid);
  }, [cameraState, alignment.detectedFootViewZone, pathZonesComplete, phaseIndex]);

  // Fallback: nessun burst entro 2s con gate normale → verde coach solo se foglio+piede+movimento OK.
  useEffect(() => {
    if (captureFallbackTimeoutRef.current) {
      window.clearTimeout(captureFallbackTimeoutRef.current);
      captureFallbackTimeoutRef.current = null;
    }

    if (cameraState !== "readyPhase" || phaseCompleteThis) {
      setCaptureFallbackArmed(false);
      return;
    }

    if (!scanTripleGateOk) {
      setCaptureFallbackArmed(false);
      return;
    }

    if (captureReadyNormal) {
      setCaptureFallbackArmed(false);
      return;
    }

    captureFallbackTimeoutRef.current = window.setTimeout(() => {
      captureFallbackTimeoutRef.current = null;
      setCaptureFallbackArmed(true);
    }, CAPTURE_FALLBACK_AFTER_MS);

    return () => {
      if (captureFallbackTimeoutRef.current) {
        window.clearTimeout(captureFallbackTimeoutRef.current);
        captureFallbackTimeoutRef.current = null;
      }
    };
  }, [cameraState, phaseIndex, currentFoot, phaseCompleteThis, captureReadyNormal, scanTripleGateOk]);

  // Ritardo breve in stato “verde” prima di far partire il burst (cattura automatica).
  useEffect(() => {
    const clearGreenTimer = () => {
      if (greenDelayTimerRef.current) {
        window.clearTimeout(greenDelayTimerRef.current);
        greenDelayTimerRef.current = null;
      }
    };

    if (cameraState !== "readyPhase" || phaseCompleteThis) {
      clearGreenTimer();
      setGreenDelayArmed(false);
      return;
    }

    if (!captureImminentGreen) {
      clearGreenTimer();
      setGreenDelayArmed(false);
      return;
    }

    if (greenDelayArmed) return;
    if (greenDelayTimerRef.current != null) return;

    greenDelayTimerRef.current = window.setTimeout(() => {
      greenDelayTimerRef.current = null;
      setGreenDelayArmed(true);
    }, CAPTURE_GREEN_DELAY_MS);

    return () => {
      clearGreenTimer();
    };
  }, [cameraState, phaseIndex, phaseCompleteThis, captureImminentGreen, greenDelayArmed]);

  // Movimento camera: confronto luminanza frame precedente vs corrente (thumbnail).
  useEffect(() => {
    if (cameraState !== "readyPhase") {
      cameraMotionPrevLumRef.current = null;
      cameraMotionAccumMsRef.current = 0;
      cameraMotionLastSampleAtRef.current = 0;
      cameraMotionLastDetectedAtRef.current = 0;
      cameraMotionLastBuzzAtRef.current = 0;
      if (cameraState === "idle" || cameraState === "starting") {
        lastCaptureDirectionRef.current = null;
      }
      setCameraMotionGateOk(false);
      setCameraMotionRingProgress(0);
      setShowNoMovementWarning(false);
      return;
    }

    let raf = 0;
    let cancelled = false;

    if (!cameraMotionCanvasRef.current) {
      cameraMotionCanvasRef.current = document.createElement("canvas");
      cameraMotionCanvasRef.current.width = CAMERA_MOTION_SAMPLE_W;
      cameraMotionCanvasRef.current.height = CAMERA_MOTION_SAMPLE_H;
    }
    const canvas = cameraMotionCanvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const nPx = CAMERA_MOTION_SAMPLE_W * CAMERA_MOTION_SAMPLE_H;
    const lum = new Uint8Array(nPx);

    cameraMotionLastDetectedAtRef.current = performance.now();

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      const now = performance.now();

      if (!v || v.videoWidth < 2 || v.videoHeight < 2) {
        raf = window.requestAnimationFrame(tick);
        return;
      }

      const sinceLast = cameraMotionLastSampleAtRef.current
        ? now - cameraMotionLastSampleAtRef.current
        : CAMERA_MOTION_SAMPLE_INTERVAL_MS;

      if (sinceLast < CAMERA_MOTION_SAMPLE_INTERVAL_MS) {
        raf = window.requestAnimationFrame(tick);
        return;
      }
      cameraMotionLastSampleAtRef.current = now;

      ctx.drawImage(v, 0, 0, CAMERA_MOTION_SAMPLE_W, CAMERA_MOTION_SAMPLE_H);
      const img = ctx.getImageData(0, 0, CAMERA_MOTION_SAMPLE_W, CAMERA_MOTION_SAMPLE_H);
      const d = img.data;
      for (let i = 0, j = 0; j < nPx; i += 4, j++) {
        lum[j] = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
      }

      const prev = cameraMotionPrevLumRef.current;
      cameraMotionPrevLumRef.current = new Uint8Array(lum);

      if (!prev || prev.length !== lum.length) {
        setCameraMotionGateOk(false);
        setCameraMotionRingProgress(0);
        setShowNoMovementWarning(false);
        raf = window.requestAnimationFrame(tick);
        return;
      }

      let sumAbs = 0;
      for (let i = 0; i < nPx; i++) {
        sumAbs += Math.abs(lum[i]! - prev[i]!);
      }
      const meanDiff = sumAbs / nPx / 255;

      if (meanDiff >= CAMERA_MOTION_DIFF_MEAN_MIN) {
        cameraMotionAccumMsRef.current += Math.min(sinceLast, 250);
        cameraMotionLastDetectedAtRef.current = now;
        const mp = Math.min(1, cameraMotionAccumMsRef.current / CAMERA_MOTION_ACCUM_MS);
        setCameraMotionRingProgress(mp);
        setCameraMotionGateOk(cameraMotionAccumMsRef.current >= CAMERA_MOTION_ACCUM_MS);
        setShowNoMovementWarning(false);
      } else {
        cameraMotionAccumMsRef.current = 0;
        setCameraMotionGateOk(false);
        setCameraMotionRingProgress(0);
        const stagnantForMs = now - cameraMotionLastDetectedAtRef.current;
        if (stagnantForMs >= NO_MOVEMENT_WARNING_AFTER_MS) {
          setShowNoMovementWarning(true);
          if (
            typeof navigator !== "undefined" &&
            typeof navigator.vibrate === "function" &&
            now - cameraMotionLastBuzzAtRef.current >= NO_MOVEMENT_VIBRATE_COOLDOWN_MS
          ) {
            navigator.vibrate(NO_MOVEMENT_VIBRATE_MS);
            cameraMotionLastBuzzAtRef.current = now;
          }
        } else {
          setShowNoMovementWarning(false);
        }
      }

      raf = window.requestAnimationFrame(tick);
    };

    raf = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      cameraMotionPrevLumRef.current = null;
      cameraMotionAccumMsRef.current = 0;
      cameraMotionLastSampleAtRef.current = 0;
      cameraMotionLastDetectedAtRef.current = 0;
      cameraMotionLastBuzzAtRef.current = 0;
      setCameraMotionGateOk(false);
      setCameraMotionRingProgress(0);
      setShowNoMovementWarning(false);
    };
  }, [cameraState, phaseIndex, currentFoot]);

  useEffect(() => {
    prevCameraStateRef.current = cameraState;
  }, [cameraState]);

  // Safety: if we ever return to live camera, ensure no black transition overlay is left on.
  useEffect(() => {
    if (cameraState === "readyPhase" || cameraState === "starting" || cameraState === "betweenFeet") {
      setPreviewTransitionActive(false);
    }
  }, [cameraState]);

  const cancelBurstSequence = () => {
    burstCancelledRef.current = true;
    burstInFlightRef.current = false;
  };

  const stopCapture = () => {
    /* legacy: burst senza setInterval */
  };

  const stopStream = () => {
    cancelBurstSequence();
    stopCapture();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (videoRef.current as any).srcObject = null;
    }
  };

  /** Ricostruzione locale point-cloud -> preview 3D */
  const beginMeshVisualization = () => {
    if (meshGenTimeoutRef.current) {
      clearTimeout(meshGenTimeoutRef.current);
      meshGenTimeoutRef.current = null;
    }
    setMeshPreviewUrl(null);
    setReconstructedCloud(null);
    setReconstructedMetrics(null);
    setPreviewRevealReady(false);
    setPreviewTransitionActive(true);
    previewTransitionTimeoutsRef.current.forEach((t) => window.clearTimeout(t));
    previewTransitionTimeoutsRef.current = [];

    // Fade-out camera first, then cut to loading + 3D.
    const t1 = window.setTimeout(() => {
      stopStream();
      setCameraState("visualizing");
      setScanMeshViewerStatus("processing");
    }, 420);
    const t2 = window.setTimeout(() => {
      setPreviewRevealReady(true);
      setPreviewTransitionActive(false);
    }, 1400);
    previewTransitionTimeoutsRef.current.push(t1, t2);
    void (async () => {
      try {
        await yieldToMain();
        const perf = getThreePerformanceProfile();
        const framesLeft = reconFramesLeftRef.current;
        const framesRight = reconFramesRightRef.current;

        const cap = perf.isMobileOrLowTier ? 40 : 60;
        const pickEven = (arr: Blob[], max: number) => {
          if (arr.length <= max) return arr;
          const out: Blob[] = [];
          for (let i = 0; i < max; i++) {
            const t = max <= 1 ? 0 : i / (max - 1);
            const idx = Math.min(arr.length - 1, Math.floor(t * (arr.length - 1)));
            out.push(arr[idx]!);
          }
          return out;
        };

        const pickedLeft = pickEven(framesLeft, Math.min(cap, framesLeft.length));
        const pickedRight = pickEven(framesRight, Math.min(cap, framesRight.length));

        let reconItems: { blob: Blob; phaseId: PhaseId }[] = [...pickedLeft, ...pickedRight].map(
          (blob, i) => ({
            blob,
            phaseId: (i % 4) as PhaseId,
          })
        );

        if (!reconItems.length) {
          // Fallback: legacy photos pipeline
          const reconLeftLegacy = selectRepresentativePhaseFrames<Photo>(photosLeft, reconPhotosPerPhase);
          const reconRightLegacy = selectRepresentativePhaseFrames<Photo>(photosRight, reconPhotosPerPhase);
          reconItems = [...reconLeftLegacy, ...reconRightLegacy].map((p) => ({
            blob: p.blob,
            phaseId: p.phaseId,
          }));
          if (!reconItems.length) throw new Error("Nessun frame disponibile per la ricostruzione");
        }

        const mobile = perf.isMobileOrLowTier;
        // Scaling reale: stimiamo un fattore uniforme a partire da ArUco (px/mm) dei frame rappresentativi.
        // La pipeline "stabile" applica poi `metricScaleFactor` dopo cleaning/regularize.
        const metricCandidates = [...pickedLeft, ...pickedRight].slice(0, 6);
        const pxPerMmSamples: number[] = [];
        for (const cand of metricCandidates) {
          const v = await validateArucoOnPhoto(cand).catch(() => ({ ok: false as const }));
          if (v.ok) {
            pxPerMmSamples.push(v.pixelsPerMm);
            if (pxPerMmSamples.length >= 3) break; // sufficiente per una stima stabile
          }
        }
        const metricScaleFactor =
          pxPerMmSamples.length > 0
            ? clamp(
                pxPerMmSamples.reduce((a, b) => a + b, 0) / pxPerMmSamples.length / PX_PER_MM_NOMINAL,
                0.4,
                3.0
              )
            : undefined;

        // Quick measurements (mm) from captured frames, for immediate UX and reliable scale.
        // Best-effort: do not block preview if it fails.
        void (async () => {
          try {
            const m = await extractBasicFootMeasurementsFromFrames([...pickedLeft, ...pickedRight].slice(0, 24));
            setReconstructedMetrics({ footLengthMm: m.length, forefootWidthMm: m.width });
          } catch {
            /* ignore */
          }
        })();

        const { reconstructStableFootPointCloud } = await import("./lib/reconstruction/stableFootPipeline");
        const result = await reconstructStableFootPointCloud({
          frames: reconItems,
          metricScaleFactor,
          options: {
            maxImageSide: mobile ? 256 : 320,
            sampleStep: mobile ? 4 : 3,
            mergeVoxelMm: mobile ? 5.8 : 5,
            multiViewRefinementIterations: mobile ? 1 : 2,
            phaseWeightedMerge: true,
          },
        });

        if (!result.pointCloud?.pointCount) throw new Error("Point cloud vuota");

        const previewCloud = downsamplePointCloud(result.pointCloud, perf.maxPointCloudPoints);
        await yieldToMain();
        setReconstructedCloud(previewCloud);
        setReconstructedMetrics({
          footLengthMm: result.dimensionsMm.length,
          forefootWidthMm: result.dimensionsMm.width,
        });
        setMeshPreviewUrl("/local/reconstructed-point-cloud");
        setScanMeshViewerStatus("ready");
      } catch (e) {
        console.error("[ScannerCattura] reconstruction", e);
        // Robustness: always produce a usable output for the 3D preview.
        const fallbackMetrics = reconstructedMetrics ?? DEFAULT_METRICS;
        const fallback = await buildFallbackFootPointCloudMm(fallbackMetrics);
        const perf = getThreePerformanceProfile();
        setReconstructedCloud(downsamplePointCloud(fallback, perf.maxPointCloudPoints));
        setReconstructedMetrics(fallbackMetrics);
        setMeshPreviewUrl("/local/fallback-foot-template");
        setScanMeshViewerStatus("ready");
      }
    })();
  };

  const leaveMeshVisualization = () => {
    if (meshGenTimeoutRef.current) {
      clearTimeout(meshGenTimeoutRef.current);
      meshGenTimeoutRef.current = null;
    }
    setScanMeshViewerStatus("idle");
    setMeshPreviewUrl(null);
    setReconstructedCloud(null);
    setReconstructedMetrics(null);
    setCameraState("review");
  };

  useEffect(() => {
    return () => {
      previewTransitionTimeoutsRef.current.forEach((t) => window.clearTimeout(t));
      previewTransitionTimeoutsRef.current = [];
    };
  }, []);

  const cleanupPhotos = () => {
    photosLeft.forEach((p) => URL.revokeObjectURL(p.url));
    photosRight.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotosLeft([]);
    setPhotosRight([]);
  };

  const stopProcessing = () => {
    if (processingIntervalRef.current) {
      window.clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
    if (processingCompletionTimeoutRef.current) {
      clearTimeout(processingCompletionTimeoutRef.current);
      processingCompletionTimeoutRef.current = null;
    }
  };

  const startProcessingSimulation = () => {
    stopProcessing();
    setProcessingReady(false);
    setProcessingProgress(0);

    const durationMs = 1600;
    const startedAt = performance.now();

    let visualizationStarted = false;
    const startVisualizationIfReady = () => {
      if (visualizationStarted) return;
      visualizationStarted = true;

      // Entra direttamente nella UI della ricostruzione 3D.
      stopProcessing();
      setProcessingProgress(100);
      setProcessingReady(true);
      beginMeshVisualization();
    };

    processingIntervalRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const ratio = clamp(elapsed / durationMs, 0, 1);
      const next = ratio * 100;

      setProcessingProgress(next);

      if (ratio >= 1) {
        startVisualizationIfReady();
      }
    }, 50);

    // Failsafe: alcuni device possono clamping/tick rate; garantiamo comunque lo stato finale.
    processingCompletionTimeoutRef.current = window.setTimeout(() => {
      startVisualizationIfReady();
    }, durationMs + 120);
  };

  useEffect(() => {
    return () => {
      stopStream();
      stopProcessing();
      cleanupPhotos();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureCameraReady = async () => {
    const videoEl = videoRef.current;
    if (!videoEl) throw new Error("Video element assente.");
    prepareVideoElement(videoEl);

    /** Subito dopo getUserMedia il track può essere ancora "new" / non "live" per qualche ms (mobile). */
    const waitForLiveVideoTrack = async (maxMs: number) => {
      const started = performance.now();
      while (performance.now() - started < maxMs) {
        const stream = streamRef.current;
        const track = stream?.getVideoTracks?.()[0];
        if (track?.readyState === "ended") {
          throw new Error("Stream video terminato.");
        }
        if (track?.readyState === "live") return;
        await new Promise((r) => setTimeout(r, 40));
      }
      const stream = streamRef.current;
      const track = stream?.getVideoTracks?.()[0];
      if (!track) throw new Error("Nessun track video nello stream.");
      if (track.readyState === "ended") throw new Error("Stream video terminato.");
      // Alcuni browser segnalano "live" in ritardo: proseguiamo se c'è almeno un track.
    };
    await waitForLiveVideoTrack(4000);

    // Safari/iOS può avere stream attivo ma metadati non ancora pronti.
    await new Promise<void>((resolve) => {
      if (videoEl.readyState >= 1 && videoEl.videoWidth > 0) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        videoEl.removeEventListener("loadedmetadata", finish);
        videoEl.removeEventListener("canplay", finish);
        resolve();
      };
      videoEl.addEventListener("loadedmetadata", finish, { once: true });
      videoEl.addEventListener("canplay", finish, { once: true });
      window.setTimeout(finish, 1800);
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 9000) {
      try {
        if (videoEl.paused) await videoEl.play();
      } catch {
        // ignore and keep retrying while browser finishes permission/camera init
      }
      const hasFrameStrong =
        videoEl.videoWidth > 0 &&
        videoEl.readyState >= 2 &&
        videoEl.currentTime > 0 &&
        !videoEl.paused;
      const hasFrameSoft =
        videoEl.videoWidth > 0 && videoEl.readyState >= 2 && (videoEl.currentTime > 0 || videoEl.readyState >= 3);
      if (hasFrameStrong || hasFrameSoft) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("La fotocamera è attiva ma non arriva il frame.");
  };

  const acquireCameraStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia non disponibile. Usa HTTPS/localhost.");
    }

    const handed = takeCameraStreamHandoff();
    if (handed) {
      const vTracks = handed.getVideoTracks();
      const hasUsableVideo = vTracks.some((t) => t.readyState !== "ended");
      if (hasUsableVideo) {
        if (streamRef.current) stopStream();
        streamRef.current = handed;
        const v = videoRef.current;
        if (!v) {
          handed.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        } else {
          try {
            prepareVideoElement(v);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v as any).srcObject = handed;
            try {
              await v.play();
            } catch {
              // ensureCameraReady ritenta
            }
            await ensureCameraReady();
            return;
          } catch {
            handed.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (v as any).srcObject = null;
          }
        }
      } else {
        handed.getTracks().forEach((t) => t.stop());
      }
    }

    if (streamRef.current) stopStream();

    const getStream = async (videoConstraints: unknown) =>
      navigator.mediaDevices.getUserMedia({
        video: videoConstraints as MediaTrackConstraints,
        audio: false,
      });

    if (!videoRef.current) throw new Error("Video element assente.");
    const video = videoRef.current;
    const candidates: MediaTrackConstraints[] = [
      // Universal range: prefer 1080p, accept 720p minimum.
      { facingMode: "environment", width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 } },
      // Fallback: loosen resolution but keep rear camera intent.
      { facingMode: { ideal: "environment" } },
      // Last resort: let the browser pick any camera
      true as unknown as MediaTrackConstraints,
    ];

    let lastErr: unknown = null;
    for (const c of candidates) {
      let stream: MediaStream | null = null;
      try {
        stream = await getStream(c);
        streamRef.current = stream;
        try {
          const track = stream.getVideoTracks?.()[0];
          if ((track as unknown as { applyConstraints?: (c: unknown) => Promise<void> })?.applyConstraints) {
            await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
              advanced: [{ focusMode: "continuous", exposureMode: "continuous" }],
            });
          }
        } catch {
          // ignore
        }
        prepareVideoElement(video);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).srcObject = stream;

        try {
          await video.play();
        } catch {
          // Some browsers reject first call before metadata; ensureCameraReady retries play().
        }

        await ensureCameraReady();
        return;
      } catch (e) {
        console.error("[ScannerCattura] getUserMedia rejected", {
          constraints: c,
          error: e,
        });
        lastErr = e;
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
        streamRef.current = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).srcObject = null;
      }
    }

    // Extra fallback (Android Chrome): pick a specific rear camera by deviceId if available.
    try {
      const tmp = await getStream(true as unknown as MediaTrackConstraints);
      tmp.getTracks().forEach((t) => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === "videoinput");
      const rear =
        videoInputs.find((d) => /back|rear|environment|posteriore/i.test(d.label)) ?? videoInputs[0];
      if (rear?.deviceId) {
        const stream = await getStream({ deviceId: { exact: rear.deviceId } });
        streamRef.current = stream;
        prepareVideoElement(video);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).srcObject = stream;
        try {
          await video.play();
        } catch {
          /* ensureCameraReady retries */
        }
        await ensureCameraReady();
        return;
      }
    } catch (e) {
      lastErr = lastErr ?? e;
    }

    throw lastErr instanceof Error ? lastErr : new Error("Impossibile avviare la fotocamera.");
  };

  const startCamera = async (selectedFirstFoot?: FootId) => {
    cancelBurstSequence();
    setFootScanDoneVisible(false);
    setError("");
    setCameraState("starting");
    const startFoot = selectedFirstFoot ?? firstFootSelectionRef.current ?? "LEFT";
    setCurrentFoot(startFoot);
    currentFootRef.current = startFoot;
    setFirstFootSelection(startFoot);
    firstFootSelectionRef.current = startFoot;
    setPhaseIndex(0);
    cleanupPhotos();
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PAIR_STORAGE_KEY);
    setProcessingProgress(0);
    setProcessingScanId(null);
    setProcessingReady(false);
    setProcessingStatusText("");
    setScanPath("");

    setScanId(
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `scan_${Date.now()}`
    );
    setFps(0);
    setTimerSeconds(0);
    startAtRef.current = Date.now();

    try {
      void requestOrientationAccess();
      setCameraState("readyPhase");
      setSensorsUnlocked(false);
      setSensorsPromptVisible(true);

      // Supabase: create scan row in background (non-blocking).
      createNewScan()
        .then((id) => {
          supabaseScanIdRef.current = id;
          console.log("[Supabase] scan created, id:", id);
        })
        .catch((err) => {
          console.warn("[Supabase] createNewScan failed (non-fatal):", err);
        });
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setCameraState("error");
      setError(`ERRORE_CAMERA // ${err?.name || "Error"}: ${err?.message || String(e)}`);
      stopStream();
    }
  };

  // Watchdog: detect if video is actually playing frames.
  useEffect(() => {
    if (cameraState !== "readyPhase") {
      setHasLivePreview(false);
      livePreviewLastTimeRef.current = 0;
      livePreviewLastAdvanceAtRef.current = 0;
      setCameraOverlayDiagnostics("");
      return;
    }
    let cancelled = false;

    const checkByTimeAdvance = () => {
      const v = videoRef.current;
      if (!v) return;
      const now = performance.now();
      const t = v.currentTime || 0;
      const hasDims = v.videoWidth > 0 && v.videoHeight > 0;
      const canPlay = v.readyState >= 2;

      if (hasDims && canPlay && t > livePreviewLastTimeRef.current + 0.02) {
        livePreviewLastTimeRef.current = t;
        livePreviewLastAdvanceAtRef.current = now;
      }

      const advancedRecently =
        livePreviewLastAdvanceAtRef.current > 0 && now - livePreviewLastAdvanceAtRef.current < 900;

      setHasLivePreview(hasDims && canPlay && advancedRecently);
    };

    // Prefer requestVideoFrameCallback when available (Chrome Android supports it on many devices).
    // CRITICAL: guard against null ref — watchdog can fire before React commits the video element.
    const v = videoRef.current;
    if (!v) {
      // Video element not yet in DOM — fall back to interval-only polling.
      const id = window.setInterval(() => {
        if (cancelled) return;
        checkByTimeAdvance();
      }, 220);
      return () => {
        cancelled = true;
        window.clearInterval(id);
      };
    }

    // Bind properly so `this` context is correct when called
    const rvfc = (v as any).requestVideoFrameCallback?.bind(v) as
      | ((cb: (now: number, meta: unknown) => void) => number)
      | undefined;
    let rvfcHandle = 0;
    const onFrame = () => {
      if (cancelled) return;
      livePreviewLastAdvanceAtRef.current = performance.now();
      // keep polling other fields too (dims/readyState)
      checkByTimeAdvance();
      if (rvfc) rvfcHandle = rvfc(onFrame);
    };

    if (rvfc) {
      rvfcHandle = rvfc(onFrame);
    }

    const id = window.setInterval(() => {
      if (cancelled) return;
      checkByTimeAdvance();
    }, 220);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (rvfc && rvfcHandle) {
        try {
          (v as any).cancelVideoFrameCallback?.(rvfcHandle);
        } catch {
          /* ignore */
        }
      }
    };
  }, [cameraState]);

  // Diagnostics + frame probe when preview is black/frozen (Android-friendly).
  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    if (hasLivePreview) return;
    let cancelled = false;
    const canvas = (cameraProbeCanvasRef.current ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    setCameraOverlayDiagnostics("inizializzo diagnostica…");

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      const s = streamRef.current;
      const track = s?.getVideoTracks?.()?.[0];
      const dims = `${v?.videoWidth || 0}x${v?.videoHeight || 0}`;
      const rs = v ? `${v.readyState}` : "—";
      const paused = v ? String(v.paused) : "—";
      const ct = v ? v.currentTime.toFixed(3) : "—";
      const trState = track?.readyState ?? "—";
      const trLabel = track?.label ? track.label.slice(0, 44) : "—";

      let lum = "—";
      let varPct = "—";
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        const w = 72;
        const h = 48;
        canvas.width = w;
        canvas.height = h;
        try {
          ctx.drawImage(v, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h).data;
          let sum = 0;
          let sum2 = 0;
          const n = w * h;
          for (let i = 0; i < img.length; i += 4) {
            const y = 0.2126 * img[i]! + 0.7152 * img[i + 1]! + 0.0722 * img[i + 2]!;
            sum += y;
            sum2 += y * y;
          }
          const mean = sum / n;
          const variance = Math.max(0, sum2 / n - mean * mean);
          lum = mean.toFixed(1);
          varPct = Math.min(100, (Math.sqrt(variance) / 255) * 100).toFixed(1);
        } catch {
          // drawImage can throw if video isn't ready
        }
      }

      setCameraOverlayDiagnostics(
        `video ${dims} · readyState=${rs} · paused=${paused} · t=${ct}\ntrack=${trState} · ${trLabel}\nprobe lum=${lum} var%=${varPct}`
      );
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [cameraState, hasLivePreview]);

  // Auto-start: advance state to readyPhase so the scanning UI appears.
  // Camera stream is already started by the mount effect — do NOT touch it here.
  useEffect(() => {
    if (cameraState !== "idle") return;
    if (autoStartOnceRef.current) return;
    autoStartOnceRef.current = true;

    const startFoot = firstFootSelectionRef.current ?? "LEFT";
    // Fire-and-forget: only updates React state, never acquires/stops a stream.
    void startCamera(startFoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState]);

  /** Ripresa affidabile su iOS: tap esplicito se l’auto-avvio non parte o secondo getUserMedia fallisce. */
  const retryCameraFromUserTap = () => {
    discardCameraStreamHandoff();
    stopStream();
    autoStartOnceRef.current = false;
    void restartCamera();
  };

  const forceOpenCameraFromGesture = useCallback(
    async (preferredFoot?: FootId) => {
      setCameraOverlayError("");
      const md = navigator.mediaDevices;
      if (!md?.getUserMedia) {
        setCameraOverlayError("getUserMedia non disponibile (serve HTTPS).");
        return;
      }
      try {
        // Minimal constraints (Android-friendly): let the browser pick a working camera.
        const stream = await md.getUserMedia({ video: true, audio: false });
        if (streamRef.current) stopStream();
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) {
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          setCameraOverlayError("Elemento video non disponibile.");
          return;
        }
        prepareVideoElement(v);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (v as any).srcObject = stream;
        // Fire-and-forget: autoPlay handles playback; awaiting play() causes AbortError on Android
        v.play().catch((e) => {
          console.warn("[ScannerCattura] forceOpenCamera play() soft-failed:", e);
        });
        if (preferredFoot) {
          setCurrentFoot(preferredFoot);
          currentFootRef.current = preferredFoot;
          setFirstFootSelection(preferredFoot);
          firstFootSelectionRef.current = preferredFoot;
        }
        setCameraState("readyPhase");
        setHasLivePreview(true);
      } catch (e: unknown) {
        const err = e as { name?: string; message?: string };
        setCameraOverlayError(`${err?.name || "Error"}: ${err?.message || String(e)}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const chooseFirstFootAndStart = (foot: FootId) => {
    if (cameraState !== "idle") return;
    const alreadyScanned =
      foot === "LEFT"
        ? footPhasesSatisfied(photosLeft) || orbitCompleteLeft
        : footPhasesSatisfied(photosRight) || orbitCompleteRight;
    if (alreadyScanned) {
      setFootSelectionWarning("Hai già scansionato questo piede");
      return;
    }
    setFootSelectionWarning("");
    autoStartOnceRef.current = true;
    void startCamera(foot);
  };

  const resumeToSecondFoot = async () => {
    cancelBurstSequence();
    setFootScanDoneVisible(false);
    setError("");
    setCameraState("starting");
    const first = firstFootSelectionRef.current ?? "LEFT";
    const second: FootId = first === "LEFT" ? "RIGHT" : "LEFT";
    const alreadyScanned =
      second === "LEFT"
        ? footPhasesSatisfied(photosLeft) || orbitCompleteLeft
        : footPhasesSatisfied(photosRight) || orbitCompleteRight;
    if (alreadyScanned) {
      setFootSelectionWarning("Hai già scansionato questo piede");
      return;
    }
    setFootSelectionWarning("");
    setCurrentFoot(second);
    currentFootRef.current = second;
    setPhaseIndex(0);
    setFps(0);
    setTimerSeconds(0);
    startAtRef.current = Date.now();

    try {
      await restartCamera();
      void requestOrientationAccess();
      setCameraState("readyPhase");
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setCameraState("error");
      setError(`ERRORE_CAMERA // ${err?.name || "Error"}: ${err?.message || String(e)}`);
      stopStream();
    }
  };
  const secondFootLabel = (firstFootSelectionRef.current ?? "LEFT") === "LEFT" ? "destro" : "sinistro";
  const feetProgressLabel = useMemo(() => {
    const first = firstFootSelectionRef.current ?? firstFootSelection ?? "LEFT";
    const current = currentFootRef.current;
    const step = current === first ? 1 : 2;
    return `Piede ${step} di 2`;
  }, [firstFootSelection, currentFoot]);

  /** Campiona un frame dal video live; pipeline = scansione continua, non singoli “scatti”. */
  const runContinuousCapture = useCallback(async () => {
    if (burstInFlightRef.current) return;
    if (burstCancelledRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    const foot = currentFootRef.current;
    const pid = phaseIndexRef.current;
    const list = foot === "LEFT" ? photosLeftRef.current : photosRightRef.current;
    const existing = list.filter((p) => p.phaseId === pid).length;
    if (existing >= BURST_FRAMES_MIN) return;
    if (!continuousCaptureAllowedRef.current) return;

    const angleBeforeCapture = currentDirectionDegRef.current;
    if (existing > 0 && angleBeforeCapture == null) return;

    burstInFlightRef.current = true;
    try {
      const blob = await captureFrameAsJpeg(video);
      if (burstCancelledRef.current) return;
      if (!blob) return;
      if (!scanConditionsOkRef.current) return;
      if (!cameraMotionGateOkRef.current) return;

      const dirNow = currentDirectionDegRef.current;
      if (existing > 0 && dirNow == null) return;

      if (angleBeforeCapture != null && dirNow != null) {
        if (angularDistanceDeg(angleBeforeCapture, dirNow) > CAPTURE_MAX_ANGLE_DRIFT_DURING_ENCODE_DEG) {
          return;
        }
      }

      if (dirNow != null) {
        const bin = captureAngleBinIndex(dirNow, CAPTURE_ANGLE_BIN_COUNT);
        if (captureAngleBinsUsedRef.current.has(bin)) return;
      }

      const photo = {
        blob,
        url: URL.createObjectURL(blob),
        phaseId: pid,
      };
      const append = (prev: Photo[]) => {
        if (prev.length >= MAX_PHOTOS_PER_FOOT) return prev;
        return [...prev, photo];
      };
      if (foot === "LEFT") setPhotosLeft(append);
      else setPhotosRight(append);

      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        const t = performance.now();
        if (t - captureHapticLastAtRef.current >= CAPTURE_HAPTIC_MIN_INTERVAL_MS) {
          navigator.vibrate(CAPTURE_HAPTIC_PULSE_MS);
          captureHapticLastAtRef.current = t;
        }
      }

      if (dirNow != null) {
        // Assisted mode: stricter validation (non salvare/contare segmenti se non siamo “perfetti”).
        if (assistedMode) {
          if (!sheetLocked) return;
          if (alignment.markerCount < 4) return;
          if (!footOnSheetOk) return;
          if (!footMostlyInsideFrame) return;
        }

        captureAngleBinsUsedRef.current.add(captureAngleBinIndex(dirNow, CAPTURE_ANGLE_BIN_COUNT));
        lastCaptureDirectionRef.current = dirNow;
        const seg = captureAngleBinIndex(dirNow, orbitBinsTarget);
        setFootScanCoverageBins((prev) => {
          if (prev.has(seg)) return prev;
          const next = new Set(prev);
          next.add(seg);
          const complete = next.size >= orbitBinsTarget;
          if (complete) {
            if (currentFootRef.current === "LEFT") setOrbitCompleteLeft(true);
            else setOrbitCompleteRight(true);
            if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
          } else {
            if ("vibrate" in navigator) navigator.vibrate(12);
          }
          return next;
        });
      }
    } catch {
      /* silenzioso */
    } finally {
      burstInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (cameraState === "readyPhase") {
      burstCancelledRef.current = false;
    }
  }, [cameraState]);

  /**
   * RECON capture (400ms): salva frame utili in memoria per ricostruzione.
   * Regole:
   * - sheet detected
   * - foot detected
   * - movement detected
   */
  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    let cancelled = false;

    const intervalId = window.setInterval(() => {
      if (cancelled) return;
      if (cameraStateRef.current !== "readyPhase") return;
      const video = videoRef.current;
      if (!video) return;

      const sheetDetected = alignment.markerCount > 0;
      const movementDetected = cameraMotionGateOkRef.current;
      const footOk = footDetected;
      if (!sheetDetected || !footOk || !movementDetected) return;

      const buf = currentFootRef.current === "LEFT" ? reconFramesLeftRef.current : reconFramesRightRef.current;
      if (buf.length >= RECON_MAX_FRAMES_PER_FOOT) return;

      // Capturing is async; avoid overlapping captures if previous is still encoding.
      if (burstInFlightRef.current) return;
      burstInFlightRef.current = true;

      void (async () => {
        try {
          const blob = await captureFrameAsJpeg(video);
          if (!blob) return;
          if (cancelled) return;
          // Re-check gates at time of completion (avoid storing junk)
          const sheetDetected2 = alignment.markerCount > 0;
          const movementDetected2 = cameraMotionGateOkRef.current;
          const footOk2 = scanConditionsOkRef.current;
          if (!sheetDetected2 || !footOk2 || !movementDetected2) return;

          const target = currentFootRef.current === "LEFT" ? reconFramesLeftRef.current : reconFramesRightRef.current;
          if (target.length >= RECON_MAX_FRAMES_PER_FOOT) return;
          target.push(blob);
        } finally {
          burstInFlightRef.current = false;
        }
      })();
    }, RECON_CAPTURE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, alignment.markerCount, footDetected]);

  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    if (footScanCoverageComplete) return;

    const intervalId = window.setInterval(() => {
      if (cameraStateRef.current !== "readyPhase") return;
      if (footScanCoverageCompleteRef.current) return;
      if (!continuousCaptureAllowedRef.current) return;
      if (burstInFlightRef.current) return;
      void runContinuousCapture();
    }, continuousCaptureIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [cameraState, footScanCoverageComplete, runContinuousCapture, continuousCaptureIntervalMs]);

  /** Copertura 360° completa: transizione senza burst né “foto”. */
  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    if (!footScanCoverageComplete) return;

    let cancelled = false;
    setFootScanDoneVisible(true);
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setFootScanDoneVisible(false);
      stopStream();
      const foot = currentFootRef.current;
      const first = firstFootSelectionRef.current ?? "LEFT";
      if (foot === first) setCameraState("betweenFeet");
      else setCameraState("review");
    }, SCAN_FOOT_DONE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setFootScanDoneVisible(false);
    };
  }, [cameraState, footScanCoverageComplete]);

  const resetTotal = () => {
    setFootScanDoneVisible(false);
    stopStream();
    cleanupPhotos();
    stopProcessing();
    setCurrentFoot("LEFT");
    currentFootRef.current = "LEFT";
    setFirstFootSelection(null);
    firstFootSelectionRef.current = null;
    setFootSelectionWarning("");
    setPhaseIndex(0);
    setError("");
    setProcessingProgress(0);
    setProcessingScanId(null);
    setProcessingReady(false);
    setProcessingStatusText("");
    setScanPath("");
    setTimerSeconds(0);
    setFps(0);
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PAIR_STORAGE_KEY);
    if (captureFallbackTimeoutRef.current) {
      window.clearTimeout(captureFallbackTimeoutRef.current);
      captureFallbackTimeoutRef.current = null;
    }
    setCaptureFallbackArmed(false);
    if (greenDelayTimerRef.current) {
      window.clearTimeout(greenDelayTimerRef.current);
      greenDelayTimerRef.current = null;
    }
    setGreenDelayArmed(false);
    setBiometryResult(null);
    setBiometryBusy(false);
    if (meshGenTimeoutRef.current) {
      clearTimeout(meshGenTimeoutRef.current);
      meshGenTimeoutRef.current = null;
    }
    setScanMeshViewerStatus("idle");
    setMeshPreviewUrl(null);
    setReconstructedCloud(null);
    setReconstructedMetrics(null);

    if (reviewAutoUploadTimeoutRef.current) {
      window.clearTimeout(reviewAutoUploadTimeoutRef.current);
      reviewAutoUploadTimeoutRef.current = null;
    }
    reviewAutoUploadArmedRef.current = false;

    autoStartOnceRef.current = false;
    setOrbitCompleteLeft(false);
    setOrbitCompleteRight(false);
    setCameraState("idle");
  };

  const uploadPhotosToServer = async () => {
    if (!pairComplete) return;

    setCameraState("uploading");
    setError("");
    setProcessingProgress(0);
    setVideoUploadProgress(0);
    setProcessingScanId(null);
    setProcessingReady(false);
    setScanPath("");
    stopProcessing();

    // Ensure recording is fully stopped and final chunk flushed before assembling.
    await stopVideoRecording();

    // Upload full video to Supabase Storage + mark scans row as pending.
    try {
      await uploadFullScanVideo((p) => setVideoUploadProgress(p));
    } catch (err) {
      console.warn("[ScannerCattura] video upload failed (non-fatal, continuing):", err);
      setVideoUploadProgress(0);
    }

    try {
      const secret = import.meta.env.VITE_UPLOAD_API_SECRET as string | undefined;

      const uploadLeft = selectRepresentativePhaseFrames<Photo>(photosLeft, UPLOAD_PHOTOS_PER_PHASE);
      const uploadRight = selectRepresentativePhaseFrames<Photo>(photosRight, UPLOAD_PHOTOS_PER_PHASE);

      const items: { blob: Blob; name: string; phaseId: PhaseId; foot: FootId }[] = [
        ...uploadLeft.map((p, idx) => ({
          blob: p.blob,
          name: `left_${String(idx).padStart(2, "0")}.jpg`,
          phaseId: p.phaseId,
          foot: "LEFT" as FootId,
        })),
        ...uploadRight.map((p, idx) => ({
          blob: p.blob,
          name: `right_${String(idx).padStart(2, "0")}.jpg`,
          phaseId: p.phaseId,
          foot: "RIGHT" as FootId,
        })),
      ];

      const validations = await Promise.all(items.map((it) => validateArucoOnPhoto(it.blob)));
      const fullArucoCountByFoot = new Map<FootId, number>();
      for (let i = 0; i < validations.length; i++) {
        const v = validations[i];
        if (!v.ok || !v.hasFullAruco) continue;
        const foot = items[i].foot;
        fullArucoCountByFoot.set(foot, (fullArucoCountByFoot.get(foot) ?? 0) + 1);
      }
      const missingFootCalibration = (["LEFT", "RIGHT"] as const).find(
        (foot) => (fullArucoCountByFoot.get(foot) ?? 0) < MIN_FULL_ARUCO_PER_FOOT
      );
      if (missingFootCalibration) {
        throw new Error(
          `Calibrazione ${missingFootCalibration === "LEFT" ? "piede sinistro" : "piede destro"} insufficiente: servono almeno ${MIN_FULL_ARUCO_PER_FOOT} foto con 4 marker ArUco visibili.`
        );
      }
      const firstInvalidIdx = validations.findIndex((v) => !v.ok);
      if (firstInvalidIdx >= 0) {
        const invalid = validations[firstInvalidIdx];
        if (invalid.reason === "marker_blurry") {
          throw new Error(
            `Foto ${firstInvalidIdx + 1}/${items.length} troppo sfocata per leggere il marker ArUco. Ripeti la scansione mantenendo il telefono piu stabile.`
          );
        }
        if (invalid.reason === "foot_points_missing") {
          throw new Error(
            `Foto ${firstInvalidIdx + 1}/${items.length} valida ArUco ma punti piede incompleti (alluce/tallone/arco). Inquadratura non valida, invio bloccato.`
          );
        }
        if (invalid.reason === "foot_outside_sheet") {
          throw new Error(
            `Piede troppo fuori. Piede grande? Mettilo in diagonale e riprova.`
          );
        }
        throw new Error(
          `Foto ${firstInvalidIdx + 1}/${items.length} senza marker ArUco visibile. Inquadratura non valida, invio bloccato.`
        );
      }

      const sessionScanId =
        scanId ||
        (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `scan_${Date.now()}`);
      if (!scanId) setScanId(sessionScanId);

      let driveFolderId: string | undefined;
      let driveFolderLink: string | undefined;
      let driveUploadFailed = false;
      let driveUploadReason = "";

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setProcessingStatusText(`Caricamento foto ${i + 1} di ${items.length}...`);
        const uploadBlob = await compressBlobForUpload(item.blob);
        const imageBase64 = await blobToBase64(uploadBlob);
        const arucoMeta = validations[i];
        const markerCorners = arucoMeta.ok ? arucoMeta.corners : [];
        const pixelsPerMm = arucoMeta.ok ? arucoMeta.pixelsPerMm : null;
        const arucoDictionary = arucoMeta.ok ? arucoMeta.dictionary : null;
        const markerSharpness = arucoMeta.ok ? arucoMeta.sharpness : null;
        const hasFullAruco = arucoMeta.ok ? arucoMeta.hasFullAruco : false;
        const footLandmarks = arucoMeta.ok ? arucoMeta.footLandmarks : null;
        const res = await fetch("/api/upload-single", {
          method: "POST",
          body: JSON.stringify({
            imageBase64,
            fileName: item.name,
            folderId: driveFolderId || "",
            scanId: sessionScanId,
            mimeType: uploadBlob.type || "image/jpeg",
            markerCorners,
            pixelsPerMm,
            arucoDictionary,
            markerSharpness,
            hasFullAruco,
            markerSizeMm: ARUCO_MARKER_SIZE_MM,
            footLandmarks,
          }),
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { "x-upload-secret": secret } : {}),
          },
        });
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          // In dev locale (solo Vite) /api/upload-single spesso non esiste → non blocchiamo la ricostruzione 3D.
          if (res.status === 404) {
            driveUploadFailed = true;
            driveUploadReason = "Endpoint /api/upload-single non disponibile in dev locale.";
            break;
          }
          if (/drive non configurato/i.test(text) || /drive not configured/i.test(text) || /non configurato/i.test(text)) {
            driveUploadFailed = true;
            driveUploadReason = "Drive non configurato sul server (solo ricostruzione locale).";
            break;
          }
          throw new Error(`upload-single fallito (${res.status}) foto ${i + 1}/${items.length}. ${text}`);
        }
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new Error(`Risposta upload-single non valida (foto ${i + 1}/${items.length})`);
        }
        if (data.ok !== true || data.driveUploaded !== true) {
          const dataError = typeof data.error === "string" ? data.error : "";
          if (/drive non configurato/i.test(dataError) || /non configurato/i.test(dataError) || /drive not configured/i.test(dataError)) {
            driveUploadFailed = true;
            driveUploadReason = "Drive non configurato (solo ricostruzione locale).";
            break;
          }
          throw new Error(
            typeof data.error === "string"
              ? `upload-single errore foto ${i + 1}/${items.length}: ${data.error}`
              : `upload-single non ha caricato la foto ${i + 1}/${items.length}`
          );
        }
        if (typeof data.driveFolderId === "string" && data.driveFolderId) {
          driveFolderId = data.driveFolderId;
        }
        if (typeof data.driveFolderLink === "string" && data.driveFolderLink) {
          driveFolderLink = data.driveFolderLink;
        }

        const uploadPct = Math.round(((i + 1) / items.length) * 100);
        setProcessingProgress(uploadPct);
      }

      // allinea i badge tecnici all'ID server
      setScanId(sessionScanId);
      setProcessingScanId(sessionScanId);
      if (driveUploadFailed) {
        setScanPath("/scans/local");
        setError("");
        setProcessingStatusText(`${driveUploadReason} Avvio elaborazione modello locale...`);
      } else {
        setScanPath(driveFolderLink || "/scans/drive");
        setError("");
        setProcessingStatusText("Upload completato. Avvio elaborazione modello...");
      }

      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(PAIR_STORAGE_KEY, "true");
        sessionStorage.setItem(
          SCAN_METRICS_STORAGE_KEY,
          JSON.stringify({
            lunghezzaMm: DEFAULT_METRICS.footLengthMm,
            larghezzaMm: DEFAULT_METRICS.forefootWidthMm,
            updatedAt: new Date().toISOString(),
          })
        );
      }

      // simulazione elaborazione di 3 secondi (poi abilita "VISUALIZZA 3D")
      startProcessingSimulation();
    } catch (e: any) {
      const msg = e?.message || String(e);
      stopProcessing();
      setProcessingStatusText("");
      // Evita loop: in `review` partono retry automatici di upload/elaborazione.
      // Su errore mostriamo il messaggio e fermiamo il flusso.
      setCameraState("error");
      setError(`ERRORE_UPLOAD // ${msg}`);
    }
  };

  // Auto: quando la scansione è completata, avvia subito l'upload/elaborazione.
  useEffect(() => {
    if (cameraState !== "review") return;
    if (!pairComplete) return;
    if (reviewAutoUploadArmedRef.current) return;

    reviewAutoUploadArmedRef.current = true;
    reviewAutoUploadTimeoutRef.current = window.setTimeout(() => {
      reviewAutoUploadTimeoutRef.current = null;
      void uploadPhotosToServer();
    }, SCAN_FOOT_DONE_DELAY_MS);

    return () => {
      if (reviewAutoUploadTimeoutRef.current) {
        window.clearTimeout(reviewAutoUploadTimeoutRef.current);
        reviewAutoUploadTimeoutRef.current = null;
      }
      reviewAutoUploadArmedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, pairComplete]);

  return (
    <div
      className="absolute left-0 top-0 z-50 bg-black"
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      <style>{`
        @keyframes neuma-scan-valid-breathe {
          0%, 100% {
            box-shadow: inset 0 0 48px rgba(52, 211, 153, 0.06), 0 0 0 rgba(16, 185, 129, 0);
          }
          50% {
            box-shadow: inset 0 0 88px rgba(52, 211, 153, 0.12), 0 0 32px rgba(16, 185, 129, 0.14);
          }
        }
        .neuma-scan-video-alive {
          animation: neuma-scan-valid-breathe 2.5s ease-in-out infinite;
        }
        @keyframes neuma-orbit-premium-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        .neuma-orbit-premium-pulse {
          animation: neuma-orbit-premium-pulse 2.1s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .neuma-scan-video-alive,
          .neuma-orbit-premium-pulse {
            animation: none !important;
          }
        }
      `}</style>

      {cameraState === "readyPhase" && !STARLINK_DOT_CLOUD_MODE ? (
        <div
          className="pointer-events-none absolute right-3 top-14 z-[94] flex max-w-[min(92vw,16rem)] sm:right-4 sm:top-16"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 rounded-full border border-white/18 bg-black/55 py-1.5 pl-2.5 pr-3 shadow-lg transition-opacity duration-500 ease-out">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]" />
            </span>
            <div className="min-w-0 text-left leading-tight">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-red-100/95">
                Scansione attiva
              </div>
              <div className="text-[11px] font-medium text-white/80">Dal video, automatica</div>
            </div>
          </div>
        </div>
      ) : null}

      {!STARLINK_DOT_CLOUD_MODE && gyroAlivePing ? (
        <div className="pointer-events-none absolute left-3 top-14 z-[94] sm:left-4 sm:top-16" aria-live="polite">
          <div className="rounded-full border border-white/14 bg-black/55 px-3 py-1.5 text-[10px] font-medium tracking-[0.12em] text-white/75 backdrop-blur-xl">
            GYRO OK
          </div>
        </div>
      ) : null}

      {!scanStarted && cameraState === "readyPhase" ? (
        <div className="pointer-events-auto absolute inset-0 z-[96] flex items-center justify-center px-6">
          <button
            type="button"
            onClick={async () => {
              if (!portraitOk) return;
              if (openCvStatus !== "ready") return;
              setBootError(null);
              setBooting(true);
              try {
                await acquireCameraStream();
                try {
                  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
                  if (typeof DOE?.requestPermission === "function") {
                    await DOE.requestPermission().catch(() => "denied");
                  }
                } catch {}
                try {
                  const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> };
                  if (typeof DME?.requestPermission === "function") {
                    await DME.requestPermission().catch(() => "denied");
                  }
                } catch {}
                try {
                  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
                    | typeof AudioContext
                    | undefined;
                  if (AC) {
                    const ctx = new AC();
                    await ctx.resume().catch(() => {});
                    await ctx.close().catch(() => {});
                  }
                } catch {}

                await unlockSensorsFromGesture();
                setScanStarted(true);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setBootError(msg || "Impossibile avviare lo scanner.");
              } finally {
                setBooting(false);
              }
            }}
            className="w-full max-w-sm rounded-full border border-white/14 bg-white/10 py-6 text-center text-[15px] font-semibold tracking-[0.06em] text-white backdrop-blur-2xl transition-colors duration-150 active:bg-white/15"
            aria-label="Avvia scanner"
            disabled={openCvStatus !== "ready" || booting}
          >
            {openCvStatus === "loading"
              ? "Inizializzazione motore AI (WASM)..."
              : openCvStatus === "error"
                ? "ERRORE OPENCV"
                : booting
                  ? "AVVIO..."
                  : "AVVIA SCANNER"}
          </button>
          {openCvStatus === "error" && openCvError ? (
            <div className="pointer-events-none absolute bottom-[22%] left-1/2 w-[min(92vw,30rem)] -translate-x-1/2 text-center">
              <div className="rounded-2xl border border-red-300/18 bg-black/65 px-4 py-3 text-[12px] font-medium text-red-100/85 backdrop-blur-2xl">
                {openCvError}
              </div>
            </div>
          ) : null}
          {bootError ? (
            <div className="pointer-events-none absolute bottom-[14%] left-1/2 w-[min(92vw,28rem)] -translate-x-1/2 text-center">
              <div className="rounded-2xl border border-white/10 bg-black/60 px-4 py-3 text-[12px] font-medium text-white/75 backdrop-blur-2xl">
                {bootError}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {STARLINK_DOT_CLOUD_MODE && cameraState === "readyPhase" && openCvStatus === "error" ? (
        <div className="pointer-events-auto absolute inset-0 z-[98] flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-3xl border border-red-300/18 bg-black/70 p-6 text-center text-white backdrop-blur-2xl">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-red-200/85 uppercase">
              OpenCV non disponibile
            </div>
            <div className="mt-2 text-[18px] font-semibold tracking-tight">
              Impossibile inizializzare il motore ArUco.
            </div>
            <div className="mt-3 text-[12px] text-white/55">
              {openCvError || "Errore inizializzazione OpenCV."}
            </div>
          </div>
        </div>
      ) : null}

      {/* Emergency: OpenCV loop fatal stop (camera not anchored / aruco missing) */}
      {STARLINK_DOT_CLOUD_MODE && cameraState === "readyPhase" && openCvAruco.snapshot.status === "error" && openCvAruco.snapshot.error ? (
        <div className="pointer-events-auto absolute inset-0 z-[97] flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-3xl border border-red-300/18 bg-black/75 p-6 text-center text-white backdrop-blur-2xl">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-red-200/85 uppercase">
              ERRORE CRITICO
            </div>
            <div className="mt-2 text-[18px] font-semibold tracking-tight">
              Fotocamera non agganciata o ArUco mancante
            </div>
            <div className="mt-3 text-[12px] text-white/60">
              {openCvAruco.snapshot.error}
            </div>
          </div>
        </div>
      ) : null}

      {!portraitOk ? (
        <div className="pointer-events-auto absolute inset-0 z-[99] flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/80 p-6 text-center text-white backdrop-blur-2xl">
            <div className="text-[11px] font-semibold tracking-[0.18em] text-white/70 uppercase">Orientamento</div>
            <div className="mt-2 text-[18px] font-semibold tracking-tight">Per favore, tieni il telefono in verticale</div>
            <div className="mt-3 text-[12px] text-white/50">Ruota lo schermo in portrait per continuare la scansione.</div>
          </div>
        </div>
      ) : null}

      {/* Aggressive debug: analysis status (DOM-updated, no React state churn) */}
      {cameraState === "readyPhase" ? (
        <div className="pointer-events-none absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[96]">
          <div className="rounded-xl border border-white/10 bg-black/65 px-3 py-2 text-[11px] font-medium text-white/75 backdrop-blur-2xl">
            <div>
              <span className="text-white/45">FPS:</span>{" "}
              <span id="debug-fps" ref={debugFpsElRef} className="text-white/85">0</span>
            </div>
            <div className="mt-0.5">
              <span className="text-white/45">Markers:</span>{" "}
              <span id="debug-markers" ref={debugMarkersElRef} className="text-emerald-200/90">0</span>
            </div>
            <div className="mt-0.5">
              <span className="text-white/45">Dict:</span>{" "}
              <span className="text-white/70">{alignment.arucoDictionary ?? "-"}</span>
            </div>
            {alignment.arucoIdsRaw?.length ? (
              <div className="mt-0.5">
                <span className="text-white/45">IDs:</span>{" "}
                <span className="text-white/60">{alignment.arucoIdsRaw.join(",")}</span>
              </div>
            ) : null}
            <div className="mt-0.5">
              <span className="text-white/45">WASM:</span>{" "}
              <span id="debug-wasm" ref={debugWasmElRef} className="text-white/70">loading</span>
            </div>
            <div className="mt-0.5">
              <span className="text-white/45">Detect:</span>{" "}
              <span id="debug-detect" ref={debugDetectElRef} className="text-white/75">0ms</span>
            </div>
            <div id="debug-err" ref={debugErrElRef} className="mt-1 max-w-[16rem] break-words text-[10px] leading-snug text-red-200/80" />
          </div>
        </div>
      ) : null}

      {/* One overlay canvas for green marker boxes (direct draw) */}
      {cameraState === "readyPhase" ? (
        <canvas ref={debugCanvasRef} className="pointer-events-none absolute inset-0 z-[19]" aria-hidden />
      ) : null}

      {/* Mini debug view: analysis (B/W) buffer */}
      {cameraState === "readyPhase" && (STARLINK_DOT_CLOUD_MODE ? openCvAruco.snapshot.pipCanvas : alignment.analysisPreviewCanvas) ? (
        <div className="pointer-events-none absolute bottom-3 right-3 z-[96] overflow-hidden rounded-2xl border border-emerald-300/20 bg-black/60 backdrop-blur-2xl">
          <canvas
            ref={(el) => {
              if (!el) return;
              const src = STARLINK_DOT_CLOUD_MODE ? openCvAruco.snapshot.pipCanvas : alignment.analysisPreviewCanvas;
              if (!src) return;
              const ctx = el.getContext("2d");
              if (!ctx) return;
              const w = 150;
              const h = 150;
              if (el.width !== w || el.height !== h) {
                el.width = w;
                el.height = h;
                el.style.width = `${w}px`;
                el.style.height = `${h}px`;
              }
              ctx.clearRect(0, 0, w, h);
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(src, 0, 0, w, h);
            }}
            style={{ width: 150, height: 150, imageRendering: "pixelated" as const }}
          />
        </div>
      ) : null}

      {STARLINK_DOT_CLOUD_MODE && scanStarted && cameraState === "readyPhase" && (openCvAruco.snapshot.markerCount ?? 0) < 1 ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[95] flex justify-center px-5 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="max-w-sm rounded-full border border-white/10 bg-black/55 px-4 py-2 text-[13px] font-medium text-white/80 backdrop-blur-2xl">
            Inquadra almeno un marker ArUco sul foglio
          </div>
        </div>
      ) : null}

      {STARLINK_DOT_CLOUD_MODE && dotCloudSuccessFlash ? (
        <div className="pointer-events-none absolute inset-0 z-[97] flex items-center justify-center">
          <div className="rounded-full border border-cyan-400/18 bg-black/55 px-5 py-3 text-[14px] font-semibold tracking-tight text-cyan-100 backdrop-blur-2xl">
            Scansione terminata con successo
          </div>
        </div>
      ) : null}

      {cameraState !== "visualizing" && (
        <div
          ref={videoContainerRef}
          style={{
            // IMPORTANT: "absolute" not "fixed" — fixed inside overflow:hidden clips video on Android Chrome
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            backgroundColor: "black",
            // NO overflow:hidden on video container — causes compositor clip on Android
          }}
        >
          <video
            ref={videoRef}
            id="neuma-live-video"
            autoPlay
            playsInline
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />

          {STARLINK_DOT_CLOUD_MODE ? (
            <canvas
              ref={dotCloudCanvasRef}
              className="pointer-events-none absolute inset-0 z-[62]"
              aria-hidden
            />
          ) : null}

          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              zIndex: 60,
              pointerEvents: "none",
            }}
          />
        </div>
      )}

      {SHOW_SCANNER_STATE_BADGE ? (
        <div className="pointer-events-none absolute left-3 top-3 z-[10] w-[min(92vw,20rem)] sm:left-4 sm:top-4">
          <div className="rounded-2xl border border-white/10 bg-black/55 px-3 py-2 text-[11px] text-white/75">
            <pre className="whitespace-pre-wrap break-words font-mono">{scannerStateBadge || "…"}</pre>
          </div>
        </div>
      ) : null}

      {/* Black camera fallback: in zero-touch mode we rely on a global tap gesture (no visible buttons). */}
      {!NO_SCANNER_OVERLAYS && !ZERO_TOUCH_SCANNER && cameraState === "readyPhase" && !hasLivePreview ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[92] flex justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-6 text-center backdrop-blur-2xl">
            <p className="text-base font-semibold tracking-tight text-white">Attiva la fotocamera</p>
            <p className="mt-1.5 text-[13px] text-white/55">Tocca per sbloccare l&apos;anteprima.</p>
            <div className="mt-5 flex flex-col gap-2.5">
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await forceOpenCameraFromGesture(currentFootRef.current ?? "LEFT");
                }}
                className="w-full rounded-full border border-white/22 bg-white/12 py-5 text-sm font-semibold text-white hover:bg-white/18"
              >
                Avvia fotocamera
              </Button>
              {cameraOverlayError ? <p className="px-1 text-[11px] text-white/35">{cameraOverlayError}</p> : null}
              <Button
                type="button"
                variant="outline"
                onClick={resetTotal}
                className="w-full rounded-full border-white/10 bg-white/[0.03] py-4 text-sm font-semibold text-white/55 hover:bg-white/[0.06]"
              >
                Esci
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Premium transition: fade-out camera before 3D */}
      {!NO_SCANNER_OVERLAYS && previewTransitionActive ? (
        <motion.div
          // Keep this translucent: never fully hide the camera feed.
          className="pointer-events-none absolute inset-0 z-[2] bg-black/25"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.42, ease: "easeOut" }}
          aria-hidden
        />
      ) : null}

      {/* ── Ghost foot guide — hide in pure Starlink mode ── */}
      {scanOverlayEnabled && !STARLINK_DOT_CLOUD_MODE && sheetDetectionState === "green" && !footScanCoverageComplete ? (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-[52] -translate-x-1/2 -translate-y-[54%]"
          style={{
            opacity: footDetected ? 0.12 : 0.52,
            transition: "opacity 700ms ease-out",
          }}
          aria-hidden
        >
          <svg
            width="78" height="132" viewBox="0 0 84 140" fill="none"
            style={{ transform: currentFoot === "RIGHT" ? "scaleX(-1)" : "none" }}
          >
            {/* Main foot body */}
            <path
              d="M42 128 C26 128 15 117 13 103 C11 90 13 74 17 62 C21 50 25 40 31 30 C35 22 38 16 42 15 C46 15 49 22 53 30 C59 40 63 50 67 62 C71 74 73 90 71 103 C69 117 58 128 42 128 Z"
              stroke="rgba(34,211,238,0.58)"
              strokeWidth="1.5"
              strokeDasharray="5 3"
              fill="rgba(34,211,238,0.04)"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Big toe */}
            <ellipse cx="23" cy="18" rx="7" ry="10" stroke="rgba(34,211,238,0.44)" strokeWidth="1.2" strokeDasharray="3 2.5" fill="none" />
            {/* 2nd toe */}
            <ellipse cx="33" cy="11" rx="6" ry="9" stroke="rgba(34,211,238,0.42)" strokeWidth="1.2" strokeDasharray="3 2.5" fill="none" />
            {/* 3rd toe */}
            <ellipse cx="43" cy="8" rx="5.5" ry="8.5" stroke="rgba(34,211,238,0.40)" strokeWidth="1.2" strokeDasharray="3 2.5" fill="none" />
            {/* 4th toe */}
            <ellipse cx="53" cy="11" rx="5" ry="8" stroke="rgba(34,211,238,0.38)" strokeWidth="1.2" strokeDasharray="3 2.5" fill="none" />
            {/* Pinky */}
            <ellipse cx="62" cy="18" rx="4.5" ry="7.5" stroke="rgba(34,211,238,0.34)" strokeWidth="1.2" strokeDasharray="3 2.5" fill="none" />
          </svg>
        </div>
      ) : null}

      {/* ── Starlink HUD: central reticle + progress ring + % ── */}
      {!NO_SCANNER_OVERLAYS && STARLINK_DOT_CLOUD_MODE && cameraState === "readyPhase" ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2">
          <div className="relative" style={{ width: hudSizePx, height: hudSizePx }}>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 140 140" aria-hidden>
              <circle cx="70" cy="70" r="48" stroke="rgba(255,255,255,0.10)" strokeWidth="3" fill="none" />
              <circle
                cx="70"
                cy="70"
                r="48"
                stroke="rgba(34,211,238,0.90)"
                strokeWidth="3.4"
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${2 * Math.PI * 48}`}
                strokeDashoffset={`${2 * Math.PI * 48 * (1 - Math.max(0, Math.min(1, dotCloudProgressPct / 100)))}`}
                transform="rotate(-90 70 70)"
                style={{
                  filter: "drop-shadow(0 0 10px rgba(34,211,238,0.35))",
                  transition: "stroke-dashoffset 120ms linear",
                }}
              />
              <circle cx="70" cy="70" r="28" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" fill="none" />
              <circle cx="70" cy="70" r="2.2" fill="rgba(255,255,255,0.18)" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-semibold tracking-tight text-white" style={{ fontSize: Math.max(22, Math.round(hudSizePx * 0.18)) }}>
                {dotCloudProgressPct}%
              </div>
              <div className="mt-1 text-[10px] font-medium tracking-[0.22em] text-white/45 uppercase">Pulizia cupola</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Motion blur nudge — hide for Starlink mode (pure experience) */}
      {!NO_SCANNER_OVERLAYS && !STARLINK_DOT_CLOUD_MODE && cameraState === "readyPhase" && showMotionBlurWarning ? (
        <div className="pointer-events-none absolute bottom-[12%] left-1/2 z-[70] -translate-x-1/2 px-5">
          <div className="rounded-full border border-amber-300/12 bg-white/[0.03] px-4 py-1.5 text-[12px] font-medium text-amber-100/60 backdrop-blur-2xl">
            Rallenta leggermente
          </div>
        </div>
      ) : null}

      <AnimatePresence>
        {!NO_SCANNER_OVERLAYS && footScanDoneVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            // No fullscreen blur/opaque overlays: keep the live camera visible.
            className="pointer-events-none absolute inset-0 z-[2] flex flex-col items-center justify-center bg-black/20"
            aria-live="polite"
          >
            <motion.p
              initial={{ opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: [1, 1.035, 1] }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.34, ease: "easeOut" }}
              className="text-center text-2xl font-semibold tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)] sm:text-3xl"
            >
              <div>Perfetto</div>
              <div className="mt-2 text-sm font-medium tracking-[0.01em] text-[#e5e5e5]/80 sm:text-base">Continua</div>
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* UI reset: no legacy warnings/pills in Starlink mode */}

      {scanOverlayEnabled && !STARLINK_DOT_CLOUD_MODE ? (
        <div
          className="pointer-events-none absolute inset-0 z-[14] transition-[background,box-shadow] duration-150 ease-out motion-reduce:transition-none"
          style={{
            background: scanFeedbackOverlayBackground,
            boxShadow: scanFeedbackOverlayShadow,
          }}
          aria-hidden={captureReadiness !== "green"}
          aria-label={
            captureReadiness === "green"
              ? "Scansione corretta"
              : captureReadiness === "yellow"
                ? "Quasi corretto"
                : captureReadiness === "red"
                  ? "Correggi inquadratura"
                  : undefined
          }
        />
      ) : null}

      {scanOverlayEnabled && !STARLINK_DOT_CLOUD_MODE ? (
        <ScannerSheetOverlayCanvas
          videoRef={videoRef}
          containerRef={videoContainerRef}
          pointsNorm={sheetOverlayPoints}
          visible={scanOverlayEnabled}
          tone={sheetDetectionState}
          locked={sheetReadyForCapture}
          premiumReady={footDetected}
        />
      ) : null}

      {scanOverlayEnabled ? (
        <ArucoMarkerBracketsCanvas
          videoRef={videoRef}
          containerRef={videoContainerRef}
          markerQuadsNorm={STARLINK_DOT_CLOUD_MODE ? (openCvAruco.snapshot.quadsNorm as any) : alignment.arucoMarkerQuadsNorm}
          visible={scanOverlayEnabled}
        />
      ) : null}

      {/* Overlay avanzato (cornici/guide): disattivato in modalità beginner. */}
      {!SIMPLE_BEGINNER_SCAN_UI && scanOverlayEnabled ? (
        <>
          <div
            className="pointer-events-none absolute inset-0 z-[9] transition-[background] duration-300"
            aria-hidden
            style={{
              background: (() => {
                const base =
                  "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 28%, rgba(0,0,0,0.08) 68%, rgba(0,0,0,0.18) 100%)";
                if (captureReadiness === "green")
                  return `${base}, radial-gradient(circle at 50% 45%, rgba(52,211,153,0.07) 0%, transparent 52%)`;
                return base;
              })(),
            }}
          />
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
            <ScannerAlignmentOverlay
              alignment={alignment}
              frameTilt={frameTilt}
              phaseIndex={0}
              captureReadiness={captureReadiness}
              pathGuide={{
                visible: footDetected,
                footCentroidNorm: alignment.footCentroidNorm,
                zonesComplete: pathZonesComplete,
                activePhase: phaseIndex,
              }}
            />
          </div>
          {!SIMPLE_BEGINNER_SCAN_UI && SHOW_DEBUG_OVERLAY ? (
            <ScanDebugOverlay
              videoRef={videoRef}
              containerRef={videoContainerRef}
              alignment={alignment}
              visible={scanOverlayEnabled}
            />
          ) : null}
        </>
      ) : null}

      {/* contract whole UI on each capture */}
      <motion.div
        className="absolute inset-0 z-50"
      >
        {/* Bottom movement hint — only when actively guiding direction */}
        {cameraState === "readyPhase" && !STARLINK_DOT_CLOUD_MODE && scanMovementGuidance?.text && !footScanCoverageComplete ? (
          <div className="pointer-events-none absolute bottom-[4.5rem] left-1/2 z-[58] -translate-x-1/2 px-5 sm:bottom-[5.2rem]">
            <AnimatePresence mode="wait">
              <motion.div
                key={scanMovementGuidance.text}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                <div className="rounded-full border border-amber-300/12 bg-white/[0.03] px-4 py-1.5 text-[12px] font-medium text-amber-100/65 backdrop-blur-2xl">
                  {scanMovementGuidance.text}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        ) : null}

        {/* phase content */}
        <AnimatePresence mode="wait">
          {!ZERO_TOUCH_SCANNER && cameraState === "betweenFeet" && (
            <motion.div
              key="betweenFeet"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="pointer-events-auto absolute inset-x-0 bottom-0 z-[90] flex justify-center px-5 pb-[max(2.2rem,env(safe-area-inset-bottom))]"
            >
              {/* Entire card is tappable — no visible button */}
              <button
                type="button"
                onClick={() => { void resumeToSecondFoot(); }}
                className="w-full max-w-sm rounded-3xl border border-white/[0.07] bg-black/55 px-5 py-7 text-center backdrop-blur-2xl active:bg-black/70 transition-colors duration-150"
              >
                {/* Cyan check mark */}
                <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-400/[0.07]">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M2 8.5L6 12.5L14 4.5" stroke="rgba(34,211,238,0.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-[11px] font-medium tracking-[0.18em] text-cyan-300/70 uppercase">
                  Primo piede completato
                </p>
                <p className="mt-1.5 text-[17px] font-semibold tracking-tight text-white">
                  Ora il piede {secondFootLabel.toLowerCase()}
                </p>
                <p className="mt-3 text-[12px] text-white/28">Tocca per continuare</p>
                {footSelectionWarning ? (
                  <p className="mt-2 text-[11px] font-medium text-amber-200/70">{footSelectionWarning}</p>
                ) : null}
              </button>
            </motion.div>
          )}

          {cameraState === "starting" && (
            <motion.div
              key="starting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
            >
              <motion.div
                className="rounded-full border border-white/12 bg-black/35 px-5 py-2 text-[13px] font-medium text-white/70 backdrop-blur-md"
                animate={{ opacity: [0.55, 1, 0.55] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              >
                Avvio fotocamera…
              </motion.div>
            </motion.div>
          )}

          {!ZERO_TOUCH_SCANNER && cameraState === "idle" && (
            <motion.div
              key="choose-foot"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.38, ease: "easeOut" }}
              className="pointer-events-auto absolute inset-x-0 bottom-0 z-50 flex justify-center px-6 pb-[max(2.8rem,env(safe-area-inset-bottom))]"
            >
              <div className="w-full max-w-sm">
                {/* Heading */}
                <p className="mb-4 text-center text-[11px] font-medium tracking-[0.22em] text-white/32 uppercase">
                  Inizia con
                </p>
                {/* Two minimal ghost-tap tiles */}
                <div className="flex gap-3">
                  {(["LEFT", "RIGHT"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      onClick={() => chooseFirstFootAndStart(side)}
                      className="group flex flex-1 flex-col items-center justify-center gap-2.5 rounded-[22px] border border-white/[0.07] bg-white/[0.03] py-7 backdrop-blur-2xl active:bg-white/[0.07] transition-colors duration-150"
                    >
                      {/* Ghost foot icon */}
                      <svg width="28" height="44" viewBox="0 0 28 44" fill="none" aria-hidden
                        style={{ transform: side === "RIGHT" ? "scaleX(-1)" : "none" }}>
                        <path
                          d="M14 41 C8 41 4 37 3 32 C2 28 3 22 5 17 C7 13 9 9 11 6 C12 4 13 3 14 3 C15 3 16 4 17 6 C19 9 21 13 23 17 C25 22 26 28 25 32 C24 37 20 41 14 41Z"
                          stroke="rgba(255,255,255,0.35)"
                          strokeWidth="1.2"
                          strokeDasharray="3.5 2"
                          fill="rgba(255,255,255,0.03)"
                          strokeLinecap="round"
                        />
                        <ellipse cx="9" cy="5" rx="3" ry="4.5" stroke="rgba(255,255,255,0.28)" strokeWidth="1" strokeDasharray="2.5 1.5" fill="none" />
                        <ellipse cx="13" cy="2.5" rx="2.5" ry="4" stroke="rgba(255,255,255,0.26)" strokeWidth="1" strokeDasharray="2.5 1.5" fill="none" />
                        <ellipse cx="17" cy="2.5" rx="2.5" ry="4" stroke="rgba(255,255,255,0.24)" strokeWidth="1" strokeDasharray="2.5 1.5" fill="none" />
                        <ellipse cx="21" cy="4" rx="2.5" ry="4" stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="2.5 1.5" fill="none" />
                      </svg>
                      <span className="text-[11px] font-medium tracking-[0.18em] text-white/40 group-active:text-white/70 transition-colors uppercase">
                        {side === "LEFT" ? "Sinistro" : "Destro"}
                      </span>
                    </button>
                  ))}
                </div>
                {footSelectionWarning ? (
                  <p className="mt-3 text-center text-[11px] font-medium text-amber-200/70">{footSelectionWarning}</p>
                ) : null}
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* review — silent, just a pulse */}
        {cameraState === "review" && (
          <div className="pointer-events-none absolute inset-0 z-55 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.6, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              className="h-2 w-2 rounded-full bg-white/60"
            />
          </div>
        )}

        {/* error overlay */}
        {!ZERO_TOUCH_SCANNER && cameraState === "error" && (
          <div className="absolute inset-x-0 bottom-0 z-60 flex justify-center px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
            <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-6 text-center backdrop-blur-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-400/80">
                Fotocamera non disponibile
              </p>
              <p className="mt-1.5 text-[12px] text-white/45 break-words">{error}</p>
              <div className="mt-5 flex flex-col gap-2.5">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={retryCameraFromUserTap}
                  className="w-full rounded-full border border-white/22 bg-white/12 py-5 text-sm font-semibold text-white hover:bg-white/18"
                >
                  Riprova
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetTotal}
                  className="w-full rounded-full border-white/10 bg-white/[0.03] py-4 text-sm font-semibold text-white/55 hover:bg-white/[0.06]"
                >
                  Esci
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* uploading — full-screen fade + centred spinner ring + progress */}
        {cameraState === "uploading" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="pointer-events-none absolute inset-0 z-[75] flex flex-col items-center justify-center bg-black/78 backdrop-blur-sm"
          >
            {/* Spinning ring */}
            <div className="relative mb-8 h-20 w-20">
              {/* Track ring */}
              <svg className="absolute inset-0" width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden>
                <circle cx="40" cy="40" r="34" stroke="rgba(255,255,255,0.08)" strokeWidth="2.5" />
              </svg>
              {/* Progress ring */}
              <svg className="absolute inset-0 -rotate-90" width="80" height="80" viewBox="0 0 80 80" fill="none" aria-hidden>
                <motion.circle
                  cx="40" cy="40" r="34"
                  stroke="url(#upGrad)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  animate={{
                    strokeDashoffset: 2 * Math.PI * 34 * (1 - Math.max(0.04, videoUploadProgress / 100)),
                  }}
                  transition={{ ease: "easeOut", duration: 0.5 }}
                />
                <defs>
                  <linearGradient id="upGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="rgba(52,211,153,0.90)" />
                    <stop offset="100%" stopColor="rgba(34,211,238,0.90)" />
                  </linearGradient>
                </defs>
              </svg>
              {/* Inner dot — pulses when uploading */}
              <motion.div
                className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/75"
                animate={{ opacity: [0.4, 1, 0.4], scale: [0.85, 1.1, 0.85] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>

            {/* Label */}
            <AnimatePresence mode="wait">
              <motion.p
                key={videoUploadProgress >= 100 ? "done" : videoUploadProgress > 0 ? "sending" : "prep"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28 }}
                className="text-[15px] font-semibold tracking-tight text-white/85"
              >
                {videoUploadProgress >= 100
                  ? "Scansione ricevuta"
                  : videoUploadProgress > 0
                    ? "Invio dati al cloud…"
                    : "Preparazione…"}
              </motion.p>
            </AnimatePresence>

            <p className="mt-2 text-[11px] text-white/30">
              {videoUploadProgress >= 100
                ? "Il modello verrà elaborato a breve"
                : `${videoUploadProgress > 0 ? videoUploadProgress : 0}%`}
            </p>

            {/* Thin bottom track */}
            <div className="mt-8 h-[2px] w-[min(72vw,18rem)] overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg,rgba(52,211,153,0.75),rgba(34,211,238,0.75))" }}
                initial={{ width: "0%" }}
                animate={{ width: videoUploadProgress > 0 ? `${videoUploadProgress}%` : "4%" }}
                transition={{ ease: "easeOut", duration: 0.5 }}
              />
            </div>
          </motion.div>
        )}

        {/* visualizer */}
        {cameraState === "visualizing" && (
          <div className="absolute inset-0 z-80 bg-black">
            <div className="relative mx-auto flex h-[100dvh] w-full max-w-xl flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
              {!previewRevealReady ? (
                <div className="flex flex-1 flex-col items-center justify-center">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.28, ease: "easeOut" }}
                    className="text-center"
                  >
                    <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
                    </div>
                    <div className="neuma-title text-2xl font-semibold tracking-tight text-white">
                      Stiamo creando il tuo piede
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={processingMsgIndex}
                        className="mt-2 text-sm text-white/70"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                      >
                        {PROCESSING_MESSAGES[processingMsgIndex]}
                      </motion.div>
                    </AnimatePresence>
                  </motion.div>
                </div>
              ) : (
                <>
                  {(() => {
                switch (scanMeshViewerStatus) {
                  case "idle":
                  case "completing":
                  case "processing":
                    return (
                      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
                        <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
                          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden />
                        </div>
                        <div className="text-3xl font-semibold tracking-tight text-white">
                          Stiamo creando il tuo piede
                        </div>
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={processingMsgIndex}
                            className="text-sm text-white/50"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                          >
                            {PROCESSING_MESSAGES[processingMsgIndex]}
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    );
                  case "ready":
                    return (
                      <div className="relative flex flex-1 flex-col">
                        <div className="pointer-events-none mb-4 text-center">
                          <div className="neuma-title text-3xl font-semibold tracking-tight text-white">
                            Questo è il tuo piede
                          </div>
                        </div>
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ duration: 0.45, ease: "easeOut" }}
                          className="neuma-glass-soft relative flex-1 overflow-hidden rounded-[28px]"
                        >
                          {/* Premium preview: lazy-load 3D stack to keep /scanner stable on Android. */}
                          <Suspense
                            fallback={
                              <div className="absolute inset-0 flex items-center justify-center">
                                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                              </div>
                            }
                          >
                            {reconstructedMetrics ? (
                              <FootPreview
                                length={reconstructedMetrics.footLengthMm}
                                width={reconstructedMetrics.forefootWidthMm}
                              />
                            ) : (
                              <FootTemplatePreviewCanvas
                                cloud={reconstructedCloud ?? { positions: new Float32Array(0), pointCount: 0 }}
                              />
                            )}
                          </Suspense>

                          {/* Measurements overlay (trust cue) */}
                          {reconstructedMetrics ? (
                            <div className="pointer-events-none absolute right-4 top-4 z-20 sm:right-5 sm:top-5">
                              <div className="neuma-glass rounded-2xl px-3 py-2">
                                <div className="font-mono text-[10px] font-semibold tracking-[0.18em] text-white/70">
                                  MISURE (MM)
                                </div>
                                <div className="mt-1 flex items-baseline gap-3">
                                  <div className="flex items-baseline gap-2">
                                    <div className="text-xs font-semibold text-white/85">L</div>
                                    <div className="text-sm font-semibold text-white">
                                      {Math.round(reconstructedMetrics.footLengthMm)}
                                    </div>
                                  </div>
                                  <div className="h-4 w-px bg-white/12" aria-hidden />
                                  <div className="flex items-baseline gap-2">
                                    <div className="text-xs font-semibold text-white/85">W</div>
                                    <div className="text-sm font-semibold text-white">
                                      {Math.round(reconstructedMetrics.forefootWidthMm)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {/* vignette */}
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/55" />
                        </motion.div>

                        {!ZERO_TOUCH_SCANNER ? (
                          <div className="mt-5">
                            <Button
                              type="button"
                              size="lg"
                              className="neuma-touch w-full rounded-full py-6 text-base font-semibold shadow-[0_26px_90px_rgba(0,0,0,0.7)]"
                              onClick={() => {
                                if (typeof window !== "undefined") {
                                  window.dispatchEvent(
                                    new CustomEvent("neuma:scan-proceed", { detail: { scanId: scanId || undefined } })
                                  );
                                }
                              }}
                            >
                              Continua
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  case "error":
                    return (
                      <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-center text-sm text-red-100">
                        Si è verificato un errore nella generazione del modello 3D. Riprova.
                      </div>
                    );
                  default:
                    return null;
                }
                  })()}
                </>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}


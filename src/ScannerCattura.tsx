"use client";

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "./components/ui/button";
import { cn } from "./lib/utils";
import { PAIR_STORAGE_KEY, SCAN_METRICS_STORAGE_KEY } from "./constants/scan";
import { useScanAlignmentAnalysis } from "./hooks/useScanAlignmentAnalysis";
import { requestOrientationAccess } from "./hooks/useDeviceTilt";
import { useScanFrameOrientation } from "./hooks/useScanFrameOrientation";
import { useScanGuidance } from "./hooks/useScanGuidance";
import ScannerAlignmentOverlay from "./components/scanner/ScannerAlignmentOverlay";
import ScanDebugOverlay from "./components/scanner/ScanDebugOverlay";
import ArucoMarkerPins from "./components/scanner/ArucoMarkerPins";
import ScannerSheetOverlayCanvas from "./components/scanner/ScannerSheetOverlayCanvas";
import { computeNeumaBiometryFromImageData, type NeumaBiometryResult } from "./lib/biometry";
import { ensureArucoDetector, detectArucoOnImageDataMultiDictionary } from "./lib/aruco/arucoWasm";
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
import { createNewScan, uploadVideoChunk as supabaseUploadChunk } from "./lib/scanService";

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

type Metrics = { footLengthMm: number; forefootWidthMm: number };
type FootId = "LEFT" | "RIGHT";

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
  await ensureArucoDetector();
  const detected = await detectArucoOnImageDataMultiDictionary(imageData);
  if (!detected || detected.detections.length === 0) {
    return { ok: false as const, reason: "marker_not_found" as const };
  }
  const picked = pickCornerMarkers(detected.detections, imageData.width, imageData.height);
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
    dictionary: detected.dictionary,
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

        {scanId && isReady ? (
          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="button"
              variant="default"
              onClick={onVisualize}
              className="h-auto w-full rounded-xl px-6 py-4 font-mono text-lg tracking-[0.14em]"
            >
              VISUALIZZA 3D
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onBackToGallery}
              className="h-auto w-full rounded-xl border-zinc-800 bg-zinc-900/50 px-6 py-3 font-mono text-sm tracking-[0.12em] text-zinc-100 backdrop-blur-md hover:bg-zinc-800 hover:text-zinc-100"
            >
              TORNA ALLA GALLERY
            </Button>
          </div>
        ) : (
          <div className="mt-5 text-sm text-zinc-400">{statusText || "Questo può richiedere alcuni secondi."}</div>
        )}
      </div>
    </div>
  );
}

export default function ScannerCattura() {
  // Temporary "Android black camera" recovery mode:
  // keep pipeline minimal until we confirm preview works reliably.
  const SIMPLE_ANDROID_CAMERA_MODE = true;
  const BUILD_TAG = "native-cam-2026-03-31";
  const SHOW_DEBUG_OVERLAY = import.meta.env.DEV;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

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

  // Camera start: fire IMMEDIATELY on mount (same as TestCameraPage).
  // No state-gate — eliminates all React lifecycle timing issues on Android.
  const cameraStartedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let activeStream: MediaStream | null = null;

    const start = async () => {
      if (cameraStartedRef.current) return;
      cameraStartedRef.current = true;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        activeStream = stream;
        streamRef.current = stream;

        const videoEl = document.getElementById("neuma-live-video") as HTMLVideoElement | null;
        if (videoEl) {
          videoRef.current = videoEl;
          videoEl.srcObject = stream;
          await videoEl.play();
          if (!cancelled) setHasLivePreview(true);
        }
      } catch (e) {
        console.error("[ScannerCattura] camera start failed:", e);
        cameraStartedRef.current = false;
      }
    };

    start();

    return () => {
      cancelled = true;
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
      }
      if (streamRef.current === activeStream) streamRef.current = null;
      if (videoRef.current) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (videoRef.current as any).srcObject = null;
        } catch {
          /* ignore */
        }
      }
      setHasLivePreview(false);
      cameraStartedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const restartCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    cameraStartedRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const videoEl = document.getElementById("neuma-live-video") as HTMLVideoElement | null;
      if (videoEl) {
        videoRef.current = videoEl;
        videoEl.srcObject = stream;
        await videoEl.play();
        setHasLivePreview(true);
        cameraStartedRef.current = true;
      }
    } catch (e) {
      console.error("[ScannerCattura] restartCamera failed:", e);
    }
  }, []);

  const preferredVideoDeviceIdRef = useRef<string | null>(null);
  const [simpleVideoDevices, setSimpleVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoStreamIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `vs_${Date.now()}`
  );
  const videoChunkIndexRef = useRef(0);
  const videoDriveFolderIdRef = useRef<string | null>(null);
  const videoUploadChainRef = useRef<Promise<void>>(Promise.resolve());
  const [isVideoRecording, setIsVideoRecording] = useState(false);
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
  const SHOW_SCANNER_STATE_BADGE = scannerUrlFlags.has("debug-camera") || SIMPLE_ANDROID_CAMERA_MODE;
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
  const processingCompletionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Simulazione generazione mesh dopo "VISUALIZZA 3D" (futuro polling API) */
  const meshGenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanMeshViewerStatus, setScanMeshViewerStatus] = useState<ScanMeshViewerStatus>("idle");
  const [meshPreviewUrl, setMeshPreviewUrl] = useState<string | null>(null);
  const [reconstructedCloud, setReconstructedCloud] = useState<PointCloud | null>(null);
  const [reconstructedMetrics, setReconstructedMetrics] = useState<Metrics | null>(null);
  const [scanValidationReady, setScanValidationReady] = useState(false);
  const [previewTransitionActive, setPreviewTransitionActive] = useState(false);
  const [previewRevealReady, setPreviewRevealReady] = useState(false);
  const previewTransitionTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const scanMode = useMemo(() => getScanMode(), []);
  const assistedMode = scanMode === "assistant";
  const selfMode = scanMode === "solo";

  const orbitBinsTarget = assistedMode ? 24 : SCAN_ORBIT_ANGLE_BINS;
  const continuousCaptureIntervalMs = assistedMode ? 340 : 560;
  /** Dopo CAPTURE_FALLBACK_AFTER_MS senza burst: sblocca cattura e mostra “Perfetto” (con overlay verde). */
  const [captureFallbackArmed, setCaptureFallbackArmed] = useState(false);
  const captureFallbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [greenDelayArmed, setGreenDelayArmed] = useState(false);
  const greenDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const reviewAutoUploadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  /** Reset tracking ArUco solo al cambio piede, non tra fasi interne (esperienza continua). */
  const alignmentResetKey = currentFoot === "RIGHT" ? 1 : 0;
  const alignment = useScanAlignmentAnalysis(videoRef, scanOverlayEnabled, alignmentResetKey, currentFoot);
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

  const stopVideoRecording = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {
      /* noop */
    }
    mediaRecorderRef.current = null;
    setIsVideoRecording(false);
  }, []);

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
    setShowMotionBlurWarning(false);

    const rec = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: 2_000_000,
      audioBitsPerSecond: 64_000,
    });
    mediaRecorderRef.current = rec;
    setIsVideoRecording(true);

    rec.ondataavailable = (ev: BlobEvent) => {
      const blob = ev.data;
      if (!blob || blob.size < 1024) return;
      const idx = videoChunkIndexRef.current++;
      videoUploadChainRef.current = videoUploadChainRef.current
        .then(() => uploadVideoChunk(blob, idx))
        .catch((e) => {
          console.error("[ScannerCattura] video chunk upload", e);
        });
    };
    rec.onerror = (e) => {
      console.error("[ScannerCattura] MediaRecorder error", e);
    };
    rec.start(1200); // timeslice: chunk ~1.2s
  }, [uploadVideoChunk]);

  useEffect(() => {
    if (cameraState === "readyPhase") {
      // Avvia registrazione continua (video professionale) quando la camera è pronta.
      startVideoRecording();
      return;
    }
    void stopVideoRecording();
  }, [cameraState, startVideoRecording, stopVideoRecording]);

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
    if (alignment.markerCount < 4) return "Avvicinati al foglio";
    return "Centra il foglio";
  }, [sheetDetectionState, alignment.markerCount]);

  /** Confronto foglio rilevato vs bersaglio fisso (centro 0.5, scala target). */
  const sheetPositionGuidanceText = useMemo(() => {
    if (!scanOverlayEnabled) return null;
    if (sheetLocked) return null;
    if (alignment.guide === "too_close") return "Allontanati";
    const t = alignment.tracking;
    if (t.confidence < SHEET_GUIDE_TRACKING_CONF_MIN || alignment.markerCount < 2) return null;
    const dx = t.position.x - 0.5;
    const scale = t.scale;
    if (scale < A4_SHEET_TARGET_SCALE - SHEET_GUIDE_SCALE_TOL_LO) return "Avvicinati";
    if (scale > A4_SHEET_TARGET_SCALE + SHEET_GUIDE_SCALE_TOL_HI) return "Allontanati";
    if (dx < -SHEET_GUIDE_X_TOL) return "Sposta a destra";
    if (dx > SHEET_GUIDE_X_TOL) return "Sposta a sinistra";
    return null;
  }, [
    scanOverlayEnabled,
    sheetLocked,
    alignment.guide,
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
    arucoEngine: alignment.arucoEngine,
    zonesComplete: pathZonesComplete,
    footInsideA4: footOnSheetOk,
    fallbackCaptureMessaging: captureFallbackArmed,
    continuousScanMode: true,
  });

  const beginnerNudgeActive = tooSlow && !footScanCoverageComplete;

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
    if (!scanOverlayEnabled) return "transparent";
    const base =
      "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 22%, rgba(0,0,0,0.14) 62%, rgba(0,0,0,0.26) 100%)";
    if (scanBinaryOk) {
      return `${base}, radial-gradient(circle at 50% 48%, rgba(52,211,153,0.28) 0%, rgba(16,185,129,0.07) 42%, transparent 58%)`;
    }
    return `${base}, radial-gradient(ellipse 88% 74% at 50% 48%, rgba(248,113,113,0.22) 0%, transparent 68%)`;
  }, [scanOverlayEnabled, scanBinaryOk]);

  const scanFeedbackOverlayShadow = useMemo(() => {
    if (!scanOverlayEnabled) return undefined;
    return scanBinaryOk
      ? "inset 0 0 100px rgba(52,211,153,0.18)"
      : "inset 0 0 100px rgba(248,113,113,0.12)";
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
    previewTransitionTimeoutsRef.current.forEach((t) => clearTimeout(t));
    previewTransitionTimeoutsRef.current = [];

    // Fade-out camera first, then cut to loading + 3D.
    const t1 = setTimeout(() => {
      stopStream();
      setCameraState("visualizing");
      setScanMeshViewerStatus("processing");
    }, 420);
    const t2 = setTimeout(() => {
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
          const reconLeftLegacy = selectRepresentativePhaseFrames(photosLeft, reconPhotosPerPhase);
          const reconRightLegacy = selectRepresentativePhaseFrames(photosRight, reconPhotosPerPhase);
          reconItems = [...reconLeftLegacy, ...reconRightLegacy].map((p) => ({
            blob: p.blob,
            phaseId: p.phaseId,
          }));
          if (!reconItems.length) throw new Error("Nessun frame disponibile per la ricostruzione");
        }

        const mobile = perf.isMobileOrLowTier;
        // Scaling reale: stimiamo un fattore uniforme a partire da ArUco (px/mm) dei frame rappresentativi.
        // La pipeline "stabile" applica poi `metricScaleFactor` dopo cleaning/regularize.
        const metricCandidates = [...reconLeft, ...reconRight].slice(0, 6);
        const pxPerMmSamples: number[] = [];
        for (const cand of metricCandidates) {
          const v = await validateArucoOnPhoto(cand.blob).catch(() => ({ ok: false as const }));
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
      previewTransitionTimeoutsRef.current.forEach((t) => clearTimeout(t));
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

    // Vanilla bypass: completely decoupled from React render cycle.
    // useNativeCamera does pure DOM manipulation — no setState triggers re-renders.
    if (SIMPLE_ANDROID_CAMERA_MODE) {
      nativeCamera.stop();
      await nativeCamera.start();
      // Sync streamRef so other parts of the scanner can access the stream if needed.
      streamRef.current = nativeCamera.streamRef.current;
      setHasLivePreview(!!nativeCamera.streamRef.current);
      return;
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
      {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      {
        facingMode: "environment",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      // Android fallback: omit resolution constraints (some devices return black frames otherwise)
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
    if (SIMPLE_ANDROID_CAMERA_MODE) return;
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
    const v = videoRef.current;
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: any) => void) => number })
      .requestVideoFrameCallback;
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
          // @ts-expect-error non standard cancel
          (videoRef.current as any)?.cancelVideoFrameCallback?.(rvfcHandle);
        } catch {
          /* ignore */
        }
      }
    };
  }, [cameraState]);

  // Diagnostics + frame probe when preview is black/frozen (Android-friendly).
  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    if (!SIMPLE_ANDROID_CAMERA_MODE && hasLivePreview) return;
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
  }, [cameraState, hasLivePreview, SIMPLE_ANDROID_CAMERA_MODE]);

  // Auto-start: open camera as soon as scanner mounts.
  useEffect(() => {
    if (cameraState !== "idle") return;
    if (autoStartOnceRef.current) return;

    let isCancelled = false;
    autoStartOnceRef.current = true;

    const boot = async () => {
      const startFoot = firstFootSelectionRef.current ?? "LEFT";
      try {
        await startCamera(startFoot);
      } catch {
        // startCamera handles its own errors
      }
      if (isCancelled && streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    void boot();

    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState]);

  /** Ripresa affidabile su iOS: tap esplicito se l’auto-avvio non parte o secondo getUserMedia fallisce. */
  const retryCameraFromUserTap = () => {
    discardCameraStreamHandoff();
    stopStream();
    autoStartOnceRef.current = false;
    void restartCamera();
  };

  const cycleSimpleCameraFromUserTap = () => {
    if (!SIMPLE_ANDROID_CAMERA_MODE) return;
    const list = simpleVideoDevices;
    if (!list.length) {
      // next retry will repopulate the list
      preferredVideoDeviceIdRef.current = null;
      retryCameraFromUserTap();
      return;
    }
    const currentId =
      preferredVideoDeviceIdRef.current ??
      streamRef.current?.getVideoTracks?.()?.[0]?.getSettings?.()?.deviceId ??
      null;
    const idx = currentId ? list.findIndex((d) => d.deviceId === currentId) : -1;
    const next = list[(idx + 1 + list.length) % list.length];
    preferredVideoDeviceIdRef.current = next?.deviceId ?? null;
    retryCameraFromUserTap();
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
        try {
          await v.play();
        } catch {
          /* ensureCameraReady retries */
        }
        await ensureCameraReady();
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
            if ("vibrate" in navigator) navigator.vibrate(50);
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
    setAcceptTerms(false);
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
    setProcessingScanId(null);
    setProcessingReady(false);
    setScanPath("");
    stopProcessing();

    try {
      const secret = import.meta.env.VITE_UPLOAD_API_SECRET as string | undefined;

      const uploadLeft = selectRepresentativePhaseFrames(photosLeft, UPLOAD_PHOTOS_PER_PHASE);
      const uploadRight = selectRepresentativePhaseFrames(photosRight, UPLOAD_PHOTOS_PER_PHASE);

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
    <div className="absolute left-0 top-0 z-50 h-screen w-screen bg-black">{/* NO overflow-hidden: clips video compositor on Android Chrome */}
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

      {cameraState === "readyPhase" ? (
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
            id="neuma-live-video"
            autoPlay
            playsInline
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />

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

      {SIMPLE_ANDROID_CAMERA_MODE && cameraState === "readyPhase" ? (
        <div className="pointer-events-auto absolute left-3 top-14 z-[95] w-[min(92vw,20rem)] sm:left-4 sm:top-16">
          <div className="rounded-2xl border border-white/10 bg-black/45 p-3 text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
                  Camera debug
                </div>
                <div className="mt-1 truncate font-mono text-[11px] text-white/70">build {BUILD_TAG}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={retryCameraFromUserTap}
                  className="h-9 rounded-full border-white/15 bg-white/[0.04] px-3 text-[12px] font-semibold text-white/85 hover:bg-white/[0.07]"
                >
                  Riavvia
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={cycleSimpleCameraFromUserTap}
                  className="h-9 rounded-full border border-white/20 bg-white/12 px-3 text-[12px] font-semibold text-white hover:bg-white/18"
                >
                  Cambia
                </Button>
              </div>
            </div>
            <div className="mt-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-[11px] text-white/70">
              <pre className="whitespace-pre-wrap break-words font-mono">{cameraOverlayDiagnostics || "…"}</pre>
            </div>
            {simpleVideoDevices.length ? (
              <div className="mt-2 text-[11px] text-white/55">
                {simpleVideoDevices.length} camere rilevate
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Black camera fallback: force a user gesture */}
      {!NO_SCANNER_OVERLAYS && !SIMPLE_ANDROID_CAMERA_MODE && cameraState === "readyPhase" && !hasLivePreview ? (
        <div className="pointer-events-auto absolute inset-0 z-[92] flex items-center justify-center px-6">
          <div className="w-full max-w-md rounded-2xl border border-white/12 bg-black/45 p-6 text-center backdrop-blur-md">
            <div className="neuma-title text-xl font-semibold tracking-tight text-white">
              Attiva la fotocamera
            </div>
            <div className="mt-2 text-sm text-white/70">
              Su alcuni dispositivi serve un tap per mostrare l’anteprima.
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
              build {BUILD_TAG}
            </div>
            <div className="mt-5 flex flex-col gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  await forceOpenCameraFromGesture(currentFootRef.current ?? "LEFT");
                }}
                className="w-full rounded-full border border-white/25 bg-white/15 py-6 text-sm font-semibold text-white hover:bg-white/20"
              >
                Avvia fotocamera
              </Button>
              {cameraOverlayError ? (
                <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-left text-[11px] text-white/70">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                    Dettagli
                  </div>
                  <div className="mt-1 break-words font-mono">{cameraOverlayError}</div>
                </div>
              ) : null}
              <div className="rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-left text-[11px] text-white/65">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  Diagnostica
                </div>
                <pre className="mt-1 whitespace-pre-wrap break-words font-mono">
                  {cameraOverlayDiagnostics || "…"}
                </pre>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={resetTotal}
                className="w-full rounded-full border-white/15 bg-white/[0.04] py-5 text-sm font-semibold text-white/90 hover:bg-white/[0.07]"
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

      {/* Mirino + progresso 360° (overlay professionale) */}
      {!NO_SCANNER_OVERLAYS && cameraState === "readyPhase" ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2">
          {(() => {
            const r = 74;
            const c = 2 * Math.PI * r;
            const p = Math.max(0, Math.min(1, scanCaptureCoverageProgress));
            const dash = c * p;
            return (
              <div className="relative h-[190px] w-[190px]">
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 200" aria-hidden>
                  <defs>
                    <radialGradient id="neumaReticleGlow" cx="50%" cy="50%" r="60%">
                      <stop offset="0%" stopColor="rgba(0,0,0,0)" />
                      <stop offset="55%" stopColor="rgba(0,0,0,0)" />
                      <stop offset="100%" stopColor="rgba(0,0,0,0.18)" />
                    </radialGradient>
                  </defs>
                  <circle cx="100" cy="100" r="94" fill="url(#neumaReticleGlow)" />
                  <circle cx="100" cy="100" r="74" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2.5" />
                  <circle
                    cx="100"
                    cy="100"
                    r="74"
                    fill="none"
                    stroke="rgba(52,211,153,0.9)"
                    strokeWidth="4.2"
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${c - dash}`}
                    transform="rotate(-90 100 100)"
                    style={{
                      filter: footDetected ? "drop-shadow(0 0 10px rgba(52,211,153,0.35))" : "none",
                      opacity: footDetected ? 1 : 0.55,
                      transition: "opacity 180ms ease-out",
                    }}
                  />
                  {/* crosshair */}
                  <line x1="100" y1="18" x2="100" y2="34" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                  <line x1="100" y1="166" x2="100" y2="182" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                  <line x1="18" y1="100" x2="34" y2="100" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                  <line x1="166" y1="100" x2="182" y2="100" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
                  <circle cx="100" cy="100" r="3.5" fill="rgba(255,255,255,0.28)" />
                </svg>
                {isVideoRecording ? (
                  <div className="absolute left-1/2 top-[62%] -translate-x-1/2 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[10px] font-semibold tracking-[0.18em] text-white/80 backdrop-blur-[2px]">
                    REC
                  </div>
                ) : null}
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* Feedback AI: Motion Blur */}
      {!NO_SCANNER_OVERLAYS && cameraState === "readyPhase" && showMotionBlurWarning ? (
        <div className="pointer-events-none absolute left-1/2 top-[64%] z-[70] w-[min(92vw,26rem)] -translate-x-1/2 px-4">
          <div className="rounded-2xl border border-amber-200/25 bg-amber-500/10 px-4 py-3 text-center text-sm font-semibold text-amber-100 shadow-[0_20px_70px_rgba(0,0,0,0.45)] backdrop-blur-[2px]">
            Rallenta per una scansione migliore
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

      {scanOverlayEnabled ? (
        <div className="pointer-events-none absolute left-1/2 top-[9.5%] z-[95] mt-0.5 -translate-x-1/2 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none" aria-live="polite">
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-full border border-white/18 bg-black/35 px-3 py-1 text-xs font-semibold tracking-[0.12em] text-white/85 shadow-sm backdrop-blur-[2px] transition-[border-color,background-color,box-shadow] duration-500 ease-out motion-reduce:transition-none">
              {feetProgressLabel}
            </div>
            <div
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-medium tracking-[0.01em] shadow-sm backdrop-blur-[2px] transition-[border-color,background-color,color,box-shadow] duration-500 ease-out motion-reduce:transition-none",
                sheetDetectionState === "green"
                  ? "border-emerald-300/45 bg-emerald-500/10 text-emerald-100"
                  : sheetDetectionState === "yellow"
                    ? "border-amber-300/40 bg-amber-500/10 text-amber-100"
                    : "border-rose-300/38 bg-rose-500/10 text-rose-100"
              )}
            >
              {sheetStatusText}
            </div>
            {sheetPositionGuidanceText ? (
              <div className="max-w-[min(92vw,20rem)] rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-center text-sm font-semibold tracking-[0.02em] text-white shadow-lg backdrop-blur-[2px]">
                {sheetPositionGuidanceText}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {scanOverlayEnabled && captureReadiness === "green" ? (
        <div
          className="pointer-events-none absolute left-1/2 top-[19%] z-[96] w-[min(92vw,20rem)] -translate-x-1/2 px-3"
          aria-live="polite"
        >
          <div className="rounded-2xl border-2 border-emerald-300/60 bg-emerald-950/40 px-4 py-2.5 text-center text-base font-bold tracking-tight text-emerald-50 shadow-lg backdrop-blur-md sm:text-lg">
            Scansione OK
          </div>
        </div>
      ) : null}

      {scanOverlayEnabled && scanInstantCorrection ? (
        <div
          className="pointer-events-none absolute left-1/2 top-[19%] z-[96] w-[min(92vw,22rem)] -translate-x-1/2 px-3"
          aria-live="assertive"
        >
          <div
            className={cn(
              "rounded-2xl border-2 px-4 py-3 text-center text-base font-bold leading-snug shadow-lg backdrop-blur-md sm:text-lg",
              captureReadiness === "red"
                ? "border-rose-300/70 bg-rose-950/55 text-rose-50"
                : "border-amber-300/65 bg-amber-950/50 text-amber-50"
            )}
          >
            {scanInstantCorrection}
          </div>
        </div>
      ) : null}

      {scanOverlayEnabled ? (
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

      {scanOverlayEnabled ? (
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
        <ArucoMarkerPins
          videoRef={videoRef}
          containerRef={videoContainerRef}
          markerQuadsNorm={alignment.arucoMarkerQuadsNorm}
          visible={scanOverlayEnabled}
          locked={sheetReadyForCapture}
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
                  "radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 28%, rgba(0,0,0,0.12) 68%, rgba(0,0,0,0.24) 100%)";
                if (captureReadiness === "red")
                  return `${base}, radial-gradient(circle at 50% 45%, rgba(248,113,113,0.14) 0%, transparent 55%)`;
                if (captureReadiness === "yellow")
                  return `${base}, radial-gradient(circle at 50% 45%, rgba(251,191,36,0.12) 0%, transparent 55%)`;
                if (captureReadiness === "green")
                  return `${base}, radial-gradient(circle at 50% 45%, rgba(52,211,153,0.13) 0%, transparent 55%)`;
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
        {cameraState === "readyPhase" && (
          <div className="pointer-events-none absolute bottom-[4.2rem] left-1/2 z-[58] w-[min(90vw,520px)] -translate-x-1/2 px-3 sm:bottom-[4.9rem]">
            {/* Beginner animation: phone moving around the foot (2D, circular orbit). */}
            <div className="mx-auto mb-4 flex w-full flex-col items-center justify-center transition-opacity duration-500 ease-out motion-reduce:transition-none">
              <div
                className={cn(
                  "relative h-[5.5rem] w-[5.5rem] transition-[transform,filter] duration-500 ease-out motion-reduce:transition-none",
                  footDetected && scanOverlayEnabled && "neuma-orbit-premium-pulse"
                )}
              >
                <ScanCoverageSegmentRing
                  segmentCount={orbitBinsTarget}
                  filledBins={footScanCoverageBins}
                  currentAngleDeg={liveOrbitAngleDeg}
                  urgent={scanMovementGuidance != null}
                  className="absolute inset-0 h-full w-full"
                />
                {footDetected && scanOverlayEnabled && !footScanCoverageComplete ? (
                  <div
                    className="neuma-move-guide-spin pointer-events-none absolute inset-[7px] z-[11]"
                    role="img"
                    aria-label="Percorso circolare: muovi il telefono in senso orario intorno al piede"
                  >
                    <div className="absolute left-1/2 top-[1px] -translate-x-1/2">
                      <svg
                        width="26"
                        height="16"
                        viewBox="0 0 26 16"
                        className="drop-shadow-[0_0_10px_rgba(0,0,0,0.65)]"
                        aria-hidden
                      >
                        <path
                          d="M2.5 8h12.5M9.5 3.5L17 8l-7.5 4.5"
                          fill="none"
                          stroke={moveGuideArrowStroke}
                          strokeWidth="2.25"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </div>
                ) : null}
                <style>{`
                  @keyframes neumaOrbit360 {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                  .neuma-orbit-anim { animation: neumaOrbit360 2.2s linear infinite; }
                  @keyframes neumaMoveGuideOrbit {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                  .neuma-move-guide-spin {
                    animation: neumaMoveGuideOrbit 2.65s linear infinite;
                  }
                  @media (prefers-reduced-motion: reduce) {
                    .neuma-orbit-anim { animation: none; }
                    .neuma-move-guide-spin { animation: none; }
                  }
                `}</style>

                {/* foot target */}
                <div className="absolute left-1/2 top-1/2 h-8 w-10 -translate-x-1/2 -translate-y-1/2 rounded-[999px] border border-white/10 bg-white/[0.05]" />

                {/* orbit ring + phone */}
                <div className="neuma-orbit-anim absolute inset-[10px] flex items-center justify-center">
                  <div
                    className={cn(
                      "absolute inset-0 rounded-full border border-white/10",
                      beginnerNudgeActive && "border-[#fbbf24]/65 shadow-[0_0_22px_rgba(251,191,36,0.25)]"
                    )}
                  />

                  <div className="absolute left-1/2 top-1/2 h-0 w-0 -translate-x-1/2 -translate-y-1/2">
                    <div className="absolute left-1/2 top-[-2px] h-10 w-6 -translate-x-1/2 rounded-[10px] border border-white/15 bg-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                      <div className="absolute inset-x-1 top-2 h-[7px] rounded-[5px] bg-white/10" />
                      <div className="absolute bottom-1.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-white/15" />
                    </div>
                  </div>
                </div>
              </div>
              <div
                className="mt-1 max-w-[min(92vw,18rem)] text-center text-[11px] font-medium tabular-nums leading-snug text-white/80 sm:text-xs"
                aria-live="polite"
              >
                <span className="font-semibold text-emerald-200/95">
                  {footScanCoverageBins.size}
                </span>
                <span className="text-white/45"> / {orbitBinsTarget} settori</span>
                {footScanCoverageComplete ? (
                  <span className="text-emerald-200/90"> · Piede completo</span>
                ) : scanCaptureCoverageProgress < 1 ? (
                  <span className="text-white/60">
                    {" "}
                    · ancora da coprire: {orbitBinsTarget - footScanCoverageBins.size} settori
                  </span>
                ) : (
                  <span className="text-emerald-200/90"> · Giro angolare coperto</span>
                )}
              </div>
            </div>

            <div className="text-center" aria-live="polite">
              <motion.div
                key="scan-big"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="text-3xl font-semibold tracking-tight text-white drop-shadow-[0_1px_10px_rgba(0,0,0,0.55)] sm:text-4xl"
              >
                Gira intorno al piede
              </motion.div>
              <p className="mt-2 text-sm font-semibold text-white/75" aria-live="polite">
                {scanPrimaryPrompt}
              </p>
              {selfMode && scanMovementGuidance?.text ? (
                <p className="mt-2 text-sm font-medium text-white/60" aria-live="polite">
                  {scanMovementGuidance.text}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* phase content */}
        <AnimatePresence mode="wait">
          {cameraState === "betweenFeet" && (
            <motion.div
              key="betweenFeet"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              className="pointer-events-auto absolute inset-0 z-[90] flex items-center justify-center px-6"
            >
              <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-black/45 p-6 text-center backdrop-blur-[2px]">
                <div className="text-lg font-semibold tracking-tight text-white sm:text-xl">
                  Perfetto! Ora passa all&apos;altro piede
                </div>
                <div className="mt-4">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      void resumeToSecondFoot();
                    }}
                    className="w-full rounded-full border border-white/25 bg-white/15 py-6 text-sm font-semibold text-white hover:bg-white/20"
                  >
                    {`Scansiona piede ${secondFootLabel}`}
                  </Button>
                  {footSelectionWarning ? (
                    <div className="mt-3 text-sm font-medium text-amber-200/90">{footSelectionWarning}</div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          )}

          {cameraState === "starting" && (
            <motion.div
              key="starting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center px-6"
            >
              <div className="w-full max-w-lg text-center">
                <div className="text-sm font-medium text-white/90">Preparazione scansione continua</div>
                <motion.div
                  className="mt-3 text-base text-[#e5e5e5]"
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                >
                  Fotocamera dal vivo — nessuno scatto manuale
                </motion.div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={retryCameraFromUserTap}
                  className="mt-8 w-full rounded-full border border-white/25 bg-white/15 py-6 text-sm font-semibold text-white hover:bg-white/20"
                >
                  Non vedi l’anteprima? Tocca qui
                </Button>
              </div>
            </motion.div>
          )}

          {cameraState === "idle" && (
            <motion.div
              key="choose-foot"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center px-6"
            >
              <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-black/45 p-6 text-center backdrop-blur-[2px]">
                <div className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  Quale piede stai scansionando?
                </div>
                <p className="mt-3 text-sm leading-snug text-white/65">
                  Poi muovi solo il telefono: registrazione continua dal video, senza pulsante di scatto.
                </p>
                <div className="mt-5 flex flex-col gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => chooseFirstFootAndStart("LEFT")}
                    className="w-full rounded-full border border-white/25 bg-white/15 py-6 text-sm font-semibold text-white hover:bg-white/20"
                  >
                    Avvia fotocamera (piede sinistro)
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => chooseFirstFootAndStart("RIGHT")}
                    className="w-full rounded-full border border-white/25 bg-white/15 py-6 text-sm font-semibold text-white hover:bg-white/20"
                  >
                    Avvia fotocamera (piede destro)
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={retryCameraFromUserTap}
                    className="w-full rounded-full border-white/15 bg-white/[0.04] py-5 text-sm font-semibold text-white/90 hover:bg-white/[0.07]"
                  >
                    Se non si apre, tocca qui
                  </Button>
                  {footSelectionWarning ? (
                    <div className="mt-1 text-sm font-medium text-amber-200/90">{footSelectionWarning}</div>
                  ) : null}
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* review */}
        {cameraState === "review" && (
          <div className="pointer-events-none absolute inset-0 z-55 flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.24 }}
              className="w-full max-w-xl text-center"
            >
              <div className="text-sm font-medium text-white/90">Fatto</div>
              <div className="mt-1 text-xs text-white/70">Elaborazione</div>
            </motion.div>
          </div>
        )}

        {/* error overlay */}
        {cameraState === "error" && (
          <div className="absolute inset-0 z-60 flex items-center justify-center px-6">
            <div className="w-full max-w-xl rounded-2xl border border-red-400/20 bg-zinc-950/70 p-6 text-center backdrop-blur-md">
              <div className="font-mono text-xs tracking-[0.18em] text-red-200">ERRORE</div>
              <div className="mt-3 text-xs text-red-200/90">{error}</div>
              <div className="mt-5 flex flex-col gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={retryCameraFromUserTap}
                  className="h-auto w-full rounded-xl border border-white/20 bg-white/10 py-4 text-sm font-semibold text-white hover:bg-white/15"
                >
                  Riprova fotocamera
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetTotal}
                  className="h-auto w-full rounded-xl border-zinc-800 bg-zinc-900/50 px-6 py-4 font-mono text-lg tracking-[0.14em] text-zinc-100 backdrop-blur-md hover:bg-zinc-800 hover:text-zinc-100"
                >
                  RESET TOTALE
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* uploading/process */}
        {cameraState === "uploading" && (
          <div className="pointer-events-none absolute inset-0 z-[75] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24 }}
              className="text-center"
            >
              <div className="text-sm font-medium text-white/90">Elaborazione</div>
              <motion.div
                className="mt-1 text-xs text-white/70"
                animate={{ opacity: [0.45, 1, 0.45] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
              >
                Attendi
              </motion.div>
            </motion.div>
          </div>
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


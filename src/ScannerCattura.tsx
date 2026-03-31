"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FootCanvas from "./components/three/FootCanvas";
import FootTemplatePreviewCanvas from "./components/three/FootTemplatePreviewCanvas";
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
import { reconstructStableFootPointCloud, type PointCloud } from "./lib/reconstruction";
import { downsamplePointCloud } from "./lib/visualization/downsamplePointCloud";
import { getThreePerformanceProfile } from "./hooks/useThreePerformanceProfile";
import { yieldToMain } from "./lib/utils/yieldToMain";
import { type ScanPhaseId } from "./constants/scanCapturePhases";
import type { ScanMeshViewerStatus } from "./types/scanProcessing";
import { FOOT_VIEW_ZONE_TO_PHASE } from "./lib/scanner/footViewZoneClassifier";
import { sheetQuadCornersNormFromMarkerQuads } from "./lib/scanner/sheetQuadFromAruco";
import { estimateFootBBoxOverlapFractionOnPolygon } from "./lib/scanner/footOnSheetOverlap";
import { discardCameraStreamHandoff, takeCameraStreamHandoff } from "./lib/cameraStreamHandoff";
import { buildSmoothFootPointCloudMm } from "./lib/visualization/neutralFootTemplate";

type PhaseId = ScanPhaseId;

type Photo = {
  blob: Blob;
  url: string;
  /** Fase di scansione (0–3) a cui appartiene il frame (burst nascosto) */
  phaseId: PhaseId;
};

type Metrics = { footLengthMm: number; forefootWidthMm: number };
type FootId = "LEFT" | "RIGHT";

function buildFallbackFootPointCloudMm(metrics: Metrics): PointCloud {
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
  const [firstFootSelection, setFirstFootSelection] = useState<FootId | null>(null);
  const [footSelectionWarning, setFootSelectionWarning] = useState("");

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
  const [fps, setFps] = useState<number>(0);
  const [timerSeconds, setTimerSeconds] = useState<number>(0);
  const startAtRef = useRef<number>(0);

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
    footScanCoverageBins.size >= SCAN_ORBIT_ANGLE_BINS;
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
  const processingIntervalRef = useRef<number | null>(null);
  const processingCompletionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Simulazione generazione mesh dopo "VISUALIZZA 3D" (futuro polling API) */
  const meshGenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanMeshViewerStatus, setScanMeshViewerStatus] = useState<ScanMeshViewerStatus>("idle");
  const [meshPreviewUrl, setMeshPreviewUrl] = useState<string | null>(null);
  const [reconstructedCloud, setReconstructedCloud] = useState<PointCloud | null>(null);
  const [reconstructedMetrics, setReconstructedMetrics] = useState<Metrics | null>(null);
  const [scanValidationReady, setScanValidationReady] = useState(false);
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
    () => Math.min(1, footScanCoverageBins.size / SCAN_ORBIT_ANGLE_BINS),
    [footScanCoverageBins]
  );

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

  /** Colore freccia guida movimento (sempre visibile durante la scansione attiva). */
  const moveGuideArrowStroke = useMemo(() => {
    if (captureReadiness === "green") return "rgba(52,211,153,0.96)";
    if (captureReadiness === "yellow") return "rgba(251,191,36,0.95)";
    if (captureReadiness === "red") return "rgba(251,191,36,0.88)";
    return "rgba(255,255,255,0.9)";
  }, [captureReadiness]);

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
    if (captureReadiness === "green") {
      return `${base}, radial-gradient(circle at 50% 48%, rgba(52,211,153,0.28) 0%, rgba(16,185,129,0.07) 42%, transparent 58%)`;
    }
    if (captureReadiness === "yellow") {
      return `${base}, radial-gradient(circle at 50% 48%, rgba(251,191,36,0.24) 0%, transparent 56%)`;
    }
    if (captureReadiness === "red") {
      return `${base}, radial-gradient(ellipse 88% 74% at 50% 48%, rgba(248,113,113,0.22) 0%, transparent 68%)`;
    }
    return base;
  }, [scanOverlayEnabled, captureReadiness]);

  const scanFeedbackOverlayShadow = useMemo(() => {
    if (!scanOverlayEnabled) return undefined;
    if (captureReadiness === "green") return "inset 0 0 100px rgba(52,211,153,0.18)";
    if (captureReadiness === "red") return "inset 0 0 100px rgba(248,113,113,0.12)";
    if (captureReadiness === "yellow") return "inset 0 0 85px rgba(251,191,36,0.12)";
    return undefined;
  }, [scanOverlayEnabled, captureReadiness]);

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
    stopStream();
    setCameraState("visualizing");
    setScanMeshViewerStatus("processing");
    void (async () => {
      try {
        await yieldToMain();
        const perf = getThreePerformanceProfile();
        const reconLeft = selectRepresentativePhaseFrames(photosLeft, reconPhotosPerPhase);
        const reconRight = selectRepresentativePhaseFrames(photosRight, reconPhotosPerPhase);
        const reconItems = [...reconLeft, ...reconRight].map((p) => ({
          blob: p.blob,
          phaseId: p.phaseId,
        }));

        if (!reconItems.length) {
          throw new Error("Nessuna foto disponibile per la ricostruzione");
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

        const result = await reconstructStableFootPointCloud({
          frames: reconItems,
          metricScaleFactor,
          options: {
            maxImageSide: mobile ? 256 : 320,
            sampleStep: mobile ? 4 : 3,
            mergeVoxelMm: mobile ? 5.8 : 5,
            multiViewRefinementIterations: mobile ? 1 : 2,
            phaseWeightedMerge: true,
            // Lato calzature: pulizia/aggressivita default già pensate per stabilita.
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
        const fallback = buildFallbackFootPointCloudMm(fallbackMetrics);
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
      await acquireCameraStream();
      void requestOrientationAccess();
      setCameraState("readyPhase");
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setCameraState("error");
      setError(`ERRORE_CAMERA // ${err?.name || "Error"}: ${err?.message || String(e)}`);
      stopStream();
    }
  };

  /** Ripresa affidabile su iOS: tap esplicito se l’auto-avvio non parte o secondo getUserMedia fallisce. */
  const retryCameraFromUserTap = () => {
    discardCameraStreamHandoff();
    stopStream();
    autoStartOnceRef.current = false;
    const startFoot = firstFootSelectionRef.current;
    if (!startFoot) return;
    void startCamera(startFoot);
  };

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
      await acquireCameraStream();
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
        captureAngleBinsUsedRef.current.add(captureAngleBinIndex(dirNow, CAPTURE_ANGLE_BIN_COUNT));
        lastCaptureDirectionRef.current = dirNow;
        const seg = captureAngleBinIndex(dirNow, SCAN_ORBIT_ANGLE_BINS);
        setFootScanCoverageBins((prev) => {
          if (prev.has(seg)) return prev;
          const next = new Set(prev);
          next.add(seg);
          if (next.size >= SCAN_ORBIT_ANGLE_BINS) {
            if (currentFootRef.current === "LEFT") setOrbitCompleteLeft(true);
            else setOrbitCompleteRight(true);
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

  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    if (footScanCoverageComplete) return;

    const intervalId = window.setInterval(() => {
      if (cameraStateRef.current !== "readyPhase") return;
      if (footScanCoverageCompleteRef.current) return;
      if (!continuousCaptureAllowedRef.current) return;
      if (burstInFlightRef.current) return;
      void runContinuousCapture();
    }, CONTINUOUS_CAPTURE_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [cameraState, footScanCoverageComplete, runContinuousCapture]);

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
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-black">
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
          <div className="flex items-center gap-2 rounded-full border border-white/18 bg-black/55 py-1.5 pl-2.5 pr-3 shadow-lg backdrop-blur-md transition-opacity duration-500 ease-out">
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
          className={cn(
            "absolute inset-0 z-0 overflow-hidden transition-[filter] duration-500 ease-out",
            scanOverlayEnabled &&
              footDetected &&
              cameraState === "readyPhase" &&
              "neuma-scan-video-alive",
            // Keep camera visible always (minimal UX).
            cameraState === "betweenFeet" && "pointer-events-none opacity-100"
          )}
        >
          <video
            ref={videoRef}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-[opacity,transform,filter] duration-150 ease-out motion-reduce:transition-none",
              scanOverlayEnabled &&
                cameraState === "readyPhase" &&
                (captureReadiness === "green"
                  ? "brightness-[1.06] contrast-[1.05]"
                  : footDetected && "brightness-[1.02] contrast-[1.02]")
            )}
            autoPlay
            playsInline
            muted
          />
        </div>
      )}

      <AnimatePresence>
        {footScanDoneVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="pointer-events-none absolute inset-0 z-[93] flex flex-col items-center justify-center bg-black/45 backdrop-blur-[2px]"
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
                  segmentCount={SCAN_ORBIT_ANGLE_BINS}
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
                <span className="text-white/45"> / {SCAN_ORBIT_ANGLE_BINS} settori</span>
                {footScanCoverageComplete ? (
                  <span className="text-emerald-200/90"> · Piede completo</span>
                ) : scanCaptureCoverageProgress < 1 ? (
                  <span className="text-white/60">
                    {" "}
                    · ancora da coprire: {SCAN_ORBIT_ANGLE_BINS - footScanCoverageBins.size} settori
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
                Muovi il telefono intorno al piede
              </motion.div>
              <p className="mt-2 text-sm font-medium text-white/70">
                Acquisizione continua dal video — non serve premere nulla
              </p>
              {captureReadiness === "green" ? (
                <p className="mt-3 text-sm font-medium text-emerald-200/90">
                  Continua a muoverti lentamente intorno al piede
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
                    Piede sinistro
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => chooseFirstFootAndStart("RIGHT")}
                    className="w-full rounded-full border border-white/25 bg-white/15 py-6 text-sm font-semibold text-white hover:bg-white/20"
                  >
                    Piede destro
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
          <div className="absolute inset-0 z-80 flex items-center justify-center bg-black px-4">
            <div className="w-full max-w-xl">
              {(() => {
                switch (scanMeshViewerStatus) {
                  case "idle":
                  case "completing":
                    return (
                      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
                        <motion.div
                          className="text-3xl font-semibold tracking-tight text-white"
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
                        >
                          Creazione in corso
                        </motion.div>
                      </div>
                    );
                  case "processing":
                    return (
                      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
                        <motion.div
                          className="text-3xl font-semibold tracking-tight text-white"
                          animate={{ opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
                        >
                          Creazione in corso
                        </motion.div>
                      </div>
                    );
                  case "ready":
                    return (
                      <div className="relative">
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ duration: 0.45, ease: "easeOut" }}
                          className="h-[360px] w-full overflow-hidden rounded-xl border border-white/10 bg-black/20"
                        >
                          {/* Never render raw point cloud directly: always use parametric template model. */}
                          <FootTemplatePreviewCanvas
                            cloud={
                              reconstructedCloud ??
                              buildFallbackFootPointCloudMm(reconstructedMetrics ?? DEFAULT_METRICS)
                            }
                          />
                        </motion.div>
                        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-5">
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.24, ease: "easeOut" }}
                            className="pt-1 text-center"
                          >
                            <div className="text-2xl font-semibold tracking-tight text-white">Scansione completata</div>
                            <div className="mt-1 text-sm text-[#e5e5e5]">Calzata acquisita</div>
                          </motion.div>
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.24, delay: 0.05, ease: "easeOut" }}
                            className="mx-auto flex w-full max-w-[300px] flex-col items-center gap-2"
                          >
                            {/* no buttons: l'uscita dalla visualizzazione avviene tramite chiusura del dialog */}
                          </motion.div>
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
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}


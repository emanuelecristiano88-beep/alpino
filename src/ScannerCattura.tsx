"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Canvas } from "@react-three/fiber";
import FootCanvas from "../components/three/FootCanvas";
import FootPointCloudPreview from "../components/three/FootPointCloudPreview";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Label } from "./components/ui/label";
import { cn } from "./lib/utils";
import { PAIR_STORAGE_KEY, SCAN_METRICS_STORAGE_KEY } from "./constants/scan";
import { useScanAlignmentAnalysis } from "./hooks/useScanAlignmentAnalysis";
import { requestOrientationAccess, useDeviceTilt } from "./hooks/useDeviceTilt";
import { useScanFrameOrientation } from "./hooks/useScanFrameOrientation";
import ScannerAlignmentOverlay from "./components/scanner/ScannerAlignmentOverlay";
import ScanPhaseGuideIllustration from "./components/scanner/ScanPhaseGuideIllustration";
import ArucoMarkerPins from "./components/scanner/ArucoMarkerPins";
import BiometryOverlayPreview from "./components/scanner/BiometryOverlayPreview";
import { computeNeumaBiometryFromImageData, type NeumaBiometryResult } from "./lib/biometry";
import type { Mat3 } from "./lib/biometry/homography";
import { ensureArucoDetector, detectArucoOnImageDataMultiDictionary } from "./lib/aruco/arucoWasm";
import { pickCornerMarkers, type ArucoMarkerDetection, type ArucoMarkerPoint } from "./lib/aruco/a4MarkerGeometry";
import { reconstructFootFromBlobs, type PointCloud } from "./lib/reconstruction";
import { Check, Loader2, Smartphone } from "lucide-react";
import { SCAN_CAPTURE_PHASES, type ScanPhaseId } from "./constants/scanCapturePhases";
import type { ScanMeshViewerStatus } from "./types/scanProcessing";

type PhaseId = ScanPhaseId;

type Photo = {
  blob: Blob;
  url: string;
  /** Fase di scansione (0–3) a cui appartiene il frame (burst nascosto) */
  phaseId: PhaseId;
};

type Metrics = { footLengthMm: number; forefootWidthMm: number };
type FootId = "LEFT" | "RIGHT";

/** Allineamento “perfetto” stabile per questo tempo → avvio automatico burst */
const STABLE_ALIGNMENT_MS = 800;
/** Intervallo tra frame del burst nascosto (solo backend, nessun feedback visivo per frame) */
const BURST_FRAME_GAP_MS = 70;
const PHASE_COUNTDOWN_START = 2;
const PHASE_SUCCESS_HOLD_MS = 650;
const INLINE_REFERENCE_MS = 1800;
const PHOTOS_PER_PHASE = 8;
const TOTAL_PHOTOS = PHOTOS_PER_PHASE * 4;
/** Upload cloud: sottoinsieme per fase per ridurre timeout serverless (es. 3 x 4 x 2 piedi = 24 foto). */
const UPLOAD_PHOTOS_PER_PHASE = 3;
const RECON_PHOTOS_PER_PHASE_DEFAULT = 4;
const RECON_PHOTOS_PER_PHASE_FAST = 5;
const LIVE_MIN_ARUCO_MARKERS = 1;
const ARUCO_MARKER_SIZE_MM = Number(import.meta.env.VITE_ARUCO_MARKER_SIZE_MM || 40);
const MIN_ARUCO_SHARPNESS = 45;
const MIN_FULL_ARUCO_PER_FOOT = 2;
const MAX_OUTPUT_DIM = 1024; // compress before upload, keep aspect ratio
const JPEG_QUALITY = 0.5; // aggressive JPEG quality for upload
const MAX_UPLOAD_FILE_BYTES = 200 * 1024; // target < 200KB
const DEFAULT_METRICS: Metrics = { footLengthMm: 265, forefootWidthMm: 95 };

const PHASES = SCAN_CAPTURE_PHASES;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function formatMmSs(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

async function playClick(audioCtxRef: React.MutableRefObject<AudioContext | null>) {
  try {
    const AudioContextCtor =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return;

    if (!audioCtxRef.current) audioCtxRef.current = new AudioContextCtor();
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }

    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.value = 1300;

    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.07);
  } catch {
    // ignore audio errors
  }
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

function selectRepresentativePhaseFrames<T>(frames: T[], perPhase: number): T[] {
  if (perPhase >= PHOTOS_PER_PHASE) return frames.slice();
  const picks = [1, 4, 7]; // inizio/medio/fine del burst fase
  const maxPerPhase = Math.max(1, Math.min(perPhase, picks.length));
  const selected: T[] = [];
  const phaseCount = Math.floor(frames.length / PHOTOS_PER_PHASE);
  for (let p = 0; p < phaseCount; p++) {
    const base = p * PHOTOS_PER_PHASE;
    for (let i = 0; i < maxPerPhase; i++) {
      const idx = base + picks[i];
      if (idx >= base && idx < base + PHOTOS_PER_PHASE && idx < frames.length) {
        selected.push(frames[idx]);
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

function markerSharpnessScore(imageData: ImageData, marker: ArucoMarkerDetection): number {
  const xs = marker.corners.map((p) => p.x);
  const ys = marker.corners.map((p) => p.y);
  const pad = 8;
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  const x1 = Math.min(imageData.width - 1, Math.ceil(Math.max(...xs) + pad));
  const y1 = Math.min(imageData.height - 1, Math.ceil(Math.max(...ys) + pad));
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const gray = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  };
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const center = gray(x, y);
      const lap = gray(x - 1, y) + gray(x + 1, y) + gray(x, y - 1) + gray(x, y + 1) - 4 * center;
      n += 1;
      sum += lap;
      sumSq += lap * lap;
    }
  }
  if (n < 8) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);

  const [cameraState, setCameraState] = useState<
    | "idle"
    | "starting"
    | "readyPhase"
    | "capturingPhase"
    | "betweenFeet"
    | "review"
    | "uploading"
    | "visualizing"
    | "error"
  >("idle");

  /** Prima il piede sinistro, poi il destro (stesso ordine / stessa sessione). */
  const [currentFoot, setCurrentFoot] = useState<FootId>("LEFT");
  const [photosLeft, setPhotosLeft] = useState<Photo[]>([]);
  const [photosRight, setPhotosRight] = useState<Photo[]>([]);
  const [error, setError] = useState<string>("");
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [scanId, setScanId] = useState<string>("");
  const [scanPath, setScanPath] = useState<string>("");
  const [fps, setFps] = useState<number>(0);
  const [timerSeconds, setTimerSeconds] = useState<number>(0);
  const startAtRef = useRef<number>(0);

  // guided phases
  const [phaseIndex, setPhaseIndex] = useState<PhaseId>(0);
  const phase = PHASES[phaseIndex];
  const [capturedInPhase, setCapturedInPhase] = useState<number>(0);
  /** Tutorial opzionale: il flusso scanner non deve dipendere da questo stato. */
  const phaseGuideAccepted = true;

  const photos = useMemo(() => [...photosLeft, ...photosRight], [photosLeft, photosRight]);
  const pairComplete = photosLeft.length === TOTAL_PHOTOS && photosRight.length === TOTAL_PHOTOS;

  const [flashNonce, setFlashNonce] = useState(0);
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
  const [showInlineReference, setShowInlineReference] = useState(true);
  const currentFootRef = useRef<FootId>("LEFT");
  const autoStartedPhaseRef = useRef<number>(-1);
  const startBurstSequenceRef = useRef<() => void>(() => {});
  /** Evita doppio avvio fase (Strict Mode / effetto + click). */
  const capturePhaseLockRef = useRef(false);
  const phaseIndexRef = useRef<PhaseId>(phaseIndex);
  const burstInFlightRef = useRef(false);
  const burstCancelledRef = useRef(false);
  /** Countdown 3…2…1 prima del burst (una percezione utente per fase) */
  const [burstCountdown, setBurstCountdown] = useState<number | null>(null);
  /** Durante i 8 frame: lampi leggeri + pulse (senza numeri) */
  const [burstMidCapture, setBurstMidCapture] = useState(false);
  const [burstMicroNonce, setBurstMicroNonce] = useState(0);
  /** Dopo il burst: check + messaggio prima di avanzare fase */
  const [showAcquisitionComplete, setShowAcquisitionComplete] = useState(false);
  const prevCameraStateRef = useRef(cameraState);
  useEffect(() => {
    currentFootRef.current = currentFoot;
  }, [currentFoot]);

  useEffect(() => {
    phaseIndexRef.current = phaseIndex;
  }, [phaseIndex]);

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
      const candidates = [7, 15, 23, 31, 8, 16, 24, 0, 4, 12];
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

  const scanOverlayEnabled = cameraState === "readyPhase" || cameraState === "capturingPhase";
  const alignment = useScanAlignmentAnalysis(videoRef, scanOverlayEnabled, phaseIndex);
  const frameTilt = useScanFrameOrientation(scanOverlayEnabled);
  const shouldEnforceVerticalTilt = phaseIndex !== 0;
  const arucoRecognized =
    alignment.arucoEngine === "ready" &&
    alignment.markerCentersNorm != null &&
    alignment.markerCentersNorm.length >= LIVE_MIN_ARUCO_MARKERS;
  const captureReady = alignment.guide === "aligned" && arucoRecognized;
  const reconPhotosPerPhase = useMemo(() => {
    if (typeof navigator === "undefined") return RECON_PHOTOS_PER_PHASE_DEFAULT;
    const cores = navigator.hardwareConcurrency ?? 4;
    const maybeMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    return cores >= 6 && maybeMem >= 4
      ? RECON_PHOTOS_PER_PHASE_FAST
      : RECON_PHOTOS_PER_PHASE_DEFAULT;
  }, []);
  const { tooTilted } = useDeviceTilt(
    (cameraState === "readyPhase" || cameraState === "capturingPhase") && shouldEnforceVerticalTilt,
    45
  );

  useEffect(() => {
    const prev = prevCameraStateRef.current;
    prevCameraStateRef.current = cameraState;
    if (cameraState === "readyPhase" && prev !== "readyPhase") {
      capturePhaseLockRef.current = false;
    }
  }, [cameraState]);

  useEffect(() => {
    if (cameraState !== "readyPhase") {
      setShowInlineReference(false);
      return;
    }
    setShowInlineReference(true);
    const t = window.setTimeout(() => setShowInlineReference(false), INLINE_REFERENCE_MS);
    return () => window.clearTimeout(t);
  }, [cameraState, phaseIndex, currentFoot]);

  /** Una tacca per fase (4): percezione 1 acquisizione / fase, 8 frame nascosti sotto */
  const progressTacks = useMemo(() => {
    return Array.from({ length: 4 }, (_, i) => i < phaseIndex);
  }, [phaseIndex]);

  const cancelBurstSequence = () => {
    burstCancelledRef.current = true;
    burstInFlightRef.current = false;
    setBurstCountdown(null);
    setBurstMidCapture(false);
    setShowAcquisitionComplete(false);
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
    stopStream();
    setCameraState("visualizing");
    setScanMeshViewerStatus("processing");
    void (async () => {
      try {
        const reconLeft = selectRepresentativePhaseFrames(photosLeft, reconPhotosPerPhase);
        const reconRight = selectRepresentativePhaseFrames(photosRight, reconPhotosPerPhase);
        const reconItems = [...reconLeft, ...reconRight].map((p) => ({
          blob: p.blob,
          phaseId: p.phaseId,
        }));

        if (!reconItems.length) {
          throw new Error("Nessuna foto disponibile per la ricostruzione");
        }

        const result = await reconstructFootFromBlobs(reconItems, {
          maxImageSide: 220,
          sampleStep: 3,
          voxelSizeMm: 5,
          multiViewRefinementIterations: 2,
        });

        if (!result.cloud?.pointCount) {
          throw new Error("Point cloud vuota");
        }

        setReconstructedCloud(result.cloud);
        setMeshPreviewUrl("/local/reconstructed-point-cloud");
        setScanMeshViewerStatus("ready");
      } catch (e) {
        console.error("[ScannerCattura] reconstruction", e);
        setScanMeshViewerStatus("error");
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

    processingIntervalRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const ratio = clamp(elapsed / durationMs, 0, 1);
      const next = ratio * 100;

      setProcessingProgress(next);

      if (ratio >= 1) {
        stopProcessing();
        setProcessingProgress(100);
        setProcessingReady(true);
      }
    }, 50);

    // Failsafe: alcuni device possono clamping/tick rate; garantiamo comunque lo stato finale.
    processingCompletionTimeoutRef.current = window.setTimeout(() => {
      stopProcessing();
      setProcessingProgress(100);
      setProcessingReady(true);
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

  // FPS + timer while capturing
  useEffect(() => {
    if (cameraState !== "capturingPhase") return;

    let raf = 0;
    let frames = 0;
    const fpsWindowStart = performance.now();

    const tick = () => {
      frames += 1;
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);

    const t0 = Date.now();
    const timerId = window.setInterval(() => {
      setTimerSeconds((_) => (Date.now() - t0) / 1000);
    }, 250);

    const fpsTimer = window.setInterval(() => {
      const elapsed = performance.now() - fpsWindowStart;
      const currentFps = (frames / elapsed) * 1000;
      setFps(Math.round(currentFps));
      frames = 0;
    }, 1000);

    return () => {
      window.clearInterval(timerId);
      window.clearInterval(fpsTimer);
      window.cancelAnimationFrame(raf);
    };
  }, [cameraState]);

  const ensureCameraReady = async () => {
    const videoEl = videoRef.current;
    if (!videoEl) throw new Error("Video element assente.");

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
      const hasFrame = videoEl.videoWidth > 0 && videoEl.readyState >= 2;
      if (hasFrame) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("La fotocamera è attiva ma non arriva il frame.");
  };

  const acquireCameraStream = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia non disponibile. Usa HTTPS/localhost.");
    }

    if (streamRef.current) stopStream();

    const getStream = async (videoConstraints: unknown) =>
      navigator.mediaDevices.getUserMedia({
        video: videoConstraints as MediaTrackConstraints,
        audio: false,
      });

    if (!videoRef.current) throw new Error("Video element assente.");
    const video = videoRef.current;
    const candidates: Array<MediaTrackConstraints | true> = [
      { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: { ideal: "environment" }, width: { ideal: 960 }, height: { ideal: 540 } },
      true,
    ];

    let lastErr: unknown = null;
    for (const c of candidates) {
      let stream: MediaStream | null = null;
      try {
        stream = await getStream(c);
        streamRef.current = stream;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).srcObject = stream;
        video.playsInline = true;
        video.muted = true;
        // Needed by some mobile browsers to avoid fullscreen/blank-frame transitions.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (video as any).setAttribute?.("webkit-playsinline", "true");
        video.autoplay = true;

        try {
          await video.play();
        } catch {
          // Some browsers reject first call before metadata; ensureCameraReady retries play().
        }

        await ensureCameraReady();
        return;
      } catch (e) {
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

  const startCamera = async () => {
    cancelBurstSequence();
    setError("");
    setCameraState("starting");
    setCurrentFoot("LEFT");
    currentFootRef.current = "LEFT";
    setPhaseIndex(0);
    setCapturedInPhase(0);
    cleanupPhotos();
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PAIR_STORAGE_KEY);
    autoStartedPhaseRef.current = -1;
    setFlashNonce(0);
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

  const resumeToRightFoot = async () => {
    cancelBurstSequence();
    setError("");
    setCameraState("starting");
    setCurrentFoot("RIGHT");
    currentFootRef.current = "RIGHT";
    setPhaseIndex(0);
    setCapturedInPhase(0);
    autoStartedPhaseRef.current = -1;
    setFlashNonce(0);
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

  /**
   * Countdown 3→2→1, poi burst 8 frame con lampi/vibrazione leggeri (non ripetitivo),
   * overlay “Acquisizione completata” + checkmark, poi `capturedInPhase = 8`.
   */
  const beginPhaseBurstSequence = () => {
    if (!videoRef.current) return;
    if (!captureReady) return;
    if (burstInFlightRef.current) return;
    if (cameraState !== "readyPhase") return;

    burstCancelledRef.current = false;
    burstInFlightRef.current = true;
    capturePhaseLockRef.current = true;
    autoStartedPhaseRef.current = phaseIndex;

    setError("");
    setCameraState("capturingPhase");

    const pid = phaseIndexRef.current;

    void (async () => {
      try {
        for (let n = PHASE_COUNTDOWN_START; n >= 1; n--) {
          if (burstCancelledRef.current) return;
          setBurstCountdown(n);
          await sleep(1000);
        }
        if (burstCancelledRef.current) return;
        setBurstCountdown(null);

        const batch: Photo[] = [];
        const foot = currentFootRef.current;
        const video = videoRef.current;
        if (!video) return;

        setBurstMidCapture(true);
        for (let i = 0; i < PHOTOS_PER_PHASE; i++) {
          if (burstCancelledRef.current) return;
          setBurstMicroNonce((n) => n + 1);
          if (navigator.vibrate) navigator.vibrate(6);

          const blob = await captureFrameAsJpeg(video);
          if (!blob) continue;
          batch.push({
            blob,
            url: URL.createObjectURL(blob),
            phaseId: pid,
          });
          if (i < PHOTOS_PER_PHASE - 1) await sleep(BURST_FRAME_GAP_MS);
        }
        setBurstMidCapture(false);

        if (burstCancelledRef.current) return;

        if (batch.length < PHOTOS_PER_PHASE) {
          setError("Acquisizione incompleta. Riprova.");
          setCameraState("readyPhase");
          return;
        }

        const append = (prev: Photo[]) => {
          if (prev.length + batch.length > TOTAL_PHOTOS) return prev;
          return [...prev, ...batch];
        };
        if (foot === "LEFT") setPhotosLeft(append);
        else setPhotosRight(append);

        setShowAcquisitionComplete(true);
        setFlashNonce((n) => n + 1);
        if (navigator.vibrate) navigator.vibrate([10, 45, 15]);
        await playClick(audioCtxRef);

        await sleep(PHASE_SUCCESS_HOLD_MS);
        if (burstCancelledRef.current) return;
        setCapturedInPhase(PHOTOS_PER_PHASE);
      } catch {
        if (!burstCancelledRef.current) {
          setError("Errore durante l'acquisizione. Riprova.");
          setCameraState("readyPhase");
        }
      } finally {
        burstInFlightRef.current = false;
        setBurstCountdown(null);
        setBurstMidCapture(false);
        setShowAcquisitionComplete(false);
      }
    })();
  };

  startBurstSequenceRef.current = beginPhaseBurstSequence;

  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    if (!captureReady) return;
    if (alignment.stableAlignedMs < STABLE_ALIGNMENT_MS) return;
    if (autoStartedPhaseRef.current === phaseIndex) return;
    if (!videoRef.current) return;
    if (burstInFlightRef.current) return;
    startBurstSequenceRef.current();
  }, [cameraState, alignment.stableAlignedMs, phaseIndex, captureReady]);

  // stop phase when reached 8
  useEffect(() => {
    if (cameraState !== "capturingPhase") return;
    if (capturedInPhase < PHOTOS_PER_PHASE) return;

    stopCapture();

    const nextPhase = (phaseIndex + 1) as PhaseId;
    if (phaseIndex === 3) {
      stopStream();
      if (currentFootRef.current === "LEFT") {
        setCameraState("betweenFeet");
        return;
      }
      setCameraState("review");
      return;
    }

    setPhaseIndex(nextPhase);
    setCapturedInPhase(0);
    setCameraState("readyPhase");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturedInPhase, cameraState, phaseIndex]);

  const resetTotal = () => {
    stopStream();
    cleanupPhotos();
    stopProcessing();
    setCurrentFoot("LEFT");
    currentFootRef.current = "LEFT";
    setPhaseIndex(0);
    setCapturedInPhase(0);
    setFlashNonce(0);
    setError("");
    setProcessingProgress(0);
    setProcessingScanId(null);
    setProcessingReady(false);
    setProcessingStatusText("");
    setScanPath("");
    setTimerSeconds(0);
    setFps(0);
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PAIR_STORAGE_KEY);
    autoStartedPhaseRef.current = -1;
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
          throw new Error(`upload-single fallito (${res.status}) foto ${i + 1}/${items.length}. ${text}`);
        }
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new Error(`Risposta upload-single non valida (foto ${i + 1}/${items.length})`);
        }
        if (data.ok !== true || data.driveUploaded !== true) {
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
      setScanPath(driveFolderLink || "/scans/drive");
      setError("");
      setProcessingStatusText("Upload completato. Avvio elaborazione modello...");

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
      setCameraState("review");
      setError(`ERRORE_UPLOAD // ${msg}`);
    }
  };

  const techBadgeClass =
    "rounded-xl border border-white/10 bg-black/50 px-3 py-2 font-mono text-[10px] tracking-[0.16em] text-zinc-300";
  const accentBadgeClass = "text-blue-500";

  const phaseCardClass =
    "w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl shadow-black/40";

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-black">
      {cameraState !== "visualizing" && (
        <div
          ref={videoContainerRef}
          className={cn(
            "absolute inset-0 z-0 overflow-hidden",
            cameraState === "betweenFeet" && "pointer-events-none opacity-0"
          )}
        >
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
            autoPlay
            playsInline
            muted
          />
        </div>
      )}

      {/* flash border */}
      {cameraState !== "visualizing" && cameraState !== "betweenFeet" && (
        <div key={flashNonce} className="flash-border pointer-events-none" />
      )}

      {/* Lampo rapido per ogni frame del burst (leggero, non “8 scatti” espliciti) */}
      {cameraState === "capturingPhase" && burstMidCapture && (
        <div key={burstMicroNonce} className="burst-micro-flash pointer-events-none absolute inset-0 z-[82]" />
      )}
      {/* Pulse sottile sul frame durante il burst */}
      {cameraState === "capturingPhase" && burstMidCapture && (
        <div
          className="pointer-events-none absolute inset-0 z-[13] animate-pulse bg-sky-400/[0.06]"
          aria-hidden
        />
      )}

      {/* Overlay: bbox che segue il giroscopio + marker ArUco — solo dopo conferma guida */}
      {scanOverlayEnabled ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
            <ScannerAlignmentOverlay
              alignment={alignment}
              frameTilt={frameTilt}
              phaseIndex={phaseIndex}
            />
          </div>
          <ArucoMarkerPins
            videoRef={videoRef}
            containerRef={videoContainerRef}
            markerCentersNorm={alignment.markerCentersNorm}
            visible={alignment.markerCentersNorm != null && alignment.markerCentersNorm.length >= LIVE_MIN_ARUCO_MARKERS}
          />
        </>
      ) : null}

      {tooTilted &&
        shouldEnforceVerticalTilt &&
        (cameraState === "readyPhase" || cameraState === "capturingPhase") &&
         (
        <div className="pointer-events-none absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/50 px-6">
          <motion.div
            animate={{ rotate: [28, 0, 28] }}
            transition={{ duration: 1.85, repeat: Infinity, ease: "easeInOut" }}
            className="flex justify-center"
          >
            <Smartphone className="h-16 w-16 text-sky-400" strokeWidth={1.25} />
          </motion.div>
          <p className="mt-6 max-w-xs text-center font-mono text-sm font-bold uppercase tracking-[0.2em] text-sky-400">
            TIENI IL TELEFONO VERTICALE
          </p>
        </div>
      )}

      {/* contract whole UI on each capture */}
      <motion.div
        key={flashNonce}
        initial={{ scale: 1 }}
        animate={{ scale: [1, 0.98, 1] }}
        transition={{ duration: 0.06, ease: "easeOut" }}
        className="absolute inset-0 z-50"
      >
        {/* Angoli: nessun conteggio foto in sessione (percezione “un colpo” per fase) */}
        <div className="pointer-events-none absolute left-0 top-0 z-[85] flex max-w-[min(85vw,280px)] flex-col gap-1.5 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
          {(cameraState === "capturingPhase" || cameraState === "readyPhase") && (
            <div className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300 backdrop-blur-[1px]">
              {currentFoot === "LEFT" ? "Piede sinistro" : "Piede destro"}
            </div>
          )}
          {(cameraState === "capturingPhase" || cameraState === "readyPhase") && (
            <div className="text-[10px] text-white/60">Muovi il telefono</div>
          )}
          {(cameraState === "capturingPhase" || cameraState === "readyPhase") && (
            <div className="text-[10px] text-white/45">Non muoverti</div>
          )}
          {cameraState !== "capturingPhase" && cameraState !== "readyPhase" ? (
            <div className={`${techBadgeClass} py-1.5 text-[9px] text-zinc-500`}>NEUMA · PHOTOGRAMMETRY</div>
          ) : null}
        </div>
        {cameraState !== "capturingPhase" && cameraState !== "readyPhase" && (
          <div className="pointer-events-none absolute right-0 top-0 z-[85] flex flex-col items-end gap-1.5 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] text-right">
            <div className={`${techBadgeClass} py-1.5 text-[9px]`}>
              <span className={accentBadgeClass}>SCAN</span> {scanId ? scanId.slice(0, 8) : "—"}
            </div>
          </div>
        )}

        {/* Istruzione fase: grande, leggibile, fascia scura semitrasparente (non a tutto schermo) */}
        {(cameraState === "readyPhase" || cameraState === "capturingPhase") &&
          alignment.guide === "too_close" && (
          <div className="pointer-events-none absolute left-3 top-[6.25rem] z-[86] max-w-[min(90vw,340px)] rounded-lg border border-amber-500/50 bg-amber-950/70 px-3 py-2 text-[11px] font-semibold uppercase leading-snug tracking-wide text-amber-100 shadow-lg sm:text-xs">
            Più lontano
          </div>
        )}
        {(cameraState === "readyPhase" || cameraState === "capturingPhase") &&
          captureReady && (
          <div className="pointer-events-none absolute left-3 top-[6.25rem] z-[86] rounded-lg border border-emerald-500/45 bg-emerald-950/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
            Perfetto
          </div>
        )}
        {(cameraState === "readyPhase" || cameraState === "capturingPhase") &&
          !captureReady && (
          <div className="pointer-events-none absolute left-3 top-[8.6rem] z-[86] rounded-lg border border-sky-500/45 bg-sky-950/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-sky-100">
            {alignment.arucoEngine !== "ready"
              ? "Ci siamo"
              : alignment.markerCount >= LIVE_MIN_ARUCO_MARKERS
                ? alignment.guide === "aligned"
                  ? "Ci sei quasi"
                  : "Allinea i punti"
                : "Allinea i punti"}
          </div>
        )}

        {cameraState === "readyPhase" && showInlineReference && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="pointer-events-none absolute right-2 top-[5.4rem] z-[86] w-[min(44vw,220px)]"
          >
            <div className="overflow-hidden rounded-xl border border-white/15 bg-black/45 shadow-lg backdrop-blur-[1px]">
              <ScanPhaseGuideIllustration phaseId={phaseIndex} variant="compact" />
            </div>
          </motion.div>
        )}

        {/* Countdown unico per fase (3→2→1) prima del burst nascosto */}
        {cameraState === "capturingPhase" && burstCountdown != null && (
          <div className="pointer-events-none absolute inset-0 z-[88] flex items-center justify-center bg-black/30">
            <div className="font-sans text-[min(28vw,120px)] font-black tabular-nums leading-none text-white drop-shadow-[0_6px_32px_rgba(0,0,0,0.85)]">
              {burstCountdown}
            </div>
          </div>
        )}

        {/* Check + messaggio dopo il burst (prima del passaggio di fase) */}
        <AnimatePresence>
          {showAcquisitionComplete && cameraState === "capturingPhase" && (
            <motion.div
              key="acquisition-complete"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-none absolute inset-0 z-[91] flex flex-col items-center justify-center bg-black/40 backdrop-blur-[1px]"
            >
              <motion.div
                initial={{ scale: 0.72, opacity: 0 }}
                animate={{ scale: [0.86, 1.06, 1], opacity: 1 }}
                transition={{ duration: 0.34, ease: "easeOut" }}
                className="flex flex-col items-center gap-4 px-6"
              >
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: [0.95, 1.08, 1] }}
                  transition={{ duration: 0.32, ease: "easeOut" }}
                  className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-2 border-emerald-400/80 bg-emerald-500/15 shadow-[0_0_52px_rgba(52,211,153,0.32)]"
                >
                  <Check className="h-10 w-10 text-emerald-200" strokeWidth={2.75} aria-hidden />
                </motion.div>
                <p className="max-w-[min(90vw,320px)] text-center text-lg font-semibold tracking-tight text-white drop-shadow-lg">
                  Fatto
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {(cameraState === "readyPhase" || cameraState === "capturingPhase") &&
          !(cameraState === "capturingPhase" && showAcquisitionComplete) && (
          <div className="pointer-events-none absolute bottom-[4.2rem] left-1/2 z-[58] w-[min(88vw,460px)] max-w-[100vw] -translate-x-1/2 px-3 sm:bottom-[4.9rem]">
            <div className="rounded-xl border border-white/10 bg-black/22 px-3 py-2 text-center shadow-lg">
              <p
                className={cn(
                  "font-medium leading-snug text-white",
                  "text-[13px] sm:text-[14px] sm:leading-normal"
                )}
              >
                {captureReady ? "Tieni fermo" : "Allinea i punti"}
              </p>
              {!captureReady && (
                <p className="mt-1 text-[11px] leading-tight text-white/70">
                  Piede grande? In diagonale
                </p>
              )}
            </div>
          </div>
        )}

        {/* phase content */}
        <AnimatePresence mode="wait">
          {cameraState === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-50 flex items-center justify-center px-6"
            >
              <div className={phaseCardClass}>
                <div className="font-mono text-xs tracking-[0.18em] text-blue-500">
                  NEUMA // PHOTOGRAMMETRY
                </div>
                <div className="mt-3 font-sans text-lg text-zinc-400">
                  Due piedi nello stesso ordine: prima <strong className="text-zinc-100">sinistro</strong>, poi{" "}
                  <strong className="text-zinc-200">destro</strong> (stesse fasi per entrambi).
                </div>

                <div className="mt-5 w-full max-w-md space-y-3 text-left">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="neuma-terms-biometric"
                      checked={acceptTerms}
                      onCheckedChange={(v) => setAcceptTerms(v === true)}
                      className="mt-0.5 border-zinc-600 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
                      aria-describedby="neuma-privacy-note neuma-transparency-box"
                    />
                    <Label
                      htmlFor="neuma-terms-biometric"
                      className="cursor-pointer text-sm font-normal leading-snug text-zinc-300 peer-disabled:cursor-not-allowed"
                    >
                      {
                        "Accetto le Condizioni d'Uso e il trattamento dei dati biometrici per la creazione della scarpa su misura."
                      }
                    </Label>
                  </div>
                  <p
                    id="neuma-privacy-note"
                    className="pl-7 text-[11px] leading-relaxed text-zinc-500"
                  >
                    {
                      "Le tue foto vengono utilizzate esclusivamente per generare il modello 3D del piede. I file originali verranno eliminati dopo la produzione della scarpa presso NEUMA."
                    }
                  </p>
                  <div
                    id="neuma-transparency-box"
                    className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-400 shadow-inner"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-blue-500/90">
                      Trasparenza
                    </span>
                    <p className="mt-1.5">
                      Le tue scansioni risiedono in server criptati e vengono elaborate localmente sul nostro hardware
                      dedicato (Apple Silicon) per garantire la massima sicurezza.
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="default"
                  onClick={startCamera}
                  disabled={!acceptTerms}
                  className="mt-6 h-auto w-full rounded-xl px-6 py-4 font-mono text-lg tracking-[0.14em] disabled:opacity-40"
                >
                  INIZIA SCANSIONE
                </Button>
              </div>
            </motion.div>
          )}

          {cameraState === "betweenFeet" && (
            <motion.div
              key="betweenFeet"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
              className="absolute inset-0 z-[90] flex items-center justify-center bg-black/80 px-6 backdrop-blur-sm"
            >
              <div className={phaseCardClass}>
                <div className="mt-1 text-center font-sans text-2xl font-semibold text-zinc-50">Ora l'altro piede</div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void resumeToRightFoot()}
                  className="mt-8 h-auto w-full rounded-xl border-blue-500/40 bg-blue-600 px-6 py-4 font-mono text-lg tracking-[0.14em] text-white shadow-lg shadow-blue-600/25 backdrop-blur-md hover:bg-blue-700 hover:border-blue-500/60"
                >
                  Continua
                </Button>
              </div>
            </motion.div>
          )}

          {cameraState === "starting" && (
            <motion.div
              key="starting"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-50 flex items-center justify-center px-6"
            >
              <div className={phaseCardClass}>
                <div className="font-mono text-xs tracking-[0.18em] text-blue-500">
                  AVVIO CAMERA...
                </div>
                <div className="mt-3 font-sans text-zinc-400">Consenti l’accesso alla fotocamera.</div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {(cameraState === "readyPhase" || cameraState === "capturingPhase") && (
          <motion.div
            key={`scan-bar-${phaseIndex}-${cameraState}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute bottom-0 left-0 right-0 z-[55] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
          >
            <div className="mx-auto w-[min(56vw,200px)] rounded-full border border-white/10 bg-black/25 px-3 py-2 backdrop-blur-[1px]">
              <div className="flex items-center justify-center gap-1.5">
                {progressTacks.map((filled, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 w-7 rounded-full border transition-colors duration-200",
                      filled ? "border-emerald-300/60 bg-emerald-300/70" : "border-white/20 bg-transparent"
                    )}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* review */}
        {cameraState === "review" && (
          <div className="absolute inset-0 z-55 overflow-auto bg-zinc-950">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 backdrop-blur-md bg-zinc-950/70">
              <div className="font-mono text-xs tracking-[0.18em] text-blue-500">
                PAIO PRONTO (SX + DX)
              </div>
              <div className="font-mono text-[10px] tracking-[0.14em] text-zinc-400">
                Galleria sessione
              </div>
            </div>

            {error ? (
              <div className="mx-4 mt-3 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            ) : null}

            {pairComplete && biometryBusy ? (
              <div className="mx-4 mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-center font-mono text-xs text-sky-300">
                Analisi biometria millimetrica in corso…
              </div>
            ) : null}

            {pairComplete && biometryResult?.calibration.ok && photosLeft[biometrySourceIndex] ? (
              <div className="mx-4 mt-4 space-y-2">
                <BiometryOverlayPreview
                  imageUrl={photosLeft[biometrySourceIndex].url}
                  worldMmToImagePx={biometryResult.calibration.homographyWorldMmToImagePx as Mat3}
                  contourMm={biometryResult.footContourMm}
                  keypoints={biometryResult.keypoints.filter(
                    (k) => k.id === "hallux_tip" || k.id === "heel_center"
                  )}
                  mmPerPixelEstimate={biometryResult.calibration.mmPerPixelEstimate}
                />
              </div>
            ) : null}

            <div className="mx-4 mt-4 grid grid-cols-3 gap-3 pb-8">
              {photos.map((p, idx) => (
                <div key={p.url} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
                  <img src={p.url} alt={`photo_${idx}`} loading="lazy" className="h-28 w-full object-cover" />
                </div>
              ))}
            </div>

            <div className="mx-4 mt-6 flex flex-col gap-3 pb-10">
              {!pairComplete ? (
                <p className="text-center text-xs text-amber-200/90">
                  Completa entrambe le acquisizioni per inviare il paio.
                </p>
              ) : null}
              <Button
                type="button"
                variant="default"
                onClick={uploadPhotosToServer}
                disabled={cameraState === "uploading" || !pairComplete}
                className="h-auto w-full rounded-xl px-6 py-4 font-mono text-lg tracking-[0.14em] disabled:opacity-40"
              >
                INVIA PAIO IN PRODUZIONE
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={resetTotal}
                className="h-auto w-full rounded-xl border-zinc-800 bg-zinc-900/50 px-6 py-4 font-mono text-sm tracking-[0.12em] text-zinc-100 backdrop-blur-md hover:bg-zinc-800 hover:text-zinc-100"
              >
                RESET TOTALE
              </Button>
            </div>
          </div>
        )}

        {/* error overlay */}
        {cameraState === "error" && (
          <div className="absolute inset-0 z-60 flex items-center justify-center px-6">
            <div className="w-full max-w-xl rounded-2xl border border-red-400/20 bg-zinc-950/70 p-6 text-center backdrop-blur-md">
              <div className="font-mono text-xs tracking-[0.18em] text-red-200">ERRORE</div>
              <div className="mt-3 text-xs text-red-200/90">{error}</div>
              <Button
                type="button"
                variant="outline"
                onClick={resetTotal}
                className="mt-5 h-auto w-full rounded-xl border-zinc-800 bg-zinc-900/50 px-6 py-4 font-mono text-lg tracking-[0.14em] text-zinc-100 backdrop-blur-md hover:bg-zinc-800 hover:text-zinc-100"
              >
                RESET TOTALE
              </Button>
            </div>
          </div>
        )}

        {/* uploading/process */}
        {cameraState === "uploading" && (
          <ProcessingView
            progress={processingProgress}
            isReady={processingReady}
            scanId={processingScanId}
            statusText={processingStatusText}
            onVisualize={beginMeshVisualization}
            onBackToGallery={() => setCameraState("review")}
          />
        )}

        {/* visualizer */}
        {cameraState === "visualizing" && (
          <div className="absolute inset-0 z-80 flex items-center justify-center bg-zinc-950 px-4">
            <div className="w-full max-w-xl">
              {(() => {
                switch (scanMeshViewerStatus) {
                  case "idle":
                  case "completing":
                    return (
                      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center text-zinc-300">
                        <Loader2 className="h-10 w-10 animate-spin text-blue-500" aria-hidden />
                        <div className="text-sm">
                          Preparazione visualizzazione 3D…
                        </div>
                      </div>
                    );
                  case "processing":
                    return (
                      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
                        <Loader2 className="h-10 w-10 animate-spin text-blue-500" aria-hidden />
                        <div className="text-sm text-zinc-200">Creazione modello…</div>
                      </div>
                    );
                  case "ready":
                    return (
                      <div className="relative">
                        {reconstructedCloud ? (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            transition={{ duration: 0.45, ease: "easeOut" }}
                            className="h-[360px] w-full overflow-hidden rounded-xl border border-white/10 bg-black/20"
                          >
                            <Canvas
                              dpr={[1, 1.75]}
                              frameloop="demand"
                              camera={{ position: [0.28, 0.18, 0.9], fov: 34 }}
                              gl={{
                                alpha: true,
                                antialias: true,
                                powerPreference: "high-performance",
                              }}
                            >
                              <ambientLight intensity={0.5} />
                              <directionalLight intensity={1.15} position={[2.4, 3.5, 2.8]} />
                              <FootPointCloudPreview
                                cloud={reconstructedCloud}
                                introAnimation
                                showVisualizationToggle
                                heatmapAxis="y"
                              />
                            </Canvas>
                          </motion.div>
                        ) : (
                          <FootCanvas
                            metrics={DEFAULT_METRICS}
                            meshUrl={meshPreviewUrl ?? undefined}
                          />
                        )}
                        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-5">
                          <motion.div
                            initial={{ opacity: 0, y: -12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.36, ease: "easeOut" }}
                            className="rounded-xl border border-white/15 bg-black/45 p-4 text-center backdrop-blur-md"
                          >
                            <div className="font-mono text-xs tracking-[0.16em] text-white/85">
                              Questo e il tuo piede digitale
                            </div>
                            <div className="mt-2 text-xs text-zinc-200/95">
                              Ora creiamo la tua scarpa
                            </div>
                          </motion.div>

                          <motion.div
                            initial={{ opacity: 0, y: 14 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.42, delay: 0.08, ease: "easeOut" }}
                            className="mx-auto flex w-full max-w-[300px] flex-col items-center gap-2"
                          >
                            <div className="text-[11px] text-zinc-200/85">
                              Ruota il modello
                            </div>
                            <Button
                              type="button"
                              onClick={leaveMeshVisualization}
                              className="pointer-events-auto h-auto w-full rounded-xl bg-blue-500 px-6 py-3 font-mono text-sm tracking-[0.12em] text-white hover:bg-blue-400"
                            >
                              CONTINUA
                            </Button>
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
              {scanMeshViewerStatus !== "ready" && (
                <div className="mt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={leaveMeshVisualization}
                    className="h-auto w-full rounded-xl border-zinc-800 bg-zinc-900/50 px-6 py-4 font-mono text-sm tracking-[0.12em] text-zinc-100 backdrop-blur-md hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    TORNA ALLA GALLERY
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}


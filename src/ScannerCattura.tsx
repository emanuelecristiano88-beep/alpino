"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FootCanvas from "../components/three/FootCanvas";
import { Button } from "./components/ui/button";
import { Checkbox } from "./components/ui/checkbox";
import { Label } from "./components/ui/label";
import { cn } from "./lib/utils";
import { PAIR_STORAGE_KEY, SCAN_METRICS_STORAGE_KEY } from "./constants/scan";
import { useScanAlignmentAnalysis } from "./hooks/useScanAlignmentAnalysis";
import { requestOrientationAccess, useDeviceTilt } from "./hooks/useDeviceTilt";
import { useScanFrameOrientation } from "./hooks/useScanFrameOrientation";
import ScannerAlignmentOverlay from "./components/scanner/ScannerAlignmentOverlay";
import ScannerPhaseGuidePanel from "./components/scanner/ScannerPhaseGuidePanel";
import ArucoMarkerPins from "./components/scanner/ArucoMarkerPins";
import ScannerShutterButton from "./components/scanner/ScannerShutterButton";
import BiometryOverlayPreview from "./components/scanner/BiometryOverlayPreview";
import { computeNeumaBiometryFromImageData, type NeumaBiometryResult } from "./lib/biometry";
import type { Mat3 } from "./lib/biometry/homography";
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
const BURST_FRAME_GAP_MS = 90;
const PHOTOS_PER_PHASE = 8;
const TOTAL_PHOTOS = PHOTOS_PER_PHASE * 4;
/** Vercel: body funzione ~4.5MB — più batch evitano FUNCTION_INVOCATION_FAILED */
const UPLOAD_BATCH_SIZE = 8;
const MAX_OUTPUT_DIM = 1024; // downscale to reduce memory/traffic
const JPEG_QUALITY = 0.82;
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

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
  });

  return blob;
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
  onVisualize,
  onBackToGallery,
}: {
  progress: number;
  isReady: boolean;
  scanId: string | null;
  onVisualize: () => void;
  onBackToGallery: () => void;
}) {
  return (
    <div className="absolute inset-0 z-70 flex items-center justify-center bg-zinc-950/75 backdrop-blur-sm px-6">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 text-center backdrop-blur-md">
        <div className="font-mono text-xs tracking-[0.18em] text-blue-500">
          ELABORAZIONE IN CORSO
        </div>
        <div className="mt-3 font-sans text-2xl text-zinc-100">Stiamo generando il tuo modello ...</div>

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
          <div className="mt-5 text-sm text-zinc-400">Questo può richiedere alcuni secondi.</div>
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
  /** Dopo il pannello illustrativo per la fase corrente */
  const [phaseGuideAccepted, setPhaseGuideAccepted] = useState(false);

  const photos = useMemo(() => [...photosLeft, ...photosRight], [photosLeft, photosRight]);
  const pairComplete = photosLeft.length === TOTAL_PHOTOS && photosRight.length === TOTAL_PHOTOS;

  const [flashNonce, setFlashNonce] = useState(0);
  const [biometryResult, setBiometryResult] = useState<NeumaBiometryResult | null>(null);
  const [biometryBusy, setBiometryBusy] = useState(false);
  const [biometrySourceIndex, setBiometrySourceIndex] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingScanId, setProcessingScanId] = useState<string | null>(null);
  const [processingReady, setProcessingReady] = useState(false);
  const processingIntervalRef = useRef<number | null>(null);
  /** Simulazione generazione mesh dopo "VISUALIZZA 3D" (futuro polling API) */
  const meshGenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanMeshViewerStatus, setScanMeshViewerStatus] = useState<ScanMeshViewerStatus>("idle");
  const [meshPreviewUrl, setMeshPreviewUrl] = useState<string | null>(null);
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

  const scanOverlayEnabled =
    (cameraState === "readyPhase" || cameraState === "capturingPhase") && phaseGuideAccepted;
  const alignment = useScanAlignmentAnalysis(videoRef, scanOverlayEnabled, phaseIndex);
  const frameTilt = useScanFrameOrientation(scanOverlayEnabled);
  const { tooTilted } = useDeviceTilt(
    (cameraState === "readyPhase" || cameraState === "capturingPhase") && phaseGuideAccepted,
    45
  );

  useEffect(() => {
    setPhaseGuideAccepted(false);
  }, [phaseIndex, currentFoot]);

  useEffect(() => {
    const prev = prevCameraStateRef.current;
    prevCameraStateRef.current = cameraState;
    if (cameraState === "readyPhase" && prev !== "readyPhase") {
      capturePhaseLockRef.current = false;
    }
  }, [cameraState]);

  const overlayStep = useMemo(() => {
    return `STEP: [${phaseIndex + 1}/4] - ${phase.name}`;
  }, [phaseIndex, phase.name]);

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

  /** Simula attesa backend (setTimeout) prima di mostrare il placeholder 3D */
  const beginMeshVisualization = () => {
    if (meshGenTimeoutRef.current) {
      clearTimeout(meshGenTimeoutRef.current);
      meshGenTimeoutRef.current = null;
    }
    setMeshPreviewUrl(null);
    stopStream();
    setCameraState("visualizing");
    setScanMeshViewerStatus("processing");
    meshGenTimeoutRef.current = setTimeout(() => {
      meshGenTimeoutRef.current = null;
      setMeshPreviewUrl("/path/to/mock.stl");
      setScanMeshViewerStatus("ready");
    }, 4000);
  };

  const leaveMeshVisualization = () => {
    if (meshGenTimeoutRef.current) {
      clearTimeout(meshGenTimeoutRef.current);
      meshGenTimeoutRef.current = null;
    }
    setScanMeshViewerStatus("idle");
    setMeshPreviewUrl(null);
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
  };

  const startProcessingSimulation = () => {
    stopProcessing();
    setProcessingReady(false);
    setProcessingProgress(0);

    const durationMs = 3000;
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

    const startedAt = Date.now();
    while (Date.now() - startedAt < 9000) {
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

    const candidates = [
      { facingMode: { exact: "environment" } },
      { facingMode: { ideal: "environment" } },
      true,
    ];

    let stream: MediaStream | null = null;
    for (const c of candidates) {
      try {
        stream = await getStream(c);
        if (stream) break;
      } catch {
        // try next
      }
    }
    if (!stream) throw new Error("Impossibile avviare la fotocamera.");

    streamRef.current = stream;
    if (!videoRef.current) throw new Error("Video element assente.");

    const video = videoRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (video as any).srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;

    try {
      void video.play();
    } catch {
      // ignore
    }

    await ensureCameraReady();
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
    if (!phaseGuideAccepted) return;
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
        for (let n = 3; n >= 1; n--) {
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

        await sleep(1350);
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
    if (!phaseGuideAccepted) return;
    if (alignment.stableAlignedMs < STABLE_ALIGNMENT_MS) return;
    if (autoStartedPhaseRef.current === phaseIndex) return;
    if (!videoRef.current) return;
    if (burstInFlightRef.current) return;
    startBurstSequenceRef.current();
  }, [cameraState, alignment.stableAlignedMs, phaseIndex, phaseGuideAccepted]);

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
      const uploadHeaders = new Headers();
      const secret = import.meta.env.VITE_UPLOAD_API_SECRET as string | undefined;
      if (secret) uploadHeaders.set("x-upload-secret", secret);

      const items: { blob: Blob; name: string }[] = [
        ...photosLeft.map((p, idx) => ({
          blob: p.blob,
          name: `left_${String(idx).padStart(2, "0")}.jpg`,
        })),
        ...photosRight.map((p, idx) => ({
          blob: p.blob,
          name: `right_${String(idx).padStart(2, "0")}.jpg`,
        })),
      ];

      const sessionScanId =
        scanId ||
        (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `scan_${Date.now()}`);
      if (!scanId) setScanId(sessionScanId);

      const batchCount = Math.max(1, Math.ceil(items.length / UPLOAD_BATCH_SIZE));
      const useBatched = batchCount > 1 || items.length > UPLOAD_BATCH_SIZE;

      let driveFolderIdFromServer: string | undefined;
      let lastJson: Record<string, unknown> | null = null;

      for (let b = 0; b < batchCount; b++) {
        const slice = items.slice(b * UPLOAD_BATCH_SIZE, (b + 1) * UPLOAD_BATCH_SIZE);
        const form = new FormData();
        slice.forEach((item) => {
          form.append("photos", item.blob, item.name);
        });
        form.append("count", String(items.length));
        form.append("pair", "true");
        form.append("scanId", sessionScanId);
        if (useBatched) {
          form.append("batchIndex", String(b));
          form.append("batchTotal", String(batchCount));
          if (driveFolderIdFromServer) {
            form.append("driveFolderId", driveFolderIdFromServer);
          }
        }

        const res = await fetch("/api/process-scan", {
          method: "POST",
          body: form,
          headers: uploadHeaders,
        });

        const text = await res.text().catch(() => "");
        if (!res.ok) {
          throw new Error(`POST fallito (${res.status}). ${text}`);
        }

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text) as Record<string, unknown>;
        } catch {
          throw new Error("Risposta API non valida (JSON)");
        }
        lastJson = data;

        const st = data.status;
        if (typeof data.driveFolderId === "string" && data.driveFolderId) {
          driveFolderIdFromServer = data.driveFolderId;
        }

        if (st === "partial") {
          continue;
        }
        if (st === "success") {
          break;
        }
        throw new Error(typeof data.message === "string" ? data.message : "Risposta API non valida");
      }

      const data = lastJson;
      if (!data || data.status !== "success") {
        throw new Error(
          typeof data?.message === "string" ? data.message : "Upload incompleto: nessuna risposta success finale."
        );
      }

      const serverScanId = data?.scanId ? String(data.scanId) : sessionScanId || "OK";
      const serverPath = typeof data?.path === "string" ? data.path : "";

      // allinea i badge tecnici all'ID server
      setScanId(serverScanId);
      setProcessingScanId(serverScanId);
      setScanPath(serverPath);
      setError("");

      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(PAIR_STORAGE_KEY, "true");
        const m = data?.metrics;
        if (m && typeof m === "object") {
          sessionStorage.setItem(
            SCAN_METRICS_STORAGE_KEY,
            JSON.stringify({
              ...m,
              updatedAt: new Date().toISOString(),
            })
          );
        }
      }

      // simulazione elaborazione di 3 secondi (poi abilita "VISUALIZZA 3D")
      startProcessingSimulation();
    } catch (e: any) {
      stopProcessing();
      setCameraState("review");
      setError(`ERRORE_UPLOAD // ${e?.message || String(e)}`);
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

      {/* Pannello illustrativo prima di ogni fase (cliente + operatore) */}
      {cameraState === "readyPhase" && !phaseGuideAccepted ? (
        <ScannerPhaseGuidePanel
          phaseId={phaseIndex}
          foot={currentFoot}
          onContinue={() => setPhaseGuideAccepted(true)}
        />
      ) : null}

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
            visible={alignment.markerCentersNorm != null && alignment.markerCentersNorm.length >= 4}
          />
        </>
      ) : null}

      {tooTilted &&
        (cameraState === "readyPhase" || cameraState === "capturingPhase") &&
        phaseGuideAccepted && (
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
          <div className={`${techBadgeClass} py-1.5 text-[9px]`}>UNIT: SCANNER_V1</div>
          {(cameraState === "capturingPhase" || cameraState === "readyPhase") && (
            <div className="font-mono text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-zinc-400">
              {cameraState === "capturingPhase" ? "Acquisizione attiva" : "Pronto"}
            </div>
          )}
          {(cameraState === "capturingPhase" || cameraState === "readyPhase") && (
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {currentFoot === "LEFT" ? "Piede sinistro" : "Piede destro"}
            </div>
          )}
          {cameraState !== "capturingPhase" && cameraState !== "readyPhase" ? (
            <div className={`${techBadgeClass} py-1.5 text-[9px] text-zinc-500`}>NEUMA · PHOTOGRAMMETRY</div>
          ) : null}
        </div>
        <div className="pointer-events-none absolute right-0 top-0 z-[85] flex flex-col items-end gap-1.5 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] text-right">
          <div className={`${techBadgeClass} py-1.5 text-[9px]`}>
            <span className={accentBadgeClass}>SCAN</span> {scanId ? scanId.slice(0, 8) : "—"}
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-60 flex items-end justify-between px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className={`${techBadgeClass} py-1.5 text-[9px]`}>
            TIMER: {cameraState === "capturingPhase" ? formatMmSs(timerSeconds) : "—"}
          </div>
          <div className={`${techBadgeClass} py-1.5 text-[9px]`}>
            FPS: {cameraState === "capturingPhase" ? String(fps || "--") : "--"}
          </div>
        </div>

        {/* Istruzione fase: grande, leggibile, fascia scura semitrasparente (non a tutto schermo) */}
        {(cameraState === "readyPhase" || cameraState === "capturingPhase") &&
          phaseGuideAccepted &&
          alignment.guide === "too_close" && (
          <div className="pointer-events-none absolute left-3 top-[6.25rem] z-[86] max-w-[min(90vw,340px)] rounded-lg border border-amber-500/50 bg-amber-950/70 px-3 py-2 text-[11px] font-semibold uppercase leading-snug tracking-wide text-amber-100 shadow-lg sm:text-xs">
            ALLONTANATI — Il foglio deve essere interamente visibile
          </div>
        )}
        {(cameraState === "readyPhase" || cameraState === "capturingPhase") &&
          phaseGuideAccepted &&
          alignment.guide === "aligned" && (
          <div className="pointer-events-none absolute left-3 top-[6.25rem] z-[86] rounded-lg border border-emerald-500/45 bg-emerald-950/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
            Posizione ottimale
          </div>
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
                initial={{ scale: 0.62, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 440, damping: 26 }}
                className="flex flex-col items-center gap-4 px-6"
              >
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-emerald-400/80 bg-emerald-500/15 shadow-[0_0_52px_rgba(52,211,153,0.32)]">
                  <Check className="h-10 w-10 text-emerald-200" strokeWidth={2.75} aria-hidden />
                </div>
                <p className="max-w-[min(90vw,320px)] text-center text-lg font-semibold tracking-tight text-white drop-shadow-lg">
                  Acquisizione completata
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {(cameraState === "readyPhase" || cameraState === "capturingPhase") &&
          phaseGuideAccepted &&
          !(cameraState === "capturingPhase" && showAcquisitionComplete) && (
          <div className="pointer-events-none absolute bottom-[7.5rem] left-1/2 z-[58] w-[min(96vw,560px)] max-w-[100vw] -translate-x-1/2 px-3 sm:bottom-[8.25rem]">
            <p
              className={cn(
                "rounded-2xl border border-white/10 px-4 py-3 text-center font-semibold leading-snug text-white shadow-lg",
                "bg-black/40 text-base sm:text-xl sm:leading-normal"
              )}
            >
              {cameraState === "capturingPhase"
                ? burstCountdown != null
                  ? "Resta fermo: acquisizione tra pochi secondi…"
                  : "Acquisizione in corso… mantieni il telefono stabile."
                : phase.instruction}
            </p>
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
                <div className="font-mono text-xs tracking-[0.18em] text-blue-500">PIEDE SINISTRO — OK</div>
                <div className="mt-4 text-center font-sans text-2xl font-semibold text-zinc-50">
                  Piede Sinistro Acquisito!
                </div>
                <p className="mt-3 text-center text-sm leading-relaxed text-zinc-400">
                  Ora posiziona il <strong className="text-zinc-100">Piede Destro</strong> sul foglio A4. Continua con le
                  stesse 4 fasi.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void resumeToRightFoot()}
                  className="mt-8 h-auto w-full rounded-xl border-blue-500/40 bg-blue-600 px-6 py-4 font-mono text-lg tracking-[0.14em] text-white shadow-lg shadow-blue-600/25 backdrop-blur-md hover:bg-blue-700 hover:border-blue-500/60"
                >
                  CONTINUA CON PIEDE DESTRO
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetTotal}
                  className="mt-3 w-full text-xs text-zinc-500"
                >
                  Annulla sessione
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

        {(cameraState === "readyPhase" || cameraState === "capturingPhase") && phaseGuideAccepted && (
          <motion.div
            key={`scan-bar-${phaseIndex}-${cameraState}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute bottom-0 left-0 right-0 z-[55] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
          >
            <div className="rounded-t-2xl border border-white/10 bg-black/70 px-4 pb-5 pt-4 shadow-xl backdrop-blur-[2px]">
              <div className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-sky-400/95">
                {overlayStep}
              </div>
              <div className="mt-3 flex items-center justify-center gap-4 font-mono text-[10px] tracking-wide text-zinc-400">
                <span>
                  Fase {phaseIndex + 1} / 4 · {currentFoot === "LEFT" ? "piede SX" : "piede DX"}
                </span>
              </div>
              <div className="mt-4 flex flex-col items-center gap-3">
                <div className="flex items-center justify-center gap-2">
                  {progressTacks.map((filled, i) => (
                    <div
                      key={i}
                      className={`h-2 w-8 rounded-sm border ${
                        filled
                          ? "border-sky-500 bg-sky-500 shadow-[0_0_12px_rgba(56,189,248,0.5)]"
                          : "border-zinc-600/80 bg-black/30"
                      }`}
                    />
                  ))}
                </div>
                <ScannerShutterButton
                  progress={phaseIndex / 4}
                  onClick={
                    cameraState === "readyPhase" && phaseGuideAccepted ? beginPhaseBurstSequence : undefined
                  }
                  disabled={cameraState === "capturingPhase"}
                  capturing={cameraState === "capturingPhase"}
                  label={
                    cameraState === "capturingPhase"
                      ? showAcquisitionComplete
                        ? "Fatto"
                        : burstCountdown != null
                          ? "Tra poco…"
                          : burstMidCapture
                            ? "In corso…"
                            : "Acquisizione…"
                      : `Tocca · avvia fase ${phaseIndex + 1}`
                  }
                />
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
                        <div className="text-sm text-zinc-200">
                          Generazione del modello 3D in corso… Attendi qualche istante.
                        </div>
                      </div>
                    );
                  case "ready":
                    return (
                      <FootCanvas
                        metrics={DEFAULT_METRICS}
                        meshUrl={meshPreviewUrl ?? undefined}
                      />
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
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}


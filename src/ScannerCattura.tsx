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
import ScannerAlignmentOverlay from "./components/scanner/ScannerAlignmentOverlay";
import ArucoMarkerPins from "./components/scanner/ArucoMarkerPins";
import ScannerShutterButton from "./components/scanner/ScannerShutterButton";
import { Smartphone } from "lucide-react";

type Photo = {
  blob: Blob;
  url: string;
};

type Metrics = { footLengthMm: number; forefootWidthMm: number };

type PhaseId = 0 | 1 | 2 | 3;
type FootId = "LEFT" | "RIGHT";

const CAPTURE_EVERY_MS = 800;
const PHOTOS_PER_PHASE = 8;
const TOTAL_PHOTOS = PHOTOS_PER_PHASE * 4;
const MAX_OUTPUT_DIM = 1024; // downscale to reduce memory/traffic
const JPEG_QUALITY = 0.82;
const DEFAULT_METRICS: Metrics = { footLengthMm: 265, forefootWidthMm: 95 };

const PHASES: { id: PhaseId; name: string; instruction: string }[] = [
  {
    id: 0,
    name: "FRONTALE/TALLONE",
    instruction: "Inquadra il tallone e inclina verso la pianta",
  },
  {
    id: 1,
    name: "LATO INTERNO",
    instruction: "Muovi il telefono lentamente verso l'interno del piede",
  },
  {
    id: 2,
    name: "LATO ESTERNO",
    instruction: "Muovi il telefono verso l'esterno, mantieni la distanza",
  },
  {
    id: 3,
    name: "PUNTA/SUPERIORE",
    instruction: "Inquadra le dita e la parte dorsale dall'alto",
  },
];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function formatCounter(x: number, max: number) {
  return `FOTO ACQUISITE: ${x} / ${max}`;
}

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
  const captureTimerRef = useRef<number | null>(null);
  const captureInFlightRef = useRef(false);

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

  const photos = useMemo(() => [...photosLeft, ...photosRight], [photosLeft, photosRight]);
  const activePhotosCount = currentFoot === "LEFT" ? photosLeft.length : photosRight.length;
  const totalCaptured = photos.length;
  const pairComplete = photosLeft.length === TOTAL_PHOTOS && photosRight.length === TOTAL_PHOTOS;

  const [flashNonce, setFlashNonce] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processingScanId, setProcessingScanId] = useState<string | null>(null);
  const [processingReady, setProcessingReady] = useState(false);
  const processingIntervalRef = useRef<number | null>(null);
  const currentFootRef = useRef<FootId>("LEFT");
  const autoStartedPhaseRef = useRef<number>(-1);
  const startPhaseCaptureRef = useRef<() => void>(() => {});
  /** Evita doppio avvio fase (Strict Mode / effetto + click). */
  const capturePhaseLockRef = useRef(false);
  const prevCameraStateRef = useRef(cameraState);
  useEffect(() => {
    currentFootRef.current = currentFoot;
  }, [currentFoot]);

  const scanOverlayEnabled = cameraState === "readyPhase" || cameraState === "capturingPhase";
  const alignment = useScanAlignmentAnalysis(videoRef, scanOverlayEnabled, phaseIndex);
  const { tooTilted } = useDeviceTilt(scanOverlayEnabled, 45);

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

  const progressTacks = useMemo(() => {
    const filled = clamp(capturedInPhase, 0, PHOTOS_PER_PHASE);
    return Array.from({ length: PHOTOS_PER_PHASE }, (_, i) => i < filled);
  }, [capturedInPhase]);

  const stopCapture = () => {
    if (captureTimerRef.current) {
      window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
  };

  const stopStream = () => {
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

  const startPhaseCapture = () => {
    if (!videoRef.current) return;
    if (cameraState === "capturingPhase") return;
    if (capturePhaseLockRef.current) return;
    capturePhaseLockRef.current = true;
    autoStartedPhaseRef.current = phaseIndex;

    setError("");
    setCapturedInPhase(0);
    setCameraState("capturingPhase");

    captureTimerRef.current = window.setInterval(async () => {
      if (captureInFlightRef.current) return;
      captureInFlightRef.current = true;

      try {
        if (navigator.vibrate) navigator.vibrate(25);
        setFlashNonce((n) => n + 1);
        await playClick(audioCtxRef);

        const blob = await captureFrameAsJpeg(videoRef.current!);
        if (!blob) return;

        const foot = currentFootRef.current;
        const next = (prev: Photo[]) => {
          if (prev.length >= TOTAL_PHOTOS) return prev;
          const url = URL.createObjectURL(blob);
          return [...prev, { blob, url }];
        };
        if (foot === "LEFT") setPhotosLeft(next);
        else setPhotosRight(next);

        setCapturedInPhase((n) => n + 1);
      } catch {
        // ignore capture errors
      } finally {
        captureInFlightRef.current = false;
      }
    }, CAPTURE_EVERY_MS);
  };

  startPhaseCaptureRef.current = startPhaseCapture;

  useEffect(() => {
    if (cameraState !== "readyPhase") return;
    if (alignment.stableAlignedMs < 1000) return;
    if (autoStartedPhaseRef.current === phaseIndex) return;
    if (!videoRef.current) return;
    startPhaseCaptureRef.current();
  }, [cameraState, alignment.stableAlignedMs, phaseIndex]);

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
    setAcceptTerms(false);
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
      const form = new FormData();
      photosLeft.forEach((p, idx) => {
        form.append("photos", p.blob, `left_${String(idx).padStart(2, "0")}.jpg`);
      });
      photosRight.forEach((p, idx) => {
        form.append("photos", p.blob, `right_${String(idx).padStart(2, "0")}.jpg`);
      });
      form.append("count", String(photosLeft.length + photosRight.length));
      form.append("pair", "true");

      const res = await fetch("/api/process-scan", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`POST fallito (${res.status}). ${text}`);
      }

      const data = await res.json().catch(() => null);

      if (!data || data.status !== "success") {
        throw new Error(data?.message || "Risposta API non valida");
      }

      const serverScanId = data?.scanId ? String(data.scanId) : scanId || "OK";
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
    "rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-[10px] tracking-[0.16em] text-zinc-300 backdrop-blur-md";
  const accentBadgeClass = "text-blue-500";

  const phaseCardClass =
    "w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 shadow-xl shadow-black/40 backdrop-blur-md";

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

      {/* Overlay: bounding box + marker angoli + guida (rilevamento da frame video, estendibile con OpenCV ArUco) */}
      {(cameraState === "readyPhase" || cameraState === "capturingPhase") && (
        <>
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
            <ScannerAlignmentOverlay alignment={alignment} />
          </div>
          <ArucoMarkerPins
            videoRef={videoRef}
            containerRef={videoContainerRef}
            markerCentersNorm={alignment.markerCentersNorm}
            visible={alignment.markerCentersNorm != null && alignment.markerCentersNorm.length >= 4}
          />
        </>
      )}

      {tooTilted && (cameraState === "readyPhase" || cameraState === "capturingPhase") && (
        <div className="pointer-events-none absolute inset-0 z-[60] flex flex-col items-center justify-center bg-black/55 px-6 backdrop-blur-[2px]">
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
        {/* corner tech badges */}
        <div className="pointer-events-none absolute left-0 top-0 z-60 flex w-full items-start justify-between px-4 py-3">
          <div className={`${techBadgeClass}`}>
            UNIT: SCANNER_V1 / TORINO_IT
          </div>
          <div className={`${techBadgeClass}`}>
            <span className={accentBadgeClass}>SCAN</span>: {scanId ? scanId.slice(0, 8) : "—"}
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-60 flex items-end justify-between px-4 pb-4">
          <div className={`${techBadgeClass}`}>
            TIMER: {cameraState === "capturingPhase" ? formatMmSs(timerSeconds) : "—"}
          </div>
          <div className={`${techBadgeClass}`}>
            FPS: {cameraState === "capturingPhase" ? String(fps || "--") : "--"}
          </div>
        </div>

        {/* Etichetta piede + contatore foto piede corrente */}
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-[85] flex flex-col items-center gap-2 px-4 pt-3">
          {(cameraState === "capturingPhase" || cameraState === "readyPhase") && (
            <div
              className={cn(
                "rounded-lg border px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] shadow-lg backdrop-blur-md",
                "border-white/10 bg-black/40 text-zinc-100 shadow-black/30"
              )}
            >
              {currentFoot === "LEFT" ? "SCANSIONE PIEDE: SINISTRO" : "SCANSIONE PIEDE: DESTRO"}
            </div>
          )}
          <div className="flex justify-center pt-1">
            {cameraState === "capturingPhase" || cameraState === "readyPhase" ? (
              <div className={`${techBadgeClass} ${accentBadgeClass}`}>
                {formatCounter(activePhotosCount, TOTAL_PHOTOS)}
              </div>
            ) : (
              <div className={techBadgeClass}>ALPINO_OFFICINA // PHOTOGRAMMETRY</div>
            )}
          </div>
        </div>

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
                  ALPINO_OFFICINA // PHOTOGRAMMETRY
                </div>
                <div className="mt-3 font-sans text-lg text-zinc-400">
                  Due piedi nello stesso ordine: prima <strong className="text-zinc-100">sinistro</strong>, poi{" "}
                  <strong className="text-zinc-200">destro</strong> (32 + 32 foto).
                </div>

                <div className="mt-5 w-full max-w-md space-y-3 text-left">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id="alpino-terms-biometric"
                      checked={acceptTerms}
                      onCheckedChange={(v) => setAcceptTerms(v === true)}
                      className="mt-0.5 border-zinc-600 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
                      aria-describedby="alpino-privacy-note alpino-transparency-box"
                    />
                    <Label
                      htmlFor="alpino-terms-biometric"
                      className="cursor-pointer text-sm font-normal leading-snug text-zinc-300 peer-disabled:cursor-not-allowed"
                    >
                      {
                        "Accetto le Condizioni d'Uso e il trattamento dei dati biometrici per la creazione della scarpa su misura."
                      }
                    </Label>
                  </div>
                  <p
                    id="alpino-privacy-note"
                    className="pl-7 text-[11px] leading-relaxed text-zinc-500"
                  >
                    {
                      "Le tue foto vengono utilizzate esclusivamente per generare il modello 3D del piede. I file originali verranno eliminati dopo la produzione della scarpa presso l'Officina Alpino."
                    }
                  </p>
                  <div
                    id="alpino-transparency-box"
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

        {(cameraState === "readyPhase" || cameraState === "capturingPhase") && (
          <motion.div
            key={`scan-bar-${phaseIndex}-${cameraState}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute bottom-0 left-0 right-0 z-[55] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2"
          >
            <div className="rounded-t-2xl border border-white/10 bg-black/40 px-4 pb-5 pt-4 shadow-2xl backdrop-blur-md">
              <div className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-sky-400/95">
                {overlayStep}
              </div>
              <p className="mt-2 text-center text-sm leading-snug text-zinc-100/95">
                {cameraState === "capturingPhase" ? "Acquisizione in corso…" : phase.instruction}
              </p>
              <div className="mt-2 flex items-center justify-center gap-4 font-mono text-[10px] tracking-wide text-zinc-400">
                <span>
                  Set: {capturedInPhase}/{PHOTOS_PER_PHASE}
                </span>
                <span className="text-sky-400/90">{phaseIndex + 1}/4</span>
              </div>
              <div className="mt-4 flex flex-col items-center gap-3">
                <div className="flex items-center justify-center gap-2">
                  {progressTacks.map((filled, i) => (
                    <div
                      key={i}
                      className={`h-1.5 w-4 rounded-sm border ${
                        filled
                          ? "border-sky-500 bg-sky-500 shadow-[0_0_12px_rgba(56,189,248,0.5)]"
                          : "border-zinc-600/80 bg-black/30"
                      }`}
                    />
                  ))}
                </div>
                <ScannerShutterButton
                  progress={activePhotosCount / TOTAL_PHOTOS}
                  onClick={cameraState === "readyPhase" ? startPhaseCapture : undefined}
                  disabled={cameraState === "capturingPhase"}
                  capturing={cameraState === "capturingPhase"}
                  label={
                    cameraState === "capturingPhase"
                      ? `${activePhotosCount} / ${TOTAL_PHOTOS} foto`
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
                {photosLeft.length} SX · {photosRight.length} DX · {formatCounter(totalCaptured, TOTAL_PHOTOS * 2)}
              </div>
            </div>

            {error ? (
              <div className="mx-4 mt-3 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-200">
                {error}
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
                  Completa entrambe le acquisizioni (32 + 32 foto) per inviare il paio.
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
            onVisualize={() => {
              stopStream();
              setCameraState("visualizing");
            }}
            onBackToGallery={() => setCameraState("review")}
          />
        )}

        {/* visualizer */}
        {cameraState === "visualizing" && (
          <div className="absolute inset-0 z-80 flex items-center justify-center bg-zinc-950 px-4">
            <div className="w-full max-w-xl">
              <FootCanvas metrics={DEFAULT_METRICS} />
              <div className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCameraState("review")}
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


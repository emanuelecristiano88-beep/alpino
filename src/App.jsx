import { useEffect, useRef, useState } from "react";
import FootCanvas from "../components/three/FootCanvas";

const SCAN_DURATION = 20;
const ANALYSIS_DURATION = 3200;
const UPLOAD_DURATION = 5000;

export default function App() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const uploadRef = useRef(null);
  const analysisTimeoutRef = useRef(null);
  const audioCtxRef = useRef(null);
  const measureCanvasRef = useRef(null);
  const videoReadyCheckIntervalRef = useRef(null);
  const videoReadyTimeoutRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(SCAN_DURATION);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [capturedFrame, setCapturedFrame] = useState("");
  const [error, setError] = useState("");
  const [activeCameraLabel, setActiveCameraLabel] = useState("");
  const [videoReady, setVideoReady] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureMode, setMeasureMode] = useState("reference");
  const [referenceMm, setReferenceMm] = useState(210);
  const [referencePoints, setReferencePoints] = useState([]);
  const [lengthPoints, setLengthPoints] = useState([]);
  const [widthPoints, setWidthPoints] = useState([]);
  const [scanMetrics, setScanMetrics] = useState(null);
  const [guideIndex, setGuideIndex] = useState(0);

  const guideSteps = [
    "ALLINEA IL PIEDE AL CENTRO DEL MIRINO",
    "MUOVI LENTAMENTE A DESTRA DI 10-15 CM",
    "TORNA AL CENTRO E INCLINA LEGGERMENTE IL PIEDE",
    "MUOVI LENTAMENTE A SINISTRA DI 10-15 CM",
    "MANTIENI IL TALLONE VISIBILE E STABILE",
  ];
  const activeGuideText = recording
    ? guideSteps[guideIndex]
    : "PREMI RECORD E INIZIA MOVIMENTO GUIDATO";
  const moveRight = recording && activeGuideText.includes("DESTRA");
  const moveLeft = recording && activeGuideText.includes("SINISTRA");

  const triggerHaptic = (duration = 80) => {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(duration);
    }
  };

  const playBeep = (frequency = 900, beepDuration = 0.12) => {
    try {
      const AudioContextRef = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextRef) return;

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextRef();
      }

      const ctx = audioCtxRef.current;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.type = "square";
      oscillator.frequency.value = frequency;

      gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + beepDuration
      );

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + beepDuration + 0.02);
    } catch (err) {
      // Silent fallback for browsers without WebAudio support.
    }
  };

  const resetScan = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (uploadRef.current) clearInterval(uploadRef.current);
    if (analysisTimeoutRef.current) clearTimeout(analysisTimeoutRef.current);
    if (videoReadyCheckIntervalRef.current) {
      clearInterval(videoReadyCheckIntervalRef.current);
      videoReadyCheckIntervalRef.current = null;
    }
    if (videoReadyTimeoutRef.current) {
      clearTimeout(videoReadyTimeoutRef.current);
      videoReadyTimeoutRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setRecording(false);
    setSecondsLeft(SCAN_DURATION);
    setAnalyzing(false);
    setUploading(false);
    setUploadProgress(0);
    setCapturedFrame("");
    setActiveCameraLabel("");
    setVideoReady(false);
    setMeasuring(false);
    setMeasureMode("reference");
    setReferencePoints([]);
    setLengthPoints([]);
    setWidthPoints([]);
    setScanMetrics(null);
    setError("");
  };

  const captureCurrentFrame = () => {
    if (!videoRef.current) return "";

    const video = videoRef.current;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.9);
  };

  const startCamera = async () => {
    setError("");
    setVideoReady(false);
    if (videoReadyCheckIntervalRef.current) {
      clearInterval(videoReadyCheckIntervalRef.current);
      videoReadyCheckIntervalRef.current = null;
    }
    if (videoReadyTimeoutRef.current) {
      clearTimeout(videoReadyTimeoutRef.current);
      videoReadyTimeoutRef.current = null;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "navigator.mediaDevices.getUserMedia non disponibile. Serve HTTPS o localhost."
        );
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      let stream = null;
      const tryConstraints = async (videoConstraints) =>
        navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });

      const candidates = [
        { facingMode: { exact: "environment" } },
        { facingMode: { ideal: "environment" } },
        true,
      ];

      for (const c of candidates) {
        try {
          stream = await tryConstraints(c);
          if (stream) break;
        } catch (candidateErr) {
          // Try next candidate.
        }
      }

      if (!stream) {
        const tempStream = await tryConstraints(true);
        tempStream.getTracks().forEach((track) => track.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === "videoinput");
        const rear =
          videoInputs.find((d) => /back|rear|environment|posteriore/i.test(d.label)) ||
          videoInputs[0];

        if (rear) {
          stream = await tryConstraints({ deviceId: { exact: rear.deviceId } });
        }
      }

      if (!stream) {
        throw new Error("Nessuno stream video disponibile dal dispositivo.");
      }

      streamRef.current = stream;
      const activeTrack = stream.getVideoTracks()[0];
      const settings = activeTrack?.getSettings?.() || {};
      setActiveCameraLabel(
        activeTrack?.label ||
          `${settings.facingMode || "camera"} ${settings.width || ""}x${settings.height || ""}`
      );

      requestAnimationFrame(() => {
        if (!videoRef.current) return;
        const videoEl = videoRef.current;
        videoEl.srcObject = stream;
        videoEl.playsInline = true;
        videoEl.muted = true;
        videoEl.setAttribute("autoplay", "true");
        videoEl.setAttribute("playsinline", "true");

        const onPlaying = () => {
          setVideoReady(true);

          if (videoReadyCheckIntervalRef.current) {
            clearInterval(videoReadyCheckIntervalRef.current);
            videoReadyCheckIntervalRef.current = null;
          }
          if (videoReadyTimeoutRef.current) {
            clearTimeout(videoReadyTimeoutRef.current);
            videoReadyTimeoutRef.current = null;
          }

          videoEl.removeEventListener("playing", onPlaying);
        };
        videoEl.addEventListener("playing", onPlaying);

        const tryPlay = async () => {
          try {
            await videoEl.play();
          } catch (playErr) {
            const details =
              playErr instanceof Error
                ? `${playErr.name || "Error"}: ${playErr.message}`
                : String(playErr);
            setError(`ERRORE_VIDEO_PLAYBACK // ${details}`);
          }
        };

        void tryPlay();
        setTimeout(() => {
          if (videoEl.readyState < 2 || videoEl.paused) void tryPlay();
        }, 500);

        // Watchdog su mobile: alcuni browser non emettono "playing" ma il feed può comunque partire.
        videoReadyCheckIntervalRef.current = setInterval(() => {
          const ready = videoEl.readyState >= 2;
          const hasFrame = videoEl.videoWidth > 0;
          const isPlaying = !videoEl.paused;

          if (ready && hasFrame && isPlaying) {
            onPlaying();
          }
        }, 200);

        // Timeout totale: se non arriva mai un frame, mostriamo errore chiaro.
        videoReadyTimeoutRef.current = setTimeout(() => {
          const ready = videoEl.readyState >= 2;
          const hasFrame = videoEl.videoWidth > 0;

          if (!ready || !hasFrame) {
            setError(
              "STREAM_AVVIATO_MA_NESSUN_FRAME // Disattiva risparmio energetico, lascia la pagina aperta e riprova da START_SCAN."
            );
          }

          if (videoReadyCheckIntervalRef.current) {
            clearInterval(videoReadyCheckIntervalRef.current);
            videoReadyCheckIntervalRef.current = null;
          }
          videoReadyTimeoutRef.current = null;
        }, 6500);
      });
      setCameraActive(true);
    } catch (err) {
      const details =
        err instanceof Error
          ? `${err.name || "Error"}: ${err.message}`
          : String(err);

      setError(`ERRORE_CAMERA // ${details}`);
    }
  };

  const startRecording = () => {
    if (!cameraActive || recording) return;

    triggerHaptic(120);
    playBeep(1100, 0.11);
    setRecording(true);
    setGuideIndex(0);
    setSecondsLeft(SCAN_DURATION);

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          setRecording(false);
          triggerHaptic(240);
          playBeep(650, 0.2);
          const frame = captureCurrentFrame();
          setCapturedFrame(frame);
          setAnalyzing(true);
          analysisTimeoutRef.current = setTimeout(() => {
            setAnalyzing(false);
            setMeasuring(true);
          }, ANALYSIS_DURATION);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startUploadPhase = () => {
    setUploading(true);
    setUploadProgress(0);

    const startedAt = Date.now();
    uploadRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.min((elapsed / UPLOAD_DURATION) * 100, 100);
      setUploadProgress(pct);

      if (pct >= 100) {
        clearInterval(uploadRef.current);
      }
    }, 100);
  };

  useEffect(() => {
    if (!recording) return undefined;
    const guideInterval = setInterval(() => {
      setGuideIndex((prev) => (prev + 1) % guideSteps.length);
    }, 3200);
    return () => clearInterval(guideInterval);
  }, [recording]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (uploadRef.current) clearInterval(uploadRef.current);
      if (analysisTimeoutRef.current) clearTimeout(analysisTimeoutRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const uploadComplete = uploadProgress >= 100;

  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

  const renderMeasurementCanvas = (imageSrc) => {
    if (!measureCanvasRef.current || !imageSrc) return;
    const canvas = measureCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const drawSegment = (points, color) => {
        if (!points.length) return;
        ctx.fillStyle = color;
        points.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
          ctx.fill();
        });
        if (points.length === 2) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          ctx.lineTo(points[1].x, points[1].y);
          ctx.stroke();
        }
      };

      drawSegment(referencePoints, "#bef264");
      drawSegment(lengthPoints, "#22d3ee");
      drawSegment(widthPoints, "#f97316");
    };
    img.src = imageSrc;
  };

  useEffect(() => {
    if (measuring && capturedFrame) {
      renderMeasurementCanvas(capturedFrame);
    }
  }, [measuring, capturedFrame, referencePoints, lengthPoints, widthPoints]);

  const onMeasureClick = (event) => {
    if (!measureCanvasRef.current) return;
    const canvas = measureCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const point = {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };

    if (measureMode === "reference") {
      setReferencePoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]));
      return;
    }
    if (measureMode === "length") {
      setLengthPoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]));
      return;
    }
    setWidthPoints((prev) => (prev.length >= 2 ? [point] : [...prev, point]));
  };

  const calculateMetrics = () => {
    if (referencePoints.length < 2 || lengthPoints.length < 2 || widthPoints.length < 2) {
      setError("MISURE_INCOMPLETE // Seleziona 2 punti per riferimento, lunghezza e larghezza.");
      return;
    }

    const refPx = distance(referencePoints[0], referencePoints[1]);
    const pxToMm = referenceMm / refPx;
    const footLengthMm = distance(lengthPoints[0], lengthPoints[1]) * pxToMm;
    const forefootWidthMm = distance(widthPoints[0], widthPoints[1]) * pxToMm;
    const proportionalIndex = forefootWidthMm / footLengthMm;

    setScanMetrics({
      footLengthMm,
      forefootWidthMm,
      proportionalIndex,
      pxToMm,
      timestamp: new Date().toISOString(),
    });
    setError("");
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-zinc-950 text-white">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          cameraActive && videoReady ? "opacity-100" : "opacity-0"
        }`}
      />
      {(!cameraActive || !videoReady) && (
        <div className="absolute inset-0 h-full w-full bg-zinc-200" />
      )}
      {(!cameraActive || !videoReady) && (
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,rgba(132,204,22,0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(132,204,22,0.25)_1px,transparent_1px)] [background-size:34px_34px]" />
      )}
      {(!cameraActive || !videoReady) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded border border-lime-600 bg-white/90 px-4 py-2 font-mono text-xs tracking-[0.12em] text-zinc-900">
            ANTEPRIMA VIDEO NON DISPONIBILE
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-lime-300/5 via-transparent to-lime-300/5" />
      {cameraActive && videoReady && (
        <div className="live-mm-grid pointer-events-none absolute inset-0 z-10" />
      )}
      {cameraActive && !videoReady && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <p className="rounded border border-lime-300/70 bg-black/80 px-4 py-2 font-mono text-xs tracking-[0.14em] text-lime-300">
            INIZIALIZZAZIONE_STREAM_VIDEO...
          </p>
        </div>
      )}

      <header className="absolute left-0 top-0 z-20 w-full border-b border-lime-300/80 bg-black/75 px-6 py-4 font-mono text-xs tracking-[0.2em] text-lime-300">
        UNIT: SCANNER_V1 // TORINO_IT
        {recording && (
          <div className="mt-1 text-[10px] tracking-[0.14em] text-lime-200/90">
            Complete your foot scan for the perfect fit!
          </div>
        )}
      </header>

      <p className="absolute right-4 top-16 z-20 rounded border border-lime-300/50 bg-black/70 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-lime-300">
        LAT: 45.0703 / LON: 7.6869
      </p>
      {cameraActive && (
        <p className="absolute left-4 top-16 z-20 max-w-[75vw] truncate rounded border border-lime-300/50 bg-black/70 px-3 py-1 font-mono text-[10px] tracking-[0.12em] text-lime-300">
          CAM: {activeCameraLabel || "RILEVAMENTO_CAMERA..."}
        </p>
      )}
      {/* Overlay guida “intuitiva” sempre dentro il frame visibile */}

      {cameraActive && videoReady && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="relative h-28 w-28 animate-pulse">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-lime-300 shadow-[0_0_12px_#bef264]" />
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-lime-300 shadow-[0_0_12px_#bef264]" />
            <div className="absolute inset-0 border border-lime-300/70 shadow-[0_0_18px_#bef264]" />
          </div>
        </div>
      )}
      {cameraActive && videoReady && !uploading && !measuring && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4">
          <div className="relative flex h-[62vh] w-full max-w-[440px] items-center justify-center rounded-2xl border border-lime-300/45 bg-black/5 shadow-[0_0_50px_rgba(190,242,100,0.10)]">
            {/* Cornice millimetrica (inside-safe) */}
            <div className="absolute inset-3 rounded-xl border border-lime-300/20" />
            <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-lime-300/70 shadow-[0_0_16px_#bef264]" />
            <div className="absolute left-1/2 top-3 h-1/2 w-[2px] -translate-x-1/2 bg-lime-300/50 shadow-[0_0_14px_#bef264]" />
            {/* Target centrale (stile face-recognition) */}
            <div className="record-target-dot" />
            {/* Laser sweep dentro la cornice */}
            <div className="record-scan-sweep" />

            <div className="absolute top-3 w-full text-center font-mono text-[11px] tracking-[0.18em] text-lime-300/90">
              NEUMA_SCAN // ALLINEA IL PIEDE
            </div>

            {/* Frecce visibili sempre */}
            <div
              className={`absolute left-3 top-1/2 -translate-y-1/2 rounded-lg border px-3 py-2 font-mono text-xs tracking-[0.14em] ${
                moveLeft
                  ? "border-lime-300 bg-lime-300/15 text-lime-300 drop-shadow-[0_0_10px_#bef264]"
                  : "border-lime-300/25 bg-black/10 text-lime-300/45"
              }`}
            >
              ← MUOVI A SINISTRA
            </div>
            <div
              className={`absolute right-3 top-1/2 -translate-y-1/2 rounded-lg border px-3 py-2 font-mono text-xs tracking-[0.14em] ${
                moveRight
                  ? "border-lime-300 bg-lime-300/15 text-lime-300 drop-shadow-[0_0_10px_#bef264]"
                  : "border-lime-300/25 bg-black/10 text-lime-300/45"
              }`}
            >
              MUOVI A DESTRA →
            </div>

            {/* Testo singolo (non “tecnico”, più operativo) */}
            <div className="absolute bottom-3 w-full px-3 text-center font-mono text-[11px] tracking-[0.14em] text-white">
              <span className="text-lime-200/95">{activeGuideText}</span>
            </div>
          </div>
        </div>
      )}

      <section className="absolute inset-0 z-30 flex flex-col items-center justify-center px-6">
        {!cameraActive && (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={startCamera}
              className="rounded-md border-2 border-lime-300 bg-black/80 px-12 py-8 font-mono text-3xl tracking-[0.2em] text-white shadow-[0_0_25px_#bef264] transition hover:scale-[1.02] hover:shadow-[0_0_35px_#bef264]"
            >
              START_SCAN
            </button>
            <p className="text-center font-mono text-[10px] tracking-[0.14em] text-lime-300/90">
              DATA_ENCRYPTION_ACTIVE // ADDITIVE_MANUFACTURING_LAB_TORINO
            </p>
          </div>
        )}

        {cameraActive && !uploading && (
          <div className="mt-auto mb-10 flex w-full max-w-md flex-col items-center gap-4">
            <div className="w-full rounded-md border border-lime-300/80 bg-black/75 px-4 py-3 text-center font-mono text-sm tracking-[0.14em] text-white">
              {recording
                ? `RECORDING // ${secondsLeft.toString().padStart(2, "0")}s`
                : "READY_TO_RECORD"}
            </div>

            <button
              type="button"
              onClick={startRecording}
              disabled={recording}
              className="w-full rounded-md border-2 border-lime-300 bg-black px-8 py-4 font-mono text-xl tracking-[0.18em] text-white shadow-[0_0_20px_#bef264] transition hover:shadow-[0_0_30px_#bef264] disabled:cursor-not-allowed disabled:opacity-50"
            >
              RECORD
            </button>

            <button
              type="button"
              onClick={resetScan}
              className="w-full rounded-md border border-lime-300/80 bg-black/80 px-6 py-3 font-mono text-sm tracking-[0.16em] text-lime-300 transition hover:shadow-[0_0_20px_#bef264]"
            >
              NEW_SCAN
            </button>
            {!videoReady && (
              <button
                type="button"
                onClick={startCamera}
                className="w-full rounded-md border border-yellow-300/80 bg-black/80 px-6 py-3 font-mono text-sm tracking-[0.16em] text-yellow-200 transition hover:shadow-[0_0_20px_#fef08a]"
              >
                RIATTIVA_CAMERA
              </button>
            )}
          </div>
        )}
      </section>

      {measuring && (
        <div className="absolute inset-0 z-40 bg-zinc-950/45 px-4 py-6 md:px-8 backdrop-blur-[2px]">
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-sm tracking-[0.16em] text-lime-300">
                ANALISI_MISURE_PIEDE // STEP_GUIDATO
              </p>
              <button
                type="button"
                onClick={resetScan}
                className="rounded border border-lime-300/70 px-3 py-2 font-mono text-xs tracking-[0.12em] text-lime-300"
              >
                ANNULLA_SCAN
              </button>
            </div>

            <div className="grid flex-1 gap-4 md:grid-cols-[2fr_1fr]">
              <div className="rounded border border-lime-300/50 bg-black/40 p-3">
                <canvas
                  ref={measureCanvasRef}
                  onClick={onMeasureClick}
                  className="h-full max-h-[72vh] w-full cursor-crosshair rounded object-contain"
                />
              </div>

              <div className="flex flex-col gap-3 rounded border border-lime-300/50 bg-black/40 p-4">
                <p className="font-mono text-xs text-white">
                  1) Metti accanto al piede un riferimento noto (es. lato corto A4 = 210mm).
                </p>
                <label className="font-mono text-xs text-lime-300">
                  RIFERIMENTO_MM
                  <input
                    type="number"
                    value={referenceMm}
                    onChange={(e) => setReferenceMm(Number(e.target.value) || 210)}
                    className="mt-1 w-full rounded border border-lime-300/50 bg-black px-2 py-2 text-white"
                  />
                </label>
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => setMeasureMode("reference")}
                    className={`rounded border px-3 py-2 font-mono text-xs ${
                      measureMode === "reference"
                        ? "border-lime-300 bg-lime-300/15 text-lime-300"
                        : "border-white/40 text-white"
                    }`}
                  >
                    PUNTI_RIFERIMENTO ({referencePoints.length}/2)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMeasureMode("length")}
                    className={`rounded border px-3 py-2 font-mono text-xs ${
                      measureMode === "length"
                        ? "border-cyan-300 bg-cyan-300/15 text-cyan-300"
                        : "border-white/40 text-white"
                    }`}
                  >
                    PUNTI_LUNGHEZZA_PIEDE ({lengthPoints.length}/2)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMeasureMode("width")}
                    className={`rounded border px-3 py-2 font-mono text-xs ${
                      measureMode === "width"
                        ? "border-orange-400 bg-orange-400/15 text-orange-300"
                        : "border-white/40 text-white"
                    }`}
                  >
                    PUNTI_LARGHEZZA_AVAMPIEDE ({widthPoints.length}/2)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={calculateMetrics}
                  className="rounded border-2 border-lime-300 px-3 py-2 font-mono text-sm tracking-[0.12em] text-white shadow-[0_0_16px_#bef264]"
                >
                  CALCOLA_MISURE
                </button>

                {scanMetrics && (
                  <div className="rounded border border-lime-300/60 bg-black/60 p-3 font-mono text-xs text-white">
                    <p>LUNGHEZZA: {scanMetrics.footLengthMm.toFixed(1)} mm</p>
                    <p>LARGHEZZA: {scanMetrics.forefootWidthMm.toFixed(1)} mm</p>
                    <p>RAPPORTO W/L: {scanMetrics.proportionalIndex.toFixed(3)}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setMeasuring(false);
                        startUploadPhase();
                      }}
                      className="mt-3 w-full rounded border border-lime-300 px-3 py-2 text-lime-300"
                    >
                      CONFERMA_E_UPLOAD_3D
                    </button>
                  </div>
                )}

                {scanMetrics && (
                  <div className="mt-3">
                    <FootCanvas metrics={scanMetrics} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {uploading && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-zinc-950/82 px-6 backdrop-blur-[1px]">
          <p className="mb-6 font-mono text-sm tracking-[0.18em] text-lime-300">
            UPLOADING_3D_METRICS...
          </p>
          <div className="h-4 w-full max-w-xl overflow-hidden rounded border border-lime-300/90 bg-black">
            <div
              className="h-full bg-lime-300 transition-[width] duration-100"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="mt-3 font-mono text-xs tracking-[0.16em] text-white">
            {Math.floor(uploadProgress)}%
          </p>
          {uploadComplete && (
            <p className="mt-5 text-center font-sans text-base font-medium tracking-[0.02em] text-white">
              Scansione completata, pronto per una nuova acquisizione.
            </p>
          )}
          <button
            type="button"
            onClick={resetScan}
            className="mt-8 rounded-md border border-lime-300/80 bg-black px-6 py-3 font-mono text-sm tracking-[0.16em] text-lime-300 transition hover:shadow-[0_0_20px_#bef264]"
          >
            NEW_SCAN
          </button>
        </div>
      )}

      {analyzing && (
        <div className="absolute inset-0 z-40 overflow-hidden">
          {capturedFrame ? (
            <img
              src={capturedFrame}
              alt="Frame catturato"
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 bg-zinc-950" />
          )}
          <div className="absolute inset-0 bg-zinc-950/10" />
          <div className="analysis-grid absolute inset-0" />
          <div className="laser-sweep absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded border border-lime-300/80 bg-black/70 px-5 py-3">
              <p className="font-mono text-sm tracking-[0.18em] text-lime-300">
                ANALISI_PIEDE_3D
              </p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute bottom-4 left-1/2 z-50 w-[92%] max-w-xl -translate-x-1/2 border border-red-400 bg-black/90 px-4 py-3 text-center font-mono text-xs tracking-[0.1em] text-red-300">
          {error}
        </div>
      )}
    </main>
  );
}

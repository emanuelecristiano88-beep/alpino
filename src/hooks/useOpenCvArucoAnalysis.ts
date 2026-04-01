import { useEffect, useRef, useState } from "react";

type NormPoint = { x: number; y: number };
export type OpenCvArucoQuad = { id: number; corners: NormPoint[] };

export type OpenCvArucoSnapshot = {
  status: "loading" | "ready" | "ready_no_aruco" | "error";
  error: string | null;
  analysisFps: number;
  detectMs: number;
  markerCount: number;
  idsRaw: number[];
  quadsNorm: OpenCvArucoQuad[];
  pipCanvas: HTMLCanvasElement | null;
};

const DEFAULT: OpenCvArucoSnapshot = {
  status: "loading",
  error: null,
  analysisFps: 0,
  detectMs: 0,
  markerCount: 0,
  idsRaw: [],
  quadsNorm: [],
  pipCanvas: null,
};

declare global {
  interface Window {
    AR?: { Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => any; DICTIONARIES?: Record<string, unknown> };
    cv?: any;
    cvReady?: boolean;
  }
}

function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, dw: number, dh: number) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const videoAspect = vw / vh;
  const targetAspect = dw / dh;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (videoAspect > targetAspect) {
    sh = vh; sw = Math.round(vh * targetAspect); sx = Math.round((vw - sw) / 2); sy = 0;
  } else {
    sw = vw; sh = Math.round(vw / targetAspect); sx = 0; sy = Math.round((vh - sh) / 2);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
}

function isArReady(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.AR?.Detector &&
    !!(window.AR?.DICTIONARIES?.["ARUCO_4X4_1000"])
  );
}

export function useOpenCvArucoAnalysis(videoRef: React.RefObject<HTMLVideoElement | null>, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<OpenCvArucoSnapshot>({ ...DEFAULT });
  const liveRef = useRef<OpenCvArucoSnapshot>({ ...DEFAULT });

  const detectorRef = useRef<any>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const fpsRef = useRef<{ lastAt: number; fps: number }>({ lastAt: 0, fps: 0 });
  const busyRef = useRef(false);
  const skipUntilRef = useRef(0);
  const lastPipAtRef = useRef(0);
  const lastLogAtRef = useRef(0);
  const fatalStopRef = useRef(false);

  // Poll for AR.Detector availability until ready, then init detector.
  useEffect(() => {
    if (!enabled) {
      liveRef.current = { ...DEFAULT, status: "loading" };
      setSnapshot(liveRef.current);
      return;
    }

    if (detectorRef.current) return;

    const tryInit = () => {
      if (detectorRef.current || !isArReady()) return false;
      try {
        detectorRef.current = new window.AR!.Detector({ dictionaryName: "ARUCO_4X4_1000" });
        // eslint-disable-next-line no-console
        console.log("AR.Detector(ARUCO_4X4_1000) pronto");
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        liveRef.current = { ...liveRef.current, status: "error", error: msg };
        setSnapshot((s) => ({ ...s, status: "error", error: msg }));
        return false;
      }
    };

    if (tryInit()) return;

    const id = setInterval(() => {
      if (tryInit()) clearInterval(id);
    }, 200);
    return () => clearInterval(id);
  }, [enabled]);

  // RAF analysis loop.
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (busyRef.current) return;
      if (t < skipUntilRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState < 3) return;
      if (!video.videoWidth || !video.videoHeight) return;

      const now = performance.now();
      if (fatalStopRef.current) return;

      // FPS heartbeat (runs even while detector is loading).
      const dt = fpsRef.current.lastAt > 0 ? now - fpsRef.current.lastAt : 0;
      fpsRef.current.lastAt = now;
      fpsRef.current.fps = dt > 0 ? Math.max(0, Math.min(999, 1000 / dt)) : 0;

      // Periodic console log.
      if (now - lastLogAtRef.current > 1000) {
        lastLogAtRef.current = now;
        // eslint-disable-next-line no-console
        console.log(
          "AR.Detector:", !!detectorRef.current,
          "fps:", fpsRef.current.fps.toFixed(1),
          "video:", video.videoWidth + "x" + video.videoHeight,
        );
      }

      // Detector not yet ready: try lazy init, report loading state.
      if (!detectorRef.current) {
        if (isArReady()) {
          try {
            detectorRef.current = new window.AR!.Detector({ dictionaryName: "ARUCO_4X4_1000" });
          } catch {
            // ignore, will retry
          }
        }
        if (!detectorRef.current) {
          const next: OpenCvArucoSnapshot = {
            ...liveRef.current,
            status: "loading",
            error: null,
            analysisFps: fpsRef.current.fps,
            detectMs: 0,
            markerCount: 0,
            idsRaw: [],
            quadsNorm: [],
          };
          liveRef.current = next;
          setSnapshot((prev) => (now - lastPipAtRef.current > 250 ? next : prev));
          return;
        }
      }

      // Camera fatal: zero dimensions (hardware issue only).
      if (!video.videoWidth || !video.videoHeight) {
        fatalStopRef.current = true;
        const next: OpenCvArucoSnapshot = {
          ...liveRef.current,
          status: "error",
          error: "ERRORE: FOTOCAMERA NON AGGANCIATA (videoWidth=0)",
          analysisFps: fpsRef.current.fps,
          detectMs: 0,
          markerCount: 0,
          idsRaw: [],
          quadsNorm: [],
        };
        liveRef.current = next;
        setSnapshot(next);
        return;
      }

      // Compute analysis canvas size (capped at 640×480).
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      let w = Math.min(640, Math.max(160, vw));
      let h = Math.round((w * vh) / vw);
      if (h > 480) { h = 480; w = Math.round((h * vw) / vh); }
      w = Math.max(160, Math.min(640, w));
      h = Math.max(120, Math.min(480, h));

      if (!analysisCanvasRef.current) analysisCanvasRef.current = document.createElement("canvas");
      const canvas = analysisCanvasRef.current;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      busyRef.current = true;
      try {
        // Draw video frame.
        drawCover(ctx, video, w, h);

        // js-aruco2 detection on RGBA ImageData (no WASM needed).
        const imageData = ctx.getImageData(0, 0, w, h);
        const t0 = performance.now();
        const markers: Array<{ id: number; corners: Array<{ x: number; y: number }> }> =
          detectorRef.current.detect(imageData);
        const t1 = performance.now();
        const detectMs = t1 - t0;

        const markerCount = markers.length;
        const idsRaw = markers.map((m) => m.id).slice(0, 12);
        const quadsNorm: OpenCvArucoQuad[] = markers.map((m) => ({
          id: m.id,
          corners: (m.corners || []).map((c) => ({ x: c.x / w, y: c.y / h })),
        }));

        // PIP canvas (low-rate preview).
        let pipCanvas: HTMLCanvasElement | null = liveRef.current.pipCanvas;
        if (now - lastPipAtRef.current > 250) {
          lastPipAtRef.current = now;
          if (!pipCanvasRef.current) pipCanvasRef.current = document.createElement("canvas");
          pipCanvas = pipCanvasRef.current;
          pipCanvas.width = 160;
          pipCanvas.height = 120;
          const pctx = pipCanvas.getContext("2d");
          if (pctx) {
            pctx.drawImage(canvas, 0, 0, w, h, 0, 0, 160, 120);
            // Blue blink rect: heartbeat until first marker detected.
            const blink = Math.floor(now / 350) % 2 === 0;
            if (blink && quadsNorm.length === 0) {
              pctx.strokeStyle = "rgba(40,120,255,0.9)";
              pctx.lineWidth = 3;
              pctx.strokeRect(10, 10, 100, 60);
            }
            // Red outlines for detected markers.
            if (quadsNorm.length > 0) {
              pctx.save();
              pctx.strokeStyle = "rgba(255,70,70,0.95)";
              pctx.lineWidth = 2;
              for (const q of quadsNorm) {
                if (!q.corners?.length) continue;
                pctx.beginPath();
                pctx.moveTo(q.corners[0].x * 160, q.corners[0].y * 120);
                for (let i = 1; i < q.corners.length; i++) {
                  pctx.lineTo(q.corners[i].x * 160, q.corners[i].y * 120);
                }
                pctx.closePath();
                pctx.stroke();
              }
              pctx.restore();
            }
          }
        }

        const next: OpenCvArucoSnapshot = {
          status: "ready",
          error: null,
          analysisFps: fpsRef.current.fps,
          detectMs,
          markerCount,
          idsRaw,
          quadsNorm,
          pipCanvas,
        };
        liveRef.current = next;
        setSnapshot((prev) => {
          if (prev.markerCount !== next.markerCount || prev.status !== next.status || prev.error !== next.error) return next;
          return now - lastPipAtRef.current < 250 ? prev : next;
        });

        if (detectMs > 50) skipUntilRef.current = t + Math.min(400, detectMs * 2);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const next: OpenCvArucoSnapshot = { ...liveRef.current, status: "error", error: msg };
        liveRef.current = next;
        setSnapshot(next);
      } finally {
        busyRef.current = false;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled, videoRef]);

  return { snapshot, liveRef };
}

import { useEffect, useMemo, useRef, useState } from "react";

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

function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, dw: number, dh: number) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const videoAspect = vw / vh;
  const targetAspect = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;
  if (videoAspect > targetAspect) {
    sh = vh;
    sw = Math.round(vh * targetAspect);
    sx = Math.round((vw - sw) / 2);
    sy = 0;
  } else {
    sw = vw;
    sh = Math.round(vw / targetAspect);
    sx = 0;
    sy = Math.round((vh - sh) / 2);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
}

export function useOpenCvArucoAnalysis(videoRef: React.RefObject<HTMLVideoElement | null>, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<OpenCvArucoSnapshot>({ ...DEFAULT });
  const liveRef = useRef<OpenCvArucoSnapshot>({ ...DEFAULT });
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const matsRef = useRef<{
    rgba: any;
    gray: any;
    bw: any;
    corners: any;
    ids: any;
    rejected: any;
    dict: any;
    params: any;
  } | null>(null);

  const fpsRef = useRef<{ lastAt: number; fps: number }>({ lastAt: 0, fps: 0 });
  const busyRef = useRef(false);
  const skipUntilRef = useRef(0);
  const lastPipAtRef = useRef(0);

  const cv = (typeof window !== "undefined" ? (window as any).cv : null) as any;

  const status = useMemo<OpenCvArucoSnapshot["status"]>(() => {
    if (!enabled) return "loading";
    if (!cv || typeof cv.Mat !== "function") return "loading";
    if (!cv.aruco) return "ready_no_aruco";
    return "ready";
  }, [cv, enabled]);

  useEffect(() => {
    if (!enabled) {
      liveRef.current = { ...DEFAULT, status: "loading" };
      setSnapshot(liveRef.current);
      return;
    }
    liveRef.current = { ...liveRef.current, status, error: null };
    setSnapshot((s) => ({ ...s, status, error: null }));
  }, [enabled, status]);

  useEffect(() => {
    if (!enabled) return;
    if (status !== "ready") return;
    if (!cv?.aruco) return;

    // Init outside loop (singleton mats/params/dictionary).
    if (!matsRef.current) {
      try {
        // Pre-allocate stable Mats at analysis resolution.
        const rgba = new cv.Mat(480, 640, cv.CV_8UC4);
        const gray = new cv.Mat(480, 640, cv.CV_8UC1);
        const bw = new cv.Mat(480, 640, cv.CV_8UC1);
        const corners = new cv.MatVector();
        const ids = new cv.Mat();
        const rejected = new cv.MatVector();
        const dict = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
        const params = cv.aruco.DetectorParameters ? new cv.aruco.DetectorParameters() : cv.aruco.DetectorParameters_create?.();
        if (params) {
          if ("minMarkerDistanceRate" in params) params.minMarkerDistanceRate = 0.02;
          if ("adaptiveThreshWinSizeStep" in params) params.adaptiveThreshWinSizeStep = 4;
          if ("cornerRefinementMethod" in params) params.cornerRefinementMethod = cv.aruco.CORNER_REFINE_SUBPIX;
        }
        matsRef.current = { rgba, gray, bw, corners, ids, rejected, dict, params };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        liveRef.current = { ...liveRef.current, status: "error", error: msg };
        setSnapshot((s) => ({ ...s, status: "error", error: msg }));
      }
    }

    return () => {
      // Memory mgmt: delete on unmount.
      const m = matsRef.current;
      matsRef.current = null;
      try {
        m?.rgba?.delete?.();
        m?.gray?.delete?.();
        m?.bw?.delete?.();
        m?.corners?.delete?.();
        m?.ids?.delete?.();
        m?.rejected?.delete?.();
        // dict is a simple object in some builds; only delete if present.
        m?.dict?.delete?.();
        m?.params?.delete?.();
      } catch {
        // ignore
      }
    };
  }, [cv, enabled, status]);

  useEffect(() => {
    if (!enabled) return;
    if (status !== "ready") return;
    let raf = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (busyRef.current) return;
      if (t < skipUntilRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const m = matsRef.current;
      if (!m) return;
      const w = 640;
      const h = 480;
      if (!analysisCanvasRef.current) analysisCanvasRef.current = document.createElement("canvas");
      const canvas = analysisCanvasRef.current;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      busyRef.current = true;

      const now = performance.now();
      const dt = fpsRef.current.lastAt > 0 ? now - fpsRef.current.lastAt : 0;
      fpsRef.current.lastAt = now;
      fpsRef.current.fps = dt > 0 ? Math.max(0, Math.min(999, 1000 / dt)) : 0;

      try {
        drawCover(ctx, video, w, h);

        // Direct buffer -> cv (no toDataURL). Use imread from canvas.
        const t0 = performance.now();
        // Read frame -> temporary RGBA mat, then reuse pre-allocated gray/bw mats.
        const rgbaTmp = cv.imread(canvas);
        cv.cvtColor(rgbaTmp, m.gray, cv.COLOR_RGBA2GRAY, 0);
        rgbaTmp.delete?.();
        cv.adaptiveThreshold(m.gray, m.bw, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 7);

        // detect markers
        // NOTE: OpenCV.js doesn't provide a clear() on MatVector across builds.
        // We recreate only these lightweight containers per-frame; heavy Mats stay pre-allocated.
        m.corners.delete?.();
        m.rejected.delete?.();
        m.ids.delete?.();
        m.corners = new cv.MatVector();
        m.rejected = new cv.MatVector();
        m.ids = new cv.Mat();
        cv.aruco.detectMarkers(m.bw, m.dict, m.corners, m.ids, m.params, m.rejected);

        const detectMs = performance.now() - t0;

        const markerCount = m.ids?.rows ? m.ids.rows : 0;
        const idsRaw: number[] = [];
        if (markerCount > 0 && m.ids.data32S) {
          for (let i = 0; i < markerCount; i++) idsRaw.push(m.ids.data32S[i]);
        }

        const quadsNorm: OpenCvArucoQuad[] = [];
        for (let i = 0; i < m.corners.size(); i++) {
          const cmat = m.corners.get(i);
          const pts: NormPoint[] = [];
          // corners are float32 [x0,y0,x1,y1,x2,y2,x3,y3]
          const arr = cmat.data32F;
          if (arr && arr.length >= 8) {
            for (let k = 0; k < 8; k += 2) {
              pts.push({ x: arr[k] / w, y: arr[k + 1] / h });
            }
          }
          const id = idsRaw[i] ?? -1;
          quadsNorm.push({ id, corners: pts });
          cmat.delete?.();
        }

        // PIP: show B/W result (low rate)
        let pipCanvas: HTMLCanvasElement | null = liveRef.current.pipCanvas;
        if (now - lastPipAtRef.current > 250) {
          lastPipAtRef.current = now;
          if (!pipCanvasRef.current) pipCanvasRef.current = document.createElement("canvas");
          pipCanvas = pipCanvasRef.current;
          pipCanvas.width = 160;
          pipCanvas.height = 120;
          cv.imshow(pipCanvas, m.bw);
        }

        const next: OpenCvArucoSnapshot = {
          status: "ready",
          error: null,
          analysisFps: fpsRef.current.fps,
          detectMs,
          markerCount,
          idsRaw: idsRaw.slice(0, 12),
          quadsNorm,
          pipCanvas,
        };

        liveRef.current = next;
        // Throttle React commits (avoid rerender every frame)
        setSnapshot((prev) => {
          if (prev.markerCount !== next.markerCount || prev.status !== next.status || prev.error !== next.error) return next;
          // update max ~4Hz
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
  }, [enabled, status, videoRef, cv]);

  return { snapshot, liveRef };
}


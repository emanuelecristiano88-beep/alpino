import { useCallback, useEffect, useRef } from "react";

const VIDEO_ELEMENT_ID = "neuma-live-video";

/**
 * Nuclear vanilla camera: finds <video> by DOM id, never uses React refs.
 * Completely immune to React re-renders, reconciliation, and ref timing.
 */
export function useNativeCamera() {
  const streamRef = useRef<MediaStream | null>(null);
  const errorDivRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);

  const showError = useCallback((msg: string) => {
    console.error("[useNativeCamera]", msg);
    if (!errorDivRef.current) {
      const div = document.createElement("div");
      div.style.cssText =
        "position:fixed;bottom:16px;left:16px;right:16px;z-index:999999;" +
        "background:rgba(220,38,38,0.92);color:#fff;padding:12px 16px;" +
        "border-radius:14px;font:600 13px/1.4 system-ui,sans-serif;" +
        "pointer-events:none;white-space:pre-wrap;word-break:break-word;";
      document.body.appendChild(div);
      errorDivRef.current = div;
    }
    errorDivRef.current.textContent = msg;
  }, []);

  const getVideoEl = useCallback((): HTMLVideoElement | null => {
    return document.getElementById(VIDEO_ELEMENT_ID) as HTMLVideoElement | null;
  }, []);

  const start = useCallback(async () => {
    if (!mountedRef.current) return;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const videoEl = getVideoEl();
      if (!videoEl) {
        showError("Video element #neuma-live-video non trovato nel DOM.");
        return;
      }

      videoEl.srcObject = stream;
      videoEl.muted = true;
      videoEl.setAttribute("playsinline", "");

      setTimeout(() => {
        videoEl.play().catch((e) => console.error("Play fallito:", e));
      }, 100);
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      showError(`Camera error: ${e?.name || "Error"} — ${e?.message || String(err)}`);
    }
  }, [getVideoEl, showError]);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const videoEl = getVideoEl();
    if (videoEl) {
      try {
        videoEl.srcObject = null;
      } catch {
        // ignore
      }
    }
  }, [getVideoEl]);

  useEffect(() => {
    const videoEl = getVideoEl();
    if (!videoEl) return;

    const onError = () => {
      const err = videoEl.error;
      const msg = err
        ? `Video error [${err.code}]: ${err.message || "unknown"}`
        : "Video error (unknown)";
      showError(msg);
    };

    videoEl.addEventListener("error", onError);
    return () => videoEl.removeEventListener("error", onError);
  }, [getVideoEl, showError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (errorDivRef.current) {
        try {
          document.body.removeChild(errorDivRef.current);
        } catch {
          // ignore
        }
        errorDivRef.current = null;
      }
    };
  }, []);

  return { start, stop, streamRef };
}

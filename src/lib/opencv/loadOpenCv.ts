let loadPromise: Promise<void> | null = null;

declare global {
  interface Window {
    cv?: any;
    Module?: any;
    __opencv_boot?: { errors?: string[]; ready?: boolean };
  }
}

const OPENCV_LOCAL_URL = "https://docs.opencv.org/4.5.5/opencv.js";

export function isOpenCvReady(): boolean {
  // cv exists and runtime initialized (Mat is a reliable signal)
  return typeof window !== "undefined" && !!window.cv && typeof window.cv.Mat === "function";
}

export function hasArucoModule(): boolean {
  try {
    const cv = window.cv;
    return !!cv?.aruco;
  } catch {
    return false;
  }
}

export function loadOpenCv({
  timeoutMs = 20_000,
}: {
  timeoutMs?: number;
} = {}): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("OpenCV can only load in browser"));
  if (isOpenCvReady()) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const SCRIPT_ID = "opencv-script";
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const preloaded = Array.from(document.scripts).find((s) => (s as HTMLScriptElement).src?.includes(OPENCV_LOCAL_URL));
    const inject = (src: string) => {
      // If OpenCV is already present in DOM, don't inject again.
      if (preloaded) return preloaded as HTMLScriptElement;
      // If a prior script exists but runtime isn't ready, remove it so we can
      // re-define `window.Module` BEFORE a clean load.
      if (existing && !isOpenCvReady()) {
        try {
          existing.remove();
        } catch {
          // ignore
        }
      } else if (existing) {
        return existing;
      }
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.dataset.opencv = "true";
      // Hard-load: do not async so Emscripten boot happens immediately.
      script.async = false;
      script.src = src;
      document.head.appendChild(script);
      return script;
    };

    let done = false;
    const finishOk = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const finishErr = (e: unknown) => {
      if (done) return;
      done = true;
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    let t = window.setTimeout(() => {
      const hint = window.cv ? "cv present but not initialized" : "cv not present";
      const bootErrs = window.__opencv_boot?.errors?.slice?.(-3)?.join(" | ");
      const extra = bootErrs ? `; ${bootErrs}` : "";
      finishErr(new Error(`Errore caricamento libreria locale. Controlla la connessione. (${hint}${extra})`));
    }, timeoutMs);

    // Emscripten binding: define Module.onRuntimeInitialized BEFORE loading the script.
    try {
      const prev = window.Module;
      window.Module = {
        ...(typeof prev === "object" && prev ? prev : {}),
        onRuntimeInitialized: () => {
          window.clearTimeout(t);
          finishOk();
        },
        locateFile: (path: string) => `https://docs.opencv.org/4.5.5/${path}`,
      };
    } catch {
      // ignore
    }

    const onLoad = () => {
      // If already ready, resolve immediately; else wait for runtime init.
      if (isOpenCvReady()) {
        window.clearTimeout(t);
        finishOk();
        return;
      }
      // Poll: some builds may not trigger onRuntimeInitialized reliably.
      const started = performance.now();
      const poll = () => {
        if (done) return;
        if (isOpenCvReady()) {
          window.clearTimeout(t);
          finishOk();
          return;
        }
        if (performance.now() - started > timeoutMs) return;
        window.setTimeout(poll, 500);
      };
      window.setTimeout(poll, 500);
    };

    console.log("Controllo file:", window.location.origin + OPENCV_LOCAL_URL);

    // If OpenCV was preloaded, don't wipe `window.cv`.
    if (!preloaded) {
      // Clear prior cv to avoid partial states
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).cv = undefined;
      } catch {}
    }

    const script = inject(OPENCV_LOCAL_URL);
    script.onload = onLoad;
    script.onerror = () => {
      window.clearTimeout(t);
      finishErr(new Error(`Errore caricamento libreria locale. Controlla la connessione. (src=${OPENCV_LOCAL_URL})`));
    };
  }).catch((e) => {
    loadPromise = null;
    throw e;
  });

  return loadPromise;
}


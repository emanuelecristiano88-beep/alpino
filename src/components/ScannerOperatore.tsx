"use client";

/**
 * Scanner assistito NEUMA — cupola virtuale (32 settori) senza ARCore.
 * Camera fullscreen + overlay SVG, orientamento per settore, auto-scatto a stabilità.
 * Distanza: ProximitySensor se disponibile, altrimenti euristica orientamento + stabilità (vedi commenti).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Webcam from "react-webcam";
import { cn } from "../lib/utils";
import { Upload } from "lucide-react";
import NeumaLogo from "./NeumaLogo";

const DOME_SECTORS = 32;
const IDEAL_MIN_CM = 30;
const IDEAL_MAX_CM = 40;
const STILL_MS = 500;
const MOTION_STILL_THRESHOLD = 0.35;

type SectorState = "pending" | "active" | "done";

export type ScannerOperatoreProps = {
  className?: string;
  /** Chiamato quando tutti i 32 settori sono verdi */
  onDomeComplete?: (shots: string[]) => void;
  /** Abilita log console per debug orientamento */
  debugOrientation?: boolean;
};

const UPLOAD_SECRET = import.meta.env.VITE_UPLOAD_API_SECRET as string | undefined;

/** Upload singolo scatto su Google Drive (API Vercel `/api/upload-operator-shot`). */
async function uploadOperatorShotToDrive(
  blob: Blob,
  sectorIndex: number,
  sessionId: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  onProgress(0.12);
  const form = new FormData();
  form.append("photo", blob, `sector_${String(sectorIndex).padStart(2, "0")}.jpg`);
  form.append("sector", String(sectorIndex));
  form.append("sessionId", sessionId);

  const headers = new Headers();
  if (UPLOAD_SECRET) headers.set("x-upload-secret", UPLOAD_SECRET);

  onProgress(0.28);
  const res = await fetch("/api/upload-operator-shot", {
    method: "POST",
    body: form,
    headers,
  });
  onProgress(0.75);
  const text = await res.text();
  let data: { ok?: boolean; error?: string; driveUploaded?: boolean } | null = null;
  try {
    data = JSON.parse(text) as { ok?: boolean; error?: string; driveUploaded?: boolean };
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(data?.error || text || `HTTP ${res.status}`);
  }
  if (data && data.ok === false) {
    throw new Error(data.error || "Upload fallito");
  }
  onProgress(1);
  if (import.meta.env.DEV) {
    console.log(
      "[NEUMA ScannerOperatore] Upload settore",
      sectorIndex + 1,
      data?.driveUploaded ? "→ Drive" : "(server senza Drive / mock)"
    );
  }
}

function useOrientationTracking(enabled: boolean) {
  const [alpha, setAlpha] = useState<number | null>(null);
  const [beta, setBeta] = useState<number | null>(null);
  const [gamma, setGamma] = useState<number | null>(null);
  const [perm, setPerm] = useState<"unknown" | "granted" | "denied">("unknown");

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha != null) setAlpha(e.alpha);
      if (e.beta != null) setBeta(e.beta);
      if (e.gamma != null) setGamma(e.gamma);
    };

    const needsIosPermission =
      typeof DeviceOrientationEvent !== "undefined" &&
      "requestPermission" in DeviceOrientationEvent &&
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<PermissionState> })
        .requestPermission === "function";

    if (needsIosPermission) {
      (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<PermissionState> })
        .requestPermission()
        .then((s) => setPerm(s === "granted" ? "granted" : "denied"))
        .catch(() => setPerm("denied"));
    } else {
      setPerm("granted");
    }

    window.addEventListener("deviceorientation", onOrient, true);
    return () => window.removeEventListener("deviceorientation", onOrient, true);
  }, [enabled]);

  return { alpha, beta, gamma, perm };
}

function useMotionStability(enabled: boolean) {
  const lastMag = useRef(0);
  const lastTs = useRef(0);

  const [isStill, setIsStill] = useState(false);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const now = performance.now();
      const dt = Math.max(1, now - lastTs.current);
      const jerk = Math.abs(mag - lastMag.current) / dt;
      lastMag.current = mag;
      lastTs.current = now;
      setIsStill(jerk < MOTION_STILL_THRESHOLD);
    };

    window.addEventListener("devicemotion", onMotion, true);
    return () => window.removeEventListener("devicemotion", onMotion, true);
  }, [enabled]);

  return isStill;
}

/** Mappa angolo orizzontale (alpha) → settore 0..31 */
function alphaToSector(alpha: number | null): number | null {
  if (alpha == null || Number.isNaN(alpha)) return null;
  const a = ((alpha % 360) + 360) % 360;
  return Math.min(DOME_SECTORS - 1, Math.floor((a / 360) * DOME_SECTORS));
}

/** Distanza (cm): ProximitySensor se presente; altrimenti null */
function useProximityCm(enabled: boolean) {
  const [cm, setCm] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const ProxSensor = (window as unknown as { ProximitySensor?: new () => { addEventListener: (ev: string, fn: (e: { distance: number }) => void) => void; start: () => void } }).ProximitySensor;

    if (!ProxSensor) {
      setCm(null);
      return;
    }

    try {
      const sensor = new ProxSensor();
      sensor.addEventListener("reading", (e: { distance: number }) => {
        setCm(e.distance ?? null);
      });
      sensor.start();
      return () => {
        try {
          (sensor as unknown as { stop?: () => void }).stop?.();
        } catch {
          /* noop */
        }
      };
    } catch {
      setCm(null);
    }
  }, [enabled]);

  return cm;
}

function distanceStatus(
  proximityCm: number | null,
  beta: number | null
): { ok: boolean; tooFar: boolean; label: string; ringWidth: number } {
  if (proximityCm != null) {
    const ok = proximityCm >= IDEAL_MIN_CM && proximityCm <= IDEAL_MAX_CM;
    const tooFar = proximityCm > IDEAL_MAX_CM + 5;
    const err = Math.min(1, Math.abs(proximityCm - 35) / 25);
    const ringWidth = 3 + 6 * (1 - err);
    return {
      ok,
      tooFar,
      label: tooFar ? "AVVICINATI" : ok ? "Distanza OK" : "ALLONTANATI",
      ringWidth: Math.max(2, ringWidth),
    };
  }

  /** Senza sensore: euristica “guarda il piede” (beta ~ 60–110°) */
  if (beta != null) {
    const lookingDown = beta > 45 && beta < 110;
    const tooVertical = beta < 35;
    return {
      ok: lookingDown,
      tooFar: tooVertical,
      label: tooVertical ? "AVVICINATI" : lookingDown ? "Inquadra il piede" : "Abbassa il telefono",
      ringWidth: lookingDown ? 7 : 4,
    };
  }

  return { ok: true, tooFar: false, label: "Inquadra", ringWidth: 5 };
}

export default function ScannerOperatore({ className, onDomeComplete, debugOrientation = false }: ScannerOperatoreProps) {
  const sessionIdRef = useRef(crypto.randomUUID());
  const webcamRef = useRef<Webcam>(null);
  const [sectors, setSectors] = useState<SectorState[]>(() => Array.from({ length: DOME_SECTORS }, () => "pending"));
  const sectorsRef = useRef(sectors);
  sectorsRef.current = sectors;
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [hint, setHint] = useState("MUOVITI LENTAMENTE ATTORNO AL TALLONE");

  const { alpha, beta, gamma, perm } = useOrientationTracking(true);
  const isStill = useMotionStability(perm !== "denied");
  const proximityCm = useProximityCm(true);

  const activeSector = useMemo(() => alphaToSector(alpha), [alpha]);

  const [stillAccumMs, setStillAccumMs] = useState(0);
  const capturingRef = useRef(false);
  const shotsRef = useRef<string[]>(Array.from({ length: DOME_SECTORS }, () => ""));

  const dist = useMemo(() => distanceStatus(proximityCm, beta), [proximityCm, beta]);

  useEffect(() => {
    if (beta != null && beta < 55) {
      setHint("ALZA IL TELEFONO PER LA VISTA DALL'ALTO");
    } else {
      setHint("MUOVITI LENTAMENTE ATTORNO AL TALLONE");
    }
  }, [beta]);

  useEffect(() => {
    if (debugOrientation && alpha != null) {
      console.log("[ScannerOperatore] α", alpha.toFixed(1), "β", beta?.toFixed(1), "γ", gamma?.toFixed(1), "sector", activeSector);
    }
  }, [alpha, beta, gamma, activeSector, debugOrientation]);

  /** Accumula tempo stabile */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!isStill) {
        setStillAccumMs(0);
        return;
      }
      setStillAccumMs((ms) => ms + 100);
    }, 100);
    return () => window.clearInterval(id);
  }, [isStill]);

  const captureSector = useCallback(
    async (sectorIndex: number) => {
      if (sectorsRef.current[sectorIndex] !== "pending") return;

      const webcam = webcamRef.current;
      if (!webcam) return;
      const shot = webcam.getScreenshot();
      if (!shot) return;

      let shouldComplete = false;
      setSectors((prev) => {
        if (prev[sectorIndex] !== "pending") return prev;
        const next = [...prev];
        next[sectorIndex] = "done";
        shotsRef.current[sectorIndex] = shot;
        shouldComplete = next.every((s) => s === "done");
        return next;
      });

      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(120);
      }

      setUploadBusy(true);
      setUploadProgress(0);
      try {
        const res = await fetch(shot);
        const blob = await res.blob();
        await uploadOperatorShotToDrive(blob, sectorIndex, sessionIdRef.current, setUploadProgress);
      } finally {
        setUploadBusy(false);
        setUploadProgress(0);
      }

      if (shouldComplete) {
        onDomeComplete?.([...shotsRef.current]);
      }
    },
    [onDomeComplete]
  );

  /** Auto-trigger: fermo 0.5s nel settore corrente, settore pending, distanza ok */
  useEffect(() => {
    if (activeSector == null || perm === "denied") return;
    if (stillAccumMs < STILL_MS) return;
    if (!dist.ok) return;
    if (capturingRef.current) return;

    capturingRef.current = true;
    setStillAccumMs(0);
    void captureSector(activeSector).finally(() => {
      capturingRef.current = false;
    });
  }, [activeSector, stillAccumMs, captureSector, dist.ok, perm]);

  /** Geometria cupola: semicerchio superiore, base verso il basso (piede in basso) */
  const domeLayout = useMemo(() => {
    const cx = 50;
    const cy = 72;
    const r = 38;
    const start = Math.PI * 0.85;
    const end = Math.PI * 0.15;
    const pts: { x: number; y: number; id: number }[] = [];
    for (let i = 0; i < DOME_SECTORS; i++) {
      const t = start + ((end - start) * i) / (DOME_SECTORS - 1);
      pts.push({
        id: i,
        x: cx + r * Math.cos(t),
        y: cy + r * Math.sin(t),
      });
    }
    return { cx, cy, r, pts };
  }, []);

  const ringColor = dist.tooFar ? "#ef4444" : dist.ok ? "#22c55e" : "#f59e0b";
  const ringLabel = dist.tooFar ? "AVVICINATI" : dist.label;

  return (
    <div className={cn("relative min-h-[100dvh] w-full overflow-hidden bg-black", className)}>
      <Webcam
        ref={webcamRef}
        audio={false}
        screenshotFormat="image/jpeg"
        screenshotQuality={0.92}
        videoConstraints={{ facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }}
        className="absolute inset-0 h-full w-full object-cover"
      />

      <div className="pointer-events-none absolute left-0 top-0 z-30 pl-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <NeumaLogo variant="dark" size="sm" className="drop-shadow-[0_1px_8px_rgba(0,0,0,0.65)]" />
      </div>

      {/* Overlay cupola */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="domeGlow" cx="50%" cy="70%" r="55%">
            <stop offset="0%" stopColor="rgba(37,99,235,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill="url(#domeGlow)" />

        {domeLayout.pts.map((p) => {
          const st = sectors[p.id];
          const isActive = activeSector === p.id;
          const fill =
            st === "done"
              ? "rgba(34,197,94,0.85)"
              : isActive
                ? "rgba(37,99,235,0.95)"
                : "rgba(229,229,229,0.35)";
          const stroke = st === "done" ? "#22c55e" : isActive ? "#60a5fa" : "rgba(255,255,255,0.25)";
          return (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={1.35}
              fill={fill}
              stroke={stroke}
              strokeWidth={0.2}
            />
          );
        })}
      </svg>

      {/* Mirino smart focus */}
      <div className="pointer-events-none absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2">
        <div
          className="flex h-44 w-44 items-center justify-center rounded-full border-dashed border-white/20"
          style={{
            borderWidth: `${dist.ringWidth}px`,
            borderColor: ringColor,
            boxShadow: dist.ok ? "0 0 24px rgba(34,197,94,0.35)" : "0 0 18px rgba(239,68,68,0.25)",
          }}
        >
          <span className="rounded-full bg-black/55 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-white">
            {ringLabel}
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute right-2 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-2">
        <div className="flex h-40 w-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="pointer-events-none mt-auto w-full rounded-full bg-[#2563eb] transition-all duration-300"
            style={{ height: `${Math.round(uploadProgress * 100)}%` }}
          />
        </div>
        <Upload className="h-6 w-6 text-[#2563eb]" aria-hidden />
        <span className="max-w-[4rem] text-center font-mono text-[8px] uppercase leading-tight text-white/80">
          {uploadBusy ? "Invio…" : "Drive"}
        </span>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 bg-black px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="text-center font-mono text-xs font-semibold uppercase tracking-[0.08em] text-white">{hint}</p>
        {perm === "denied" && (
          <p className="mt-2 text-center text-[10px] text-amber-300">
            Orientamento non disponibile: abilita i sensori in Safari o usa rotazione manuale (modalità sviluppo).
          </p>
        )}
        <div className="mt-3 flex justify-center gap-5 font-mono text-[10px] text-zinc-400">
          <span>Settore: {activeSector ?? "—"}</span>
          <span>Stabile: {isStill ? "sì" : "no"}</span>
          <span>Verdi: {sectors.filter((s) => s === "done").length}/{DOME_SECTORS}</span>
        </div>
      </div>
    </div>
  );
}

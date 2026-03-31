"use client";

import { useCallback, useEffect, useState } from "react";
import { SCAN_METRICS_STORAGE_KEY } from "../constants/scan";
import type { ScanMetricsPayload } from "../types/scanMetrics";

function defaultPayload(): ScanMetricsPayload {
  const now = new Date().toISOString();
  return {
    lunghezzaMm: 265,
    larghezzaMm: 95,
    altezzaArcoMm: 28,
    circonferenzaColloMm: 246,
    volumeCm3: 1450,
    left: {
      lunghezzaMm: 264,
      larghezzaMm: 98,
      altezzaArcoMm: 27,
      circonferenzaColloMm: 244,
      volumeCm3: 1420,
    },
    right: {
      lunghezzaMm: 267,
      larghezzaMm: 101,
      altezzaArcoMm: 29,
      circonferenzaColloMm: 248,
      volumeCm3: 1480,
    },
    scanVersion: "V6",
    updatedAt: now,
  };
}

function readFromStorage(): ScanMetricsPayload {
  if (typeof sessionStorage === "undefined") return defaultPayload();
  try {
    const raw = sessionStorage.getItem(SCAN_METRICS_STORAGE_KEY);
    if (!raw) return defaultPayload();
    const parsed = JSON.parse(raw) as ScanMetricsPayload;
    if (typeof parsed.lunghezzaMm !== "number" || typeof parsed.larghezzaMm !== "number" || typeof parsed.volumeCm3 !== "number") {
      return defaultPayload();
    }
    const d = defaultPayload();
    return {
      ...d,
      ...parsed,
      left: { ...d.left, ...parsed.left },
      right: { ...d.right, ...parsed.right },
    };
  } catch {
    return defaultPayload();
  }
}

/**
 * Metriche da sessionStorage (ultima scansione) con fallback.
 * Si aggiorna quando la finestra torna in focus (dopo upload da scanner).
 */
export function useScanMetrics() {
  const [metrics, setMetrics] = useState<ScanMetricsPayload>(defaultPayload);

  const refresh = useCallback(() => {
    setMetrics(readFromStorage());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  return { metrics, refresh };
}

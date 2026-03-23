/**
 * Rilevamento ArUco via WASM (@ar-js-org/aruco-rs), dizionario compatibile ARuco / OpenCV “ARUCO”.
 * Inizializzazione lazy: non blocca il primo paint.
 */

import type { ArucoMarkerDetection } from "./a4MarkerGeometry";

/** Allinea al PDF guida stampa NEUMA: se usi un altro dizionario OpenCV, cambia qui (es. "ARUCO_MIP_36H12"). */
export const ARUCO_DICTIONARY_NAME = "ARUCO";
const FALLBACK_DICTIONARIES = ["DICT_4X4_50", "DICT_6X6_250"] as const;

const MAX_HAMMING = 2;

let detector: import("@ar-js-org/aruco-rs").ARucoDetector | null = null;
let initPromise: Promise<void> | null = null;
const detectorByDictionary = new Map<string, import("@ar-js-org/aruco-rs").ARucoDetector>();

function normalizeDetections(raw: unknown): ArucoMarkerDetection[] {
  if (!Array.isArray(raw)) return [];
  const out: ArucoMarkerDetection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: number }).id;
    const corners = (item as { corners?: unknown }).corners;
    const distance = (item as { distance?: number }).distance;
    if (typeof id !== "number" || !Array.isArray(corners)) continue;
    const pts: { x: number; y: number }[] = [];
    for (const p of corners) {
      if (p && typeof p === "object" && "x" in p && "y" in p) {
        pts.push({ x: Number((p as { x: number }).x), y: Number((p as { y: number }).y) });
      }
    }
    if (pts.length >= 4) out.push({ id, distance, corners: pts });
  }
  return out;
}

/**
 * Carica WASM e crea il detector (singleton).
 */
export async function ensureArucoDetector(): Promise<import("@ar-js-org/aruco-rs").ARucoDetector> {
  if (detector) return detector;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import("@ar-js-org/aruco-rs");
      await mod.default();
      detector = new mod.ARucoDetector(ARUCO_DICTIONARY_NAME, MAX_HAMMING);
      detectorByDictionary.set(ARUCO_DICTIONARY_NAME, detector);
    })().catch((e: unknown) => {
      initPromise = null;
      throw e instanceof Error ? e : new Error(String(e));
    });
  }
  await initPromise;
  if (!detector) throw new Error("ArUco detector non inizializzato");
  return detector;
}

export function isArucoDetectorReady(): boolean {
  return detector !== null;
}

/**
 * Esegue detect su frame RGBA (es. da getImageData).
 */
export function detectArucoOnImageData(imageData: ImageData): ArucoMarkerDetection[] {
  if (!detector) return [];
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  try {
    const raw = detector.detect_image(width, height, rgba);
    return normalizeDetections(raw);
  } catch {
    return [];
  }
}

async function getDetectorForDictionary(dictionaryName: string): Promise<import("@ar-js-org/aruco-rs").ARucoDetector | null> {
  const cached = detectorByDictionary.get(dictionaryName);
  if (cached) return cached;
  try {
    const mod = await import("@ar-js-org/aruco-rs");
    await mod.default();
    const next = new mod.ARucoDetector(dictionaryName, MAX_HAMMING);
    detectorByDictionary.set(dictionaryName, next);
    return next;
  } catch {
    return null;
  }
}

/**
 * Prova più dizionari (ARUCO, 4x4, 6x6) e ritorna il primo match valido.
 */
export async function detectArucoOnImageDataMultiDictionary(
  imageData: ImageData,
  dictionaries: readonly string[] = [ARUCO_DICTIONARY_NAME, ...FALLBACK_DICTIONARIES]
): Promise<{ dictionary: string; detections: ArucoMarkerDetection[] } | null> {
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  for (const dict of dictionaries) {
    const d = await getDetectorForDictionary(dict);
    if (!d) continue;
    try {
      const raw = d.detect_image(width, height, rgba);
      const detections = normalizeDetections(raw);
      if (detections.length > 0) return { dictionary: dict, detections };
    } catch {
      // try next dictionary
    }
  }
  return null;
}

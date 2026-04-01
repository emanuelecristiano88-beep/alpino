/**
 * Rilevamento ArUco via WASM (@ar-js-org/aruco-rs), dizionario compatibile ARuco / OpenCV “ARUCO”.
 * Inizializzazione lazy: non blocca il primo paint.
 */

import type { ArucoMarkerDetection } from "./a4MarkerGeometry";
// Force an explicit WASM URL (absolute) so bundlers/devices don't guess wrong paths.
// Vite will emit this into /assets/… and serve it with correct MIME.
// eslint-disable-next-line import/no-unresolved
import arucoWasmUrl from "@ar-js-org/aruco-rs/aruco_rs_bg.wasm?url";

/** Allinea al PDF guida stampa NEUMA: marker stampati DICT_4X4_50 (ID 0–3). */
export const ARUCO_DICTIONARY_NAME = "DICT_4X4_50";
// Brute force: try multiple 4x4 dictionaries (common OpenCV ArUco sets) + legacy fallbacks.
const BRUTEFORCE_4X4_DICTIONARIES = ["DICT_4X4_50", "DICT_4X4_100", "DICT_4X4_250", "DICT_4X4_1000"] as const;
const FALLBACK_DICTIONARIES = ["ARUCO", "DICT_6X6_250"] as const;
export const ALL_DICTIONARIES = [...BRUTEFORCE_4X4_DICTIONARIES, ...FALLBACK_DICTIONARIES] as const;

const MAX_HAMMING = 2;

let detector: import("@ar-js-org/aruco-rs").ARucoDetector | null = null;
let initPromise: Promise<void> | null = null;
const detectorByDictionary = new Map<string, import("@ar-js-org/aruco-rs").ARucoDetector>();
let lastInitError: string | null = null;
let lastInitWasmUrl: string | null = null;

function supportsWasmSimd(): boolean {
  try {
    // Minimal SIMD module (v128.const). If validation fails, SIMD isn't supported.
    // eslint-disable-next-line no-new
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // \0asm
      0x01, 0x00, 0x00, 0x00, // version
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type: () -> v128
      0x03, 0x02, 0x01, 0x00, // func section: 1 func, type 0
      0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00, // export "run" func 0
      0x0a, 0x0b, 0x01, 0x09, 0x00, 0xfd, 0x00, // v128.const
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x0b, // end
    ]);
    // @ts-expect-error WebAssembly.validate exists
    return typeof WebAssembly !== "undefined" && typeof WebAssembly.validate === "function" && WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

export function getArucoInitError(): string | null {
  return lastInitError;
}

export function getArucoWasmUrl(): string | null {
  return lastInitWasmUrl;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: number | null = null;
  const timeout = new Promise<T>((_, rej) => {
    t = window.setTimeout(() => {
      rej(new Error(`${label} timeout after ${ms}ms`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (t) window.clearTimeout(t);
  });
}

function detectWith(det: import("@ar-js-org/aruco-rs").ARucoDetector, width: number, height: number, rgba: Uint8Array) {
  try {
    const raw = det.detect_image(width, height, rgba);
    return normalizeDetections(raw);
  } catch {
    return [];
  }
}

function toGrayLuma(data: Uint8ClampedArray | Uint8Array): Uint8Array {
  const gray = new Uint8Array((data.length / 4) | 0);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = Math.max(0, Math.min(255, 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
  }
  return gray;
}

function meanGray(gray: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return gray.length ? sum / gray.length : 0;
}

function gaussianBlur3x3Gray(gray: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let wsum = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, ki++) {
          const nx = Math.max(0, Math.min(width - 1, x + dx));
          const ny = Math.max(0, Math.min(height - 1, y + dy));
          const kw = k[ki];
          sum += gray[ny * width + nx] * kw;
          wsum += kw;
        }
      }
      out[y * width + x] = Math.max(0, Math.min(255, Math.round(sum / Math.max(1, wsum))));
    }
  }
  return out;
}

function sharpenUnsharpGray(
  gray: Uint8Array,
  width: number,
  height: number,
  amount = 1.1
): Uint8Array {
  const blur = gaussianBlur3x3Gray(gray, width, height);
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] + amount * (gray[i] - blur[i]);
    out[i] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return out;
}

function equalizeGray(gray: Uint8Array): Uint8Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]] += 1;
  const cdf = new Uint32Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    cdf[i] = acc;
  }
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (cdf[i] > 0) {
      cdfMin = cdf[i];
      break;
    }
  }
  const total = gray.length;
  const out = new Uint8Array(gray.length);
  const denom = Math.max(1, total - cdfMin);
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(((cdf[gray[i]] - cdfMin) / denom) * 255)));
  }
  return out;
}

function adaptiveThresholdGray(
  gray: Uint8Array,
  width: number,
  height: number,
  windowRadius = 7,
  c = 6
): Uint8Array {
  const ii = new Uint32Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let row = 0;
    for (let x = 1; x <= width; x++) {
      row += gray[(y - 1) * width + (x - 1)];
      ii[y * (width + 1) + x] = ii[(y - 1) * (width + 1) + x] + row;
    }
  }
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - windowRadius);
    const y1 = Math.min(height - 1, y + windowRadius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - windowRadius);
      const x1 = Math.min(width - 1, x + windowRadius);
      const A = ii[y0 * (width + 1) + x0];
      const B = ii[y0 * (width + 1) + (x1 + 1)];
      const C = ii[(y1 + 1) * (width + 1) + x0];
      const D = ii[(y1 + 1) * (width + 1) + (x1 + 1)];
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const mean = (D - B - C + A) / Math.max(1, area);
      out[y * width + x] = gray[y * width + x] > mean - c ? 255 : 0;
    }
  }
  return out;
}

function grayToRgba(gray: Uint8Array, alpha = 255): Uint8Array {
  const out = new Uint8Array(gray.length * 4);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    out[i] = gray[p];
    out[i + 1] = gray[p];
    out[i + 2] = gray[p];
    out[i + 3] = alpha;
  }
  return out;
}

function applyExpectedA4RegionMask(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(rgba);
  const minX = Math.floor(width * 0.06);
  const maxX = Math.ceil(width * 0.94);
  const minY = Math.floor(height * 0.05);
  const maxY = Math.ceil(height * 0.95);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= minX && x <= maxX && y >= minY && y <= maxY) continue;
      const o = (y * width + x) * 4;
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

function buildEnhancedRgbaVariants(imageData: ImageData): Uint8Array[] {
  const { data, width, height } = imageData;
  const variants: Uint8Array[] = [];
  const gray = toGrayLuma(data);
  const grayBlur = gaussianBlur3x3Gray(gray, width, height);
  const lum = meanGray(gray);
  const eq = equalizeGray(grayBlur);
  const sharpen = sharpenUnsharpGray(eq, width, height);
  const ad = adaptiveThresholdGray(sharpen, width, height);
  const heavyShadow = lum < 105;
  const adShadow = heavyShadow ? adaptiveThresholdGray(sharpen, width, height, 9, 3) : null;

  // Variant 1: contrast stretch (helps low-ink print + room lighting).
  {
    const out = new Uint8Array(data.byteLength);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const c = Math.max(0, Math.min(255, (gray - 128) * 1.65 + 128));
      out[i] = c;
      out[i + 1] = c;
      out[i + 2] = c;
      out[i + 3] = a;
    }
    variants.push(out);
  }

  // Variant 2: equalized grayscale.
  variants.push(grayToRgba(eq));
  variants.push(grayToRgba(sharpen));

  // Variant 3: adaptive threshold (OpenCV-like).
  variants.push(grayToRgba(ad));
  if (adShadow) variants.push(grayToRgba(adShadow));

  // Variant 4: hard threshold (helps marker borders stand out).
  {
    const out = new Uint8Array(data.byteLength);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const bw = gray > 145 ? 255 : 0;
      out[i] = bw;
      out[i + 1] = bw;
      out[i + 2] = bw;
      out[i + 3] = a;
    }
    variants.push(out);
  }

  // Variant 5+: limit detect to expected A4 region.
  const base = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  variants.push(applyExpectedA4RegionMask(base, width, height));
  variants.push(applyExpectedA4RegionMask(grayToRgba(eq), width, height));
  variants.push(applyExpectedA4RegionMask(grayToRgba(ad), width, height));
  if (adShadow) variants.push(applyExpectedA4RegionMask(grayToRgba(adShadow), width, height));

  return variants;
}

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
      lastInitError = null;
      lastInitWasmUrl = arucoWasmUrl || null;
      // Universal compatibility: try to init even without SIMD (some builds may still work).
      // If it fails, we surface a friendly error via `lastInitError`.
      const mod = await import("@ar-js-org/aruco-rs");
      // wasm-bindgen init can accept either a URL/module OR an options object with locateFile.
      // We try locateFile first to force the absolute URL, then fall back to passing the URL directly.
      await withTimeout(
        (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (mod.default as any)({ locateFile: () => arucoWasmUrl });
          } catch {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (mod.default as any)(arucoWasmUrl);
          }
        })(),
        5000,
        "aruco-rs WASM init"
      );
      for (const dict of ALL_DICTIONARIES) {
        try {
          const next = new mod.ARucoDetector(dict, MAX_HAMMING);
          detectorByDictionary.set(dict, next);
          if (!detector) detector = next;
        } catch {
          // Dictionary not exposed by current WASM build: skip.
        }
      }
      if (!detector) {
        throw new Error("Nessun dizionario ArUco disponibile nella build WASM.");
      }
    })().catch((e: unknown) => {
      initPromise = null;
      const simdNote = supportsWasmSimd() ? "" : " (nota: il browser potrebbe non supportare WASM SIMD)";
      lastInitError =
        (e instanceof Error ? e.message : String(e)) +
        simdNote +
        (lastInitWasmUrl ? ` | wasmUrl=${lastInitWasmUrl}` : "");
      // Verbose console error for Redmi debugging: path, MIME, 404, CSP, etc.
      // eslint-disable-next-line no-console
      console.error("[arucoWasm] init failed", {
        error: e,
        wasmUrl: lastInitWasmUrl,
        simd: supportsWasmSimd(),
      });
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
  if (detectorByDictionary.size === 0) return [];
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const variants = buildEnhancedRgbaVariants(imageData);
  // Dictionary lock: prefer the exact printed dict first (DICT_4X4_50).
  const primary = detectorByDictionary.get(ARUCO_DICTIONARY_NAME);
  const dicts = primary ? [primary] : Array.from(detectorByDictionary.values());
  for (const d of dicts) {
    // Try enhanced/thresholded variants first; they are often better under reflections.
    for (const v of variants) {
      const hit = detectWith(d, width, height, v);
      if (hit.length > 0) return hit;
    }
    const base = detectWith(d, width, height, rgba);
    if (base.length > 0) return base;
  }
  return [];
}

/**
 * Fast-path detector: no enhanced variants, no masking.
 * Use when the caller already provides a high-contrast / thresholded buffer (e.g. B/W analysis canvas).
 */
export function detectArucoOnImageDataFast(imageData: ImageData): ArucoMarkerDetection[] {
  if (detectorByDictionary.size === 0) return [];
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const primary = detectorByDictionary.get(ARUCO_DICTIONARY_NAME);
  if (primary) return detectWith(primary, width, height, rgba);
  for (const d of detectorByDictionary.values()) {
    const hit = detectWith(d, width, height, rgba);
    if (hit.length > 0) return hit;
  }
  return [];
}

export function detectArucoOnImageDataFastBruteforce(
  imageData: ImageData,
  dictionaries: readonly string[] = ALL_DICTIONARIES
): { dictionary: string; detections: ArucoMarkerDetection[] } | null {
  if (detectorByDictionary.size === 0) return null;
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  for (const dict of dictionaries) {
    const det = detectorByDictionary.get(dict);
    if (!det) continue;
    const hit = detectWith(det, width, height, rgba);
    if (hit.length > 0) return { dictionary: dict, detections: hit };
  }
  return null;
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
  dictionaries: readonly string[] = ALL_DICTIONARIES
): Promise<{ dictionary: string; detections: ArucoMarkerDetection[] } | null> {
  const { width, height, data } = imageData;
  const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const variants = buildEnhancedRgbaVariants(imageData);
  for (const dict of dictionaries) {
    const d = await getDetectorForDictionary(dict);
    if (!d) continue;
    const detections = detectWith(d, width, height, rgba);
    if (detections.length > 0) return { dictionary: dict, detections };
    for (const v of variants) {
      const hit = detectWith(d, width, height, v);
      if (hit.length > 0) return { dictionary: dict, detections: hit };
    }
  }
  return null;
}

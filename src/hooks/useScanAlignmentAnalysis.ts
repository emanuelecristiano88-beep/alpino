import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMarkerCentroid,
  markersDominateFrame,
  pickCornerMarkers,
  scoreA4FromMarkers,
  type ArucoMarkerDetection,
} from "../lib/aruco/a4MarkerGeometry";
import { markerSharpnessScore } from "../lib/scanner/frameQuality";
import { detectArucoOnImageData, ensureArucoDetector, isArucoDetectorReady } from "../lib/aruco/arucoWasm";
import { buildFootBinaryMaskAi } from "../lib/biometry/footMask";
import { extractFootMaskGeometry, type FootViewZoneMetrics } from "../lib/scanner/footMaskGeometry";
import {
  classifyFootViewZone,
  type FootViewZone,
} from "../lib/scanner/footViewZoneClassifier";
import { sheetCenterFromMarkers } from "../lib/scanner/scanViewAngle";
import { rgbaToGrayLuma, trackCornersPatchFlow } from "../lib/scanner/patchCornerFlow";

export type ScanGuideMode = "default" | "too_close" | "aligned";
export type ScanAlignmentSource = "aruco" | "a4" | "foot_fallback";

/** Stato di tracking stabilizzato per render (lerp + hold) — separato dalla detection rumorosa */
export type StableTrackingState = {
  position: { x: number; y: number };
  /** Radianti, allineato al bordo superiore del foglio (tl→tr) */
  rotation: number;
  /** Scala caratteristica in coordinate normalizzate (≈ media di lati del riquadro foglio) */
  scale: number;
  /** 0–1: qualità stimata dell’ultima misura valida */
  confidence: number;
};

export type ScanAlignmentSnapshot = {
  guide: ScanGuideMode;
  /** Almeno 4 marker rilevati (ArUco) oppure euristica angoli */
  markersDetected: boolean;
  /** Area centrale con texture tipo “oggetto” (piede su carta) */
  footInFrame: boolean;
  /** 4 marker + rapporto ~A4 + piede + non troppo vicino */
  isPositionCorrect: boolean;
  /** Stato motore ArUco (per debug UI opzionale) */
  arucoEngine: "loading" | "ready" | "fallback";
  /**
   * Fino a 4 centroidi normalizzati 0–1 sul frame analizzato (stesso aspect del video).
   * Solo con WASM ArUco attivo e ≥4 marker scelti agli angoli.
   */
  markerCentersNorm: { x: number; y: number }[] | null;
  /** Marker ArUco rilevati nel frame corrente (prima della selezione corner) */
  markerCount: number;
  /** ID marker foglio visti (attesi 0..3), utile per evidenziare angoli mancanti */
  markerIdsDetected: number[];
  /** Sorgente primaria usata nel frame corrente */
  alignmentSource: ScanAlignmentSource;
  /** Bounding box piede normalizzata (fallback/guida) */
  footBBoxNorm: { x: number; y: number; w: number; h: number } | null;
  /** Centro piede normalizzato (fallback/guida) */
  footCentroidNorm: { x: number; y: number } | null;
  /**
   * Metriche da maschera piede (bbox, centroide, contorno, curvatura, bias H/V) — aggiornate col ciclo foot AI.
   */
  footViewZoneMetrics: FootViewZoneMetrics | null;
  /** Zona vista corrente (TOP / OUTER / INNER / HEEL) da euristica maschera; null se non classificabile */
  detectedFootViewZone: FootViewZone | null;
  /** Pose liscia per overlay / UX (non usare per gate “istantanei” se non combinato con markerCount live) */
  tracking: StableTrackingState;
  /**
   * Confidenza nominale della sorgente (ArUco pieno 1, parziale 0.7, A4 0.5, solo tracking 0.3).
   * Usata per blending e transizioni morbide tra modalità.
   */
  sourceConfidence: number;
  /** Nitidezza minima tra marker angolo (varianza Laplaciana) — aggiornata su frame “heavy”. */
  markerSharpnessMin: number | null;
  /** 4 marker + rapporto lati coerente con foglio A4 (scala metrica). */
  a4GeometryOk: boolean;
  /**
   * Debug overlay: quadrilateri marker ArUco (id 0–3) in coordinate normalizzate sul frame analisi (0–1).
   */
  arucoMarkerQuadsNorm: { id: number; corners: { x: number; y: number }[] }[];
  /**
   * Debug: centro marker per ID foglio; da rilevamento diretto (non da ordine “picked”).
   */
  arucoSlotCentersNorm: readonly [null | { x: number; y: number }, null | { x: number; y: number }, null | { x: number; y: number }, null | { x: number; y: number }];
};

const DEFAULT_TRACKING: StableTrackingState = {
  position: { x: 0.5, y: 0.5 },
  rotation: 0,
  scale: 0.42,
  confidence: 0,
};

const DEFAULT_SNAPSHOT: ScanAlignmentSnapshot = {
  guide: "default",
  markersDetected: false,
  footInFrame: false,
  isPositionCorrect: false,
  arucoEngine: "loading",
  markerCentersNorm: null,
  markerCount: 0,
  markerIdsDetected: [],
  alignmentSource: "foot_fallback",
  footBBoxNorm: null,
  footCentroidNorm: null,
  footViewZoneMetrics: null,
  detectedFootViewZone: null,
  tracking: { ...DEFAULT_TRACKING },
  sourceConfidence: 0,
  markerSharpnessMin: null,
  a4GeometryOk: false,
  arucoMarkerQuadsNorm: [],
  arucoSlotCentersNorm: [null, null, null, null],
};

const EMPTY_ARUCO_SLOTS: ScanAlignmentSnapshot["arucoSlotCentersNorm"] = [null, null, null, null];

function buildArucoDebugFromMarkers(
  markers: ArucoMarkerDetection[],
  w: number,
  h: number
): Pick<ScanAlignmentSnapshot, "arucoMarkerQuadsNorm" | "arucoSlotCentersNorm"> {
  const slots: [null | { x: number; y: number }, null, null, null] = [null, null, null, null];
  const quads: { id: number; corners: { x: number; y: number }[] }[] = [];
  for (const m of markers) {
    if (m.id < 0 || m.id > 3) continue;
    const c = getMarkerCentroid(m);
    slots[m.id] = { x: c.x / w, y: c.y / h };
    quads.push({
      id: m.id,
      corners: m.corners.map((p) => ({ x: p.x / w, y: p.y / h })),
    });
  }
  return { arucoMarkerQuadsNorm: quads, arucoSlotCentersNorm: slots };
}

function serializeMarkerCenters(m: { x: number; y: number }[] | null): string {
  if (!m || m.length === 0) return "";
  return m.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join("|");
}

function gray(i: number, data: Uint8ClampedArray) {
  const o = i * 4;
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
}

function edgeScore(
  data: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  let s = 0;
  let n = 0;
  const step = 2;
  for (let y = y0; y < y1 - step; y += step) {
    for (let x = x0; x < x1 - step; x += step) {
      const i = y * w + x;
      const g = gray(i, data);
      const gx = gray(i + step, data);
      const gy = gray(i + step * w, data);
      s += Math.abs(gx - g) + Math.abs(gy - g);
      n += 1;
    }
  }
  return n > 0 ? s / n : 0;
}

function varianceLuma(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const vals: number[] = [];
  const step = 3;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      vals.push(gray(y * w + x, data));
    }
  }
  if (vals.length < 4) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, v) => a + (v - m) * (v - m), 0) / vals.length;
}

function meanLuma(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0;
  let n = 0;
  const step = 4;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      s += gray(y * w + x, data);
      n += 1;
    }
  }
  return n > 0 ? s / n : 0;
}

function detectA4ByEdges(imageData: ImageData): { cornersNorm: { x: number; y: number }[] } | null {
  const { width: w, height: h, data } = imageData;
  const total = w * h;
  if (total < 64) return null;

  // 1) Grayscale
  const grayBuf = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    grayBuf[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) as unknown as number;
  }

  // 2) Gaussian blur 3x3
  const blur = new Uint8Array(total);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let wsum = 0;
      const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, ki++) {
          const nx = Math.max(0, Math.min(w - 1, x + dx));
          const ny = Math.max(0, Math.min(h - 1, y + dy));
          const kw = k[ki];
          sum += grayBuf[ny * w + nx] * kw;
          wsum += kw;
        }
      }
      blur[y * w + x] = Math.round(sum / Math.max(1, wsum));
    }
  }

  // 3) Canny-like edges (Sobel magnitude + dynamic threshold)
  const edges = new Uint8Array(total);
  let magSum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (xx: number, yy: number) => blur[yy * w + xx];
      const gx =
        -p(x - 1, y - 1) + p(x + 1, y - 1) - 2 * p(x - 1, y) + 2 * p(x + 1, y) - p(x - 1, y + 1) + p(x + 1, y + 1);
      const gy =
        p(x - 1, y - 1) + 2 * p(x, y - 1) + p(x + 1, y - 1) - p(x - 1, y + 1) - 2 * p(x, y + 1) - p(x + 1, y + 1);
      const mag = Math.abs(gx) + Math.abs(gy);
      magSum += mag;
      edges[y * w + x] = Math.min(255, Math.round(mag / 8));
    }
  }
  const magMean = magSum / Math.max(1, (w - 2) * (h - 2));
  const edgeThr = Math.max(28, Math.min(90, Math.round(magMean * 1.35)));
  for (let i = 0; i < total; i++) edges[i] = edges[i] >= edgeThr ? 1 : 0;

  // 4) Find contours/components
  const vis = new Uint8Array(total);
  let bestScore = 0;
  let bestMinX = 0;
  let bestMaxX = 0;
  let bestMinY = 0;
  let bestMaxY = 0;
  for (let i = 0; i < total; i++) {
    if (!edges[i] || vis[i]) continue;
    const q: number[] = [i];
    vis[i] = 1;
    let area = 0;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      const x = cur % w;
      const y = (cur / w) | 0;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const n4 = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (let k = 0; k < n4.length; k++) {
        const nx = n4[k][0];
        const ny = n4[k][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (edges[ni] && !vis[ni]) {
          vis[ni] = 1;
          q.push(ni);
        }
      }
    }

    // 5) Approx polygon as rectangle + rectangularity score
    const bw = Math.max(1, maxX - minX + 1);
    const bh = Math.max(1, maxY - minY + 1);
    const rectPerimeter = 2 * (bw + bh);
    const rectangularity = area / Math.max(1, rectPerimeter);

    // 6) A4 aspect ratio validation (1:1.414 => short/long ~= 0.707)
    const ratio = Math.min(bw, bh) / Math.max(bw, bh);
    const a4 = 1 / 1.414;
    const ratioOk = Math.abs(ratio - a4) < 0.32;
    const largeArea = bw * bh > total * 0.06;
    if (!ratioOk || !largeArea) continue;

    const score = bw * bh + rectangularity * 1000;
    if (score > bestScore) {
      bestScore = score;
      bestMinX = minX;
      bestMaxX = maxX;
      bestMinY = minY;
      bestMaxY = maxY;
    }
  }

  if (bestScore <= 0) return null;
  return {
    cornersNorm: [
      { x: bestMinX / w, y: bestMinY / h }, // tl
      { x: bestMaxX / w, y: bestMinY / h }, // tr
      { x: bestMinX / w, y: bestMaxY / h }, // bl
      { x: bestMaxX / w, y: bestMaxY / h }, // br
    ],
  };
}

/** Fallback senza WASM: proxy angoli + piede. */
function analyzeHeuristicOnly(imageData: ImageData): Omit<ScanAlignmentSnapshot, "arucoEngine"> {
  const { width: W, height: H, data } = imageData;
  const cw = W * 0.22;
  const ch = H * 0.22;
  const corners = {
    tl: edgeScore(data, W, 2, 2, cw, ch),
    tr: edgeScore(data, W, W - cw, 2, W - 2, ch),
    bl: edgeScore(data, W, 2, H - ch, cw, H - 2),
    br: edgeScore(data, W, W - cw, H - ch, W - 2, H - 2),
  };
  const cornerVals = [corners.tl, corners.tr, corners.bl, corners.br];
  const maxCorner = Math.max(...cornerVals);

  const cx0 = Math.floor(W * 0.28);
  const cy0 = Math.floor(H * 0.28);
  const cx1 = Math.floor(W * 0.72);
  const cy1 = Math.floor(H * 0.72);
  const centerVar = varianceLuma(data, W, cx0, cy0, cx1, cy1);
  const globalMean = meanLuma(data, W, 0, 0, W, H);
  const innerMean = meanLuma(data, W, cx0, cy0, cx1, cy1);

  const CORNER_STRONG = 18;
  const CORNER_WEAK = 9;
  const VAR_FOOT = 420;
  const BRIGHT = 235;

  const markersDetected = cornerVals.every((c) => c > CORNER_WEAK) && Math.min(...cornerVals) > CORNER_WEAK * 0.85;
  const strongMarkers = cornerVals.every((c) => c > CORNER_STRONG);

  const tooClose =
    globalMean > BRIGHT && innerMean > BRIGHT - 5 && maxCorner < CORNER_STRONG * 1.35;

  const footInFrame = centerVar > VAR_FOOT;
  const isPositionCorrect = strongMarkers && footInFrame && !tooClose;

  let guide: ScanGuideMode = "default";
  if (tooClose) guide = "too_close";
  else if (isPositionCorrect) guide = "aligned";

  return {
    guide,
    markersDetected: markersDetected || strongMarkers,
    footInFrame,
    isPositionCorrect,
  };
}

function combineArucoAndHeuristic(
  imageData: ImageData,
  markers: ArucoMarkerDetection[],
  arucoEngine: "ready" | "fallback"
): ScanAlignmentSnapshot {
  const h = analyzeHeuristicOnly(imageData);
  if (markers.length === 0) {
    return {
      guide: h.guide === "too_close" ? "too_close" : "default",
      markersDetected: false,
      footInFrame: h.footInFrame,
      isPositionCorrect: false,
      arucoEngine,
      markerCentersNorm: null,
      markerCount: 0,
      markerIdsDetected: [],
      alignmentSource: "foot_fallback",
      tracking: { ...DEFAULT_TRACKING },
      sourceConfidence: 0.3,
      markerSharpnessMin: null,
      a4GeometryOk: false,
      arucoMarkerQuadsNorm: [],
      arucoSlotCentersNorm: EMPTY_ARUCO_SLOTS,
    };
  }

  const W = imageData.width;
  const H = imageData.height;
  const picked = pickCornerMarkers(markers, W, H);
  let markerSharpnessMin: number | null = null;
  if (picked.length >= 1) {
    const scores = picked.slice(0, Math.min(4, picked.length)).map((m) => markerSharpnessScore(imageData, m));
    markerSharpnessMin = Math.min(...scores);
  }
  const { count, aspectOk } = scoreA4FromMarkers(picked.length >= 4 ? picked : markers);
  const fourVisible = count >= 4;
  const threeVisible = markers.length >= 3;
  const twoVisible = markers.length >= 2;
  const oneVisible = markers.length >= 1;
  const tooCloseAruco = markersDominateFrame(picked, W, H);
  const tooClose = h.guide === "too_close" || tooCloseAruco;

  const footInFrame = h.footInFrame;
  const markersDetected = fourVisible || threeVisible || twoVisible || oneVisible;
  const aspectPass = fourVisible ? aspectOk : true;
  const isPositionCorrect =
    (fourVisible || threeVisible || twoVisible || oneVisible) && aspectPass && footInFrame && !tooClose;

  let guide: ScanGuideMode = "default";
  if (tooClose) guide = "too_close";
  else if (isPositionCorrect) guide = "aligned";

  const a4GeometryOk = fourVisible && aspectOk;
  const arucoDbg = buildArucoDebugFromMarkers(markers, W, H);

  return {
    guide,
    markersDetected,
    footInFrame,
    isPositionCorrect,
    arucoEngine,
    markerCentersNorm: null,
    markerCount: markers.length,
    markerIdsDetected: markers
      .map((m) => m.id)
      .filter((id, idx, arr) => id >= 0 && id <= 3 && arr.indexOf(id) === idx),
    alignmentSource: "aruco",
    tracking: { ...DEFAULT_TRACKING },
    sourceConfidence: markers.length >= 4 ? 1.0 : 0.7,
    markerSharpnessMin,
    a4GeometryOk,
    ...arucoDbg,
  };
}

function inferMissingArucoCornerById(
  byId: Array<{ x: number; y: number } | null>
): { x: number; y: number }[] | null {
  const present = byId
    .map((p, i) => (p ? i : -1))
    .filter((i) => i >= 0);
  if (present.length < 3) return null;
  const out: Array<{ x: number; y: number } | null> = [...byId];
  const missing = [0, 1, 2, 3].filter((i) => !out[i])[0];
  if (missing == null) return out as { x: number; y: number }[];
  const p0 = out[0];
  const p1 = out[1];
  const p2 = out[2];
  const p3 = out[3];
  if (missing === 0 && p1 && p2 && p3) {
    out[0] = { x: p1.x + p2.x - p3.x, y: p1.y + p2.y - p3.y };
  } else if (missing === 1 && p0 && p3 && p2) {
    out[1] = { x: p0.x + p3.x - p2.x, y: p0.y + p3.y - p2.y };
  } else if (missing === 2 && p0 && p3 && p1) {
    out[2] = { x: p0.x + p3.x - p1.x, y: p0.y + p3.y - p1.y };
  } else if (missing === 3 && p1 && p2 && p0) {
    out[3] = { x: p1.x + p2.x - p0.x, y: p1.y + p2.y - p0.y };
  }
  if (!out[0] || !out[1] || !out[2] || !out[3]) return null;
  return out as { x: number; y: number }[];
}

export type ScanAlignmentResult = ScanAlignmentSnapshot & {
  stableAlignedMs: number;
};

/** Hold geometria lastReliable quando la detection salta (allineato al hold stato overlay) */
const TRACKING_HOLD_MS = 800;
const FOOT_TRACK_MAX_SIDE = 256;
const FOOT_TRACK_MIN_PIXELS = 160;
const DETECTION_HEAVY_EVERY_N_FRAMES = 4;
const DETECTION_CACHE_MAX_MS = 220;
const SOURCE_DOWNGRADE_HOLD_MS = 850;
/** Hold overlay stable-render su perdita geometria (stessa finestra dello stato tracking) */
const SOURCE_GEOMETRY_LOSS_HOLD_MS = 800;

/**
 * Detection persa: mantieni ultimo stato (pose + confidenza) senza decay — 500–1000 ms (usiamo 800).
 * Dopo: fase di decay lenta della sola confidenza; fallback visivo solo sotto soglia.
 */
const DETECTION_STATE_HOLD_MS = 800;
/** Lerp per frame verso 0 nella fase post-hold (basso = decay lento) */
const DETECTION_CONFIDENCE_DECAY_LERP = 0.016;
/** Se ArUco è 'ready' ma non vediamo marker per troppo tempo, passiamo a contour A4. */
const ARUCO_NO_MARKERS_FALLBACK_MS = 500;
/** Confidenza nominale per pose da patch-flow (sotto la detection) */
const CONTINUITY_PATCH_FLOW_CONF = 0.28;
/** Buffer corto anti-jitter: ultimi N frame validi (3-5 consigliato) */
const TRACKING_FRAME_BUFFER_SIZE = 5;
/** Interpolazione per frame: valore ≈ tra 0.08 e 0.15 (più basso = più liscio) */
const OVERLAY_TRANSFORM_LERP = 0.1;
const STABLE_TRACK_CORNER_CONF_MIN = 0.07;

const SHEET_A4_RATIO = 210 / 297;

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type TrackingMeasurement = {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  isLandscape: boolean;
  confidence: number;
  atMs: number;
};

function averageTrackingMeasurements(buf: TrackingMeasurement[]): TrackingMeasurement | null {
  if (!buf.length) return null;
  let wsum = 0;
  let x = 0;
  let y = 0;
  let sc = 0;
  let cosR = 0;
  let sinR = 0;
  let land = 0;
  let conf = 0;
  for (let i = 0; i < buf.length; i++) {
    const m = buf[i];
    const recencyW = 0.75 + 0.25 * ((i + 1) / buf.length);
    const w = Math.max(0.04, m.confidence) * recencyW;
    wsum += w;
    x += m.x * w;
    y += m.y * w;
    sc += m.scale * w;
    cosR += Math.cos(m.rotation) * w;
    sinR += Math.sin(m.rotation) * w;
    land += (m.isLandscape ? 1 : 0) * w;
    conf += m.confidence * w;
  }
  if (wsum <= 1e-8) return null;
  return {
    x: x / wsum,
    y: y / wsum,
    rotation: Math.atan2(sinR, cosR),
    scale: sc / wsum,
    isLandscape: land / wsum >= 0.5,
    confidence: conf / wsum,
    atMs: buf[buf.length - 1].atMs,
  };
}

function smoothstep01(t: number): number {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

function lerpCornerArrays(
  a: { x: number; y: number }[] | null,
  b: { x: number; y: number }[] | null,
  t: number
): { x: number; y: number }[] | null {
  const tt = smoothstep01(t);
  if (!b || b.length < 4) return a && a.length >= 4 ? a : b;
  if (!a || a.length < 4) return b;
  const n = Math.min(4, a.length, b.length);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: lerpNum(a[i].x, b[i].x, tt),
      y: lerpNum(a[i].y, b[i].y, tt),
    });
  }
  return out;
}

/**
 * Punteggio fisso per sorgente detection (blending / transizioni).
 * - ArUco ≥4 marker → 1.0 | parziale → 0.7 | A4 → 0.5 | solo tracking piede → 0.3
 */
export function detectionSourceConfidence(s: ScanAlignmentSnapshot): number {
  if (s.alignmentSource === "aruco") {
    return s.markerCount >= 4 ? 1.0 : 0.7;
  }
  if (s.alignmentSource === "a4") {
    return 0.5;
  }
  if (s.alignmentSource === "foot_fallback") {
    return 0.3;
  }
  return 0;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function shortestAngleDelta(fromRad: number, toRad: number): number {
  let d = toRad - fromRad;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function sortCornersLikeSheet(corners: { x: number; y: number }[]): { x: number; y: number }[] | null {
  if (corners.length < 4) return null;
  const four = corners.slice(0, 4);
  const sortedY = [...four].sort((a, b) => a.y - b.y);
  const top = sortedY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = sortedY.slice(2, 4).sort((a, b) => a.x - b.x);
  if (top.length < 2 || bot.length < 2) return null;
  return [top[0], top[1], bot[0], bot[1]];
}

function distNorm(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type SheetPose = {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  isLandscape: boolean;
};

function footBBoxToSheetPose(b: { x: number; y: number; w: number; h: number }): SheetPose {
  return {
    x: b.x + b.w / 2,
    y: b.y + b.h / 2,
    rotation: 0,
    scale: Math.max(b.w, b.h) * 0.92,
    isLandscape: b.w > b.h * 1.08,
  };
}

/** Blend di pose foglio: pesi già normalizzati (somma = 1). Rotazione via media vettoriale. */
function blendWeightedSheetPoses(weighted: Array<{ pose: SheetPose; w: number }>): SheetPose | null {
  if (weighted.length === 0) return null;
  let x = 0;
  let y = 0;
  let scale = 0;
  let cr = 0;
  let sr = 0;
  let landW = 0;
  for (let i = 0; i < weighted.length; i++) {
    const { pose, w } = weighted[i];
    x += pose.x * w;
    y += pose.y * w;
    scale += pose.scale * w;
    cr += Math.cos(pose.rotation) * w;
    sr += Math.sin(pose.rotation) * w;
    landW += (pose.isLandscape ? 1 : 0) * w;
  }
  const hypot = Math.hypot(cr, sr);
  const rotation = hypot > 1e-8 ? Math.atan2(sr, cr) : 0;
  return {
    x,
    y,
    rotation,
    scale,
    isLandscape: landW >= 0.5,
  };
}

/**
 * Combina ArUco + A4 + tracking piede con pesi = confidenza nominale, normalizzati.
 * rawA ∈ {0, 0.7, 1} | rawB = 0.5 | rawC = 0.3
 */
function computeMultiSourceBlendedPose(params: {
  arucoCorners4: { x: number; y: number }[] | null;
  a4Corners4: { x: number; y: number }[] | null;
  arucoMarkerCount: number;
  footBBox: { x: number; y: number; w: number; h: number } | null;
}): { pose: SheetPose; targetConf: number; sumRaw: number } | null {
  const poseA = params.arucoCorners4 ? poseFromSheetCorners(params.arucoCorners4) : null;
  const poseB = params.a4Corners4 ? poseFromSheetCorners(params.a4Corners4) : null;
  const poseC = params.footBBox ? footBBoxToSheetPose(params.footBBox) : null;

  const rawA = poseA ? (params.arucoMarkerCount >= 4 ? 1.0 : 0.7) : 0;
  const rawB = poseB ? 0.5 : 0;
  const rawC = poseC ? 0.3 : 0;
  const sumRaw = rawA + rawB + rawC;
  if (sumRaw < 1e-8) return null;

  const wA = rawA / sumRaw;
  const wB = rawB / sumRaw;
  const wC = rawC / sumRaw;
  const parts: Array<{ pose: SheetPose; w: number }> = [];
  if (poseA && rawA > 0) parts.push({ pose: poseA, w: wA });
  if (poseB && rawB > 0) parts.push({ pose: poseB, w: wB });
  if (poseC && rawC > 0) parts.push({ pose: poseC, w: wC });
  const pose = blendWeightedSheetPoses(parts);
  if (!pose) return null;

  const targetConf = Math.min(1, sumRaw / 1.8);
  return { pose, targetConf, sumRaw };
}

function poseFromSheetCorners(corners: { x: number; y: number }[]): {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  isLandscape: boolean;
} | null {
  const s = sortCornersLikeSheet(corners);
  if (!s) return null;
  const tl = s[0];
  const tr = s[1];
  const bl = s[2];
  const br = s[3];
  const x = (tl.x + tr.x + bl.x + br.x) / 4;
  const y = (tl.y + tr.y + bl.y + br.y) / 4;
  const wTop = distNorm(tl, tr);
  const wBot = distNorm(bl, br);
  const hLeft = distNorm(tl, bl);
  const hRight = distNorm(tr, br);
  const avgW = (wTop + wBot) / 2;
  const avgH = (hLeft + hRight) / 2;
  if (avgW < 1e-5 || avgH < 1e-5) return null;
  const isLandscape = avgW > avgH * 1.08;
  const rotation = Math.atan2(tr.y - tl.y, tr.x - tl.x);
  const scale = (avgW + avgH) / 2;
  return { x, y, rotation, scale, isLandscape };
}

function cornersFromStablePose(
  x: number,
  y: number,
  rotation: number,
  scale: number,
  isLandscape: boolean
): { x: number; y: number }[] {
  let halfW: number;
  let halfH: number;
  if (!isLandscape) {
    halfH = scale / 2;
    halfW = halfH * SHEET_A4_RATIO;
  } else {
    halfW = scale / 2;
    halfH = halfW * SHEET_A4_RATIO;
  }
  const local = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return local.map((p) => ({
    x: x + p.x * cos - p.y * sin,
    y: y + p.x * sin + p.y * cos,
  }));
}

function serializeTracking(t: StableTrackingState): string {
  return `${t.position.x.toFixed(4)},${t.position.y.toFixed(4)},${t.rotation.toFixed(4)},${t.scale.toFixed(4)},${t.confidence.toFixed(3)}`;
}

function resizeImageDataNearest(source: ImageData, targetMaxSide: number): ImageData {
  const srcW = source.width;
  const srcH = source.height;
  const scale = Math.min(1, targetMaxSide / Math.max(srcW, srcH));
  const dstW = Math.max(32, Math.round(srcW * scale));
  const dstH = Math.max(32, Math.round(srcH * scale));
  if (dstW === srcW && dstH === srcH) return source;
  const out = new ImageData(dstW, dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y / Math.max(1, dstH - 1)) * Math.max(1, srcH - 1)));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / Math.max(1, dstW - 1)) * Math.max(1, srcW - 1)));
      const so = (sy * srcW + sx) * 4;
      const oo = (y * dstW + x) * 4;
      out.data[oo] = source.data[so];
      out.data[oo + 1] = source.data[so + 1];
      out.data[oo + 2] = source.data[so + 2];
      out.data[oo + 3] = source.data[so + 3];
    }
  }
  return out;
}

function extractFootBoxAndCentroid(mask: Uint8Array, w: number, h: number): {
  bbox: { x: number; y: number; w: number; h: number };
  centroid: { x: number; y: number };
  pixels: number;
} | null {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let sumX = 0;
  let sumY = 0;
  let pixels = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      pixels += 1;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (pixels < FOOT_TRACK_MIN_PIXELS || maxX < minX || maxY < minY) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  return {
    bbox: { x: minX / w, y: minY / h, w: bw / w, h: bh / h },
    centroid: { x: (sumX / pixels) / w, y: (sumY / pixels) / h },
    pixels,
  };
}

function alignmentSourceRank(source: ScanAlignmentSource): number {
  if (source === "aruco") return 3;
  if (source === "a4") return 2;
  return 1;
}

export type ScanFootId = "LEFT" | "RIGHT";

export function useScanAlignmentAnalysis(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  resetToken?: number,
  /** Per classificazione OUTER/INNER rispetto al piede acquisito */
  scanFootId: ScanFootId = "LEFT"
): ScanAlignmentResult {
  const [snapshot, setSnapshot] = useState<ScanAlignmentSnapshot>({
    ...DEFAULT_SNAPSHOT,
    arucoEngine: "loading",
  });
  const [stableAlignedMs, setStableAlignedMs] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const alignedSinceRef = useRef<number | null>(null);
  const lastStableUiRef = useRef(0);
  const arucoEngineRef = useRef<ScanAlignmentSnapshot["arucoEngine"]>("loading");
  const footTrackBusyRef = useRef(false);
  const footTrackRef = useRef<{
    bbox: { x: number; y: number; w: number; h: number } | null;
    centroid: { x: number; y: number } | null;
    updatedAt: number;
    maskMetrics: FootViewZoneMetrics | null;
    maskMetricsAt: number;
  }>({ bbox: null, centroid: null, updatedAt: 0, maskMetrics: null, maskMetricsAt: 0 });
  const detectionFrameCounterRef = useRef(0);
  const cachedDetectionRef = useRef<{ atMs: number; next: ScanAlignmentSnapshot } | null>(null);
  /** Timestamp dell’ultimo frame con almeno un marker ArUco rilevato (solo mentre engine è 'ready'). */
  const lastArucoMarkerSeenAtRef = useRef<number | null>(null);
  const stableRenderRef = useRef<{
    snapshot: ScanAlignmentSnapshot;
    sourceSinceMs: number;
    lastGeometryMs: number;
    /** 0–1 transizione morbida tra sorgenti (angoli + modalità) */
    modeBlend01: number;
    blendTargetSource: ScanAlignmentSource;
  } | null>(null);
  const stableTrackingInternalRef = useRef<{
    x: number;
    y: number;
    rotation: number;
    scale: number;
    confidence: number;
    isLandscape: boolean;
    lastValidMs: number;
    lastTickMs: number;
    initialized: boolean;
  } | null>(null);
  /** Geometrie indipendenti per blend multi-sorgente (aggiornato su frame “heavy”) */
  const multiSourceBlendRef = useRef<{
    arucoCorners4: { x: number; y: number }[] | null;
    a4Corners4: { x: number; y: number }[] | null;
    markerCount: number;
    updatedAtMs: number;
  } | null>(null);
  /** Continuità angoli con patch matching (feature / optical-flow sparso) tra frame */
  const cornerFlowContinuityRef = useRef<{
    cornersNorm: { x: number; y: number }[];
    prevGray: Uint8Array;
    w: number;
    h: number;
    failStreak: number;
  } | null>(null);

  /** Hold zone per UX: quando la mask/contour salta un frame, evitiamo flicker restituendo l’ultima zona valida. */
  const detectedZoneRef = useRef<{ zone: FootViewZone; atMs: number } | null>(null);
  const detectedZoneHoldMs = 500;
  const trackingFrameBufferRef = useRef<TrackingMeasurement[]>([]);
  const lastReliableRef = useRef<{
    atMs: number;
    markerCentersNorm: { x: number; y: number }[] | null;
    markerCount: number;
    markerIdsDetected: number[];
    alignmentSource: ScanAlignmentSource;
    guide: ScanGuideMode;
    isPositionCorrect: boolean;
  } | null>(null);

  useEffect(() => {
    if (!enabled) {
      arucoEngineRef.current = "loading";
      lastArucoMarkerSeenAtRef.current = null;
      return;
    }
    arucoEngineRef.current = "loading";
    setSnapshot((s) => ({ ...s, arucoEngine: "loading" }));
    let cancelled = false;
    void ensureArucoDetector()
      .then(() => {
        if (!cancelled) {
          arucoEngineRef.current = "ready";
          lastArucoMarkerSeenAtRef.current = performance.now();
          setSnapshot((s) => ({ ...s, arucoEngine: "ready" }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          arucoEngineRef.current = "fallback";
          lastArucoMarkerSeenAtRef.current = null;
          setSnapshot((s) => ({ ...s, arucoEngine: "fallback" }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const tick = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      // Robustness: never fully "fail" the UI state.
      // Keep last known snapshot and just decay confidence; this prevents flicker/blank overlays
      // on temporary camera/video readiness glitches.
      setSnapshot((prev) => {
        const nextConf = Math.max(0, (prev.sourceConfidence ?? 0) * 0.92);
        return {
          ...prev,
          arucoEngine: arucoEngineRef.current,
          sourceConfidence: nextConf,
          tracking: {
            ...prev.tracking,
            confidence: Math.max(0, prev.tracking.confidence * 0.92),
          },
        };
      });
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const useAruco = isArucoDetectorReady() && arucoEngineRef.current === "ready";
    const maxSide = useAruco ? 900 : 240;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const w = Math.max(32, Math.round(vw * scale));
    const h = Math.max(32, Math.round(vh * scale));

    if (
      cornerFlowContinuityRef.current &&
      (cornerFlowContinuityRef.current.w !== w || cornerFlowContinuityRef.current.h !== h)
    ) {
      cornerFlowContinuityRef.current = null;
    }

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, w, h);
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch {
      return;
    }

    const now = performance.now();
    // Immediate fallback: se ArUco è 'ready' ma non vediamo marker per 500ms, passiamo a A4 contours.
    if (arucoEngineRef.current === "ready") {
      if (lastArucoMarkerSeenAtRef.current == null) {
        lastArucoMarkerSeenAtRef.current = now;
      }
      if (now - lastArucoMarkerSeenAtRef.current >= ARUCO_NO_MARKERS_FALLBACK_MS) {
        arucoEngineRef.current = "fallback";
        setSnapshot((s) => ({ ...s, arucoEngine: "fallback" }));
      }
    }
    const engine = arucoEngineRef.current;
    let next: ScanAlignmentSnapshot;
    let markerCentersNorm: { x: number; y: number }[] | null = null;
    let markerCount = 0;
    let markerIdsDetected: number[] = [];
    detectionFrameCounterRef.current += 1;
    const cached = cachedDetectionRef.current;
    const shouldRunHeavy =
      !cached ||
      now - cached.atMs > DETECTION_CACHE_MAX_MS ||
      detectionFrameCounterRef.current % DETECTION_HEAVY_EVERY_N_FRAMES === 0;

    if (!shouldRunHeavy) {
      next = {
        ...cached.next,
        arucoEngine: engine,
        tracking: cached.next.tracking ? { ...cached.next.tracking, position: { ...cached.next.tracking.position } } : { ...DEFAULT_TRACKING },
        sourceConfidence:
          typeof cached.next.sourceConfidence === "number" ? cached.next.sourceConfidence : detectionSourceConfidence(cached.next),
      };
    } else {

      if (engine === "ready" && isArucoDetectorReady()) {
        const markers = detectArucoOnImageData(imageData);
        markerCount = markers.length;
        if (markerCount > 0) {
          lastArucoMarkerSeenAtRef.current = now;
        }
        markerIdsDetected = markers
          .map((m) => m.id)
          .filter((id, idx, arr) => id >= 0 && id <= 3 && arr.indexOf(id) === idx);
        next = combineArucoAndHeuristic(imageData, markers, "ready");
        const picked = pickCornerMarkers(markers, w, h);
        if (picked.length >= 1) {
          markerCentersNorm = picked.slice(0, 4).map((m) => {
            const c = getMarkerCentroid(m);
            return { x: c.x / w, y: c.y / h };
          });
        }
        // Build stable per-corner map by marker id to support ArUco+A4 fusion.
        const arucoById: Array<{ x: number; y: number } | null> = [null, null, null, null];
        for (let i = 0; i < markers.length; i++) {
          const mk = markers[i];
          if (mk.id < 0 || mk.id > 3) continue;
          const c = getMarkerCentroid(mk);
          arucoById[mk.id] = { x: c.x / w, y: c.y / h };
        }
        // If exactly 3 markers are visible, infer the missing corner geometrically.
        const presentCorners = arucoById.filter((p) => !!p).length;
        if (presentCorners === 3) {
          const inferred = inferMissingArucoCornerById(arucoById);
          if (inferred) {
            markerCentersNorm = inferred;
          }
        }
        (next as ScanAlignmentSnapshot & { _arucoById?: Array<{ x: number; y: number } | null> })._arucoById = arucoById;
      } else if (engine === "fallback" || engine === "loading") {
        const a4fb = detectA4ByEdges(imageData);
        multiSourceBlendRef.current = {
          arucoCorners4: null,
          a4Corners4:
            a4fb && a4fb.cornersNorm.length >= 4
              ? a4fb.cornersNorm.map((p) => ({ x: p.x, y: p.y }))
              : null,
          markerCount: 0,
          updatedAtMs: now,
        };
        const heur = analyzeHeuristicOnly(imageData);
        next = {
          ...heur,
          arucoEngine: engine === "loading" ? "loading" : "fallback",
          markerCentersNorm: null,
          markerCount: 0,
          markerIdsDetected: [],
          alignmentSource: "foot_fallback",
          footBBoxNorm: null,
          footCentroidNorm: null,
          tracking: { ...DEFAULT_TRACKING },
          sourceConfidence: 0.3,
          markerSharpnessMin: null,
          a4GeometryOk: false,
          arucoMarkerQuadsNorm: [],
          arucoSlotCentersNorm: EMPTY_ARUCO_SLOTS,
        };
      } else {
        const a4fb2 = detectA4ByEdges(imageData);
        multiSourceBlendRef.current = {
          arucoCorners4: null,
          a4Corners4:
            a4fb2 && a4fb2.cornersNorm.length >= 4
              ? a4fb2.cornersNorm.map((p) => ({ x: p.x, y: p.y }))
              : null,
          markerCount: 0,
          updatedAtMs: now,
        };
        next = {
          ...analyzeHeuristicOnly(imageData),
          arucoEngine: "fallback",
          markerCentersNorm: null,
          markerCount: 0,
          markerIdsDetected: [],
          alignmentSource: "foot_fallback",
          footBBoxNorm: null,
          footCentroidNorm: null,
          tracking: { ...DEFAULT_TRACKING },
          sourceConfidence: 0.3,
          markerSharpnessMin: null,
          a4GeometryOk: false,
          arucoMarkerQuadsNorm: [],
          arucoSlotCentersNorm: EMPTY_ARUCO_SLOTS,
        };
      }

      if (engine === "ready" && isArucoDetectorReady()) {
        // Fusion:
        // 1) ArUco full -> use ArUco
        // 2) ArUco partial + A4 -> fuse
        // 3) No ArUco + A4 -> use A4
        // 4) else -> foot fallback
        const a4 = detectA4ByEdges(imageData);
        const arucoCornersForBlend =
          markerCentersNorm && markerCentersNorm.length >= 4
            ? markerCentersNorm.map((p) => ({ x: p.x, y: p.y }))
            : null;
        const a4CornersForBlend =
          a4 && a4.cornersNorm.length >= 4 ? a4.cornersNorm.map((p) => ({ x: p.x, y: p.y })) : null;
        multiSourceBlendRef.current = {
          arucoCorners4: arucoCornersForBlend,
          a4Corners4: a4CornersForBlend,
          markerCount,
          updatedAtMs: now,
        };
        const arucoById = (next as ScanAlignmentSnapshot & { _arucoById?: Array<{ x: number; y: number } | null> })._arucoById;
        if (markerCount >= 4) {
          next = { ...next, markerCentersNorm, markerCount, markerIdsDetected, alignmentSource: "aruco" };
        } else if (markerCount > 0 && a4 && a4.cornersNorm.length >= 4 && arucoById) {
          const fused = [
            arucoById[0] ?? a4.cornersNorm[0],
            arucoById[1] ?? a4.cornersNorm[1],
            arucoById[2] ?? a4.cornersNorm[2],
            arucoById[3] ?? a4.cornersNorm[3],
          ];
          next = {
            ...next,
            markerCentersNorm: fused,
            markerCount,
            markerIdsDetected,
            markersDetected: true,
            isPositionCorrect: next.footInFrame && next.guide !== "too_close",
            guide: next.guide === "too_close" ? "too_close" : next.footInFrame ? "aligned" : "default",
            alignmentSource: "a4",
          };
        } else if (a4 && a4.cornersNorm.length >= 4) {
          next = {
            ...next,
            markerCentersNorm: a4.cornersNorm,
            markerCount: 0,
            markerIdsDetected: [],
            markersDetected: true,
            // no ArUco -> conservative: aligned only if foot is inside and not too close.
            isPositionCorrect: next.footInFrame && next.guide !== "too_close",
            guide: next.guide === "too_close" ? "too_close" : next.footInFrame ? "aligned" : "default",
            alignmentSource: "a4",
          };
        } else if (markerCount > 0) {
          next = { ...next, markerCentersNorm, markerCount, markerIdsDetected, alignmentSource: "aruco" };
        } else {
          next = {
            ...next,
            markerCentersNorm: null,
            markerCount: 0,
            markerIdsDetected: [],
            alignmentSource: "foot_fallback",
            arucoMarkerQuadsNorm: [],
            arucoSlotCentersNorm: EMPTY_ARUCO_SLOTS,
          };
        }
      }
      next = {
        ...next,
        sourceConfidence: detectionSourceConfidence(next),
      };
      cachedDetectionRef.current = {
        atMs: now,
        next: {
          ...next,
          tracking: next.tracking ? { ...next.tracking, position: { ...next.tracking.position } } : { ...DEFAULT_TRACKING },
        },
      };
    }

    next = {
      ...next,
      sourceConfidence: detectionSourceConfidence(next),
    };

    const hasLiveGeometry =
      next.alignmentSource !== "foot_fallback" &&
      next.markerCentersNorm != null &&
      next.markerCentersNorm.length > 0;

    if (hasLiveGeometry) {
      const prevReliable = lastReliableRef.current;
      lastReliableRef.current = {
        atMs: now,
        markerCentersNorm: next.markerCentersNorm,
        markerCount: next.markerCount,
        markerIdsDetected: next.markerIdsDetected,
        alignmentSource: next.alignmentSource,
        guide: next.guide,
        isPositionCorrect: next.isPositionCorrect,
      };
    } else {
      const prevReliable = lastReliableRef.current;
      if (prevReliable && now - prevReliable.atMs < TRACKING_HOLD_MS) {
        // Keep previous state briefly to avoid flicker on temporary detection loss.
        next = {
          ...next,
          markerCentersNorm: prevReliable.markerCentersNorm,
          markerCount: prevReliable.markerCount,
          markerIdsDetected: prevReliable.markerIdsDetected,
          alignmentSource: prevReliable.alignmentSource,
          markersDetected: true,
          guide: prevReliable.guide === "too_close" ? "too_close" : next.guide,
          isPositionCorrect: prevReliable.isPositionCorrect || next.isPositionCorrect,
        };
      }
    }

    next = {
      ...next,
      sourceConfidence: detectionSourceConfidence(next),
    };

    // Continuous foot detection (AI mask) for fallback/overlay guidance.
    const shouldRunFootTrack =
      !footTrackBusyRef.current &&
      (shouldRunHeavy || now - footTrackRef.current.updatedAt > 650);
    if (shouldRunFootTrack) {
      footTrackBusyRef.current = true;
      const small = resizeImageDataNearest(imageData, FOOT_TRACK_MAX_SIDE);
      void buildFootBinaryMaskAi(small)
        .then((mask) => {
          const r = extractFootBoxAndCentroid(mask, small.width, small.height);
          const geo = extractFootMaskGeometry(mask, small.width, small.height);
          const nowM = performance.now();
          footTrackRef.current = {
            bbox: geo?.bboxNorm ?? r?.bbox ?? null,
            centroid: geo?.centroidNorm ?? r?.centroid ?? null,
            updatedAt: nowM,
            maskMetrics: geo,
            maskMetricsAt: geo ? nowM : 0,
          };
        })
        .catch(() => {
          // keep previous foot tracking state
        })
        .finally(() => {
          footTrackBusyRef.current = false;
        });
    }

    const ft = footTrackRef.current;
    const footTrackFresh = now - ft.updatedAt < 1200;
    const footBBoxNorm = footTrackFresh ? ft.bbox : null;
    const footCentroidNorm = footTrackFresh ? ft.centroid : null;
    const maskMetricsFresh = ft.maskMetrics != null && now - ft.maskMetricsAt < 1200;
    const footViewZoneMetrics = maskMetricsFresh ? ft.maskMetrics : null;
    const detectedFootViewZone: FootViewZone | null =
      footViewZoneMetrics != null
        ? classifyFootViewZone({
            metrics: footViewZoneMetrics,
            sheetCenterNorm: sheetCenterFromMarkers(next.markerCentersNorm),
            currentFoot: scanFootId,
          })
        : null;

    // Anti-flicker: se una frame non produce una zona (null), tieni l'ultima zona valida per qualche ms.
    let detectedFootViewZoneHeld: FootViewZone | null = detectedFootViewZone;
    if (detectedFootViewZoneHeld != null) {
      detectedZoneRef.current = { zone: detectedFootViewZoneHeld, atMs: now };
    } else if (detectedZoneRef.current && now - detectedZoneRef.current.atMs <= detectedZoneHoldMs) {
      detectedFootViewZoneHeld = detectedZoneRef.current.zone;
    }
    const footAreaValid =
      !!footBBoxNorm &&
      footBBoxNorm.w > 0.2 &&
      footBBoxNorm.h > 0.2 &&
      footBBoxNorm.x > 0.01 &&
      footBBoxNorm.y > 0.01 &&
      footBBoxNorm.x + footBBoxNorm.w < 0.99 &&
      footBBoxNorm.y + footBBoxNorm.h < 0.99;

    next = {
      ...next,
      footBBoxNorm,
      footCentroidNorm,
      footViewZoneMetrics,
      detectedFootViewZone: detectedFootViewZoneHeld,
      footInFrame: next.footInFrame || !!footBBoxNorm,
    };

    // When markers fail, use foot tracking to validate scan area.
    if (next.alignmentSource === "foot_fallback") {
      next.isPositionCorrect = footAreaValid && next.guide !== "too_close";
      next.guide = next.guide === "too_close" ? "too_close" : next.isPositionCorrect ? "aligned" : "default";
    }

    next = {
      ...next,
      sourceConfidence: detectionSourceConfidence(next),
    };

    const hasNextGeometry = !!next.markerCentersNorm && next.markerCentersNorm.length > 0;
    const stableRender = stableRenderRef.current;
    const incomingConf = detectionSourceConfidence(next);
    let renderNext = next;

    if (!stableRender) {
      stableRenderRef.current = {
        snapshot: { ...next },
        sourceSinceMs: now,
        lastGeometryMs: hasNextGeometry ? now : 0,
        modeBlend01: 1,
        blendTargetSource: next.alignmentSource,
      };
    } else {
      const current = stableRender.snapshot;
      const currentRank = alignmentSourceRank(current.alignmentSource);
      const incomingRank = alignmentSourceRank(next.alignmentSource);
      const sourceHeldMs = now - stableRender.sourceSinceMs;
      const geometryFresh = now - stableRender.lastGeometryMs < SOURCE_GEOMETRY_LOSS_HOLD_MS;

      const isDowngrade = incomingRank < currentRank;
      const shouldHoldDowngrade = isDowngrade && sourceHeldMs < SOURCE_DOWNGRADE_HOLD_MS;
      const shouldHoldGeometryLoss = !hasNextGeometry && geometryFresh;

      if (shouldHoldDowngrade || shouldHoldGeometryLoss) {
        const carryGuide = current.guide === "too_close" || next.guide === "too_close"
          ? "too_close"
          : current.guide;
        renderNext = {
          ...next,
          markerCentersNorm: current.markerCentersNorm,
          markerCount: current.markerCount,
          markerIdsDetected: current.markerIdsDetected,
          alignmentSource: current.alignmentSource,
          markersDetected: current.markersDetected,
          isPositionCorrect: current.isPositionCorrect || next.isPositionCorrect,
          guide: carryGuide,
          sourceConfidence: current.sourceConfidence,
          arucoMarkerQuadsNorm: current.arucoMarkerQuadsNorm,
          arucoSlotCentersNorm: current.arucoSlotCentersNorm,
        };
      } else {
        const both4 =
          hasNextGeometry &&
          current.markerCentersNorm != null &&
          current.markerCentersNorm.length >= 4 &&
          next.markerCentersNorm != null &&
          next.markerCentersNorm.length >= 4;
        const srcDiff = next.alignmentSource !== current.alignmentSource;
        const confPrev = detectionSourceConfidence(current);
        const confInc = incomingConf;

        if (both4 && srcDiff) {
          if (next.alignmentSource !== stableRender.blendTargetSource) {
            stableRender.blendTargetSource = next.alignmentSource;
            stableRender.modeBlend01 = 0;
          }
          const step = 0.03 + 0.17 * confInc;
          stableRender.modeBlend01 = Math.min(1, stableRender.modeBlend01 + step);
          const u = stableRender.modeBlend01;
          const cornerSm = smoothstep01(u);
          const useIncoming = u >= 0.52;
          renderNext = {
            ...next,
            sourceConfidence: lerpNum(confPrev, confInc, cornerSm),
            markerCentersNorm: lerpCornerArrays(current.markerCentersNorm, next.markerCentersNorm, u),
            alignmentSource: useIncoming ? next.alignmentSource : current.alignmentSource,
            markerCount: useIncoming ? next.markerCount : current.markerCount,
            markerIdsDetected: useIncoming ? next.markerIdsDetected.slice() : current.markerIdsDetected.slice(),
            markersDetected: useIncoming ? next.markersDetected : current.markersDetected,
          };
        } else {
          if (!srcDiff) {
            stableRender.modeBlend01 = 1;
            stableRender.blendTargetSource = next.alignmentSource;
          }
          renderNext = { ...next, sourceConfidence: confInc };
          if (current.alignmentSource !== next.alignmentSource) {
            stableRender.sourceSinceMs = now;
          }
        }
      }

      if (renderNext.markerCentersNorm && renderNext.markerCentersNorm.length > 0) {
        stableRender.lastGeometryMs = now;
      }
      stableRender.snapshot = { ...renderNext };
      renderNext = stableRender.snapshot;
    }
    next = renderNext;

    // --- Stato tracking stabilizzato (pose liscia: posizione, rotazione, scala, confidenza) ---
    let trInner = stableTrackingInternalRef.current;
    if (!trInner) {
      trInner = {
        x: DEFAULT_TRACKING.position.x,
        y: DEFAULT_TRACKING.position.y,
        rotation: DEFAULT_TRACKING.rotation,
        scale: DEFAULT_TRACKING.scale,
        confidence: 0,
        isLandscape: false,
        lastValidMs: 0,
        lastTickMs: now,
        initialized: false,
      };
      stableTrackingInternalRef.current = trInner;
    }
    trInner.lastTickMs = now;

    let hasMeasurement = false;
    let tx = trInner.x;
    let ty = trInner.y;
    let trot = trInner.rotation;
    let ts = trInner.scale;
    let tLand = trInner.isLandscape;
    let targetConf = 0;

    const currGray = rgbaToGrayLuma(imageData.data, w, h);

    const blendCache = multiSourceBlendRef.current;
    const blended = computeMultiSourceBlendedPose({
      arucoCorners4: blendCache?.arucoCorners4 ?? null,
      a4Corners4: blendCache?.a4Corners4 ?? null,
      arucoMarkerCount: blendCache?.markerCount ?? 0,
      footBBox: next.footBBoxNorm,
    });
    if (blended) {
      hasMeasurement = true;
      tx = blended.pose.x;
      ty = blended.pose.y;
      trot = blended.pose.rotation;
      ts = blended.pose.scale;
      tLand = blended.pose.isLandscape;
      targetConf = blended.targetConf;
      const seedCorners = cornersFromStablePose(
        blended.pose.x,
        blended.pose.y,
        blended.pose.rotation,
        blended.pose.scale,
        blended.pose.isLandscape
      );
      cornerFlowContinuityRef.current = {
        cornersNorm: seedCorners.map((p) => ({ x: p.x, y: p.y })),
        prevGray: new Uint8Array(currGray),
        w,
        h,
        failStreak: 0,
      };
      trackingFrameBufferRef.current.push({
        x: tx,
        y: ty,
        rotation: trot,
        scale: ts,
        isLandscape: tLand,
        confidence: clamp01(targetConf),
        atMs: now,
      });
      if (trackingFrameBufferRef.current.length > TRACKING_FRAME_BUFFER_SIZE) {
        trackingFrameBufferRef.current.splice(0, trackingFrameBufferRef.current.length - TRACKING_FRAME_BUFFER_SIZE);
      }
    } else {
      const st = cornerFlowContinuityRef.current;
      if (st && st.cornersNorm.length === 4 && st.prevGray && st.w === w && st.h === h) {
        const nextCorners = trackCornersPatchFlow(st.prevGray, currGray, w, h, st.cornersNorm, {
          patchHalf: 8,
          searchRadius: 14,
          step: 2,
          maxMoveNorm: 0.1,
        });
        if (nextCorners) {
          st.cornersNorm = nextCorners;
          st.failStreak = 0;
          st.prevGray = new Uint8Array(currGray);
          const flowPose = poseFromSheetCorners(nextCorners);
          if (flowPose) {
            hasMeasurement = true;
            tx = flowPose.x;
            ty = flowPose.y;
            trot = flowPose.rotation;
            ts = flowPose.scale;
            tLand = flowPose.isLandscape;
            targetConf = CONTINUITY_PATCH_FLOW_CONF;
            trackingFrameBufferRef.current.push({
              x: tx,
              y: ty,
              rotation: trot,
              scale: ts,
              isLandscape: tLand,
              confidence: clamp01(targetConf),
              atMs: now,
            });
            if (trackingFrameBufferRef.current.length > TRACKING_FRAME_BUFFER_SIZE) {
              trackingFrameBufferRef.current.splice(0, trackingFrameBufferRef.current.length - TRACKING_FRAME_BUFFER_SIZE);
            }
          }
        } else {
          st.failStreak += 1;
          st.prevGray = new Uint8Array(currGray);
          if (st.failStreak > 8) {
            cornerFlowContinuityRef.current = null;
          } else {
            const flowPose = poseFromSheetCorners(st.cornersNorm);
            if (flowPose) {
              hasMeasurement = true;
              tx = flowPose.x;
              ty = flowPose.y;
              trot = flowPose.rotation;
              ts = flowPose.scale;
              tLand = flowPose.isLandscape;
              targetConf = CONTINUITY_PATCH_FLOW_CONF * Math.max(0.35, 1 - st.failStreak * 0.07);
              trackingFrameBufferRef.current.push({
                x: tx,
                y: ty,
                rotation: trot,
                scale: ts,
                isLandscape: tLand,
                confidence: clamp01(targetConf),
                atMs: now,
              });
              if (trackingFrameBufferRef.current.length > TRACKING_FRAME_BUFFER_SIZE) {
                trackingFrameBufferRef.current.splice(0, trackingFrameBufferRef.current.length - TRACKING_FRAME_BUFFER_SIZE);
              }
            }
          }
        }
      }
    }

    if (hasMeasurement) {
      const avg = averageTrackingMeasurements(trackingFrameBufferRef.current);
      if (avg) {
        tx = avg.x;
        ty = avg.y;
        trot = avg.rotation;
        ts = avg.scale;
        tLand = avg.isLandscape;
        targetConf = (targetConf + avg.confidence) * 0.5;
      }
    } else if (trackingFrameBufferRef.current.length > 0) {
      // Nessuna misura nel frame corrente: svuota lentamente il buffer per evitare snap.
      trackingFrameBufferRef.current.shift();
    }

    /** Peso lerp pose: più alto con sorgenti più affidabili (1 → 0.7 → 0.5 → 0.3) */
    const tPose = Math.max(
      0.04,
      Math.min(0.16, OVERLAY_TRANSFORM_LERP * (0.25 + 0.75 * (hasMeasurement ? targetConf : next.sourceConfidence)))
    );

    if (hasMeasurement) {
      trInner.lastValidMs = now;
    }

    const lostMsStable = trInner.lastValidMs > 0 ? now - trInner.lastValidMs : Number.POSITIVE_INFINITY;
    /** Hold solo se abbiamo già avuto una misura valida (evita “hold” a freddo con lastValidMs = 0) */
    const inDetectionHold =
      !hasMeasurement && trInner.initialized && trInner.lastValidMs > 0 && lostMsStable < DETECTION_STATE_HOLD_MS;
    /** Dopo hold senza misura: solo decay graduale confidenza (pose ancora congelata) */
    const inConfidenceDecayPhase =
      !hasMeasurement && trInner.initialized && !inDetectionHold && trInner.lastValidMs > 0;

    if (!trInner.initialized && hasMeasurement) {
      trInner.x = tx;
      trInner.y = ty;
      trInner.rotation = trot;
      trInner.scale = ts;
      trInner.isLandscape = tLand;
      trInner.confidence = clamp01(targetConf * 0.88);
      trInner.initialized = true;
    } else if (hasMeasurement) {
      trInner.x = lerpNum(trInner.x, tx, tPose);
      trInner.y = lerpNum(trInner.y, ty, tPose);
      trInner.rotation += shortestAngleDelta(trInner.rotation, trot) * tPose;
      trInner.scale = lerpNum(trInner.scale, ts, tPose);
      trInner.isLandscape = tLand;
      trInner.confidence = lerpNum(trInner.confidence, clamp01(targetConf), tPose);
    } else if (inDetectionHold) {
      // Hold completo: non toccare pose né confidence
    } else if (inConfidenceDecayPhase) {
      trInner.confidence = lerpNum(trInner.confidence, 0, DETECTION_CONFIDENCE_DECAY_LERP);
    }

    const confOut = clamp01(trInner.confidence);
    const trackingOut: StableTrackingState = {
      position: { x: trInner.x, y: trInner.y },
      rotation: trInner.rotation,
      scale: trInner.scale,
      confidence: confOut,
    };

    // Fallback visivo (markerCenters da stable render) solo sotto soglia, dopo hold + decay lento.
    const showSmoothedCorners = trInner.initialized && confOut >= STABLE_TRACK_CORNER_CONF_MIN;

    const smoothedCorners = showSmoothedCorners
      ? cornersFromStablePose(trInner.x, trInner.y, trInner.rotation, trInner.scale, trInner.isLandscape)
      : null;

    next = {
      ...next,
      tracking: trackingOut,
      markerCentersNorm: smoothedCorners != null ? smoothedCorners : next.markerCentersNorm,
    };

    if (stableRenderRef.current) {
      stableRenderRef.current.snapshot = { ...next };
    }

    if (next.isPositionCorrect) {
      if (alignedSinceRef.current === null) alignedSinceRef.current = now;
      const ms = now - alignedSinceRef.current;
      if (ms === 0 || Math.abs(ms - lastStableUiRef.current) >= 80 || (ms >= 1000 && lastStableUiRef.current < 1000)) {
        lastStableUiRef.current = ms;
        setStableAlignedMs(ms);
      }
    } else {
      alignedSinceRef.current = null;
      lastStableUiRef.current = 0;
      setStableAlignedMs(0);
    }

    setSnapshot((prev) => {
      if (
        prev.guide === next.guide &&
        prev.markersDetected === next.markersDetected &&
        prev.footInFrame === next.footInFrame &&
        prev.isPositionCorrect === next.isPositionCorrect &&
        prev.arucoEngine === next.arucoEngine &&
        prev.markerCount === next.markerCount &&
        prev.markerIdsDetected.join(",") === next.markerIdsDetected.join(",") &&
        prev.alignmentSource === next.alignmentSource &&
        JSON.stringify(prev.footBBoxNorm) === JSON.stringify(next.footBBoxNorm) &&
        JSON.stringify(prev.footCentroidNorm) === JSON.stringify(next.footCentroidNorm) &&
        JSON.stringify(prev.footViewZoneMetrics) === JSON.stringify(next.footViewZoneMetrics) &&
        prev.detectedFootViewZone === next.detectedFootViewZone &&
        serializeMarkerCenters(prev.markerCentersNorm) === serializeMarkerCenters(next.markerCentersNorm) &&
        serializeTracking(prev.tracking) === serializeTracking(next.tracking) &&
        Math.abs((prev.sourceConfidence ?? 0) - (next.sourceConfidence ?? 0)) < 0.002 &&
        prev.markerSharpnessMin === next.markerSharpnessMin &&
        prev.a4GeometryOk === next.a4GeometryOk
      ) {
        return prev;
      }
      return next;
    });
  }, [videoRef, scanFootId]);

  useEffect(() => {
    alignedSinceRef.current = null;
    lastStableUiRef.current = 0;
    lastReliableRef.current = null;
    detectedZoneRef.current = null;
    footTrackRef.current = {
      bbox: null,
      centroid: null,
      updatedAt: 0,
      maskMetrics: null,
      maskMetricsAt: 0,
    };
    cachedDetectionRef.current = null;
    detectionFrameCounterRef.current = 0;
    stableRenderRef.current = null;
    stableTrackingInternalRef.current = null;
    multiSourceBlendRef.current = null;
    cornerFlowContinuityRef.current = null;
    trackingFrameBufferRef.current = [];
    setStableAlignedMs(0);
  }, [resetToken]);

  useEffect(() => {
    if (!enabled) {
      setSnapshot({
        ...DEFAULT_SNAPSHOT,
        arucoEngine: "loading",
        markerCentersNorm: null,
        sourceConfidence: 0,
      });
      setStableAlignedMs(0);
      alignedSinceRef.current = null;
      lastStableUiRef.current = 0;
      lastReliableRef.current = null;
      footTrackRef.current = {
      bbox: null,
      centroid: null,
      updatedAt: 0,
      maskMetrics: null,
      maskMetricsAt: 0,
    };
      cachedDetectionRef.current = null;
      detectionFrameCounterRef.current = 0;
      stableRenderRef.current = null;
      stableTrackingInternalRef.current = null;
      multiSourceBlendRef.current = null;
      cornerFlowContinuityRef.current = null;
      trackingFrameBufferRef.current = [];
      return;
    }

    let raf = 0;
    let last = 0;

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const interval = arucoEngineRef.current === "ready" ? 120 : 140;
      if (t - last < interval) return;
      last = t;
      tick();
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled, tick]);

  return { ...snapshot, stableAlignedMs };
}

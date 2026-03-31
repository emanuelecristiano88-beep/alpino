import { computeNeumaBiometryFromImageData } from "./computeNeumaBiometry";
import type { NeumaBiometryResult } from "./types";

function distMm(a: { xMm: number; yMm: number }, b: { xMm: number; yMm: number }) {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

function pcaExtentsMm(pts: { xMm: number; yMm: number }[]) {
  const n = pts.length;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.xMm;
    my += p.yMm;
  }
  mx /= Math.max(1, n);
  my /= Math.max(1, n);

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.xMm - mx;
    const dy = p.yMm - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const inv = 1 / Math.max(1, n);
  sxx *= inv;
  syy *= inv;
  sxy *= inv;

  // Eigenvectors of [[sxx, sxy], [sxy, syy]]
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, tr * tr - 4 * det);
  const root = Math.sqrt(disc);
  const l1 = (tr + root) / 2; // largest

  // v1 solves (A - l1 I)v = 0
  let vx = sxy;
  let vy = l1 - sxx;
  const norm = Math.hypot(vx, vy);
  if (norm < 1e-9) {
    // axis-aligned fallback
    vx = 1;
    vy = 0;
  } else {
    vx /= norm;
    vy /= norm;
  }
  // v2 = perpendicular
  const ux = -vy;
  const uy = vx;

  let min1 = Infinity,
    max1 = -Infinity,
    min2 = Infinity,
    max2 = -Infinity;
  for (const p of pts) {
    const dx = p.xMm - mx;
    const dy = p.yMm - my;
    const t1 = dx * vx + dy * vy;
    const t2 = dx * ux + dy * uy;
    if (t1 < min1) min1 = t1;
    if (t1 > max1) max1 = t1;
    if (t2 < min2) min2 = t2;
    if (t2 > max2) max2 = t2;
  }
  const length = Math.max(0, max1 - min1);
  const width = Math.max(0, max2 - min2);
  return { length, width };
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D non disponibile");
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return img;
}

function scoreBiometry(res: NeumaBiometryResult) {
  if (!res.calibration.ok) return -1;
  let score = 0;
  score += Math.min(1, res.footContourMm.length / 800) * 2.2;
  score += res.keypoints.length >= 5 ? 1.2 : 0;
  // Penalize warnings (border issues etc.)
  score -= Math.min(3, res.calibration.warnings.length) * 0.35;
  return score;
}

/**
 * Estrae misure base (mm) da una lista di frame.
 * - scala: calibrata dal foglio A4 con ArUco (omografia -> mm)
 * - contorno: segmentazione piede in vista canonica del foglio
 */
export async function extractBasicFootMeasurementsFromFrames(frames: Blob[]): Promise<{
  length: number;
  width: number;
  height: number;
}> {
  if (!frames.length) throw new Error("Nessun frame disponibile");

  let best: NeumaBiometryResult | null = null;
  let bestScore = -Infinity;

  // Try up to N frames evenly spaced for robustness and speed.
  const maxTry = Math.min(16, frames.length);
  for (let i = 0; i < maxTry; i++) {
    const t = maxTry <= 1 ? 0 : i / (maxTry - 1);
    const idx = Math.min(frames.length - 1, Math.floor(t * (frames.length - 1)));
    const blob = frames[idx]!;

    const img = await blobToImageData(blob);
    const res = await computeNeumaBiometryFromImageData(img, { pxPerMm: 4 });
    const s = scoreBiometry(res);
    if (s > bestScore) {
      bestScore = s;
      best = res;
    }
    if (bestScore >= 2.8) break; // good enough
  }

  if (!best || !best.calibration.ok || best.footContourMm.length < 40) {
    throw new Error("Calibrazione/contorno non affidabili: ripeti la scansione con 4 marker visibili");
  }

  const contour = best.footContourMm;
  const { length: pcaLen, width: pcaWid } = pcaExtentsMm(contour);

  const hallux = best.keypoints.find((k) => k.id === "hallux_tip");
  const heel = best.keypoints.find((k) => k.id === "heel_center");
  const semanticLen = hallux && heel ? distMm(hallux, heel) : 0;

  // Length: prefer semantic (heel->toe). Fallback to PCA.
  const length = semanticLen > 80 ? semanticLen : pcaLen;
  // Width: use PCA minor axis extent, clamp to something sane vs length.
  const width = Math.min(pcaWid, length * 0.65);

  // Height (optional): with top-down only we approximate a believable dorsal height from L/W.
  // This is intentionally conservative; the preview template uses this as a *small adjustment*.
  const height = Math.max(28, Math.min(55, 0.18 * length + 0.06 * width));

  return {
    length: Math.round(length * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}


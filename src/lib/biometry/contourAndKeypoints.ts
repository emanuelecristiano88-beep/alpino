/**
 * Contorno piede e keypoint 2D in mm (piano foglio Z=0).
 * Euristiche geometriche — affinabili con modello ML o punti semantici OpenCV.
 */

import type { NeumaKeypointId, NeumaPoint3D } from "./types";

export type ContourPt = { xPx: number; yPx: number };

/** Pixel di bordo del foreground (4-vicini) */
export function boundaryPixels(mask: Uint8Array, w: number, h: number): ContourPt[] {
  const pts: ContourPt[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const border =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !mask[i - 1] ||
        !mask[i + 1] ||
        !mask[i - w] ||
        !mask[i + w];
      if (border) pts.push({ xPx: x, yPx: y });
    }
  }
  return pts;
}

function intersectHorizontalWithContour(contour: ContourPt[], yTarget: number): ContourPt[] {
  const band = contour.filter((p) => Math.abs(p.yPx - yTarget) <= 2);
  if (band.length < 2) return band;
  band.sort((a, b) => a.xPx - b.xPx);
  return band;
}

export function keypointsFromContourMm(
  contourPx: ContourPt[],
  mmPerPixel: number
): { keypoints: NeumaPoint3D[]; contourMm: { xMm: number; yMm: number }[] } {
  const toMm = (p: ContourPt) => ({ xMm: p.xPx * mmPerPixel, yMm: p.yPx * mmPerPixel });
  const contourMm = contourPx.map(toMm);

  if (contourPx.length < 8) {
    return {
      keypoints: [],
      contourMm,
    };
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of contourPx) {
    minY = Math.min(minY, p.yPx);
    maxY = Math.max(maxY, p.yPx);
  }
  const span = maxY - minY || 1;

  const toeCandidates = contourPx.filter((p) => p.yPx < minY + 0.12 * span);
  let hallux: ContourPt = toeCandidates[0] ?? contourPx[0];
  let bestY = Infinity;
  for (const p of (toeCandidates.length ? toeCandidates : contourPx)) {
    if (p.yPx < bestY) {
      bestY = p.yPx;
      hallux = p;
    }
  }

  const heelCandidates = contourPx.filter((p) => p.yPx > maxY - 0.22 * span);
  let sumX = 0;
  let sumY = 0;
  for (const p of heelCandidates) {
    sumX += p.xPx;
    sumY += p.yPx;
  }
  const heelCenter: ContourPt =
    heelCandidates.length > 0
      ? { xPx: sumX / heelCandidates.length, yPx: sumY / heelCandidates.length }
      : contourPx.reduce((a, b) => (a.yPx > b.yPx ? a : b));

  const yMeta = minY + 0.38 * span;
  const metaPts = intersectHorizontalWithContour(contourPx, yMeta);
  const med = metaPts[0] ?? hallux;
  const lat = metaPts[metaPts.length - 1] ?? hallux;

  const heelSort = [...heelCandidates].sort((a, b) => a.xPx - b.xPx);
  const heelL = heelSort[0] ?? heelCenter;
  const heelR = heelSort[heelSort.length - 1] ?? heelCenter;

  const conf = 0.55;

  const keypoints: NeumaPoint3D[] = [
    {
      id: "hallux_tip" as NeumaKeypointId,
      ...toMm(hallux),
      zMm: 0,
      confidence: conf,
      notes: "Estremità distale; raffinabile con modello alluce",
    },
    {
      id: "metatarsal_medial" as NeumaKeypointId,
      ...toMm(med),
      zMm: 0,
      confidence: conf * 0.9,
    },
    {
      id: "metatarsal_lateral" as NeumaKeypointId,
      ...toMm(lat),
      zMm: 0,
      confidence: conf * 0.9,
    },
    {
      id: "heel_center" as NeumaKeypointId,
      ...toMm(heelCenter),
      zMm: 0,
      confidence: conf * 0.85,
    },
    {
      id: "heel_curve_left" as NeumaKeypointId,
      ...toMm(heelL),
      zMm: 0,
      confidence: conf * 0.75,
    },
    {
      id: "heel_curve_right" as NeumaKeypointId,
      ...toMm(heelR),
      zMm: 0,
      confidence: conf * 0.75,
    },
    {
      id: "ankle_neck_lateral" as NeumaKeypointId,
      xMm: heelCenter.xPx * mmPerPixel,
      yMm: Math.max(0, (minY - 6) * mmPerPixel),
      zMm: 0,
      confidence: 0.12,
      notes:
        "Segnaposto 2D: altezza collo richiede vista laterale + fusione multi-vista sul Mac (Z da mesh/.obj)",
    },
  ];

  return { keypoints, contourMm };
}

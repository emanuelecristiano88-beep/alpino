/**
 * Stima profondità relativa senza rete neurale (veloce, browser-only).
 * Combina gradiente (Sobel) + inverso luminanza + blur → mappa coerente per fusione multi-vista.
 *
 * Per integrare MiDaS / Depth Anything / ONNX:
 * - sostituire `estimateRelativeDepthNormalized` con output modello,
 * * - poi chiamare sempre `normalizeDepth01` sul tensore.
 */

export type DepthBackend = "pseudo";

/**
 * Normalizza profondità in [0,1] con percentile per robustezza a outlier.
 */
export function normalizeDepth01(depth: Float32Array, lowPct = 0.02, highPct = 0.98): Float32Array {
  const n = depth.length;
  const sorted = Array.from(depth).sort((a, b) => a - b);
  const lo = sorted[Math.floor(lowPct * (n - 1))] ?? 0;
  const hi = sorted[Math.floor(highPct * (n - 1))] ?? 1;
  const range = Math.max(1e-6, hi - lo);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.max(0, Math.min(1, (depth[i] - lo) / range));
  }
  return out;
}

function grayLuma(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  const o = (y * w + x) * 4;
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
}

function sobelGradientMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
  const mag = new Float32Array(gray.length);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sx = 0;
      let sy = 0;
      let ki = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const v = gray[(y + j) * width + x + i];
          sx += gx[ki] * v;
          sy += gy[ki] * v;
          ki++;
        }
      }
      mag[y * width + x] = Math.hypot(sx, sy);
    }
  }
  return mag;
}

function boxBlur3x3(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.max(0, Math.min(w - 1, x + dx));
        s += src[y * w + xx];
        c++;
      }
      tmp[y * w + x] = s / c;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.max(0, Math.min(h - 1, y + dy));
        s += tmp[yy * w + x];
        c++;
      }
      out[y * w + x] = s / c;
    }
  }
  return out;
}

/**
 * Profondità relativa pseudo-metrica, normalizzata [0,1] (vicino = valori alti tipicamente).
 */
export function estimateRelativeDepthNormalized(imageData: ImageData): Float32Array {
  const { width: w, height: h, data } = imageData;
  const n = w * h;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = grayLuma(data, w, i % w, (i / w) | 0);
  }

  const mag = sobelGradientMagnitude(gray, w, h);
  let magBlur = boxBlur3x3(mag, w, h);
  magBlur = boxBlur3x3(magBlur, w, h);

  let minG = Infinity;
  let maxG = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = magBlur[i];
    if (v < minG) minG = v;
    if (v > maxG) maxG = v;
  }
  const gRange = Math.max(1e-6, maxG - minG);

  const depthRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const gNorm = (magBlur[i] - minG) / gRange;
    const invLum = 1 - gray[i] / 255;
    // Strutture (bordi) + zone ombreggiate → profondità relativa
    depthRaw[i] = 0.62 * gNorm + 0.38 * invLum;
  }

  return normalizeDepth01(depthRaw);
}

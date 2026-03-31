/**
 * Maschera binaria piede vs carta (vista canonica dall’alto).
 * Include:
 * - fallback euristico colore
 * - opzionale segmentazione AI (MediaPipe ImageSegmenter)
 * - post-processing: threshold, noise removal, largest connected component
 */

const SEGMENTER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
const TASKS_VISION_ESM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

type SegmenterLike = {
  segment: (image: ImageData) => { categoryMask?: unknown } | null;
};

let segmenterInitPromise: Promise<SegmenterLike | null> | null = null;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function morphClose3x3(mask: Uint8Array, w: number, h: number, iterations: number) {
  const tmp = new Uint8Array(mask.length);
  for (let it = 0; it < iterations; it++) {
    // dilate
    tmp.set(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let mx = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            mx = Math.max(mx, tmp[(y + dy) * w + x + dx]);
          }
        }
        mask[y * w + x] = mx;
      }
    }
    // erode
    tmp.set(mask);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let mn = 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            mn = Math.min(mn, tmp[(y + dy) * w + x + dx]);
          }
        }
        mask[y * w + x] = mn;
      }
    }
  }
}

function removeSmallBlobs(mask: Uint8Array, w: number, h: number, minArea: number) {
  const vis = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || vis[i]) continue;
    const q: number[] = [i];
    const comp: number[] = [i];
    vis[i] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      const cx = cur % w;
      const cy = (cur / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] && !vis[ni]) {
          vis[ni] = 1;
          q.push(ni);
          comp.push(ni);
        }
      }
    }
    if (comp.length < minArea) {
      for (const idx of comp) mask[idx] = 0;
    }
  }
}

function largestBlob(mask: Uint8Array, w: number, h: number) {
  const vis = new Uint8Array(mask.length);
  let best: Uint8Array | null = null;
  let bestN = 0;

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || vis[i]) continue;
    const comp = new Uint8Array(mask.length);
    const q: number[] = [i];
    vis[i] = 1;
    comp[i] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi];
      const cx = cur % w;
      const cy = (cur / w) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (mask[ni] && !vis[ni]) {
          vis[ni] = 1;
          comp[ni] = 1;
          q.push(ni);
        }
      }
    }
    const n = q.length;
    if (n > bestN) {
      bestN = n;
      best = comp;
    }
  }

  mask.fill(0);
  if (best) {
    for (let i = 0; i < mask.length; i++) mask[i] = best[i];
  }
}

function postProcessMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask);
  morphClose3x3(out, w, h, 2);
  const minArea = Math.max(20, Math.floor(w * h * 0.002));
  removeSmallBlobs(out, w, h, minArea);
  largestBlob(out, w, h);
  return out;
}

export function buildFootBinaryMask(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const lum = (r + g + b) / 3;
    // Carta bianca: molto chiara e poco saturata
    const paper = lum > 210 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25;
    // Pelle: più scura del foglio, toni caldi
    const skin = !paper && lum < 245 && r > g - 5 && r > b && lum > 35 && lum < 230;
    mask[i] = skin ? 1 : 0;
  }
  return postProcessMask(mask, width, height);
}

function readCategoryMaskBytes(categoryMask: unknown): { data: Uint8Array; width: number; height: number } | null {
  if (!categoryMask || typeof categoryMask !== "object") return null;
  const m = categoryMask as {
    width?: number;
    height?: number;
    getAsUint8Array?: () => Uint8Array;
    data?: Uint8Array | Uint8ClampedArray;
  };
  const width = m.width ?? 0;
  const height = m.height ?? 0;
  let data: Uint8Array | null = null;
  if (typeof m.getAsUint8Array === "function") {
    data = m.getAsUint8Array();
  } else if (m.data instanceof Uint8Array) {
    data = m.data;
  } else if (m.data instanceof Uint8ClampedArray) {
    data = new Uint8Array(m.data.buffer, m.data.byteOffset, m.data.byteLength);
  }
  if (!data || width <= 0 || height <= 0 || data.length < width * height) return null;
  return { data, width, height };
}

function resizeMaskNearest(
  srcMask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return new Uint8Array(srcMask);
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y / Math.max(1, dstH - 1)) * Math.max(1, srcH - 1)));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / Math.max(1, dstW - 1)) * Math.max(1, srcW - 1)));
      out[y * dstW + x] = srcMask[sy * srcW + sx];
    }
  }
  return out;
}

export async function ensureFootSegmenter(): Promise<SegmenterLike | null> {
  if (typeof window === "undefined") return null;
  if (!segmenterInitPromise) {
    segmenterInitPromise = (async () => {
      const mod = (await import(
        /* @vite-ignore */
        TASKS_VISION_ESM_URL
      )) as {
        FilesetResolver: { forVisionTasks: (baseUrl: string) => Promise<unknown> };
        ImageSegmenter: {
          createFromOptions: (
            vision: unknown,
            options: {
              baseOptions: { modelAssetPath: string };
              runningMode: "IMAGE";
              outputCategoryMask: boolean;
            }
          ) => Promise<SegmenterLike>;
        };
      };
      const vision = await mod.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      const segmenter = await mod.ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL },
        runningMode: "IMAGE",
        outputCategoryMask: true,
      });
      return segmenter;
    })().catch(() => null);
  }
  return segmenterInitPromise;
}

export async function buildFootBinaryMaskAi(imageData: ImageData): Promise<Uint8Array> {
  const segmenter = await ensureFootSegmenter();
  if (!segmenter) return buildFootBinaryMask(imageData);

  const result = segmenter.segment(imageData);
  const cat = readCategoryMaskBytes(result?.categoryMask);
  if (!cat) return buildFootBinaryMask(imageData);

  // MediaPipe category mask: 0 = background, >0 = foreground classes.
  const srcBinary = new Uint8Array(cat.width * cat.height);
  for (let i = 0; i < srcBinary.length; i++) {
    srcBinary[i] = clamp01(cat.data[i] > 0 ? 1 : 0);
  }
  const resized = resizeMaskNearest(srcBinary, cat.width, cat.height, imageData.width, imageData.height);
  return postProcessMask(resized, imageData.width, imageData.height);
}

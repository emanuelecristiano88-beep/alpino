/**
 * Maschera binaria piede vs carta (vista canonica dall’alto).
 * Euristica colore — per produzione si può sostituire con segmentazione OpenCV/ML.
 */

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

  morphClose3x3(mask, width, height, 2);
  largestBlob(mask, width, height);
  return mask;
}

function morphClose3x3(mask: Uint8Array, w: number, h: number, iterations: number) {
  const tmp = new Uint8Array(mask.length);
  for (let it = 0; it < iterations; it++) {
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

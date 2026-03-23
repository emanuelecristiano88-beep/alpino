import * as THREE from "three";

/** Vertical axis used for pseudo–pressure / height mapping */
export type HeatmapAxis = "y" | "z";

export function heatmapAxisComponent(axis: HeatmapAxis): 1 | 2 {
  return axis === "y" ? 1 : 2;
}

/**
 * Blue (low) → green (mid) → red (high), t ∈ [0, 1].
 * Piecewise linear through B→G and G→R.
 */
export function scalarToBlueGreenRed(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  if (x < 0.5) {
    const u = x * 2;
    const b = 1 - u;
    const g = u;
    return [0, g, b];
  }
  const u = (x - 0.5) * 2;
  const g = 1 - u;
  const r = u;
  return [r, g, 0];
}

export function computeAxisRange(
  positions: Float32Array,
  vertexCount: number,
  axis: 1 | 2
): { min: number; max: number } {
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const v = positions[i * 3 + axis];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const span = maxV - minV;
  if (span < 1e-10) {
    return { min: minV - 0.5, max: maxV + 0.5 };
  }
  return { min: minV, max: maxV };
}

/**
 * Writes linear RGB [0,1] per vertex using a fixed min/max range (stable during animations).
 */
export function fillColorsFromAxisRange(
  positions: Float32Array,
  vertexCount: number,
  axis: 1 | 2,
  min: number,
  max: number,
  outRgb: Float32Array
): void {
  const range = Math.max(max - min, 1e-8);
  for (let i = 0; i < vertexCount; i++) {
    const v = positions[i * 3 + axis];
    const t = Math.min(1, Math.max(0, (v - min) / range));
    const [r, g, b] = scalarToBlueGreenRed(t);
    const o = i * 3;
    outRgb[o] = r;
    outRgb[o + 1] = g;
    outRgb[o + 2] = b;
  }
}

/**
 * Vertex colors from height on mesh geometry (uses each vertex position for min/max).
 */
export function applyHeatmapToBufferGeometry(geometry: THREE.BufferGeometry, axis: HeatmapAxis): void {
  const pos = geometry.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return;
  const n = pos.count;
  const arr = pos.array as Float32Array;
  const ax = heatmapAxisComponent(axis);
  const { min, max } = computeAxisRange(arr, n, ax);
  const colors = new Float32Array(n * 3);
  fillColorsFromAxisRange(arr, n, ax, min, max, colors);
  const prev = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (prev) geometry.deleteAttribute("color");
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

export function removeVertexColors(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute("color")) geometry.deleteAttribute("color");
}

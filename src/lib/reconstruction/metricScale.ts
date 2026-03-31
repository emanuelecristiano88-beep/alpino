import type { PointCloud } from "./types";

/**
 * Applica scala metrica reale alla nuvola (es. fattore da ArUco / foglio A4: px→mm noti).
 * La pipeline base usa mm **relativi** (near/far depth); questo allinea a mm assoluti misurati.
 *
 * @param scale Moltiplicatore uniforme (es. `pixelsPerMmCalibrated / pixelsPerMmNominal`).
 */
export function applyMetricScaleToPointCloud(cloud: PointCloud, scale: number): PointCloud {
  if (scale === 1 || !Number.isFinite(scale)) return cloud;
  const n = cloud.positions.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = cloud.positions[i] * scale;
  }
  return {
    positions: out,
    colors: cloud.colors,
    pointCount: cloud.pointCount,
  };
}

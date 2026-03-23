import type { PointCloud } from "@/lib/reconstruction/types";

/**
 * Uniform index downsample (keeps endpoints). O(1) per output point.
 * Returns the same reference if already under the cap.
 */
export function downsamplePointCloud(cloud: PointCloud, maxPoints: number): PointCloud {
  const n = cloud.pointCount;
  if (n <= maxPoints || maxPoints < 1) return cloud;

  const outCount = Math.min(maxPoints, n);
  const positions = new Float32Array(outCount * 3);
  const colors = cloud.colors ? new Uint8Array(outCount * 3) : undefined;

  if (outCount === 1) {
    positions[0] = cloud.positions[0];
    positions[1] = cloud.positions[1];
    positions[2] = cloud.positions[2];
    if (colors && cloud.colors) {
      colors[0] = cloud.colors[0];
      colors[1] = cloud.colors[1];
      colors[2] = cloud.colors[2];
    }
    return { positions, colors, pointCount: 1 };
  }

  const last = n - 1;
  const denom = outCount - 1;
  for (let i = 0; i < outCount; i++) {
    const src = Math.floor((i * last) / denom);
    const so = src * 3;
    const doo = i * 3;
    positions[doo] = cloud.positions[so];
    positions[doo + 1] = cloud.positions[so + 1];
    positions[doo + 2] = cloud.positions[so + 2];
    if (colors && cloud.colors) {
      colors[doo] = cloud.colors[so];
      colors[doo + 1] = cloud.colors[so + 1];
      colors[doo + 2] = cloud.colors[so + 2];
    }
  }

  return { positions, colors, pointCount: outCount };
}

import type { PointCloud, Vec3 } from "./types";

export type AxisAlignedBoundingBox = {
  min: Vec3;
  max: Vec3;
};

export function computeBoundingBox(positions: Float32Array, count: number): AxisAlignedBoundingBox {
  if (count === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

export function computeBoundingBoxFromPointCloud(cloud: PointCloud): AxisAlignedBoundingBox {
  return computeBoundingBox(cloud.positions, cloud.pointCount);
}

/**
 * Lunghezza / larghezza / altezza come tre dimensioni assi ordinate (maggiore = lunghezza tipica piede).
 */
export function computeFootDimensionsMm(min: Vec3, max: Vec3): {
  length: number;
  width: number;
  height: number;
} {
  const dx = Math.max(0, max.x - min.x);
  const dy = Math.max(0, max.y - min.y);
  const dz = Math.max(0, max.z - min.z);
  const dims = [dx, dy, dz].sort((a, b) => b - a);
  return { length: dims[0], width: dims[1], height: dims[2] };
}

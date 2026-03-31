import type { PointCloud } from "./types";

/** PLY ASCII minimale (vertex only, xyz + rgb). */
export function pointCloudToPlyAscii(cloud: PointCloud): string {
  const n = cloud.pointCount;
  const pos = cloud.positions;
  const col = cloud.colors;
  const lines: string[] = [];
  lines.push("ply");
  lines.push("format ascii 1.0");
  lines.push(`element vertex ${n}`);
  lines.push("property float x");
  lines.push("property float y");
  lines.push("property float z");
  if (col && col.length >= n * 3) {
    lines.push("property uchar red");
    lines.push("property uchar green");
    lines.push("property uchar blue");
  }
  lines.push("end_header");
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = pos[o];
    const y = pos[o + 1];
    const z = pos[o + 2];
    if (col && col.length >= n * 3) {
      lines.push(`${x} ${y} ${z} ${col[o]} ${col[o + 1]} ${col[o + 2]}`);
    } else {
      lines.push(`${x} ${y} ${z}`);
    }
  }
  return lines.join("\n");
}

export function downloadPlyAscii(cloud: PointCloud, filename = "foot_pointcloud.ply"): void {
  const text = pointCloudToPlyAscii(cloud);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

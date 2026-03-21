/**
 * Geometria foglio A4 da 4 marker ArUco (centroidi) + controllo proporzioni 210:297.
 */

export type ArucoMarkerPoint = { x: number; y: number };

export type ArucoMarkerDetection = {
  id: number;
  distance?: number;
  corners: ArucoMarkerPoint[];
};

function dist(a: ArucoMarkerPoint, b: ArucoMarkerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(corners: ArucoMarkerPoint[]): ArucoMarkerPoint {
  let x = 0;
  let y = 0;
  for (const c of corners) {
    x += c.x;
    y += c.y;
  }
  const n = corners.length || 1;
  return { x: x / n, y: y / n };
}

/** Centroide marker (overlay UI su video). */
export function getMarkerCentroid(m: ArucoMarkerDetection): ArucoMarkerPoint {
  return centroid(m.corners);
}

/** Sceglie fino a 4 marker “agli angoli” del frame (per frame affollati). */
export function pickCornerMarkers(markers: ArucoMarkerDetection[], frameW: number, frameH: number): ArucoMarkerDetection[] {
  if (markers.length <= 4) return markers;

  const targets: ArucoMarkerPoint[] = [
    { x: 0, y: 0 },
    { x: frameW, y: 0 },
    { x: 0, y: frameH },
    { x: frameW, y: frameH },
  ];

  const used = new Set<number>();
  const picked: ArucoMarkerDetection[] = [];

  for (const t of targets) {
    let bestIdx = -1;
    let bestD = Infinity;
    markers.forEach((m, idx) => {
      if (used.has(idx)) return;
      const c = centroid(m.corners);
      const d = Math.hypot(c.x - t.x, c.y - t.y);
      if (d < bestD) {
        bestD = d;
        bestIdx = idx;
      }
    });
    if (bestIdx >= 0) {
      used.add(bestIdx);
      picked.push(markers[bestIdx]);
    }
  }

  return picked.length >= 4 ? picked : markers.slice(0, 4);
}

const A4_RATIO = 210 / 297;

/**
 * Usa i centroidi dei marker: ordina TL/TR/BL/BR e confronta lati medi con rapporto A4.
 */
export function scoreA4FromMarkers(markers: ArucoMarkerDetection[]): {
  count: number;
  aspect: number;
  aspectOk: boolean;
} {
  if (markers.length < 4) {
    return { count: markers.length, aspect: 0, aspectOk: false };
  }

  const four = markers.slice(0, 4);
  const centers = four.map((m) => centroid(m.corners));
  const sortedY = [...centers].sort((a, b) => a.y - b.y);
  const top = sortedY.slice(0, 2).sort((a, b) => a.x - b.x);
  const bot = sortedY.slice(2, 4).sort((a, b) => a.x - b.x);
  if (top.length < 2 || bot.length < 2) {
    return { count: four.length, aspect: 0, aspectOk: false };
  }

  const tl = top[0];
  const tr = top[1];
  const bl = bot[0];
  const br = bot[1];

  const wTop = dist(tl, tr);
  const wBot = dist(bl, br);
  const hLeft = dist(tl, bl);
  const hRight = dist(tr, br);
  const avgW = (wTop + wBot) / 2;
  const avgH = (hLeft + hRight) / 2;
  if (avgH < 1e-4 || avgW < 1e-4) {
    return { count: four.length, aspect: 0, aspectOk: false };
  }

  const aspect = Math.min(avgW, avgH) / Math.max(avgW, avgH);
  const tol = 0.2;
  const aspectOk = Math.abs(aspect - A4_RATIO) < tol;

  return { count: four.length, aspect, aspectOk };
}

/** Marker troppo grandi in pixel → telefono troppo vicino al foglio. */
export function markersDominateFrame(markers: ArucoMarkerDetection[], frameW: number, frameH: number): boolean {
  if (markers.length === 0) return false;
  const minSide = Math.min(frameW, frameH);
  let maxEdge = 0;
  for (const m of markers) {
    const c = m.corners;
    if (c.length < 4) continue;
    for (let i = 0; i < 4; i++) {
      maxEdge = Math.max(maxEdge, dist(c[i], c[(i + 1) % 4]));
    }
  }
  return maxEdge > 0.42 * minSide;
}

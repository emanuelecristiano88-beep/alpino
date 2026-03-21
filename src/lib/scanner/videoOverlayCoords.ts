/**
 * Mappa coordinate normalizzate sul frame video (0–1) → percentuali nel contenitore
 * quando il video usa `object-fit: cover` (stesso algoritmo del browser).
 */
export function normalizedVideoToContainerPercent(
  nx: number,
  ny: number,
  videoW: number,
  videoH: number,
  boxW: number,
  boxH: number
): { leftPct: number; topPct: number } {
  if (!videoW || !videoH || !boxW || !boxH) return { leftPct: 50, topPct: 50 };
  const vr = videoW / videoH;
  const br = boxW / boxH;
  let dispW: number;
  let dispH: number;
  let offsetX = 0;
  let offsetY = 0;
  if (vr > br) {
    dispH = boxH;
    dispW = (videoW / videoH) * boxH;
    offsetX = (boxW - dispW) / 2;
  } else {
    dispW = boxW;
    dispH = (videoH / videoW) * boxW;
    offsetY = (boxH - dispH) / 2;
  }
  const x = nx * dispW + offsetX;
  const y = ny * dispH + offsetY;
  return { leftPct: (x / boxW) * 100, topPct: (y / boxH) * 100 };
}

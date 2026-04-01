import * as React from "react";
import { useEffect, useMemo, useRef } from "react";
import { normalizedVideoToContainerPercent } from "../../lib/scanner/videoOverlayCoords";

type NormPoint = { x: number; y: number };

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  markerQuadsNorm: { id: number; corners: NormPoint[] }[] | null;
  visible: boolean;
};

function drawBracket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dirX: 1 | -1,
  dirY: 1 | -1,
  len: number,
  gap: number
) {
  ctx.beginPath();
  ctx.moveTo(x + dirX * gap, y);
  ctx.lineTo(x + dirX * (gap + len), y);
  ctx.moveTo(x, y + dirY * gap);
  ctx.lineTo(x, y + dirY * (gap + len));
  ctx.stroke();
}

function drawQuadOutline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length < 4) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  ctx.lineTo(pts[1].x, pts[1].y);
  ctx.lineTo(pts[2].x, pts[2].y);
  ctx.lineTo(pts[3].x, pts[3].y);
  ctx.closePath();
  ctx.stroke();
}

export default function ArucoMarkerBracketsCanvas({ videoRef, containerRef, markerQuadsNorm, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const quads = useMemo(() => (visible ? markerQuadsNorm ?? null : null), [markerQuadsNorm, visible]);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const v = videoRef.current;
      const box = containerRef.current;
      const ctx = canvas.getContext("2d");
      if (!v || !box || !ctx) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const rect = box.getBoundingClientRect();
      if (!vw || !vh || rect.width <= 2 || rect.height <= 2) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const hasQuads = !!quads?.length;
      if (!hasQuads) {
        raf = requestAnimationFrame(tick);
        return;
      }

      // "Ready" signal: neon green outlines + brackets around detected marker corners.
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(34,197,94,0.92)"; // emerald-500
      ctx.shadowColor = "rgba(34,197,94,0.35)";
      ctx.shadowBlur = 10;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const len = Math.max(10, Math.min(18, rect.width * 0.05));
      const gap = Math.max(2, Math.min(6, rect.width * 0.012));

      for (const quad of quads!) {
        const corners = (quad.corners ?? []).slice(0, 4);
        if (corners.length < 4) continue;
        const screenPts = corners.map((p) => {
          const pos = normalizedVideoToContainerPercent(p.x, p.y, vw, vh, rect.width, rect.height);
          return { x: (pos.leftPct / 100) * rect.width, y: (pos.topPct / 100) * rect.height };
        });
        drawQuadOutline(ctx, screenPts);
        for (const p of corners) {
          const pos = normalizedVideoToContainerPercent(p.x, p.y, vw, vh, rect.width, rect.height);
          const px = (pos.leftPct / 100) * rect.width;
          const py = (pos.topPct / 100) * rect.height;

          // Determine bracket direction relative to quad centroid.
          const cx = corners.reduce((s, q) => s + q.x, 0) / corners.length;
          const cy = corners.reduce((s, q) => s + q.y, 0) / corners.length;
          const dirX: 1 | -1 = p.x >= cx ? 1 : -1;
          const dirY: 1 | -1 = p.y >= cy ? 1 : -1;
          drawBracket(ctx, px, py, dirX, dirY, len, gap);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [containerRef, quads, videoRef, visible]);

  if (!visible) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[18]" aria-hidden />;
}


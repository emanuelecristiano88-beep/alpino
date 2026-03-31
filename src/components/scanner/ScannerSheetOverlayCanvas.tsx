import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { normalizedVideoToContainerPercent } from "../../lib/scanner/videoOverlayCoords";

type Point = { x: number; y: number };

type Props = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  pointsNorm: Point[];
  visible: boolean;
  tone: "red" | "yellow" | "green";
  locked: boolean;
  /** Tutti i gate scan OK (foglio + piede + movimento…): bagliore verde premium + pulse. */
  premiumReady?: boolean;
};

function drawRoundedPath(ctx: CanvasRenderingContext2D, pts: Point[], radius = 8) {
  if (pts.length < 2) return;
  if (pts.length < 3) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }

  const r = Math.max(2, radius);
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];

    const v1x = p0.x - p1.x;
    const v1y = p0.y - p1.y;
    const v2x = p2.x - p1.x;
    const v2y = p2.y - p1.y;
    const d1 = Math.hypot(v1x, v1y) || 1;
    const d2 = Math.hypot(v2x, v2y) || 1;
    const rr = Math.min(r, d1 * 0.35, d2 * 0.35);

    const p1a = { x: p1.x + (v1x / d1) * rr, y: p1.y + (v1y / d1) * rr };
    const p1b = { x: p1.x + (v2x / d2) * rr, y: p1.y + (v2y / d2) * rr };

    if (i === 0) ctx.moveTo(p1a.x, p1a.y);
    else ctx.lineTo(p1a.x, p1a.y);
    ctx.quadraticCurveTo(p1.x, p1.y, p1b.x, p1b.y);
  }
  ctx.closePath();
}

export default function ScannerSheetOverlayCanvas({
  videoRef,
  containerRef,
  pointsNorm,
  visible,
  tone,
  locked,
  premiumReady = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef<Point[]>(pointsNorm);
  useLayoutEffect(() => {
    pointsRef.current = pointsNorm;
  }, [pointsNorm]);
  const alphaRef = useRef(0);
  const toneColor = useMemo(() => {
    if (tone === "green")
      return {
        stroke: premiumReady ? "#6ee7b7" : "#34d399",
        glow: premiumReady ? "rgba(52,211,153,0.72)" : "rgba(52,211,153,0.55)",
        glowOuter: "rgba(16,185,129,0.35)",
      };
    if (tone === "yellow") return { stroke: "#fbbf24", glow: "rgba(251,191,36,0.52)", glowOuter: "rgba(251,191,36,0.2)" };
    return { stroke: "#f87171", glow: "rgba(248,113,113,0.48)", glowOuter: "rgba(248,113,113,0.15)" };
  }, [tone, premiumReady]);

  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const box = containerRef.current;
      const video = videoRef.current;
      if (!canvas || !box) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const rect = box.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        raf = requestAnimationFrame(tick);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const ptsNorm = pointsRef.current;
      const targetAlpha = ptsNorm.length >= 3 ? 1 : 0;
      alphaRef.current += (targetAlpha - alphaRef.current) * 0.16;
      if (alphaRef.current < 0.02) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const vw = video?.videoWidth || 0;
      const vh = video?.videoHeight || 0;
      if (!vw || !vh) {
        raf = requestAnimationFrame(tick);
        return;
      }

      const pts = ptsNorm.map((p) => {
        const q = normalizedVideoToContainerPercent(p.x, p.y, vw, vh, w, h);
        return { x: (q.leftPct / 100) * w, y: (q.topPct / 100) * h };
      });

      const t = performance.now() / 1000;
      const premium = premiumReady && tone === "green";
      const pulse = premium ? 1 + 0.055 * Math.sin(t * 2.2) : locked ? 1 + 0.03 * Math.sin(t * 3.2) : 1;
      const lineW = (premium ? 1.8 : locked ? 1.5 : 1.2) * pulse;

      // Outline only — no fill (keeps video fully visible).
      if (premium) {
        ctx.save();
        ctx.globalAlpha = 0.28 * alphaRef.current * (0.85 + 0.15 * Math.sin(t * 2.2));
        ctx.shadowBlur = 18 * pulse;
        ctx.shadowColor = toneColor.glowOuter ?? "rgba(16,185,129,0.4)";
        ctx.lineWidth = lineW * 1.4;
        ctx.strokeStyle = "rgba(167,243,208,0.35)";
        ctx.lineJoin = "round";
        drawRoundedPath(ctx, pts, 12);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = 0.88 * alphaRef.current;
      ctx.shadowBlur = premium ? 14 + 4 * Math.sin(t * 2.2) : locked ? 10 : 6;
      ctx.shadowColor = toneColor.glow;
      ctx.lineWidth = lineW;
      ctx.strokeStyle = toneColor.stroke;
      ctx.lineJoin = "round";
      drawRoundedPath(ctx, pts, 10);
      ctx.stroke();
      ctx.restore();

      // Tiny corner accent dots only.
      for (const p of pts) {
        ctx.save();
        ctx.globalAlpha = 0.82 * alphaRef.current;
        ctx.beginPath();
        ctx.arc(p.x, p.y, premium ? 2.8 : locked ? 2.4 : 2.0, 0, Math.PI * 2);
        ctx.fillStyle = toneColor.stroke;
        ctx.shadowBlur = premium ? 10 + 3 * Math.sin(t * 2.2) : locked ? 7 : 4;
        ctx.shadowColor = toneColor.glow;
        ctx.fill();
        ctx.restore();
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [visible, tone, locked, premiumReady, containerRef, videoRef, toneColor]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[16]" aria-hidden />;
}


/**
 * FootEraserCanvas — paints the hemisphere eraser overlay on top of the
 * live video feed.
 *
 * Layout:
 *  • 150 small red filled circles: remaining hemisphere dots
 *  • White dashed ring at screen centre: the 50 px eraser zone
 *  • Top-left pill: progress % + remaining count
 */
import React, { useEffect, useRef } from "react";
import type { ScanFrameTilt } from "@/hooks/useScanFrameOrientation";
import type { FootEraserState } from "@/hooks/useFootEraser";

const ERASER_RADIUS_PX = 50;
const DOT_RADIUS = 4;

interface Props {
  eraser: FootEraserState;
  tiltRef: React.MutableRefObject<ScanFrameTilt>;
  visible: boolean;
}

export function FootEraserCanvas({ eraser, tiltRef, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // Keep canvas sized to container
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);

      // Run tick → project dots + consume those near centre
      const dots = eraser.tick(tiltRef.current, w, h);

      const cx = w / 2;
      const cy = h / 2;

      // ── Eraser ring (dashed white circle at screen centre) ─────────────
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(cx, cy, ERASER_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── Red dots ─────────────────────────────────────────────────────────
      ctx.fillStyle = "rgba(220, 38, 38, 0.88)"; // Tailwind red-600
      for (const dot of dots) {
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Progress pill (top-left) ──────────────────────────────────────
      const pct = eraser.progress;
      const label = `${pct}%  (${eraser.remaining.length} rimasti)`;
      const PILL_X = 12;
      const PILL_Y = 14;
      ctx.save();
      ctx.font = "bold 13px ui-monospace, monospace";
      const tw = ctx.measureText(label).width;
      const PH = 22;
      const PW = tw + 20;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.roundRect(PILL_X, PILL_Y, PW, PH, 5);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, PILL_X + 10, PILL_Y + 15);
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(rafRef.current);
  }, [visible, eraser, tiltRef]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 25,
      }}
    />
  );
}

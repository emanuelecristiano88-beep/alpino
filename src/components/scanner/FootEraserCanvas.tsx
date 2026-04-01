/**
 * FootEraserCanvas — hemisphere eraser overlay rendered on top of the
 * live video feed.
 *
 * Drawing order each frame:
 *  1. Outer scanning ring (90 px) — dashed amber ring, "warm-up zone".
 *  2. Inner eraser ring  (50 px) — dashed white ring, "consume zone".
 *  3. Idle dots     — small red filled circles.
 *  4. Scanning dots — amber filled circles with a soft outer glow.
 *  5. Dying particles — rose circles shrinking + fading over 200 ms.
 */
import React, { useEffect, useRef } from "react";
import type { ScanFrameTilt } from "@/hooks/useScanFrameOrientation";
import type { FootEraserState } from "@/hooks/useFootEraser";

// ─── Visual constants ─────────────────────────────────────────────────────────

const DONE_RADIUS_PX   = 50;
const SCAN_RADIUS_PX   = 90;
const DOT_RADIUS_IDLE  = 4;
const DOT_RADIUS_SCAN  = 5.5;
const DYING_DURATION_MS = 200;

const COLOR_IDLE    = "rgba(220, 38, 38, 0.88)";       // red-600
const COLOR_SCAN    = "rgba(251, 191, 36, 0.95)";       // amber-400
const COLOR_SCAN_GLOW = "rgba(251, 191, 36, 0.25)";
const COLOR_DYING   = "rgba(251, 113, 133, 1)";         // rose-400

// ─── Types ────────────────────────────────────────────────────────────────────

interface DyingParticle {
  id: number;
  sx: number;
  sy: number;
  diedAt: number; // performance.now() timestamp
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  eraser: FootEraserState;
  tiltRef: React.MutableRefObject<ScanFrameTilt>;
  visible: boolean;
}

export function FootEraserCanvas({ eraser, tiltRef, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const dyingRef  = useRef<DyingParticle[]>([]);

  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(rafRef.current);
      dyingRef.current = [];
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) { rafRef.current = requestAnimationFrame(draw); return; }

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
      }

      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const cx  = w / 2;
      const cy  = h / 2;

      // ── 1. Tick: project + detect consumption ─────────────────────────────
      const { live, consumed } = eraser.tick(tiltRef.current, w, h);

      for (const c of consumed) {
        dyingRef.current.push({ id: c.id, sx: c.sx, sy: c.sy, diedAt: now });
      }
      dyingRef.current = dyingRef.current.filter(
        (p) => now - p.diedAt < DYING_DURATION_MS,
      );

      // ── 2. Outer scanning ring ────────────────────────────────────────────
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.lineWidth   = 1;
      ctx.strokeStyle = "rgba(251, 191, 36, 0.30)"; // faint amber
      ctx.beginPath();
      ctx.arc(cx, cy, SCAN_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── 3. Inner eraser ring ──────────────────────────────────────────────
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth   = 1.5;
      ctx.strokeStyle = "rgba(255,255,255,0.50)";
      ctx.beginPath();
      ctx.arc(cx, cy, DONE_RADIUS_PX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // ── 4a. Idle dots (red) ───────────────────────────────────────────────
      ctx.fillStyle = COLOR_IDLE;
      for (const dot of live) {
        if (dot.status !== "idle") continue;
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_RADIUS_IDLE, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 4b. Scanning dots (amber + soft glow) ────────────────────────────
      for (const dot of live) {
        if (dot.status !== "scanning") continue;

        // Glow halo
        ctx.save();
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_RADIUS_SCAN + 5, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_SCAN_GLOW;
        ctx.fill();
        ctx.restore();

        // Core dot
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_RADIUS_SCAN, 0, Math.PI * 2);
        ctx.fillStyle = COLOR_SCAN;
        ctx.fill();
      }

      // ── 5. Dying particles: fade + shrink ────────────────────────────────
      for (const p of dyingRef.current) {
        const elapsed = now - p.diedAt;
        const t       = 1 - elapsed / DYING_DURATION_MS; // 1 → 0
        const eased   = t * t;                            // ease-in-quad

        ctx.save();
        ctx.globalAlpha = eased;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, eased * (DOT_RADIUS_IDLE + 4), 0, Math.PI * 2);
        ctx.fillStyle = COLOR_DYING;
        ctx.fill();
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [visible, eraser, tiltRef]);

  if (!visible) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
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

/**
 * FootEraserCanvas — hemisphere eraser overlay rendered on top of the
 * live video feed.
 *
 * ── Mirino (targeting reticle) ──────────────────────────────────────────────
 *   Radius 60 px at screen centre.  Any dome point whose 2D projection enters
 *   this radius transitions to status:'done' → navigator.vibrate(10).
 *   Visual: thin circle + 4 inward tick marks + center dot (optical viewfinder
 *   style, Starlink-inverted aesthetic).
 *
 * ── Projection strategy ──────────────────────────────────────────────────────
 *   PRIMARY  (≥ 4 ArUco markers) — estimatePoseFromQuads + projectPoint3D.
 *     Dots follow the A4 sheet exactly as the phone moves.
 *   FALLBACK (0–3 markers)       — dots hidden after HIDE_AFTER_LOST_MS.
 *     Prevents "flying dots" artefact on tracking loss.
 *
 * ── Debug overlay ────────────────────────────────────────────────────────────
 *   Always-on translucent box at bottom-left: FPS (measured in RAF), marker
 *   count, tracking status.  Requested by Emanuele; never removed.
 */
import React, { useEffect, useRef } from "react";
import type { OpenCvArucoQuad } from "@/hooks/useOpenCvArucoAnalysis";
import type { FootEraserState } from "@/hooks/useFootEraser";
import type { ScanFrameTilt } from "@/hooks/useScanFrameOrientation";
import {
  estimateCameraIntrinsics,
  estimatePoseFromQuads,
  projectDomePoints,
} from "@/lib/aruco/poseEstimation";

// ─── Visual constants ─────────────────────────────────────────────────────────

/** Inner "Mirino" zone: points here become 'done' → vibrate(10). */
const MIRINO_RADIUS_PX  = 60;
/** Outer warm-up zone: points here become 'scanning' (amber). */
const SCAN_RADIUS_PX    = 110;

const DOT_R_IDLE  = 4.5;
const DOT_R_SCAN  = 6;
const DYING_MS    = 220;

// Mirino geometry
const TICK_LEN    = 14;   // px, inward tick arm length
const TICK_GAP    = 6;    // px, gap between circle and tick start
const CENTER_DOT  = 2.5;  // px, center dot radius

// Colours — Apple / SF aesthetic
const C_IDLE     = "rgba(255, 255, 255, 0.65)";
const C_SCAN     = "rgba(251, 191, 36,  0.92)";
const C_SCAN_GLOW= "rgba(251, 191, 36,  0.22)";
const C_DYING    = "rgba(255, 255, 255, 1)";
const C_MIRINO   = "rgba(255, 255, 255, 0.80)";
const C_MIRINO_LO= "rgba(255, 255, 255, 0.30)"; // dim when tracking lost

// How long (ms) without ≥ 4 markers before hiding dome dots
const HIDE_AFTER_LOST_MS = 450;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DyingParticle { id: number; sx: number; sy: number; diedAt: number; }
interface FpsClock { lastAt: number; fps: number; framesSince: number; lastCalcAt: number; }

// ─── Mirino draw helper ───────────────────────────────────────────────────────

/**
 * Draws the optical viewfinder reticle:
 *   – Full circle of given radius
 *   – 4 inward tick marks at cardinal points (12 / 3 / 6 / 9 o'clock)
 *   – Small center dot
 */
function drawMirino(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = 1.6;
  ctx.lineCap     = "round";

  // Outer circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // 4 inward tick marks at 0°, 90°, 180°, 270°
  const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (const a of angles) {
    const outer = radius - TICK_GAP;
    const inner = outer - TICK_LEN;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.stroke();
  }

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, CENTER_DOT, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ─── Debug box draw helper ────────────────────────────────────────────────────

function drawDebugBox(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  fps: number,
  markerCount: number,
  trackingOk: boolean,
  consumed: number,
) {
  const PAD   = 10;
  const FONT  = "12px ui-monospace, monospace";
  const LINE  = 17;

  ctx.save();
  ctx.font = FONT;

  const lines = [
    `FPS: ${fps.toFixed(1)}`,
    `MARKERS: ${markerCount}`,
    `TRACKING: ${trackingOk ? "● LIVE" : "○ LOST"}`,
    `SCANNED: ${consumed}/150`,
  ];

  const maxW  = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW  = maxW + PAD * 2;
  const boxH  = lines.length * LINE + PAD * 2;

  // Safe-area aware bottom-left position
  const safeBot = 24 + Math.max(0, (window.screen?.height ?? 0) > 800 ? 12 : 0);
  const bx = 10;
  const by = canvasH - boxH - safeBot;

  // Background pill
  ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
  ctx.beginPath();
  // @ts-ignore — roundRect is available in modern browsers
  ctx.roundRect(bx, by, boxW, boxH, 8);
  ctx.fill();

  // Text
  ctx.fillStyle = trackingOk ? "rgba(255,255,255,0.85)" : "rgba(255,200,100,0.85)";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], bx + PAD, by + PAD + (i + 0.8) * LINE);
  }

  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  eraser: FootEraserState;
  /** Kept for tilt-fallback API compatibility. */
  tiltRef: React.MutableRefObject<ScanFrameTilt>;
  markerQuads: OpenCvArucoQuad[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
  visible: boolean;
}

export function FootEraserCanvas({
  eraser,
  tiltRef: _tiltRef,
  markerQuads,
  videoRef,
  containerRef,
  visible,
}: Props) {
  const canvasRef          = useRef<HTMLCanvasElement>(null);
  const rafRef             = useRef<number>(0);
  const dyingRef           = useRef<DyingParticle[]>([]);
  const lastSeenMarkersRef = useRef<number>(0);
  const quadsRef           = useRef<OpenCvArucoQuad[]>(markerQuads);
  const fpsRef             = useRef<FpsClock>({ lastAt: 0, fps: 0, framesSince: 0, lastCalcAt: 0 });

  useEffect(() => { quadsRef.current = markerQuads; }, [markerQuads]);

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

    const draw = (rafTime: number) => {
      const parent = containerRef.current ?? canvas.parentElement;
      if (!parent) { rafRef.current = requestAnimationFrame(draw); return; }

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
      }
      if (w === 0 || h === 0) { rafRef.current = requestAnimationFrame(draw); return; }

      // FPS calculation (update every ~500 ms to avoid jitter)
      const clk = fpsRef.current;
      clk.framesSince++;
      const elapsed = rafTime - clk.lastCalcAt;
      if (elapsed >= 500) {
        clk.fps       = (clk.framesSince / elapsed) * 1000;
        clk.framesSince = 0;
        clk.lastCalcAt  = rafTime;
      }

      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const cx  = w / 2;
      const cy  = h / 2;

      // ── 1. ArUco tracking state ────────────────────────────────────────────
      const quads  = quadsRef.current;
      const video  = videoRef.current;
      const videoW = video?.videoWidth  ?? 0;
      const videoH = video?.videoHeight ?? 0;
      const hasTracking = quads.length >= 4 && videoW > 0 && videoH > 0;

      if (hasTracking) lastSeenMarkersRef.current = now;
      const trackingAge = now - lastSeenMarkersRef.current;
      const trackingOk  = trackingAge < HIDE_AFTER_LOST_MS;

      // ── 2. Project dome points (only when tracking) ───────────────────────
      let projectedAll: { id: number; sx: number; sy: number }[] = [];
      if (trackingOk) {
        const K    = estimateCameraIntrinsics(w, h);
        const pose = hasTracking
          ? estimatePoseFromQuads(quads, videoW, videoH, w, h, K)
          : null;
        if (pose) {
          projectedAll = projectDomePoints(eraser.remainingPoints, pose, K, w, h);
        }
      }

      // ── 3. Classify dots: done / scanning / idle ──────────────────────────
      const doneIds:  number[]              = [];
      const scanIds:  number[]              = [];
      const idleDots: typeof projectedAll   = [];
      const scanDots: typeof projectedAll   = [];

      for (const dot of projectedAll) {
        const d2 = (dot.sx - cx) ** 2 + (dot.sy - cy) ** 2;
        if (d2 <= MIRINO_RADIUS_PX ** 2) {
          doneIds.push(dot.id);
          // Queue dying animation before consuming
          if (!dyingRef.current.some((d) => d.id === dot.id)) {
            dyingRef.current.push({ id: dot.id, sx: dot.sx, sy: dot.sy, diedAt: now });
          }
        } else if (d2 <= SCAN_RADIUS_PX ** 2) {
          scanIds.push(dot.id);
          scanDots.push(dot);
        } else {
          idleDots.push(dot);
        }
      }

      // Consume: vibrate(10) fires inside eraser.consume for new doneIds
      if (doneIds.length > 0 || scanIds.length > 0) {
        eraser.consume(doneIds, scanIds);
      }

      // Evict expired dying particles
      dyingRef.current = dyingRef.current.filter((p) => now - p.diedAt < DYING_MS);

      // ── 4. Draw outer scanning ring (faint amber) ─────────────────────────
      if (trackingOk) {
        ctx.save();
        ctx.setLineDash([7, 6]);
        ctx.lineWidth   = 1;
        ctx.strokeStyle = "rgba(251, 191, 36, 0.18)";
        ctx.beginPath();
        ctx.arc(cx, cy, SCAN_RADIUS_PX, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ── 5. Idle dots — white translucent ─────────────────────────────────
      ctx.fillStyle = C_IDLE;
      for (const dot of idleDots) {
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_IDLE, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 6. Scanning dots — amber + glow ──────────────────────────────────
      for (const dot of scanDots) {
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_SCAN + 5, 0, Math.PI * 2);
        ctx.fillStyle = C_SCAN_GLOW;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_SCAN, 0, Math.PI * 2);
        ctx.fillStyle = C_SCAN;
        ctx.fill();
      }

      // ── 7. Dying particles — white shrink + fade ──────────────────────────
      for (const p of dyingRef.current) {
        const t     = 1 - (now - p.diedAt) / DYING_MS;
        const eased = t * t;
        ctx.save();
        ctx.globalAlpha = eased;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, eased * (DOT_R_IDLE + 5), 0, Math.PI * 2);
        ctx.fillStyle = C_DYING;
        ctx.fill();
        ctx.restore();
      }

      // ── 8. Mirino (targeting reticle) — always visible ───────────────────
      drawMirino(ctx, cx, cy, MIRINO_RADIUS_PX, trackingOk ? C_MIRINO : C_MIRINO_LO);

      // ── 9. Debug box — bottom-left, always on ────────────────────────────
      drawDebugBox(
        ctx, w, h,
        clk.fps,
        quads.length,
        trackingOk,
        eraser.totalConsumed,
      );

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, eraser, containerRef, videoRef]);

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

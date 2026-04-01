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
const DYING_MS    = 250;

// Mirino geometry
const TICK_LEN    = 14;   // px, inward tick arm length
const TICK_GAP    = 6;    // px, gap between circle and tick start
const CENTER_DOT  = 2.5;  // px, center dot radius

// Colours — Apple / SF aesthetic
const C_IDLE     = "rgba(255, 255, 255, 0.65)";
const C_SCAN     = "rgba(251, 191, 36,  0.92)";
const C_SCAN_GLOW= "rgba(251, 191, 36,  0.22)";
const C_DYING    = "rgba(255, 255, 255, 1)";
const C_MIRINO       = "rgba(255, 255, 255, 0.80)";
const C_MIRINO_GHOST = "rgba(255, 255, 255, 0.52)"; // dimmed during ghost window
const C_MIRINO_LO    = "rgba(255, 255, 255, 0.28)"; // very dim when fully lost

/**
 * After tracking loss, keep the last smoothed pose and continue projecting
 * dots at their ghost position for this many milliseconds.
 * At 500 ms the dome disappears so the user knows tracking is gone.
 */
const GHOST_MS = 500;

/**
 * EMA blending factor: weight of the *new* raw pose each frame.
 * 0 = frozen, 1 = no smoothing.
 * 0.40 → ~2.5-frame lag at 30 fps (≈ 83 ms) — smooth without feeling sluggish.
 */
const SMOOTH_ALPHA = 0.40;

// ─── Math helpers ─────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];

/**
 * Re-orthonormalize a 3×3 rotation matrix stored row-major after EMA blending.
 *
 * EMA averaging of R matrix elements produces a matrix that is no longer
 * exactly orthonormal (columns may not be unit vectors / mutually perpendicular).
 * Gram-Schmidt on the first two columns restores the SO(3) constraint, keeping
 * the result numerically valid for projection.
 *
 * Layout: R[row*3 + col], columns = world-X, world-Y, world-Z in camera space.
 */
function orthonormalize(R: number[]): number[] {
  // Extract first two columns
  const c0: Vec3 = [R[0], R[3], R[6]];
  const c1: Vec3 = [R[1], R[4], R[7]];

  // Gram-Schmidt step 1: normalize c0
  const n0 = Math.sqrt(c0[0] ** 2 + c0[1] ** 2 + c0[2] ** 2) || 1;
  const nc0: Vec3 = [c0[0] / n0, c0[1] / n0, c0[2] / n0];

  // Gram-Schmidt step 2: remove nc0 component from c1, then normalize
  const dot = c1[0] * nc0[0] + c1[1] * nc0[1] + c1[2] * nc0[2];
  const c1o: Vec3 = [c1[0] - dot * nc0[0], c1[1] - dot * nc0[1], c1[2] - dot * nc0[2]];
  const n1 = Math.sqrt(c1o[0] ** 2 + c1o[1] ** 2 + c1o[2] ** 2) || 1;
  const nc1: Vec3 = [c1o[0] / n1, c1o[1] / n1, c1o[2] / n1];

  // Third column = cross(nc0, nc1) — guaranteed unit length and orthogonal
  const nc2: Vec3 = [
    nc0[1] * nc1[2] - nc0[2] * nc1[1],
    nc0[2] * nc1[0] - nc0[0] * nc1[2],
    nc0[0] * nc1[1] - nc0[1] * nc1[0],
  ];

  return [
    nc0[0], nc1[0], nc2[0],
    nc0[1], nc1[1], nc2[1],
    nc0[2], nc1[2], nc2[2],
  ];
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A point currently executing its 250 ms death animation.
 * Held in `animatingPointsRef` until the animation completes.
 */
interface AnimatingPoint { id: number; sx: number; sy: number; diedAt: number; }
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
  /** "● LIVE" | "◐ GHOST" | "○ LOST" */
  trackingLabel: string,
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
    `TRACKING: ${trackingLabel}`,
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

  // Text — amber tint when ghost/lost so the user knows tracking is degraded
  const isLive = trackingLabel.startsWith("●");
  ctx.fillStyle = isLive ? "rgba(255,255,255,0.85)" : "rgba(255,200,100,0.85)";
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
  const canvasRef             = useRef<HTMLCanvasElement>(null);
  const rafRef                = useRef<number>(0);
  /** Temporary array of points executing their 250 ms death animation. */
  const animatingPointsRef    = useRef<AnimatingPoint[]>([]);
  const lastSeenMarkersRef    = useRef<number>(0);
  /**
   * EMA-smoothed camera pose. Updated every frame with live tracking.
   * Kept stale during ghost window so dots don't jump on brief tracking loss.
   */
  const smoothedPoseRef       = useRef<import("@/lib/aruco/poseEstimation").CameraPose | null>(null);
  const quadsRef              = useRef<OpenCvArucoQuad[]>(markerQuads);
  const fpsRef                = useRef<FpsClock>({ lastAt: 0, fps: 0, framesSince: 0, lastCalcAt: 0 });

  useEffect(() => { quadsRef.current = markerQuads; }, [markerQuads]);

  useEffect(() => {
    if (!visible) {
      cancelAnimationFrame(rafRef.current);
      animatingPointsRef.current = [];
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
      const trackingAge  = now - lastSeenMarkersRef.current;
      // "live"  = markers detected this frame
      // "ghost" = lost < GHOST_MS ago → hold last pose, no new erasure
      // "lost"  = stale beyond GHOST_MS → hide dome
      const trackingLive  = hasTracking;
      const trackingGhost = !trackingLive && trackingAge < GHOST_MS;
      const trackingOk    = trackingLive || trackingGhost; // dome visible either way

      // ── 2. EMA pose smoothing ─────────────────────────────────────────────
      //
      // Every live frame: blend raw pose into smoothedPoseRef with SMOOTH_ALPHA.
      // Re-orthonormalize so R stays a valid rotation matrix after blending.
      // During ghost: reuse stale smoothedPoseRef as-is (no update).
      const K = estimateCameraIntrinsics(w, h);

      if (trackingLive) {
        const rawPose = estimatePoseFromQuads(quads, videoW, videoH, w, h, K);
        if (rawPose) {
          const prev = smoothedPoseRef.current;
          if (!prev) {
            // Cold start: accept the first pose without blending
            smoothedPoseRef.current = rawPose;
          } else {
            const α = SMOOTH_ALPHA;
            const β = 1 - α;
            // Blend R (9 elements) and t (3 elements)
            const blendedR = prev.R.map((v, i) => β * v + α * rawPose.R[i]);
            const blendedT: [number, number, number] = [
              β * prev.t[0] + α * rawPose.t[0],
              β * prev.t[1] + α * rawPose.t[1],
              β * prev.t[2] + α * rawPose.t[2],
            ];
            // Re-orthonormalize R to keep it a valid rotation matrix
            smoothedPoseRef.current = { R: orthonormalize(blendedR), t: blendedT };
          }
        }
      }

      // ── 3. Project dome points using smoothed (or ghost) pose ─────────────
      let projectedAll: { id: number; sx: number; sy: number }[] = [];
      if (trackingOk && smoothedPoseRef.current) {
        projectedAll = projectDomePoints(eraser.remainingPoints, smoothedPoseRef.current, K, w, h);
      }

      // ── 4. Classify dots: done / scanning / idle ──────────────────────────
      //
      // Erasure (mirino hit detection) only fires when tracking is LIVE.
      // During the ghost window the dome is frozen at the last known position
      // and we do not consume new points — prevents spurious captures while
      // the user is mid-movement and markers briefly disappear.
      const doneIds:  number[]              = [];
      const scanIds:  number[]              = [];
      const idleDots: typeof projectedAll   = [];
      const scanDots: typeof projectedAll   = [];

      for (const dot of projectedAll) {
        const d2 = (dot.sx - cx) ** 2 + (dot.sy - cy) ** 2;
        if (trackingLive && d2 <= MIRINO_RADIUS_PX ** 2) {
          doneIds.push(dot.id);
          // Queue in animatingPoints before consuming (supplies screen coords for animation)
          if (!animatingPointsRef.current.some((a) => a.id === dot.id)) {
            animatingPointsRef.current.push({ id: dot.id, sx: dot.sx, sy: dot.sy, diedAt: now });
          }
        } else if (trackingLive && d2 <= SCAN_RADIUS_PX ** 2) {
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

      // Evict animatingPoints whose 250 ms window has elapsed
      animatingPointsRef.current = animatingPointsRef.current.filter(
        (p) => now - p.diedAt < DYING_MS,
      );

      // ── 5. Draw outer scanning ring (faint amber) ─────────────────────────
      if (trackingLive) {  // only when markers are present — ghost mode hides the guide ring
        ctx.save();
        ctx.setLineDash([7, 6]);
        ctx.lineWidth   = 1;
        ctx.strokeStyle = "rgba(251, 191, 36, 0.18)";
        ctx.beginPath();
        ctx.arc(cx, cy, SCAN_RADIUS_PX, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ── 6. Idle dots — white translucent ─────────────────────────────────
      ctx.fillStyle = C_IDLE;
      for (const dot of idleDots) {
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_IDLE, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 7. Scanning dots — amber + glow ──────────────────────────────────
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

      // ── 8. animatingPoints — ease-out contraction + fade (250 ms) ────────
      //
      // t = 1 → 0 as the point ages toward its death.
      //
      // Scale uses t² (quadratic ease-out): derivative = 2t, so at t=1 the
      // radius shrinks FAST (rate = 2·DOT_R_IDLE px/unit) and decelerates
      // smoothly to a standstill at t = 0.
      //
      // Opacity uses t³ (cubic ease-out): fades quickly at first, nearly
      // invisible well before the scale reaches zero — the point "evaporates".
      for (const p of animatingPointsRef.current) {
        // progress: 0 (just consumed) → 1 (animation complete)
        const progress = Math.min(1, (now - p.diedAt) / DYING_MS);
        // t: 1 → 0 (remaining life fraction)
        const t = 1 - progress;

        // ease-out scale: fast initial contraction, decelerates near 0
        const scaledR = DOT_R_IDLE * t * t;          // t² → quadratic ease-out
        // ease-out opacity: point vanishes faster than it contracts
        const alpha   = t * t * t;                    // t³ → cubic ease-out

        if (scaledR < 0.15 || alpha < 0.01) continue; // skip nearly invisible

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, scaledR, 0, Math.PI * 2);
        ctx.fillStyle = C_DYING;
        ctx.fill();
        ctx.restore();
      }

      // ── 9. Mirino (targeting reticle) — always visible ───────────────────
      //   LIVE  → full white (C_MIRINO)
      //   GHOST → half-dim (C_MIRINO_GHOST) — dots frozen, no new erasure
      //   LOST  → very dim (C_MIRINO_LO)
      const mirinoColor = trackingLive
        ? C_MIRINO
        : trackingGhost
          ? C_MIRINO_GHOST
          : C_MIRINO_LO;
      drawMirino(ctx, cx, cy, MIRINO_RADIUS_PX, mirinoColor);

      // ── 10. Debug box — bottom-left, always on ────────────────────────────
      const trackingLabel = trackingLive
        ? "● LIVE"
        : trackingGhost
          ? "◐ GHOST"
          : "○ LOST";
      drawDebugBox(
        ctx, w, h,
        clk.fps,
        quads.length,
        trackingLabel,
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

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
  projectPoint3D,
  computeCameraWorldPos,
  type ObservationData,
  type CameraPose,
  type CameraIntrinsics,
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

// ─── Guidance thresholds ──────────────────────────────────────────────────────

/** Camera-to-sheet distance (metres) above which "Avvicinati al piede" appears. */
const DIST_TOO_FAR_M = 0.50;
/** EMA camera speed (m/s) above which "Rallenta il movimento" appears. */
const SPEED_TOO_FAST_MS = 0.55;
/** Mean video frame luminance (0–255) below which "Più luce necessaria" appears. */
const BRIGHTNESS_LOW = 60;
/** Minimum ms the guidance message stays visible after its condition clears. */
const GUIDANCE_HOLD_MS = 1100;
/** Interval between brightness samples (ms) — sampling is expensive. */
const BRIGHTNESS_SAMPLE_INTERVAL = 2500;

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

// ─── Ghost foot wireframe ─────────────────────────────────────────────────────
//
// A minimal right-foot wireframe centred on the A4 sheet (world origin).
// Three layers:
//   GF_SOLE    — 15-point sole footprint outline at Y = 0 (ground plane)
//   GF_INSTEP  —  7-point oval at the foot's instep height (~5–7 cm)
//   GF_RIBS    — 5 vertical edges connecting SOLE → INSTEP (depth cue)
//   GF_TOES    — 5 short stubs rising from each toe tip (height cue)
//
// Coordinate system (world / A4 sheet):
//   X = long axis of the A4 sheet (heel at −X, toes at +X)
//   Z = short axis (medial / big-toe side at +Z, lateral at −Z)
//   Y = vertical (0 = sheet, up = positive)
// Units: metres.

type Pt3 = [number, number, number];

/** Sole footprint outline — 15 vertices, closed loop. */
const GF_SOLE: Pt3[] = [
  [-0.108,  0,  0.028],  //  0  heel inner (medial)
  [-0.120,  0,  0.000],  //  1  heel back
  [-0.108,  0, -0.028],  //  2  heel outer (lateral)
  [-0.060,  0, -0.044],  //  3  mid-foot outer
  [ 0.005,  0, -0.047],  //  4  arch outer
  [ 0.060,  0, -0.043],  //  5  ball outer
  [ 0.100,  0, -0.030],  //  6  5th toe base
  [ 0.118,  0, -0.016],  //  7  5th toe tip
  [ 0.128,  0,  0.000],  //  8  4th toe tip
  [ 0.125,  0,  0.018],  //  9  3rd toe tip
  [ 0.116,  0,  0.033],  // 10  2nd toe tip
  [ 0.095,  0,  0.048],  // 11  big toe tip
  [ 0.058,  0,  0.053],  // 12  ball inner (medial)
  [-0.002,  0,  0.040],  // 13  arch inner
  [-0.060,  0,  0.040],  // 14  mid-foot inner
];

/** Instep oval — 7 vertices, closed loop at foot-top height. */
const GF_INSTEP: Pt3[] = [
  [-0.092, 0.054,  0.018],  // 0  heel top medial
  [-0.102, 0.038,  0.000],  // 1  heel top back
  [-0.092, 0.054, -0.018],  // 2  heel top lateral
  [-0.032, 0.068, -0.030],  // 3  instep outer
  [ 0.038, 0.064, -0.026],  // 4  ball outer top
  [ 0.038, 0.064,  0.022],  // 5  ball inner top
  [-0.032, 0.068,  0.030],  // 6  instep inner
];

/** Vertical rib pairs [sole index, instep index]. */
const GF_RIBS: [number, number][] = [
  [1, 1],   // heel back
  [3, 3],   // mid outer
  [12, 5],  // ball inner
  [14, 6],  // mid inner
  [0, 0],   // heel inner
];

/** Toe stubs: [ground base, elevated tip]. One per digit, lateral → medial. */
const GF_TOES: [Pt3, Pt3][] = [
  [[ 0.118, 0, -0.016], [ 0.118, 0.016, -0.016]],  // 5th
  [[ 0.128, 0,  0.000], [ 0.128, 0.019,  0.000]],  // 4th
  [[ 0.125, 0,  0.018], [ 0.125, 0.021,  0.018]],  // 3rd
  [[ 0.116, 0,  0.033], [ 0.116, 0.021,  0.033]],  // 2nd
  [[ 0.095, 0,  0.048], [ 0.095, 0.026,  0.048]],  // big toe
];

/**
 * Draw the ghost foot wireframe onto the canvas.
 *
 * All vertices are projected with the current pose, so the foot stays
 * locked to the A4 sheet as the phone moves.  Each segment is drawn
 * independently — a single behind-camera vertex skips only that edge,
 * not the whole outline.
 *
 * Visual style: ice-blue tint at globalAlpha = 0.20 (unobtrusive).
 */
function drawGhostFoot(
  ctx: CanvasRenderingContext2D,
  pose: CameraPose,
  K: CameraIntrinsics,
) {
  const proj = (p: Pt3) => projectPoint3D(p, pose, K);

  /** Draw a closed polygon segment-by-segment; skips behind-camera edges. */
  const drawLoop = (pts: Pt3[]) => {
    for (let i = 0; i < pts.length; i++) {
      const a = proj(pts[i]);
      const b = proj(pts[(i + 1) % pts.length]);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  };

  /** Draw a single straight edge. */
  const drawEdge = (p1: Pt3, p2: Pt3) => {
    const a = proj(p1);
    const b = proj(p2);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };

  ctx.save();
  ctx.globalAlpha = 0.20;
  ctx.strokeStyle = "rgba(190, 228, 255, 1)"; // ice-blue tint (Starlink palette)
  ctx.lineWidth   = 1.4;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";

  drawLoop(GF_SOLE);    // sole footprint
  drawLoop(GF_INSTEP);  // instep oval

  for (const [si, ii] of GF_RIBS) {
    drawEdge(GF_SOLE[si], GF_INSTEP[ii]);
  }

  for (const [base, tip] of GF_TOES) {
    drawEdge(base, tip);
  }

  // Origin cross — small + marker at A4 centre for alignment reference
  const O = proj([0, 0, 0]);
  if (O) {
    const ARM = 6; // px
    ctx.globalAlpha = 0.30;
    ctx.beginPath();
    ctx.moveTo(O[0] - ARM, O[1]); ctx.lineTo(O[0] + ARM, O[1]);
    ctx.moveTo(O[0], O[1] - ARM); ctx.lineTo(O[0], O[1] + ARM);
    ctx.stroke();
  }

  ctx.restore();
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
  /**
   * Called once per dot the instant it enters the Mirino and is consumed.
   * Receives the full ObservationData (camera world position, orientation,
   * dot world position) so the parent can build a capture path for 3D reconstruction.
   */
  onPointCaptured?: (obs: ObservationData) => void;
}

export function FootEraserCanvas({
  eraser,
  tiltRef: _tiltRef,
  markerQuads,
  videoRef,
  containerRef,
  visible,
  onPointCaptured,
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
  /** Stable ref so the draw() closure always calls the latest callback. */
  const onPointCapturedRef    = useRef(onPointCaptured);
  const quadsRef              = useRef<OpenCvArucoQuad[]>(markerQuads);
  const fpsRef                = useRef<FpsClock>({ lastAt: 0, fps: 0, framesSince: 0, lastCalcAt: 0 });

  // ── Guidance state (DOM-mutated, never drives React state) ────────────────
  /** The translucent pill element shown above the mirino. */
  const guidanceDivRef         = useRef<HTMLDivElement | null>(null);
  /** Last message written to the pill (used to detect changes). */
  const lastGuidanceMsgRef     = useRef<string | null>(null);
  /** Active-until timestamp: message stays visible until this time. */
  const guidanceActiveUntilRef = useRef<{ msg: string; until: number } | null>(null);
  /** Moving-average camera speed (m/s). Decays naturally per frame. */
  const speedEmaRef            = useRef<number>(0);
  /** Previous valid camera world position (for delta speed calculation). */
  const prevCamPosRef          = useRef<[number, number, number] | null>(null);
  const prevCamTimeRef         = useRef<number>(0);
  /** Last brightness sample result. Updated every BRIGHTNESS_SAMPLE_INTERVAL ms. */
  const lightCheckRef          = useRef<{ lastAt: number; brightness: number }>({
    lastAt: 0, brightness: 255,
  });

  useEffect(() => { quadsRef.current = markerQuads; }, [markerQuads]);
  useEffect(() => { onPointCapturedRef.current = onPointCaptured; }, [onPointCaptured]);

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

      // ── 3b. Guidance metrics & message ────────────────────────────────────
      //
      // Three conditions, evaluated in priority order:
      //   1. "Più luce necessaria"  — video brightness too low (sampled every 2.5 s)
      //   2. "Avvicinati al piede"  — camera > 50 cm from A4 sheet centre
      //   3. "Rallenta il movimento"— EMA camera speed > 0.55 m/s
      //
      // Messages are written directly to a DOM div (no React state) to avoid
      // triggering re-renders from the 60 fps RAF loop.

      // 3b-i. Light check — sampled on a slow timer to keep the loop cheap
      if (video && video.videoWidth > 0 && now - lightCheckRef.current.lastAt > BRIGHTNESS_SAMPLE_INTERVAL) {
        lightCheckRef.current.lastAt = now;
        try {
          const oc  = new OffscreenCanvas(32, 24);
          const oc2 = oc.getContext("2d");
          if (oc2) {
            oc2.drawImage(video, 0, 0, 32, 24);
            const d = oc2.getImageData(0, 0, 32, 24).data;
            let sum = 0;
            for (let k = 0; k < d.length; k += 4) {
              // Rec. 709 luminance
              sum += 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2];
            }
            lightCheckRef.current.brightness = sum / (32 * 24);
          }
        } catch { /* OffscreenCanvas unavailable — treat as adequate light */ }
      }

      // 3b-ii. Speed EMA — natural per-frame decay so it falls off without new measurements
      speedEmaRef.current *= 0.92; // ~1 s half-life at 30 fps

      let camDist = 0;
      if (trackingLive && smoothedPoseRef.current) {
        const { t } = smoothedPoseRef.current;
        // Camera distance from A4 origin = |p_world| = |−R^T·t| = |t| (R orthonormal)
        camDist = Math.sqrt(t[0] ** 2 + t[1] ** 2 + t[2] ** 2);

        const camPos = computeCameraWorldPos(smoothedPoseRef.current.R, t);
        if (prevCamPosRef.current && prevCamTimeRef.current > 0) {
          const dt = (now - prevCamTimeRef.current) / 1000; // seconds
          if (dt > 0.001 && dt < 0.25) {
            const dx = camPos[0] - prevCamPosRef.current[0];
            const dy = camPos[1] - prevCamPosRef.current[1];
            const dz = camPos[2] - prevCamPosRef.current[2];
            const rawSpeed = Math.sqrt(dx ** 2 + dy ** 2 + dz ** 2) / dt;
            // EMA: blend toward new measurement
            speedEmaRef.current = 0.80 * speedEmaRef.current + 0.20 * rawSpeed;
          }
        }
        prevCamPosRef.current = camPos;
        prevCamTimeRef.current = now;
      } else if (!trackingOk) {
        // Full loss: reset so there's no stale spike when tracking recovers
        prevCamPosRef.current = null;
        speedEmaRef.current   = 0;
      }

      // 3b-iii. Pick the highest-priority message (null = all good)
      let suggestedGuidance: string | null = null;
      if (!eraser.isComplete) {
        if (lightCheckRef.current.brightness < BRIGHTNESS_LOW) {
          suggestedGuidance = "Più luce necessaria";
        } else if (trackingOk && camDist > DIST_TOO_FAR_M) {
          suggestedGuidance = "Avvicinati al piede";
        } else if (trackingLive && speedEmaRef.current > SPEED_TOO_FAST_MS) {
          suggestedGuidance = "Rallenta il movimento";
        }
      }

      // Extend hold window while condition is active, then keep for GUIDANCE_HOLD_MS
      if (suggestedGuidance) {
        guidanceActiveUntilRef.current = { msg: suggestedGuidance, until: now + GUIDANCE_HOLD_MS };
      }
      const shownGuidance =
        guidanceActiveUntilRef.current && now < guidanceActiveUntilRef.current.until
          ? guidanceActiveUntilRef.current.msg
          : null;

      // 3b-iv. DOM mutation — only when message changes to avoid style thrash
      if (shownGuidance !== lastGuidanceMsgRef.current) {
        const prev      = lastGuidanceMsgRef.current;
        lastGuidanceMsgRef.current = shownGuidance;
        const gdiv = guidanceDivRef.current;
        if (gdiv) {
          if (!shownGuidance) {
            // Fade out (text stays in DOM, just hidden)
            gdiv.style.opacity   = "0";
            gdiv.style.transform = "translateX(-50%) translateY(-7px)";
          } else if (!prev) {
            // Appearing from nothing: set text first, then fade in
            gdiv.textContent     = shownGuidance;
            gdiv.style.opacity   = "1";
            gdiv.style.transform = "translateX(-50%) translateY(0)";
          } else {
            // Swapping messages: fade out → change text → fade in
            gdiv.style.opacity   = "0";
            const nextMsg = shownGuidance;
            setTimeout(() => {
              if (guidanceDivRef.current === gdiv) {
                gdiv.textContent     = nextMsg;
                gdiv.style.opacity   = "1";
                gdiv.style.transform = "translateX(-50%) translateY(0)";
              }
            }, 200);
          }
        }
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

          // Queue the death animation (only once per dot)
          const alreadyAnimating = animatingPointsRef.current.some((a) => a.id === dot.id);
          if (!alreadyAnimating) {
            animatingPointsRef.current.push({ id: dot.id, sx: dot.sx, sy: dot.sy, diedAt: now });

            // ── Capture observation ─────────────────────────────────────────
            // Fire once per dot, only when we have a valid smoothed pose.
            // Camera world position and orientation are expressed in the A4
            // sheet coordinate system (Y-up, origin = A4 centre).
            const cb   = onPointCapturedRef.current;
            const pose = smoothedPoseRef.current;
            if (cb && pose) {
              const worldPt = eraser.remainingPoints.find((p) => p.id === dot.id);
              if (worldPt) {
                const { R, t } = pose;
                const cameraWorldPos = computeCameraWorldPos(R, t);
                // Camera look direction = 3rd row of R (R maps world→cam, so R^T
                // maps cam→world; the cam Z-axis [0,0,1] in world = col2 of R^T =
                // row2 of R).
                const lookDirWorld: [number, number, number] = [R[6], R[7], R[8]];

                const obs: ObservationData = {
                  dotId:                dot.id,
                  cameraWorldPos,
                  lookDirWorld,
                  cameraRotationMatrix: [...R],
                  dotWorldPos:          [worldPt.wx, worldPt.wy, worldPt.wz],
                  timestamp:            now,
                };
                cb(obs);
                console.log(
                  `Punto di osservazione salvato per il pallino ID: ${dot.id}` +
                  ` | pos=(${cameraWorldPos.map((v) => v.toFixed(3)).join(", ")})m`,
                );
              }
            }
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

      // ── 5. Ghost foot — translucent wireframe reference ──────────────────
      //
      // Rendered first (before dome dots) so dots always appear on top.
      // Visible whenever we have a valid (live or ghost) pose — helps the
      // user verify that the 3D tracking is correctly aligned to the sheet.
      if (trackingOk && smoothedPoseRef.current) {
        drawGhostFoot(ctx, smoothedPoseRef.current, K);
      }

      // ── 6. Draw outer scanning ring (faint amber) ─────────────────────────
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

      // ── 7. Idle dots — white translucent ─────────────────────────────────
      ctx.fillStyle = C_IDLE;
      for (const dot of idleDots) {
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_IDLE, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 8. Scanning dots — amber + glow ──────────────────────────────────
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

      // ── 9. animatingPoints — ease-out contraction + fade (250 ms) ────────
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

      // ── 10. Mirino (targeting reticle) — always visible ──────────────────
      //   LIVE  → full white (C_MIRINO)
      //   GHOST → half-dim (C_MIRINO_GHOST) — dots frozen, no new erasure
      //   LOST  → very dim (C_MIRINO_LO)
      const mirinoColor = trackingLive
        ? C_MIRINO
        : trackingGhost
          ? C_MIRINO_GHOST
          : C_MIRINO_LO;
      drawMirino(ctx, cx, cy, MIRINO_RADIUS_PX, mirinoColor);

      // ── 11. Debug box — bottom-left, always on ───────────────────────────
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
    <>
      {/* Main eraser overlay canvas */}
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

      {/*
       * iOS-style guidance pill — appears at 22% from top, centered.
       * Opacity and transform are mutated directly in the RAF loop (no React
       * state) for zero re-render overhead.  CSS transition handles the
       * smooth fade + subtle vertical slide.
       *
       * Starts invisible (opacity:0, slightly above resting position).
       */}
      <div
        ref={guidanceDivRef}
        aria-live="polite"
        style={{
          position: "absolute",
          top: "22%",
          left: "50%",
          transform: "translateX(-50%) translateY(-7px)",
          zIndex: 30,
          opacity: 0,
          transition:
            "opacity 360ms cubic-bezier(0.22,1,0.36,1), transform 360ms cubic-bezier(0.22,1,0.36,1)",
          // Glass pill
          background: "rgba(10, 10, 14, 0.52)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.13)",
          borderRadius: 999,
          padding: "10px 24px",
          // Typography
          fontFamily: "ui-rounded, -apple-system, BlinkMacSystemFont, sans-serif",
          fontWeight: 500,
          fontSize: 15,
          color: "rgba(255, 255, 255, 0.93)",
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          userSelect: "none",
          // Subtle text shadow for legibility over bright video
          textShadow: "0 1px 4px rgba(0,0,0,0.5)",
        }}
      />
    </>
  );
}

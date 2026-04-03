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
  estimateScaleFromPose,
  type ObservationData,
  type CameraPose,
  type CameraIntrinsics,
} from "@/lib/aruco/poseEstimation";
import { A4_SHEET_DIMS_MM } from "@/lib/aruco/sheetDimensions";

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
const C_MIRINO_BLUR  = "rgba(251, 191, 36, 0.90)";  // amber — motion-blur blocked

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

// ─── Performance tier ─────────────────────────────────────────────────────────

/**
 * Four rendering quality tiers.
 *
 *  HIGH     ≥ 24 fps — full quality (grid, glow, glass prism, all dots)
 *  MEDIUM   ≥ 18 fps — no grid, no glass prism, no scan-dot glow, 50 % dots
 *  LOW      ≥ 12 fps — only corner markers + hard dots at 33 % density
 *  CRITICAL  < 12 fps OR low battery — bare minimum: dots only at 25 % density
 *
 * ArUco tracking (JS + RAF loop) is never throttled — only visual decoration
 * is reduced so the CPU keeps up with marker detection.
 */
type PerfTier = "high" | "medium" | "low" | "critical";
const TIER_ORDER: PerfTier[] = ["critical", "low", "medium", "high"];

const TIER_HIGH_FPS      = 24;   // ≥ this → HIGH
const TIER_MEDIUM_FPS    = 18;   // ≥ this → MEDIUM
const TIER_LOW_FPS       = 12;   // ≥ this → LOW  /  < this → CRITICAL
const TIER_HYSTERESIS_MS = 3500; // ms to wait before upgrading tier
const FPS_WINDOW_SIZE    = 40;   // number of per-frame samples (~1.3 s @ 30 fps)
const LOW_BATTERY_THRESH = 0.15; // 15 % battery (not charging) → Low Power Mode

// ─── Scale EMA (precision estimation) ────────────────────────────────────────

/**
 * EMA blending factor for the scale stability tracker.
 * Lower α = longer memory, smoother but slower to react.
 * 0.10 → ~10-frame window (~330 ms at 30 fps) — enough to catch per-frame
 * marker jitter while still converging quickly after pose changes.
 */
const SCALE_EMA_ALPHA = 0.10;

/**
 * Half the A4 long side in mm.  Used as the positional reference when
 * converting scale variance to an absolute precision figure.
 *
 * Derivation:
 *   sigma_corner_px ≈ sigma_scale × A4_W_MM / 2
 *   precision_mm    = sigma_corner_px / pixPerMm
 *                   = (sigma_scale × A4_W_MM / 2) / pixPerMm
 *
 * Since sigma_scale is already expressed in px/mm, sigma_corner_px carries
 * the pixel noise introduced by the two corners bounding the long axis.
 */
const A4_HALF_W_MM = A4_SHEET_DIMS_MM.widthMm / 2; // 148.5 mm

// ─── A4 bounding-box constants ────────────────────────────────────────────────

/**
 * Pixel margin: dome dots projected this far OUTSIDE the A4 quad are clipped.
 * A small margin (12 px) prevents hard edge-pop when a dot barely crosses the
 * sheet boundary.
 */
const A4_CLIP_MARGIN_PX = 12;

/**
 * Camera lateral offset (metres from sheet centre, XZ plane) that triggers
 * the amber border warning.  At 0.18 m the outermost marker is approaching
 * the frame edge — time to nudge the user to re-centre.
 */
const LATERAL_WARN_DIST_M = 0.18;

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

// ─── Holographic foot reference ───────────────────────────────────────────────
//
// "Holographic Minimalist Foot" — four visual layers rendered via canvas:
//
//   GRID      — fine cyan grid on the A4 sheet plane (Y = 0)
//   PRISM     — ultra-thin (~0.6 px) outline of the foot volume (glass effect)
//   CLOUD     — cyan dots at all key vertices + interior cloud points
//   CORNERS   — glowing laser-targeting L-bracket markers at the 4 A4 corners
//
// All opacity values are modulated by a smooth cosine "breathing" pulse that
// oscillates between 0.20 and 0.50 every 2 seconds (ease-in-out feel).
//
// Coordinate system (world / A4 sheet):
//   X = long axis (heel at −X, toes at +X)
//   Z = short axis (medial/big-toe at +Z, lateral at −Z)
//   Y = vertical   (0 = sheet surface, up = positive)
// Units: metres.

type Pt3 = [number, number, number];

// ── Foot geometry (shared between glass prism + point cloud) ─────────────────

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

const GF_INSTEP: Pt3[] = [
  [-0.092, 0.054,  0.018],
  [-0.102, 0.038,  0.000],
  [-0.092, 0.054, -0.018],
  [-0.032, 0.068, -0.030],
  [ 0.038, 0.064, -0.026],
  [ 0.038, 0.064,  0.022],
  [-0.032, 0.068,  0.030],
];

const GF_RIBS: [number, number][] = [
  [1, 1], [3, 3], [12, 5], [14, 6], [0, 0],
];

const GF_TOES: [Pt3, Pt3][] = [
  [[ 0.118, 0, -0.016], [ 0.118, 0.016, -0.016]],
  [[ 0.128, 0,  0.000], [ 0.128, 0.019,  0.000]],
  [[ 0.125, 0,  0.018], [ 0.125, 0.021,  0.018]],
  [[ 0.116, 0,  0.033], [ 0.116, 0.021,  0.033]],
  [[ 0.095, 0,  0.048], [ 0.095, 0.026,  0.048]],
];

/** Interior mid-height points for a richer holographic point cloud. */
const GF_CLOUD_EXTRA: Pt3[] = [
  [-0.050, 0.025, -0.025],  [-0.050, 0.025,  0.022],
  [ 0.000, 0.038, -0.018],  [ 0.000, 0.038,  0.017],
  [ 0.040, 0.020, -0.022],  [ 0.040, 0.020,  0.016],
  [-0.010, 0.052,  0.000],  [ 0.020, 0.058,  0.000],
  [-0.090, 0.018,  0.000],
  [ 0.070, 0.012, -0.034],  [ 0.070, 0.012,  0.030],
  [-0.035, 0.010, -0.040],  [-0.035, 0.010,  0.038],
];

/** All 4 A4 sheet corners in world coordinates (metres). */
const GF_A4_CORNERS: Pt3[] = [
  [-0.1485, 0, -0.105],  // TL
  [ 0.1485, 0, -0.105],  // TR
  [-0.1485, 0,  0.105],  // BL
  [ 0.1485, 0,  0.105],  // BR
];

// ── Full point cloud: sole + instep + toe tips + interior ────────────────────
const GF_ALL_CLOUD: Pt3[] = [
  ...GF_SOLE,
  ...GF_INSTEP,
  ...GF_TOES.map(([, tip]) => tip),
  ...GF_CLOUD_EXTRA,
];

/**
 * Holographic foot reference — drawn each RAF frame at the current camera pose.
 *
 * @param now  performance.now() for the breathing pulse animation.
 */
function drawHolographicFoot(
  ctx: CanvasRenderingContext2D,
  pose: CameraPose,
  K: CameraIntrinsics,
  now: number,
  tier: PerfTier = "high",
) {
  // CRITICAL tier: skip the entire hologram to free the GPU for tracking
  if (tier === "critical") return;

  const proj = (p: Pt3) => projectPoint3D(p, pose, K);

  // Breathing: smooth cosine pulse 0.20 → 0.50 → 0.20 every 2 s
  const breathT     = (now / 2000) % 1;                         // 0…1 cycle
  const breathSin   = 0.5 - 0.5 * Math.cos(breathT * Math.PI * 2); // 0…1
  const breathAlpha = 0.20 + 0.30 * breathSin;                  // 0.20…0.50

  const CYAN    = "rgba(0, 210, 255, 1)";
  const CYAN_HI = "rgba(200, 248, 255, 1)";

  // ── 1. Floor grid — HIGH only (most expensive: ~70 line-strokes per frame)
  if (tier === "high") {
    ctx.save();
    ctx.strokeStyle = CYAN;
    ctx.lineWidth   = 0.5;
    ctx.globalAlpha = breathAlpha * 0.28;

    for (let x = -0.148; x <= 0.149; x += 0.030) {
      const a = proj([x, 0, -0.105]);
      const b = proj([x, 0,  0.105]);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
    for (let z = -0.105; z <= 0.106; z += 0.030) {
      const a = proj([-0.148, 0, z]);
      const b = proj([ 0.148, 0, z]);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
    ctx.restore();
  }

  // ── 2. Glass prism — HIGH + MEDIUM (thin outlines, cheaper than grid)
  if (tier === "high" || tier === "medium") {
    ctx.save();
    ctx.strokeStyle = CYAN_HI;
    ctx.lineWidth   = 0.6;
    ctx.lineCap     = "round";
    ctx.globalAlpha = breathAlpha * 0.10;

    const seg = (p1: Pt3, p2: Pt3) => {
      const a = proj(p1), b = proj(p2);
      if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    };

    for (let i = 0; i < GF_SOLE.length;   i++) seg(GF_SOLE[i],   GF_SOLE[(i + 1) % GF_SOLE.length]);
    for (let i = 0; i < GF_INSTEP.length; i++) seg(GF_INSTEP[i], GF_INSTEP[(i + 1) % GF_INSTEP.length]);
    for (const [si, ii] of GF_RIBS)            seg(GF_SOLE[si],  GF_INSTEP[ii]);

    ctx.restore();
  }

  // ── 3. Cyan point cloud — glow halo only on HIGH/MEDIUM; hard dot always
  //        LOW tier: hard dots only (no radialGradient — expensive on mobile)
  {
    const showGlow = tier === "high" || tier === "medium";
    ctx.save();
    for (const pt of GF_ALL_CLOUD) {
      const p = proj(pt);
      if (!p) continue;

      if (showGlow) {
        // Soft glow halo (radialGradient — skipped on LOW to save GPU)
        ctx.globalAlpha = breathAlpha * 0.24;
        const grd = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 7);
        grd.addColorStop(0, "rgba(0, 200, 255, 1)");
        grd.addColorStop(1, "rgba(0, 200, 255, 0)");
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill();
      }

      // Bright hard dot — always visible
      ctx.globalAlpha = breathAlpha;
      ctx.fillStyle   = CYAN_HI;
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ── 4. A4 corner laser-targeting markers ──────────────────────────────────
  // Design: radial glow + bright centre dot + L-bracket arms pointing inward
  // toward the sheet centre.  Corner brightness = breathAlpha × 1.5 (max 1).
  {
    const oProj = proj([0, 0, 0]); // sheet centre on screen (for inward direction)

    for (const corner of GF_A4_CORNERS) {
      const p = proj(corner);
      if (!p) continue;

      const ca = Math.min(1, breathAlpha * 1.5);

      ctx.save();

      // Radial glow
      ctx.globalAlpha = ca * 0.48;
      const grd = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 20);
      grd.addColorStop(0, "rgba(0, 210, 255, 0.65)");
      grd.addColorStop(1, "rgba(0, 210, 255, 0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p[0], p[1], 20, 0, Math.PI * 2); ctx.fill();

      // Bright centre dot
      ctx.globalAlpha = ca;
      ctx.fillStyle   = "rgba(230, 252, 255, 1)";
      ctx.beginPath(); ctx.arc(p[0], p[1], 3.0, 0, Math.PI * 2); ctx.fill();

      // L-bracket arms — two arms pointing inward (toward sheet centre)
      if (oProj) {
        const inX = Math.sign(oProj[0] - p[0]) || 1;  // ±1
        const inY = Math.sign(oProj[1] - p[1]) || 1;
        const GAP = 5, ARM = 14;

        ctx.strokeStyle = CYAN;
        ctx.lineWidth   = 1.6;
        ctx.lineCap     = "round";
        ctx.globalAlpha = ca;

        // Horizontal arm
        ctx.beginPath();
        ctx.moveTo(p[0] + inX * GAP, p[1]);
        ctx.lineTo(p[0] + inX * (GAP + ARM), p[1]);
        ctx.stroke();

        // Vertical arm
        ctx.beginPath();
        ctx.moveTo(p[0], p[1] + inY * GAP);
        ctx.lineTo(p[0], p[1] + inY * (GAP + ARM));
        ctx.stroke();
      }

      ctx.restore();
    }
  }
}

// ─── Height triangulation ─────────────────────────────────────────────────────

/**
 * Incremental ray-ray triangulation for foot height estimation.
 *
 * Geometry:  The A4 sheet is the Y = 0 world plane.  Each erased observation
 * carries a camera origin C and a look direction D (the camera's optical axis
 * in world space).  The ray  C + t·D  passes from outside the dome, through the
 * virtual dome surface point, continues inside the dome and would eventually
 * hit the A4 plane.  The real foot surface is somewhere along this ray between
 * the dome point and the A4 plane.
 *
 * When two rays from sufficiently different viewpoints are found, their nearest
 * points are computed (standard skew-line closest-point formula) and their
 * midpoint is taken as an estimated 3-D surface sample.  Its Y coordinate
 * (in metres) is the estimated foot height at that (X, Z) location.
 *
 * Called incrementally: each new observation is paired with all previous ones,
 * giving O(n) work per new point, O(n²/2) total.  With at most 150 dome points,
 * this is at most 11 175 pair evaluations — negligible overhead.
 *
 * Noise filters applied per pair:
 *   • Rays must not be nearly parallel   (|D1·D2| > 0.97 → skip)
 *   • Both t parameters must be positive (point in front of camera)
 *   • Residual distance between nearest points ≤ 60 mm (poor convergence guard)
 *   • Midpoint Y must be in [2 mm, 150 mm] — above sheet, plausible foot height
 *   • Midpoint (X, Z) must lie within A4 bounds (with a small margin)
 *
 * @returns The newly found maximum height in mm, or 0 if no valid pair found.
 */
function triangulateMaxHeight(
  newObs: ObservationData,
  prevObs: ObservationData[],
): number {
  // Spatial bounds (metres)
  const A4_HALF_X  = 0.157; // 297 mm / 2 + 8 mm margin
  const A4_HALF_Z  = 0.113; // 210 mm / 2 + 8 mm margin
  const MIN_H      = 0.002; // 2 mm  — virtual base-plane guard
  const MAX_H      = 0.155; // 155 mm — maximum plausible foot+shoe height
  const MAX_RESID  = 0.060; // 60 mm  — ray-ray residual quality filter

  let maxH = 0;

  const [c1x, c1y, c1z] = newObs.cameraWorldPos;
  const [d1x, d1y, d1z] = newObs.lookDirWorld;

  for (const o2 of prevObs) {
    const [c2x, c2y, c2z] = o2.cameraWorldPos;
    const [d2x, d2y, d2z] = o2.lookDirWorld;

    // Skip near-parallel rays — height poorly determined
    const dotDD = d1x * d2x + d1y * d2y + d1z * d2z;
    if (Math.abs(dotDD) > 0.970) continue;

    // Vector between ray origins
    const wx = c1x - c2x, wy2 = c1y - c2y, wz = c1z - c2z;

    // Standard skew-line nearest-point formula
    const b   = dotDD;
    const d   = d1x * wx + d1y * wy2 + d1z * wz;
    const e   = d2x * wx + d2y * wy2 + d2z * wz;
    const den = 1 - b * b;
    if (den < 1e-8) continue;

    const t1 = (b * e - d) / den;
    const t2 = (e - b * d) / den;

    // Both points must be in front of their respective cameras
    if (t1 < 0.01 || t2 < 0.01) continue;

    // Closest points on each ray
    const p1x = c1x + t1 * d1x, p1y = c1y + t1 * d1y, p1z = c1z + t1 * d1z;
    const p2x = c2x + t2 * d2x, p2y = c2y + t2 * d2y, p2z = c2z + t2 * d2z;

    // Residual (quality check — large residual = poorly converging rays)
    const rdx = p1x - p2x, rdy = p1y - p2y, rdz = p1z - p2z;
    if (rdx * rdx + rdy * rdy + rdz * rdz > MAX_RESID * MAX_RESID) continue;

    // Midpoint = estimated 3-D surface sample
    const my = (p1y + p2y) * 0.5;

    // ── Virtual base-plane guard: discard points below the A4 sheet ──────
    if (my < MIN_H || my > MAX_H) continue;

    // ── XZ bounding check: must lie over the A4 sheet ────────────────────
    const mx = (p1x + p2x) * 0.5;
    const mz = (p1z + p2z) * 0.5;
    if (Math.abs(mx) > A4_HALF_X || Math.abs(mz) > A4_HALF_Z) continue;

    const hMm = my * 1000;
    if (hMm > maxH) maxH = hMm;
  }

  return maxH;
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

// ─── A4 bounding-quad helpers ─────────────────────────────────────────────────

/**
 * Sort 4 screen-space points into clockwise visual order (screen Y-down)
 * using atan2 from the centroid.  Result is stable for any convex quad.
 */
function sortQuadCW(pts: [number, number][]): [number, number][] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [...pts].sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
}

/**
 * Test whether screen point (px, py) lies inside a convex quad whose
 * vertices are in CW order in screen-Y-down space.
 *
 * CW winding (screen Y-down):  inside ↔ cross-product of each edge vector
 * with the point vector is ≥ −margin  (positive = left / inside side).
 *
 * margin > 0 extends the quad outward so points near the border are accepted.
 */
function inQuadCW(
  px: number, py: number,
  s: [number, number][],
  margin = 0,
): boolean {
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = s[i];
    const [bx, by] = s[(i + 1) % 4];
    if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < -margin) return false;
  }
  return true;
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
  /** Current scale from pose: pixels per mm (null when tracking lost). */
  pixPerMm: number | null,
  /**
   * Estimated positional precision in mm (null during warm-up or tracking loss).
   * Color-coded: mint green ≤0.5 mm, white ≤1.5 mm, amber >1.5 mm.
   */
  precisionMm: number | null,
  /**
   * Current rendering performance tier.
   * Displayed in the debug box so Emanuele can spot thermal throttling.
   */
  tier: PerfTier,
  /**
   * Maximum foot height estimated via ray-ray triangulation (mm).
   * Null when no valid triangulation yet (< 2 observations).
   */
  maxHeightMm: number | null,
) {
  const PAD   = 10;
  const FONT  = "12px ui-monospace, monospace";
  const LINE  = 17;

  ctx.save();
  ctx.font = FONT;

  const isLive = trackingLabel.startsWith("●");
  const baseColor = isLive ? "rgba(255,255,255,0.85)" : "rgba(255,200,100,0.85)";

  // Build the precision line string + decide its colour
  let precisionLine: string;
  let precisionColor: string;
  if (precisionMm === null) {
    precisionLine  = "PRECISIONE: calibrazione…";
    precisionColor = "rgba(255,255,255,0.40)";
  } else if (precisionMm <= 0.5) {
    precisionLine  = `PRECISIONE: ±${precisionMm.toFixed(2)}mm`;
    precisionColor = "rgba(52, 211, 153, 0.95)";  // mint green — excellent
  } else if (precisionMm <= 1.5) {
    precisionLine  = `PRECISIONE: ±${precisionMm.toFixed(1)}mm`;
    precisionColor = "rgba(255,255,255,0.85)";     // white — good
  } else {
    precisionLine  = `PRECISIONE: ±${precisionMm.toFixed(1)}mm`;
    precisionColor = "rgba(251,191,36,0.95)";      // amber — degraded
  }

  // Tier label with low-power indicator
  const tierLabel =
    tier === "high"     ? "PERF: ● HIGH" :
    tier === "medium"   ? "PERF: ◑ MED"  :
    tier === "low"      ? "PERF: ◐ LOW"  :
                          "PERF: ○ CRIT";
  const tierColor =
    tier === "high"     ? "rgba(52, 211, 153, 0.95)" : // mint — full quality
    tier === "medium"   ? "rgba(255, 255, 255, 0.85)" : // white — mild throttle
    tier === "low"      ? "rgba(251, 191, 36, 0.95)"  : // amber — throttled
                          "rgba(239, 68, 68,  0.95)";   // red — critical / low power

  // Height line — color-coded by plausibility
  let heightLine:  string;
  let heightColor: string;
  if (maxHeightMm === null || maxHeightMm <= 0) {
    heightLine  = "ALTEZZA TALLONE: —";
    heightColor = "rgba(255,255,255,0.35)";
  } else if (maxHeightMm < 15) {
    heightLine  = `ALTEZZA TALLONE: ${maxHeightMm.toFixed(1)}mm ⚠`;
    heightColor = "rgba(251,191,36,0.90)"; // amber — very low, likely noisy
  } else {
    heightLine  = `ALTEZZA TALLONE: ${maxHeightMm.toFixed(1)}mm`;
    heightColor = "rgba(52, 211, 153, 0.95)"; // mint — valid measurement
  }

  const lines = [
    `FPS: ${fps.toFixed(1)}`,
    `MARKERS: ${markerCount}`,
    `TRACKING: ${trackingLabel}`,
    `SCANNED: ${consumed}/150`,
    pixPerMm !== null ? `SCALE: ${pixPerMm.toFixed(2)} px/mm` : `SCALE: —`,
    precisionLine,
    heightLine,
    tierLabel,
  ];
  const lineColors = [
    baseColor, baseColor, baseColor, baseColor, baseColor,
    precisionColor,
    heightColor,
    tierColor,
  ];

  const maxW  = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW  = maxW + PAD * 2;
  const boxH  = lines.length * LINE + PAD * 2;

  // Safe-area aware bottom-left position
  const safeBot = 24 + Math.max(0, (window.screen?.height ?? 0) > 800 ? 12 : 0);
  const bx = 10;
  const by = canvasH - boxH - safeBot;

  // Background pill — slightly taller to accommodate the extra precision row
  ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
  ctx.beginPath();
  // @ts-ignore — roundRect is available in modern browsers
  ctx.roundRect(bx, by, boxW, boxH, 8);
  ctx.fill();

  // Draw lines — each line has its own colour from lineColors
  for (let i = 0; i < lines.length; i++) {
    ctx.fillStyle = lineColors[i] ?? baseColor;
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
  /**
   * When true the Mirino reticle turns amber and point consumption is paused.
   * Driven by the parent's sharpness/speed motion-blur detector so that
   * imprecise captures (camera moving too fast or scene too blurry) are skipped.
   */
  motionBlurBlocking?: boolean;
}

export function FootEraserCanvas({
  eraser,
  tiltRef: _tiltRef,
  markerQuads,
  videoRef,
  containerRef,
  visible,
  onPointCaptured,
  motionBlurBlocking = false,
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
  /**
   * Exponential moving average of the pixel-per-mm scale (from A4 long axis).
   * Reset to 0 when component mounts; warms up over ~10 frames.
   */
  const scaleEmaRef            = useRef<number>(0);
  /**
   * EMA of the squared deviation of pixPerMm from its mean.
   * sqrt(scaleVarEmaRef) = running σ of the scale → used for precision estimate.
   */
  const scaleVarEmaRef         = useRef<number>(0);

  // ── Performance tier state ───────────────────────────────────────────────
  /** Per-frame instantaneous FPS samples used to compute median. */
  const fpsWindowRef           = useRef<number[]>([]);
  /** Current rendering tier — drives visual throttling decisions. */
  const perfTierRef            = useRef<PerfTier>("high");
  /**
   * rafTime of the last tier change.
   * Prevents thrashing: tier can only UPGRADE after TIER_HYSTERESIS_MS.
   * Downgrades are always immediate.
   */
  const tierChangedAtRef       = useRef<number>(0);
  /**
   * True when the Battery API reports ≤ 15 % and not charging.
   * In Low Power Mode the tier is capped at 'low' (or 'critical' if fps < 12).
   */
  const lowPowerRef            = useRef<boolean>(false);

  const motionBlurBlockingRef = useRef(motionBlurBlocking);

  /**
   * Local mirror of all ObservationData captured in this scan pass.
   * Used for incremental height triangulation without touching the parent's ref.
   * Reset when the eraser is reset (detected via totalConsumed reaching 0 in draw loop).
   */
  const localObsRef    = useRef<ObservationData[]>([]);
  /** Maximum foot height estimated via ray-ray triangulation, in mm. 0 = no data yet. */
  const maxHeightMmRef = useRef<number>(0);

  useEffect(() => { quadsRef.current = markerQuads; }, [markerQuads]);
  useEffect(() => { onPointCapturedRef.current = onPointCaptured; }, [onPointCaptured]);
  useEffect(() => { motionBlurBlockingRef.current = motionBlurBlocking; }, [motionBlurBlocking]);

  // ── Battery / Low Power Mode detection ───────────────────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined") return;

    // Minimal type shim — the Battery API is not yet in TypeScript's lib.dom.
    type BatMgr = {
      level: number; charging: boolean;
      addEventListener(e: string, cb: () => void): void;
      removeEventListener(e: string, cb: () => void): void;
    };
    let battery: BatMgr | null = null;

    const update = () => {
      if (!battery) return;
      const prev = lowPowerRef.current;
      const next = battery.level <= LOW_BATTERY_THRESH && !battery.charging;
      if (prev !== next) {
        lowPowerRef.current = next;
        console.log(
          `[NEUMA] Low Power Mode: ${next
            ? `ON — batteria ${(battery.level * 100).toFixed(0)} %, non in carica`
            : "OFF"}`,
        );
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).getBattery?.()
      .then((b: BatMgr) => {
        battery = b;
        update();
        b.addEventListener("levelchange",   update);
        b.addEventListener("chargingchange", update);
      })
      .catch(() => { /* getBattery not supported — leave lowPowerRef = false */ });

    return () => {
      battery?.removeEventListener("levelchange",   update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, []); // run once on mount

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

      // ── Scan-reset detection — clear local triangulation state ───────────
      // eraser.totalConsumed going back to 0 means the user pressed "Rifai".
      if (eraser.totalConsumed === 0 && localObsRef.current.length > 0) {
        localObsRef.current    = [];
        maxHeightMmRef.current = 0;
      }
      if (w === 0 || h === 0) { rafRef.current = requestAnimationFrame(draw); return; }

      // ── FPS calculation + performance tier ─────────────────────────────
      const clk = fpsRef.current;
      clk.framesSince++;
      const elapsed = rafTime - clk.lastCalcAt;
      if (elapsed >= 500) {
        clk.fps       = (clk.framesSince / elapsed) * 1000;
        clk.framesSince = 0;
        clk.lastCalcAt  = rafTime;
      }

      // Per-frame instantaneous FPS → sliding median window
      if (clk.lastAt > 0) {
        const frameDt = rafTime - clk.lastAt;
        if (frameDt > 4 && frameDt < 250) { // guard against tab suspend / first frame
          const instFps = 1000 / frameDt;
          const win = fpsWindowRef.current;
          win.push(instFps);
          if (win.length > FPS_WINDOW_SIZE) win.shift();
        }
      }
      clk.lastAt = rafTime;

      // Compute median FPS over the window (robust to brief spikes)
      const win = fpsWindowRef.current;
      const medianFps = win.length > 0
        ? [...win].sort((a, b) => a - b)[Math.floor(win.length / 2)]
        : clk.fps;

      // Determine target tier
      const lowPower = lowPowerRef.current;
      let targetTier: PerfTier;
      if (lowPower) {
        // Low Power Mode caps at 'low' — no decorative rendering, tracking first
        targetTier = medianFps < TIER_LOW_FPS ? "critical" : "low";
      } else if (medianFps < TIER_LOW_FPS) {
        targetTier = "critical";
      } else if (medianFps < TIER_MEDIUM_FPS) {
        targetTier = "low";
      } else if (medianFps < TIER_HIGH_FPS) {
        targetTier = "medium";
      } else {
        targetTier = "high";
      }

      // Apply with hysteresis: immediate downgrade, delayed upgrade
      {
        const prev     = perfTierRef.current;
        const prevIdx  = TIER_ORDER.indexOf(prev);
        const targIdx  = TIER_ORDER.indexOf(targetTier);
        if (targIdx < prevIdx) {
          // Downgrade: immediate — thermal / battery emergency
          perfTierRef.current    = targetTier;
          tierChangedAtRef.current = rafTime;
          console.log(
            `[NEUMA] Perf ↓ ${prev}→${targetTier}  fps=${medianFps.toFixed(1)} lowPow=${lowPower}`,
          );
        } else if (targIdx > prevIdx && rafTime - tierChangedAtRef.current > TIER_HYSTERESIS_MS) {
          // Upgrade: only after sustained recovery
          perfTierRef.current    = targetTier;
          tierChangedAtRef.current = rafTime;
          console.log(`[NEUMA] Perf ↑ ${prev}→${targetTier}  fps=${medianFps.toFixed(1)}`);
        }
      }
      const tier = perfTierRef.current;

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

      // ── 2b. A4 bounding quad, scale lock, lateral offset, precision ──────
      //
      // Project the 4 physical A4 corners using the current smoothed pose to
      // obtain the screen-space clip quad.  The quad is used:
      //   • as a hard clip region for the holographic foot (ctx.clip)
      //   • for per-dot inQuadCW tests (dome dots outside the sheet are hidden)
      //   • for the amber border warning
      //
      // Scale lock: estimateScaleFromPose projects TL/TR corners (297 mm apart)
      // to derive px/mm.  This anchors the coordinate system to real-world mm.
      //
      // Precision estimate: we track an EMA of the scale and its variance.
      //   sigma_corner_px  ≈  sigma_scale × A4_W_MM / 2   (two-corner geometry)
      //   precision_mm      =  sigma_corner_px / pixPerMm
      //                     =  sigma_scale × A4_HALF_W_MM  (148.5 mm)
      // Clamped to [0.05, 5.0] mm.
      let sortedA4Quad: [number, number][] = [];
      let pixPerMm: number | null = null;
      let precisionMm: number | null = null;
      let lateralOffset = 0;

      if (smoothedPoseRef.current) {
        const cornersProj = GF_A4_CORNERS.map(
          (c) => projectPoint3D(c, smoothedPoseRef.current!, K),
        );
        if (cornersProj.every(Boolean)) {
          sortedA4Quad = sortQuadCW(cornersProj as [number, number][]);
        }

        // Scale lock — canonical 297 mm reference via estimateScaleFromPose
        const rawScale = estimateScaleFromPose(smoothedPoseRef.current, K);
        if (rawScale > 0) {
          pixPerMm = rawScale;

          // EMA variance update
          const α = SCALE_EMA_ALPHA;
          const prevEma = scaleEmaRef.current;
          if (prevEma === 0) {
            scaleEmaRef.current    = rawScale;
            scaleVarEmaRef.current = 0;
          } else {
            const diff = rawScale - prevEma;
            scaleEmaRef.current    = (1 - α) * prevEma   + α * rawScale;
            scaleVarEmaRef.current = (1 - α) * scaleVarEmaRef.current + α * diff * diff;
          }

          // Precision in mm (only once variance has warmed up beyond noise floor)
          const sigma = Math.sqrt(scaleVarEmaRef.current);
          if (sigma > 1e-6 && scaleEmaRef.current > 0) {
            precisionMm = Math.min(5.0, Math.max(0.05, sigma * A4_HALF_W_MM));
          }
        }

        // Lateral distance of the camera from the A4 sheet centre (XZ plane)
        const cp = computeCameraWorldPos(
          smoothedPoseRef.current.R,
          smoothedPoseRef.current.t,
        );
        lateralOffset = Math.sqrt(cp[0] ** 2 + cp[2] ** 2);
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
      //
      // Priority order (highest → lowest):
      //   1. Light too low    → "Più luce necessaria"
      //   2. Too far          → "Avvicinati al piede"
      //   3. Moving too fast  → "Rallenta il movimento"
      //   4. Sector lagging   → sector-specific hint (see 3b-iv below)
      let suggestedGuidance: string | null = null;
      if (!eraser.isComplete) {
        if (lightCheckRef.current.brightness < BRIGHTNESS_LOW) {
          suggestedGuidance = "Più luce necessaria";
        } else if (trackingOk && camDist > DIST_TOO_FAR_M) {
          suggestedGuidance = "Avvicinati al piede";
        } else if (trackingLive && speedEmaRef.current > SPEED_TOO_FAST_MS) {
          suggestedGuidance = "Rallenta il movimento";
        } else if (eraser.progress > 25) {
          // ── Sector guidance (lowest priority) ─────────────────────────────
          // After the user has started scanning (> 25 % overall), find the
          // most-lagging sector and nudge them toward it.
          // The threshold (0.70) is set below SECTOR_MIN_PCT (0.80) so the hint
          // appears early enough to actually guide behaviour.
          const sp = eraser.sectorProgress;
          const sectors = [
            { key: "top"   as const, pct: sp.top.pct,   msg: "Inquadra il piede dall'alto" },
            { key: "left"  as const, pct: sp.left.pct,  msg: "Inquadra il tallone lateralmente" },
            { key: "right" as const, pct: sp.right.pct, msg: "Spostati verso l'arco plantare" },
          ] as const;
          // Sort ascending by pct to find the most lagging sector
          const lagging = [...sectors].sort((a, b) => a.pct - b.pct)[0];
          if (lagging.pct < 0.70) {
            suggestedGuidance = lagging.msg;
          }
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
        if (trackingLive && !motionBlurBlockingRef.current && d2 <= MIRINO_RADIUS_PX ** 2) {
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

                // ── Incremental height triangulation ─────────────────────
                // Pair the new observation with every previous one to find
                // camera-ray intersections inside the dome (= foot surface).
                const newH = triangulateMaxHeight(obs, localObsRef.current);
                localObsRef.current.push(obs);
                if (newH > maxHeightMmRef.current) {
                  maxHeightMmRef.current = newH;
                  console.log(
                    `[NEUMA] Altezza piede aggiornata: ${newH.toFixed(1)} mm` +
                    ` (da ${localObsRef.current.length} osservazioni)`,
                  );
                }

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

      // ── 5. Holographic foot — hard-clipped to projected A4 bounding quad ────
      //
      // ctx.clip() creates a clipping region from the projected A4 quad so that
      // no hologram element (grid, glass prism, point cloud, corner brackets)
      // spills outside the physical sheet boundary.
      if (trackingOk && smoothedPoseRef.current) {
        if (sortedA4Quad.length === 4) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(sortedA4Quad[0][0], sortedA4Quad[0][1]);
          for (let i = 1; i < 4; i++) ctx.lineTo(sortedA4Quad[i][0], sortedA4Quad[i][1]);
          ctx.closePath();
          ctx.clip();
          drawHolographicFoot(ctx, smoothedPoseRef.current, K, now, tier);
          ctx.restore();
        } else {
          drawHolographicFoot(ctx, smoothedPoseRef.current, K, now, tier);
        }
      }

      // ── Dot density throttle ─────────────────────────────────────────────
      // Skip a fraction of dome dots to reduce GPU load at lower tiers.
      // Dots are skipped by ID modulo to preserve spatial distribution.
      //   HIGH     → all 150 (skip = 1)
      //   MEDIUM   → 75  (skip = 2)
      //   LOW      → 50  (skip = 3)
      //   CRITICAL → 37  (skip = 4)
      const dotSkip = tier === "high" ? 1 : tier === "medium" ? 2 : tier === "low" ? 3 : 4;

      // ── 6. Draw outer scanning ring (faint amber) ─────────────────────────
      // Hidden on CRITICAL — save one arc draw per frame.
      if (trackingLive && tier !== "critical") {
        ctx.save();
        ctx.setLineDash([7, 6]);
        ctx.lineWidth   = 1;
        ctx.strokeStyle = "rgba(251, 191, 36, 0.18)";
        ctx.beginPath();
        ctx.arc(cx, cy, SCAN_RADIUS_PX, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ── 7. Idle dots — white translucent, hard-clipped to A4 quad ──────────
      ctx.fillStyle = C_IDLE;
      for (const dot of idleDots) {
        if (dotSkip > 1 && dot.id % dotSkip !== 0) continue; // density throttle
        if (
          sortedA4Quad.length === 4 &&
          !inQuadCW(dot.sx, dot.sy, sortedA4Quad, A4_CLIP_MARGIN_PX)
        ) continue;
        ctx.beginPath();
        ctx.arc(dot.sx, dot.sy, DOT_R_IDLE, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── 8. Scanning dots — amber + glow, hard-clipped to A4 quad ─────────
      // Glow (larger circle drawn first) is skipped on LOW/CRITICAL to avoid
      // per-dot overdraw on a low-end GPU.
      const showScanGlow = tier === "high" || tier === "medium";
      for (const dot of scanDots) {
        if (dotSkip > 1 && dot.id % dotSkip !== 0) continue;
        if (
          sortedA4Quad.length === 4 &&
          !inQuadCW(dot.sx, dot.sy, sortedA4Quad, A4_CLIP_MARGIN_PX)
        ) continue;
        if (showScanGlow) {
          ctx.beginPath();
          ctx.arc(dot.sx, dot.sy, DOT_R_SCAN + 5, 0, Math.PI * 2);
          ctx.fillStyle = C_SCAN_GLOW;
          ctx.fill();
        }
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
        // Animating points are always allowed to finish their death animation
        // even if they were just outside the quad when erased.
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

      // ── 9b. Amber border warning — pulsing when camera drifts laterally ───
      //
      // When the camera's horizontal distance from the A4 centre exceeds
      // LATERAL_WARN_DIST_M (0.18 m) the outermost ArUco marker is approaching
      // the frame edge.  A pulsing amber outline on the projected A4 quad nudges
      // Emanuele to re-centre before markers go out of view.
      //
      // Additionally, if any projected corner is within 8 % of the screen edge,
      // the same warning fires regardless of lateral offset.
      const edgeMargin = Math.min(w, h) * 0.08;
      const cornerNearEdge =
        sortedA4Quad.length === 4 &&
        sortedA4Quad.some(
          ([px, py]) =>
            px < edgeMargin || px > w - edgeMargin ||
            py < edgeMargin || py > h - edgeMargin,
        );
      const showBorderWarn =
        trackingOk &&
        sortedA4Quad.length === 4 &&
        (lateralOffset > LATERAL_WARN_DIST_M || cornerNearEdge);

      if (showBorderWarn) {
        // Intensity ramps from 0 → 1 as the offset exceeds the threshold.
        const warnProgress = cornerNearEdge
          ? 1
          : Math.min(1, (lateralOffset - LATERAL_WARN_DIST_M) / 0.07);
        // Fast 700 ms pulse (Apple amber warning rhythm)
        const warnT     = (now / 700) % 1;
        const warnPulse = 0.28 + 0.55 * (0.5 - 0.5 * Math.cos(warnT * Math.PI * 2));
        const warnAlpha = warnPulse * warnProgress;

        ctx.save();
        ctx.globalAlpha  = warnAlpha;
        ctx.strokeStyle  = "rgba(251, 191, 36, 1)"; // Apple amber
        ctx.lineWidth    = 2.5;
        ctx.lineCap      = "round";
        ctx.lineJoin     = "round";
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(sortedA4Quad[0][0], sortedA4Quad[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(sortedA4Quad[i][0], sortedA4Quad[i][1]);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // ── 10. Mirino (targeting reticle) — always visible ──────────────────
      //   BLUR  → amber (C_MIRINO_BLUR)  — capture paused, camera moving
      //   LIVE  → full white (C_MIRINO)
      //   GHOST → half-dim (C_MIRINO_GHOST) — dots frozen, no new erasure
      //   LOST  → very dim (C_MIRINO_LO)
      const mirinoBlocked = motionBlurBlockingRef.current;
      const mirinoColor = mirinoBlocked
        ? C_MIRINO_BLUR
        : trackingLive
          ? C_MIRINO
          : trackingGhost
            ? C_MIRINO_GHOST
            : C_MIRINO_LO;
      drawMirino(ctx, cx, cy, MIRINO_RADIUS_PX, mirinoColor);

      // ── 10b. "Rallenta" badge — shown only when motion-blur blocks erasure ─
      if (mirinoBlocked && trackingLive) {
        ctx.save();
        const badgeY  = cy - MIRINO_RADIUS_PX - 14;
        const label   = "Rallenta";
        ctx.font      = "bold 11px ui-rounded, -apple-system, sans-serif";
        const tw      = ctx.measureText(label).width;
        const pad     = 8;
        const bx      = cx - tw / 2 - pad;
        const bw      = tw + pad * 2;
        // Pill background
        ctx.fillStyle    = "rgba(251, 191, 36, 0.18)";
        ctx.strokeStyle  = "rgba(251, 191, 36, 0.60)";
        ctx.lineWidth    = 1;
        const br = 6;
        ctx.beginPath();
        ctx.roundRect(bx, badgeY - 11, bw, 18, br);
        ctx.fill();
        ctx.stroke();
        // Text
        ctx.fillStyle = "rgba(251, 191, 36, 0.95)";
        ctx.textAlign  = "center";
        ctx.fillText(label, cx, badgeY + 2);
        ctx.restore();
      }

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
        pixPerMm,
        precisionMm,
        tier,
        maxHeightMmRef.current > 0 ? maxHeightMmRef.current : null,
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

/**
 * useFootEraser — "Eraser" UX for foot scan.
 *
 * Generates 150 points on a hemisphere above the ArUco sheet centre.
 * For each animation frame the caller supplies current device tilt and
 * canvas dimensions; the hook projects every remaining point to 2-D and
 * marks it "consumed" when it falls within ERASER_RADIUS_PX of the
 * screen centre (= camera looking directly at that region).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanFrameTilt } from "./useScanFrameOrientation";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EraserPoint {
  id: number;
  /** World-space coords (metres). Foot at origin, Y-up. */
  wx: number;
  wy: number;
  wz: number;
}

export interface ProjectedDot {
  id: number;
  sx: number; // screen X (px)
  sy: number; // screen Y (px)
}

export interface FootEraserState {
  /** Remaining (not yet erased) points */
  remaining: EraserPoint[];
  /** Call from a RAF loop; returns dots to draw AND erases points near centre */
  tick: (tilt: ScanFrameTilt, screenW: number, screenH: number) => ProjectedDot[];
  /** 0-100 */
  progress: number;
  isComplete: boolean;
  totalConsumed: number;
  reset: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL = 150;
const RADIUS_M = 0.25; // hemisphere radius 25 cm
const ERASER_RADIUS_PX = 50;
/** Max tilt angle (°) that maps to hemisphere equator (90°). */
const MAX_TILT_DEG = 22;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deg2rad(d: number) {
  return (d * Math.PI) / 180;
}

/** Fibonacci / golden-angle hemisphere distribution. */
function buildHemisphere(n: number): EraserPoint[] {
  const pts: EraserPoint[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    // y: 1 (top) → ~0 (equator)
    const y = 1 - i / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({
      id: i,
      wx: Math.cos(theta) * r * RADIUS_M,
      wy: y * RADIUS_M,
      wz: Math.sin(theta) * r * RADIUS_M,
    });
  }
  return pts;
}

/**
 * Map device tilt to the hemisphere direction the camera is "pointing at".
 *
 * Convention (from useScanFrameOrientation):
 *   rotateX = (beta − 90) * k  → forward/back tilt of phone held in portrait
 *   rotateZ = gamma * k        → left/right tilt (roll)
 *
 * When rotateX = rotateZ = 0 the phone is horizontal, camera faces straight
 * down → the TOP of the hemisphere is centred in the frame.
 * As rotateX increases the phone tilts forward and the camera sweeps toward
 * the FRONT of the foot (+Z in world), and vice-versa.
 */
function camViewDir(tilt: ScanFrameTilt): [number, number, number] {
  // Normalise tilt angles to [-1,+1] range, then map to hemisphere
  const fx = (tilt.rotateX / MAX_TILT_DEG) * Math.sin(deg2rad(75)); // max phi ~75°
  const fz = (tilt.rotateZ / MAX_TILT_DEG) * Math.sin(deg2rad(75));
  const fy = Math.sqrt(Math.max(0, 1 - fx * fx - fz * fz));
  const len = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  return [fz / len, fy / len, fx / len]; // [x, y, z] — y always positive (upper hemisphere)
}

/**
 * Project a world-space hemisphere point onto the screen.
 *
 * Uses an equidistant spherical projection centred on the camera direction
 * so that the dot closest to the camera direction lands at screen centre.
 * This matches the "eraser at screen centre" contract exactly.
 */
function project(
  pt: EraserPoint,
  viewDir: [number, number, number],
  screenW: number,
  screenH: number,
): ProjectedDot | null {
  // Normalise point direction
  const r = Math.sqrt(pt.wx * pt.wx + pt.wy * pt.wy + pt.wz * pt.wz) || 1;
  const px = pt.wx / r;
  const py = pt.wy / r;
  const pz = pt.wz / r;

  // Dot product: 1 = camera directly at point, −1 = behind camera
  const dot = px * viewDir[0] + py * viewDir[1] + pz * viewDir[2];

  // Cull points more than 90° away (behind or on the far horizon)
  if (dot < 0.05) return null;

  // Angular offset from view centre (radians)
  const angOffset = Math.acos(Math.min(1, dot));

  // Focal length for perspective: assume ~60° horizontal FOV on mobile
  const focal = screenW / (2 * Math.tan(deg2rad(30)));

  // Screen radius corresponding to angular offset
  const screenR = Math.tan(angOffset) * focal;

  // Direction of the dot in the screen plane (perpendicular to viewDir)
  // Build two orthonormal axes in the plane ⊥ to viewDir
  const [vx, vy, vz] = viewDir;

  // Camera "up" axis: cross of viewDir and world-right (1,0,0) — avoids gimbal
  let ux = vy * 0 - vz * 1; // cross(v, (0,1,0)) ≈ screen up
  let uy = vz * 0 - vx * 0;
  let uz = vx * 1 - vy * 0;

  // Fallback: use world-forward if viewDir ≈ world-right
  if (Math.abs(ux) + Math.abs(uy) + Math.abs(uz) < 0.01) {
    ux = 0; uy = 0; uz = 1;
  }
  const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= uLen; uy /= uLen; uz /= uLen;

  // Camera "right" axis: cross(up, viewDir)
  const rx = uy * vz - uz * vy;
  const ry = uz * vx - ux * vz;
  const rz_ = ux * vy - uy * vx;
  const rLen = Math.sqrt(rx * rx + ry * ry + rz_ * rz_) || 1;

  // Offset of point from camera direction in the perpendicular plane
  const offX = px - dot * vx;
  const offY = py - dot * vy;
  const offZ = pz - dot * vz;
  const offLen = Math.sqrt(offX * offX + offY * offY + offZ * offZ) || 1;

  // Project offset onto screen axes
  const screenDirX = (offX * (rx / rLen) + offY * (ry / rLen) + offZ * (rz_ / rLen));
  const screenDirY = (offX * ux + offY * uy + offZ * uz);
  const offLenNorm = Math.sqrt(screenDirX * screenDirX + screenDirY * screenDirY) || 1;

  const sx = screenW / 2 + (screenDirX / offLenNorm) * screenR;
  const sy = screenH / 2 - (screenDirY / offLenNorm) * screenR; // Y-flip

  // Clamp to screen bounds with a small margin
  if (sx < -30 || sx > screenW + 30 || sy < -30 || sy > screenH + 30) return null;

  return { id: pt.id, sx, sy };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useFootEraser(enabled: boolean): FootEraserState {
  const [remaining, setRemaining] = useState<EraserPoint[]>(() => buildHemisphere(TOTAL));
  const remainingRef = useRef<EraserPoint[]>(remaining);
  const consumedRef = useRef<Set<number>>(new Set());

  const totalConsumed = TOTAL - remaining.length;
  const progress = Math.round((totalConsumed / TOTAL) * 100);
  const isComplete = remaining.length === 0;

  // Keep ref in sync for the tick function (avoids stale closure)
  useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  /**
   * Called every animation frame by FootEraserCanvas.
   * Mutates `consumedRef` synchronously; schedules React state update when
   * new points are consumed so the hook's `remaining` count stays accurate.
   */
  const tick = useCallback(
    (tilt: ScanFrameTilt, screenW: number, screenH: number): ProjectedDot[] => {
      if (!enabled || screenW === 0 || screenH === 0) return [];

      const viewDir = camViewDir(tilt);
      const cx = screenW / 2;
      const cy = screenH / 2;
      const r2 = ERASER_RADIUS_PX * ERASER_RADIUS_PX;

      const dots: ProjectedDot[] = [];
      const newlyConsumed: number[] = [];

      for (const pt of remainingRef.current) {
        const dot = project(pt, viewDir, screenW, screenH);
        if (!dot) continue;

        const dx = dot.sx - cx;
        const dy = dot.sy - cy;
        if (dx * dx + dy * dy <= r2) {
          // Erased
          if (!consumedRef.current.has(pt.id)) {
            consumedRef.current.add(pt.id);
            newlyConsumed.push(pt.id);
          }
        } else {
          dots.push(dot);
        }
      }

      if (newlyConsumed.length > 0) {
        // Haptic micro-pulse
        try { window.navigator.vibrate?.(10); } catch { /* ignore */ }

        const updated = remainingRef.current.filter((p) => !consumedRef.current.has(p.id));
        remainingRef.current = updated;
        // Schedule React update (batched, non-blocking)
        setRemaining(updated);
      }

      return dots;
    },
    [enabled],
  );

  const reset = useCallback(() => {
    const pts = buildHemisphere(TOTAL);
    remainingRef.current = pts;
    consumedRef.current.clear();
    setRemaining(pts);
  }, []);

  // Reset when disabled
  useEffect(() => {
    if (!enabled) reset();
  }, [enabled, reset]);

  return { remaining, tick, progress, isComplete, totalConsumed, reset };
}

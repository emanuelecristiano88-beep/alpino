/**
 * Statistical outlier filter for ArUco-derived camera-pose observations.
 *
 * A "bad" observation is one where the camera pose estimation glitched due to
 * light reflections on TPU/skin, partial marker occlusion, or sudden motion blur.
 * These manifest as an implausible camera position that would introduce spikes,
 * holes, or ghost points in the final 3D point cloud.
 *
 * Two independent checks are applied in order:
 *
 *  1. ABSOLUTE BOUNDS — camera must sit within a plausible volume above the A4
 *     sheet.  Catches pose inversions and extreme extrapolations.
 *
 *  2. VELOCITY JUMP — compare the step distance to the last accepted observation
 *     against a rolling-window mean ± k·σ of recent steps.  Catches sudden
 *     positional jumps that are larger than the current movement speed.
 *
 * The function is intentionally typed against a minimal duck-typed interface so
 * it can be imported without creating a circular dependency with poseEstimation.ts.
 */

/** Minimal shape needed by the filter — subset of ObservationData. */
export interface ObsLike {
  cameraWorldPos: [number, number, number];
}

export type FilterResult =
  | { outlier: false }
  | { outlier: true; reason: string };

// ── Tuning constants ───────────────────────────────────────────────────────────

/** Camera must be at least this many metres above the A4 sheet plane (Y = 0). */
const MIN_CAM_Y = 0.05; // 5 cm

/**
 * Camera must not be more than this many metres above the sheet.
 * 90 cm covers even a very high overhead shot.
 */
const MAX_CAM_Y = 0.90; // 90 cm

/**
 * Camera lateral distance from the A4 centre (XZ plane) must be below this.
 * Beyond 75 cm the markers would be tiny and pose quality degrades sharply.
 */
const MAX_LATERAL_M = 0.75; // 75 cm

/** Number of consecutive steps used in the rolling velocity statistics. */
const JUMP_WINDOW = 8;

/**
 * Z-score multiplier: reject if step > mean + k·σ.
 * 2.5 gives ≈ 99.4 % retention on a normal distribution.
 */
const JUMP_SIGMA_K = 2.5;

/**
 * Absolute floor for the jump threshold.
 * Even if σ is tiny (user barely moving), never flag a jump smaller than this.
 * 10 cm is safely above normal inter-observation movement speed.
 */
const JUMP_ABS_FLOOR_M = 0.10; // 10 cm

/** Need at least this many accepted observations before velocity stats are valid. */
const MIN_OBS_FOR_VELOCITY = 4;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns `{ outlier: false }` if `obs` is a plausible camera observation,
 * or `{ outlier: true, reason }` with a human-readable explanation if it
 * should be rejected.
 *
 * @param obs      The candidate observation to evaluate.
 * @param accepted All previously accepted observations (order matters — most
 *                 recent at the end of the array).
 */
export function isObservationOutlier(
  obs:      ObsLike,
  accepted: readonly ObsLike[],
): FilterResult {
  const [cx, cy, cz] = obs.cameraWorldPos;

  // ── 1. Absolute bounds ─────────────────────────────────────────────────────

  if (cy < MIN_CAM_Y)
    return { outlier: true, reason: `camY ${(cy * 100).toFixed(1)}cm < min ${MIN_CAM_Y * 100}cm` };

  if (cy > MAX_CAM_Y)
    return { outlier: true, reason: `camY ${(cy * 100).toFixed(1)}cm > max ${MAX_CAM_Y * 100}cm` };

  const lateral = Math.sqrt(cx * cx + cz * cz);
  if (lateral > MAX_LATERAL_M)
    return {
      outlier: true,
      reason: `lateral ${(lateral * 100).toFixed(1)}cm > ${MAX_LATERAL_M * 100}cm`,
    };

  // ── 2. Velocity / jump check ───────────────────────────────────────────────

  const n = accepted.length;
  if (n < MIN_OBS_FOR_VELOCITY) return { outlier: false };

  // Collect step distances over the rolling window of recent observations
  const winStart = Math.max(1, n - JUMP_WINDOW);
  const deltas: number[] = [];
  for (let i = winStart; i < n; i++) {
    const [ax, ay, az] = accepted[i - 1].cameraWorldPos;
    const [bx, by, bz] = accepted[i].cameraWorldPos;
    deltas.push(Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2));
  }

  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const variance = deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / deltas.length;
  const sigma = Math.sqrt(variance);

  // Step from the last accepted observation to the candidate
  const [lx, ly, lz] = accepted[n - 1].cameraWorldPos;
  const step = Math.sqrt((cx - lx) ** 2 + (cy - ly) ** 2 + (cz - lz) ** 2);

  // Dynamic threshold, but never lower than the absolute floor
  const threshold = Math.max(mean + JUMP_SIGMA_K * sigma, JUMP_ABS_FLOOR_M);

  if (step > threshold) {
    return {
      outlier: true,
      reason:
        `jump ${(step * 1000).toFixed(0)}mm > ` +
        `${(threshold * 1000).toFixed(0)}mm ` +
        `(μ=${(mean * 1000).toFixed(0)}mm σ=${(sigma * 1000).toFixed(0)}mm)`,
    };
  }

  return { outlier: false };
}

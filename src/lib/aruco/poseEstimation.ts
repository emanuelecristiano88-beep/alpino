/**
 * Camera pose estimation from ArUco corner correspondences.
 *
 * Implements the homography decomposition method (Zhang 1999 / Faugeras):
 *   H = K · [r1 | r2 | t]
 * where r1, r2 are the first two columns of the rotation matrix (world X and Z
 * map to the XZ plane, i.e. the A4 sheet is flat at Y = 0 in world space).
 *
 * This is the pure-JS replacement for:
 *   cv.solvePnP   → estimatePoseFromCorners
 *   cv.projectPoints → projectPoint3D
 *
 * Coordinate systems:
 *   World (Y-up):  X = right, Y = up (off sheet), Z = forward
 *   Camera (OpenCV):  X = right, Y = down, Z = forward (into scene)
 *
 * The A4 sheet lies flat on the floor at Y = 0.
 * Foot centre = world origin (0, 0, 0).
 */

import { computeHomography4, sortCornerIndices } from "./homography";
import { normalizedVideoToContainerPercent } from "../scanner/videoOverlayCoords";
import type { OpenCvArucoQuad } from "../../hooks/useOpenCvArucoAnalysis";

// ─── Physical A4 sheet layout ─────────────────────────────────────────────────

/** A4 dimensions in metres. */
const A4_W = 0.297; // long side (landscape width)
const A4_H = 0.210; // short side (landscape height)

/**
 * Physical world positions (metres, Y = 0 sheet plane, Y-up coordinate system)
 * for the 4 corner markers in TL / TR / BL / BR order.
 * Origin = centre of the A4 sheet = foot reference centre.
 */
export const SHEET_WORLD_CORNERS: [number, number, number][] = [
  [-A4_W / 2,  0, -A4_H / 2], // TL
  [ A4_W / 2,  0, -A4_H / 2], // TR
  [-A4_W / 2,  0,  A4_H / 2], // BL
  [ A4_W / 2,  0,  A4_H / 2], // BR
];

// ─── Camera intrinsics ────────────────────────────────────────────────────────

export interface CameraIntrinsics {
  fx: number; fy: number;
  cx: number; cy: number;
}

/**
 * Estimate camera intrinsic matrix from display size assuming ~60° horizontal FOV.
 * Typical for rear-facing mobile phone cameras (±5°).
 */
export function estimateCameraIntrinsics(
  displayW: number,
  displayH: number,
  fovHDeg = 60,
): CameraIntrinsics {
  const fx = displayW / (2 * Math.tan((fovHDeg * Math.PI) / 360));
  return { fx, fy: fx, cx: displayW / 2, cy: displayH / 2 };
}

// ─── Pose estimation ──────────────────────────────────────────────────────────

export interface CameraPose {
  /** 3×3 rotation matrix, row-major: transforms world → camera coords. */
  R: number[];
  /** Translation vector [tx, ty, tz] in metres (camera ← world). */
  t: [number, number, number];
}

/**
 * A single observation captured the instant a dome point enters the Mirino.
 *
 * All coordinates are in the **world (A4 sheet) coordinate system**:
 *   X = right  (long side),  Y = up (off sheet),  Z = forward (short side)
 *   Origin = centre of the A4 sheet / foot reference centre.
 *
 * These records form the "observation path" used later to reconstruct the
 * 3D foot shape from multi-view photometric data.
 */
export interface ObservationData {
  /** ID of the erased dome point (0–149). */
  dotId: number;
  /**
   * Camera optical centre in world coordinates (metres).
   * Derived from pose: p_world = −R^T · t
   */
  cameraWorldPos: [number, number, number];
  /**
   * Unit vector pointing from the camera towards the scene, in world space.
   * Equivalent to the third row of R (camera Z-axis expressed in world frame).
   */
  lookDirWorld: [number, number, number];
  /**
   * Full 3×3 rotation matrix from pose (world → camera), row-major.
   * Kept for downstream algorithms that need the complete orientation.
   */
  cameraRotationMatrix: number[];
  /** 3D world position [wx, wy, wz] of the erased dome point (metres). */
  dotWorldPos: [number, number, number];
  /** performance.now() timestamp at the moment of capture. */
  timestamp: number;
}

/**
 * Extract the camera's position in world (A4 sheet) coordinates from a pose.
 *
 * Math:
 *   The pose stores  t  such that  p_cam = R · p_world + t
 *   Solving for the camera origin (p_world when p_cam = 0):
 *     p_world = −R^T · t      (since R is orthonormal, R^{−1} = R^T)
 */
export function computeCameraWorldPos(
  R: number[],
  t: [number, number, number],
): [number, number, number] {
  const [tx, ty, tz] = t;
  // R^T · t  — rows of R^T are columns of R
  return [
    -(R[0] * tx + R[3] * ty + R[6] * tz),
    -(R[1] * tx + R[4] * ty + R[7] * tz),
    -(R[2] * tx + R[5] * ty + R[8] * tz),
  ];
}

type Vec3 = [number, number, number];

function norm3(v: Vec3): number { return Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2); }
function normalize3(v: Vec3): Vec3 {
  const n = norm3(v) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

/**
 * Estimate camera pose from 4 detected ArUco marker centroids.
 *
 * @param quads       All detected marker quads from useOpenCvArucoAnalysis.
 * @param videoW      Video stream pixel width.
 * @param videoH      Video stream pixel height.
 * @param displayW    Overlay canvas pixel width (= container clientWidth).
 * @param displayH    Overlay canvas pixel height (= container clientHeight).
 * @param K           Camera intrinsics (from estimateCameraIntrinsics).
 * @returns           CameraPose, or null if < 4 markers or degenerate.
 */
export function estimatePoseFromQuads(
  quads: OpenCvArucoQuad[],
  videoW: number,
  videoH: number,
  displayW: number,
  displayH: number,
  K: CameraIntrinsics,
): CameraPose | null {
  if (quads.length < 4) return null;

  // ── Step 1: compute centroid of each quad in display pixels ──────────────
  const imageCentroids: [number, number][] = quads.slice(0, 4).map((q) => {
    const nx = q.corners.reduce((s, c) => s + c.x, 0) / (q.corners.length || 1);
    const ny = q.corners.reduce((s, c) => s + c.y, 0) / (q.corners.length || 1);
    const { leftPct, topPct } = normalizedVideoToContainerPercent(
      nx, ny, videoW, videoH, displayW, displayH,
    );
    return [(leftPct / 100) * displayW, (topPct / 100) * displayH];
  });

  // ── Step 2: sort centroids into TL / TR / BL / BR ─────────────────────────
  const [iTL, iTR, iBL, iBR] = sortCornerIndices(imageCentroids);
  const imageCorners: [number, number][] = [
    imageCentroids[iTL], // TL
    imageCentroids[iTR], // TR
    imageCentroids[iBL], // BL
    imageCentroids[iBR], // BR
  ];

  // ── Step 3: compute homography from world-XZ to image ─────────────────────
  // For each world corner, the relevant 2D coords are (world_X, world_Z)
  // (because Y = 0 for all sheet corners, so the third dimension is dropped).
  const worldSrc: [number, number][] = SHEET_WORLD_CORNERS.map(([x, , z]) => [x, z]);
  const H = computeHomography4(worldSrc, imageCorners);
  if (!H) return null;

  // ── Step 4: decompose H = K · [r1 | r2 | t] ──────────────────────────────
  // Extract K^{-1} · H columns
  const { fx, fy, cx, cy } = K;

  const kinvCol = (j: number): Vec3 => {
    const h0 = H[j];     // H[0][j]
    const h1 = H[3 + j]; // H[1][j]
    const h2 = H[6 + j]; // H[2][j]
    return [
      (h0 - cx * h2) / fx,
      (h1 - cy * h2) / fy,
      h2,
    ];
  };

  const kh0 = kinvCol(0); // λ · r_x  (world X axis in camera space)
  const kh1 = kinvCol(1); // λ · r_z  (world Z axis in camera space)
  const kh2 = kinvCol(2); // λ · t

  const n0 = norm3(kh0);
  const n1 = norm3(kh1);
  if (n0 < 1e-9 || n1 < 1e-9) return null;

  // Scale factor λ (geometric mean for better stability)
  const lambda = 2 / (n0 + n1);

  const rX = normalize3(kh0); // camera-space direction of world X
  const rZ = normalize3(kh1); // camera-space direction of world Z
  const rY = normalize3(cross3(rX, rZ)); // camera-space direction of world Y (up)

  // Translation
  const t: Vec3 = [kh2[0] * lambda, kh2[1] * lambda, kh2[2] * lambda];

  // 3×3 rotation matrix, row-major.
  // R maps world vector [X, Y, Z] → camera vector [cx, cy, cz]:
  //   camera = R · world + t
  // Column j of R = where world basis vector e_j goes in camera coords.
  //   Col 0 = rX (world X), Col 1 = rY (world Y), Col 2 = rZ (world Z)
  const R: number[] = [
    rX[0], rY[0], rZ[0],
    rX[1], rY[1], rZ[1],
    rX[2], rY[2], rZ[2],
  ];

  return { R, t };
}

// ─── 3-D → 2-D projection ─────────────────────────────────────────────────────

/**
 * Project a single 3D world point to 2D image coordinates.
 * Equivalent to cv.projectPoints for a single point (no distortion).
 *
 * @param world  [X, Y, Z] in metres, world space (Y-up, foot centre = origin).
 * @param pose   Camera pose from estimatePoseFromQuads.
 * @param K      Camera intrinsics.
 * @returns      [u, v] image pixels, or null if the point is behind the camera.
 */
export function projectPoint3D(
  world: [number, number, number],
  pose: CameraPose,
  K: CameraIntrinsics,
): [number, number] | null {
  const { R, t } = pose;
  const [X, Y, Z] = world;

  // Camera-space coords: p_cam = R · p_world + t
  const xc = R[0]*X + R[1]*Y + R[2]*Z + t[0];
  const yc = R[3]*X + R[4]*Y + R[5]*Z + t[1];
  const zc = R[6]*X + R[7]*Y + R[8]*Z + t[2];

  // Behind-camera guard
  if (zc < 0.005) return null;

  // Perspective division + apply intrinsics
  const u = K.fx * (xc / zc) + K.cx;
  const v = K.fy * (yc / zc) + K.cy;

  return [u, v];
}

// ─── Real-world measurement helpers ──────────────────────────────────────────

/**
 * Derive the current pixel-per-millimetre scale from the estimated camera pose.
 *
 * Uses the known 297 mm long side of the A4 sheet as the fixed physical
 * reference: projects the TL and TR corner markers and divides their pixel
 * distance by 297 mm.
 *
 * This is the **Scale Lock** anchor: 1 world unit = 1 metre = 1000 mm, so
 * `SHEET_WORLD_CORNERS[0]` and `[1]` are exactly 0.297 m = 297 mm apart.
 *
 * Returns 0 if either corner projects behind the camera.
 */
export function estimateScaleFromPose(
  pose: CameraPose,
  K: CameraIntrinsics,
): number {
  const tl = projectPoint3D(SHEET_WORLD_CORNERS[0], pose, K);
  const tr = projectPoint3D(SHEET_WORLD_CORNERS[1], pose, K);
  if (!tl || !tr) return 0;
  const dx = tr[0] - tl[0];
  const dy = tr[1] - tl[1];
  const pxDist = Math.sqrt(dx * dx + dy * dy);
  // A4_W is in metres; ×1000 converts to mm → result is pixels / mm
  return pxDist / (A4_W * 1000);
}

/**
 * Return the Euclidean distance **in millimetres** between two projected
 * screen points, given the current pixel-per-millimetre scale.
 *
 * Typical use: measuring the real-world gap between two dome dots or between
 * a dot and a reference landmark, in the same pass as the RAF draw loop.
 *
 * @param p1       First projected point  [u, v] in pixels.
 * @param p2       Second projected point [u, v] in pixels.
 * @param pixPerMm Scale factor from `estimateScaleFromPose` (pixels per mm).
 *                 Must be > 0.
 * @returns        Distance in mm (always ≥ 0).
 */
export function getRealWorldDistance(
  p1: [number, number],
  p2: [number, number],
  pixPerMm: number,
): number {
  if (pixPerMm <= 0) return 0;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy) / pixPerMm;
}

/**
 * Project all remaining dome points to screen coords.
 * Returns an empty array if pose is null (tracking lost).
 */
export function projectDomePoints(
  points: { id: number; wx: number; wy: number; wz: number }[],
  pose: CameraPose | null,
  K: CameraIntrinsics,
  displayW: number,
  displayH: number,
): { id: number; sx: number; sy: number }[] {
  if (!pose) return [];
  const result: { id: number; sx: number; sy: number }[] = [];
  for (const pt of points) {
    const proj = projectPoint3D([pt.wx, pt.wy, pt.wz], pose, K);
    if (!proj) continue;
    const [sx, sy] = proj;
    // Cull points well off-screen (generous margin so near-edge dots appear)
    if (sx < -80 || sx > displayW + 80 || sy < -80 || sy > displayH + 80) continue;
    result.push({ id: pt.id, sx, sy });
  }
  return result;
}

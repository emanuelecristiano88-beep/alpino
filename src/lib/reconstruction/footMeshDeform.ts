/**
 * Per-region controlled deformation of the foot base mesh.
 *
 * Given a FootMeshRegions descriptor (from footMeshRegions.ts) and a set
 * of per-region deformation parameters, this module displaces each vertex
 * proportionally to its region weight.  The result is a new position
 * buffer that can be applied to a Three.js BufferGeometry.
 *
 * Deformation model
 * -----------------
 * Each region supports the following independent axes:
 *
 *   scale  – uniform local scale relative to region centroid
 *   offset – translation (X, Y, Z) applied to all region vertices
 *   normal – displacement along the vertex normal direction
 *   twist  – rotation (radians) around the region's principal axis (Z)
 *
 * The deformations are blended by region weight so boundaries remain
 * smooth even under strong deformation.
 *
 * Usage
 * -----
 * ```ts
 * const geo     = buildFootBaseGeometry();
 * const regions = classifyFootMeshRegions(geo);
 *
 * const deformed = applyRegionDeformations(geo, regions, {
 *   toes:       { normalDisp: 0.015 },
 *   arch_inner: { scale: 1.08, offsetY: 0.02 },
 *   heel:       { scale: 0.95, normalDisp: -0.005 },
 * });
 *
 * geo.attributes.position.array.set(deformed);
 * geo.attributes.position.needsUpdate = true;
 * geo.computeVertexNormals();
 * ```
 */

import * as THREE from "three";
import type { FootMeshRegions, FootRegionId } from "./footMeshRegions";
import { FOOT_REGION_IDS } from "./footMeshRegions";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Deformation parameters for a single anatomical region.
 * All fields are optional; unspecified fields default to their identity values.
 */
export type RegionDeformParams = {
  /**
   * Uniform scale applied around the region centroid.
   * 1.0 = no change.  Typical range: 0.85–1.20.
   */
  scale?: number;

  /**
   * Rigid translation applied to all vertices in this region (world units).
   * Blended by vertex weight, so boundary vertices get partial displacement.
   */
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;

  /**
   * Displacement along the interpolated vertex normal (world units).
   * Positive = outward expansion, negative = inward compression.
   */
  normalDisp?: number;

  /**
   * Rotation around the region's Z-axis (radians).
   * Applied around the region centroid.  Useful for toe splay / heel varus.
   */
  twistZ?: number;
};

/** Per-region deformation map (only the regions you want to deform need entries). */
export type RegionDeformMap = Partial<Record<FootRegionId, RegionDeformParams>>;

/**
 * Options for the deformation pass.
 */
export type DeformOptions = {
  /**
   * When true, vertex normals stored in the geometry are used for normal
   * displacement.  When false, per-face normals are approximated from
   * neighbours (slower but more accurate for non-smooth meshes).
   * Default: true.
   */
  useStoredNormals?: boolean;

  /**
   * If true, the output positions are normalised back to the same bounding
   * box as the input (preserves the canonical scale of the base mesh).
   * Default: false.
   */
  preserveScale?: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Compute the centroid of a set of vertices. */
function regionCentroid(
  positions: Float32Array,
  indices: Uint32Array,
  weights: Float32Array
): THREE.Vector3 {
  let wx = 0, wy = 0, wz = 0, wTotal = 0;
  for (let i = 0; i < indices.length; i++) {
    const v  = indices[i];
    const w  = weights[i];
    wx     += positions[v*3]   * w;
    wy     += positions[v*3+1] * w;
    wz     += positions[v*3+2] * w;
    wTotal += w;
  }
  if (wTotal < 1e-12) return new THREE.Vector3(0, 0, 0);
  return new THREE.Vector3(wx / wTotal, wy / wTotal, wz / wTotal);
}

/** Rotation matrix around Z axis. */
function rotZ(angle: number): THREE.Matrix3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const m = new THREE.Matrix3();
  m.set(
    c, -s, 0,
    s,  c, 0,
    0,  0, 1
  );
  return m;
}

// ---------------------------------------------------------------------------
// Main deformation function
// ---------------------------------------------------------------------------

/**
 * Applies per-region deformations to a foot geometry.
 *
 * Returns a new `Float32Array` with the deformed vertex positions.
 * The caller is responsible for writing this back into the geometry's
 * position attribute and recomputing normals.
 *
 * The input geometry is **not** mutated.
 *
 * @param geometry  Source foot geometry (must have `position` and, if
 *                  `useStoredNormals`, also `normal` attributes).
 * @param regions   Region classification from `classifyFootMeshRegions`.
 * @param deforms   Per-region deformation parameters.
 * @param opts      Optional deformation options.
 */
export function applyRegionDeformations(
  geometry: THREE.BufferGeometry,
  regions: FootMeshRegions,
  deforms: RegionDeformMap,
  opts: DeformOptions = {}
): Float32Array {
  const { useStoredNormals = true, preserveScale = false } = opts;

  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  const nrmAttr = geometry.attributes.normal   as THREE.BufferAttribute | undefined;

  const srcPos = posAttr.array as Float32Array;
  const srcNrm = (useStoredNormals && nrmAttr)
    ? (nrmAttr.array as Float32Array)
    : null;

  const count   = regions.vertexCount;
  const outPos  = srcPos.slice(); // copy

  // --- Precompute region centroids and rotation matrices ------------------
  const centroids: Partial<Record<FootRegionId, THREE.Vector3>> = {};
  const rotMats:   Partial<Record<FootRegionId, THREE.Matrix3>>  = {};

  for (const rid of FOOT_REGION_IDS) {
    const p = deforms[rid];
    if (!p) continue;
    const g = regions.groups[rid];
    centroids[rid] = regionCentroid(srcPos, g.indices, g.weights);
    if (p.twistZ !== undefined && p.twistZ !== 0) {
      rotMats[rid] = rotZ(p.twistZ);
    }
  }

  // --- Per-vertex accumulation --------------------------------------------
  //
  // Strategy: for each region, iterate over its member vertices and
  // accumulate the weighted displacement into a delta buffer.  After all
  // regions are processed, add deltas to the original positions.
  //
  // Using a delta buffer means regions that share vertices (e.g.
  // top_surface and arch_inner) blend correctly.

  const deltaPos = new Float32Array(count * 3); // zero-initialised

  for (const rid of FOOT_REGION_IDS) {
    const p = deforms[rid];
    if (!p) continue;

    const g       = regions.groups[rid];
    const centroid = centroids[rid]!;
    const rotMat   = rotMats[rid];

    const scale   = p.scale    ?? 1.0;
    const offX    = p.offsetX  ?? 0;
    const offY    = p.offsetY  ?? 0;
    const offZ    = p.offsetZ  ?? 0;
    const nDisp   = p.normalDisp ?? 0;

    const doScale  = scale !== 1.0;
    const doOffset = offX !== 0 || offY !== 0 || offZ !== 0;
    const doNormal = nDisp !== 0 && srcNrm !== null;
    const doTwist  = rotMat !== undefined;

    if (!doScale && !doOffset && !doNormal && !doTwist) continue;

    const local = new THREE.Vector3();
    const disp  = new THREE.Vector3();

    for (let i = 0; i < g.indices.length; i++) {
      const v = g.indices[i];
      const w = g.weights[i];   // blend weight

      const ox = srcPos[v*3];
      const oy = srcPos[v*3+1];
      const oz = srcPos[v*3+2];

      disp.set(0, 0, 0);

      // --- Scale around centroid ---
      if (doScale) {
        local.set(
          ox - centroid.x,
          oy - centroid.y,
          oz - centroid.z
        );
        disp.addScaledVector(local, scale - 1.0);
      }

      // --- Twist around Z through centroid ---
      if (doTwist) {
        local.set(
          ox - centroid.x,
          oy - centroid.y,
          0
        );
        local.applyMatrix3(rotMat!);
        disp.x += local.x - (ox - centroid.x);
        disp.y += local.y - (oy - centroid.y);
      }

      // --- Normal displacement ---
      if (doNormal) {
        const nx = srcNrm![v*3];
        const ny = srcNrm![v*3+1];
        const nz = srcNrm![v*3+2];
        disp.x += nx * nDisp;
        disp.y += ny * nDisp;
        disp.z += nz * nDisp;
      }

      // --- Translation offset ---
      if (doOffset) {
        disp.x += offX;
        disp.y += offY;
        disp.z += offZ;
      }

      // Accumulate weighted delta
      deltaPos[v*3]   += disp.x * w;
      deltaPos[v*3+1] += disp.y * w;
      deltaPos[v*3+2] += disp.z * w;
    }
  }

  // Apply deltas
  for (let v = 0; v < count; v++) {
    outPos[v*3]   += deltaPos[v*3];
    outPos[v*3+1] += deltaPos[v*3+1];
    outPos[v*3+2] += deltaPos[v*3+2];
  }

  // --- Optional: re-normalise to original scale ---------------------------
  if (preserveScale) {
    // Compute original bbox
    let mnX =  Infinity, mnY =  Infinity, mnZ =  Infinity;
    let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
    for (let v = 0; v < count; v++) {
      const x = srcPos[v*3], y = srcPos[v*3+1], z = srcPos[v*3+2];
      if (x < mnX) mnX = x; if (x > mxX) mxX = x;
      if (y < mnY) mnY = y; if (y > mxY) mxY = y;
      if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
    }
    const origMax = Math.max(mxX-mnX, mxY-mnY, mxZ-mnZ, 1e-6);

    // Compute deformed bbox
    let dmX =  Infinity, dmY =  Infinity, dmZ =  Infinity;
    let dMX = -Infinity, dMY = -Infinity, dMZ = -Infinity;
    for (let v = 0; v < count; v++) {
      const x = outPos[v*3], y = outPos[v*3+1], z = outPos[v*3+2];
      if (x < dmX) dmX = x; if (x > dMX) dMX = x;
      if (y < dmY) dmY = y; if (y > dMY) dMY = y;
      if (z < dmZ) dmZ = z; if (z > dMZ) dMZ = z;
    }
    const defMax = Math.max(dMX-dmX, dMY-dmY, dMZ-dmZ, 1e-6);

    const rescale = origMax / defMax;
    if (Math.abs(rescale - 1) > 1e-4) {
      for (let i = 0; i < outPos.length; i++) outPos[i] *= rescale;
    }
  }

  return outPos;
}

// ---------------------------------------------------------------------------
// Convenience: apply deformed positions back to a geometry in-place
// ---------------------------------------------------------------------------

/**
 * Applies region deformations directly to `geometry` (mutates position
 * buffer and recomputes vertex normals).
 *
 * Returns the same geometry for chaining.
 */
export function deformGeometryInPlace(
  geometry: THREE.BufferGeometry,
  regions: FootMeshRegions,
  deforms: RegionDeformMap,
  opts: DeformOptions = {}
): THREE.BufferGeometry {
  const newPos = applyRegionDeformations(geometry, regions, deforms, opts);
  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  (posAttr.array as Float32Array).set(newPos);
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// Preset deformation profiles for common clinical / fitting scenarios
// ---------------------------------------------------------------------------

/**
 * Predefined deformation profiles. Each is a `RegionDeformMap` ready to
 * pass to `applyRegionDeformations`.
 */
export const DEFORM_PRESETS: Readonly<Record<string, RegionDeformMap>> = {

  /** Flat foot (pes planus): depresses the inner arch, broadens heel. */
  flat_foot: {
    arch_inner: { offsetY: -0.025, scale: 1.05 },
    heel:       { scale: 1.04, offsetY: -0.010 },
    forefoot:   { scale: 1.03 },
  },

  /** High arch (pes cavus): exaggerates arch height, narrows mid-foot. */
  high_arch: {
    arch_inner: { offsetY: 0.030, scale: 0.92 },
    arch_outer: { offsetY: 0.012, scale: 0.94 },
    heel:       { scale: 0.96 },
  },

  /** Wide forefoot / bunion tendency: expands the ball of the foot. */
  wide_forefoot: {
    forefoot:   { scale: 1.12 },
    toes:       { scale: 1.06 },
  },

  /** Heel varus (inward tilt): twists heel medially. */
  heel_varus: {
    heel:       { twistZ: 0.12 },
  },

  /** Toe spread: fans the toes outward by expanding in X. */
  toe_spread: {
    toes:       { scale: 1.08, offsetX: 0.008 },
  },

  /** Dorsal oedema: inflates the top surface. */
  dorsal_oedema: {
    top_surface: { normalDisp: 0.018 },
  },
};

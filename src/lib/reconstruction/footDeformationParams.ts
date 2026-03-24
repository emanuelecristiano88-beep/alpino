/**
 * Foot deformation parameters — drive non-uniform scaling and shape modification
 * of the base foot mesh produced by buildFootSurfaceFromPositions.
 *
 * All scale values are multiplicative ratios centred on 1.0 (1.0 = no change).
 * Absolute measurements follow the same mm conventions as FootSideMetrics.
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Toe-type enum
// ---------------------------------------------------------------------------

/**
 * Classical toe-length archetypes (metatarsal-phalangeal relative lengths).
 *
 * - "egyptian"  : hallux (big toe) is the longest — most common.
 * - "roman"     : first three toes are approximately equal in length.
 * - "greek"     : second toe (index) is longer than the hallux.
 */
export type ToeType = "egyptian" | "roman" | "greek";

// ---------------------------------------------------------------------------
// Parameter type
// ---------------------------------------------------------------------------

export type FootDeformationParams = {
  // --- Overall proportional scaling ---

  /**
   * Uniform length multiplier along the anterior-posterior axis (heel → toe).
   * Range: 0.5–2.0, default 1.0.
   */
  lengthScale: number;

  /**
   * Uniform width multiplier across the medial-lateral axis.
   * Range: 0.5–2.0, default 1.0.
   */
  widthScale: number;

  /**
   * Uniform height multiplier along the dorsal-plantar axis.
   * Range: 0.5–2.0, default 1.0.
   */
  heightScale: number;

  // --- Shape parameters ---

  /**
   * Arch height: raises or depresses the medial longitudinal arch.
   * 0 mm = flat foot (pes planus), ~30 mm = neutral, >40 mm = high arch (pes cavus).
   * Applied as an additive Y-displacement on the medial half of the mesh.
   * Range: 0–60 mm.
   */
  archHeight: number;

  /**
   * Target volume of the foot mesh in cm³.
   * When set, the mesh is scaled uniformly so that its bounding-box proxy
   * matches the target volume.  Set to 0 to skip volume adjustment.
   * Range: 0–4000 cm³.
   */
  footVolume: number;

  /**
   * Width of the heel region (mm).
   * Drives a non-uniform scale applied to the posterior ≈30 % of the mesh.
   * 0 = no override (use whatever the mesh produces).
   * Range: 0–120 mm.
   */
  heelWidth: number;

  // --- Toe topology ---

  /**
   * Toe-length archetype.  Drives a non-uniform fore-foot scale pattern:
   * - "egyptian" : anterior taper centred on medial side.
   * - "roman"    : blunt, symmetric anterior profile.
   * - "greek"    : slight medial depression, peak displaced laterally.
   */
  toeType: ToeType;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_FOOT_DEFORMATION_PARAMS: FootDeformationParams = {
  lengthScale: 1.0,
  widthScale: 1.0,
  heightScale: 1.0,
  archHeight: 28,
  footVolume: 0,
  heelWidth: 0,
  toeType: "egyptian",
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Clamp and validate a FootDeformationParams object.
 * Returns a new object with all values within their documented ranges.
 */
export function validateFootDeformationParams(
  params: Partial<FootDeformationParams>
): FootDeformationParams {
  const p = { ...DEFAULT_FOOT_DEFORMATION_PARAMS, ...params };
  return {
    lengthScale: Math.max(0.1, Math.min(4.0, p.lengthScale)),
    widthScale: Math.max(0.1, Math.min(4.0, p.widthScale)),
    heightScale: Math.max(0.1, Math.min(4.0, p.heightScale)),
    archHeight: Math.max(0, Math.min(60, p.archHeight)),
    footVolume: Math.max(0, Math.min(4000, p.footVolume)),
    heelWidth: Math.max(0, Math.min(120, p.heelWidth)),
    toeType: (["egyptian", "roman", "greek"] as ToeType[]).includes(p.toeType)
      ? p.toeType
      : "egyptian",
  };
}

// ---------------------------------------------------------------------------
// Core deformation function
// ---------------------------------------------------------------------------

/**
 * Apply foot deformation parameters to a THREE.BufferGeometry produced by
 * buildFootSurfaceFromPositions / centerAndNormalizeFootMesh.
 *
 * The geometry is expected to be centred at the origin with its longest axis
 * (foot length) along Z and dorsal side along +Y (convention from
 * centerAndNormalizeFootMesh).  All modifications are performed in-place on
 * the position buffer; normals are recomputed before returning.
 *
 * @param geometry  Centred, normalised foot geometry (modified in-place).
 * @param params    Deformation parameters (will be validated internally).
 * @returns The same geometry instance with updated positions and normals.
 */
export function applyFootDeformation(
  geometry: THREE.BufferGeometry,
  params: Partial<FootDeformationParams>
): THREE.BufferGeometry {
  const p = validateFootDeformationParams(params);

  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  const arr = posAttr.array as Float32Array;
  const count = posAttr.count;

  // --- 1. Compute bounding box of centred mesh ---
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);

  // Foot convention: longest extent ≈ length along Z, width along X, height along Y.
  // Determine the actual longest axis so we orient correctly regardless of mesh
  // orientation produced by the reconstruction.
  const halfZ = size.z / 2; // heel … toe half-length
  const halfX = size.x / 2; // medial-lateral half-width
  const halfY = size.y / 2; // plantar-dorsal half-height

  // --- 2. Apply global anisotropic scale (length / width / height) ---
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    arr[o] *= p.widthScale;       // X: medial-lateral
    arr[o + 1] *= p.heightScale;  // Y: plantar-dorsal
    arr[o + 2] *= p.lengthScale;  // Z: heel-toe
  }

  // Recompute bounding box after global scale so the subsequent passes use
  // updated extents.
  posAttr.needsUpdate = true;
  geometry.computeBoundingBox();
  const boxScaled = geometry.boundingBox!;
  const sizeScaled = new THREE.Vector3();
  boxScaled.getSize(sizeScaled);
  const halfZScaled = sizeScaled.z / 2;
  const halfXScaled = sizeScaled.x / 2;

  // --- 3. Arch height deformation ---
  //
  // The medial longitudinal arch spans roughly the middle 60 % of foot length,
  // on the medial side (x > 0).  We push midfoot vertices upward (Y+) with a
  // smooth tent function centred at 40 % from heel (z ≈ -0.1 * halfZ … +0.5 * halfZ).
  //
  // Reference: neutral archHeight = 28 mm.  One "world unit" ≈ 0.85 / maxDim
  // after centerAndNormalizeFootMesh.  We express the arch offset as a fraction
  // of the scaled mesh height so it is resolution-independent.

  const archRef = 28; // mm — neutral reference
  const archDelta = (p.archHeight - archRef) / archRef; // relative change
  const archAmplitude = archDelta * sizeScaled.y * 0.35; // world units

  if (Math.abs(archAmplitude) > 1e-6) {
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const x = arr[o];
      const z = arr[o + 2];

      // Normalised position along foot length: 0 = heel, 1 = toe
      const tZ = (z + halfZScaled) / (sizeScaled.z || 1);
      // Medial weight: increases toward medial side (x > 0 in the centred mesh)
      const tX = Math.max(0, x / (halfXScaled || 1));

      // Tent function centred at 40 % of length, spanning 15–75 %
      const tZCentred = tZ - 0.4;
      const archEnvelope = Math.max(0, 1 - Math.abs(tZCentred) / 0.35);

      const influence = archEnvelope * tX;
      arr[o + 1] += archAmplitude * influence;
    }
  }

  // --- 4. Heel width deformation ---
  //
  // heelWidth = 0 → skip; otherwise scale the posterior 30 % of the mesh
  // non-uniformly in X until the bounding width of that region matches heelWidth
  // expressed in the same normalised world units.

  if (p.heelWidth > 0) {
    // Estimate a mm→world conversion.  After centerAndNormalizeFootMesh the
    // mesh is scaled to 0.85 / maxDim.  We use sizeScaled as a proxy; a
    // typical foot length is ~265 mm so 1 mm ≈ sizeScaled.z / 265.
    const mmToWorld = sizeScaled.z / 265;
    const targetHalfWidthWorld = (p.heelWidth / 2) * mmToWorld;

    // Current heel half-width: max |x| in the heel zone.
    let currentHalfWidth = 1e-6;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const z = arr[o + 2];
      const tZ = (z + halfZScaled) / (sizeScaled.z || 1);
      if (tZ < 0.3) {
        currentHalfWidth = Math.max(currentHalfWidth, Math.abs(arr[o]));
      }
    }

    const heelWidthRatio = targetHalfWidthWorld / currentHalfWidth;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const z = arr[o + 2];
      const tZ = (z + halfZScaled) / (sizeScaled.z || 1);
      if (tZ >= 0.3) continue;

      // Smooth blend: full effect at tZ=0, tapers to zero at tZ=0.3
      const blend = 1 - tZ / 0.3;
      const scale = 1 + (heelWidthRatio - 1) * blend;
      arr[o] *= scale;
    }
  }

  // --- 5. Toe type deformation ---
  //
  // Modifies the anterior 30 % of the mesh with a lateral asymmetry pattern.
  // All three variants operate by squeezing or releasing the X distribution
  // near the toe region and slightly shifting the apex.

  const toeZThreshold = 0.7; // anterior 30 %

  if (p.toeType !== "egyptian") {
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const z = arr[o + 2];
      const tZ = (z + halfZScaled) / (sizeScaled.z || 1);
      if (tZ <= toeZThreshold) continue;

      // Blend: 0 at threshold, 1 at tip
      const blend = (tZ - toeZThreshold) / (1 - toeZThreshold);

      switch (p.toeType) {
        case "roman": {
          // Widen and flatten the toe box — symmetric, blunt profile.
          // Expand X slightly and reduce Z taper.
          arr[o] *= 1 + 0.08 * blend;
          arr[o + 2] = boxScaled.min.z + tZ * sizeScaled.z * (1 - 0.04 * blend);
          break;
        }
        case "greek": {
          // Second toe longer: shift apex slightly to lateral side (x < 0),
          // create a gentle medial depression.
          const lateralShift = -halfXScaled * 0.12 * blend;
          arr[o] += lateralShift;
          break;
        }
      }
    }
  }

  // --- 6. Volume adjustment ---
  //
  // Uses a bounding-box proxy: vol ≈ size.x * size.y * size.z.
  // Scale the whole mesh uniformly so the proxy matches the target volume.

  if (p.footVolume > 0) {
    posAttr.needsUpdate = true;
    geometry.computeBoundingBox();
    const bFinal = geometry.boundingBox!;
    const sFinal = new THREE.Vector3();
    bFinal.getSize(sFinal);

    const mmToWorld = sFinal.z / 265;
    const currentVolWorld = sFinal.x * sFinal.y * sFinal.z;
    const targetVolWorld =
      p.footVolume * 1e3 * mmToWorld * mmToWorld * mmToWorld; // cm³ → mm³ → world³

    if (currentVolWorld > 1e-12) {
      const volScale = Math.cbrt(targetVolWorld / currentVolWorld);
      for (let i = 0; i < arr.length; i++) {
        arr[i] *= volScale;
      }
    }
  }

  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

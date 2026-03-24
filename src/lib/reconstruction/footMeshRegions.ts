/**
 * Foot mesh region classification.
 *
 * Assigns every vertex of a foot BufferGeometry to one of six
 * anatomical regions and stores the results as named vertex groups
 * (index arrays + weight maps).
 *
 * Regions
 * -------
 *  toes        – distal phalanges and toe pads
 *  forefoot    – metatarsal heads and ball of foot
 *  arch_inner  – medial longitudinal arch (navicular, cuneiform side)
 *  arch_outer  – lateral column (cuboid, 5th metatarsal base)
 *  heel        – calcaneus and posterior heel cup
 *  top_surface – full dorsal surface (can overlap other regions)
 *
 * Coordinate space
 * ----------------
 * The geometry produced by buildFootBaseGeometry() is centred at the
 * origin with the long axis along Z:
 *   Z < 0  → heel
 *   Z > 0  → toes
 *   Y > 0  → dorsal (top)
 *   Y < 0  → plantar (sole)
 *   X < 0  → medial (inner, for a right foot)
 *   X > 0  → lateral (outer)
 *
 * All Z / Y / X thresholds below are expressed as fractions of the
 * geometry's bounding-box extents so the same classifier works on any
 * proportionally-built mesh.
 */

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Identifier for each anatomical region. */
export type FootRegionId =
  | "toes"
  | "forefoot"
  | "arch_inner"
  | "arch_outer"
  | "heel"
  | "top_surface";

export const FOOT_REGION_IDS: FootRegionId[] = [
  "toes",
  "forefoot",
  "arch_inner",
  "arch_outer",
  "heel",
  "top_surface",
];

/**
 * A vertex group: a subset of the mesh vertices with associated blend
 * weights (0.0–1.0).  Weights are stored parallel to `indices` so that
 * index[i] is the vertex index and weight[i] its influence.
 */
export type VertexGroup = {
  readonly id: FootRegionId;
  /** Sorted vertex indices belonging to this group. */
  readonly indices: Uint32Array;
  /** Per-vertex influence weight in [0, 1]. */
  readonly weights: Float32Array;
};

/**
 * The complete region map for a foot mesh.
 */
export type FootMeshRegions = {
  /** One entry per anatomical region. */
  readonly groups: Readonly<Record<FootRegionId, VertexGroup>>;
  /**
   * For every vertex, the primary region it belongs to
   * (the region with the highest weight).
   */
  readonly primaryRegion: Uint8Array;
  /**
   * Index mapping from FootRegionId → Uint8 value used in `primaryRegion`.
   * Index 0 = "toes", 1 = "forefoot", …  (same order as FOOT_REGION_IDS).
   */
  readonly regionIndex: Readonly<Record<FootRegionId, number>>;
  /** Total number of vertices in the mesh. */
  readonly vertexCount: number;
};

// ---------------------------------------------------------------------------
// Thresholds (fractions of bounding box extents)
// ---------------------------------------------------------------------------

/**
 * Tunable thresholds for region classification, expressed as normalised
 * fractions of the geometry's bounding-box dimensions.
 *
 * These defaults correspond to typical human foot proportions and match
 * the cross-section landmarks in footBaseGeometry.ts.
 */
export type RegionThresholds = {
  /** Z fraction above which vertices are classified as toes. */
  toesZMin: number;
  /** Z fraction above which vertices are classified as forefoot. */
  forefootZMin: number;
  /** Z fraction below which vertices are classified as heel. */
  heelZMax: number;
  /** Z range for the arch band: [archZMin, archZMax] (between heel and forefoot). */
  archZMin: number;
  archZMax: number;
  /**
   * X fraction of half-width below which (medial side) a vertex in the arch
   * band is classified as arch_inner; above is arch_outer.
   * 0 = centreline, 1 = full lateral width.
   */
  archInnerXMax: number;
  /**
   * Y fraction above which a vertex is additionally tagged as top_surface.
   * Measured from the bottom of the bounding box.
   */
  topSurfaceYMin: number;
  /**
   * Width of soft boundary zones (fraction of bbox extent) used when
   * computing blend weights via smoothstep fall-off.
   */
  blendWidth: number;
};

export const DEFAULT_REGION_THRESHOLDS: RegionThresholds = {
  toesZMin:       0.72,
  forefootZMin:   0.48,
  heelZMax:       0.22,
  archZMin:       0.22,
  archZMax:       0.58,
  archInnerXMax:  0.10,  // medial half of the arch band
  topSurfaceYMin: 0.60,  // top 40 % of vertical extent
  blendWidth:     0.08,
};

// ---------------------------------------------------------------------------
// Weight computation
// ---------------------------------------------------------------------------

/** Smooth-step in [0,1]. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type BBox = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

/**
 * Computes per-vertex region weights for all six regions.
 * Each region weight is in [0,1]; they do NOT necessarily sum to 1
 * (a vertex on the dorsal arch will have weight in both arch_inner and
 * top_surface, for example).
 */
function computeRawWeights(
  positions: Float32Array,
  count: number,
  bbox: BBox,
  thr: RegionThresholds
): Record<FootRegionId, Float32Array> {
  const extX = Math.max(bbox.maxX - bbox.minX, 1e-6);
  const extY = Math.max(bbox.maxY - bbox.minY, 1e-6);
  const extZ = Math.max(bbox.maxZ - bbox.minZ, 1e-6);

  const weights: Record<FootRegionId, Float32Array> = {
    toes:        new Float32Array(count),
    forefoot:    new Float32Array(count),
    arch_inner:  new Float32Array(count),
    arch_outer:  new Float32Array(count),
    heel:        new Float32Array(count),
    top_surface: new Float32Array(count),
  };

  const bw = thr.blendWidth;

  for (let i = 0; i < count; i++) {
    const wx = (positions[i*3]   - bbox.minX) / extX;   // 0=medial, 1=lateral
    const wy = (positions[i*3+1] - bbox.minY) / extY;   // 0=plantar, 1=dorsal
    const wz = (positions[i*3+2] - bbox.minZ) / extZ;   // 0=heel, 1=toe

    // --- toes ---
    weights.toes[i] = smoothstep(thr.toesZMin - bw, thr.toesZMin + bw, wz);

    // --- forefoot (between toes Z boundary and arch end) ---
    const ffIn  = smoothstep(thr.forefootZMin - bw, thr.forefootZMin + bw, wz);
    const ffOut = 1 - smoothstep(thr.toesZMin - bw, thr.toesZMin + bw, wz);
    weights.forefoot[i] = ffIn * ffOut;

    // --- heel ---
    weights.heel[i] = 1 - smoothstep(thr.heelZMax - bw, thr.heelZMax + bw, wz);

    // --- arch band: Z between heelZMax and forefootZMin ---
    const archBandIn  = smoothstep(thr.archZMin - bw, thr.archZMin + bw, wz);
    const archBandOut = 1 - smoothstep(thr.archZMax - bw, thr.archZMax + bw, wz);
    const archBand    = archBandIn * archBandOut;

    // --- arch_inner: medial side (low X in normalised space) ---
    const medialWeight = 1 - smoothstep(
      thr.archInnerXMax - bw,
      thr.archInnerXMax + bw,
      wx
    );
    weights.arch_inner[i] = archBand * medialWeight;

    // --- arch_outer: lateral side ---
    const lateralWeight = smoothstep(
      thr.archInnerXMax - bw,
      thr.archInnerXMax + bw,
      wx
    );
    weights.arch_outer[i] = archBand * lateralWeight;

    // --- top_surface: dorsal vertices across any Z ---
    weights.top_surface[i] = smoothstep(thr.topSurfaceYMin - bw, thr.topSurfaceYMin + bw, wy);
  }

  return weights;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classifies every vertex of `geometry` into anatomical regions and
 * returns a `FootMeshRegions` descriptor.
 *
 * The geometry must have a `position` attribute.  It does not need to be
 * indexed.  A bounding box is computed internally.
 *
 * @param geometry   Three.js BufferGeometry (typically from buildFootBaseGeometry)
 * @param thresholds Optional tuning of region boundaries
 */
export function classifyFootMeshRegions(
  geometry: THREE.BufferGeometry,
  thresholds?: Partial<RegionThresholds>
): FootMeshRegions {
  const thr: RegionThresholds = { ...DEFAULT_REGION_THRESHOLDS, ...thresholds };

  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  if (!posAttr) {
    throw new Error("footMeshRegions: geometry has no position attribute");
  }

  const positions  = posAttr.array as Float32Array;
  const count      = posAttr.count;

  // Compute bounding box
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const bbox: BBox = {
    minX: box.min.x, maxX: box.max.x,
    minY: box.min.y, maxY: box.max.y,
    minZ: box.min.z, maxZ: box.max.z,
  };

  // Compute raw per-vertex weights for all regions
  const rawWeights = computeRawWeights(positions, count, bbox, thr);

  // Build per-region index lists and normalise weights
  const regionIndex: Record<FootRegionId, number> = {
    toes:        0,
    forefoot:    1,
    arch_inner:  2,
    arch_outer:  3,
    heel:        4,
    top_surface: 5,
  };

  // primaryRegion: for each vertex, find the region with max weight
  const primaryRegion = new Uint8Array(count);

  // We'll collect vertex indices per region (membership = weight > threshold)
  const membershipThreshold = 0.05;
  const tempIndices: Record<FootRegionId, number[]> = {
    toes: [], forefoot: [], arch_inner: [], arch_outer: [], heel: [], top_surface: [],
  };
  const tempWeights: Record<FootRegionId, number[]> = {
    toes: [], forefoot: [], arch_inner: [], arch_outer: [], heel: [], top_surface: [],
  };

  for (let v = 0; v < count; v++) {
    let maxW    = -Infinity;
    let maxReg: FootRegionId = "heel";

    for (const rid of FOOT_REGION_IDS) {
      const w = rawWeights[rid][v];
      if (w > membershipThreshold) {
        tempIndices[rid].push(v);
        tempWeights[rid].push(w);
      }
      if (w > maxW) { maxW = w; maxReg = rid; }
    }

    primaryRegion[v] = regionIndex[maxReg];
  }

  // Materialise into typed arrays
  const groups = {} as Record<FootRegionId, VertexGroup>;
  for (const rid of FOOT_REGION_IDS) {
    const idxArr = new Uint32Array(tempIndices[rid]);
    const wArr   = new Float32Array(tempWeights[rid]);
    groups[rid] = { id: rid, indices: idxArr, weights: wArr };
  }

  return {
    groups,
    primaryRegion,
    regionIndex,
    vertexCount: count,
  };
}

// ---------------------------------------------------------------------------
// Debug / visualisation helpers
// ---------------------------------------------------------------------------

/**
 * Colour palette for the six regions (RGB, 0–1).
 * Useful for painting a vertex-colour debug layer.
 */
export const REGION_DEBUG_COLORS: Readonly<Record<FootRegionId, readonly [number, number, number]>> = {
  toes:        [1.00, 0.55, 0.10],   // amber
  forefoot:    [0.20, 0.75, 0.35],   // green
  arch_inner:  [0.25, 0.50, 1.00],   // blue
  arch_outer:  [0.55, 0.25, 1.00],   // violet
  heel:        [1.00, 0.22, 0.22],   // red
  top_surface: [0.85, 0.85, 0.85],   // light grey
};

/**
 * Writes per-vertex RGB colours encoding the primary anatomical region
 * into a pre-allocated Float32Array (3 floats per vertex, interleaved).
 *
 * If the geometry already has a `color` attribute with the right size it
 * is reused; otherwise a new attribute is set on the geometry.
 */
export function paintRegionColors(
  geometry: THREE.BufferGeometry,
  regions: FootMeshRegions
): void {
  const n       = regions.vertexCount;
  const colors  = new Float32Array(n * 3);

  for (let v = 0; v < n; v++) {
    const rid = FOOT_REGION_IDS[regions.primaryRegion[v]];
    const c   = REGION_DEBUG_COLORS[rid];
    colors[v*3]   = c[0];
    colors[v*3+1] = c[1];
    colors[v*3+2] = c[2];
  }

  if (
    geometry.attributes.color &&
    (geometry.attributes.color as THREE.BufferAttribute).array.length === colors.length
  ) {
    (geometry.attributes.color as THREE.BufferAttribute).array.set(colors);
    (geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  } else {
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
}

/**
 * Returns a human-readable summary of region membership counts.
 */
export function describeRegions(regions: FootMeshRegions): string {
  const total = regions.vertexCount;
  const lines = FOOT_REGION_IDS.map((rid) => {
    const g   = regions.groups[rid];
    const pct = ((g.indices.length / total) * 100).toFixed(1);
    return `  ${rid.padEnd(12)} ${g.indices.length} vertices (${pct}%)`;
  });
  return `FootMeshRegions (${total} vertices total):\n${lines.join("\n")}`;
}

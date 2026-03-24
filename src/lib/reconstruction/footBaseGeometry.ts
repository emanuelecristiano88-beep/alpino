/**
 * Base foot mesh geometry builder.
 *
 * Produces a clean, parametric foot mesh in normalised world space
 * (longest axis ≈ 1.0, Y-up, heel at -Z, toes at +Z).
 *
 * The mesh is built from a set of anatomically-motivated cross-section
 * ellipses stacked along the Z (length) axis, bridged with indexed
 * triangle strips, and capped at both ends.  No external dependencies
 * beyond Three.js (already in the project).
 *
 * Coordinate conventions (normalised, heel → toe):
 *   +Z  toe direction
 *   -Z  heel
 *   +Y  dorsal (top surface)
 *   -Y  plantar (sole)
 *   ±X  medial / lateral width
 */

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Anatomical proportions of the foot, all relative to foot length = 1.0. */
export type FootProportions = {
  /** Total length along Z (always 1.0 in normalised space). */
  length: number;
  /** Maximum width at metatarsal heads. */
  forefootWidth: number;
  /** Width at the heel. */
  heelWidth: number;
  /** Width at the arch waist. */
  archWidth: number;
  /** Arch height (Y) at the waist — inner longitudinal arch rise. */
  archHeightInner: number;
  /** Outer arch height (Y) — typically near-flat. */
  archHeightOuter: number;
  /** Dorsal height at metatarsals. */
  dorsalHeightForefoot: number;
  /** Dorsal height at heel. */
  dorsalHeightHeel: number;
  /** Toe cluster half-length along Z. */
  toeLength: number;
};

export const DEFAULT_FOOT_PROPORTIONS: FootProportions = {
  length: 1.0,
  forefootWidth: 0.38,
  heelWidth: 0.28,
  archWidth: 0.26,
  archHeightInner: 0.072,
  archHeightOuter: 0.018,
  dorsalHeightForefoot: 0.095,
  dorsalHeightHeel: 0.11,
  toeLength: 0.155,
};

export type FootBaseGeometryOptions = {
  /** Anatomical proportions (normalised). */
  proportions?: Partial<FootProportions>;
  /**
   * Number of cross-section slices along the length axis.
   * More slices → smoother curvature and finer region boundaries.
   * Recommended: 32–64.
   */
  lengthSegments?: number;
  /**
   * Number of vertices around each cross-section ellipse.
   * Recommended: 20–32 (even).
   */
  radialSegments?: number;
  /** Laplacian smoothing passes applied after triangulation. */
  smoothPasses?: number;
  /** Laplacian lambda (0–1). */
  smoothLambda?: number;
};

export const DEFAULT_FOOT_BASE_GEOMETRY_OPTIONS: Required<FootBaseGeometryOptions> = {
  proportions: {},
  lengthSegments: 48,
  radialSegments: 24,
  smoothPasses: 3,
  smoothLambda: 0.35,
};

// ---------------------------------------------------------------------------
// Internal cross-section descriptor
// ---------------------------------------------------------------------------

type CrossSection = {
  /** Normalised Z position [0,1], 0 = heel, 1 = toe tip. */
  z: number;
  /** Half-width in X (medial-lateral). */
  halfWidth: number;
  /** Half-height below centre (plantar). */
  halfBottom: number;
  /** Half-height above centre (dorsal). */
  halfTop: number;
  /**
   * Vertical offset of the ellipse centre from the plantar ground plane (Y).
   * Used to model the arch: at mid-foot the inner arch lifts the centre up.
   */
  centerY: number;
  /**
   * Asymmetry factor (0 = symmetric, >0 = medial side higher).
   * Modulates inner arch curvature in X.
   */
  archAsymmetry: number;
};

// ---------------------------------------------------------------------------
// Cross-section profile builder
// ---------------------------------------------------------------------------

/**
 * Returns a set of cross-sections that capture the major anatomical landmarks
 * of a right foot:
 *
 *   heel cup → arch waist (inner rise, outer flat) → metatarsal heads →
 *   toe pad cluster → toe tips
 *
 * The Z axis is parameterised 0 (heel back) → 1 (toe tip).
 */
function buildCrossSections(p: FootProportions): CrossSection[] {
  const {
    forefootWidth,
    heelWidth,
    archWidth,
    archHeightInner,
    archHeightOuter,
    dorsalHeightForefoot,
    dorsalHeightHeel,
    toeLength,
  } = p;

  // Key Z landmarks (fraction of total length)
  const zHeel       = 0.00;  // posterior heel
  const zHeel2      = 0.08;  // rear of heel cup
  const zArchStart  = 0.22;  // arch begins
  const zArchMid    = 0.42;  // peak of inner arch
  const zArchEnd    = 0.58;  // arch ends, forefoot begins
  const zMeta       = 0.70;  // metatarsal heads
  const zToePad     = 0.84;  // toe pad base
  const zToeTip     = 1.00;  // distal tips

  // Plantar Y of the cross-section centre at each landmark
  // (height above sole ground, which is at Y = 0 before normalisation)
  const plantar = (archInn: number, _archOut: number) => archInn * 0.5;

  const cs: CrossSection[] = [
    // --- heel ---
    {
      z: zHeel,
      halfWidth:    heelWidth * 0.42,
      halfBottom:   0.042,
      halfTop:      dorsalHeightHeel * 0.80,
      centerY:      0.015,
      archAsymmetry: 0,
    },
    {
      z: zHeel2,
      halfWidth:    heelWidth * 0.50,
      halfBottom:   0.048,
      halfTop:      dorsalHeightHeel,
      centerY:      0.018,
      archAsymmetry: 0,
    },
    // --- arch start ---
    {
      z: zArchStart,
      halfWidth:    (heelWidth + archWidth) * 0.50,
      halfBottom:   0.038,
      halfTop:      dorsalHeightHeel * 0.92,
      centerY:      plantar(archHeightInner * 0.35, archHeightOuter * 0.12),
      archAsymmetry: 0.12,
    },
    // --- arch mid (peak of inner arch) ---
    {
      z: zArchMid,
      halfWidth:    archWidth * 0.50,
      halfBottom:   0.022,
      halfTop:      (dorsalHeightHeel + dorsalHeightForefoot) * 0.50,
      centerY:      plantar(archHeightInner, archHeightOuter),
      archAsymmetry: 0.32,
    },
    // --- arch end / forefoot start ---
    {
      z: zArchEnd,
      halfWidth:    (archWidth + forefootWidth) * 0.50,
      halfBottom:   0.032,
      halfTop:      dorsalHeightForefoot * 1.05,
      centerY:      plantar(archHeightInner * 0.5, archHeightOuter * 0.3),
      archAsymmetry: 0.18,
    },
    // --- metatarsal heads ---
    {
      z: zMeta,
      halfWidth:    forefootWidth * 0.50,
      halfBottom:   0.038,
      halfTop:      dorsalHeightForefoot,
      centerY:      plantar(archHeightInner * 0.25, archHeightOuter * 0.15),
      archAsymmetry: 0.10,
    },
    // --- toe pad base ---
    {
      z: zToePad,
      halfWidth:    forefootWidth * 0.44,
      halfBottom:   0.028,
      halfTop:      dorsalHeightForefoot * 0.72,
      centerY:      0.008,
      archAsymmetry: 0.04,
    },
    // --- toe tips ---
    {
      z: zToeTip,
      halfWidth:    forefootWidth * 0.20,
      halfBottom:   0.010,
      halfTop:      0.025,
      centerY:      0.005,
      archAsymmetry: 0,
    },
  ];

  return cs;
}

// ---------------------------------------------------------------------------
// Cross-section interpolation
// ---------------------------------------------------------------------------

function lerpCS(a: CrossSection, b: CrossSection, t: number): CrossSection {
  const s = 1 - t;
  return {
    z:              a.z * s + b.z * t,
    halfWidth:      a.halfWidth      * s + b.halfWidth      * t,
    halfBottom:     a.halfBottom     * s + b.halfBottom     * t,
    halfTop:        a.halfTop        * s + b.halfTop        * t,
    centerY:        a.centerY        * s + b.centerY        * t,
    archAsymmetry:  a.archAsymmetry  * s + b.archAsymmetry  * t,
  };
}

/**
 * Samples the cross-section profile at a uniform set of Z positions via
 * linear interpolation between the key landmarks.
 */
function sampleCrossSections(landmarks: CrossSection[], n: number): CrossSection[] {
  const result: CrossSection[] = [];
  for (let i = 0; i <= n; i++) {
    const z = i / n;
    // Find surrounding landmarks
    let lo = landmarks[0];
    let hi = landmarks[landmarks.length - 1];
    for (let k = 0; k < landmarks.length - 1; k++) {
      if (z >= landmarks[k].z && z <= landmarks[k + 1].z) {
        lo = landmarks[k];
        hi = landmarks[k + 1];
        break;
      }
    }
    const span = hi.z - lo.z;
    const t = span < 1e-9 ? 0 : (z - lo.z) / span;
    result.push(lerpCS(lo, hi, t));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ellipse vertex generation
// ---------------------------------------------------------------------------

/**
 * Generates the ring of vertices for one cross-section in XY plane.
 *
 * The ellipse uses an asymmetric Y profile to model the inner arch:
 * - bottom half: simple ellipse (plantar contact surface)
 * - top half:    slightly flattened ellipse (dorsal surface)
 * Asymmetry in X shifts the medial side upward to approximate the arch.
 */
function crossSectionRing(cs: CrossSection, radial: number): Array<[number, number, number]> {
  const verts: Array<[number, number, number]> = [];
  const zWorld = cs.z - 0.5; // centre the mesh at Z=0

  for (let j = 0; j <= radial; j++) {
    const theta = (j / radial) * Math.PI * 2;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Plantar = negative Y (sin < 0 half), dorsal = positive Y
    const halfY = sinT >= 0 ? cs.halfTop : cs.halfBottom;
    const x = cosT * cs.halfWidth;
    const yBase = sinT * halfY;

    // Arch asymmetry: medial side (negative X for right foot) lifts higher
    const archLift = cs.archAsymmetry * (-cosT) * Math.max(0, sinT);
    const y = cs.centerY + yBase + archLift;

    verts.push([x, y, zWorld]);
  }
  return verts;
}

// ---------------------------------------------------------------------------
// Geometry assembly
// ---------------------------------------------------------------------------

/**
 * Builds and returns a clean Three.js BufferGeometry representing the base
 * foot mesh in normalised space.
 */
export function buildFootBaseGeometry(
  opts?: FootBaseGeometryOptions
): THREE.BufferGeometry {
  const cfg: Required<FootBaseGeometryOptions> = {
    ...DEFAULT_FOOT_BASE_GEOMETRY_OPTIONS,
    ...opts,
    proportions: { ...DEFAULT_FOOT_BASE_GEOMETRY_OPTIONS.proportions, ...opts?.proportions },
  };

  const proportions: FootProportions = {
    ...DEFAULT_FOOT_PROPORTIONS,
    ...cfg.proportions,
  };

  const lengthSeg = Math.max(8, cfg.lengthSegments | 0);
  const radial    = Math.max(6, cfg.radialSegments  | 0);

  // --- 1. Sample cross-sections -----------------------------------------
  const landmarks = buildCrossSections(proportions);
  const slices    = sampleCrossSections(landmarks, lengthSeg);
  const nSlices   = slices.length; // lengthSeg + 1

  // --- 2. Build vertex grid ----------------------------------------------
  // Each slice has (radial + 1) vertices (first = last for UV continuity).
  // Total surface vertices: nSlices * (radial + 1)
  // Cap vertices: 1 center per cap
  const surfaceVertCount = nSlices * (radial + 1);
  const totalVertCount   = surfaceVertCount + 2; // + 2 cap centres

  const positions  = new Float32Array(totalVertCount * 3);
  const normals    = new Float32Array(totalVertCount * 3); // filled after
  const uvs        = new Float32Array(totalVertCount * 2);

  // Surface vertices
  for (let i = 0; i < nSlices; i++) {
    const cs   = slices[i];
    const ring = crossSectionRing(cs, radial);
    const uU   = i / (nSlices - 1);
    for (let j = 0; j <= radial; j++) {
      const vi   = (i * (radial + 1) + j) * 3;
      const uvi  = (i * (radial + 1) + j) * 2;
      positions[vi]     = ring[j][0];
      positions[vi + 1] = ring[j][1];
      positions[vi + 2] = ring[j][2];
      uvs[uvi]     = uU;
      uvs[uvi + 1] = j / radial;
    }
  }

  // Cap centre vertices
  const heelCapIdx = surfaceVertCount;     // index of heel cap centre
  const toeCapIdx  = surfaceVertCount + 1; // index of toe cap centre

  // Heel cap centre: average of heel ring
  {
    const heelCs = slices[0];
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < radial; j++) {
      sx += positions[j * 3];
      sy += positions[j * 3 + 1];
      sz += positions[j * 3 + 2];
    }
    const inv = 1 / radial;
    positions[heelCapIdx * 3]     = sx * inv;
    positions[heelCapIdx * 3 + 1] = sy * inv;
    positions[heelCapIdx * 3 + 2] = heelCs.z - 0.5;
    uvs[heelCapIdx * 2]     = 0;
    uvs[heelCapIdx * 2 + 1] = 0.5;
  }

  // Toe cap centre: average of toe ring
  {
    const toeCs   = slices[nSlices - 1];
    const baseOff = (nSlices - 1) * (radial + 1);
    let sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < radial; j++) {
      sx += positions[(baseOff + j) * 3];
      sy += positions[(baseOff + j) * 3 + 1];
      sz += positions[(baseOff + j) * 3 + 2];
    }
    const inv = 1 / radial;
    positions[toeCapIdx * 3]     = sx * inv;
    positions[toeCapIdx * 3 + 1] = sy * inv;
    positions[toeCapIdx * 3 + 2] = toeCs.z - 0.5;
    uvs[toeCapIdx * 2]     = 1;
    uvs[toeCapIdx * 2 + 1] = 0.5;
  }

  // --- 3. Build index buffer ---------------------------------------------
  // Surface quads: 2 triangles per quad, (nSlices-1) * radial quads
  const surfaceTris = (nSlices - 1) * radial * 2;
  const capTris     = radial * 2;       // heel + toe each have radial tris
  const indices     = new Uint32Array((surfaceTris + capTris) * 3);
  let   idx         = 0;

  for (let i = 0; i < nSlices - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i       * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      const c = a + 1;
      const d = b + 1;
      // Two triangles (consistent winding)
      indices[idx++] = a;
      indices[idx++] = b;
      indices[idx++] = c;
      indices[idx++] = c;
      indices[idx++] = b;
      indices[idx++] = d;
    }
  }

  // Heel cap (reverse winding so normal faces -Z)
  for (let j = 0; j < radial; j++) {
    indices[idx++] = heelCapIdx;
    indices[idx++] = (j + 1) % radial;
    indices[idx++] = j;
  }

  // Toe cap (normal faces +Z)
  const toeBase = (nSlices - 1) * (radial + 1);
  for (let j = 0; j < radial; j++) {
    indices[idx++] = toeCapIdx;
    indices[idx++] = toeBase + j;
    indices[idx++] = toeBase + (j + 1) % radial;
  }

  // --- 4. Assemble BufferGeometry ----------------------------------------
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv",       new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  // --- 5. Merge duplicate vertices & smooth ------------------------------
  let result = mergeVertices(geo, 1e-5);
  geo.dispose();

  if (cfg.smoothPasses > 0) {
    result = _laplacianSmooth(result, cfg.smoothPasses, cfg.smoothLambda);
  }

  // --- 6. Final normalisation -------------------------------------------
  result = _centerAndNormalize(result);

  return result;
}

// ---------------------------------------------------------------------------
// Smoothing helpers (local, avoids circular dependency with footSurfaceMesh)
// ---------------------------------------------------------------------------

function _buildNeighbors(index: THREE.BufferAttribute, n: number): Set<number>[] {
  const nbr: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  const arr = index.array as ArrayLike<number>;
  for (let i = 0; i < index.count; i += 3) {
    const a = arr[i], b = arr[i + 1], c = arr[i + 2];
    nbr[a].add(b); nbr[a].add(c);
    nbr[b].add(a); nbr[b].add(c);
    nbr[c].add(a); nbr[c].add(b);
  }
  return nbr;
}

function _laplacianSmooth(
  geo: THREE.BufferGeometry,
  passes: number,
  lambda: number
): THREE.BufferGeometry {
  const idx = geo.index;
  if (!idx) { geo.computeVertexNormals(); return geo; }

  const n   = geo.attributes.position.count;
  const nbr = _buildNeighbors(idx, n);
  const pos = geo.attributes.position.array as Float32Array;
  const tmp = new Float32Array(pos.length);

  for (let it = 0; it < passes; it++) {
    for (let v = 0; v < n; v++) {
      const ns = nbr[v];
      if (ns.size === 0) {
        tmp[v*3] = pos[v*3]; tmp[v*3+1] = pos[v*3+1]; tmp[v*3+2] = pos[v*3+2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      ns.forEach(j => { sx += pos[j*3]; sy += pos[j*3+1]; sz += pos[j*3+2]; });
      const k  = ns.size;
      const ox = pos[v*3], oy = pos[v*3+1], oz = pos[v*3+2];
      tmp[v*3]   = (1-lambda)*ox + lambda*(sx/k);
      tmp[v*3+1] = (1-lambda)*oy + lambda*(sy/k);
      tmp[v*3+2] = (1-lambda)*oz + lambda*(sz/k);
    }
    pos.set(tmp);
  }

  (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function _centerAndNormalize(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return geo;

  const center = new THREE.Vector3();
  box.getCenter(center);
  const pos = geo.attributes.position.array as Float32Array;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]   -= center.x;
    pos[i+1] -= center.y;
    pos[i+2] -= center.z;
  }
  (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale  = 1.0 / maxDim;
  for (let i = 0; i < pos.length; i++) pos[i] *= scale;
  (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;

  geo.computeVertexNormals();
  return geo;
}

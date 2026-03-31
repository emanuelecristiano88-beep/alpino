/**
 * Lightweight 3×3 symmetric eigendecomposition + PCA helpers (no external deps).
 * Used for multi-view alignment without ICP.
 */

/** Symmetric 3×3 as [c00,c01,c02,c11,c12,c22] */
export type Sym3 = readonly [number, number, number, number, number, number];

export function symMatVec(C: Sym3, x: number, y: number, z: number): [number, number, number] {
  const [c00, c01, c02, c11, c12, c22] = C;
  return [
    c00 * x + c01 * y + c02 * z,
    c01 * x + c11 * y + c12 * z,
    c02 * x + c12 * y + c22 * z,
  ];
}

export function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm3(v: [number, number, number]): number {
  return Math.sqrt(dot3(v, v));
}

export function normalize3(v: [number, number, number]): [number, number, number] {
  const n = norm3(v);
  if (n < 1e-12) return [1, 0, 0];
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Covariance of centered n×3 points (row-major buffer, count points). */
export function covarianceSym3(positions: Float32Array, count: number): Sym3 {
  if (count < 2) {
    return [1, 0, 0, 1, 0, 1];
  }
  const inv = 1 / count;
  let c00 = 0;
  let c01 = 0;
  let c02 = 0;
  let c11 = 0;
  let c12 = 0;
  let c22 = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const z = positions[o + 2];
    c00 += x * x;
    c01 += x * y;
    c02 += x * z;
    c11 += y * y;
    c12 += y * z;
    c22 += z * z;
  }
  return [
    c00 * inv,
    c01 * inv,
    c02 * inv,
    c11 * inv,
    c12 * inv,
    c22 * inv,
  ];
}

/**
 * Largest eigenpair of symmetric 3×3 via power iteration + Rayleigh quotient.
 */
function powerEigen1(C: Sym3, seed: [number, number, number]): { lambda: number; v: [number, number, number] } {
  let v = normalize3(seed);
  let lambda = 1;
  for (let it = 0; it < 48; it++) {
    const w = symMatVec(C, v[0], v[1], v[2]);
    const nw = norm3(w);
    if (nw < 1e-14) break;
    v = [w[0] / nw, w[1] / nw, w[2] / nw];
    const Aw = symMatVec(C, v[0], v[1], v[2]);
    lambda = dot3(v, Aw);
  }
  return { lambda, v };
}

function deflate(C: Sym3, lambda: number, v: [number, number, number]): Sym3 {
  const [vx, vy, vz] = v;
  const a = lambda;
  const c00 = C[0] - a * vx * vx;
  const c01 = C[1] - a * vx * vy;
  const c02 = C[2] - a * vx * vz;
  const c11 = C[3] - a * vy * vy;
  const c12 = C[4] - a * vy * vz;
  const c22 = C[5] - a * vz * vz;
  return [c00, c01, c02, c11, c12, c22];
}

const SEEDS: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Eigenvalues (descending) and orthogonal matrix V (column-major 9 floats: v0|v1|v2).
 * Two largest directions via power iteration + deflation; third axis = cross for a stable right-handed frame.
 */
export function symmetricEigen3Descending(C: Sym3): { values: [number, number, number]; V: Float32Array } {
  let Cwork: Sym3 = [...C] as Sym3;
  const e0 = powerEigen1(Cwork, SEEDS[0]);
  const lambda0 = Math.max(0, e0.lambda);
  const u0 = normalize3(e0.v);
  Cwork = deflate(Cwork, lambda0, u0);

  const e1 = powerEigen1(Cwork, SEEDS[1]);
  const lambda1 = Math.max(0, e1.lambda);
  let u1 = normalize3(e1.v);
  const d10 = dot3(u1, u0);
  u1 = normalize3([u1[0] - d10 * u0[0], u1[1] - d10 * u0[1], u1[2] - d10 * u0[2]]);

  let u2 = cross3(u0, u1);
  u2 = normalize3(u2);
  if (norm3(u2) < 1e-8) {
    u2 = [0, 0, 1];
  }

  const r0 = dot3(u0, symMatVec(C, u0[0], u0[1], u0[2]));
  const r1 = dot3(u1, symMatVec(C, u1[0], u1[1], u1[2]));
  const r2 = dot3(u2, symMatVec(C, u2[0], u2[1], u2[2]));

  const triples = [
    { r: Math.max(0, r0), u: u0 },
    { r: Math.max(0, r1), u: u1 },
    { r: Math.max(0, r2), u: u2 },
  ].sort((a, b) => b.r - a.r);

  let a = normalize3(triples[0].u);
  let b = triples[1].u;
  const db = dot3(b, a);
  b = normalize3([b[0] - db * a[0], b[1] - db * a[1], b[2] - db * a[2]]);
  let c = cross3(a, b);
  c = normalize3(c);
  if (dot3(c, triples[2].u) < 0) {
    c = [-c[0], -c[1], -c[2]];
  }

  const values: [number, number, number] = [
    Math.max(0, dot3(a, symMatVec(C, a[0], a[1], a[2]))),
    Math.max(0, dot3(b, symMatVec(C, b[0], b[1], b[2]))),
    Math.max(0, dot3(c, symMatVec(C, c[0], c[1], c[2]))),
  ];

  const V = new Float32Array(9);
  V[0] = a[0];
  V[1] = a[1];
  V[2] = a[2];
  V[3] = b[0];
  V[4] = b[1];
  V[5] = b[2];
  V[6] = c[0];
  V[7] = c[1];
  V[8] = c[2];

  return { values, V };
}

/** p' = p @ V (row vector × matrix with columns in V) */
export function mulPointMat3(
  px: number,
  py: number,
  pz: number,
  V: Float32Array
): [number, number, number] {
  return [
    px * V[0] + py * V[3] + pz * V[6],
    px * V[1] + py * V[4] + pz * V[7],
    px * V[2] + py * V[5] + pz * V[8],
  ];
}

export function transformPositionsInPlace(positions: Float32Array, count: number, V: Float32Array): void {
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const [nx, ny, nz] = mulPointMat3(positions[o], positions[o + 1], positions[o + 2], V);
    positions[o] = nx;
    positions[o + 1] = ny;
    positions[o + 2] = nz;
  }
}

/** PCA rotation (columns = eigenvectors of covariance, descending λ). */
export function pcaRotationMatrix3(positions: Float32Array, count: number): Float32Array {
  if (count < 4) {
    const I = new Float32Array(9);
    I[0] = I[4] = I[8] = 1;
    return I;
  }
  const C = covarianceSym3(positions, count);
  const { V } = symmetricEigen3Descending(C);
  return V;
}

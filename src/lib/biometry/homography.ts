/**
 * Omografia 3×3 — DLT 4 punti (equivalente a getPerspectiveTransform / findHomography in OpenCV).
 * p_dst ~ H * p_src con p in coordinate omogenee [x,y,1].
 */

export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];

function mat3MulVec(H: Mat3, x: number, y: number, z: number): [number, number, number] {
  const a = H[0][0] * x + H[0][1] * y + H[0][2] * z;
  const b = H[1][0] * x + H[1][1] * y + H[1][2] * z;
  const c = H[2][0] * x + H[2][1] * y + H[2][2] * z;
  return [a, b, c];
}

/** Applica H a (x,y) → coordinate cartesiane */
export function applyHomographyCartesian(H: Mat3, x: number, y: number): { x: number; y: number } {
  const [xp, yp, wp] = mat3MulVec(H, x, y, 1);
  if (Math.abs(wp) < 1e-12) return { x: NaN, y: NaN };
  return { x: xp / wp, y: yp / wp };
}

/** Inversa 3×3 */
export function invert3x3(m: Mat3): Mat3 | null {
  const a =
    m[0][0] * (m[1][1] * m[2][2] - m[2][1] * m[1][2]) -
    m[0][1] * (m[1][0] * m[2][2] - m[2][0] * m[1][2]) +
    m[0][2] * (m[1][0] * m[2][1] - m[2][0] * m[1][1]);
  if (Math.abs(a) < 1e-14) return null;
  const invDet = 1 / a;
  const out: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  out[0][0] = (m[1][1] * m[2][2] - m[2][1] * m[1][2]) * invDet;
  out[0][1] = (m[0][2] * m[2][1] - m[2][2] * m[0][1]) * invDet;
  out[0][2] = (m[0][1] * m[1][2] - m[1][1] * m[0][2]) * invDet;
  out[1][0] = (m[1][2] * m[2][0] - m[2][2] * m[1][0]) * invDet;
  out[1][1] = (m[0][0] * m[2][2] - m[2][0] * m[0][2]) * invDet;
  out[1][2] = (m[1][0] * m[0][2] - m[0][0] * m[1][2]) * invDet;
  out[2][0] = (m[1][0] * m[2][1] - m[2][0] * m[1][1]) * invDet;
  out[2][1] = (m[2][0] * m[0][1] - m[0][0] * m[2][1]) * invDet;
  out[2][2] = (m[0][0] * m[1][1] - m[1][0] * m[0][1]) * invDet;
  return out;
}

function solveLinear8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

/**
 * src = punti immagine (pixel), dst = punti mondo piano (mm), H tale che dst ~ H * src.
 * Convenzione OpenCV: getPerspectiveTransform(src, dst) mappa src -> dst.
 */
export function homographyFromImageToWorldMm(
  srcPx: [number, number][],
  dstMm: [number, number][]
): Mat3 | null {
  if (srcPx.length < 4 || dstMm.length < 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPx[i];
    const [X, Y] = dstMm[i];
    // X = (h11 x + h12 y + h13) / (h31 x + h32 y + 1)
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const h8 = solveLinear8(A, b);
  if (!h8) return null;
  return [
    [h8[0], h8[1], h8[2]],
    [h8[3], h8[4], h8[5]],
    [h8[6], h8[7], 1],
  ];
}

export function mat3ToRowMajor(H: Mat3): number[] {
  return [H[0][0], H[0][1], H[0][2], H[1][0], H[1][1], H[1][2], H[2][0], H[2][1], H[2][2]];
}

export function rowMajorToMat3(row: number[]): Mat3 | null {
  if (row.length !== 9) return null;
  return [
    [row[0], row[1], row[2]],
    [row[3], row[4], row[5]],
    [row[6], row[7], row[8]],
  ];
}

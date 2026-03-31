"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Center, ContactShadows, Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { PointCloud } from "@/lib/reconstruction/types";
import { yieldToMain } from "@/lib/utils/yieldToMain";
import { neighborAverageSmoothing } from "@/lib/reconstruction/cleanPointCloud";
import { computeFootDeformParams, type FootDeformParams } from "@/lib/visualization/footParams";
import { taubinSmoothGeometry } from "@/lib/reconstruction/footSurfaceMesh";
import {
  NEUTRAL_TEMPLATE_MEASUREMENTS,
  blendMeasurementsTowardNeutral,
  footHalfWidth01,
  smoothstep,
  templateFitDimensionsFromMeasurements,
  type TemplatePreviewMeasurementsMm,
} from "@/lib/visualization/neutralFootTemplate";

/** Blend dettagli secondari; L/W/H usano peso maggiore in `blendMeasurementsTowardNeutral`. */
const PREVIEW_SCAN_BLEND = 0.5;
const PREVIEW_PRINCIPAL_BLEND = 0.84;

/** 3/4 + leggera zenitale (phi sotto π/2); solo fascia verticale stretta → sempre “hero”. */
const PREVIEW_CAMERA_POSITION: [number, number, number] = [0.96, 0.6, 0.92];
const PREVIEW_ORBIT_TARGET: [number, number, number] = [0, 0.045, 0];
const PREVIEW_FOV = 32;
const PREVIEW_POLAR_MIN = Math.PI / 2 - 0.44;
const PREVIEW_POLAR_MAX = Math.PI / 2 - 0.13;
/** Velocità rotazione piede (rad/s): giro completo ~68s, smooth e loop continuo. */
const PREVIEW_MESH_SPIN_RAD_PER_SEC = (Math.PI * 2) / 68;

export type FootTemplatePreviewCanvasProps = {
  cloud: PointCloud;
};

type ScanMeasurementsMm = TemplatePreviewMeasurementsMm;

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function getAxisExtent(positions: Float32Array, count: number) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o]!;
    const y = positions[o + 1]!;
    const z = positions[o + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  return {
    min: [minX, minY, minZ] as const,
    max: [maxX, maxY, maxZ] as const,
    ext: [dx, dy, dz] as const,
  };
}

function estimateMeasurementsFromPointCloud(cloud: PointCloud): ScanMeasurementsMm {
  const { positions, pointCount } = cloud;
  if (pointCount === 0) {
    return { ...NEUTRAL_TEMPLATE_MEASUREMENTS };
  }

  const bb = getAxisExtent(positions, pointCount);
  const ext = bb.ext;

  // Map scan axes -> template axes:
  // length = max extent, width = second, height = smallest.
  const sorted = [
    { axis: 0 as const, v: ext[0]! },
    { axis: 1 as const, v: ext[1]! },
    { axis: 2 as const, v: ext[2]! },
  ].sort((a, b) => b.v - a.v);

  const lengthAxis = sorted[0]!.axis;
  const widthAxis = sorted[1]!.axis;
  const heightAxis = sorted[2]!.axis;

  const footLengthMm = sorted[0]!.v;
  const footHeightMm = sorted[2]!.v;

  const lenMin = bb.min[lengthAxis]!;
  const lenMax = bb.max[lengthAxis]!;
  const lenRange = Math.max(lenMax - lenMin, 1e-6);

  const wMin = bb.min[widthAxis]!;
  const wMax = bb.max[widthAxis]!;
  const wMid = (wMin + wMax) * 0.5;
  const wRange = Math.max(wMax - wMin, 1e-6);

  const zMin = bb.min[heightAxis]!;
  const zMax = bb.max[heightAxis]!;

  const heelBandHi = 0.18;
  const toeBandLo = 0.86;
  const toeBandHi = 1.0;

  // Width across length bins (for max width + forefoot).
  const BIN_COUNT = 20;
  const binMinW = new Array<number>(BIN_COUNT).fill(Infinity);
  const binMaxW = new Array<number>(BIN_COUNT).fill(-Infinity);
  const binCount = new Array<number>(BIN_COUNT).fill(0);

  let heelWMin = Infinity;
  let heelWMax = -Infinity;
  let heelCount = 0;

  let toeWMin = Infinity;
  let toeWMax = -Infinity;
  let toeCount = 0;

  let archPeak = -Infinity;
  let foundArch = false;

  // Arch curvature (quadratic fit) from medial points.
  const ARCH_BIN = 16;
  const archBinVals: number[][] = Array.from({ length: ARCH_BIN }, () => []);
  const archT0 = 0.35;
  const archT1 = 0.72;

  // Toe alignment: medial max length vs toe-band extent.
  let toeLenMin = Infinity;
  let toeLenMax = -Infinity;
  let medialToeMaxLen = -Infinity;
  const TOE_MEDIAL_NORM = 0.18;

  for (let i = 0; i < pointCount; i++) {
    const o = i * 3;
    const x = positions[o]!;
    const y = positions[o + 1]!;
    const z = positions[o + 2]!;

    const lenCoord = lengthAxis === 0 ? x : lengthAxis === 1 ? y : z;
    const widthCoord = widthAxis === 0 ? x : widthAxis === 1 ? y : z;
    const heightCoord = heightAxis === 0 ? x : heightAxis === 1 ? y : z;

    const t = (lenCoord - lenMin) / lenRange; // 0..1
    const wNorm = Math.abs((widthCoord - wMid) / wRange);

    // Width bins
    const bi = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor(t * BIN_COUNT)));
    const w = widthCoord;
    if (w < binMinW[bi]!) binMinW[bi] = w;
    if (w > binMaxW[bi]!) binMaxW[bi] = w;
    binCount[bi]! += 1;

    // Heel width band
    if (t <= heelBandHi) {
      heelCount++;
      if (widthCoord < heelWMin) heelWMin = widthCoord;
      if (widthCoord > heelWMax) heelWMax = widthCoord;
    }

    // Toe width + toe alignment band
    if (t >= toeBandLo && t <= toeBandHi) {
      toeCount++;
      if (widthCoord < toeWMin) toeWMin = widthCoord;
      if (widthCoord > toeWMax) toeWMax = widthCoord;
      if (lenCoord < toeLenMin) toeLenMin = lenCoord;
      if (lenCoord > toeLenMax) toeLenMax = lenCoord;
      if (wNorm <= TOE_MEDIAL_NORM) {
        if (lenCoord > medialToeMaxLen) medialToeMaxLen = lenCoord;
      }
    }

    // Arch peak + curvature from medial-ish region.
    if (t >= archT0 && t <= archT1 && wNorm <= 0.23) {
      foundArch = true;
      if (heightCoord > archPeak) archPeak = heightCoord;

      const archNormT = (t - archT0) / Math.max(archT1 - archT0, 1e-6); // 0..1
      const ab = Math.min(ARCH_BIN - 1, Math.max(0, Math.floor(archNormT * ARCH_BIN)));
      archBinVals[ab]!.push(heightCoord);
    }
  }

  if (!foundArch || !Number.isFinite(archPeak)) archPeak = zMax;

  const archHeightMm = Math.max(0, archPeak - zMin);

  // Compute max width and forefoot width from bins.
  const minBinPoints = Math.max(5, Math.floor(pointCount / (BIN_COUNT * 10)));
  let maxWidthMm = 0;
  let forefootWidthMm = 0;

  for (let bi = 0; bi < BIN_COUNT; bi++) {
    if (binCount[bi]! < minBinPoints) continue;
    const span = binMaxW[bi]! - binMinW[bi]!;
    if (span > maxWidthMm) maxWidthMm = span;

    const tCenter = (bi + 0.5) / BIN_COUNT;
    if (tCenter >= 0.62 && tCenter <= 0.92) {
      if (span > forefootWidthMm) forefootWidthMm = span;
    }
  }

  if (!(forefootWidthMm > 1e-6)) forefootWidthMm = maxWidthMm > 1e-6 ? maxWidthMm : wMax - wMin;
  if (!(maxWidthMm > 1e-6)) maxWidthMm = wMax - wMin;

  const heelWidthMm =
    heelCount > 0 ? Math.max(0, heelWMax - heelWMin) : forefootWidthMm * 0.84;
  const toeWidthMm =
    toeCount > 0 ? Math.max(0, toeWMax - toeWMin) : forefootWidthMm * 0.98;

  // Toe alignment score 0..1
  const toeBandRange = Math.max(toeLenMax - toeLenMin, 1e-6);
  const toeAlignmentScoreRaw =
    toeCount > 0 && Number.isFinite(medialToeMaxLen)
      ? (medialToeMaxLen - toeLenMin) / toeBandRange
      : 0.72;
  const toeAlignmentScore = Math.max(0, Math.min(1, toeAlignmentScoreRaw));

  // Arch curvature: quadratic fit to median z(t) across medial arch bins.
  const tVals: number[] = [];
  const zVals: number[] = [];
  for (let ab = 0; ab < ARCH_BIN; ab++) {
    const arr = archBinVals[ab]!;
    if (arr.length < 4) continue;
    // median
    const sortedZ = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sortedZ.length / 2);
    const med = sortedZ.length % 2 ? sortedZ[mid]! : (sortedZ[mid - 1]! + sortedZ[mid]!) * 0.5;
    const tNorm = (ab + 0.5) / ARCH_BIN;
    tVals.push(tNorm);
    zVals.push(med);
  }

  let archCurvatureIndex = 0.04; // default stable
  if (tVals.length >= 4) {
    // Least squares fit z(t) = a t^2 + b t + c
    let S4 = 0,
      S3 = 0,
      S2 = 0,
      S1 = 0,
      S0 = 0;
    let R2 = 0,
      R1 = 0,
      R0 = 0;

    for (let i = 0; i < tVals.length; i++) {
      const t = tVals[i]!;
      const z = zVals[i]!;
      const t2 = t * t;
      const t3 = t2 * t;
      const t4 = t2 * t2;
      S0 += 1;
      S1 += t;
      S2 += t2;
      S3 += t3;
      S4 += t4;
      R0 += z;
      R1 += z * t;
      R2 += z * t2;
    }

    // Solve:
    // [S4 S3 S2] [a] = [R2]
    // [S3 S2 S1] [b]   [R1]
    // [S2 S1 S0] [c]   [R0]
    const A = [
      [S4, S3, S2],
      [S3, S2, S1],
      [S2, S1, S0],
    ];
    const B = [R2, R1, R0];

    const M = [
      [A[0]![0]!, A[0]![1]!, A[0]![2]!, B[0]!],
      [A[1]![0]!, A[1]![1]!, A[1]![2]!, B[1]!],
      [A[2]![0]!, A[2]![1]!, A[2]![2]!, B[2]!],
    ];

    // Gaussian elimination (3x3)
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let r = col + 1; r < 3; r++) {
        if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
      }
      if (Math.abs(M[pivot]![col]!) < 1e-9) continue;
      if (pivot !== col) {
        const tmp = M[col]!;
        M[col] = M[pivot]!;
        M[pivot] = tmp;
      }
      const div = M[col]![col]!;
      for (let c = col; c < 4; c++) M[col]![c]! /= div;
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const factor = M[r]![col]!;
        if (factor === 0) continue;
        for (let c = col; c < 4; c++) {
          M[r]![c]! -= factor * M[col]![c]!;
        }
      }
    }

    const a = M[0]![3]!; // because we normalized to pivot; for quadratic coeff in first row solution
    // normalize by footHeight to make it stable across units
    const archCurvNorm = Math.abs(a) / Math.max(footHeightMm, 1e-6);
    archCurvatureIndex = archCurvNorm;
  }

  // Toe type classification (egyptian/roman/greek)
  const toeWidthRatio = toeWidthMm / Math.max(forefootWidthMm, 1e-6);
  let toeType: "egyptian" | "roman" | "greek" = "roman";
  if (toeAlignmentScore > 0.78 || toeWidthRatio > 0.55) toeType = "egyptian";
  else if (toeAlignmentScore < 0.70 || toeWidthRatio < 0.45) toeType = "greek";

  // Volume type (slim/normal/wide) from width/length
  const volumeRatio = forefootWidthMm / Math.max(footLengthMm, 1e-6);
  let volumeType: "slim" | "normal" | "wide" = "normal";
  if (volumeRatio < 0.32) volumeType = "slim";
  else if (volumeRatio > 0.40) volumeType = "wide";

  return {
    footLengthMm,
    maxWidthMm,
    forefootWidthMm,
    footHeightMm,
    archHeightMm,
    archCurvatureIndex,
    heelWidthMm,
    toeWidthMm,
    toeAlignmentScore,
    toeType,
    volumeType,
  };
}

type TemplateData = {
  basePositions: Float32Array; // xyz per vertex (no index)
  archShape01: Float32Array; // per vertex, 0..1, peak=1 in arch region
  // Vertex masks (region weights 0..1) used for controlled deformation.
  heelMask01: Float32Array;
  toeMask01: Float32Array;
  forefootMask01: Float32Array;
  archInnerMask01: Float32Array;
  archOuterMask01: Float32Array;
  topMask01: Float32Array;
  // Vertex groups (indices) for fast targeted deformation (optional usage).
  heelVertexIndices: Uint32Array;
  toeVertexIndices: Uint32Array;
  forefootVertexIndices: Uint32Array;
  archInnerVertexIndices: Uint32Array;
  archOuterVertexIndices: Uint32Array;
  baseXMin: number;
  baseXMax: number;
  baseYMin: number;
  baseYMax: number;
  baseLength: number;
  baseWidth: number;
  // z is normalized to [0..1] (but compute anyway)
  baseZMin: number;
  baseZMax: number;
  baseHeightNorm: number; // baseZMax - baseZMin
  baseArchHeightNorm: number; // approx arch peak - baseZMin
  baseHeelWidth: number; // width at heel band in base units
  baseToeWidth: number; // width at toe band in base units
};

function buildBaseTemplateData(): TemplateData {
  /** Dense grid + parametric width: no silhouette clipping → smooth rim, neutral shape. */
  const segX = 96;
  const segY = 48;

  const plane = new THREE.PlaneGeometry(1, 1, segX, segY);

  const pos = plane.getAttribute("position") as THREE.BufferAttribute;
  const index = plane.index;
  if (!index) {
    plane.dispose();
    throw new Error("FootTemplatePreviewCanvas: expected indexed PlaneGeometry");
  }

  const vCount = pos.count;
  const xMin = -0.5;
  const xMax = 0.5;
  const lenRange = xMax - xMin;

  const vx = new Float32Array(vCount);
  const vy = new Float32Array(vCount);
  const archShapeTmp = new Float32Array(vCount);
  let archShapeMax = 1e-6;

  for (let i = 0; i < vCount; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (x - xMin) / lenRange;
    const halfW = footHalfWidth01(t);
    const yWorld = y * 2 * halfW;
    vx[i] = x;
    vy[i] = yWorld;

    const yNorm = yWorld / Math.max(halfW, 1e-6);
    const sinT = Math.sin(Math.PI * t);
    const archGate = smoothstep(0.21, 0.50, t) * smoothstep(0.81, 0.60, t);
    const midArch = Math.pow(Math.max(0, sinT), 1.52);
    const medial = Math.exp(-Math.pow(yNorm / 0.58, 2));
    const archShape = archGate * midArch * medial;
    archShapeTmp[i] = archShape;
    if (archShape > archShapeMax) archShapeMax = archShape;
  }

  const idxArr = index.array as ArrayLike<number>;
  const cornerCount = index.count;
  const newPos = new Float32Array(cornerCount * 3);
  const newArch = new Float32Array(cornerCount);

  let zMin = Infinity;
  let zMax = -Infinity;
  const tempZ = new Float32Array(cornerCount);

  for (let vi = 0; vi < cornerCount; vi++) {
    const oldIdx = idxArr[vi]!;
    const x = vx[oldIdx]!;
    const y = vy[oldIdx]!;
    const t = (x - xMin) / lenRange;
    const halfW = footHalfWidth01(t);
    const yNorm = y / Math.max(halfW, 1e-6);

    const archGate = smoothstep(0.21, 0.50, t) * smoothstep(0.81, 0.60, t);
    const midArch = Math.pow(Math.sin(Math.PI * t), 1.52);
    const medial = Math.exp(-Math.pow(yNorm / 0.58, 2));
    const archShape = (archGate * midArch * medial) / archShapeMax;

    const toeW = Math.exp(-Math.pow((t - 0.93) / 0.095, 2));
    const heelW = Math.exp(-Math.pow((t - 0.07) / 0.095, 2));
    const toeHeel = 0.8 * toeW + 0.86 * heelW;

    const z = 0.74 * toeHeel + 0.52 * archShape;
    tempZ[vi] = z;
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;

    newPos[vi * 3] = x;
    newPos[vi * 3 + 1] = y;
  }

  const zRange = Math.max(zMax - zMin, 1e-6);
  for (let vi = 0; vi < cornerCount; vi++) {
    const zNorm = (tempZ[vi]! - zMin) / zRange;
    newPos[vi * 3 + 2] = zNorm;

    const oldIdx = idxArr[vi]!;
    newArch[vi] = archShapeTmp[oldIdx]! / archShapeMax;
  }

  plane.dispose();

  // Extents from deformed vertices (full grid footprint).
  let minBX = Infinity;
  let maxBX = -Infinity;
  let minBY = Infinity;
  let maxBY = -Infinity;
  for (let i = 0; i < cornerCount; i++) {
    const o = i * 3;
    const bx = newPos[o]!;
    const by = newPos[o + 1]!;
    if (bx < minBX) minBX = bx;
    if (bx > maxBX) maxBX = bx;
    if (by < minBY) minBY = by;
    if (by > maxBY) maxBY = by;
  }

  const baseXMin = minBX;
  const baseXMax = maxBX;
  const baseYMin = minBY;
  const baseYMax = maxBY;

  const baseLength = Math.max(1e-6, baseXMax - baseXMin);
  const baseWidth = Math.max(1e-6, baseYMax - baseYMin);

  let zMinNorm = Infinity;
  let zMaxNorm = -Infinity;
  let archPeakZ = -Infinity;

  const heelBandHi = 0.18;
  const toeBandLo = 0.86;
  let heelWMin = Infinity;
  let heelWMax = -Infinity;
  let toeWMin = Infinity;
  let toeWMax = -Infinity;

  const meshVertexCount = cornerCount;
  for (let i = 0; i < meshVertexCount; i++) {
    const o = i * 3;
    const x = newPos[o]!;
    const y = newPos[o + 1]!;
    const z = newPos[o + 2]!;
    if (z < zMinNorm) zMinNorm = z;
    if (z > zMaxNorm) zMaxNorm = z;
    const a = newArch[i]!;
    if (a >= 0.95 && z > archPeakZ) archPeakZ = z;

    const t = (x - baseXMin) / baseLength;
    if (t <= heelBandHi) {
      if (y < heelWMin) heelWMin = y;
      if (y > heelWMax) heelWMax = y;
    }
    if (t >= toeBandLo) {
      if (y < toeWMin) toeWMin = y;
      if (y > toeWMax) toeWMax = y;
    }
  }

  if (!Number.isFinite(archPeakZ) || archPeakZ < 0) archPeakZ = zMaxNorm;

  const baseHeightNorm = Math.max(1e-6, zMaxNorm - zMinNorm);
  const baseArchHeightNorm = Math.max(0, archPeakZ - zMinNorm);
  const baseHeelWidth =
    heelWMax > heelWMin ? heelWMax - heelWMin : baseWidth * 0.86;
  const baseToeWidth =
    toeWMax > toeWMin ? toeWMax - toeWMin : baseWidth * 0.97;

  // --- Region masks (0..1) ---
  const heelMask01 = new Float32Array(meshVertexCount);
  const toeMask01 = new Float32Array(meshVertexCount);
  const forefootMask01 = new Float32Array(meshVertexCount);
  const archInnerMask01 = new Float32Array(meshVertexCount);
  const archOuterMask01 = new Float32Array(meshVertexCount);
  const topMask01 = new Float32Array(meshVertexCount);

  const heelIdx: number[] = [];
  const toeIdx: number[] = [];
  const forefootIdx: number[] = [];
  const archInnerIdx: number[] = [];
  const archOuterIdx: number[] = [];

  const yMid = (baseYMin + baseYMax) * 0.5;
  const halfW = Math.max(1e-6, baseWidth * 0.5);

  for (let i = 0; i < meshVertexCount; i++) {
    const o = i * 3;
    const x = newPos[o]!;
    const y = newPos[o + 1]!;
    const z = newPos[o + 2]!;

    const t = (x - baseXMin) / baseLength; // 0..1
    const yNorm = (y - yMid) / halfW; // ~-1..1

    const heel = 1 - smoothstep(0.02, 0.22, t);
    const toe = smoothstep(0.78, 0.98, t);
    const fore = smoothstep(0.52, 0.70, t) * (1 - smoothstep(0.92, 0.98, t));

    const archBand = smoothstep(0.28, 0.42, t) * (1 - smoothstep(0.74, 0.82, t));
    const inner = archBand * smoothstep(-0.25, 0.35, yNorm); // +Y side = inner
    const outer = archBand * smoothstep(0.25, -0.35, yNorm); // -Y side = outer

    const top = smoothstep(0.48, 0.72, z);

    heelMask01[i] = heel;
    toeMask01[i] = toe;
    forefootMask01[i] = fore;
    archInnerMask01[i] = inner;
    archOuterMask01[i] = outer;
    topMask01[i] = top;

    if (heel > 0.6) heelIdx.push(i);
    if (toe > 0.6) toeIdx.push(i);
    if (fore > 0.6) forefootIdx.push(i);
    if (inner > 0.6) archInnerIdx.push(i);
    if (outer > 0.6) archOuterIdx.push(i);
  }

  return {
    basePositions: newPos,
    archShape01: newArch,
    heelMask01,
    toeMask01,
    forefootMask01,
    archInnerMask01,
    archOuterMask01,
    topMask01,
    heelVertexIndices: Uint32Array.from(heelIdx),
    toeVertexIndices: Uint32Array.from(toeIdx),
    forefootVertexIndices: Uint32Array.from(forefootIdx),
    archInnerVertexIndices: Uint32Array.from(archInnerIdx),
    archOuterVertexIndices: Uint32Array.from(archOuterIdx),
    baseXMin,
    baseXMax,
    baseYMin,
    baseYMax,
    baseLength,
    baseWidth,
    baseZMin: zMinNorm,
    baseZMax: zMaxNorm,
    baseHeightNorm,
    baseArchHeightNorm,
    baseHeelWidth,
    baseToeWidth,
  };
}

const BASE_TEMPLATE_DATA = buildBaseTemplateData();

function toeLengthProfile(toeType: FootDeformParams["toeType"], yNorm: number): number {
  // Returns -1..+1-ish profile across width for toe length deformation.
  // +yNorm ~ inner side (big toe), -yNorm ~ outer side (small toes).
  if (toeType === "roman") {
    // Flat toe line.
    return 0;
  }
  if (toeType === "egyptian") {
    // Big toe dominates (inner side longer).
    return smoothstep(-0.1, 0.65, yNorm) - 0.35;
  }
  // greek: second toe longer -> peak near slightly inner-center, not extreme inner.
  const c = 0.22;
  const s = 0.28;
  const g = Math.exp(-Math.pow((yNorm - c) / s, 2));
  return g - 0.55;
}

function buildDeformedTemplateGeometry(measurements: ScanMeasurementsMm) {
  const {
    basePositions,
    archShape01,
    baseLength,
    baseWidth,
    baseXMin,
    baseYMin,
    baseYMax,
    baseHeightNorm,
    baseArchHeightNorm,
    baseHeelWidth,
    baseToeWidth,
    heelMask01,
    toeMask01,
    archInnerMask01,
  } = BASE_TEMPLATE_DATA;

  const vertexCount = basePositions.length / 3;

  const safeBaseLength = Math.max(baseLength, 1e-6);
  const safeBaseWidth = Math.max(baseWidth, 1e-6);
  const yMid = (baseYMin + baseYMax) * 0.5;
  const halfBaseWidth = safeBaseWidth * 0.5;

  const params = computeFootDeformParams(
    {
      footLengthMm: measurements.footLengthMm,
      forefootWidthMm: measurements.forefootWidthMm,
      footHeightMm: measurements.footHeightMm,
      archHeightMm: measurements.archHeightMm,
      heelWidthMm: measurements.heelWidthMm,
      toeType: measurements.toeType,
      volumeType: measurements.volumeType,
    },
    {
      baseLength,
      baseWidth,
      baseHeightNorm,
      baseHeelWidth,
    }
  );

  // Axis convention (requested):
  // X -> width, Y -> height, Z -> length
  // Our template uses: xBase=lengthAxis, yBase=widthAxis, zBase=heightNorm

  const footHeightMm = Math.max(1e-6, measurements.footHeightMm);

  // Arch curvature: vertical displacement in arch region (inner > outer).
  // We combine discrete bucket (low/medium/high) + continuous curvature index from scan.
  const curvNorm = Math.min(0.12, Math.max(0, measurements.archCurvatureIndex)); // already normalized-ish
  const curvGain = 0.6 + 2.8 * Math.min(1, curvNorm / 0.06); // 0.6..3.4
  const bucketBaseMm =
    params.archHeight === "low"
      ? -footHeightMm * 0.075
      : params.archHeight === "high"
        ? footHeightMm * 0.085
        : 0;
  const archTargetDeltaMm = bucketBaseMm * curvGain;

  // Heel width independent
  const heelWidthScale = params.heelWidth; // already relative to template heel width

  // Toe length deformation magnitude (mm)
  const toeLenMm =
    params.toeType === "egyptian" ? footHeightMm * 0.10 : params.toeType === "roman" ? footHeightMm * 0.07 : footHeightMm * 0.085;

  const out = new Float32Array(basePositions.length);

  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    const xBase = basePositions[o]!;
    const yBase = basePositions[o + 1]!;
    const zBase = basePositions[o + 2]!;
    const a = archShape01[i]!;

    const t = (xBase - baseXMin) / safeBaseLength; // 0..1
    const yNorm = (yBase - yMid) / Math.max(halfBaseWidth, 1e-6); // ~-1..1

    // --- Global scaling (per axis, as requested) ---
    // width axis (template y) -> X
    let X = yBase * params.widthScale;
    // height axis (template z) -> Y
    let Y = zBase * params.heightScale;
    // length axis (template x) -> Z
    let Z = xBase * params.lengthScale;

    // --- Region-based deformation ---
    const heelW = heelMask01[i]!;
    const toeW = toeMask01[i]!;
    const archInnerW = archInnerMask01[i]!;
    const archOuterW = BASE_TEMPLATE_DATA.archOuterMask01[i]!;

    // Heel: adjust width independently (smooth)
    if (heelW > 0) {
      const extra = (heelWidthScale - params.widthScale) * heelW;
      X = yBase * (params.widthScale + extra);
    }

    // Arch: vertical displacement with smooth falloff.
    // Inner arch gets the strongest adjustment; outer arch gets a softer one.
    // `a` already peaks on the arch bump; we ease it to avoid sharp transitions.
    const archEase = smoothstep(0.12, 0.95, a);
    const inner = archInnerW * archEase;
    const outer = archOuterW * archEase;
    if (inner > 0 || outer > 0) {
      const outerScale = 0.42; // keep outer arch lower than inner for realism
      const w = inner + outerScale * outer;
      Y += archTargetDeltaMm * w;
    }

    // Toes: modify length locally per toeType (smooth across width)
    if (toeW > 0) {
      const prof = toeLengthProfile(params.toeType, yNorm);
      Z += toeLenMm * toeW * prof;
    }

    // Extra gentle toe smoothing: reduce sharp toe ridge when toeType is roman
    if (toeW > 0 && params.toeType === "roman") {
      Y += footHeightMm * 0.015 * toeW;
    }

    // Store back (note: our geometry is non-indexed, so order matters only per vertex)
    out[o] = X;
    out[o + 1] = Y;
    out[o + 2] = Z;
  }

  // 5) Denoise: media locale sulle posizioni (spike grossolani) → Taubin (superficie professionale, volume stabile).
  const smoothed = neighborAverageSmoothing(out, vertexCount, 6.2, 26, 0.28);

  const geom0 = new THREE.BufferGeometry();
  geom0.setAttribute("position", new THREE.BufferAttribute(smoothed, 3));

  /** λ>0 poi μ<0 per ciclo; iterazioni moderate per forma naturale senza “sapone”. */
  const TAUBIN_ITER = 7;
  const TAUBIN_LAMBDA = 0.31;
  const TAUBIN_MU = -0.34;

  const geom1 = taubinSmoothGeometry(geom0, TAUBIN_ITER, TAUBIN_LAMBDA, TAUBIN_MU);
  if (geom1 !== geom0) geom0.dispose();

  geom1.computeVertexNormals();
  geom1.computeBoundingBox();

  // 7) Adatta il template pulito alle tre dimensioni estratte dalla scansione (mm):
  // X = larghezza, Y = altezza, Z = lunghezza — scala per asse rispetto al centro bbox.
  const { lengthMm, widthMm, heightMm } = templateFitDimensionsFromMeasurements(measurements);
  const bb = geom1.boundingBox;
  if (bb) {
    const size = new THREE.Vector3();
    bb.getSize(size);
    const cx = (bb.max.x + bb.min.x) * 0.5;
    const cy = (bb.max.y + bb.min.y) * 0.5;
    const cz = (bb.max.z + bb.min.z) * 0.5;
    const sx = widthMm / Math.max(size.x, 1e-6);
    const sy = heightMm / Math.max(size.y, 1e-6);
    const sz = lengthMm / Math.max(size.z, 1e-6);
    if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(sz) && sx > 0 && sy > 0 && sz > 0) {
      const posAttr = geom1.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (posAttr) {
        const arr = posAttr.array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i] = (arr[i]! - cx) * sx;
          arr[i + 1] = (arr[i + 1]! - cy) * sy;
          arr[i + 2] = (arr[i + 2]! - cz) * sz;
        }
        posAttr.needsUpdate = true;
        geom1.computeVertexNormals();
        geom1.computeBoundingBox();
      }
    }
  }
  return geom1;
}

function FadeInMesh({ geometry }: { geometry: THREE.BufferGeometry | null }) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
  const startAtRef = useRef<number | null>(null);

  const material = useMemo(() => {
    // Matte, leggermente caldo: aspetto “premium” da scansione / gesso morbido.
    const m = new THREE.MeshPhysicalMaterial({
      color: "#eae6e1",
      roughness: 0.93,
      metalness: 0,
      reflectivity: 0.22,
      clearcoat: 0,
      sheen: 0,
      envMapIntensity: 0.38,
      flatShading: false,
      transparent: true,
      opacity: 0,
    });
    materialRef.current = m;
    return m;
  }, []);

  useEffect(() => {
    if (!geometry) return;
    materialRef.current = material;
    startAtRef.current = performance.now();
  }, [geometry, material]);

  useFrame(() => {
    const start = startAtRef.current;
    if (start == null) return;
    const t = Math.min(1, (performance.now() - start) / 1000);
    const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
    material.opacity = e;
    if (meshRef.current) {
      const s = 0.98 + 0.02 * e;
      meshRef.current.scale.setScalar(s);
    }
    if (t >= 1) startAtRef.current = null;
  });

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return geometry ? (
    <mesh ref={meshRef} geometry={geometry} material={material} />
  ) : (
    <mesh visible={false}>
      <boxGeometry args={[0.6, 0.08, 0.28]} />
      <meshPhysicalMaterial color="#eae6e1" roughness={0.93} metalness={0} envMapIntensity={0.35} />
    </mesh>
  );
}

function SubtlePreviewSpin({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const reduceMotionRef = useRef(false);

  useEffect(() => {
    reduceMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g || reduceMotionRef.current) return;
    g.rotation.y += delta * PREVIEW_MESH_SPIN_RAD_PER_SEC;
  });

  return <group ref={groupRef}>{children}</group>;
}

export default function FootTemplatePreviewCanvas({ cloud }: FootTemplatePreviewCanvasProps) {
  const [geom, setGeom] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let cancelled = false;
    let prev = geom;

    (async () => {
      await yieldToMain();
      if (cancelled) return;

      const raw = estimateMeasurementsFromPointCloud(cloud);
      const measurements = blendMeasurementsTowardNeutral(
        raw,
        PREVIEW_SCAN_BLEND,
        PREVIEW_PRINCIPAL_BLEND
      );
      const nextGeom = buildDeformedTemplateGeometry(measurements);
      if (cancelled) {
        nextGeom.dispose();
        return;
      }

      setGeom(nextGeom);
      if (prev) prev.dispose();
    })().catch((e) => {
      console.error("[FootTemplatePreviewCanvas] build geometry", e);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud]);

  return (
    <Canvas
      dpr={[1, typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 1.75) : 1]}
      frameloop="always"
      camera={{ position: PREVIEW_CAMERA_POSITION, fov: PREVIEW_FOV, near: 0.01, far: 20 }}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "default",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      className="h-[360px] w-full"
    >
      <hemisphereLight color="#faf8f5" groundColor="#9c9890" intensity={0.42} />
      <ambientLight intensity={0.38} color="#f5f3f0" />
      <directionalLight
        position={[3.2, 4.2, 2.4]}
        intensity={0.42}
        color="#fffaf6"
        castShadow={false}
      />
      <directionalLight position={[-2.8, 2.2, -1.6]} intensity={0.2} color="#e8e6e3" />
      <directionalLight position={[0.4, 1.6, -2.6]} intensity={0.11} color="#f0eeeb" />

      <Environment preset="apartment" environmentIntensity={0.52} />

      <ContactShadows
        position={[0, -0.012, 0]}
        opacity={0.2}
        scale={1.35}
        blur={2.35}
        far={1.35}
        frames={60}
        color="#1a1816"
      />

      <Center>
        <SubtlePreviewSpin>
          <FadeInMesh geometry={geom} />
        </SubtlePreviewSpin>
      </Center>

      <OrbitControls
        makeDefault
        target={PREVIEW_ORBIT_TARGET}
        enablePan={false}
        enableZoom
        enableRotate
        autoRotate={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.65}
        zoomSpeed={0.85}
        minDistance={0.42}
        maxDistance={3.6}
        minPolarAngle={PREVIEW_POLAR_MIN}
        maxPolarAngle={PREVIEW_POLAR_MAX}
      />
    </Canvas>
  );
}


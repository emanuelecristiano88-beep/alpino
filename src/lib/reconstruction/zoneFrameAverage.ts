import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import { mergePointCloudsVoxelAverage } from "./mergePointClouds";
import type { PerViewCloud } from "./multiViewAlign";

const PHASE_ORDER: ScanPhaseId[] = [0, 1, 2, 3];

function centeredCloud(cloud: PerViewCloud): PerViewCloud {
  const { positions, count, colors } = cloud;
  if (count === 0) return cloud;

  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    sx += positions[o];
    sy += positions[o + 1];
    sz += positions[o + 2];
  }
  const inv = 1 / count;
  const cx = sx * inv;
  const cy = sy * inv;
  const cz = sz * inv;

  const outPos = new Float32Array(positions);
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    outPos[o] -= cx;
    outPos[o + 1] -= cy;
    outPos[o + 2] -= cz;
  }

  // We keep colors by index (same point ordering).
  return {
    positions: outPos,
    colors: colors ? new Uint8Array(colors) : undefined,
    count,
  };
}

/**
 * Per ogni `ScanPhaseId`, fonde i frame della stessa zona con merge voxel (centroidi per voxel).
 * Riduce varianza tra burst della stessa vista prima dell’allineamento multi-zona.
 *
 * L’ordine di uscita è fisso TOP → OUTER → INNER → HEEL (solo fasi presenti nei dati).
 */
export function fuseBurstFramesPerScanPhase(
  clouds: PerViewCloud[],
  phaseIds: ScanPhaseId[],
  voxelMm: number
): {
  fused: PerViewCloud[];
  zonePhaseIds: ScanPhaseId[];
  pointsPerZoneCloud: number[];
} {
  if (clouds.length !== phaseIds.length) {
    throw new Error(
      "fuseBurstFramesPerScanPhase: clouds e phaseIds devono avere la stessa lunghezza"
    );
  }
  if (clouds.length === 0) {
    return { fused: [], zonePhaseIds: [], pointsPerZoneCloud: [] };
  }

  const groups = new Map<ScanPhaseId, PerViewCloud[]>();
  for (let i = 0; i < clouds.length; i++) {
    const id = phaseIds[i];
    let g = groups.get(id);
    if (!g) {
      g = [];
      groups.set(id, g);
    }
    g.push(clouds[i]);
  }

  const fused: PerViewCloud[] = [];
  const zonePhaseIds: ScanPhaseId[] = [];
  const pointsPerZoneCloud: number[] = [];

  for (const pid of PHASE_ORDER) {
    const g = groups.get(pid);
    if (!g?.length) continue;

    if (g.length === 1) {
      const c = g[0];
      fused.push(c);
      zonePhaseIds.push(pid);
      pointsPerZoneCloud.push(c.count);
      continue;
    }

    // Stabilita: prima allinea per traslazione (centroid centering),
    // poi fa il merge voxel. Questo riduce la varianza dovuta a piccoli
    // spostamenti della camera tra frame del burst.
    const centered = g.map(centeredCloud);
    const merged = mergePointCloudsVoxelAverage(centered, voxelMm);
    fused.push({
      positions: merged.positions,
      colors: merged.colors,
      count: merged.pointCount,
    });
    zonePhaseIds.push(pid);
    pointsPerZoneCloud.push(merged.pointCount);
  }

  return { fused, zonePhaseIds, pointsPerZoneCloud };
}

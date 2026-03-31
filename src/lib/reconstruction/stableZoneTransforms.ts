import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import type { Vec3 } from "./types";

/**
 * Angoli (gradi) per zona — range consigliato documentazione vs implementazione centrale:
 * - OUTER: Y negativo (es. -30° … -60°)
 * - INNER: Y positivo (es. +30° … +60°)
 * - HEEL: rotazione X aggiuntiva
 */
export const STABLE_ZONE_DEGREES = {
  OUTER_Y: -45,
  INNER_Y: 45,
  /** Tallone: rotazione X dopo portare la camera dietro (euristica) */
  HEEL_X: 35,
  /** Passo aggiuntivo HEEL su Y (come pipeline legacy) */
  HEEL_Y_BACK: 180,
} as const;

const DEG = Math.PI / 180;

function rotateY(p: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: c * p.x + s * p.z, y: p.y, z: -s * p.x + c * p.z };
}

function rotateX(p: Vec3, ang: number): Vec3 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: p.x, y: c * p.y - s * p.z, z: s * p.y + c * p.z };
}

/**
 * Trasforma punto da camera pinhole (x destra, y giù, z avanti) a frame mondo “stabile”
 * per fusione calzature (angoli per zona regolabili).
 */
export function transformPointStableZone(p: Vec3, phaseId: ScanPhaseId): Vec3 {
  let q: Vec3 = { x: p.x, y: -p.y, z: p.z };

  switch (phaseId) {
    case 0:
      return q;
    case 1:
      return rotateY(q, STABLE_ZONE_DEGREES.OUTER_Y * DEG);
    case 2:
      return rotateY(q, STABLE_ZONE_DEGREES.INNER_Y * DEG);
    case 3: {
      const back = rotateY(q, (STABLE_ZONE_DEGREES.HEEL_Y_BACK * Math.PI) / 180);
      return rotateX(back, STABLE_ZONE_DEGREES.HEEL_X * DEG);
    }
    default:
      return q;
  }
}

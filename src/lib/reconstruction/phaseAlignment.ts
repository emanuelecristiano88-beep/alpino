import type { ScanPhaseId } from "../../constants/scanCapturePhases";
import type { Vec3 } from "./types";

/**
 * Rotazioni approssimate camera→mondo (piede: Y su, X mediale-laterale, Z avampiede-tallone).
 * Le 4 fasi: alto, lato esterno, lato interno, tallone — allineamento grossolano per fusione veloce.
 */
const HALF_PI = Math.PI / 2;

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
 * Trasforma punti dallo spazio camera (x destra, y giù, z avanti) a un frame mondo comune.
 */
export function transformPointByPhase(p: Vec3, phaseId: ScanPhaseId): Vec3 {
  // Camera frame: X right, Y down, Z into scene
  let q: Vec3 = { x: p.x, y: -p.y, z: p.z };

  switch (phaseId) {
    case 0: // vista dall'alto — identità approssimata
      return q;
    case 1: // laterale esterna: camera ~ +X world
      return rotateY(q, -HALF_PI);
    case 2: // laterale interna: camera ~ -X world
      return rotateY(q, HALF_PI);
    case 3: // posteriore / tallone: camera da dietro
      return rotateX(rotateY(q, Math.PI), HALF_PI * 0.35);
    default:
      return q;
  }
}

/** Gruppi logici per documentazione / fusione pesata */
export function phaseGroup(phaseId: ScanPhaseId): "top" | "sides" | "heel" {
  if (phaseId === 0) return "top";
  if (phaseId === 3) return "heel";
  return "sides";
}

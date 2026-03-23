import type { ScanPhaseId } from "../../constants/scanCapturePhases";

/** Punto 3D (mm, sistema mondo approssimato) */
export type Vec3 = { x: number; y: number; z: number };

/** Nuvola: coordinate interleaved xyzxyz… (mm) */
export type PointCloud = {
  positions: Float32Array;
  /** rgb 0–255, interleaved, opzionale */
  colors?: Uint8Array;
  pointCount: number;
};

export type CapturedView = {
  imageData: ImageData;
  phaseId: ScanPhaseId;
  /** Indice sorgente (debug) */
  sourceIndex?: number;
};

export type ReconstructionOptions = {
  /** Lato massimo immagine per depth/maschera (riduce costo) */
  maxImageSide: number;
  /** Profondità metrica arbitraria: near/far in mm (scala relativa) */
  depthNearMm: number;
  /** Profondità lontana (mm) */
  depthFarMm: number;
  /** Lunghezza focale normalizzata (f / larghezza) — tipico 0.55–0.75 per smartphone */
  focalLengthNorm: number;
  /** Passo campionamento pixel → punti (≥1) */
  sampleStep: number;
  /** Lato voxel merge (mm) */
  voxelSizeMm: number;
  /**
   * Allinea le nuvole per vista (centroide + scala + PCA riferimento + raffinamento pooled) prima del merge voxel.
   * Default: true (nessun ICP).
   */
  multiViewAlign?: boolean;
  /** Passate di raffinamento globale (0–3). Default: 3. */
  multiViewRefinementIterations?: number;
  /** Indice della vista usata per la PCA iniziale (0 = prima). Default: 0. */
  multiViewReferenceCloudIndex?: number;
};

export const DEFAULT_RECONSTRUCTION_OPTIONS: ReconstructionOptions = {
  maxImageSide: 256,
  depthNearMm: 40,
  depthFarMm: 120,
  focalLengthNorm: 0.65,
  sampleStep: 2,
  voxelSizeMm: 4,
  multiViewAlign: true,
  multiViewRefinementIterations: 3,
  multiViewReferenceCloudIndex: 0,
};

export type ReconstructionResult = {
  cloud: PointCloud;
  /** Statistiche per debug / QA */
  meta: {
    viewCount: number;
    pointsPerView: number[];
    durationMs: number;
    depthBackend: "pseudo" | "external";
    /** Allineamento multi-vista leggero applicato prima del merge */
    multiViewAlignApplied?: boolean;
    multiViewRefinementIterations?: number;
  };
};

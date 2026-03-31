/**
 * Stato elaborazione mesh lato server (futuro polling / WebSocket).
 * Usato per preparare l’UI al flusso asincrono reale.
 */
export interface ScanProcessingStatus {
  id: string;
  status: "processing" | "ready" | "error";
  message?: string;
  /** Presente solo se status è "ready" */
  meshUrl?: string;
}

/** Fase del viewer 3D dopo "VISUALIZZA 3D" (simulazione / futuro API) */
export type ScanMeshViewerStatus = "idle" | "completing" | "processing" | "ready" | "error";

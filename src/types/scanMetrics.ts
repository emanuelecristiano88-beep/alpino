/**
 * Metriche da mesh 3D (pipeline Mac / NEUMA).
 * Convenzioni allineate a misurazioni ortopediche su plantare / last.
 */

/** Metriche per singolo piede (sinistro / destro). */
export type FootSideMetrics = {
  /** $L$ — Lunghezza totale: dal tallone alla punta del dito più lungo (mm). */
  lunghezzaMm: number;
  /** $W$ — Larghezza metatarsale: punto più largo della pianta (mm). */
  larghezzaMm: number;
  /** Altezza dell’arco (navicolare / fascio plantare): piede piatto vs cavo (mm). */
  altezzaArcoMm: number;
  /** Circonferenza del collo del piede: regolazione tomaia TPU stampata (mm). */
  circonferenzaColloMm: number;
  /** Volume mesh — opzionale per logistica / ordini. */
  volumeCm3: number;
};

/** Payload salvato in sessionStorage dopo process-scan (o da script mesh). */
export type ScanMetricsPayload = {
  /** Valori medi o piede di riferimento per riepilogo rapido */
  lunghezzaMm: number;
  larghezzaMm: number;
  altezzaArcoMm: number;
  circonferenzaColloMm: number;
  volumeCm3: number;
  left: FootSideMetrics;
  right: FootSideMetrics;
  scanVersion?: string;
  updatedAt: string;
};

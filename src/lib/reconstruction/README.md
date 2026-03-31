# Pipeline di ricostruzione 3D (client)

## Pipeline “stabile” (fitting calzature)

Per acquisizioni **già filtrate e raggruppate per angolo** (TOP / OUTER / INNER / HEEL), con burst multi-foto per zona:

1. **Preprocess** (`preprocessFootCapture`) — resize, maschera piede, sfondo azzerato, luminanza normalizzata.
2. **Depth** (`estimateDepthNormalizedAsync`) — pseudo o placeholder MiDaS; depth × maschera.
3. **Point cloud** (`depthMapToPointCloud` + `transformPointStableZone`) — modello pinhole + rotazioni per zona (`stableZoneTransforms.ts`).
4. **Media burst intra-zona** (`fuseBurstFramesPerScanPhase`, default on) — frame con lo stesso `phaseId` → unione voxel (centroide per cella); ordine/uscita TOP→OUTER→INNER→HEEL. Opzioni: `intraZoneFrameAverage`, `intraZoneFrameVoxelMm`.
5. **Allineamento** (`alignPointCloudsMultiView`) — centroide, scala, PCA leggero (indice riferimento sulla lista **post**-media intra-zona).
6. **Merge** (`mergePointCloudsVoxelAverage`) — fusione voxel tra le viste/zona con **pesi per fase** (`SCAN_PHASE_MERGE_WEIGHT`: INNER 1.2, TOP 1.0, OUTER 0.8, HEEL 0.7). Opzione `phaseWeightedMerge`.
7. **Pulizia** (`cleanPointCloudPipeline`) — outlier statistico (distanza ai k vicini) → punti isolati (raggio) → solo cluster principale (voxel 6-vicini) → smoothing leggero con media sui vicini (`neighborAverageSmoothing`); opzionale downsampling voxel (`smoothVoxelMm` > 0). Colori allineati a ogni passo.
8. **Regolarizzazione forma** (`regularizeFootPointCloud`) — attenua picchi (clamp verso centroide vicini), limita variazioni di “spessore” lungo l’asse più sottile del bbox, smoothing superficie (passate vicini). Default **on** in pipeline stabile; `footShapeRegularize`, `footShapeRegularizeOptions`.
9. **Scala metrica** (`applyMetricScaleToPointCloud`) — fattore da ArUco / A4 (opzionale), applicata **dopo** la regolarizzazione.
10. **Stabilizzazione** — opzionale: `stabilizeWithClouds` (prima della pulizia) per mediare più sessioni.

**Entry point:** `reconstructStableFootPointCloud` — restituisce `pointCloud`, `boundingBox`, `dimensionsMm` (lunghezza/larghezza/altezza ordinate), `meta`.

**Export:** `pointCloudToPlyAscii` / `downloadPlyAscii` per PLY ASCII.

---

Strategia **semplificata ma solida** (pipeline legacy veloce):

```
IMMAGINI
    → maschera piede
    → depth (approssimata)
    → point cloud per frame
    → (opz.) media intra-zona per phaseId (`fuseBurstFramesPerScanPhase`)
    → fusione (allineamento multi-vista + merge)
    → pulizia (downsampling / voxel; mesh opzionale)
    → scaling reale (calibrazione A4 / ArUco, post-pipeline)
```

## Mappa codice

| Fase | Modulo | Nota |
|------|--------|------|
| Immagini | `pipeline.ts` → `blobToImageData`, `downscaleImageDataMaxSide` | Ridimensionamento per costo CPU |
| Maschera piede | `segmentFoot.ts` → `extractFootMask` | Euristica veloce; path AI in `extractFootMaskAi` |
| Depth | `depthEstimation.ts` → `estimateRelativeDepthNormalized` | Pseudo-depth; sostituibile con MiDaS/ONNX |
| Point cloud / vista | `depthToPointCloud.ts` | Pinhole + `phaseId` per orientamento grossolano |
| Fusione | `multiViewAlign.ts` + `mergePointClouds.ts` | Allinea le viste, poi media per voxel (pesi zona) |
| Regolarizzazione | `regularizeFootShape.ts` | Picchi, clamp spessore, smoothing continuo |
| Pulizia | `cleanPointCloud.ts` | Outlier, cluster, vicini; opz. `footSurfaceMesh.ts` per mesh |
| Scaling reale | `metricScale.ts` → `applyMetricScaleToPointCloud` | Moltiplicatore da calibrazione (es. px/mm marker) |

Entry point: **`reconstructFootFromBlobs`** / **`reconstructFootFromCapturedViews`** (`pipeline.ts`).

## Ordine per frame

Nel loop è applicato esplicitamente: **maschera → depth → point cloud** (coerente con la strategia; depth e maschera sono indipendenti, la nuvola usa entrambe).

## Scaling metrico

Le coordinate sono **mm relativi** al range depth (`depthNearMm` / `depthFarMm`). Per **mm assoluti** allineati al foglio A4/ArUco:

1. Calcola un fattore di scala dai marker (es. `pixelsPerMm` da biometria / detection).
2. Chiama `applyMetricScaleToPointCloud(result.cloud, scale)` sul risultato della ricostruzione.

## Estensione depth (MiDaS / ONNX)

Vedi commenti in `depthEstimation.ts`: stessa risoluzione dell’`ImageData` ridimensionato, output normalizzato con `normalizeDepth01`.

## API rapida

```ts
import {
  reconstructFootFromBlobs,
  applyMetricScaleToPointCloud,
  DEFAULT_RECONSTRUCTION_OPTIONS,
} from "@/lib/reconstruction";

const result = await reconstructFootFromBlobs(
  photos.map((p) => ({ blob: p.blob, phaseId: p.phaseId })),
  { maxImageSide: 256, voxelSizeMm: 4 }
);

// Opzionale, dopo calibrazione reale:
// const scaled = applyMetricScaleToPointCloud(result.cloud, calibrationFactor);
```

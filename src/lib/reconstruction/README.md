# Ricostruzione 3D approssimata (multi-vista)

Pipeline **client-side** pensata per essere veloce e coerente, senza dipendenze ML pesanti.

## Passi

1. **Profondità** — `estimateRelativeDepthNormalized`: gradiente + luminanza (pseudo-profondità), normalizzata in `[0,1]`.
2. **Maschera piede** — `extractFootMask` (euristica carta/pelle da `biometry/footMask`).
3. **Point cloud** — proiezione pinhole con focale normalizzata (`focalLengthNorm`), conversione mm, rotazione per `phaseId`.
4. **Merge** — media per voxel (`voxelSizeMm`) su tutte le viste.

## Fasi (allineamento grossolano)

| `phaseId` | Uso tipico        | Rotazione approssimata |
|-----------|-------------------|-------------------------|
| 0         | Vista dall’alto | identità                |
| 1         | Lato esterno      | −90° Y                  |
| 2         | Lato interno      | +90° Y                  |
| 3         | Tallone           | combinata X/Y (euristica) |

## Estensione: MiDaS / Depth Anything / ONNX

1. Aggiungere modello (es. ONNX quantizzato) in `public/models/`.
2. In `depthEstimation.ts`, aggiungere una funzione async che produce `Float32Array` per pixel (stessa risoluzione dell’`ImageData` ridimensionato).
3. Sostituire la chiamata a `estimateRelativeDepthNormalized` in `pipeline.ts` con l’output del modello, poi applicare `normalizeDepth01`.

Opzioni npm comuni: `onnxruntime-web`, `@xenova/transformers` (depth-estimation), `@tensorflow/tfjs` + grafico convertito.

## API

```ts
import { reconstructFootFromBlobs, DEFAULT_RECONSTRUCTION_OPTIONS } from "@/lib/reconstruction";

const result = await reconstructFootFromBlobs(
  photos.map((p) => ({ blob: p.blob, phaseId: p.phaseId })),
  { maxImageSide: 256, voxelSizeMm: 4 }
);
// result.cloud.positions — Float32Array xyz interleaved (mm)
// result.cloud.colors — Uint8Array rgb
```

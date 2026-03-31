# Biometria NEUMA (TypeScript)

## Cosa fa

1. **ArUco** — Rileva i 4 marker (id 0–3) con `@ar-js-org/aruco-rs` (stesso dizionario del foglio stampabile).
2. **Piano Z = 0** — Omografia **pixel → mm** sul foglio A4 usando i centri marker noti (`sheetGeometry.ts`).
3. **Scala** — Implicita nell’omografia; `mmPerPixelEstimate` è una media locale al centro foglio.
4. **Griglia cm** — Non serve un passo separato se i marker sono corretti: la scala metrica è fissata dalla geometria stampata. Le linee della griglia possono essere usate in una versione **OpenCV.js** per verifica incrociata (vedi sotto).
5. **Keypoint** — Vista canonica raddrizzata → maschera colore (pelle vs carta) → contorno → euristiche per alluce, metatarso, tallone.
6. **Output** — `NeumaBiometryExportPayload` (`schema: neuma.biometry.v1`) con `points[]` `{x,y,z}` in **mm** (Z=0 sul piano; altezza collo è placeholder finché non ci sono viste laterali fuse).

## OpenCV.js

L’omografia e la morfologia sono implementate in **TypeScript puro** per peso bundle e integrazione con il detector WASM esistente. In alternativa puoi:

- Sostituire `homographyFromImageToWorldMm` con `cv.findHomography` + gli stessi 4 punti.
- Sostituire `buildFootBinaryMask` con `cv.grabCut`, `cv.adaptiveThreshold`, ecc.

I tipi e il payload `exportPayload` restano stabili.

## Uso

```ts
import { computeNeumaBiometryFromImageData, serializeBiometryForMac } from "@/lib/biometry";

const imageData = ctx.getImageData(0, 0, w, h);
const result = await computeNeumaBiometryFromImageData(imageData);
if (result.calibration.ok) {
  console.log(result.exportPayload.points);
  await fetch("/api/biometry", { method: "POST", body: serializeBiometryForMac(result) });
}
```

## MacBook / .obj

Il Mac riceve JSON con punti e contorno nel piano foglio; la ricostruzione 3D completa e l’export `.obj` restano nel tool desktop (MeshLab, Blender, script proprietario) che solleva i punti da Z=0 usando fotogrammetria multi-vista o mesh fitting.

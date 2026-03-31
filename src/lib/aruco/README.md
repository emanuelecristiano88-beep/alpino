# Rilevamento ArUco (scanner NEUMA)

## Implementazione attuale

- **`@ar-js-org/aruco-rs`**: detector **WebAssembly** SIMD, dizionario **`ARUCO`** (stesso namespace usato da ARuco-ts / OpenCV “original ArUco” 5×5).
- **`arucoWasm.ts`**: init lazy + singleton `ARucoDetector`.
- **`a4MarkerGeometry.ts`**: scelta di 4 marker agli angoli del frame, rapporto lati **~210/297**, controllo “troppo vicino” (lato marker vs frame).
- **`useScanAlignmentAnalysis`**: campiona il video (fino a **480px** sul lato lungo quando WASM è pronto), chiama `detect_image`, combina con euristica **piede** (varianza al centro). Se WASM fallisce, resta solo l’euristica (`arucoEngine: "fallback"`).

## Allineare il PDF stampato

1. Genera i marker con lo **stesso dizionario** (`ARUCO`). Se il PDF usa **DICT_4X4_50** o **ARUCO_MIP_36H12**, imposta `ARUCO_DICTIONARY_NAME` in `arucoWasm.ts` (stringa supportata dalla build `aruco-rs`, es. `"ARUCO_MIP_36H12"` se esposta dal binding).
2. Opzionale: filtra per **ID attesi** ai 4 angoli in `combineArucoAndHeuristic` (oggi si accetta qualsiasi quadrupla con geometria A4).

## Test

- Apri lo scanner con HTTPS (fotocamera). In console, errori WASM di solito indicano MIME `.wasm` o path; in dev Vite serve il modulo da `node_modules` con `optimizeDeps.exclude` già impostato.

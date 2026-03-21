# Anteprima Luma-style → stampa Bambu A1

## Tecnologie

- **Gaussian splatting / NeRF (es. Luma Genie)**: rappresentazione a “nuvola” di primitive che cattura luce e dettaglio; richiede viewer dedicato (non è un GLB triangolato classico).
- **Viewer attuale (`LumaStyleViewer`)**: GLB + **MeshPhysicalMaterial** + **environment map** (Three.js / R3F) per avvicinarsi visivamente al look riflettente, usando la pipeline asset già gestibile in officina.

## Flusso prodotto

1. **Anteprima**: l’utente vede il modello con IBL e materiali TPU / tessuto / carbon (simulazione marketing).
2. **Scansione**: app con target ArUco (stile Snapfeet / iSun3D) per geometria piede in mm.
3. **Adattamento (Mac / M1)**: mesh estetica deformata / scalata / fitted al piede reale prima dello slice per **Bambu A1** (TPU).

## Prossimo step splat

Quando avrete export `.splat` / `.ply` da Luma (o tool interno), aggiungere un secondo viewer che carica quell’asset e tenere il GLB come fallback per compatibilità e produzione.

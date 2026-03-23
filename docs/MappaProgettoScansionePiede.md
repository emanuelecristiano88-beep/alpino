# Mappa del Progetto: Acquisizione Scansione Piede

Questo documento fornisce una panoramica dei file chiave che gestiscono il flusso di acquisizione della scansione del piede, dal tutorial alla cattura finale.

## 1. Definizione e Configurazione del Flusso (Fonte di Verità)

* **`src/constants/scanCapturePhases.ts`**:
    * **Ruolo**: Unica fonte di verità per le 4 fasi di acquisizione (Alto, Esterno, Interno, Tallone).
    * **Contenuto**: Tipi (`ScanPhaseId`), testi per l'interfaccia utente (nomi, istruzioni, testi del pannello), percorsi per le immagini di riferimento (`SCAN_PHASE_RASTER`), didascalie (`SCAN_PHASE_REFERENCE_PHOTO`), blurbs per il modale tutorial (`SCAN_PHASE_TUTORIAL_BLURB`).
    * **Utilizzato da**: `ScannerCattura.tsx`, `ScannerPhaseGuidePanel.tsx`, `ScanPhaseGuideIllustration.tsx`, `ScanTutorialModal.tsx`, `ScanPhaseReferenceGrid.tsx`.

* **`src/AppShell.tsx`**:
    * **Ruolo**: Gestisce il flusso utente ad alto livello.
    * **Contenuto**: Logica per mostrare il tutorial all'inizio, promemoria materiale, passare allo scanner e gestire gli stati collegati.

## 2. Esperienza Utente (UI/UX) e Componenti

### 2.1 Tutorial Introduttivo ("Prima di Iniziare")

* **`src/components/ScanTutorialModal.tsx`**:
    * **Ruolo**: Modale iniziale con le istruzioni generali e la checklist delle 4 inquadrature.
    * **Contenuto**: Passi preparazione + fasi 1–4 + invio, link alla guida completa, `FootPlacementGuideVisual` e `ScanTutorialSceneVisual`.

* **`src/components/ScanTutorialSceneVisual.tsx`**:
    * **Ruolo**: Visualizzazione introduttiva (foto cliente + operatore sul foglio).
    * **Utilizza**: `src/lib/neumaAssets.ts` (costante `NEUMA_TUTORIAL_INTRO_IMAGE`).

### 2.2 Pannello delle Fasi (Guida Fase per Fase)

* **`src/components/scanner/ScannerPhaseGuidePanel.tsx`**:
    * **Ruolo**: Schermata intermedia visualizzata prima di ogni fase di scansione.
    * **Utilizza**: `src/constants/scanCapturePhases.ts` (testi), `ScanPhaseGuideIllustration.tsx`.

* **`src/components/scanner/ScanPhaseGuideIllustration.tsx`**:
    * **Ruolo**: Visualizza l'immagine di riferimento della fase (`SCAN_PHASE_RASTER`) o SVG di fallback se il file manca.
    * **Utilizza**: `SCAN_PHASE_RASTER` e `SCAN_PHASE_REFERENCE_PHOTO` (da `scanCapturePhases.ts`).

### 2.3 Schermata di Cattura della Scansione

* **`src/ScannerCattura.tsx`**:
    * **Ruolo**: Componente principale dello scanner (camera, fasi, scatti, upload).
    * **Utilizza**: `src/constants/scanCapturePhases.ts` (fasi e istruzioni), overlay allineamento, pannello guida fase.

* **`src/components/scanner/ScannerAlignmentOverlay.tsx`**:
    * **Ruolo**: Overlay grafico (riquadro blu) sulla vista della fotocamera, mirino centrale.
    * **Contenuto**: Componente `ArucoCornerHint` per i 4 angoli (allineamento ai marker ArUco sul foglio); feedback verde quando i marker sono considerati validi.

### 2.4 Pagine di Guida e Anteprima (Riferimento Utente)

* **`src/pages/GuidaScansionePiedePage.tsx`**:
    * **Ruolo**: Pagina web con la guida dettagliata alla scansione.

* **`src/components/ScanPhaseReferenceGrid.tsx`**:
    * **Ruolo**: Griglia **2×2** con le immagini di riferimento per tutte e 4 le fasi.
    * **Utilizzato in**: `GuidaScansionePiedePage.tsx`.

* **`src/components/FootPlacementGuideVisual.tsx`**:
    * **Ruolo**: Anteprima del foglio NEUMA (target A4 + ArUco) nel tutorial e nella guida.
    * **Utilizza**: `src/lib/neumaAssets.ts` (`NEUMA_A4_TARGET_PREVIEW`), fallback SVG se l'immagine non è disponibile.

## 3. Asset e File Statici

* **`src/lib/neumaAssets.ts`**:
    * **Ruolo**: Esporta i percorsi per gli asset statici comuni.
    * **Esempi**: `NEUMA_A4_TARGET_PREVIEW`, `NEUMA_TUTORIAL_INTRO_IMAGE`.

* **Cartella `public/`**:
    * Contiene le immagini referenziate (es. `neuma-a4-target-preview.png`, `tutorial-intro-operator-scene.png`, `scan-guides/phase-0.png` … `phase-3.png`).
    * Vedi anche `public/scan-guides/README.md` per l’elenco delle fasi associate ai file.

## 4. UX e anteprima mesh (STL)

* **`docs/UX-e-anteprima-STL.md`** — idee di miglioramento UX e come collegare l’anteprima STL quando il backend espone un URL del mesh.

---

*Documento generato per orientamento nel codebase; aggiornare se si aggiungono nuovi entry point o flussi.*

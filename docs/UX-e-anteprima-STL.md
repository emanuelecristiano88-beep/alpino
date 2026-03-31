# Migliorare l’esperienza utente e anteprima STL della scansione

## Miglioramenti UX (senza dipendere dal backend)

| Area | Idee |
|------|------|
| **Feedback** | Messaggi chiari per “troppo vicino / troppo lontano / marker non visti”; stato di allineamento già supportato in parte dall’overlay blu + angoli ArUco. |
| **Progressione** | Mostrare sempre **fase X/4** e **foto nella fase** (es. 3/8) in modo coerente; ridurre ansia con copy breve (“ultimi scatti di questa fase”). |
| **Errori** | Azioni guidate: “riprova fotocamera”, “controlla luce”, link rapido a **Guida scansione** / **Guida stampa**. |
| **Accessibilità** | Contrasto testi su overlay; etichette `aria-*` dove mancano; riduzione animazioni se `prefers-reduced-motion`. |
| **Post-upload** | Evitare “finto” completamento: se il modello 3D non è ancora pronto, dire esplicitamente **“Foto ricevute — modello in elaborazione”** invece di un 3D generico. |
| **Performance** | Ridurre risoluzione preview video dove possibile; lazy-load viewer 3D solo dopo tap “Visualizza”. |

---

## Anteprima del file STL della scansione: è possibile?

**Sì, lato app è fattibile** e nel repo esiste già tutto il necessario per **visualizzare un STL** in Three.js:

- `STLLoader` usato in `components/three/DigitalFittingViewer.tsx` e `src/components/VirtualTryOnViewer.tsx`.
- Pattern: `useLoader(STLLoader, url)` → `BufferGeometry` → mesh con materiali + `OrbitControls`.

### Cosa manca oggi

1. **`/api/process-scan`** (vedi `api/process-scan.ts`) riceve le foto e restituisce **metriche di esempio** e metadati Drive, ma **non** un URL verso un mesh `.stl` / `.glb` del piede ricostruito.
2. In **`ScannerCattura.tsx`**, lo stato `visualizing` mostra **`FootCanvas`** con un modello **placeholder** (sneaker GLB), **non** l’output della scansione.

Quindi l’anteprima STL **non è un limite del frontend**: serve una **pipeline di ricostruzione** (fotogrammetria in officina / job asincrono) che produca il file e lo esponga via HTTPS.

### Modello consigliato (prodotto)

1. **Upload** → conferma ricezione (`scanId`).
2. **Job asincrono** (worker / servizio esterno): elabora le foto → genera `foot_left.stl` / `foot_right.stl` (o un unico mesh).
3. **API di stato** (es. `GET /api/scan-status?scanId=…`) con stati: `queued` | `processing` | `ready` | `failed`.
4. Quando `ready`, la risposta include ad esempio:
   - `meshUrl: "https://…/signed-url/scan_xyz/foot.stl"`  
   oppure path sotto il vostro dominio: `/api/scan-mesh?scanId=…` che streamma il file.
5. **Frontend**: nuovo viewer leggero (es. `FootScanStlPreview`) che accetta `meshUrl`, carica STL con `STLLoader`, material tipo “scansione” (blu/grigio), orbit controls — in sostituzione o affiancato al placeholder attuale.

### Sicurezza e peso

- Usare **URL firmati** o token di sessione per non esporre gli STL pubblicamente.
- STL possono essere pesanti: considerare **decimazione** lato server o formato **glb** compresso.
- **Privacy**: stesso livello di trattamento già previsto per le foto (informativa, retention).

---

## Riferimenti file utili

| File | Nota |
|------|------|
| `api/process-scan.ts` | Punto dove, in futuro, si potrebbe aggiungere `meshUrl` nella risposta `success` (dopo pipeline reale). |
| `src/ScannerCattura.tsx` | Parsing risposta upload (~riga 700+); stato `visualizing` + `FootCanvas`. |
| `components/three/DigitalFittingViewer.tsx` | Esempio di caricamento STL + scala / materiali. |
| `src/components/VirtualTryOnViewer.tsx` | `TryOnShoeStl` — pattern riutilizzabile per un piede STL. |

---

*Documento orientativo: aggiornare quando la pipeline 3D e le API mesh saranno disponibili.*

# Google Drive — upload foto NEUMA

Le API `/api/process-scan` (scanner piede SX+DX) e `/api/upload-operator-shot` (cupola 32 settori) caricano i file nella **tua** Google Drive usando un **Service Account**.

## 1. Google Cloud

1. Crea un progetto (o usa uno esistente) su [Google Cloud Console](https://console.cloud.google.com/).
2. **API e servizi → Libreria** → abilita **Google Drive API**.
3. **IAM e amministrazione → Account di servizio** → **Crea account di servizio** (nome es. `neuma-upload`).
4. Apri l’account → **Chiavi** → **Aggiungi chiave** → **JSON** e scarica il file.

## 2. Cartella sul tuo Drive

1. In Google Drive crea una cartella (es. `NEUMA Scansioni`) dove vuoi ricevere le foto.
2. Apri la cartella e copia l’**ID** dall’URL:  
   `https://drive.google.com/drive/folders/QUESTO_E_L_ID`
3. **Condividi** la cartella: aggiungi l’**email del service account** (nel JSON è `client_email`, tipo `neuma-upload@....iam.gserviceaccount.com`) con ruolo **Editor**.

Senza questo passaggio l’upload fallisce con errore di permessi.

## 3. Variabili su Vercel

Nel progetto Vercel → **Settings → Environment Variables**:

| Nome | Valore |
|------|--------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Intero contenuto** del file JSON della chiave (una sola riga incollata, o stringa JSON valida). |
| `GOOGLE_DRIVE_FOLDER_ID` | ID cartella dal passo 2. |

Opzionale ma consigliato in produzione:

| Nome | Valore |
|------|--------|
| `UPLOAD_API_SECRET` | Stringa segreta generata (es. `openssl rand -hex 32`). |
| (nel client) `VITE_UPLOAD_API_SECRET` | **Stesso valore** — così solo il tuo frontend può chiamare le API. |

Dopo aver impostato `UPLOAD_API_SECRET`, aggiungi anche `VITE_UPLOAD_API_SECRET` negli env **Preview/Production** del build Vite e rifai il deploy.

## 4. Locale con upload reale

`npm run dev` usa mock senza Drive. Per testare Drive in locale:

```bash
npx vercel dev
```

Configura le stesse variabili in `.env.local` alla root (vedi `.env.example`).

## Nomi file su Drive

- **process-scan**: sottocartella `scan_<timestamp>_<scanId>/` con i file originali (`left_00.jpg`, …).
- **upload-operator-shot**: file nella cartella root configurata: `operator_<sessionId>_sector_<nn>.jpg`.

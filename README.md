# NEUMA

Stack UI: **React + Vite**, **Tailwind CSS**, **shadcn/ui** (stile **New York**, base colore **Zinc**), **Radix UI**. Tema **dark** di default (`<html class="dark">`), raggio **0.75rem** (`--radius`), font **Inter** (sans) / **JetBrains Mono** (mono) da Google Fonts.

Componenti in `src/components/ui/` (`button`, `card`, `dialog`, `input`, `label`, `slider`, `badge`). Alias `@/` → `src/` (vedi `vite.config.js` e `jsconfig.json`).

Effetti scanner (griglia, flash, outline) in `src/scanner-effects.css` (colori legati a `hsl(var(--primary))`).

## Dev server e porte (5173 bianco / 5174 ok)

Se **`localhost:5173` è tutto bianco** ma **`localhost:5174`** va bene, quasi sempre la **5173 è ancora occupata** da un vecchio `vite` (o da un altro progetto). Il nuovo `npm run dev` allora usa la porta successiva.

**Cosa fare:**

1. Usa **solo l’URL che Vite stampa nel terminale** (es. `http://localhost:5174/`).
2. Oppure libera la 5173 e riavvia un solo server:

```bash
# macOS: termina il processo sulla porta 5173
lsof -ti:5173 | xargs kill -9
cd /path/to/neuma-app && npm run dev
```

Poi apri di nuovo **`http://localhost:5173`**.

## Telefono / tablet (stessa Wi‑Fi del Mac)

**`http://127.0.0.1:5173` sul cellulare non è il tuo computer** — `127.0.0.1` è sempre “questo dispositivo”, quindi dal telefono non vedrai mai il dev server sul Mac.

### HTTPS (fotocamera / scanner)

Il browser **blocca fotocamera e microfono** su `http://192.168…` (non è un *secure context*). Per questo può comparire un messaggio tipo “usa HTTPS o localhost”.

Con `npm run dev` il progetto abilita **HTTPS in sviluppo** (`@vitejs/plugin-basic-ssl`).

1. Mac e telefono sulla **stessa rete Wi‑Fi**.
2. Avvia `npm run dev`: nel terminale comparirà **Local** e **Network** con **`https://`** (es. `https://192.168.1.xxx:5173/`).
3. Sul telefono apri **quell’URL HTTPS** (non `http://`). La prima volta il browser segnalerà certificato non attendibile: **Avanzate → procedi comunque** (è normale in locale).
4. Se preferisci solo HTTP sul desktop (senza avviso certificato): `npm run dev:http` — ma dal **cellulare la camera potrebbe non funzionare** finché non usi HTTPS o un tunnel (ngrok, ecc.).

### Rete e firewall

- Se non compare l’IP: sul Mac `ipconfig getifaddr en0` (Wi‑Fi).
- **Firewall macOS**: consenti Node/Terminal in entrata.
- **Wi‑Fi ospiti**: spesso i dispositivi non si vedono; usa la rete principale.

## Deploy su Vercel

Progetto **Vite + React** (SPA) con API in **`/api/*.ts`** (Vercel Serverless: `process-scan` e upload operatore usano **Node.js** + **Google Drive** se configurato; vedi **`docs/GOOGLE_DRIVE.md`**).

1. Installa la CLI: `npm i -g vercel`
2. Dalla cartella del progetto: `vercel` (prima volta) oppure `vercel --prod` per produzione.
3. In dashboard Vercel verifica **Framework Preset: Vite** e **Output: `dist`** (già indicati in `vercel.json`).

**Rotte client** (`/tecnologia-tpu`, `/guida-stampa`, `/guida-scansione`, `/bussola-del-piede`, `/su-misura`, ecc.): gestite da React Router; `vercel.json` reindirizza le richieste SPA a `index.html` (le API `/api/*` hanno priorità sulle rewrite).

**Nota:** la vecchia cartella `app/api/.../route.ts` (stile Next.js) è stata spostata in `docs/backend-reference-next-app-router/` per evitare che Vercel confonda il progetto con Next senza `next` installato.

## React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
 

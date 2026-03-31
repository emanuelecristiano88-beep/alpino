# Riferimento route Next.js (App Router)

Questi file erano in `app/api/.../route.ts` e potevano far **confondere Vercel** (preset Next.js senza `next` nel `package.json`).

Le API in produzione sono ora in **`/api/*.ts`** alla radice del progetto (Vercel Serverless, Edge).

Implementazione attiva:

- `../../api/orders.ts`
- `../../api/process-scan.ts`

Questa cartella resta solo come **riferimento** (es. versione con `fs` su disco locale).

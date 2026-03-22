# Deploy (Vercel) — verifica

Nel codice in **questa cartella** non compare la stringa «Bambu» / «Bambu Lab A1» (menu: **Tecnologia TPU & stampanti 3D**).

Se sul sito vedi ancora **verde** o **Bambu**:

1. **Conferma il deploy**  
   Nel **Menu** deve apparire una riga grigia piccola:  
   `Build: 2026-03-19-vercel-blue-check — se non vedi questa riga...`  
   - Se **non** la vedi → Vercel sta collegato a **un altro repo**, **un altro branch** o **Root Directory** sbagliata.
2. **Vercel Dashboard** → progetto → **Settings → Git**  
   Controlla repository, branch di produzione e **Root Directory** (deve essere la cartella dove c’è `package.json` di questo progetto).
3. **Redeploy** dopo `git push` (o deploy manuale da dashboard).
4. **Immagine** `public/neuma-a4-target-preview.png` (anteprima foglio NEUMA nel tutorial)  
   Se in produzione è assente o datata, sostituiscila con l’export aggiornato dalla Guida stampa.

Ricerca locale: `rg -i bambu` nella root del progetto → nessun risultato atteso.

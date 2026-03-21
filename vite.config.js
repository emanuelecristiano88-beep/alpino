import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * DEV_HTTP=1 (default `npm run dev`) → HTTP, avvio stabile su localhost.
 * `npm run dev:https` → HTTPS (basicSsl); utile per fotocamera da telefono su IP locale (secure context).
 */
const useDevHttps = process.env.DEV_HTTP !== '1'

// In dev (solo Vite) intercetta POST /api/orders così fetch() funziona in locale.
// In deploy (Vercel) usa /api/orders.ts (vedi root `api/`).
function apiOrdersDevPlugin() {
  return {
    name: 'api-orders-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url !== '/api/orders' || req.method !== 'POST') {
          next()
          return
        }
        let raw = ''
        req.on('data', (c) => {
          raw += c
        })
        req.on('end', () => {
          try {
            const parsed = raw ? JSON.parse(raw) : {}
            console.log('[DEV Vite] POST /api/orders — ordine:', JSON.stringify(parsed, null, 2))
          } catch {
            console.warn('[DEV Vite] POST /api/orders — body non JSON')
          }
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              ok: true,
              orderId: `dev-${Date.now()}`,
              message: 'Ordine simulato (Vite dev server)',
            })
          )
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(useDevHttps ? [basicSsl()] : []), apiOrdersDevPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  /**
   * host: true → ascolta su tutte le interfacce (utile se localhost non risponde).
   * strictPort: true → sempre 5173; se occupata, `npm run dev` fallisce → chiudi il vecchio processo
   * (altrimenti Vite saltava su 5174 e restava una versione vecchia in ascolto).
   */
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  /**
   * Primo `vite build` con Three/R3F può richiedere **diversi minuti** sul Mac.
   * `reportCompressedSize: false` evita un passaggio lento; i chunk separati aiutano la cache.
   */
  build: {
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        /**
         * Solo vendor pesanti separati. Evitare di spezzare React/React-DOM in chunk
         * incoerenti (può dare schermata vuota in produzione).
         */
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('@react-three')) return 'r3f'
        },
      },
    },
  },
})

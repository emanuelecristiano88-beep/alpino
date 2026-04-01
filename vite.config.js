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

/**
 * In dev (solo Vite) intercetta POST /api/* così fetch() non va in 404.
 * Su Vercel usano le funzioni in root `api/`. Per test Drive reale: `vercel dev`.
 */
function apiDevRoutesPlugin() {
  const devScanId = () => `dev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  return {
    name: 'api-dev-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (req.method !== 'POST') {
          next()
          return
        }

        if (url === '/api/upload-operator-shot') {
          req.on('data', () => {})
          req.on('end', () => {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                ok: true,
                driveUploaded: false,
                message:
                  'Vite dev: nessun upload. Configura Drive su Vercel o usa `vercel dev` con env.',
              })
            )
          })
          return
        }

        if (url === '/api/process-scan') {
          req.on('data', () => {})
          req.on('end', () => {
            const scanId = devScanId()
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                status: 'success',
                scanId,
                path: '/scans/dev',
                receivedCount: 1,
                savedCount: 1,
                driveUploaded: false,
                driveFolderId: null,
                driveFolderLink: null,
                driveFileIds: [],
                scaleFactorApplied: 1.0,
                scaleReferenceNote: 'Vite dev mock',
                scaleReference: {
                  type: 'coded_a4_target',
                  shortSideMm: 210,
                  markerBaselineMm: 210,
                  detectionMode: 'aruco_a4',
                },
                message: 'Pronto per la ricostruzione 3D (NEUMA)',
                metrics: {
                  lunghezzaMm: 265,
                  larghezzaMm: 95,
                  altezzaArcoMm: 28,
                  circonferenzaColloMm: 246,
                  volumeCm3: 1450,
                  left: {
                    lunghezzaMm: 264,
                    larghezzaMm: 98,
                    altezzaArcoMm: 27,
                    circonferenzaColloMm: 244,
                    volumeCm3: 1420,
                  },
                  right: {
                    lunghezzaMm: 267,
                    larghezzaMm: 101,
                    altezzaArcoMm: 29,
                    circonferenzaColloMm: 248,
                    volumeCm3: 1480,
                  },
                  scanVersion: 'V6',
                },
              })
            )
          })
          return
        }

        if (url === '/api/orders') {
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
          return
        }

        next()
      })
    },
  }
}

/**
 * Some Android browsers are picky about WASM MIME types in dev.
 * Force correct headers for *.wasm, especially /lib/opencv.wasm.
 */
function wasmMimePlugin() {
  return {
    name: 'wasm-mime',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0] || ''
        if (url.endsWith('.wasm')) {
          try {
            res.setHeader('Content-Type', 'application/wasm')
            // Dev-only: avoid stale cache on device while iterating
            res.setHeader('Cache-Control', 'no-store')
          } catch {}
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...(useDevHttps ? [basicSsl()] : []), wasmMimePlugin(), apiDevRoutesPlugin()],
  /** WASM + import.meta.url nel pacchetto ArUco: evita pre-bundle che rompe il .wasm */
  optimizeDeps: {
    exclude: ['@ar-js-org/aruco-rs'],
  },
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
        manualChunks(id) {
          // Force shared libs that BOTH ScannerCattura (eager) and lazy 3D/recon
          // chunks use into their own chunk, breaking the circular dependency
          // that causes TDZ ("Cannot access before initialization").
          if (id.includes('/lib/utils/yieldToMain'))  return 'shared-utils';
          if (id.includes('/lib/biometry/'))           return 'shared-biometry';
          if (id.includes('/lib/reconstruction/') && !id.includes('footSurfaceMesh')) return 'shared-recon';
          if (id.includes('/lib/aruco/'))              return 'shared-aruco';
          if (id.includes('/lib/scanner/'))            return 'shared-scanner-lib';
          if (id.includes('/constants/'))              return 'shared-constants';
        },
      },
    },
  },
})

import { Suspense, lazy, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { ThemeProvider } from './theme/ThemeProvider'
import './index.css'
import './scanner-effects.css'

// ScannerCattura: static (non-lazy) import so any module-level TDZ/circular-dep
// error surfaces at build time and in the console as a real stack trace.
import ScannerCattura from './ScannerCattura'

const AppShell = lazy(() => import('./AppShell'))
const AdminThemePanel = lazy(() => import('./pages/AdminThemePanel'))
const GuidaStampaPage = lazy(() => import('./pages/GuidaStampaPage'))
const TecnologiaTpuPage = lazy(() => import('./pages/TecnologiaTpuPage'))
const PreparaScansionePage = lazy(() => import('./pages/PreparaScansionePage'))
const GuidaScansionePiedePage = lazy(() => import('./pages/GuidaScansionePiedePage'))
const BussolaPiedePage = lazy(() => import('./pages/BussolaPiedePage'))
const SuMisuraPage = lazy(() => import('./pages/SuMisuraPage'))
const ScanResults3D = lazy(() => import('./pages/ScanResults3D'))
const DesignPlantarePage = lazy(() => import('./pages/DesignPlantarePage'))
const ScannerOperatore = lazy(() => import('./components/ScannerOperatore'))
const TestCameraPage = lazy(() => import('./pages/TestCameraPage'))

function Loader() {
  return (
    <div style={{ background: '#000', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'rgba(255,255,255,0.7)', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

/**
 * Standalone scanner route.
 * - Owns the close button (X) that navigates back.
 * - Listens for `neuma:scan-proceed` (dispatched by ScannerCattura when scan is done)
 *   and redirects to /scan-results.
 * - Blocks landscape on touch devices with a gentle overlay (not a hard lock).
 */
function ScannerRoute() {
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e) => {
      const detail = e.detail
      if (detail?.scanId) {
        navigate('/scan-results', { state: { scanId: detail.scanId } })
      } else {
        navigate('/scan-results')
      }
    }
    window.addEventListener('neuma:scan-proceed', handler)
    return () => window.removeEventListener('neuma:scan-proceed', handler)
  }, [navigate])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000', width: '100vw', height: '100dvh' }}>
      {/* Close button — top-right, pointer-events isolated */}
      <div style={{ position: 'absolute', top: 0, right: 0, zIndex: 110, padding: 12, pointerEvents: 'none' }}>
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Chiudi scanner"
          style={{
            pointerEvents: 'auto',
            background: 'rgba(24,24,27,0.8)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '50%',
            width: 44,
            height: 44,
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Scanner — fills the entire viewport, no wrapper transforms */}
      <ScannerCattura />
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <BrowserRouter>
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/test-camera" element={<TestCameraPage />} />
          <Route path="/scanner" element={<ScannerRoute />} />
          <Route path="/guida-stampa" element={<GuidaStampaPage />} />
          <Route path="/tecnologia-tpu" element={<TecnologiaTpuPage />} />
          <Route path="/prepara-scansione" element={<PreparaScansionePage />} />
          <Route path="/guida-scansione" element={<GuidaScansionePiedePage />} />
          <Route path="/bussola-del-piede" element={<BussolaPiedePage />} />
          <Route path="/su-misura" element={<SuMisuraPage />} />
          <Route path="/scan-results" element={<ScanResults3D />} />
          <Route path="/design-plantare" element={<DesignPlantarePage />} />
          <Route path="/scanner-operatore" element={<ScannerOperatore />} />
          <Route path="/admin/theme" element={<AdminThemePanel />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </ThemeProvider>,
)

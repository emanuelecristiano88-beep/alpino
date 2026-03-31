import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './theme/ThemeProvider'
import './index.css'
import './scanner-effects.css'

const AppShell = lazy(() => import('./AppShell'))
const ScannerCattura = lazy(() => import('./ScannerCattura'))
const AdminThemePanel = lazy(() => import('./pages/AdminThemePanel'))
const GuidaStampaPage = lazy(() => import('./pages/GuidaStampaPage'))
const TecnologiaTpuPage = lazy(() => import('./pages/TecnologiaTpuPage'))
const PreparaScansionePage = lazy(() => import('./pages/PreparaScansionePage'))
const GuidaScansionePiedePage = lazy(() => import('./pages/GuidaScansionePiedePage'))
const BussolaPiedePage = lazy(() => import('./pages/BussolaPiedePage'))
const SuMisuraPage = lazy(() => import('./pages/SuMisuraPage'))
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

createRoot(document.getElementById('root')).render(
  <ThemeProvider>
    <BrowserRouter>
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/test-camera" element={<TestCameraPage />} />
          <Route path="/scanner" element={<ScannerCattura />} />
          <Route path="/guida-stampa" element={<GuidaStampaPage />} />
          <Route path="/tecnologia-tpu" element={<TecnologiaTpuPage />} />
          <Route path="/prepara-scansione" element={<PreparaScansionePage />} />
          <Route path="/guida-scansione" element={<GuidaScansionePiedePage />} />
          <Route path="/bussola-del-piede" element={<BussolaPiedePage />} />
          <Route path="/su-misura" element={<SuMisuraPage />} />
          <Route path="/scanner-operatore" element={<ScannerOperatore />} />
          <Route path="/admin/theme" element={<AdminThemePanel />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </ThemeProvider>,
)

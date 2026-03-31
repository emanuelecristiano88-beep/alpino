import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './theme/ThemeProvider'
import './index.css'
import './scanner-effects.css'
import AppShell from './AppShell'
import AdminThemePanel from './pages/AdminThemePanel'
import GuidaStampaPage from './pages/GuidaStampaPage'
import TecnologiaTpuPage from './pages/TecnologiaTpuPage'
import PreparaScansionePage from './pages/PreparaScansionePage'
import GuidaScansionePiedePage from './pages/GuidaScansionePiedePage'
import BussolaPiedePage from './pages/BussolaPiedePage'
import SuMisuraPage from './pages/SuMisuraPage'
import ScannerOperatore from './components/ScannerOperatore'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
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
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)

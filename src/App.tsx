import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { Chat } from './pages/Chat'
import { Agenda } from './pages/Agenda'
import { Choferes } from './pages/Choferes'
import { Reportes } from './pages/Reportes'
import { Cobros } from './pages/Cobros'
import { Configuracion } from './pages/Configuracion'
import { Clientes } from './pages/Clientes'
import { Activacion } from './pages/Activacion'
import { useAppStore } from './store/useAppStore'
import type { Licencia } from './types'

export default function App() {
  const {
    loadInitialData, setLicencia, setLicenciaStatus,
    licenciaStatus, refreshViajesHoy,
  } = useAppStore()

  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return

    window.electronAPI.licencia.check().then(async result => {
      if (result.valid) {
        const lic = await window.electronAPI.licencia.get()
        setLicencia(lic as Licencia)
        setLicenciaStatus('valid', result.diasRestantes ?? null)
        await loadInitialData()
      } else {
        setLicenciaStatus(result.reason ?? 'none')
      }
    })

    if (window.electronAPI.viajesEvents) {
      window.electronAPI.viajesEvents.onCreated(() => refreshViajesHoy())
    }

    if (window.electronAPI.actualizador) {
      window.electronAPI.actualizador.onUpdateAvailable(v => { setUpdateVersion(v); setUpdateError(null) })
      window.electronAPI.actualizador.onUpdateDownloaded(() => setUpdateReady(true))
      window.electronAPI.actualizador.onUpdateProgress(p => setUpdateProgress(p))
      window.electronAPI.actualizador.onUpdateError(msg => setUpdateError(msg))
    }

    return () => {
      window.electronAPI.viajesEvents?.removeListeners()
      window.electronAPI.actualizador?.removeListeners()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cargando verificación de licencia
  if (licenciaStatus === 'loading') {
    return (
      <div className="h-screen bg-[#0F1E3C] flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-blue-200">Verificando licencia...</p>
        </div>
      </div>
    )
  }

  // Licencia inválida → pantalla de activación
  if (licenciaStatus !== 'valid') {
    return (
      <>
        <TitleBar />
        <Activacion motivo={licenciaStatus as 'none' | 'expired' | 'revoked' | 'offline' | 'pc_mismatch'} />
      </>
    )
  }

  // App principal
  return (
    <HashRouter>
      <div className="flex flex-col h-screen bg-[#F8FAFC] overflow-hidden">
        <TitleBar />
        {(updateVersion || updateError) && (
          <div className={`flex items-center justify-between text-white text-sm px-4 py-1.5 z-50 ${updateError ? 'bg-red-600' : 'bg-blue-600'}`}>
            <span>
              {updateError
                ? `Error al actualizar: ${updateError}`
                : <>
                    Nueva versión <strong>v{updateVersion}</strong> disponible
                    {updateReady
                      ? ' — lista para instalar'
                      : updateProgress !== null
                        ? ` — descargando ${updateProgress}%`
                        : ' — descargando...'}
                  </>
              }
            </span>
            {updateReady && !updateError && (
              <button
                onClick={() => window.electronAPI.actualizador.installUpdate()}
                className="ml-4 bg-white text-blue-700 font-semibold px-3 py-0.5 rounded hover:bg-blue-50 transition-colors"
              >
                Actualizar
              </button>
            )}
          </div>
        )}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/agenda" element={<Agenda />} />
              <Route path="/choferes" element={<Choferes />} />
              <Route path="/reportes" element={<Reportes />} />
              <Route path="/cobros" element={<Cobros />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/configuracion" element={<Configuracion />} />
            </Routes>
          </main>
        </div>
      </div>
    </HashRouter>
  )
}

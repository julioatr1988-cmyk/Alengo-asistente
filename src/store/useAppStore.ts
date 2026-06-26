import { create } from 'zustand'
import { format } from 'date-fns'
import type { Empresa, Chofer, Ruta, Viaje, WhatsAppStatus, Licencia, LicenciaStatus } from '../types'

interface AppStore {
  // Datos
  empresa: Empresa | null
  choferes: Chofer[]
  rutas: Ruta[]
  viajesHoy: Viaje[]
  unreadMessages: number
  whatsappStatus: WhatsAppStatus

  // Licencia
  licencia: Licencia | null
  licenciaStatus: LicenciaStatus
  licenciaDiasRestantes: number | null

  // Acciones
  setEmpresa: (e: Empresa) => void
  setChoferes: (c: Chofer[]) => void
  setRutas: (r: Ruta[]) => void
  setViajesHoy: (v: Viaje[]) => void
  setUnreadMessages: (n: number) => void
  setWhatsappStatus: (s: WhatsAppStatus) => void
  setLicencia: (l: Licencia | null) => void
  setLicenciaStatus: (s: LicenciaStatus, dias?: number | null) => void

  // Carga inicial
  loadInitialData: () => Promise<void>
  refreshViajesHoy: () => Promise<void>
}

export const useAppStore = create<AppStore>((set) => ({
  empresa: null,
  choferes: [],
  rutas: [],
  viajesHoy: [],
  unreadMessages: 0,
  whatsappStatus: { connected: false, phone: null },
  licencia: null,
  licenciaStatus: 'loading',
  licenciaDiasRestantes: null,

  setEmpresa: (empresa) => set({ empresa }),
  setChoferes: (choferes) => set({ choferes }),
  setRutas: (rutas) => set({ rutas }),
  setViajesHoy: (viajesHoy) => set({ viajesHoy }),
  setUnreadMessages: (unreadMessages) => set({ unreadMessages }),
  setWhatsappStatus: (whatsappStatus) => set({ whatsappStatus }),
  setLicencia: (licencia) => set({ licencia }),
  setLicenciaStatus: (licenciaStatus, dias = null) =>
    set({ licenciaStatus, licenciaDiasRestantes: dias ?? null }),

  loadInitialData: async () => {
    if (!window.electronAPI) return
    const [empresa, choferes, rutas, status] = await Promise.all([
      window.electronAPI.empresa.get(),
      window.electronAPI.choferes.get(),
      window.electronAPI.rutas.get(),
      window.electronAPI.whatsapp.getStatus(),
    ])
    set({ empresa, choferes, rutas, whatsappStatus: status })

    const hoy = format(new Date(), 'yyyy-MM-dd')
    const viajesHoy = await window.electronAPI.viajes.get(hoy)
    set({ viajesHoy })
  },

  refreshViajesHoy: async () => {
    if (!window.electronAPI) return
    const hoy = format(new Date(), 'yyyy-MM-dd')
    const viajesHoy = await window.electronAPI.viajes.get(hoy)
    set({ viajesHoy })
  },
}))

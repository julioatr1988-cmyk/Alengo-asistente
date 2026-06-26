import { NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, MessageSquare, CalendarDays,
  Users, BarChart3, CreditCard, Settings, Bus
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/chat', icon: MessageSquare, label: 'Chat WhatsApp', badge: true },
  { to: '/agenda', icon: CalendarDays, label: 'Agenda' },
  { to: '/choferes', icon: Users, label: 'Choferes' },
  { to: '/reportes', icon: BarChart3, label: 'Reportes' },
  { to: '/cobros', icon: CreditCard, label: 'Cobros' },
  { to: '/configuracion', icon: Settings, label: 'Configuración' },
]

export function Sidebar() {
  const { unreadMessages, empresa } = useAppStore()
  const nombreEmpresa = empresa?.nombre ?? 'Alengo'
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.electronAPI.app.getVersion().then(setVersion)
  }, [])

  return (
    <aside className="w-60 flex-shrink-0 bg-primary h-full flex flex-col">
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-secondary rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
            {empresa?.logo
              ? <img src={empresa.logo} alt="Logo" className="w-full h-full object-contain" />
              : <Bus size={18} className="text-white" />
            }
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-bold leading-tight truncate">{nombreEmpresa}</p>
            <p className="text-white/50 text-xs">Asistente Virtual</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {NAV.map(({ to, icon: Icon, label, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                isActive
                  ? 'bg-secondary text-white font-medium'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`
            }
          >
            <Icon size={18} />
            <span className="flex-1">{label}</span>
            {badge && unreadMessages > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {unreadMessages > 9 ? '9+' : unreadMessages}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-white/10">
        <p className="text-white/30 text-xs text-center">{version ? `v${version}` : ''}</p>
      </div>
    </aside>
  )
}

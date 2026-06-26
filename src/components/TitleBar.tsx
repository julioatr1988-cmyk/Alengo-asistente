import { Minus, Square, X, Bus } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export function TitleBar() {
  const { empresa, whatsappStatus } = useAppStore()

  return (
    <div
      className="flex items-center justify-between h-10 bg-primary text-white select-none px-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <Bus size={16} className="text-secondary" />
        <span className="text-sm font-semibold">{empresa?.nombre ?? 'Alengo Asistente'}</span>
        <span className="text-xs text-white/50 ml-3">
          {format(new Date(), "EEEE, d 'de' MMMM yyyy", { locale: es })}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full ${whatsappStatus.connected ? 'bg-secondary' : 'bg-red-400'}`} />
          <span className="text-white/70">
            {whatsappStatus.connected ? `WhatsApp ${whatsappStatus.phone ?? ''}` : 'WhatsApp desconectado'}
          </span>
        </div>

        <div
          className="flex items-center"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => window.electronAPI?.window.minimize()}
            className="p-1.5 hover:bg-white/10 rounded transition-colors"
            title="Minimizar"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => window.electronAPI?.window.maximize()}
            className="p-1.5 hover:bg-white/10 rounded transition-colors"
            title="Maximizar"
          >
            <Square size={12} />
          </button>
          <button
            onClick={() => window.electronAPI?.window.close()}
            className="p-1.5 hover:bg-red-500 rounded transition-colors"
            title="Cerrar"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { KeyRound, AlertCircle, CheckCircle, Loader2, ShieldCheck } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { Licencia } from '../types'

interface Props {
  motivo: 'none' | 'expired' | 'revoked' | 'offline' | 'pc_mismatch'
}

const MOTIVO_MSGS: Record<string, { titulo: string; texto: string; color: string }> = {
  expired: {
    titulo: 'Tu licencia ha vencido',
    texto:  'El período de uso ha finalizado. Ingresa una nueva clave para renovar el acceso.',
    color:  'bg-red-50 border-red-200 text-red-800',
  },
  revoked: {
    titulo: 'Licencia desactivada',
    texto:  'Tu licencia fue desactivada. Contacta a Alengo para más información.',
    color:  'bg-red-50 border-red-200 text-red-800',
  },
  pc_mismatch: {
    titulo: 'Licencia registrada en otro equipo',
    texto:  'Esta licencia ya está activada en otro computador. Contacta a Alengo para transferirla a este equipo.',
    color:  'bg-amber-50 border-amber-200 text-amber-800',
  },
  offline: {
    titulo: 'Sin conexión — período de gracia agotado',
    texto:  'No se pudo validar la licencia en los últimos 7 días. Conecta a internet e intenta de nuevo.',
    color:  'bg-amber-50 border-amber-200 text-amber-800',
  },
  none: { titulo: '', texto: '', color: '' },
}

function formatKey(raw: string): string {
  const clean = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 18)
  const prefix = 'ALENGO'
  const variable = clean.startsWith(prefix) ? clean.slice(6) : clean

  let result = prefix
  for (let i = 0; i < variable.length; i++) {
    if (i === 0 || i === 4 || i === 8) result += '-'
    result += variable[i]
  }
  return result
}

export function Activacion({ motivo }: Props) {
  const { setLicencia, setLicenciaStatus, loadInitialData } = useAppStore()
  const [clave, setClave]   = useState('ALENGO-')
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    setClave(formatKey(e.target.value))
  }

  const handleActivar = async () => {
    const keyLimpia = clave.trim()
    if (!/^ALENGO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(keyLimpia)) {
      setError('Formato inválido. La clave debe ser ALENGO-XXXX-XXXX-XXXX')
      return
    }

    setLoading(true)
    setError(null)

    const result = await window.electronAPI.licencia.activar(keyLimpia)

    if (!result.success) {
      setError(result.error ?? 'Error desconocido al activar la licencia.')
      setLoading(false)
      return
    }

    setSuccess(true)
    const lic = await window.electronAPI.licencia.get()
    setLicencia(lic as Licencia)

    await loadInitialData()

    setTimeout(() => {
      const dias = lic
        ? Math.floor((new Date(lic.fecha_vencimiento as string).getTime() - Date.now()) / 86_400_000)
        : null
      setLicenciaStatus('valid', dias)
    }, 1200)
  }

  const motivoInfo = MOTIVO_MSGS[motivo]

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0F1E3C] via-[#1a3060] to-[#0F1E3C] flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo / Marca */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
            <ShieldCheck size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Alengo Asistente</h1>
          <p className="text-blue-200 text-sm mt-1">Sistema de gestión para call centers</p>
        </div>

        {/* Card principal */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* Pantalla de éxito */}
          {success ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={32} className="text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">¡Licencia activada!</h2>
              <p className="text-gray-500 text-sm">Ingresando al sistema...</p>
            </div>

          ) : (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
                  <KeyRound size={20} className="text-[#0F1E3C]" />
                </div>
                <div>
                  <h2 className="font-bold text-gray-900">
                    {motivo === 'none' ? 'Activar licencia' : 'Renovar licencia'}
                  </h2>
                  <p className="text-xs text-gray-400">
                    {motivo === 'none' ? 'Ingresa tu clave para comenzar' : 'Ingresa tu nueva clave de licencia'}
                  </p>
                </div>
              </div>

              {/* Aviso según motivo */}
              {motivo !== 'none' && (
                <div className={`rounded-xl border p-4 mb-5 ${motivoInfo.color}`}>
                  <p className="font-semibold text-sm mb-0.5">{motivoInfo.titulo}</p>
                  <p className="text-xs opacity-80">{motivoInfo.texto}</p>
                </div>
              )}

              {/* Campo de clave */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Clave de licencia
                </label>
                <input
                  type="text"
                  value={clave}
                  onChange={handleInput}
                  onKeyDown={e => e.key === 'Enter' && handleActivar()}
                  placeholder="ALENGO-XXXX-XXXX-XXXX"
                  maxLength={22}
                  spellCheck={false}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center font-mono text-lg tracking-widest text-gray-900 focus:outline-none focus:border-[#0F1E3C] transition-colors placeholder:text-gray-300 placeholder:tracking-wider uppercase"
                />
                <p className="text-xs text-gray-400 mt-1.5 text-center">
                  Formato: ALENGO-XXXX-XXXX-XXXX
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 rounded-xl border border-red-200 mb-4">
                  <AlertCircle size={15} className="text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-700">{error}</p>
                </div>
              )}

              {/* Botón activar */}
              <button
                onClick={handleActivar}
                disabled={loading}
                className="w-full py-3 bg-[#0F1E3C] text-white rounded-xl font-semibold text-sm hover:bg-[#1a3060] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading
                  ? <><Loader2 size={16} className="animate-spin" /> Verificando...</>
                  : <><KeyRound size={16} /> Activar licencia</>
                }
              </button>
            </>
          )}
        </div>

        {/* Contacto */}
        {!success && (
          <p className="text-center text-blue-200/70 text-xs mt-4">
            ¿No tienes una licencia?{' '}
            <button
              className="text-blue-200 underline hover:text-white transition-colors"
              onClick={() => window.electronAPI.shell.openExternal('https://alengoapp.com')}
            >
              Contáctanos en alengoapp.com
            </button>
          </p>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { Plus, Send, TrendingUp, MessageSquare, AlertTriangle, Calendar, ShieldAlert, Copy, Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAppStore } from '../store/useAppStore'
import { NuevoViajeModal } from '../components/NuevoViajeModal'
import type { Chofer, Viaje, ViajeGrupo } from '../types'

const ESTADO_COLORS: Record<string, string> = {
  pendiente:  'bg-gray-100 text-gray-700',
  confirmado: 'bg-green-100 text-green-700',
  en_curso:   'bg-blue-100 text-blue-700',
  completado: 'bg-secondary/10 text-secondary-700',
  cancelado:  'bg-red-100 text-red-700',
}

const TIPO_LABELS: Record<string, string> = {
  pasajero:  'PSJ',
  encomienda:'ENC',
  express:   'EXP',
  flete:     'FLT',
}

// Las 4 columnas de destino principales (partida desde Santo Domingo)
const DESTINOS = [
  { label: 'QUITO',     codigo: 'STO-UIO', ciudad: 'QUITO'         },
  { label: 'SANTO',     codigo: 'UIO-STO', ciudad: 'SANTO DOMINGO' },
  { label: 'MANTA',     codigo: 'STO-MTA', ciudad: 'MANTA'         },
  { label: 'GUAYAQUIL', codigo: 'STO-GYE', ciudad: 'GUAYAQUIL'     },
] as const

export function Dashboard() {
  const { rutas, viajesHoy, setChoferes, empresa, refreshViajesHoy, licenciaDiasRestantes } = useAppStore()
  const [showModal, setShowModal]           = useState(false)
  const [turnosPorDestino, setTurnosPorDestino] = useState<Record<string, Chofer[]>>({})
  const [publishingTurnos, setPublishingTurnos] = useState(false)
  const [publishToast, setPublishToast]     = useState<'success' | 'error' | null>(null)
  const [previewTurnos, setPreviewTurnos]   = useState<string | null>(null)
  const [previewEdited, setPreviewEdited]   = useState('')
  const [viajeGrupos, setViajeGrupos]       = useState<ViajeGrupo[]>([])

  const loadTurnos = useCallback(async () => {
    if (!window.electronAPI || rutas.length === 0) return
    const result: Record<string, Chofer[]> = {}
    await Promise.all(
      DESTINOS.map(async ({ label, codigo }) => {
        const ruta = rutas.find(r => r.codigo === codigo)
        if (!ruta) return
        const ch = await window.electronAPI.turnos.porRuta(ruta.id)
        result[label] = ch as Chofer[]
      })
    )
    setTurnosPorDestino(result)
  }, [rutas])

  const loadGrupos = useCallback(async () => {
    if (!window.electronAPI) return
    const hoy = format(new Date(), 'yyyy-MM-dd')
    const gs  = await window.electronAPI.viajeGrupos.get(hoy)
    setViajeGrupos(gs as ViajeGrupo[])
  }, [])

  useEffect(() => { loadTurnos() }, [loadTurnos])
  useEffect(() => { loadGrupos() }, [loadGrupos])

  // Auto-refresh every minute
  useEffect(() => {
    const interval = setInterval(async () => {
      const ch = await window.electronAPI.choferes.get()
      setChoferes(ch as Chofer[])
      await refreshViajesHoy()
      await loadTurnos()
      await loadGrupos()
    }, 60_000)
    return () => clearInterval(interval)
  }, [setChoferes, refreshViajesHoy, loadTurnos, loadGrupos])

  // Listen for background updates
  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.viajesEvents.onUpdated(() => {
      void refreshViajesHoy()
      void loadGrupos()
    })
    return () => window.electronAPI.viajesEvents.removeListeners()
  }, [refreshViajesHoy, loadGrupos])


  const viajesHoyByChofer = (choferId: number) =>
    viajesHoy.filter(v => v.chofer_id === choferId && v.estado !== 'cancelado')

  const totalHoy    = viajesHoy.filter(v => v.estado !== 'cancelado').reduce((s, v) => s + (v.monto ?? 0), 0)
  const viajesActivos = viajesHoy.filter(v => v.estado !== 'cancelado').length

  const buildTurnosMsg = () => {
    return DESTINOS.map(({ label, codigo }) => {
      const ch     = turnosPorDestino[label] ?? []
      const rutaId = rutas.find(r => r.codigo === codigo)?.id
      const lineas = ch.flatMap(c => {
        const grupos = viajeGrupos.filter(g =>
          g.chofer_id === c.id && g.estado !== 'cancelado' && g.ruta_id === rutaId
        )
        if (grupos.length === 0) return []
        const detalles = grupos.map(g => {
          const enc = g.cant_encomiendas ?? 0
          return `${g.hora} ${g.cupo_ocupado}psj${enc > 0 ? ' ' + enc + 'enc' : ''}`
        }).join(', ')
        return [`(${c.digito_placa}) ${c.nombre}${detalles ? ` (${detalles})` : ''}`]
      })
      return `Turno  ${label}\n${lineas.join('\n') || 'Sin choferes'}`
    }).join('\n\n')
  }

  const handlePublicarTurnos = async () => {
    const whatsappStatus = await window.electronAPI.whatsapp.getStatus()
    if (!whatsappStatus?.connected) {
      setPublishToast('error')
      setTimeout(() => setPublishToast(null), 3000)
      return
    }
    if (!empresa?.grupo_operativo_id) {
      alert('Configure el ID del grupo operativo de WhatsApp en Configuración')
      return
    }
    const msg = buildTurnosMsg()
    setPreviewTurnos(msg)
    setPreviewEdited(msg)
  }

  const handleConfirmarPublicar = async () => {
    if (!empresa?.grupo_operativo_id || previewTurnos === null) return
    setPublishingTurnos(true)
    try {
      await window.electronAPI.whatsapp.sendMessage(empresa.grupo_operativo_id, previewEdited)
      if (previewEdited !== previewTurnos) {
        const hoy = format(new Date(), 'yyyy-MM-dd')
        await window.electronAPI.edicionTurnos.save(hoy, previewTurnos, previewEdited)
      }
      setPreviewTurnos(null)
      setPublishToast('success')
    } catch {
      setPublishToast('error')
    } finally {
      setPublishingTurnos(false)
      setTimeout(() => setPublishToast(null), 3000)
    }
  }

  const licWarning = licenciaDiasRestantes !== null && licenciaDiasRestantes <= 30
  const licUrgent  = licenciaDiasRestantes !== null && licenciaDiasRestantes <= 7

  return (
    <div className="h-full flex flex-col">
      {/* Toast */}
      {publishToast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
          publishToast === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {publishToast === 'success' ? '✓ Turnos publicados en el grupo' : '✗ Error al publicar. Verifica la conexión de WhatsApp'}
        </div>
      )}
      {/* Alerta vencimiento de licencia */}
      {licWarning && (
        <div className={`flex items-center gap-3 px-5 py-2.5 text-sm ${
          licUrgent
            ? 'bg-red-600 text-white'
            : 'bg-amber-50 border-b border-amber-200 text-amber-900'
        }`}>
          <ShieldAlert size={16} className="flex-shrink-0" />
          <span>
            Tu licencia vence en <strong>{licenciaDiasRestantes} día{licenciaDiasRestantes === 1 ? '' : 's'}</strong>.
            {' '}Renueva para evitar la interrupción del servicio.
          </span>
          <button
            className={`ml-auto text-xs font-semibold underline hover:no-underline ${licUrgent ? 'text-white' : 'text-amber-700'}`}
            onClick={() => window.electronAPI.shell.openExternal('https://alengoapp.com')}
          >
            Renovar ahora →
          </button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 p-5 pb-0">
        {[
          { icon: Calendar,      label: 'Viajes hoy',         value: viajesActivos,          color: 'text-blue-600',   bg: 'bg-blue-50' },
          { icon: TrendingUp,    label: 'Ingresos del día',   value: `$${totalHoy.toFixed(2)}`, color: 'text-secondary', bg: 'bg-secondary/10' },
          { icon: MessageSquare, label: 'Mensajes no leídos', value: 0,                       color: 'text-purple-600', bg: 'bg-purple-50' },
          { icon: AlertTriangle, label: 'Cobros vencidos',    value: 0,                       color: 'text-red-600',    bg: 'bg-red-50' },
        ].map(({ icon: Icon, label, value, color, bg }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon size={20} className={color} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-xl font-bold text-gray-900">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-5 gap-5 p-5 min-h-0">
        {/* Turnos panel */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h2 className="font-semibold text-gray-900">Turnos de hoy</h2>
            <button
              onClick={handlePublicarTurnos}
              disabled={publishingTurnos}
              className="flex items-center gap-1.5 text-xs bg-secondary text-white px-3 py-1.5 rounded-lg hover:bg-secondary-600 transition-colors"
            >
              <Send size={13} />
              {publishingTurnos ? 'Publicando...' : 'Publicar en grupo'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-3">
              {DESTINOS.map(({ label, codigo }) => (
                <TurnoColumna
                  key={label}
                  titulo={label}
                  choferes={turnosPorDestino[label] ?? []}
                  grupos={viajeGrupos}
                  rutaId={rutas.find(r => r.codigo === codigo)?.id}
                />
              ))}
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-400 font-medium mb-2">Vista previa mensaje</p>
              <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap">{buildTurnosMsg()}</pre>
            </div>
          </div>
        </div>

        {/* Viajes panel */}
        <div className="col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <div>
              <h2 className="font-semibold text-gray-900">Viajes de hoy</h2>
              <p className="text-xs text-gray-400">{format(new Date(), "EEEE d 'de' MMMM", { locale: es })}</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 bg-primary text-white text-sm px-4 py-2 rounded-lg hover:bg-primary-600 transition-colors"
            >
              <Plus size={16} />
              Nuevo Viaje
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {viajeGrupos.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
                <Calendar size={40} className="opacity-30" />
                <p>No hay viajes registrados hoy</p>
                <button onClick={() => setShowModal(true)} className="text-sm text-secondary hover:underline">
                  + Registrar primer viaje
                </button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    {['','Hora','Chofer','Ruta','Cupo','Total $','Estado',''].map((h,i) => (
                      <th key={i} className="text-left p-3 text-xs text-gray-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viajeGrupos.map(g => (
                    <GrupoRow key={g.id} grupo={g} onRefresh={() => { void refreshViajesHoy(); void loadGrupos() }} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <NuevoViajeModal
          onClose={() => setShowModal(false)}
          onCreated={() => { void loadTurnos(); void loadGrupos() }}
        />
      )}

      {/* Modal vista previa de turnos editable */}
      {previewTurnos !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-gray-900">Vista previa — Publicar turnos</h3>
              <button onClick={() => setPreviewTurnos(null)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <p className="text-xs text-gray-500 mb-2">Revisa y edita el mensaje antes de publicarlo en el grupo de WhatsApp:</p>
              <textarea
                value={previewEdited}
                onChange={e => setPreviewEdited(e.target.value)}
                rows={14}
                className="w-full font-mono text-xs border border-gray-200 rounded-lg p-3 focus:outline-none focus:border-primary resize-none"
              />
              {previewEdited !== previewTurnos && (
                <p className="text-xs text-amber-600 mt-1">⚠ Mensaje modificado — se registrará la edición</p>
              )}
            </div>
            <div className="p-4 border-t flex justify-end gap-3">
              <button onClick={() => setPreviewTurnos(null)} className="btn-ghost">Cancelar</button>
              <button
                onClick={handleConfirmarPublicar}
                disabled={publishingTurnos || !previewEdited.trim()}
                className="btn-primary flex items-center gap-2"
              >
                <Send size={14} />
                {publishingTurnos ? 'Publicando...' : 'Confirmar y Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TurnoColumna({ titulo, choferes, grupos, rutaId }: { titulo: string; choferes: Chofer[]; grupos: ViajeGrupo[]; rutaId?: number }) {
  return (
    <div>
      <p className="text-xs font-bold text-primary uppercase tracking-wider mb-2">{titulo}</p>
      <div className="space-y-1">
        {choferes.map((c, i) => {
          const misGrupos = grupos.filter(g =>
            g.chofer_id === c.id && g.estado !== 'cancelado' && (rutaId == null || g.ruta_id === rutaId)
          )
          return (
            <div key={c.id} className="flex items-start gap-2 text-sm py-0.5">
              <span className="text-gray-400 text-xs w-4 mt-0.5">{i + 1}.</span>
              <div>
                <span className="font-medium text-gray-700 text-xs">({c.digito_placa}) {c.nombre}</span>
                {misGrupos.map(g => {
                  const enc = g.cant_encomiendas ?? 0
                  return (
                    <div key={g.id} className="text-xs text-secondary">
                      {g.hora} — {g.cupo_ocupado}/{g.cupo_maximo} pax{enc > 0 ? ` · ${enc} enc` : ''}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {choferes.length === 0 && <p className="text-xs text-gray-400 italic">Sin choferes</p>}
      </div>
    </div>
  )
}

function GrupoRow({ grupo, onRefresh }: { grupo: ViajeGrupo; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [viajes,   setViajes]   = useState<Viaje[]>([])
  const [loading,  setLoading]  = useState(false)
  const [copied,   setCopied]   = useState(false)
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)

  const loadViajes = async () => {
    setLoading(true)
    const vs = await window.electronAPI.viajeGrupos.getViajes(grupo.id)
    setViajes(vs as Viaje[])
    setLoading(false)
  }

  const handleToggle = async () => {
    if (!expanded && viajes.length === 0) await loadViajes()
    setExpanded(e => !e)
  }

  const handleEstado = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await window.electronAPI.viajeGrupos.updateEstado(grupo.id, e.target.value)
    onRefresh()
  }

  const handleCopiar = async () => {
    const vs = viajes.length > 0 ? viajes : await window.electronAPI.viajeGrupos.getViajes(grupo.id) as Viaje[]
    if (vs.length > 0 && viajes.length === 0) setViajes(vs)
    const header = `📋 Viaje ${grupo.hora} | ${grupo.ruta_codigo ?? ''} | Chofer: ${grupo.chofer_nombre ? `${grupo.chofer_nombre} (placa ${grupo.digito_placa})` : 'Sin asignar'}`
    const items = vs.map((v, i) => [
      `${i + 1}. ${v.tipo === 'encomienda' ? '📦 ENCOMIENDA' : '👤 PASAJERO'}: ${v.cliente_nombre || '?'}`,
      `   Tel: ${v.cliente_telefono || '—'}`,
      `   Recogida: ${v.origen || '—'}`,
      `   Destino: ${v.destino || '—'}`,
      `   Turno: ${grupo.hora}`,
      `   Valor: $${Number(v.monto ?? 0).toFixed(2)}`,
      `   Factura: ${v.requiere_factura ? 'Sí' : 'No'}`,
    ].join('\n'))
    const footer = `─────────────────\nTotal: ${grupo.cupo_ocupado}/${grupo.cupo_maximo} pax — $${Number(grupo.total_monto ?? 0).toFixed(2)}`
    navigator.clipboard.writeText([header, '', ...items, '', footer].join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleEnviarWA = async () => {
    if (!grupo.chofer_grupo_wa_id) return
    setSending(true)
    const vs = viajes.length > 0 ? viajes : await window.electronAPI.viajeGrupos.getViajes(grupo.id) as Viaje[]
    if (vs.length > 0 && viajes.length === 0) setViajes(vs)
    const lineas = vs.map(v =>
      `👤 ${v.cliente_nombre || '?'} ${v.cliente_telefono || ''} — desde ${v.origen || '?'} — $${Number(v.monto ?? 0).toFixed(2)}`
    )
    const total = vs.reduce((s, v) => s + Number(v.monto ?? 0), 0)
    const texto = [
      `🔔 *Viaje ${grupo.hora} → ${vs[0]?.destino || grupo.ruta_codigo}*`,
      ...lineas,
      `Total: ${grupo.cupo_ocupado}/${grupo.cupo_maximo} pax — $${total.toFixed(2)}`,
    ].join('\n')
    const result = await window.electronAPI.whatsapp.sendMessage(grupo.chofer_grupo_wa_id, texto)
    if (result.success) { setSent(true); setTimeout(() => setSent(false), 3000) }
    setSending(false)
  }

  const cupoColor = grupo.cupo_ocupado >= grupo.cupo_maximo ? 'text-red-600 font-bold' : 'text-green-700'

  return (
    <>
      <tr className="border-b hover:bg-gray-50 transition-colors cursor-pointer" onClick={handleToggle}>
        <td className="p-3 text-gray-400">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="p-3 font-mono text-gray-700 font-semibold">{grupo.hora}</td>
        <td className="p-3 text-gray-700 text-sm">
          {grupo.chofer_nombre
            ? `(${grupo.digito_placa}) ${grupo.chofer_nombre}`
            : <span className="text-gray-300">Sin asignar</span>}
        </td>
        <td className="p-3">
          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-mono">{grupo.ruta_codigo}</span>
        </td>
        <td className="p-3">
          <span className={`text-sm font-semibold ${cupoColor}`}>{grupo.cupo_ocupado}/{grupo.cupo_maximo}</span>
          <span className="text-xs text-gray-400 ml-1">pax</span>
          {(grupo.cant_encomiendas ?? 0) > 0 && (
            <span className="text-xs text-gray-500 ml-1">· {grupo.cant_encomiendas} enc</span>
          )}
        </td>
        <td className="p-3 font-semibold text-gray-800">${Number(grupo.total_monto ?? 0).toFixed(2)}</td>
        <td className="p-3" onClick={e => e.stopPropagation()}>
          <select
            value={grupo.estado}
            onChange={handleEstado}
            className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer ${ESTADO_COLORS[grupo.estado] ?? 'bg-gray-100 text-gray-700'}`}
          >
            {['abierto','lleno','en_curso','completado','cancelado'].map(e => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </td>
        <td className="p-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopiar}
              title="Copiar pasajeros"
              className={`p-1.5 rounded-lg transition-colors ${copied ? 'bg-green-100 text-green-600' : 'hover:bg-gray-100 text-gray-400 hover:text-gray-600'}`}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
            {grupo.chofer_grupo_wa_id && (
              <button
                onClick={handleEnviarWA}
                disabled={sending}
                title={sent ? '✓ Enviado' : 'Enviar al grupo WA del chofer'}
                className={`p-1.5 rounded-lg transition-colors ${sent ? 'bg-green-100 text-green-600' : 'hover:bg-blue-50 text-gray-400 hover:text-blue-600'}`}
              >
                {sent ? <Check size={13} /> : <Send size={13} />}
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="px-6 pb-3 bg-gray-50">
            {loading ? (
              <p className="text-xs text-gray-400 py-2">Cargando...</p>
            ) : viajes.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">Sin pasajeros registrados</p>
            ) : (
              <table className="w-full text-xs mt-1">
                <thead>
                  <tr className="text-gray-400 border-b">
                    <th className="text-left py-1 pr-3 font-medium">Cliente</th>
                    <th className="text-left py-1 pr-3 font-medium">Tipo</th>
                    <th className="text-left py-1 pr-3 font-medium">Origen → Destino</th>
                    <th className="text-left py-1 pr-3 font-medium">Monto</th>
                    <th className="text-left py-1 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {viajes.map(v => (
                    <tr key={v.id} className="border-b border-gray-100">
                      <td className="py-1.5 pr-3">
                        <p className="font-medium text-gray-800">{v.cliente_nombre || '—'}</p>
                        <p className="text-gray-400">{v.cliente_telefono}</p>
                      </td>
                      <td className="py-1.5 pr-3">
                        <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{TIPO_LABELS[v.tipo] ?? v.tipo}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-gray-600">{v.origen || '—'} → {v.destino || '—'}</td>
                      <td className="py-1.5 pr-3 font-semibold text-gray-800">${Number(v.monto ?? 0).toFixed(2)}</td>
                      <td className="py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${ESTADO_COLORS[v.estado] ?? ''}`}>{v.estado}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

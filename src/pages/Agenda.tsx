import { useState, useEffect, useCallback } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isSameMonth, addMonths, subMonths, getDay, isToday as dateFnsIsToday,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ChevronLeft, ChevronRight, Plus, Clock, User,
  Edit2, Trash2, MapPin, CalendarDays,
} from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { NuevoViajeModal } from '../components/NuevoViajeModal'
import type { Viaje, EstadoViaje } from '../types'

const ESTADO_COLOR: Record<EstadoViaje, string> = {
  pendiente:  'bg-gray-100 text-gray-700',
  confirmado: 'bg-green-100 text-green-700',
  en_curso:   'bg-blue-100 text-blue-700',
  completado: 'bg-secondary/10 text-secondary-800',
  cancelado:  'bg-red-100 text-red-600',
}
const ESTADO_DOT: Record<EstadoViaje, string> = {
  pendiente:  'bg-gray-400',
  confirmado: 'bg-secondary',
  en_curso:   'bg-blue-500',
  completado: 'bg-secondary-600',
  cancelado:  'bg-red-400',
}
const TIPO_LABEL: Record<string, string> = {
  pasajero: 'PSJ', encomienda: 'ENC', express: 'EXP', flete: 'FLT',
}

export function Agenda() {
  const { rutas, choferes } = useAppStore()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(new Date())
  const [viajes, setViajes] = useState<Viaje[]>([])
  const [viajesDelDia, setViajesDelDia] = useState<Viaje[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editViaje, setEditViaje] = useState<Viaje | null>(null)
  const [filterRuta, setFilterRuta] = useState('')
  const [filterChofer, setFilterChofer] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const loadViajes = useCallback(async () => {
    const result = await window.electronAPI.viajes.get()
    setViajes(result as Viaje[])
  }, [])

  useEffect(() => { loadViajes() }, [loadViajes])

  useEffect(() => {
    const dateStr = format(selectedDay, 'yyyy-MM-dd')
    let filtered = viajes.filter(v => v.fecha === dateStr)
    if (filterRuta)   filtered = filtered.filter(v => v.ruta_id   === Number(filterRuta))
    if (filterChofer) filtered = filtered.filter(v => v.chofer_id === Number(filterChofer))
    if (filterTipo)   filtered = filtered.filter(v => v.tipo      === filterTipo)
    setViajesDelDia(filtered.sort((a, b) => a.hora.localeCompare(b.hora)))
  }, [selectedDay, viajes, filterRuta, filterChofer, filterTipo])

  const days         = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) })
  const firstDayPad  = (getDay(startOfMonth(currentMonth)) + 6) % 7
  const viajesEnDia  = (day: Date) => viajes.filter(v => v.fecha === format(day, 'yyyy-MM-dd'))

  const handleDelete = async (v: Viaje) => {
    if (!confirm(`¿Eliminar el viaje de ${v.cliente_nombre || 'este cliente'}?`)) return
    setDeletingId(v.id)
    await window.electronAPI.viajes.delete(v.id)
    await loadViajes()
    setDeletingId(null)
  }

  const handleEstadoChange = async (v: Viaje, estado: EstadoViaje) => {
    await window.electronAPI.viajes.update({ ...v, estado })
    await loadViajes()
  }

  const irAHoy = () => {
    const hoy = new Date()
    setCurrentMonth(hoy)
    setSelectedDay(hoy)
  }

  const totalDia   = viajesDelDia.filter(v => v.estado !== 'cancelado').reduce((s, v) => s + (v.monto ?? 0), 0)
  const activosDia = viajesDelDia.filter(v => v.estado !== 'cancelado').length

  return (
    <div className="h-full flex flex-col">
      {/* Filtros */}
      <div className="flex items-center gap-2 px-5 pt-4 pb-0 flex-wrap">
        <select className="input w-40 text-sm" value={filterRuta} onChange={e => setFilterRuta(e.target.value)}>
          <option value="">Todas las rutas</option>
          {rutas.map(r => <option key={r.id} value={r.id}>{r.codigo}</option>)}
        </select>
        <select className="input w-44 text-sm" value={filterChofer} onChange={e => setFilterChofer(e.target.value)}>
          <option value="">Todos los choferes</option>
          {choferes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select className="input w-36 text-sm" value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          <option value="pasajero">Pasajero</option>
          <option value="encomienda">Encomienda</option>
          <option value="express">Express</option>
          <option value="flete">Flete</option>
        </select>
        <div className="flex-1" />
        <button
          onClick={irAHoy}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors"
        >
          Hoy
        </button>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nuevo Viaje
        </button>
      </div>

      <div className="flex-1 grid grid-cols-5 gap-4 p-5 min-h-0">
        {/* Calendario */}
        <div className="col-span-3 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
          {/* Nav mes */}
          <div className="flex items-center justify-between px-5 py-3 border-b bg-gray-50/50">
            <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors">
              <ChevronLeft size={17} />
            </button>
            <h2 className="font-semibold text-gray-900 capitalize text-sm">
              {format(currentMonth, 'MMMM yyyy', { locale: es })}
            </h2>
            <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors">
              <ChevronRight size={17} />
            </button>
          </div>

          {/* Grid días */}
          <div className="flex-1 p-4 flex flex-col">
            <div className="grid grid-cols-7 mb-1">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
                <div key={d} className="text-center text-xs font-semibold text-gray-400 py-2">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 flex-1">
              {Array.from({ length: firstDayPad }).map((_, i) => <div key={`e${i}`} />)}
              {days.map(day => {
                const vDia     = viajesEnDia(day)
                const activos  = vDia.filter(v => v.estado !== 'cancelado')
                const isSelected = isSameDay(day, selectedDay)
                const isHoy      = dateFnsIsToday(day)
                const isOther    = !isSameMonth(day, currentMonth)
                return (
                  <button
                    key={day.toISOString()}
                    onClick={() => setSelectedDay(day)}
                    className={`relative rounded-xl text-sm transition-all flex flex-col items-center justify-start pt-1.5 pb-1 min-h-[56px] ${
                      isSelected
                        ? 'bg-primary text-white shadow-md shadow-primary/20'
                        : isHoy
                          ? 'bg-secondary/10 text-secondary ring-1 ring-secondary/30'
                          : isOther
                            ? 'text-gray-300 hover:bg-gray-50'
                            : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <span className={`text-sm font-semibold ${isSelected ? 'text-white' : isHoy ? 'text-secondary' : ''}`}>
                      {format(day, 'd')}
                    </span>
                    {activos.length > 0 && (
                      <div className="flex gap-0.5 mt-1 flex-wrap justify-center px-1">
                        {activos.slice(0, 4).map(v => (
                          <span
                            key={v.id}
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSelected ? 'bg-white/80' : ESTADO_DOT[v.estado] ?? 'bg-gray-400'}`}
                          />
                        ))}
                        {activos.length > 4 && (
                          <span className={`text-[9px] leading-none font-bold ${isSelected ? 'text-white/70' : 'text-gray-400'}`}>
                            +{activos.length - 4}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Leyenda */}
          <div className="px-5 py-3 border-t flex items-center gap-4 text-xs text-gray-400">
            {Object.entries(ESTADO_DOT).map(([k, cls]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${cls}`} />
                {k}
              </span>
            ))}
          </div>
        </div>

        {/* Panel del día */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
          {/* Header día */}
          <div className="px-4 py-3 border-b bg-gray-50/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 capitalize text-sm">
                  {format(selectedDay, "EEEE d 'de' MMMM", { locale: es })}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {activosDia} viaje{activosDia !== 1 ? 's' : ''} · ${totalDia.toFixed(2)} total
                </p>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="p-1.5 bg-primary text-white rounded-lg hover:bg-primary-600 transition-colors"
                title="Nuevo viaje en este día"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>

          {/* Lista viajes del día */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {viajesDelDia.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-300 gap-2">
                <CalendarDays size={32} />
                <p className="text-sm">Sin viajes este día</p>
                <button onClick={() => setShowModal(true)} className="text-xs text-secondary hover:underline">
                  + Registrar viaje
                </button>
              </div>
            ) : (
              viajesDelDia.map(v => (
                <ViajeCard
                  key={v.id}
                  viaje={v}
                  deleting={deletingId === v.id}
                  onDelete={() => handleDelete(v)}
                  onEdit={() => { /* future: open edit modal */ }}
                  onEstado={(estado) => handleEstadoChange(v, estado)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {showModal && (
        <NuevoViajeModal
          fechaDefault={format(selectedDay, 'yyyy-MM-dd')}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); loadViajes() }}
        />
      )}
    </div>
  )
}

function ViajeCard({ viaje: v, deleting, onDelete, onEstado }: {
  viaje: Viaje
  deleting: boolean
  onDelete: () => void
  onEdit: () => void
  onEstado: (e: EstadoViaje) => void
}) {
  return (
    <div className={`border rounded-xl p-3 transition-all ${deleting ? 'opacity-40' : 'hover:border-primary/20 hover:shadow-sm'}`}>
      {/* Primera línea */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-primary">{v.hora}</span>
          <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-mono">{v.ruta_codigo}</span>
          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{TIPO_LABEL[v.tipo] ?? v.tipo}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onDelete} disabled={deleting} className="p-1 hover:bg-red-50 text-gray-300 hover:text-red-400 rounded transition-colors">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Cliente */}
      <p className="font-semibold text-sm text-gray-900 truncate">{v.cliente_nombre || '—'}</p>
      {v.cliente_telefono && <p className="text-xs text-gray-400">{v.cliente_telefono}</p>}

      {/* Origen / Destino */}
      {(v.origen || v.destino) && (
        <div className="flex items-start gap-1 mt-1.5 text-xs text-gray-500">
          <MapPin size={11} className="mt-0.5 flex-shrink-0" />
          <span className="truncate">{[v.origen, v.destino].filter(Boolean).join(' → ')}</span>
        </div>
      )}

      {/* Chofer + monto + estado */}
      <div className="flex items-center gap-2 mt-2">
        <div className="flex items-center gap-1 text-xs text-gray-500 flex-1 min-w-0">
          <User size={11} />
          <span className="truncate">
            {v.chofer_nombre ? `(${v.digito_placa}) ${v.chofer_nombre}` : 'Sin chofer'}
          </span>
        </div>
        <span className="text-sm font-bold text-gray-800">${v.monto?.toFixed(2)}</span>
        <select
          value={v.estado}
          onChange={e => onEstado(e.target.value as EstadoViaje)}
          className={`text-xs px-2 py-0.5 rounded-full font-medium border-0 outline-none cursor-pointer ${ESTADO_COLOR[v.estado]}`}
          onClick={e => e.stopPropagation()}
        >
          {(['pendiente','confirmado','en_curso','completado','cancelado'] as EstadoViaje[]).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {v.observaciones && (
        <p className="text-xs text-gray-400 mt-1.5 italic border-t pt-1.5">{v.observaciones}</p>
      )}
    </div>
  )
}

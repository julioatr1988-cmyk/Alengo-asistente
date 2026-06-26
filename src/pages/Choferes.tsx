import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Edit2, CheckCircle, XCircle, AlertTriangle,
  GripVertical, Save, X, Phone, Car, Wallet, BarChart3,
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAppStore } from '../store/useAppStore'
import type { Chofer, WhatsAppGroup } from '../types'

const EMPTY_FORM: Partial<Chofer> = {
  nombre: '', telefono: '', numero_placa: '', digito_placa: 0,
  grupo_wa_id: '', activo: 1, tarifa_mensual: 50, rutas_asignadas: '[]',
  ciudad_actual: 'SANTO DOMINGO',
}

const CIUDADES_OPCIONES = ['SANTO DOMINGO', 'QUITO', 'GUAYAQUIL', 'MANTA']

const RUTAS_OPCIONES: { codigo: string; label: string }[] = [
  { codigo: 'STO-UIO', label: 'Santo Domingo → Quito' },
  { codigo: 'UIO-STO', label: 'Quito → Santo Domingo' },
  { codigo: 'STO-GYE', label: 'Santo Domingo → Guayaquil' },
  { codigo: 'GYE-STO', label: 'Guayaquil → Santo Domingo' },
  { codigo: 'STO-MTA', label: 'Santo Domingo → Manta' },
  { codigo: 'MTA-STO', label: 'Manta → Santo Domingo' },
]

const PICO_PLACA: Record<number, number[]> = {
  1: [1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9, 0],
}

function getPicoPlaca(digito: number) {
  return PICO_PLACA[new Date().getDay()]?.includes(digito) ?? false
}

function getPicoPlacaLabel(digito: number) {
  const day  = new Date().getDay()
  const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  return getPicoPlaca(digito) ? `Hoy ${dias[day]} — pico y placa` : null
}

type Col = 'quito' | 'santo' | 'manta' | 'guayaquil'

const COL_CONFIG: Record<Col, { titulo: string; subtitulo: string; campo: keyof Chofer; codigo: string }> = {
  quito:     { titulo: 'QUITO',     subtitulo: 'STO-UIO', campo: 'orden_turno_quito',     codigo: 'STO-UIO' },
  santo:     { titulo: 'SANTO',     subtitulo: 'UIO-STO', campo: 'orden_turno_santo',     codigo: 'UIO-STO' },
  manta:     { titulo: 'MANTA',     subtitulo: 'STO-MTA', campo: 'orden_turno_manta',     codigo: 'STO-MTA' },
  guayaquil: { titulo: 'GUAYAQUIL', subtitulo: 'STO-GYE', campo: 'orden_turno_guayaquil', codigo: 'STO-GYE' },
}

export function Choferes() {
  const { choferes, setChoferes, rutas } = useAppStore()
  const [selected, setSelected]   = useState<Chofer | null>(null)
  const [showForm, setShowForm]   = useState(false)
  const [form, setForm]           = useState<Partial<Chofer>>(EMPTY_FORM)
  const [saving, setSaving]       = useState(false)
  const [dragging, setDragging]   = useState<{ id: number; col: Col } | null>(null)
  const [dragOver, setDragOver]   = useState<number | null>(null)
  const [statsChofer, setStatsChofer] = useState<{ viajes: number; monto: number } | null>(null)
  const [grupos, setGrupos] = useState<WhatsAppGroup[]>([])

  const [turnosMap, setTurnosMap] = useState<Record<Col, Chofer[]>>({
    quito: [], santo: [], manta: [], guayaquil: [],
  })

  useEffect(() => {
    if (!showForm) return
    window.electronAPI.whatsapp.getGroups().then(gs => setGrupos(gs as WhatsAppGroup[]))
  }, [showForm])

  const loadTurnos = useCallback(async () => {
    if (rutas.length === 0) return
    const result: Record<Col, Chofer[]> = { quito: [], santo: [], manta: [], guayaquil: [] }
    await Promise.all(
      (Object.keys(COL_CONFIG) as Col[]).map(async col => {
        const ruta = rutas.find(r => r.codigo === COL_CONFIG[col].codigo)
        if (!ruta) return
        const data = await window.electronAPI.turnos.porRuta(ruta.id)
        result[col] = data as Chofer[]
      })
    )
    setTurnosMap(result)
  }, [rutas])

  useEffect(() => { loadTurnos() }, [loadTurnos])

  useEffect(() => {
    if (!selected) { setStatsChofer(null); return }
    const hoy   = new Date()
    const desde = format(new Date(hoy.getFullYear(), hoy.getMonth(), 1), 'yyyy-MM-dd')
    const hasta = format(hoy, 'yyyy-MM-dd')
    window.electronAPI.reportes.chofer(selected.id, desde, hasta).then(viajes => {
      const monto = (viajes as Array<{ monto: number }>).reduce((s, v) => s + (v.monto ?? 0), 0)
      setStatsChofer({ viajes: viajes.length, monto })
    })
  }, [selected])

  const handleSave = async () => {
    if (!form.nombre) return
    setSaving(true)
    try {
      if (form.id) {
        const updated = await window.electronAPI.choferes.update(form)
        setChoferes(choferes.map(c => c.id === updated.id ? (updated as Chofer) : c))
        setSelected(updated as Chofer)
      } else {
        const created = await window.electronAPI.choferes.create(form)
        setChoferes([...choferes, created as Chofer])
      }
      setShowForm(false)
      setForm(EMPTY_FORM)
      loadTurnos()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActivo = async (c: Chofer) => {
    const updated = await window.electronAPI.choferes.update({ ...c, activo: c.activo ? 0 : 1 })
    setChoferes(choferes.map(x => x.id === (updated as Chofer).id ? (updated as Chofer) : x))
    if (selected?.id === c.id) setSelected(updated as Chofer)
  }

  const handleEdit = (c: Chofer) => { setForm(c); setShowForm(true) }

  const handleDrop = async (targetId: number, col: Col) => {
    if (!dragging || dragging.id === targetId || dragging.col !== col) return
    const list    = [...turnosMap[col]]
    const fromIdx = list.findIndex(c => c.id === dragging.id)
    const toIdx   = list.findIndex(c => c.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return

    const reordered = [...list]
    const [moved] = reordered.splice(fromIdx, 1)
    reordered.splice(toIdx, 0, moved)

    setTurnosMap(prev => ({ ...prev, [col]: reordered }))

    const campo = COL_CONFIG[col].campo
    for (let i = 0; i < reordered.length; i++) {
      await window.electronAPI.choferes.update({ ...reordered[i], [campo]: i + 1 })
    }
    const updated = await window.electronAPI.choferes.get()
    setChoferes(updated as Chofer[])
    setDragOver(null)
  }

  const restablecerOrden = async (col: Col) => {
    const campo   = COL_CONFIG[col].campo
    const sorted  = [...turnosMap[col]].sort((a, b) => a.id - b.id).map((c, i) => ({ ...c, [campo]: i + 1 }))
    setTurnosMap(prev => ({ ...prev, [col]: sorted }))
    for (const c of sorted) await window.electronAPI.choferes.update(c)
    const updated = await window.electronAPI.choferes.get()
    setChoferes(updated as Chofer[])
  }

  const sf = (k: keyof Chofer, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))
  const mesActual = format(new Date(), "MMMM yyyy", { locale: es })

  return (
    <div className="h-full flex gap-4 p-5 overflow-hidden">
      {/* Lista choferes */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-semibold text-gray-900">
            Choferes <span className="text-gray-400 font-normal text-sm">({choferes.length})</span>
          </h2>
          <button
            onClick={() => { setForm(EMPTY_FORM); setShowForm(true) }}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Plus size={15} /> Agregar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b">
                {['Nombre','Teléfono','Placa','Grupo WA','Tarifa','Estado',''].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {choferes.map(c => {
                const picoPlaca = getPicoPlaca(c.digito_placa)
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelected(s => s?.id === c.id ? null : c)}
                    className={`border-b cursor-pointer transition-colors ${
                      selected?.id === c.id ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-gray-50/80'
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.activo ? 'bg-secondary' : 'bg-gray-300'}`} />
                        <span className="font-medium text-gray-900">{c.nombre}</span>
                        {picoPlaca && (
                          <span title={getPicoPlacaLabel(c.digito_placa) ?? ''}>
                            <AlertTriangle size={13} className="text-amber-500" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">{c.telefono || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{c.numero_placa || '—'}</span>
                      <span className="text-xs text-gray-500 ml-1">*{c.digito_placa}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {c.grupo_wa_id
                        ? <span className="text-xs text-secondary">configurado</span>
                        : <span className="text-xs text-red-400">Sin configurar</span>}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-gray-700">${c.tarifa_mensual}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {c.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleEdit(c)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                          <Edit2 size={13} className="text-gray-400" />
                        </button>
                        <button onClick={() => handleToggleActivo(c)} className="p-1 hover:bg-gray-100 rounded transition-colors">
                          {c.activo
                            ? <XCircle size={13} className="text-red-400" />
                            : <CheckCircle size={13} className="text-green-400" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Panel derecho */}
      <div className="w-72 flex flex-col gap-4 overflow-hidden">
        {/* Detalle del chofer */}
        {selected && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex-shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 text-sm">{selected.nombre}</h3>
              <button onClick={() => setSelected(null)} className="p-0.5 hover:bg-gray-100 rounded">
                <X size={14} className="text-gray-400" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex items-center gap-2"><Phone size={12} className="text-gray-400" />{selected.telefono || '—'}</div>
              <div className="flex items-center gap-2"><Car size={12} className="text-gray-400" />{selected.numero_placa || '—'} <span className="text-gray-400">(*{selected.digito_placa})</span></div>
              <div className="flex items-center gap-2"><Wallet size={12} className="text-gray-400" />${selected.tarifa_mensual}/mes</div>
            </div>
            {statsChofer !== null && (
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-gray-400 mb-2 flex items-center gap-1"><BarChart3 size={11} /> {mesActual}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-primary/5 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-primary">{statsChofer.viajes}</p>
                    <p className="text-xs text-gray-400">viajes</p>
                  </div>
                  <div className="bg-secondary/5 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-secondary">${statsChofer.monto.toFixed(0)}</p>
                    <p className="text-xs text-gray-400">total</p>
                  </div>
                </div>
              </div>
            )}
            {getPicoPlaca(selected.digito_placa) && (
              <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
                <AlertTriangle size={13} className="flex-shrink-0" />
                {getPicoPlacaLabel(selected.digito_placa)}
              </div>
            )}
          </div>
        )}

        {/* Turnos - scroll propio */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col overflow-hidden flex-1">
          <div className="px-4 py-3 border-b bg-gray-50/50 flex-shrink-0">
            <h3 className="font-semibold text-gray-900 text-sm">Orden de Turnos</h3>
            <p className="text-xs text-gray-400">Arrastra para reordenar</p>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {(Object.keys(COL_CONFIG) as Col[]).map(col => (
              <TurnoList
                key={col}
                titulo={COL_CONFIG[col].titulo}
                subtitulo={COL_CONFIG[col].subtitulo}
                col={col}
                items={turnosMap[col]}
                dragging={dragging}
                dragOver={dragOver}
                setDragging={setDragging}
                setDragOver={setDragOver}
                onDrop={handleDrop}
                onRestablecer={() => restablecerOrden(col)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Modal formulario */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-lg text-primary">{form.id ? 'Editar Chofer' : 'Nuevo Chofer'}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Nombre completo *</label>
                <input className="input" value={form.nombre ?? ''} onChange={e => sf('nombre', e.target.value)} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Teléfono</label>
                  <input className="input" value={form.telefono ?? ''} onChange={e => sf('telefono', e.target.value)} placeholder="09XXXXXXXX" />
                </div>
                <div>
                  <label className="label">Número de placa</label>
                  <input
                    className="input uppercase"
                    value={form.numero_placa ?? ''}
                    onChange={e => {
                      const val = e.target.value.toUpperCase()
                      sf('numero_placa', val)
                      const last = parseInt(val.replace(/\D/g, '').slice(-1))
                      if (!isNaN(last)) sf('digito_placa', last)
                    }}
                    placeholder="ABC-1234"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Último dígito placa</label>
                  <input type="number" min="0" max="9" className="input"
                    value={form.digito_placa ?? ''}
                    onChange={e => sf('digito_placa', parseInt(e.target.value))} />
                </div>
                <div>
                  <label className="label">Tarifa mensual $</label>
                  <input type="number" min="0" step="5" className="input"
                    value={form.tarifa_mensual ?? 50}
                    onChange={e => sf('tarifa_mensual', parseFloat(e.target.value))} />
                </div>
              </div>
              <div>
                <label className="label">Grupo WhatsApp</label>
                {grupos.length > 0 ? (
                  <select className="input" value={form.grupo_wa_id ?? ''}
                    onChange={e => sf('grupo_wa_id', e.target.value)}>
                    <option value="">— Seleccionar grupo —</option>
                    {grupos.map(g => <option key={g.jid} value={g.jid}>{g.name}</option>)}
                  </select>
                ) : (
                  <input className="input font-mono text-xs" value={form.grupo_wa_id ?? ''}
                    onChange={e => sf('grupo_wa_id', e.target.value)}
                    placeholder="Conecta WhatsApp para ver grupos disponibles" />
                )}
                <p className="text-xs text-gray-400 mt-1">Grupo donde se publican los turnos del chofer</p>
              </div>
              <div>
                <label className="label">Rutas asignadas</label>
                <div className="grid grid-cols-2 gap-1.5 mt-1">
                  {RUTAS_OPCIONES.map(({ codigo, label }) => {
                    const asignadas: string[] = JSON.parse(form.rutas_asignadas ?? '[]')
                    const checked = asignadas.includes(codigo)
                    return (
                      <label key={codigo} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                        checked ? 'border-primary/40 bg-primary/5 text-primary' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          className="accent-primary"
                          onChange={() => {
                            const arr: string[] = JSON.parse(form.rutas_asignadas ?? '[]')
                            const next = checked ? arr.filter(c => c !== codigo) : [...arr, codigo]
                            sf('rutas_asignadas', JSON.stringify(next))
                          }}
                        />
                        <span className="truncate">{label}</span>
                      </label>
                    )
                  })}
                </div>
                <p className="text-xs text-gray-400 mt-1">Solo estas rutas usarán este chofer en turnos</p>
              </div>

              <div>
                <label className="label">Ciudad actual</label>
                <select
                  className="input mt-1"
                  value={form.ciudad_actual ?? 'SANTO DOMINGO'}
                  onChange={e => sf('ciudad_actual', e.target.value)}
                >
                  {CIUDADES_OPCIONES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Ubicación física actual del chofer</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="btn-ghost">Cancelar</button>
              <button onClick={handleSave} disabled={saving || !form.nombre} className="btn-primary flex items-center gap-2">
                <Save size={15} /> {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TurnoList({ titulo, subtitulo, col, items, dragging, dragOver, setDragging, setDragOver, onDrop, onRestablecer }: {
  titulo: string; subtitulo: string; col: Col; items: Chofer[]
  dragging: { id: number; col: Col } | null
  dragOver: number | null
  setDragging: (d: { id: number; col: Col } | null) => void
  setDragOver: (id: number | null) => void
  onDrop: (targetId: number, col: Col) => void
  onRestablecer: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <p className="text-xs font-bold text-primary uppercase tracking-wider">{titulo}</p>
          <p className="text-xs text-gray-400">{subtitulo}</p>
        </div>
        <button onClick={onRestablecer} className="text-xs text-gray-400 hover:text-primary transition-colors">
          Restablecer
        </button>
      </div>
      <div className="space-y-1">
        {items.length === 0 && <p className="text-xs text-gray-300 italic text-center py-1">Sin choferes</p>}
        {items.map((c, i) => {
          const isDraggingThis = dragging?.id === c.id
          const isOver         = dragOver === c.id && dragging?.col === col && dragging?.id !== c.id
          return (
            <div
              key={c.id}
              draggable
              onDragStart={() => setDragging({ id: c.id, col })}
              onDragEnd={() => { setDragging(null); setDragOver(null) }}
              onDragOver={e => { e.preventDefault(); setDragOver(c.id) }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => onDrop(c.id, col)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-sm select-none transition-all ${
                isDraggingThis ? 'opacity-40 bg-gray-50' :
                isOver         ? 'border-primary/50 bg-primary/5 scale-[1.02]' :
                                 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
              } cursor-grab active:cursor-grabbing`}
            >
              <GripVertical size={12} className="text-gray-300 flex-shrink-0" />
              <span className="text-gray-400 text-xs w-4 text-right flex-shrink-0">{i + 1}.</span>
              <span className="text-xs font-mono text-gray-500 w-5 text-center flex-shrink-0">({c.digito_placa})</span>
              <span className="text-gray-800 text-xs flex-1 truncate">{c.nombre}</span>
              {getPicoPlaca(c.digito_placa) && (
                <AlertTriangle size={10} className="text-amber-500 flex-shrink-0" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

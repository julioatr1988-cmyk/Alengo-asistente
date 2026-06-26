import { useState, useEffect } from 'react'
import { X, CheckCircle, Send } from 'lucide-react'
import { format } from 'date-fns'
import { useAppStore } from '../store/useAppStore'
import type { Viaje, TipoViaje } from '../types'

interface Props {
  onClose: () => void
  onCreated: (viaje: Viaje) => void
  fechaDefault?: string
}

const ESTADO_DEFAULT = 'pendiente'

export function NuevoViajeModal({ onClose, onCreated, fechaDefault }: Props) {
  const { rutas, refreshViajesHoy } = useAppStore()

  const [form, setForm] = useState({
    fecha: fechaDefault ?? format(new Date(), 'yyyy-MM-dd'),
    hora: format(new Date(), 'HH:mm'),
    ruta_id: rutas[0]?.id ?? 1,
    tipo: 'pasajero' as TipoViaje,
    cant_pasajeros: 1,
    encomiendas: '',
    monto: '',
    observaciones: '',
    cliente_nombre: '',
    cliente_telefono: '',
    origen: '',
    destino: '',
    requiere_factura: 0,
  })

  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState<Viaje | null>(null)
  const [waSent, setWaSent] = useState(false)
  const [sendingWA, setSendingWA] = useState(false)

  const selectedRuta = rutas.find(r => r.id === Number(form.ruta_id))

  useEffect(() => {
    if (form.ruta_id && form.monto === '') {
      const ruta = rutas.find(r => r.id === Number(form.ruta_id))
      if (ruta) setForm(f => ({ ...f, monto: String(ruta.precio_base) }))
    }
  }, [form.ruta_id, rutas])

  const handleSubmit = async () => {
    if (!form.cliente_nombre || !form.ruta_id) return
    setLoading(true)
    try {
      const viaje = await window.electronAPI.viajes.create({
        ...form,
        ruta_id:        Number(form.ruta_id),
        cant_pasajeros: Number(form.cant_pasajeros),
        monto:          Number(form.monto),
        estado:         ESTADO_DEFAULT,
      })
      setSaved(viaje)
      await refreshViajesHoy()
      onCreated(viaje)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const handleSendWA = async () => {
    if (!saved?.viaje_grupo_id || !saved.chofer_grupo_wa_id) return
    setSendingWA(true)
    const vsGrupo = await window.electronAPI.viajeGrupos.getViajes(saved.viaje_grupo_id)
    const lineas  = (vsGrupo as typeof saved[]).map(v =>
      `👤 ${v.cliente_nombre || '?'} ${v.cliente_telefono || ''} — desde ${v.origen || '?'} — $${Number(v.monto ?? 0).toFixed(2)}`
    )
    const total   = (vsGrupo as typeof saved[]).reduce((s, v) => s + Number(v.monto ?? 0), 0)
    const texto   = [
      `🔔 *Viaje ${saved.hora} → ${saved.destino}*`,
      ...lineas,
      `Total: $${total.toFixed(2)}`,
    ].join('\n')
    const result = await window.electronAPI.whatsapp.sendMessage(saved.chofer_grupo_wa_id, texto)
    if (result.success) {
      await window.electronAPI.viajes.update({ ...saved, wa_enviado: 1 })
      setWaSent(true)
    }
    setSendingWA(false)
  }

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-primary">Nuevo Viaje</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {saved ? (
            /* Confirmación */
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
                <CheckCircle className="text-secondary" size={24} />
                <div>
                  <p className="font-semibold text-green-800">Viaje registrado exitosamente</p>
                  {saved?.chofer_nombre ? (
                    <p className="text-sm text-green-700">
                      Asignado a <strong>{saved.chofer_nombre}</strong> — placa *{saved.digito_placa}
                    </p>
                  ) : (
                    <p className="text-sm text-yellow-700">Sin chofer asignado (no hay disponibles)</p>
                  )}
                </div>
              </div>

              {saved?.chofer_grupo_wa_id ? (
                <button
                  onClick={handleSendWA}
                  disabled={sendingWA || waSent}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-colors ${
                    waSent
                      ? 'bg-green-100 text-green-700 cursor-default'
                      : 'bg-secondary text-white hover:bg-secondary-600'
                  }`}
                >
                  <Send size={16} />
                  {waSent ? 'Enviado a WhatsApp ✓' : sendingWA ? 'Enviando...' : 'Enviar todos los pasajeros al chofer'}
                </button>
              ) : (
                <p className="text-sm text-amber-600 text-center">
                  El chofer no tiene grupo WA configurado
                </p>
              )}
            </div>
          ) : (
            /* Formulario */
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Nombre del cliente *</label>
                <input className="input" value={form.cliente_nombre} onChange={e => set('cliente_nombre', e.target.value)} placeholder="Juan Pérez" />
              </div>
              <div>
                <label className="label">Teléfono</label>
                <input className="input" value={form.cliente_telefono} onChange={e => set('cliente_telefono', e.target.value)} placeholder="0991234567" />
              </div>

              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input" value={form.fecha} onChange={e => set('fecha', e.target.value)} />
              </div>
              <div>
                <label className="label">Hora</label>
                <input type="time" className="input" value={form.hora} onChange={e => set('hora', e.target.value)} />
              </div>

              <div>
                <label className="label">Ruta *</label>
                <select className="input" value={form.ruta_id} onChange={e => set('ruta_id', e.target.value)}>
                  {rutas.map(r => (
                    <option key={r.id} value={r.id}>{r.codigo} — {r.nombre}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Tipo de servicio</label>
                <select className="input" value={form.tipo} onChange={e => set('tipo', e.target.value)}>
                  <option value="pasajero">Pasajero</option>
                  <option value="encomienda">Encomienda</option>
                  <option value="express">Express</option>
                  <option value="flete">Flete</option>
                </select>
              </div>

              {form.tipo === 'pasajero' && (
                <div>
                  <label className="label">Cantidad de pasajeros</label>
                  <input type="number" min="1" className="input" value={form.cant_pasajeros} onChange={e => set('cant_pasajeros', e.target.value)} />
                </div>
              )}
              {form.tipo === 'encomienda' && (
                <div>
                  <label className="label">Descripción encomienda</label>
                  <input className="input" value={form.encomiendas} onChange={e => set('encomiendas', e.target.value)} placeholder="Paquete, documentos..." />
                </div>
              )}

              <div>
                <label className="label">Origen (dirección recogida)</label>
                <input className="input" value={form.origen} onChange={e => set('origen', e.target.value)} placeholder="Calle, barrio, ciudad" />
              </div>
              <div>
                <label className="label">Destino (dirección entrega)</label>
                <input className="input" value={form.destino} onChange={e => set('destino', e.target.value)} placeholder="Calle, barrio, ciudad" />
              </div>

              <div>
                <label className="label">Monto $ {selectedRuta && <span className="text-gray-400">(base: ${selectedRuta.precio_base})</span>}</label>
                <input type="number" min="0" step="0.50" className="input" value={form.monto} onChange={e => set('monto', e.target.value)} />
              </div>
              <div>
                <label className="label">Observaciones</label>
                <input className="input" value={form.observaciones} onChange={e => set('observaciones', e.target.value)} placeholder="Notas adicionales..." />
              </div>

              <div className="col-span-2 flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="requiere_factura"
                  checked={!!form.requiere_factura}
                  onChange={e => set('requiere_factura', e.target.checked ? 1 : 0)}
                  className="w-4 h-4 rounded border-gray-300 accent-primary cursor-pointer"
                />
                <label htmlFor="requiere_factura" className="text-sm text-gray-700 cursor-pointer select-none">
                  Requiere factura
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t flex justify-end gap-3">
          <button onClick={onClose} className="btn-ghost">
            {saved ? 'Cerrar' : 'Cancelar'}
          </button>
          {!saved && (
            <button
              onClick={handleSubmit}
              disabled={loading || !form.cliente_nombre}
              className="btn-primary"
            >
              {loading ? 'Guardando...' : 'Confirmar y Asignar'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

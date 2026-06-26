import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle, Clock, AlertTriangle, DollarSign,
  ChevronLeft, ChevronRight, FileText, X, History,
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAppStore } from '../store/useAppStore'
import type { Mensualidad } from '../types'

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

export function Cobros() {
  const { choferes } = useAppStore()
  const hoy = new Date()

  const [mes, setMes]                       = useState(hoy.getMonth() + 1)
  const [anio, setAnio]                     = useState(hoy.getFullYear())
  const [mensualidades, setMensualidades]   = useState<Mensualidad[]>([])
  const [showPagoModal, setShowPagoModal]   = useState(false)
  const [selectedMens, setSelectedMens]     = useState<Mensualidad | null>(null)
  const [showHistorial, setShowHistorial]   = useState(false)
  const [historialChofer, setHistorialChofer] = useState<Mensualidad[]>([])
  const [selectedChofer, setSelectedChofer] = useState<Mensualidad | null>(null)
  const [pagoForm, setPagoForm]             = useState({ monto: '', fecha_pago: format(hoy, 'yyyy-MM-dd'), notas: '' })
  const [guardando, setGuardando]           = useState(false)

  const loadMensualidades = useCallback(async () => {
    const result = await window.electronAPI.mensualidades.get(mes, anio)
    setMensualidades(result as Mensualidad[])
  }, [mes, anio])

  useEffect(() => { loadMensualidades() }, [loadMensualidades])

  const navMes = (dir: 1 | -1) => {
    setMes(m => {
      const next = m + dir
      if (next < 1) { setAnio(a => a - 1); return 12 }
      if (next > 12) { setAnio(a => a + 1); return 1 }
      return next
    })
  }

  const openPago = (m: Mensualidad) => {
    setSelectedMens(m)
    setPagoForm({ monto: String(m.monto), fecha_pago: format(hoy, 'yyyy-MM-dd'), notas: '' })
    setShowPagoModal(true)
  }

  const handleGuardarPago = async () => {
    if (!selectedMens) return
    setGuardando(true)
    await window.electronAPI.mensualidades.pagar({
      id: selectedMens.id,
      monto: parseFloat(pagoForm.monto) || selectedMens.monto,
      fecha_pago: pagoForm.fecha_pago,
      notas: pagoForm.notas || undefined,
    } as Partial<Mensualidad> & { id: number })
    await loadMensualidades()
    setShowPagoModal(false)
    setGuardando(false)
  }

  const openHistorial = async (m: Mensualidad) => {
    setSelectedChofer(m)
    const hist = await window.electronAPI.mensualidades.chofer(m.chofer_id, anio)
    setHistorialChofer(hist as Mensualidad[])
    setShowHistorial(true)
  }

  const handleGenerarRecibo = (m: Mensualidad) => {
    import('jspdf').then(({ jsPDF }) => {
      const doc = new jsPDF({ unit: 'mm', format: 'a5' })

      // Header
      doc.setFillColor(15, 30, 60)
      doc.rect(0, 0, 148, 22, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(15)
      doc.setFont('helvetica', 'bold')
      doc.text('RECIBO DE PAGO', 74, 12, { align: 'center' })
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text('Alengo Asistente Virtual', 74, 18, { align: 'center' })

      doc.setTextColor(0, 0, 0)
      const y0 = 32
      const lh = 9

      const row = (label: string, val: string, y: number) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
        doc.text(label, 12, y)
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
        doc.text(val, 50, y)
      }

      row('Chofer:',       m.chofer_nombre ?? '—',             y0)
      row('Placa:',        `${m.numero_placa ?? '—'} (*${m.digito_placa ?? '—'})`, y0 + lh)
      row('Período:',      `${MESES[m.mes - 1]} ${m.anio}`,    y0 + lh * 2)
      row('Fecha pago:',   m.fecha_pago ?? '—',                y0 + lh * 3)
      if (m.notas) row('Notas:',  m.notas, y0 + lh * 4)

      // Monto destacado
      doc.setFillColor(16, 185, 129)
      doc.rect(10, y0 + lh * 5.5, 128, 16, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(16)
      doc.setFont('helvetica', 'bold')
      doc.text(`MONTO PAGADO: $${m.monto?.toFixed(2)}`, 74, y0 + lh * 5.5 + 11, { align: 'center' })

      // Footer
      doc.setTextColor(150, 150, 150)
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.text(`Generado el ${format(new Date(), "d 'de' MMMM yyyy", { locale: es })}`, 74, 192, { align: 'center' })

      doc.save(`recibo_${m.chofer_nombre?.replace(/ /g, '_')}_${MESES[m.mes - 1]}_${m.anio}.pdf`)
    })
  }

  // Stats del mes
  const pagados   = mensualidades.filter(m => m.pagado).length
  const pendientes = mensualidades.filter(m => !m.pagado).length
  const recaudado  = mensualidades.filter(m => m.pagado).reduce((s, m) => s + m.monto, 0)
  const porCobrar  = mensualidades.filter(m => !m.pagado).reduce((s, m) => s + m.monto, 0)

  return (
    <div className="h-full flex flex-col p-5 gap-4">
      {/* Navegación mes */}
      <div className="flex items-center gap-3">
        <button onClick={() => navMes(-1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><ChevronLeft size={18} /></button>
        <div className="text-center min-w-[160px]">
          <h2 className="text-base font-bold text-primary capitalize">{MESES[mes - 1]} {anio}</h2>
          <p className="text-xs text-gray-400">Mensualidades</p>
        </div>
        <button onClick={() => navMes(1)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors"><ChevronRight size={18} /></button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { icon: CheckCircle, label: 'Pagados',   value: pagados,              sub: `$${recaudado.toFixed(2)}`, color: 'text-secondary',   bg: 'bg-secondary/10' },
          { icon: Clock,       label: 'Pendientes', value: pendientes,            sub: `$${porCobrar.toFixed(2)}`, color: 'text-amber-500',   bg: 'bg-amber-50' },
          { icon: DollarSign,  label: 'Recaudado',  value: `$${recaudado.toFixed(2)}`,  sub: `${pagados} pagos`,        color: 'text-blue-600',    bg: 'bg-blue-50' },
          { icon: AlertTriangle,label:'Por cobrar', value: `$${porCobrar.toFixed(2)}`,  sub: `${pendientes} pendientes`,color: 'text-red-500',     bg: 'bg-red-50' },
        ].map(({ icon: Icon, label, value, sub, color, bg }) => (
          <div key={label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={20} className={color} />
            </div>
            <div>
              <p className="text-xs text-gray-400">{label}</p>
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-400">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabla */}
      <div className="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 border-b">
                {['Chofer','Vehículo','Tarifa','Estado','Fecha pago','Notas','Acciones'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mensualidades.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-300 text-sm">
                    Cargando mensualidades...
                  </td>
                </tr>
              )}
              {mensualidades.map(m => (
                <tr key={m.id} className={`border-b hover:bg-gray-50/60 transition-colors ${!m.pagado && m.mes < hoy.getMonth() + 1 && m.anio <= hoy.getFullYear() ? 'bg-red-50/30' : ''}`}>
                  <td className="px-3 py-3 font-medium text-gray-900">{m.chofer_nombre}</td>
                  <td className="px-3 py-3">
                    <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{m.numero_placa ?? '—'}</span>
                    <span className="text-xs text-gray-400 ml-1">*{m.digito_placa ?? '—'}</span>
                  </td>
                  <td className="px-3 py-3 font-semibold text-gray-800">${m.monto?.toFixed(2)}</td>
                  <td className="px-3 py-3">
                    {m.pagado ? (
                      <span className="inline-flex items-center gap-1 text-xs text-secondary font-semibold bg-secondary/10 px-2 py-1 rounded-full">
                        <CheckCircle size={12} /> Pagado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-1 rounded-full">
                        <Clock size={12} /> Pendiente
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-gray-500 text-xs">{m.fecha_pago ?? '—'}</td>
                  <td className="px-3 py-3 text-gray-400 text-xs max-w-[120px] truncate">{m.notas ?? '—'}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {!m.pagado && (
                        <button onClick={() => openPago(m)}
                          className="text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary-600 transition-colors font-medium">
                          Registrar pago
                        </button>
                      )}
                      {m.pagado && (
                        <button onClick={() => handleGenerarRecibo(m)}
                          className="flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2.5 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                          <FileText size={12} /> Recibo
                        </button>
                      )}
                      <button onClick={() => openHistorial(m)}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-primary transition-colors px-1.5 py-1.5"
                        title="Ver historial del año">
                        <History size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: registrar pago */}
      {showPagoModal && selectedMens && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-lg text-primary">Registrar Pago</h3>
              <button onClick={() => setShowPagoModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
            </div>
            <p className="text-sm text-gray-500 mb-5">
              <strong>{selectedMens.chofer_nombre}</strong> · {MESES[mes - 1]} {anio}
            </p>
            <div className="space-y-3">
              <div>
                <label className="label">Monto $</label>
                <input type="number" className="input" min="0" step="0.01"
                  value={pagoForm.monto}
                  onChange={e => setPagoForm(f => ({ ...f, monto: e.target.value }))} />
              </div>
              <div>
                <label className="label">Fecha de pago</label>
                <input type="date" className="input"
                  value={pagoForm.fecha_pago}
                  onChange={e => setPagoForm(f => ({ ...f, fecha_pago: e.target.value }))} />
              </div>
              <div>
                <label className="label">Notas (opcional)</label>
                <input className="input"
                  value={pagoForm.notas}
                  onChange={e => setPagoForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Transferencia, efectivo, etc." />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowPagoModal(false)} className="btn-ghost">Cancelar</button>
              <button onClick={handleGuardarPago} disabled={guardando} className="btn-primary">
                {guardando ? 'Guardando...' : 'Confirmar pago ✓'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: historial anual */}
      {showHistorial && selectedChofer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg text-primary">Historial {anio}</h3>
                <p className="text-sm text-gray-500">{selectedChofer.chofer_nombre}</p>
              </div>
              <button onClick={() => setShowHistorial(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} /></button>
            </div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {MESES.map((nomMes, idx) => {
                const mens = historialChofer.find(h => h.mes === idx + 1)
                return (
                  <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                    <span className={`text-sm font-medium ${idx + 1 === mes ? 'text-primary' : 'text-gray-700'}`}>{nomMes}</span>
                    {mens ? (
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-gray-800">${mens.monto?.toFixed(2)}</span>
                        {mens.pagado
                          ? <span className="text-xs text-secondary font-semibold flex items-center gap-1"><CheckCircle size={12} /> Pagado</span>
                          : <span className="text-xs text-amber-500 font-semibold flex items-center gap-1"><Clock size={12} /> Pendiente</span>
                        }
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">Sin registro</span>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
              <span className="text-gray-500">Total pagado {anio}</span>
              <span className="font-bold text-secondary">
                ${historialChofer.filter(h => h.pagado).reduce((s, h) => s + h.monto, 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

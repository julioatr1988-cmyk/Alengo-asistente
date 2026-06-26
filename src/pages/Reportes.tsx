import { useState } from 'react'
import { format, startOfWeek, endOfWeek, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { FileSpreadsheet, FileText, Search, TrendingUp, Route, BarChart3 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { Viaje } from '../types'

const RUTAS_COLS = ['UIO-STO', 'STO-UIO', 'STO-GYE', 'GYE-STO', 'MTA-STO', 'STO-MTA']

const DIAS_ES: Record<number, string> = {
  0: 'DOM', 1: 'LUN', 2: 'MAR', 3: 'MIÉ', 4: 'JUE', 5: 'VIE', 6: 'SÁB',
}

function getDia(fecha: string) {
  const d = parseISO(fecha)
  return DIAS_ES[d.getDay()] ?? ''
}

export function Reportes() {
  const { choferes } = useAppStore()
  const semana = { inicio: startOfWeek(new Date(), { weekStartsOn: 1 }), fin: endOfWeek(new Date(), { weekStartsOn: 1 }) }

  const [filtroChofer, setFiltroChofer]       = useState('0')
  const [desde, setDesde]                     = useState(format(semana.inicio, 'yyyy-MM-dd'))
  const [hasta, setHasta]                     = useState(format(semana.fin, 'yyyy-MM-dd'))
  const [viajes, setViajes]                   = useState<Viaje[]>([])
  const [loading, setLoading]                 = useState(false)
  const [exportingXlsx, setExportingXlsx]     = useState(false)
  const [exportingPdf, setExportingPdf]       = useState(false)

  const choferSel   = choferes.find(c => c.id === Number(filtroChofer))
  const totalMonto  = viajes.reduce((s, v) => s + (v.monto ?? 0), 0)
  const totalViajes = viajes.length

  // Conteos por ruta
  const porRuta = RUTAS_COLS.reduce<Record<string, number>>((acc, r) => {
    acc[r] = viajes.filter(v => v.ruta_codigo === r).length
    return acc
  }, {})

  const setPeriodo = (p: 'semana' | 'mes' | 'hoy') => {
    const hoy = new Date()
    if (p === 'hoy') {
      const d = format(hoy, 'yyyy-MM-dd')
      setDesde(d); setHasta(d)
    } else if (p === 'semana') {
      setDesde(format(startOfWeek(hoy, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
      setHasta(format(endOfWeek(hoy, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
    } else {
      setDesde(format(new Date(hoy.getFullYear(), hoy.getMonth(), 1), 'yyyy-MM-dd'))
      setHasta(format(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0), 'yyyy-MM-dd'))
    }
  }

  const handleGenerar = async () => {
    setLoading(true)
    const result = await window.electronAPI.reportes.chofer(Number(filtroChofer), desde, hasta)
    setViajes(result as Viaje[])
    setLoading(false)
  }

  // ── Excel ──────────────────────────────────────────────────────────────────
  const handleExportXlsx = async () => {
    if (!viajes.length) return
    setExportingXlsx(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Alengo Asistente Virtual'
      const ws = wb.addWorksheet('Reporte', { pageSetup: { orientation: 'landscape' } })

      const AZUL    = '0F1E3C'
      const VERDE_C = 'D1FAE5'
      const VERDE_H = '059669'

      // Fila 1 — título
      ws.mergeCells('A1:M1')
      const t1 = ws.getCell('A1')
      t1.value = choferSel ? `REPORTE DE VIAJES — ${choferSel.nombre.toUpperCase()}` : 'REPORTE GENERAL DE VIAJES'
      t1.font  = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
      t1.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${AZUL}` } }
      t1.alignment = { horizontal: 'center', vertical: 'middle' }
      ws.getRow(1).height = 28

      // Fila 2 — período
      ws.mergeCells('A2:M2')
      const t2 = ws.getCell('A2')
      t2.value = `Período: ${desde}  al  ${hasta}`
      t2.font  = { italic: true, size: 10, color: { argb: 'FF6B7280' } }
      t2.alignment = { horizontal: 'center' }

      // Fila 3 — vacía
      ws.addRow([])

      // Encabezados
      const HEADERS = ['FECHA','DÍA','UIO-STO','STO-UIO','STO-GYE','GYE-STO','MTA-STO','STO-MTA','HORA','CANT.PSJ','ENC.','CANT T ($)','OBSERVACIONES']
      const hRow = ws.addRow(HEADERS)
      hRow.eachCell(cell => {
        cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 }
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${VERDE_H}` } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border    = { bottom: { style: 'medium', color: { argb: 'FF047857' } } }
      })
      hRow.height = 20

      // Anchos de columna
      const widths = [12, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 12, 30]
      widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

      // Datos
      for (let idx = 0; idx < viajes.length; idx++) {
        const v   = viajes[idx]
        const row = ws.addRow([
          v.fecha, getDia(v.fecha),
          v.ruta_codigo === 'UIO-STO' ? 'X' : '',
          v.ruta_codigo === 'STO-UIO' ? 'X' : '',
          v.ruta_codigo === 'STO-GYE' ? 'X' : '',
          v.ruta_codigo === 'GYE-STO' ? 'X' : '',
          v.ruta_codigo === 'MTA-STO' ? 'X' : '',
          v.ruta_codigo === 'STO-MTA' ? 'X' : '',
          v.hora,
          v.cant_pasajeros > 0 ? v.cant_pasajeros : '',
          v.encomiendas || '',
          v.monto,
          v.observaciones || '',
        ])
        // Fondo alterno
        if (idx % 2 === 0) {
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${VERDE_C}` } }
          })
        }
        // X centradas y negrita
        for (let c = 3; c <= 8; c++) {
          row.getCell(c).alignment = { horizontal: 'center' }
          row.getCell(c).font      = { bold: true }
        }
        // Monto formato moneda
        row.getCell(12).numFmt    = '"$"#,##0.00'
        row.getCell(12).font      = { bold: true }
        row.getCell(12).alignment = { horizontal: 'right' }
        row.height = 16
      }

      // Fila total
      const totalRow = ws.addRow(['TOTAL DE VUELTAS','','','','','','','','','','', totalMonto,''])
      totalRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${AZUL}` } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }
      })
      totalRow.getCell(12).numFmt    = '"$"#,##0.00'
      totalRow.getCell(12).alignment = { horizontal: 'right' }
      totalRow.height = 20

      // Descargar
      const buffer = await wb.xlsx.writeBuffer()
      const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url    = URL.createObjectURL(blob)
      const a      = document.createElement('a')
      a.href       = url
      a.download   = `reporte_${choferSel?.nombre.replace(/ /g,'_') ?? 'todos'}_${desde}_${hasta}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingXlsx(false)
    }
  }

  // ── PDF ────────────────────────────────────────────────────────────────────
  const handleExportPdf = async () => {
    if (!viajes.length) return
    setExportingPdf(true)
    try {
      const { jsPDF }   = await import('jspdf')
      const autoTable   = (await import('jspdf-autotable')).default
      const doc         = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

      // Header
      doc.setFillColor(15, 30, 60)
      doc.rect(0, 0, 297, 20, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(13)
      doc.setFont('helvetica', 'bold')
      doc.text(choferSel ? `REPORTE — ${choferSel.nombre.toUpperCase()}` : 'REPORTE GENERAL', 148, 10, { align: 'center' })
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.text(`Período: ${desde}  al  ${hasta}  ·  Total: $${totalMonto.toFixed(2)}  ·  Viajes: ${totalViajes}`, 148, 16, { align: 'center' })

      const body = viajes.map(v => [
        v.fecha, getDia(v.fecha),
        v.ruta_codigo === 'UIO-STO' ? 'X' : '',
        v.ruta_codigo === 'STO-UIO' ? 'X' : '',
        v.ruta_codigo === 'STO-GYE' ? 'X' : '',
        v.ruta_codigo === 'GYE-STO' ? 'X' : '',
        v.ruta_codigo === 'MTA-STO' ? 'X' : '',
        v.ruta_codigo === 'STO-MTA' ? 'X' : '',
        v.hora,
        v.cant_pasajeros > 0 ? String(v.cant_pasajeros) : '',
        v.encomiendas || '',
        `$${v.monto?.toFixed(2)}`,
        v.observaciones || '',
      ])

      autoTable(doc, {
        startY:   24,
        head:     [['FECHA','DÍA','UIO-STO','STO-UIO','STO-GYE','GYE-STO','MTA-STO','STO-MTA','HORA','PSJ','ENC','TOTAL','OBSERVACIONES']],
        body,
        foot:     [['TOTAL DE VUELTAS','','','','','','','','','','',`$${totalMonto.toFixed(2)}`,'']],
        headStyles: { fillColor: [5, 150, 105], textColor: 255, fontStyle: 'bold', halign: 'center', fontSize: 7 },
        footStyles: { fillColor: [15, 30, 60],  textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [209, 250, 229] },
        styles:         { fontSize: 7, cellPadding: 1.5 },
        columnStyles:   {
          0: { cellWidth: 22 }, 1: { cellWidth: 10, halign: 'center' },
          2: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
          3: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
          4: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
          5: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
          6: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
          7: { cellWidth: 12, halign: 'center', fontStyle: 'bold' },
          8: { cellWidth: 12, halign: 'center' }, 9: { cellWidth: 10, halign: 'center' },
          10: { cellWidth: 14 }, 11: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
          12: { cellWidth: 'auto' },
        },
      })

      doc.save(`reporte_${choferSel?.nombre.replace(/ /g,'_') ?? 'todos'}_${desde}_${hasta}.pdf`)
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <div className="h-full flex flex-col p-5 gap-4">
      {/* Panel de filtros */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="label">Chofer</label>
            <select className="input w-48" value={filtroChofer} onChange={e => setFiltroChofer(e.target.value)}>
              <option value="0">Todos los choferes</option>
              {choferes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Desde</label>
            <input type="date" className="input" value={desde} onChange={e => setDesde(e.target.value)} />
          </div>
          <div>
            <label className="label">Hasta</label>
            <input type="date" className="input" value={hasta} onChange={e => setHasta(e.target.value)} />
          </div>

          {/* Accesos rápidos */}
          <div className="flex gap-1.5 pb-0.5">
            {([['hoy','Hoy'],['semana','Esta semana'],['mes','Este mes']] as const).map(([p, label]) => (
              <button key={p} onClick={() => setPeriodo(p)}
                className="text-xs px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors whitespace-nowrap">
                {label}
              </button>
            ))}
          </div>

          <button onClick={handleGenerar} disabled={loading} className="btn-primary flex items-center gap-2 ml-auto">
            <Search size={15} /> {loading ? 'Cargando...' : 'Generar'}
          </button>
          <button onClick={handleExportXlsx} disabled={!viajes.length || exportingXlsx}
            className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 text-sm font-medium transition-colors">
            <FileSpreadsheet size={15} /> {exportingXlsx ? 'Exportando...' : 'Excel'}
          </button>
          <button onClick={handleExportPdf} disabled={!viajes.length || exportingPdf}
            className="flex items-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 text-sm font-medium transition-colors">
            <FileText size={15} /> {exportingPdf ? 'Exportando...' : 'PDF'}
          </button>
        </div>
      </div>

      {/* Stats si hay datos */}
      {viajes.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <StatCard icon={BarChart3}  label="Total viajes"  value={totalViajes}               color="text-primary"   bg="bg-primary/5" />
          <StatCard icon={TrendingUp} label="Total monto"   value={`$${totalMonto.toFixed(2)}`} color="text-secondary" bg="bg-secondary/10" />
          <StatCard icon={Route}      label="Rutas activas" value={Object.values(porRuta).filter(n => n > 0).length} color="text-blue-600" bg="bg-blue-50" />
          <StatCard icon={FileSpreadsheet} label="Promedio/viaje" value={`$${(totalMonto / totalViajes).toFixed(2)}`} color="text-purple-600" bg="bg-purple-50" />
        </div>
      )}

      {/* Tabla */}
      <div className="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        {viajes.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-3">
            <FileSpreadsheet size={44} />
            <p className="text-sm">Selecciona filtros y genera el reporte</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="sticky top-0 z-10 bg-secondary/15">
                  {['FECHA','DÍA',...RUTAS_COLS,'HORA','CANT.PSJ','ENC.','CANT T ($)','OBSERVACIONES'].map(h => (
                    <th key={h} className="border border-gray-200 px-2 py-2 font-bold text-gray-800 text-center whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viajes.map((v, i) => (
                  <tr key={v.id} className={i % 2 === 0 ? 'bg-white' : 'bg-secondary/5'}>
                    <td className="border border-gray-200 px-2 py-1.5 text-center font-mono">{v.fecha}</td>
                    <td className="border border-gray-200 px-2 py-1.5 text-center font-semibold text-gray-600">{getDia(v.fecha)}</td>
                    {RUTAS_COLS.map(rc => (
                      <td key={rc} className="border border-gray-200 px-2 py-1.5 text-center font-bold text-primary text-sm">
                        {v.ruta_codigo === rc ? 'X' : ''}
                      </td>
                    ))}
                    <td className="border border-gray-200 px-2 py-1.5 text-center font-mono">{v.hora}</td>
                    <td className="border border-gray-200 px-2 py-1.5 text-center">{v.cant_pasajeros > 0 ? v.cant_pasajeros : ''}</td>
                    <td className="border border-gray-200 px-2 py-1.5 text-center text-gray-500">{v.encomiendas || ''}</td>
                    <td className="border border-gray-200 px-2 py-1.5 text-center font-bold text-gray-800">${v.monto?.toFixed(2)}</td>
                    <td className="border border-gray-200 px-2 py-1.5 text-gray-500 max-w-[120px] truncate">{v.observaciones}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-primary text-white font-bold">
                  <td colSpan={11} className="border border-gray-300 px-3 py-2 text-center uppercase tracking-wider text-xs">
                    TOTAL DE VUELTAS — {totalViajes} viajes
                  </td>
                  <td className="border border-gray-300 px-2 py-2 text-center text-sm">${totalMonto.toFixed(2)}</td>
                  <td className="border border-gray-300" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color, bg }: {
  icon: React.ElementType; label: string; value: string | number; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
        <Icon size={20} className={color} />
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  )
}

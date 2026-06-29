import { useState, useEffect, useRef } from 'react'
import { Plus, Upload, Search, CheckCircle, XCircle, X } from 'lucide-react'
import type { Cliente, ClienteImportRow } from '../types'
import { ContactosPreview } from '../components/ContactosPreview'

function normalizePhone(raw: string): string {
  return raw
    .replace(/[^\d]/g, '')
    .replace(/^0+/, '')
    .replace(/^593/, '')
}

function isPhoneLike(digits: string): boolean {
  return digits.length >= 7 && digits.length <= 15
}

function cellText(val: unknown): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val.trim()
  if (typeof val === 'number') return String(val)
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'object') {
    if ('text' in val) return String((val as { text: unknown }).text).trim()
    if ('result' in val) return cellText((val as { result: unknown }).result)
    if ('richText' in val) {
      return (val as { richText: Array<{ text: string }> }).richText.map(r => r.text).join('').trim()
    }
  }
  return String(val).trim()
}

async function parseExcel(file: File): Promise<Array<{ nombre: string; telefono: string }>> {
  const ExcelJS = (await import('exceljs')).default
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return []

  const NOMBRE_KEYS = ['nombre', 'name', 'cliente', 'contacto']
  const PHONE_KEYS = ['telefono', 'teléfono', 'phone', 'celular', 'número', 'numero', 'cel', 'movil', 'móvil']

  let nombreCol = -1
  let telefonoCol = -1
  let startRow = 1

  const firstRow = ws.getRow(1)
  let hasHeaders = false
  firstRow.eachCell({ includeEmpty: false }, cell => {
    const h = cellText(cell.value).toLowerCase()
    if (NOMBRE_KEYS.includes(h) || PHONE_KEYS.includes(h)) hasHeaders = true
  })

  if (hasHeaders) {
    startRow = 2
    firstRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const h = cellText(cell.value).toLowerCase()
      if (NOMBRE_KEYS.includes(h) && nombreCol === -1) nombreCol = colNum
      if (PHONE_KEYS.includes(h) && telefonoCol === -1) telefonoCol = colNum
    })
  } else {
    // Auto-detectar columnas desde la primera fila
    firstRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const text = cellText(cell.value)
      const digits = text.replace(/[^\d]/g, '')
      if (telefonoCol === -1 && isPhoneLike(digits)) {
        telefonoCol = colNum
      } else if (nombreCol === -1 && text.length > 0) {
        nombreCol = colNum
      }
    })
  }

  const results: Array<{ nombre: string; telefono: string }> = []

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum < startRow) return
    const nombre = nombreCol > 0 ? cellText(row.getCell(nombreCol).value).trim() : ''
    const rawTel = telefonoCol > 0 ? cellText(row.getCell(telefonoCol).value) : ''
    const telefono = normalizePhone(rawTel)
    if (nombre && isPhoneLike(telefono)) {
      results.push({ nombre, telefono })
    }
  })

  return results
}

function OrigenBadge({ origen }: { origen?: string | null }) {
  if (origen === 'importado') {
    return (
      <span className="inline-flex items-center text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5">
        importado
      </span>
    )
  }
  if (origen === 'manual') {
    return (
      <span className="inline-flex items-center text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
        manual
      </span>
    )
  }
  return (
    <span className="inline-flex items-center text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
      whatsapp
    </span>
  )
}

export function Clientes() {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [addNombre, setAddNombre] = useState('')
  const [addTelefono, setAddTelefono] = useState('')
  const [addError, setAddError] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [previewRows, setPreviewRows] = useState<ClienteImportRow[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.electronAPI.clientes.get().then(setClientes)
    window.electronAPI.clientes.onUpdated(() => {
      window.electronAPI.clientes.get().then(setClientes)
    })
  }, [])

  const clientesFiltrados = clientes.filter(c => {
    const q = busqueda.toLowerCase()
    return (
      (c.nombre ?? '').toLowerCase().includes(q) ||
      c.telefono.includes(q)
    )
  })

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    setImporting(true)
    setImportMsg(null)

    if (ext === 'xlsx') {
      try {
        const parsed = await parseExcel(file)
        if (parsed.length === 0) {
          setImportMsg({ ok: false, text: 'No se encontraron contactos válidos en el archivo.' })
          setImporting(false)
          return
        }
        const existingMap = new Map(clientes.map(c => [c.telefono, c.nombre]))
        const preview: ClienteImportRow[] = parsed.map(p => ({
          telefono: p.telefono,
          nombre: p.nombre,
          existe: existingMap.has(p.telefono),
          nombreActual: existingMap.get(p.telefono) ?? null,
        }))
        setPreviewRows(preview)
      } catch (err) {
        setImportMsg({ ok: false, text: `Error al leer el archivo: ${String(err)}` })
      }
      setImporting(false)
      return
    }

    if (ext === 'docx' || ext === 'pdf') {
      const filePath = (file as File & { path: string }).path
      try {
        const result = await window.electronAPI.clientes.extractContactsFromDoc(filePath, ext, file.name)
        if (!result.success) {
          const friendlyError =
            result.error_code === 'rate_limited'
              ? (result.error ?? 'Límite mensual de extracciones alcanzado. Se reinicia el 1ro del próximo mes.')
              : result.error_code === 'no_license'
              ? 'Esta función requiere una licencia activa. Ve a Configuración para activarla.'
              : (result.error ?? 'No se pudo procesar el documento.')
          setImportMsg({ ok: false, text: friendlyError })
          setImporting(false)
          return
        }
        const contacts = result.contacts ?? []
        if (contacts.length === 0) {
          setImportMsg({ ok: false, text: 'No se encontraron contactos con nombre y teléfono en el documento.' })
          setImporting(false)
          return
        }
        const existingMap = new Map(clientes.map(c => [c.telefono, c.nombre]))
        const preview: ClienteImportRow[] = contacts
          .map(c => ({ ...c, telefono: normalizePhone(c.telefono) }))
          .filter(c => isPhoneLike(c.telefono) && c.nombre?.trim())
          .map(c => ({
            telefono: c.telefono,
            nombre: c.nombre.trim(),
            existe: existingMap.has(c.telefono),
            nombreActual: existingMap.get(c.telefono) ?? null,
          }))
        if (preview.length === 0) {
          setImportMsg({ ok: false, text: 'Los contactos extraídos no tienen teléfonos válidos (7-15 dígitos).' })
          setImporting(false)
          return
        }
        setPreviewRows(preview)
      } catch (err) {
        setImportMsg({ ok: false, text: `Error al procesar el archivo: ${String(err)}` })
      }
      setImporting(false)
      return
    }

    setImportMsg({ ok: false, text: 'Formato no soportado. Use .xlsx, .docx o .pdf.' })
    setImporting(false)
  }

  async function handleConfirmImport(rows: Array<{ telefono: string; nombre: string; origen: string }>) {
    setPreviewRows(null)
    const result = await window.electronAPI.clientes.importarBatch(rows)
    setImportMsg({ ok: true, text: `${result.count} contacto${result.count !== 1 ? 's' : ''} importado${result.count !== 1 ? 's' : ''} correctamente.` })
    setTimeout(() => setImportMsg(null), 4000)
  }

  async function handleAddCliente() {
    const tel = normalizePhone(addTelefono)
    if (!addNombre.trim()) { setAddError('El nombre es obligatorio.'); return }
    if (!isPhoneLike(tel)) { setAddError('Ingrese un teléfono válido (7-15 dígitos).'); return }
    setAddSaving(true)
    setAddError('')
    await window.electronAPI.clientes.create({ telefono: tel, nombre: addNombre.trim() })
    setAddNombre('')
    setAddTelefono('')
    setAddSaving(false)
    setShowAddModal(false)
  }

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC]">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 bg-white border-b border-gray-100 flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-gray-900">Clientes</h1>
          <p className="text-xs text-gray-400">{clientes.length} clientes registrados</p>
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar nombre o teléfono..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 w-56 transition-colors"
          />
        </div>

        <button
          onClick={() => { setShowAddModal(true); setAddError('') }}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={15} />
          Agregar cliente
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.docx,.pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <Upload size={15} />
          {importing ? 'Leyendo...' : 'Importar archivo'}
        </button>
      </div>

      {/* Mensaje de importación */}
      {importMsg && (
        <div className={`mx-6 mt-3 flex items-center justify-between text-sm px-4 py-2.5 rounded-lg ${importMsg.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <span>{importMsg.text}</span>
          <button onClick={() => setImportMsg(null)} className="ml-3 opacity-60 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {clientesFiltrados.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              {busqueda ? 'Sin resultados para esa búsqueda.' : 'No hay clientes registrados aún.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Nombre</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Teléfono</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Origen</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Verificado</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Fecha de alta</th>
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {c.nombre ?? <span className="text-gray-400 font-normal italic">Sin nombre</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-600">{c.telefono}</td>
                    <td className="px-4 py-3">
                      <OrigenBadge origen={c.origen} />
                    </td>
                    <td className="px-4 py-3">
                      {c.verificado ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle size={14} /> Sí
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                          <XCircle size={14} /> No
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {c.fecha_registro
                        ? new Date(c.fecha_registro).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal agregar cliente */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">Agregar cliente</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre</label>
                <input
                  type="text"
                  value={addNombre}
                  onChange={e => setAddNombre(e.target.value)}
                  placeholder="Juan Pérez"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleAddCliente()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono</label>
                <input
                  type="text"
                  value={addTelefono}
                  onChange={e => setAddTelefono(e.target.value)}
                  placeholder="0987654321"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-blue-400 transition-colors"
                  onKeyDown={e => e.key === 'Enter' && handleAddCliente()}
                />
              </div>
              {addError && <p className="text-xs text-red-600">{addError}</p>}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddCliente}
                disabled={addSaving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {addSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview importación */}
      {previewRows && (
        <ContactosPreview
          rows={previewRows}
          onConfirm={handleConfirmImport}
          onCancel={() => setPreviewRows(null)}
          origen="importado"
        />
      )}
    </div>
  )
}

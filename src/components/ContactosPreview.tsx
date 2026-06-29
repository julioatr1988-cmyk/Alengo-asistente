import { useState } from 'react'
import { X, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { ClienteImportRow } from '../types'

interface EditableRow extends ClienteImportRow {
  _id: number
  seleccionado: boolean
  nombreEdit: string
  telefonoEdit: string
}

interface Props {
  rows: ClienteImportRow[]
  onConfirm: (rows: Array<{ telefono: string; nombre: string; origen: string }>) => void
  onCancel: () => void
  origen?: string
}

export function ContactosPreview({ rows, onConfirm, onCancel, origen = 'importado' }: Props) {
  const [editRows, setEditRows] = useState<EditableRow[]>(() =>
    rows.map((r, i) => ({
      ...r,
      _id: i,
      seleccionado: true,
      nombreEdit: r.nombre,
      telefonoEdit: r.telefono,
    }))
  )

  const totalSeleccionados = editRows.filter(r => r.seleccionado).length
  const totalNuevos = editRows.filter(r => r.seleccionado && !r.existe).length
  const totalActualizan = editRows.filter(r => r.seleccionado && r.existe).length

  function toggleTodos() {
    const todosSeleccionados = editRows.every(r => r.seleccionado)
    setEditRows(prev => prev.map(r => ({ ...r, seleccionado: !todosSeleccionados })))
  }

  function toggle(id: number) {
    setEditRows(prev => prev.map(r => r._id === id ? { ...r, seleccionado: !r.seleccionado } : r))
  }

  function updateNombre(id: number, val: string) {
    setEditRows(prev => prev.map(r => r._id === id ? { ...r, nombreEdit: val } : r))
  }

  function updateTelefono(id: number, val: string) {
    setEditRows(prev => prev.map(r => r._id === id ? { ...r, telefonoEdit: val } : r))
  }

  function handleConfirm() {
    const toSave = editRows
      .filter(r => r.seleccionado && r.nombreEdit.trim() && r.telefonoEdit.trim())
      .map(r => ({ telefono: r.telefonoEdit.trim(), nombre: r.nombreEdit.trim(), origen }))
    onConfirm(toSave)
  }

  const todosSeleccionados = editRows.length > 0 && editRows.every(r => r.seleccionado)
  const algunosSeleccionados = editRows.some(r => r.seleccionado) && !todosSeleccionados

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900 text-lg">Vista previa de importación</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {editRows.length} contactos detectados · {totalSeleccionados} seleccionados
              {totalNuevos > 0 && <span className="text-green-600 ml-2">· {totalNuevos} nuevos</span>}
              {totalActualizan > 0 && <span className="text-amber-600 ml-2">· {totalActualizan} actualizarán nombre</span>}
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={todosSeleccionados}
                    ref={el => { if (el) el.indeterminate = algunosSeleccionados }}
                    onChange={toggleTodos}
                    className="rounded border-gray-300 text-blue-600 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Nombre</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Teléfono</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600 w-36">Estado</th>
              </tr>
            </thead>
            <tbody>
              {editRows.map(row => (
                <tr
                  key={row._id}
                  className={`border-b border-gray-50 ${!row.seleccionado ? 'opacity-40' : ''}`}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={row.seleccionado}
                      onChange={() => toggle(row._id)}
                      className="rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.nombreEdit}
                      onChange={e => updateNombre(row._id, e.target.value)}
                      className="w-full border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-2 py-1 text-sm outline-none transition-colors"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={row.telefonoEdit}
                      onChange={e => updateTelefono(row._id, e.target.value)}
                      className="w-full border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-2 py-1 text-sm font-mono outline-none transition-colors"
                    />
                  </td>
                  <td className="px-3 py-2">
                    {row.existe ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                        <AlertCircle size={11} />
                        Actualiza nombre
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">
                        <CheckCircle2 size={11} />
                        Nuevo
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <p className="text-xs text-gray-500">
            {totalSeleccionados === 0
              ? 'Ningún contacto seleccionado'
              : `Se guardarán ${totalSeleccionados} contacto${totalSeleccionados !== 1 ? 's' : ''}`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={totalSeleccionados === 0}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Confirmar importación
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

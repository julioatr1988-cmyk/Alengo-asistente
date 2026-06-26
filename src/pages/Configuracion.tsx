import { useState, useEffect } from 'react'
import { Save, Wifi, WifiOff, RefreshCw, QrCode, AlertCircle, CheckCircle, ShieldCheck, ImagePlus, Trash2, Plus, Pencil, X } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import type { Empresa, FacebookStatus, FacebookPage, RutaConfig, Cliente, FAQ, WhatsAppGroup, TarifaEncomienda, TarifaZona, TarifaEncTamano } from '../types'

type ConnectState = 'idle' | 'connecting' | 'waiting_qr' | 'connected'

export function Configuracion() {
  const { empresa, setEmpresa, whatsappStatus, setWhatsappStatus, licencia, licenciaDiasRestantes } = useAppStore()
  const [form, setForm]                   = useState<Partial<Empresa>>({})
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)
  const [qr, setQr]                       = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [waError, setWaError]             = useState<string | null>(null)
  const [connectState, setConnectState]   = useState<ConnectState>(
    whatsappStatus.connected ? 'connected' : 'idle'
  )

  // Facebook / Messenger state
  const [fbStatus,  setFbStatus]  = useState<FacebookStatus>({ connected: false, pageName: null, pageId: null })
  const [fbLoading, setFbLoading] = useState(false)
  const [fbError,   setFbError]   = useState<string | null>(null)
  const [fbPages,   setFbPages]   = useState<FacebookPage[] | null>(null)

  useEffect(() => {
    if (empresa) setForm(empresa)
  }, [empresa])

  useEffect(() => {
    setConnectState(whatsappStatus.connected ? 'connected' : 'idle')
  }, [whatsappStatus.connected])

  useEffect(() => {
    if (!window.electronAPI) return

    // WhatsApp listeners
    window.electronAPI.whatsapp.onQR((qrData) => {
      setQr(qrData)
      setWaError(null)
      setConnectState('waiting_qr')
    })

    window.electronAPI.whatsapp.onConnected((data) => {
      setQr(null)
      setWaError(null)
      setConnectState('connected')
      setWhatsappStatus({ connected: true, phone: data.phone })
    })

    window.electronAPI.whatsapp.onStatus((status) => {
      const s = status as typeof whatsappStatus
      setWhatsappStatus(s)
      if (!s.connected) setConnectState('idle')
    })

    window.electronAPI.whatsapp.onError((err) => {
      setWaError(err)
      setConnectState('idle')
    })

    // Leer estado inicial de Facebook
    window.electronAPI.facebook.status().then(setFbStatus)

    return () => {
      window.electronAPI.whatsapp.removeListeners()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handlers WhatsApp ─────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    const updated = await window.electronAPI.empresa.update(form)
    setEmpresa(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setSaving(false)
  }

  const handleConnect = async () => {
    setConnectState('connecting')
    setQr(null)
    setWaError(null)
    await window.electronAPI.whatsapp.connect()
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    await window.electronAPI.whatsapp.disconnect()
    setWhatsappStatus({ connected: false, phone: null })
    setQr(null)
    setConnectState('idle')
    setDisconnecting(false)
  }

  // ── Handlers Facebook ─────────────────────────────────────────────────────
  const handleFbLogin = async () => {
    setFbLoading(true)
    setFbError(null)
    setFbPages(null)

    const result = await window.electronAPI.facebook.login()

    if (result.success === true && 'pageName' in result) {
      // Auto-seleccionó la única página
      setFbStatus({ connected: true, pageName: result.pageName, pageId: result.pageId })
      const updated = await window.electronAPI.empresa.get()
      setEmpresa(updated)
    } else if (result.success === true && 'pages' in result) {
      // Múltiples páginas — mostrar selector
      setFbPages(result.pages)
    } else if (!result.success && 'noPage' in result) {
      setFbError('noPage')
    } else if (!result.success && 'cancelled' in result) {
      // usuario cerró la ventana — no mostrar error
    } else if (!result.success && 'error' in result) {
      setFbError(result.error)
    }

    setFbLoading(false)
  }

  const handleFbSelectPage = async (page: FacebookPage) => {
    setFbLoading(true)
    await window.electronAPI.facebook.selectPage(page.access_token, page.name, page.id)
    setFbStatus({ connected: true, pageName: page.name, pageId: page.id })
    setFbPages(null)
    const updated = await window.electronAPI.empresa.get()
    setEmpresa(updated)
    setFbLoading(false)
  }

  const handleFbLogout = async () => {
    await window.electronAPI.facebook.logout()
    setFbStatus({ connected: false, pageName: null, pageId: null })
    setFbError(null)
    setFbPages(null)
  }

  const [logoLoading, setLogoLoading] = useState(false)

  // Tarifas y Horarios state
  const [rutasConfig, setRutasConfig]     = useState<RutaConfig[]>([])
  const [tarifaEdits, setTarifaEdits]     = useState<Record<number, { precio: string; horarios: string; duracion_horas: string }>>({})
  const [tarifaSaving, setTarifaSaving]   = useState<number | null>(null)
  const [tarifaSaved, setTarifaSaved]     = useState<number | null>(null)

  // Grupos WA
  const [grupos, setGrupos]               = useState<WhatsAppGroup[]>([])

  useEffect(() => {
    if (!window.electronAPI?.whatsapp || !whatsappStatus.connected) return
    window.electronAPI.whatsapp.getGroups().then(g => setGrupos(g))
    window.electronAPI.whatsapp.onGrupos(g => setGrupos(g as WhatsAppGroup[]))
  }, [whatsappStatus.connected])

  // Clientes state
  const [clientes, setClientes]           = useState<Cliente[]>([])

  // Tarifas Encomiendas state
  const [tarifasEnc, setTarifasEnc]       = useState<TarifaEncomienda[]>([])
  const [tarifasEncEdits, setTarifasEncEdits] = useState<Record<string, { precio: string; recargo: string }>>({})
  const [tarifasEncSaving, setTarifasEncSaving] = useState<string | null>(null)
  const [tarifasEncSaved, setTarifasEncSaved]   = useState<string | null>(null)

  // Tarifas Zonas state
  const [tarifasZonas, setTarifasZonas]   = useState<TarifaZona[]>([])
  const [zonaEdits, setZonaEdits]         = useState<Record<string, string>>({})
  const [zonaSaving, setZonaSaving]       = useState<string | null>(null)
  const [tarifasEncTam, setTarifasEncTam] = useState<TarifaEncTamano[]>([])
  const [tamEdits, setTamEdits]           = useState<Record<number, string>>({})
  const [tamSaving, setTamSaving]         = useState<number | null>(null)

  // Preguntas Frecuentes state
  const [faqList, setFaqList]             = useState<FAQ[]>([])
  const [faqEdit, setFaqEdit]             = useState<{ id: number | null; pregunta: string; respuesta: string } | null>(null)
  const [faqSaving, setFaqSaving]         = useState(false)

  useEffect(() => {
    if (!window.electronAPI?.rutasConfig) return
    window.electronAPI.rutasConfig.get().then(rows => {
      setRutasConfig(rows)
      const edits: Record<number, { precio: string; horarios: string; duracion_horas: string }> = {}
      for (const r of rows) {
        const hrs: string[] = JSON.parse(r.horarios || '[]')
        edits[r.ruta_id] = {
          precio: String(r.precio),
          horarios: hrs.join('\n'),
          duracion_horas: String(r.duracion_horas ?? 3),
        }
      }
      setTarifaEdits(edits)
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.clientes) return
    window.electronAPI.clientes.get().then(rows => setClientes(rows))
    window.electronAPI.clientes.onUpdated(() => {
      window.electronAPI.clientes.get().then(rows => setClientes(rows))
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.tarifasEncomiendas) return
    window.electronAPI.tarifasEncomiendas.get().then(rows => {
      setTarifasEnc(rows)
      const edits: Record<string, { precio: string; recargo: string }> = {}
      for (const t of rows) edits[t.destino] = { precio: String(t.precio_base), recargo: String(t.recargo_por_kg) }
      setTarifasEncEdits(edits)
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.tarifasZonas) return
    window.electronAPI.tarifasZonas.get().then(rows => {
      setTarifasZonas(rows)
      const edits: Record<string, string> = {}
      for (const z of rows) edits[`${z.ciudad}-${z.zona}-${z.tipo}`] = String(z.recargo)
      setZonaEdits(edits)
    })
    window.electronAPI.tarifasEncTamanos.get().then(rows => {
      setTarifasEncTam(rows)
      const edits: Record<number, string> = {}
      for (const t of rows) edits[t.id] = String(t.precio)
      setTamEdits(edits)
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.faq) return
    window.electronAPI.faq.get().then(rows => setFaqList(rows))
  }, [])

  const handleFaqSave = async () => {
    if (!faqEdit) return
    const p = faqEdit.pregunta.trim()
    const r = faqEdit.respuesta.trim()
    if (!p || !r) return
    setFaqSaving(true)
    if (faqEdit.id) {
      await window.electronAPI.faq.update(faqEdit.id, p, r)
    } else {
      await window.electronAPI.faq.create(p, r)
    }
    const rows = await window.electronAPI.faq.get()
    setFaqList(rows)
    setFaqEdit(null)
    setFaqSaving(false)
  }

  const handleFaqDelete = async (id: number) => {
    await window.electronAPI.faq.delete(id)
    setFaqList(prev => prev.filter(f => f.id !== id))
  }

  const handleSaveTarifa = async (ruta: RutaConfig) => {
    const ed = tarifaEdits[ruta.ruta_id]
    if (!ed) return
    setTarifaSaving(ruta.ruta_id)
    const precio       = parseFloat(ed.precio) || 0
    const horarios     = ed.horarios.split('\n').map(h => h.trim()).filter(Boolean)
    const duracionHoras = parseFloat(ed.duracion_horas) || 3
    await window.electronAPI.rutasConfig.update(ruta.ruta_id, precio, horarios, duracionHoras)
    setTarifaSaving(null)
    setTarifaSaved(ruta.ruta_id)
    setTimeout(() => setTarifaSaved(null), 1500)
  }

  const handleSaveTarifaEnc = async (destino: string) => {
    const ed = tarifasEncEdits[destino]
    if (!ed) return
    setTarifasEncSaving(destino)
    await window.electronAPI.tarifasEncomiendas.upsert(destino, parseFloat(ed.precio) || 0, parseFloat(ed.recargo) || 0)
    const rows = await window.electronAPI.tarifasEncomiendas.get()
    setTarifasEnc(rows)
    setTarifasEncSaving(null)
    setTarifasEncSaved(destino)
    setTimeout(() => setTarifasEncSaved(null), 1500)
  }

  const handleSaveZona = async (zona: TarifaZona) => {
    const key = `${zona.ciudad}-${zona.zona}-${zona.tipo}`
    const recargo = parseFloat(zonaEdits[key] ?? String(zona.recargo)) || 0
    setZonaSaving(key)
    await window.electronAPI.tarifasZonas.upsert(zona.ciudad, zona.zona, zona.tipo, recargo)
    const rows = await window.electronAPI.tarifasZonas.get()
    setTarifasZonas(rows)
    setZonaSaving(null)
  }

  const handleSaveTam = async (tam: TarifaEncTamano) => {
    const precio = parseFloat(tamEdits[tam.id] ?? String(tam.precio)) || 0
    setTamSaving(tam.id)
    await window.electronAPI.tarifasEncTamanos.upsert(tam.id, tam.descripcion, precio)
    const rows = await window.electronAPI.tarifasEncTamanos.get()
    setTarifasEncTam(rows)
    setTamSaving(null)
  }

  const handleSelectLogo = async () => {
    setLogoLoading(true)
    const result = await window.electronAPI.empresa.selectLogo()
    if (result.success && result.logo) {
      setForm(prev => ({ ...prev, logo: result.logo }))
      const updated = await window.electronAPI.empresa.get()
      setEmpresa(updated)
    }
    setLogoLoading(false)
  }

  const handleRemoveLogo = async () => {
    await window.electronAPI.empresa.removeLogo()
    setForm(prev => ({ ...prev, logo: undefined }))
    const updated = await window.electronAPI.empresa.get()
    setEmpresa(updated)
  }

  const f = (k: keyof Empresa, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">

      {/* Datos de empresa */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Datos de la empresa</h2>

        {/* Logo */}
        <div className="mb-4">
          <label className="label">Logo de la empresa</label>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center bg-gray-50 flex-shrink-0 overflow-hidden">
              {form.logo
                ? <img src={form.logo} alt="Logo" className="w-full h-full object-contain" />
                : <span className="text-gray-300 text-2xl font-bold">{(form.nombre ?? 'A')[0]?.toUpperCase()}</span>
              }
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSelectLogo}
                disabled={logoLoading}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <ImagePlus size={14} />
                {logoLoading ? 'Cargando...' : 'Cambiar logo'}
              </button>
              {form.logo && (
                <button
                  onClick={handleRemoveLogo}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 size={14} />
                  Quitar
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">PNG, JPG o SVG. Aparecerá en el sidebar y en los reportes.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Nombre de la empresa</label>
            <input className="input" value={form.nombre ?? ''} onChange={e => f('nombre', e.target.value)} />
          </div>
          <div>
            <label className="label">Teléfono principal</label>
            <input className="input" value={form.telefono ?? ''} onChange={e => f('telefono', e.target.value)} placeholder="0999999999" />
          </div>
          <div>
            <label className="label">Número WhatsApp</label>
            <input className="input" value={form.whatsapp_numero ?? ''} onChange={e => f('whatsapp_numero', e.target.value)} placeholder="593999999999" />
          </div>
          <div>
            <label className="label">Tarifa mensual por chofer $</label>
            <input type="number" className="input" value={form.tarifa_mensual ?? 50} onChange={e => f('tarifa_mensual', parseFloat(e.target.value))} />
          </div>
          <div>
            <label className="label">Cupo máximo por vehículo</label>
            <input type="number" min="1" max="4" className="input" value={form.cupo_maximo ?? 3}
              onChange={e => f('cupo_maximo', parseInt(e.target.value))} />
            <p className="text-xs text-gray-400 mt-1">Pasajeros máximos por turno antes de asignar el siguiente chofer (1–4)</p>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary mt-4 flex items-center gap-2">
          <Save size={15} /> {saved ? '¡Guardado!' : saving ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>

      {/* Grupos WhatsApp */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Grupos de WhatsApp</h2>
        <p className="text-sm text-gray-500 mb-4">
          Formato: <code className="bg-gray-100 px-1 rounded">1234567890-1234567890@g.us</code>
        </p>
        <div>
          <label className="label">Grupo Operativo General</label>
          {grupos.length > 0 ? (
            <select
              className="input"
              value={form.grupo_operativo_id ?? ''}
              onChange={e => f('grupo_operativo_id', e.target.value)}
            >
              <option value="">— Seleccionar grupo —</option>
              {grupos.map(g => (
                <option key={g.jid} value={g.jid}>{g.name}</option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={form.grupo_operativo_id ?? ''}
              onChange={e => f('grupo_operativo_id', e.target.value)}
              placeholder="Conecta WhatsApp para ver grupos disponibles"
            />
          )}
          <p className="text-xs text-gray-400 mt-1">A este grupo se envía el mensaje de turnos actualizado.</p>
        </div>
        <button onClick={handleSave} disabled={saving} className="btn-primary mt-4 flex items-center gap-2">
          <Save size={15} /> Guardar grupos
        </button>
      </div>

      {/* Tarifas y Horarios */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Tarifas y Horarios</h2>
        <p className="text-xs text-gray-400 mb-4">El bot usará estos precios y horarios al responder clientes.</p>
        <div className="space-y-4">
          {rutasConfig.map(ruta => {
            const ed = tarifaEdits[ruta.ruta_id] ?? { precio: String(ruta.precio), horarios: '', duracion_horas: '3' }
            const isSaving = tarifaSaving === ruta.ruta_id
            const isSaved  = tarifaSaved  === ruta.ruta_id
            return (
              <div key={ruta.ruta_id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-medium text-sm text-gray-900">{ruta.nombre}</p>
                    <p className="text-xs text-gray-400 font-mono">{ruta.codigo}</p>
                  </div>
                  <button
                    onClick={() => handleSaveTarifa(ruta)}
                    disabled={isSaving}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isSaved
                        ? 'bg-green-100 text-green-700'
                        : 'btn-primary'
                    }`}
                  >
                    <Save size={12} />
                    {isSaved ? '¡Guardado!' : isSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Precio por pasajero ($)</label>
                    <input
                      type="number" step="0.5" min="0" className="input"
                      value={ed.precio}
                      onChange={e => setTarifaEdits(prev => ({
                        ...prev, [ruta.ruta_id]: { ...ed, precio: e.target.value }
                      }))}
                    />
                  </div>
                  <div>
                    <label className="label">Duración del viaje (horas)</label>
                    <input
                      type="number" step="0.5" min="0.5" max="24" className="input"
                      value={ed.duracion_horas}
                      onChange={e => setTarifaEdits(prev => ({
                        ...prev, [ruta.ruta_id]: { ...ed, duracion_horas: e.target.value }
                      }))}
                    />
                  </div>
                  <div>
                    <label className="label flex items-center justify-between">
                      <span>Horarios de salida</span>
                      <span className="font-normal text-gray-400">(uno por línea)</span>
                    </label>
                    <textarea
                      className="input resize-none font-mono text-xs h-24"
                      placeholder={'06:00\n09:00\n12:00\n15:00\n18:00'}
                      value={ed.horarios}
                      onChange={e => setTarifaEdits(prev => ({
                        ...prev, [ruta.ruta_id]: { ...ed, horarios: e.target.value }
                      }))}
                    />
                  </div>
                </div>
              </div>
            )
          })}
          {rutasConfig.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Cargando rutas...</p>
          )}
        </div>
      </div>

      {/* Conexión WhatsApp */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-4">Conexión WhatsApp</h2>

        {connectState === 'connected' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
              <Wifi className="text-secondary" size={24} />
              <div>
                <p className="font-semibold text-green-800">Conectado ✓</p>
                <p className="text-sm text-green-700">
                  Número: {whatsappStatus.phone ? `+${whatsappStatus.phone}` : 'Conectado'}
                </p>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm disabled:opacity-50"
            >
              <WifiOff size={15} />
              {disconnecting ? 'Desconectando...' : 'Cerrar sesión WhatsApp'}
            </button>
          </div>

        ) : connectState === 'connecting' ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <p className="text-sm text-gray-500 font-medium">Iniciando conexión con WhatsApp...</p>
            <p className="text-xs text-gray-400">Espera mientras se genera el código QR</p>
          </div>

        ) : connectState === 'waiting_qr' && qr ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-200">
              <QrCode className="text-blue-500 flex-shrink-0" size={20} />
              <p className="text-sm text-blue-700">
                Abre WhatsApp → <strong>Dispositivos vinculados</strong> → <strong>Vincular dispositivo</strong>
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-gray-200 rounded-xl">
              <div className="bg-white p-3 rounded-xl shadow-md border border-gray-100">
                <img src={qr} alt="Código QR WhatsApp" className="w-56 h-56" />
              </div>
              <p className="text-xs text-gray-400">El código expira en 60 segundos · se actualizará automáticamente</p>
              <button onClick={handleConnect} className="text-xs text-gray-500 hover:text-primary underline">
                Generar nuevo código
              </button>
            </div>
          </div>

        ) : (
          <div className="space-y-4">
            {waError ? (
              <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
                <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={20} />
                <div>
                  <p className="font-semibold text-red-800">Error al conectar</p>
                  <p className="text-sm text-red-700 mt-1">{waError}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-xl border border-amber-200">
                <WifiOff className="text-amber-500" size={24} />
                <div>
                  <p className="font-semibold text-amber-800">WhatsApp no conectado</p>
                  <p className="text-sm text-amber-700">Haz clic en "Conectar" para vincular tu número.</p>
                </div>
              </div>
            )}
            <div className="flex flex-col items-center gap-3 p-8 border-2 border-dashed border-gray-200 rounded-xl">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                <RefreshCw size={28} className="text-gray-300" />
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600 font-medium mb-1">Vincula tu WhatsApp</p>
                <p className="text-xs text-gray-400">El QR aparecerá aquí. Escanéalo con tu teléfono.</p>
              </div>
              <button onClick={handleConnect} className="btn-primary flex items-center gap-2 mt-2">
                <QrCode size={16} />
                Conectar WhatsApp
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mensajes de Facebook */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          {/* Ícono "f" de Facebook en azul */}
          <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold leading-none">f</span>
          </div>
          <h2 className="font-semibold text-gray-900">Mensajes de Facebook</h2>
          {fbStatus.connected && (
            <span className="ml-auto flex items-center gap-1.5 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Activo
            </span>
          )}
        </div>

        {/* ── CONECTADO ─────────────────────────────────────────────────── */}
        {fbStatus.connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-xl border border-blue-200">
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white font-bold">f</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-blue-900">Conectado</p>
                <p className="text-sm text-blue-700 truncate">{fbStatus.pageName}</p>
              </div>
              <CheckCircle size={18} className="text-blue-500 flex-shrink-0" />
            </div>
            <p className="text-xs text-gray-500">
              Los mensajes de esta página aparecen en la pantalla Chat con etiqueta azul "FB". Se revisan cada 30 segundos.
            </p>
            <button
              onClick={handleFbLogout}
              className="flex items-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors text-sm"
            >
              Desconectar Facebook
            </button>
          </div>

        /* ── SELECCIÓN DE PÁGINA (múltiples páginas) ──────────────────── */
        ) : fbPages ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-700">
              Tu cuenta tiene {fbPages.length} páginas. ¿Con cuál quieres recibir mensajes?
            </p>
            {fbPages.map(page => (
              <button
                key={page.id}
                onClick={() => handleFbSelectPage(page)}
                disabled={fbLoading}
                className="w-full flex items-center gap-3 p-3 border border-blue-200 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors text-left disabled:opacity-50"
              >
                <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-white font-bold text-sm">f</span>
                </div>
                <span className="text-sm font-medium text-blue-900">{page.name}</span>
              </button>
            ))}
            <button onClick={() => setFbPages(null)} className="text-xs text-gray-400 underline">
              Cancelar
            </button>
          </div>

        /* ── NO CONECTADO ─────────────────────────────────────────────── */
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Conecta tu página de Facebook para recibir y responder mensajes desde esta misma app, sin configuraciones técnicas.
            </p>

            {/* Sin página de negocio */}
            {fbError === 'noPage' && (
              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  No tienes páginas de negocio
                </p>
                <p className="text-sm text-amber-700 mb-3">
                  Para recibir mensajes de Facebook necesitas una <strong>Página de negocio</strong>, no un perfil personal.
                  ¿Quieres que te ayudemos a crearla?
                </p>
                <button
                  onClick={() => window.electronAPI.shell.openExternal('https://www.facebook.com/pages/create')}
                  className="text-sm text-blue-600 font-medium underline hover:text-blue-700"
                >
                  Crear página de negocio en Facebook →
                </button>
              </div>
            )}

            {/* Error genérico */}
            {fbError && fbError !== 'noPage' && (
              <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{fbError}</p>
              </div>
            )}

            <button
              onClick={handleFbLogin}
              disabled={fbLoading}
              className="w-full flex items-center justify-center gap-3 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 active:bg-blue-800 transition-colors font-medium text-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-xs">f</span>
              </div>
              {fbLoading ? 'Abriendo ventana de Facebook...' : 'Conectar con Facebook'}
            </button>

            <p className="text-xs text-gray-400 text-center">
              Se abrirá una ventana para iniciar sesión en tu cuenta de Facebook de forma segura.
            </p>
          </div>
        )}
      </div>

      {/* Tarifas Encomiendas */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Tarifas de Encomiendas</h2>
        <p className="text-xs text-gray-400 mb-4">El bot usará estos precios al informar sobre envío de encomiendas.</p>
        <div className="space-y-3">
          {tarifasEnc.map(t => {
            const ed = tarifasEncEdits[t.destino] ?? { precio: String(t.precio_base), recargo: String(t.recargo_por_kg) }
            const isSaving = tarifasEncSaving === t.destino
            const isSaved  = tarifasEncSaved === t.destino
            return (
              <div key={t.destino} className="grid grid-cols-4 gap-3 items-end">
                <div>
                  <label className="label">{t.destino}</label>
                </div>
                <div>
                  <label className="label text-xs">Precio base $</label>
                  <input type="number" min="0" step="0.5" className="input"
                    value={ed.precio}
                    onChange={e => setTarifasEncEdits(prev => ({ ...prev, [t.destino]: { ...ed, precio: e.target.value } }))} />
                </div>
                <div>
                  <label className="label text-xs">Recargo por kg $</label>
                  <input type="number" min="0" step="0.5" className="input"
                    value={ed.recargo}
                    onChange={e => setTarifasEncEdits(prev => ({ ...prev, [t.destino]: { ...ed, recargo: e.target.value } }))} />
                </div>
                <div>
                  <button
                    onClick={() => handleSaveTarifaEnc(t.destino)}
                    disabled={isSaving}
                    className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors ${
                      isSaved ? 'bg-green-100 text-green-700' : 'btn-primary'
                    }`}
                  >
                    <Save size={13} />
                    {isSaved ? 'Guardado' : isSaving ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </div>
            )
          })}
          {tarifasEnc.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Sin tarifas configuradas</p>
          )}
        </div>
      </div>

      {/* Tarifas por Zona */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Tarifas por Zona</h2>
        <p className="text-xs text-gray-400 mb-4">El bot usará estos precios según el sector de destino en Quito o Santo Domingo.</p>

        {/* Pasajeros */}
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Pasajeros</h3>
          {['QUITO', 'SANTO DOMINGO'].map(ciudad => {
            const zonas = tarifasZonas.filter(z => z.ciudad === ciudad && z.tipo === 'pasajero')
            if (zonas.length === 0) return null
            return (
              <div key={ciudad} className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-2">{ciudad}</p>
                <div className="space-y-2">
                  {zonas.map(z => {
                    const key = `${z.ciudad}-${z.zona}-${z.tipo}`
                    const isSaving = zonaSaving === key
                    return (
                      <div key={key} className="grid grid-cols-4 gap-3 items-end">
                        <div className="col-span-2">
                          <label className="label text-xs">{z.zona}</label>
                        </div>
                        <div>
                          <label className="label text-xs">Precio $</label>
                          <input type="number" min="0" step="1" className="input"
                            value={zonaEdits[key] ?? String(z.recargo)}
                            onChange={e => setZonaEdits(prev => ({ ...prev, [key]: e.target.value }))} />
                        </div>
                        <div>
                          <button
                            onClick={() => handleSaveZona(z)}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg btn-primary"
                          >
                            <Save size={13} />
                            {isSaving ? 'Guardando...' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Encomiendas */}
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Encomiendas — Recargo por zona</h3>
          {['QUITO', 'SANTO DOMINGO'].map(ciudad => {
            const zonas = tarifasZonas.filter(z => z.ciudad === ciudad && z.tipo === 'encomienda')
            if (zonas.length === 0) return null
            return (
              <div key={ciudad} className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-2">{ciudad}</p>
                <div className="space-y-2">
                  {zonas.map(z => {
                    const key = `${z.ciudad}-${z.zona}-${z.tipo}`
                    const isSaving = zonaSaving === key
                    return (
                      <div key={key} className="grid grid-cols-4 gap-3 items-end">
                        <div className="col-span-2">
                          <label className="label text-xs">{z.zona}</label>
                        </div>
                        <div>
                          <label className="label text-xs">Recargo $</label>
                          <input type="number" min="0" step="1" className="input"
                            value={zonaEdits[key] ?? String(z.recargo)}
                            onChange={e => setZonaEdits(prev => ({ ...prev, [key]: e.target.value }))} />
                        </div>
                        <div>
                          <button
                            onClick={() => handleSaveZona(z)}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg btn-primary"
                          >
                            <Save size={13} />
                            {isSaving ? 'Guardando...' : 'Guardar'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Tamaños de encomienda */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Tamaños de encomienda</h3>
          <div className="space-y-2">
            {tarifasEncTam.map(t => {
              const isSaving = tamSaving === t.id
              return (
                <div key={t.id} className="grid grid-cols-4 gap-3 items-end">
                  <div className="col-span-2">
                    <label className="label text-xs">{t.descripcion}</label>
                  </div>
                  <div>
                    <label className="label text-xs">Precio $</label>
                    <input type="number" min="0" step="0.5" className="input"
                      value={tamEdits[t.id] ?? String(t.precio)}
                      onChange={e => setTamEdits(prev => ({ ...prev, [t.id]: e.target.value }))} />
                  </div>
                  <div>
                    <button
                      onClick={() => handleSaveTam(t)}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg btn-primary"
                    >
                      <Save size={13} />
                      {isSaving ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                </div>
              )
            })}
            {tarifasEncTam.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Sin tamaños configurados</p>
            )}
          </div>
        </div>
      </div>

      {/* Preguntas Frecuentes del Bot */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-900">Preguntas Frecuentes del Bot</h2>
          <button
            onClick={() => setFaqEdit({ id: null, pregunta: '', respuesta: '' })}
            className="flex items-center gap-1.5 text-xs btn-primary px-3 py-1.5"
          >
            <Plus size={13} /> Agregar
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-4">El bot responderá automáticamente estas preguntas antes de procesar cualquier flujo.</p>

        {/* Formulario inline */}
        {faqEdit && (
          <div className="mb-4 border border-primary/30 rounded-xl p-4 bg-primary/5 space-y-3">
            <div>
              <label className="label">Palabra o frase clave (el bot la buscará en el mensaje del cliente)</label>
              <input
                className="input mt-1"
                placeholder='ej: "puerta a puerta", "precio encomienda", "viaje nocturno"'
                value={faqEdit.pregunta}
                onChange={e => setFaqEdit(prev => prev ? { ...prev, pregunta: e.target.value } : null)}
              />
            </div>
            <div>
              <label className="label">Respuesta del bot</label>
              <textarea
                className="input resize-none h-20 mt-1"
                placeholder="Respuesta completa que dará el bot..."
                value={faqEdit.respuesta}
                onChange={e => setFaqEdit(prev => prev ? { ...prev, respuesta: e.target.value } : null)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setFaqEdit(null)} className="btn-ghost text-xs"><X size={13} /> Cancelar</button>
              <button onClick={handleFaqSave} disabled={faqSaving} className="btn-primary text-xs flex items-center gap-1.5">
                <Save size={13} /> {faqSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        )}

        {faqList.length === 0 && !faqEdit ? (
          <p className="text-sm text-gray-400 text-center py-4">Sin preguntas frecuentes aún. Agrega una para que el bot las responda automáticamente.</p>
        ) : (
          <div className="space-y-2">
            {faqList.map(faq => (
              <div key={faq.id} className="border border-gray-200 rounded-xl p-3 flex gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-primary truncate">"{faq.pregunta_clave}"</p>
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{faq.respuesta}</p>
                </div>
                <div className="flex items-start gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => setFaqEdit({ id: faq.id, pregunta: faq.pregunta_clave, respuesta: faq.respuesta })}
                    className="p-1.5 text-gray-400 hover:text-primary rounded-lg hover:bg-gray-100 transition-colors"
                  ><Pencil size={13} /></button>
                  <button
                    onClick={() => handleFaqDelete(faq.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                  ><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clientes verificados */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-1">Clientes verificados</h2>
        <p className="text-xs text-gray-400 mb-4">Clientes que el bot ha registrado. Los verificados han enviado su foto selfie.</p>
        {clientes.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Sin clientes registrados aún</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Teléfono</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Nombre</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Estado</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium">Registro</th>
                  <th className="py-2 px-2 text-gray-500 font-medium">Foto</th>
                </tr>
              </thead>
              <tbody>
                {clientes.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-2 font-mono">{c.telefono}</td>
                    <td className="py-2 px-2">{c.nombre ?? '—'}</td>
                    <td className="py-2 px-2">
                      {c.verificado
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ Verificado</span>
                        : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⏳ Pendiente</span>
                      }
                    </td>
                    <td className="py-2 px-2 text-gray-400">{c.fecha_registro?.slice(0, 16) ?? '—'}</td>
                    <td className="py-2 px-2 text-center">
                      {c.foto_verificacion ? (
                        <button
                          className="text-primary hover:underline text-xs"
                          onClick={() => window.electronAPI.shell.openPath(c.foto_verificacion!)}
                        >
                          Ver foto
                        </button>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Licencia */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={18} className="text-[#0F1E3C]" />
          <h2 className="font-semibold text-gray-900">Licencia</h2>
        </div>

        {licencia ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 font-medium mb-0.5">Empresa licenciada</p>
                <p className="font-semibold text-gray-900">{licencia.empresa}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-0.5">Plan</p>
                  <p className="font-semibold text-gray-900">
                    {licencia.plan === '6m' ? '6 meses' : '1 año'}
                  </p>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  licencia.plan === '6m' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                }`}>
                  {licencia.plan === '6m' ? '6M' : '1Y'}
                </span>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 font-medium mb-0.5">Clave</p>
                <p className="font-mono text-xs text-gray-600 tracking-wider">{licencia.clave}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-400 font-medium mb-0.5">Activada el</p>
                <p className="font-medium text-gray-700">{licencia.fecha_activacion}</p>
              </div>
              <div className={`rounded-xl p-3 ${
                licenciaDiasRestantes === null || licenciaDiasRestantes > 30
                  ? 'bg-green-50'
                  : licenciaDiasRestantes > 7
                  ? 'bg-amber-50'
                  : 'bg-red-50'
              }`}>
                <p className="text-xs font-medium mb-0.5 text-gray-400">Válida hasta</p>
                <p className={`font-semibold text-sm ${
                  licenciaDiasRestantes === null || licenciaDiasRestantes > 30
                    ? 'text-green-800'
                    : licenciaDiasRestantes > 7
                    ? 'text-amber-800'
                    : 'text-red-700'
                }`}>
                  {licencia.fecha_vencimiento}
                  {licenciaDiasRestantes !== null && (
                    <span className="font-normal text-xs ml-1">
                      ({licenciaDiasRestantes > 0
                        ? `${licenciaDiasRestantes} días restantes`
                        : 'Vencida'})
                    </span>
                  )}
                </p>
              </div>
            </div>

            {licenciaDiasRestantes !== null && licenciaDiasRestantes <= 30 && (
              <button
                onClick={() => window.electronAPI.shell.openExternal('https://alengoapp.com')}
                className="w-full py-2.5 border border-[#0F1E3C] text-[#0F1E3C] rounded-xl text-sm font-semibold hover:bg-[#0F1E3C] hover:text-white transition-colors"
              >
                Renovar licencia →
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No hay licencia activa.</p>
        )}
      </div>

      {/* Sobre la app */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 mb-2">Acerca de</h2>
        <div className="text-sm text-gray-500 space-y-1">
          <p><strong>Alengo Asistente Virtual</strong> v1.1.0</p>
          <p>Sistema de gestión para call centers de transporte interprovincial.</p>
          <p className="text-xs text-gray-400 mt-2">© 2025 Alengo. Todos los derechos reservados.</p>
        </div>
      </div>

    </div>
  )
}

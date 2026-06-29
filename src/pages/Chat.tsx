import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, MessageSquare, Wifi, WifiOff, Search, Phone, X,
  MoreVertical, Check, CheckCheck, Bot, User, FlaskConical,
  RefreshCw, RotateCcw,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAppStore } from '../store/useAppStore'
import type { MensajeWA, Canal, BotModo } from '../types'

const RESPUESTAS_RAPIDAS = [
  'Sí hay disponibilidad, un momento por favor.',
  'No hay disponibilidad para esa hora. ¿Le interesa otro horario?',
  'Su viaje ha sido confirmado. ✓',
  'Le estamos asignando un chofer, en breve le confirmamos.',
  'Gracias por comunicarse con nosotros.',
  'El servicio tiene un costo de $5.00 desde Santo Domingo a Quito.',
  'Nuestro horario de atención es de 06:00 a 20:00.',
]

interface Conversacion {
  jid: string
  contacto: string
  telefono: string
  mensajes: MensajeWA[]
  noLeidos: number
  ultimaFecha: string
  canal: Canal
  messenger_psid?: string
}

interface TestMsg {
  id: number
  texto: string
  tipo: 'entrada' | 'salida'
}

function formatFechaConv(fecha: string) {
  const d = new Date(fecha)
  if (isToday(d))     return format(d, 'HH:mm')
  if (isYesterday(d)) return 'Ayer'
  return format(d, 'd MMM', { locale: es })
}

function formatFechaMsg(fecha: string) {
  return format(new Date(fecha), 'HH:mm')
}

const CONV_DEMO: Conversacion[] = [
  {
    jid: 'demo1', canal: 'whatsapp',
    contacto: 'María García', telefono: '0991234567', noLeidos: 2,
    ultimaFecha: new Date().toISOString(),
    mensajes: [
      { id: 1, contacto: 'María García', telefono: '0991234567', mensaje: 'Buenos días, necesito un viaje a Quito para mañana a las 8am.', fecha: new Date(Date.now() - 120000).toISOString(), tipo: 'entrante', procesado: 0, jid: 'demo1', canal: 'whatsapp' },
      { id: 2, contacto: 'Operadora', telefono: '', mensaje: 'Hola! Soy el asistente. Con gusto te ayudo a reservar tu viaje.', fecha: new Date(Date.now() - 60000).toISOString(), tipo: 'saliente', procesado: 1, jid: 'demo1', canal: 'whatsapp' },
    ],
  },
  {
    jid: 'demo2', canal: 'whatsapp',
    contacto: 'Carlos Mendoza', telefono: '0987654321', noLeidos: 0,
    ultimaFecha: new Date(Date.now() - 3600000).toISOString(),
    mensajes: [
      { id: 5, contacto: 'Carlos Mendoza', telefono: '0987654321', mensaje: 'Quiero enviar una encomienda a Guayaquil.', fecha: new Date(Date.now() - 7200000).toISOString(), tipo: 'entrante', procesado: 1, jid: 'demo2', canal: 'whatsapp' },
      { id: 6, contacto: 'Operadora', telefono: '', mensaje: 'El costo a Guayaquil es de $6.00. ¿Cuándo desea enviarlo?', fecha: new Date(Date.now() - 3600000).toISOString(), tipo: 'saliente', procesado: 1, jid: 'demo2', canal: 'whatsapp' },
    ],
  },
]

function CanalBadge({ canal, jid }: { canal?: Canal; jid?: string }) {
  if (canal === 'messenger') {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-600 text-white leading-none">FB</span>
  }
  if (jid?.endsWith('@g.us')) {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white leading-none">GRP</span>
  }
  return null
}

// ── Modal de prueba de bot ────────────────────────────────────────────────────

function BotTestModal({ onClose }: { onClose: () => void }) {
  const [mensajes, setMensajes]   = useState<TestMsg[]>([])
  const [input, setInput]         = useState('')
  const [sending, setSending]     = useState(false)
  const [resetting, setResetting] = useState(false)
  const endRef                     = useRef<HTMLDivElement>(null)
  const inputRef                   = useRef<HTMLInputElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mensajes])
  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSend = async () => {
    const texto = input.trim()
    if (!texto || sending) return
    setSending(true)

    const msgCliente: TestMsg = { id: Date.now(), texto, tipo: 'entrada' }
    setMensajes(prev => [...prev, msgCliente])
    setInput('')

    try {
      const respuestas = await window.electronAPI.bot.test(texto, 'Cliente')
      for (const r of respuestas) {
        setMensajes(prev => [...prev, { id: Date.now() + Math.random(), texto: r, tipo: 'salida' }])
      }
      if (respuestas.length === 0) {
        setMensajes(prev => [...prev, {
          id: Date.now(), tipo: 'salida',
          texto: '(El bot no generó respuesta — puede que el modo esté en Manual)',
        }])
      }
    } catch {
      setMensajes(prev => [...prev, { id: Date.now(), tipo: 'salida', texto: '⚠️ Error al procesar el mensaje.' }])
    }

    setSending(false)
    inputRef.current?.focus()
  }

  const handleReset = async () => {
    setResetting(true)
    await window.electronAPI.bot.resetTest()
    setMensajes([])
    setResetting(false)
    inputRef.current?.focus()
  }

  const sugerencias = [
    'hola',
    'hay turnos a Quito?',
    'cuánto cuesta a Manta?',
    'quiero reservar un viaje a Guayaquil',
    'RESERVAR',
  ]

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg h-[600px] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-primary text-white flex-shrink-0">
          <div className="flex items-center gap-2">
            <FlaskConical size={18} />
            <div>
              <p className="font-semibold text-sm">Probar Bot</p>
              <p className="text-xs text-white/70">Escribe como si fueras un cliente</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              disabled={resetting}
              title="Reiniciar conversación"
              className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            >
              <RotateCcw size={15} className={resetting ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-[#F0F4F8]">
          {mensajes.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4">
              <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center">
                <Bot size={28} className="text-primary" />
              </div>
              <div>
                <p className="font-medium text-gray-600 text-sm">Conversación de prueba</p>
                <p className="text-xs text-gray-400 mt-1">Los mensajes no se envían por WhatsApp real</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center">
                {sugerencias.map(s => (
                  <button
                    key={s}
                    onClick={() => { setInput(s); inputRef.current?.focus() }}
                    className="text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mensajes.map(m => (
            <div key={m.id} className={`flex ${m.tipo === 'entrada' ? 'justify-end' : 'justify-start'}`}>
              {m.tipo === 'salida' && (
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center mr-2 mt-auto flex-shrink-0">
                  <Bot size={13} className="text-white" />
                </div>
              )}
              <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                m.tipo === 'entrada'
                  ? 'bg-secondary text-white rounded-br-sm'
                  : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'
              }`}>
                <p className="whitespace-pre-wrap break-words">{m.texto}</p>
              </div>
              {m.tipo === 'entrada' && (
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center ml-2 mt-auto flex-shrink-0">
                  <User size={13} className="text-gray-500" />
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center mr-2 mt-auto flex-shrink-0">
                <Bot size={13} className="text-white" />
              </div>
              <div className="bg-white border border-gray-100 px-4 py-2.5 rounded-2xl rounded-bl-sm shadow-sm">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={endRef} />
        </div>

        {/* Sugerencias rápidas cuando hay conversación activa */}
        {mensajes.length > 0 && (
          <div className="px-3 pt-2 flex gap-2 overflow-x-auto flex-shrink-0 bg-white border-t pb-1">
            {sugerencias.map(s => (
              <button
                key={s}
                onClick={() => { setInput(s); inputRef.current?.focus() }}
                className="flex-shrink-0 text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full hover:bg-primary/10 hover:text-primary transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="bg-white border-t px-3 py-3 flex items-center gap-2 flex-shrink-0">
          <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-2 flex items-center">
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
              placeholder="Escribe como si fueras un cliente..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="w-10 h-10 bg-secondary text-white rounded-full flex items-center justify-center disabled:opacity-40 transition-all hover:bg-secondary/90 flex-shrink-0"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal Chat ─────────────────────────────────────────────────

export function Chat() {
  const { whatsappStatus }                        = useAppStore()
  const [conversaciones, setConversaciones]       = useState<Conversacion[]>(CONV_DEMO)
  const [selectedJid, setSelectedJid]             = useState<string | null>('demo1')
  const [inputMsg, setInputMsg]                   = useState('')
  const [busqueda, setBusqueda]                   = useState('')
  const [enviando, setEnviando]                   = useState(false)
  const [botModo, setBotModo]                     = useState<BotModo>('auto')
  const [modoLoading, setModoLoading]             = useState(false)
  const [showTestModal, setShowTestModal]         = useState(false)
  const messagesEndRef                             = useRef<HTMLDivElement>(null)
  const inputRef                                   = useRef<HTMLInputElement>(null)

  const cargarMensajesDB = useCallback(async () => {
    if (!window.electronAPI?.mensajes) return
    const rows = await window.electronAPI.mensajes.getAll()
    const mapa = new Map<string, Conversacion>()
    for (const m of rows) {
      const jid = (m.jid || m.telefono) as string | undefined
      if (!jid) continue
      if (!mapa.has(jid)) {
        mapa.set(jid, {
          jid, contacto: m.contacto as string, telefono: m.telefono as string,
          mensajes: [], noLeidos: 0,
          ultimaFecha: m.fecha as string,
          canal: (m.canal ?? 'whatsapp') as Canal,
          messenger_psid: m.messenger_psid as string | undefined,
        })
      }
      const conv = mapa.get(jid)!
      conv.mensajes.push(m as unknown as MensajeWA)
      if (new Date(m.fecha as string) > new Date(conv.ultimaFecha)) conv.ultimaFecha = m.fecha as string
      // Mensajes están ORDER BY fecha ASC: si éste tiene nombre real (no solo dígitos), actualizar.
      // Así el nombre más reciente con nombre real gana sobre registros antiguos con número crudo.
      const nombreCandidato = m.contacto as string | null
      if (nombreCandidato && !/^\d+$/.test(nombreCandidato)) {
        conv.contacto = nombreCandidato
      }
    }
    // Aplicar nombres almacenados en contactos_wa como override (directorio del teléfono)
    if (window.electronAPI?.contactos) {
      try {
        const storedNames = await window.electronAPI.contactos.getNombres()
        for (const [jid, conv] of mapa) {
          if (storedNames[jid]) conv.contacto = storedNames[jid]
        }
      } catch { /* no bloquear si falla */ }
    }
    // Aplicar nombres de clientes como prioridad más alta: nombre verificado por el operador
    // (importado por Excel/PDF) tiene precedencia sobre pushName y contactos_wa.
    if (window.electronAPI?.clientes?.getNombres) {
      try {
        const clienteNames = await window.electronAPI.clientes.getNombres()
        for (const [, conv] of mapa) {
          // conv.telefono = "593XXXXXXXXX"; clientes.telefono = "XXXXXXXXX" (sin código país)
          const phoneNorm = conv.telefono.replace(/^593/, '').replace(/^0+/, '')
          if (clienteNames[phoneNorm]) conv.contacto = clienteNames[phoneNorm]
        }
      } catch { /* no bloquear si falla */ }
    }
    const convs = Array.from(mapa.values()).sort(
      (a, b) => new Date(b.ultimaFecha).getTime() - new Date(a.ultimaFecha).getTime()
    )
    if (convs.length > 0) {
      setConversaciones(convs)
      setSelectedJid(prev => prev && convs.find(c => c.jid === prev) ? prev : convs[0].jid)
    } else {
      setConversaciones(CONV_DEMO)
      setSelectedJid('demo1')
    }
  }, [])

  // Cargar modo bot y mensajes persistidos al montar
  useEffect(() => {
    if (!window.electronAPI?.bot) return
    window.electronAPI.bot.getModo().then(modo => setBotModo(modo))
  }, [])

  useEffect(() => {
    cargarMensajesDB()
  }, [cargarMensajesDB])

  const handleToggleBotModo = async () => {
    const newModo: BotModo = botModo === 'auto' ? 'manual' : 'auto'
    setModoLoading(true)
    setBotModo(newModo)
    await window.electronAPI.bot.setModo(newModo)
    setModoLoading(false)
  }

  const addOrUpdateMsg = useCallback((m: MensajeWA) => {
    setConversaciones(prev => {
      const idx = prev.findIndex(c => c.jid === m.jid)
      const newMsg = { ...m, fecha: m.fecha || new Date().toISOString() }
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          mensajes:    [...updated[idx].mensajes, newMsg],
          noLeidos:    selectedJid === m.jid ? 0 : updated[idx].noLeidos + 1,
          ultimaFecha: newMsg.fecha,
        }
        return updated
      }
      return [{
        jid: m.jid, contacto: m.contacto, telefono: m.telefono,
        mensajes: [newMsg], noLeidos: 1, ultimaFecha: newMsg.fecha,
        canal: (m.canal ?? 'whatsapp') as Canal, messenger_psid: m.messenger_psid,
      }, ...prev]
    })
  }, [selectedJid])

  useEffect(() => {
    if (!window.electronAPI) return
    window.electronAPI.whatsapp.onMessage((msg) => {
      addOrUpdateMsg(msg as MensajeWA)
    })

    window.electronAPI.whatsapp.onHistorial(() => {
      // Al cargar historial de WA, recargar desde DB para mostrar solo mensajes del número activo
      void cargarMensajesDB()
    })

    return () => window.electronAPI.whatsapp.removeListeners()
  }, [addOrUpdateMsg, cargarMensajesDB])

  useEffect(() => {
    if (!window.electronAPI?.messenger) return
    window.electronAPI.messenger.onMessage((msg) => addOrUpdateMsg(msg as MensajeWA))
    return () => window.electronAPI.messenger.removeListeners()
  }, [addOrUpdateMsg])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedJid, conversaciones])

  const convActual = conversaciones.find(c => c.jid === selectedJid)

  const handleSend = useCallback(async () => {
    const texto = inputMsg.trim()
    if (!texto || !selectedJid || !convActual) return
    setEnviando(true)

    const newMsg: MensajeWA = {
      id: Date.now(), contacto: 'Operadora', telefono: '',
      mensaje: texto, fecha: new Date().toISOString(),
      tipo: 'saliente', procesado: 1, jid: selectedJid, canal: convActual.canal,
    }

    setConversaciones(prev => prev.map(c =>
      c.jid === selectedJid
        ? { ...c, mensajes: [...c.mensajes, newMsg], ultimaFecha: newMsg.fecha }
        : c
    ))
    setInputMsg('')

    if (convActual.canal === 'messenger' && convActual.messenger_psid) {
      await window.electronAPI.messenger.sendMessage(convActual.messenger_psid, texto)
    } else if (whatsappStatus.connected) {
      await window.electronAPI.whatsapp.sendMessage(selectedJid, texto, convActual.contacto, convActual.telefono)
    }

    setEnviando(false)
    inputRef.current?.focus()
  }, [inputMsg, selectedJid, convActual, whatsappStatus.connected])

  const handleSelectConv = (jid: string) => {
    setSelectedJid(jid)
    setConversaciones(prev => prev.map(c => c.jid === jid ? { ...c, noLeidos: 0 } : c))
  }

  const convFiltradas = conversaciones
    .filter(c => !busqueda || c.contacto.toLowerCase().includes(busqueda.toLowerCase()) || c.telefono.includes(busqueda))
    .sort((a, b) => new Date(b.ultimaFecha).getTime() - new Date(a.ultimaFecha).getTime())

  const totalNoLeidos = conversaciones.reduce((s, c) => s + c.noLeidos, 0)
  const canSend       = convActual?.canal === 'messenger' ? true : whatsappStatus.connected

  return (
    <>
      <div className="h-full flex overflow-hidden">
        {/* Sidebar conversaciones */}
        <div className="w-80 flex-shrink-0 bg-white border-r flex flex-col">
          <div className="px-4 pt-3 pb-3 border-b">
            {/* Fila 1: título + contador */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-gray-900">Mensajes</h2>
                {totalNoLeidos > 0 && (
                  <span className="bg-secondary text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {totalNoLeidos > 9 ? '9+' : totalNoLeidos}
                  </span>
                )}
              </div>
              {/* Botón probar bot */}
              <button
                onClick={() => setShowTestModal(true)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 bg-primary/5 hover:bg-primary/10 px-2 py-1 rounded-lg transition-all"
                title="Probar bot de forma simulada"
              >
                <FlaskConical size={12} />
                Probar Bot
              </button>
            </div>

            {/* Fila 2: switch bot modo + WA status */}
            <div className="flex items-center justify-between mb-2">
              {/* Switch Bot / Manual */}
              <button
                onClick={handleToggleBotModo}
                disabled={modoLoading}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  botModo === 'auto'
                    ? 'border-secondary/30 bg-secondary/5 text-secondary'
                    : 'border-amber-300 bg-amber-50 text-amber-700'
                }`}
                title={botModo === 'auto' ? 'Bot activo — clic para activar modo manual' : 'Modo manual activo — clic para activar bot'}
              >
                {botModo === 'auto'
                  ? <><Bot size={12} /> Bot Activo</>
                  : <><User size={12} /> Modo Manual</>
                }
                {/* Toggle visual */}
                <span className={`ml-1 w-7 h-4 rounded-full flex items-center transition-colors ${botModo === 'auto' ? 'bg-secondary' : 'bg-amber-400'}`}>
                  <span className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${botModo === 'auto' ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </span>
              </button>

              {/* WA status */}
              <div className="flex items-center gap-1.5 text-xs">
                <span className={`w-2 h-2 rounded-full ${whatsappStatus.connected ? 'bg-secondary' : 'bg-gray-300'}`} />
                <span className={whatsappStatus.connected ? 'text-secondary font-medium' : 'text-gray-400'}>
                  {whatsappStatus.connected ? 'WA OK' : 'WA off'}
                </span>
              </div>
            </div>

            {/* Buscador */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-gray-400"
                placeholder="Buscar conversación..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {convFiltradas.length === 0 && (
              <div className="flex flex-col items-center justify-center h-24 text-gray-300 gap-1">
                <MessageSquare size={24} />
                <p className="text-xs">Sin conversaciones</p>
              </div>
            )}
            {convFiltradas.map(c => (
              <button
                key={c.jid}
                onClick={() => handleSelectConv(c.jid)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition-colors ${
                  selectedJid === c.jid ? 'bg-primary/5 border-l-[3px] border-l-primary' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 relative">
                    <span className="text-sm font-bold text-primary">{c.contacto.charAt(0).toUpperCase()}</span>
                    {c.canal === 'messenger' && (
                      <span className="absolute -bottom-1 -right-1 bg-blue-600 text-white text-[9px] font-bold rounded px-0.5 leading-tight">FB</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <p className="font-semibold text-sm text-gray-900 truncate">{c.contacto}</p>
                        <CanalBadge canal={c.canal} jid={c.jid} />
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatFechaConv(c.ultimaFecha)}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-xs text-gray-400 truncate flex-1">
                        {c.mensajes[c.mensajes.length - 1]?.mensaje ?? ''}
                      </p>
                      {c.noLeidos > 0 && (
                        <span className="bg-secondary text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ml-2 flex-shrink-0">
                          {c.noLeidos}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {!whatsappStatus.connected && (
            <div className="p-3 border-t bg-amber-50">
              <div className="flex items-center gap-2 text-xs text-amber-700">
                <WifiOff size={13} />
                <span>WhatsApp desconectado — ve a <strong>Configuración</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Panel de chat */}
        <div className="flex-1 flex flex-col bg-[#F0F4F8] overflow-hidden">
          {convActual ? (
            <>
              {/* Header */}
              <div className="bg-white border-b px-5 py-3 flex items-center gap-3 shadow-sm">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-primary">{convActual.contacto.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{convActual.contacto}</p>
                    {convActual.canal === 'messenger' && (
                      <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded font-bold">Messenger</span>
                    )}
                    {convActual.jid?.endsWith('@g.us') && (
                      <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded font-bold">Grupo WA</span>
                    )}
                  </div>
                  {convActual.telefono && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Phone size={10} /> {convActual.telefono}
                    </p>
                  )}
                </div>
                {/* Indicador modo bot en header */}
                <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                  botModo === 'auto'
                    ? 'bg-secondary/10 text-secondary'
                    : 'bg-amber-100 text-amber-700'
                }`}>
                  {botModo === 'auto' ? <Bot size={11} /> : <User size={11} />}
                  {botModo === 'auto' ? 'Bot respondiendo' : 'Respuesta manual'}
                </div>
                <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400">
                  <MoreVertical size={18} />
                </button>
              </div>

              {/* Mensajes */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
                {convActual.mensajes.map((m, i) => {
                  const isOut   = m.tipo === 'saliente'
                  const prevMsg = i > 0 ? convActual.mensajes[i - 1] : null
                  const showDate = !prevMsg || m.fecha.slice(0, 10) !== prevMsg.fecha.slice(0, 10)
                  return (
                    <div key={m.id}>
                      {showDate && (
                        <div className="flex justify-center my-3">
                          <span className="text-xs text-gray-500 bg-white px-3 py-1 rounded-full shadow-sm">
                            {isToday(new Date(m.fecha)) ? 'Hoy' : isYesterday(new Date(m.fecha)) ? 'Ayer' : format(new Date(m.fecha), "d 'de' MMMM", { locale: es })}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-0.5`}>
                        {!isOut && (
                          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mr-2 mt-auto flex-shrink-0">
                            <span className="text-xs font-bold text-primary">{convActual.contacto.charAt(0)}</span>
                          </div>
                        )}
                        <div className={`max-w-[68%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                          isOut
                            ? 'bg-secondary text-white rounded-br-sm'
                            : 'bg-white text-gray-800 rounded-bl-sm border border-gray-100'
                        }`}>
                          {m.mensaje.includes('maps.google.com') ? (
                            <a
                              href={m.mensaje}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => { e.preventDefault(); window.electronAPI.shell.openExternal(m.mensaje) }}
                              className={`flex items-center gap-1.5 underline ${isOut ? 'text-white' : 'text-blue-600'}`}
                            >
                              📍 Ver ubicación en Google Maps
                            </a>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{m.mensaje}</p>
                          )}
                          <div className={`flex items-center justify-end gap-1 mt-0.5 ${isOut ? 'text-white/60' : 'text-gray-400'}`}>
                            <span className="text-[10px]">{formatFechaMsg(m.fecha)}</span>
                            {isOut && (m.procesado ? <CheckCheck size={12} /> : <Check size={12} />)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Respuestas rápidas — solo en modo manual */}
              {botModo === 'manual' && (
                <div className="px-4 py-2 flex gap-2 overflow-x-auto flex-shrink-0 bg-white/50">
                  {RESPUESTAS_RAPIDAS.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => { setInputMsg(r); inputRef.current?.focus() }}
                      className="flex-shrink-0 text-xs bg-white border border-gray-200 text-gray-600 px-3 py-1.5 rounded-full hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
                    >
                      {r.length > 40 ? r.slice(0, 40) + '…' : r}
                    </button>
                  ))}
                </div>
              )}

              {/* Banner modo bot activo */}
              {botModo === 'auto' && (
                <div className="mx-4 mb-2 flex items-center gap-2 text-xs bg-secondary/5 border border-secondary/20 text-secondary px-3 py-1.5 rounded-full">
                  <Bot size={12} />
                  <span>El bot responde automáticamente a los clientes. Activa <strong>Modo Manual</strong> para responder tú.</span>
                </div>
              )}

              {/* Input */}
              <div className="bg-white border-t px-4 py-3 flex items-end gap-3 flex-shrink-0">
                {convActual.canal === 'messenger' && (
                  <span className="text-xs text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded flex-shrink-0">FB</span>
                )}
                {!canSend && (
                  <div className="flex items-center gap-1 text-xs text-amber-600 flex-shrink-0">
                    <WifiOff size={12} />
                    <span>Desconectado</span>
                  </div>
                )}
                <div className="flex-1 bg-gray-100 rounded-2xl px-4 py-2 min-h-[44px] flex items-center">
                  <input
                    ref={inputRef}
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                    placeholder={botModo === 'auto' ? 'Bot activo (modo manual para escribir)...' : 'Escribe un mensaje...'}
                    value={inputMsg}
                    onChange={e => setInputMsg(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!inputMsg.trim() || enviando}
                  className="w-11 h-11 bg-secondary text-white rounded-full flex items-center justify-center hover:bg-secondary/90 disabled:opacity-40 transition-all shadow-sm hover:shadow-md flex-shrink-0"
                >
                  <Send size={16} className={enviando ? 'opacity-50' : ''} />
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-4">
              <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center">
                <MessageSquare size={36} className="text-gray-300" />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-400">Selecciona una conversación</p>
                <p className="text-sm text-gray-300 mt-1">Mensajes de WhatsApp y Messenger aparecerán aquí</p>
              </div>
              {!whatsappStatus.connected && (
                <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 px-4 py-2 rounded-full">
                  <Wifi size={15} />
                  Conecta WhatsApp en Configuración
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal de prueba */}
      {showTestModal && <BotTestModal onClose={() => setShowTestModal(false)} />}
    </>
  )
}

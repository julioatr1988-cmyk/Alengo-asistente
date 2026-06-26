import https from 'https'
import { BrowserWindow } from 'electron'
import { saveMensaje } from './database'
import { procesarMensaje } from './bot'

interface GraphMessage {
  id:           string
  message:      string
  from:         { id: string; name?: string }
  created_time: string
}

interface GraphConversation {
  id:       string
  messages: { data: GraphMessage[] }
}

let _pageToken = ''
let _pageId    = ''
let _mainWin:  BrowserWindow | null = null
let _interval: ReturnType<typeof setInterval> | null = null
let _seenIds   = new Set<string>()
let _lastPollTs = 0
let _isRunning  = false

// ── Graph API helpers ─────────────────────────────────────────────────────────

function graphGet(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?'
    const url = `/v18.0${path}${sep}access_token=${encodeURIComponent(_pageToken)}`
    const req = https.request(
      { hostname: 'graph.facebook.com', path: url, method: 'GET' },
      res => {
        let data = ''
        res.on('data', c => { data += c })
        res.on('end', () => {
          try { resolve(JSON.parse(data) as Record<string, unknown>) }
          catch { reject(new Error('JSON parse: ' + data.slice(0, 200))) }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')))
    req.end()
  })
}

function graphPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const sep = path.includes('?') ? '&' : '?'
    const url = `/v18.0${path}${sep}access_token=${encodeURIComponent(_pageToken)}`
    const req = https.request(
      {
        hostname: 'graph.facebook.com', path: url, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        let data = ''
        res.on('data', c => { data += c })
        res.on('end', () => {
          try { resolve(JSON.parse(data) as Record<string, unknown>) }
          catch { reject(new Error('JSON parse: ' + data.slice(0, 200))) }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')))
    req.write(payload)
    req.end()
  })
}

// ── API pública: enviar mensaje ───────────────────────────────────────────────

export async function sendMessengerMessage(psid: string, text: string) {
  if (!_pageToken) return { success: false, error: 'Sin token' }
  try {
    const res = await graphPost('/me/messages', {
      recipient: { id: psid },
      message:   { text },
      messaging_type: 'RESPONSE',
    })
    const err = res.error as { message?: string } | undefined
    if (err) return { success: false, error: err.message ?? String(err) }
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function fetchPageId(): Promise<boolean> {
  try {
    const data = await graphGet('/me?fields=id,name')
    if (data.error) {
      console.error('[Messenger] Error de API:', (data.error as { message?: string }).message)
      return false
    }
    _pageId = (data.id as string) ?? ''
    console.log('[Messenger] Page ID:', _pageId, '— nombre:', data.name)
    return !!_pageId
  } catch (err) {
    console.error('[Messenger] Error obteniendo Page ID:', err)
    return false
  }
}

async function pollOnce() {
  if (!_pageToken || !_pageId || !_mainWin) return

  try {
    const data = await graphGet(
      '/me/conversations?fields=messages.limit(20){id,message,from,created_time}&limit=20'
    )

    if (data.error) {
      console.error('[Messenger] Error API en poll:', (data.error as { message?: string }).message)
      return
    }

    const conversations = (data.data as GraphConversation[]) ?? []
    const nowTs = Date.now()

    for (const conv of conversations) {
      const msgs = conv.messages?.data ?? []
      // Vienen del más nuevo al más viejo — procesamos cronológicamente
      for (const msg of [...msgs].reverse()) {
        if (_seenIds.has(msg.id)) continue
        _seenIds.add(msg.id)

        const msgTs = new Date(msg.created_time).getTime()
        if (_lastPollTs > 0 && msgTs <= _lastPollTs) continue
        if (msg.from?.id === _pageId) continue   // mensaje de la propia página
        if (!msg.message?.trim()) continue

        const psid  = msg.from.id
        const nombre = msg.from.name ?? psid
        const jid    = `messenger_${psid}`
        const texto  = msg.message

        const mensajeObj = {
          id:             Date.now() + Math.random(),
          contacto:       nombre,
          telefono:       '',
          mensaje:        texto,
          fecha:          new Date(msg.created_time).toISOString(),
          tipo:           'entrante' as const,
          procesado:      0,
          jid,
          canal:          'messenger',
          messenger_psid: psid,
        }

        saveMensaje(mensajeObj)
        _mainWin?.webContents.send('messenger:message', mensajeObj)
        console.log('[Messenger] Nuevo mensaje de', nombre, ':', texto.slice(0, 80))

        await procesarMensaje(
          jid, 'messenger', texto, nombre,
          async (_jid, respuesta) => {
            const r = await sendMessengerMessage(psid, respuesta)
            if (r.success && _mainWin) {
              const salida = {
                ...mensajeObj,
                id:        Date.now() + Math.random(),
                contacto:  'Bot Alengo',
                mensaje:   respuesta,
                fecha:     new Date().toISOString(),
                tipo:      'saliente' as const,
                procesado: 1,
              }
              saveMensaje(salida)
              _mainWin.webContents.send('messenger:message', salida)
            }
          },
        )
      }
    }

    _lastPollTs = nowTs
    if (_seenIds.size > 2000) {
      const arr = Array.from(_seenIds)
      _seenIds = new Set(arr.slice(arr.length - 1000))
    }
  } catch (err) {
    console.error('[Messenger] Error en polling:', err)
  }
}

// ── Control ───────────────────────────────────────────────────────────────────

export async function startMessengerPolling(token: string, win: BrowserWindow) {
  if (_interval) { clearInterval(_interval); _interval = null }

  _pageToken = token
  _mainWin   = win
  _isRunning = false

  const ok = await fetchPageId()
  if (!ok) {
    win.webContents.send('messenger:status', {
      running: false,
      error: 'Token inválido o sin permisos (pages_messaging, pages_read_engagement)',
    })
    return
  }

  _isRunning  = true
  // Primer poll: revisar mensajes de los últimos 5 minutos
  _lastPollTs = Date.now() - 5 * 60 * 1000

  await pollOnce()
  _interval = setInterval(pollOnce, 30_000)
  console.log('[Messenger] Polling iniciado cada 30 s')
  win.webContents.send('messenger:status', { running: true, pageId: _pageId })
}

export function stopMessengerPolling() {
  if (_interval) { clearInterval(_interval); _interval = null }
  _isRunning = false
  _pageToken = ''
  _pageId    = ''
  _mainWin?.webContents.send('messenger:status', { running: false })
  console.log('[Messenger] Polling detenido')
}

export function getMessengerStatus() {
  return { running: _isRunning, pageId: _pageId }
}

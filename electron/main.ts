import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'
import https from 'https'
import QRCode from 'qrcode'
import type { WASocket } from '@whiskeysockets/baileys'
import {
  initDB, getChoferes, createChofer, updateChofer, updateChoferCiudad,
  getViajes, createViaje, updateViaje, getReporteChofer,
  getMensualidades, registrarPago, getTurnosPorRuta, asignarChofer,
  getRutas, getEmpresa, updateEmpresa, getViajeById, deleteViaje,
  getMensualidadesChofer, saveMensaje, setFacebookPage, clearFacebookPage,
  getLicencia, saveLicencia, updateLicenciaValidacion, deleteLicencia,
  getBotModo, setBotModo, deleteBotConversation, getBotConversation,
  updateEmpresaLogo, saveMensajeHistorial, saveMensajeHistorialBatch,
  getMensajes, getRutasConfig, upsertRutaConfig,
  getViajeGruposParaAutocompletar,
  getCliente, createCliente, updateClienteVerificado, getClientes,
  getFAQ, createFAQ, updateFAQ, deleteFAQ,
  getTarifasEncomiendas, upsertTarifaEncomienda,
  getTarifasZonas, upsertTarifaZona, getTarifasEncTamanos, upsertTarifaEncTamano,
  getViajeGrupos, getViajesByGrupo, updateViajeGrupoEstado, createViajeConGrupo,
  saveEdicionTurnos,
  upsertContactoWa, upsertContactosWaBatch, getContactoNombre, limpiarConversacionesAntiguas,
} from './database'
import { procesarMensaje, type SendFn } from './bot'
import {
  startMessengerPolling, stopMessengerPolling, getMessengerStatus,
  sendMessengerMessage,
} from './messenger'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

const LICENSE_SERVER = 'https://alengo-licenses.julioatr1988.workers.dev'

function getFingerprint(): string {
  const ifaces = os.networkInterfaces()
  const macs: string[] = []
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (/virtual|loopback|vmware|vbox|vpn/i.test(name)) continue
    for (const addr of addrs ?? []) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        macs.push(addr.mac.toLowerCase())
      }
    }
  }
  macs.sort()
  const raw = [os.hostname(), ...macs.slice(0, 3)].join('|')
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

async function licenseRequest(endpoint: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${LICENSE_SERVER}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string> || {}) },
    signal: AbortSignal.timeout(10_000),
  })
  return res.json() as Promise<Record<string, unknown>>
}

let mainWindow: BrowserWindow | null = null

// ── Estado WhatsApp ───────────────────────────────────────────────────────────

let waSocket:     WASocket | null = null
let waConnected         = false
let waPhone:      string | null = null
let waConnecting        = false
let waQrTimer:    ReturnType<typeof setTimeout> | null = null

// Si el QR se muestra pero el usuario nunca escanea, liberar el flag waConnecting
// para que se pueda volver a intentar sin reiniciar la app.
const QR_TIMEOUT_MS = 120_000

function normalizePhone(phone: string): string {
  return phone
    .replace(/@.*$/, '')
    .replace(/[^\d]/g, '')
    .replace(/^0+/, '')
    .replace(/^593/, '')
}

// ── Conexión WhatsApp (Baileys — WebSocket, sin navegador) ───────────────────
async function iniciarWhatsApp(win: BrowserWindow) {
  if (waConnecting) return
  waConnecting = true

  if (waSocket) {
    try { await waSocket.end(undefined) } catch {}
    waSocket = null
    waConnected = false
    waPhone = null
  }

  const sessionDir = path.join(app.getPath('userData'), 'wa-session')

  try {
    // TypeScript con "module": "CommonJS" convierte import() a require().
    // Baileys es ESM-only, así que usamos new Function para preservar el import() real en el output CJS.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const esmImport = (m: string): Promise<any> => new Function('m', 'return import(m)')(m)
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      isJidGroup,
      downloadMediaMessage,
      fetchLatestBaileysVersion,
    } = await esmImport('@whiskeysockets/baileys')

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir)

    // fetchLatestBaileysVersion hace una petición HTTP; si no hay red puede colgar
    // indefinidamente. El race() lo limita a 8s con fallback a versión conocida.
    let version: number[]
    try {
      const vr = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise<{ version: number[] }>(r => setTimeout(() => r({ version: [2, 3000, 1041985787] }), 8_000)),
      ])
      version = vr.version
    } catch {
      version = [2, 3000, 1041985787]
    }

    // Logger mínimo compatible con Node.js 18 (Electron 28 — no soporta pino v10)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noop = () => {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const silentLogger: any = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, child: () => silentLogger }

    console.log('[WA] Iniciando conexión Baileys (WebSocket)...')
    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ['Alengo Asistente', 'Chrome', '126.0.0'],
    })
    waSocket = sock

    sock.ev.on('creds.update', saveCreds)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('contacts.upsert', (contactsArr: any[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batch: Array<{ jid: string; nombre: string }> = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const c of contactsArr as any[]) {
        const nombre = (c.name || c.notify) as string | undefined
        if (c.id && nombre) batch.push({ jid: c.id as string, nombre })
      }
      if (batch.length) upsertContactosWaBatch(batch)
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('contacts.update', (updates: any[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const u of updates as any[]) {
        const nombre = (u.name || u.notify) as string | undefined
        if (u.id && nombre) upsertContactoWa(u.id as string, nombre)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        console.log('[WA] QR recibido — convirtiendo a imagen...')
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2,
            color: { dark: '#000000', light: '#ffffff' } })
          win.webContents.send('whatsapp:qr', dataUrl)
        } catch (e) {
          console.error('[WA] Error generando imagen QR:', e)
        }
        // Iniciar temporizador: si el QR no se escanea en 2 minutos liberar el flag
        // para que el usuario pueda reintentar sin reiniciar la app.
        if (waQrTimer) clearTimeout(waQrTimer)
        waQrTimer = setTimeout(() => {
          waQrTimer = null
          if (!waConnected && waConnecting) {
            console.log('[WA] QR expiró sin escanear — liberando estado')
            waConnecting = false
            if (!win.isDestroyed()) {
              win.webContents.send('whatsapp:error', 'El código QR expiró. Pulsa "Conectar" para generar uno nuevo.')
              win.webContents.send('whatsapp:statusChange', { connected: false, phone: null })
            }
            try { sock.end(undefined) } catch {}
            waSocket = null
          }
        }, QR_TIMEOUT_MS)
      }

      if (connection === 'open') {
        if (waQrTimer) { clearTimeout(waQrTimer); waQrTimer = null }
        waConnected = true
        waConnecting = false
        limpiarConversacionesAntiguas(8)
        // sock.user.id: '593XXXXXXXXX:NN@s.whatsapp.net'
        waPhone = sock.user?.id?.split(':')[0]?.split('@')[0] ?? null
        console.log('[WA] Conectado — número:', waPhone)
        win.webContents.send('whatsapp:connected', { phone: waPhone })
        win.webContents.send('whatsapp:statusChange', { connected: true, phone: waPhone })

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const groups = await sock.groupFetchAllParticipating() as any
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gruposArr = Object.values(groups).map((g: any) => ({ jid: g.id, name: g.subject }))
          if (gruposArr.length) win.webContents.send('whatsapp:grupos', gruposArr)
          console.log(`[WA] ${gruposArr.length} grupos cargados`)
        } catch (e) {
          console.error('[WA] Error cargando grupos:', e)
        }
      }

      if (connection === 'close') {
        if (waQrTimer) { clearTimeout(waQrTimer); waQrTimer = null }
        waConnected = false
        waPhone = null
        waConnecting = false
        waSocket = null
        win.webContents.send('whatsapp:statusChange', { connected: false, phone: null })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut

        if (shouldReconnect && !win.isDestroyed()) {
          console.log('[WA] Reconectando en 3s... (código:', statusCode, ')')
          setTimeout(() => {
            if (!waConnected && !waConnecting && !win.isDestroyed()) {
              void iniciarWhatsApp(win)
            }
          }, 3000)
        } else if (!shouldReconnect) {
          console.log('[WA] Sesión cerrada (logout)')
          win.webContents.send('whatsapp:error', 'Sesión cerrada. Reconecta y escanea el QR nuevamente.')
        }
      }
    })

    // Historial: Baileys sincroniza mensajes pasados via este evento.
    // Usamos saveMensajeHistorialBatch para una sola escritura a disco en lugar
    // de saveDB() por cada mensaje (evita freeze de varios segundos con historiales grandes).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('messaging-history.set', ({ messages, chats, contacts }: any) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const historial: any[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const paraBatch: Parameters<typeof saveMensajeHistorialBatch>[0] = []

        // Persist contact names from history payload so they survive reconnects
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contactsBatch: Array<{ jid: string; nombre: string }> = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const c of (contacts ?? []) as any[]) {
          const nombre = (c.name || c.notify) as string | undefined
          if (c.id && nombre) contactsBatch.push({ jid: c.id as string, nombre })
        }
        if (contactsBatch.length) upsertContactosWaBatch(contactsBatch)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const chat of chats as any[]) {
          const chatJid = chat.id as string | undefined
          if (!chatJid) continue
          const chatName = chat.name || getContactoNombre(chatJid) || chatJid.split('@')[0]
          const esGrupoChat = isJidGroup(chatJid)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chatMsgs = (messages as any[]).filter((m: any) => m.key?.remoteJid === chatJid && m.message)
          if (!chatMsgs.length) continue

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mensajes = chatMsgs.map((m: any) => {
            const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? ''
            if (!text) return null
            const msgObj = {
              id:        `hist_${m.key.id}`,
              contacto:  m.pushName || chatName,
              telefono:  chatJid.split('@')[0],
              mensaje:   text,
              fecha:     new Date((m.messageTimestamp as number) * 1000).toISOString(),
              tipo:      (m.key.fromMe ? 'saliente' : 'entrante') as 'saliente' | 'entrante',
              procesado: 1,
              jid:       chatJid,
              canal:     'whatsapp' as const,
            }
            paraBatch.push({ ...msgObj, wa_msg_id: m.key.id ?? '', wa_numero: waPhone })
            return msgObj
          }).filter(Boolean)

          if (mensajes.length) {
            historial.push({ jid: chatJid, contacto: chatName,
              telefono: chatJid.split('@')[0], mensajes, esGrupo: esGrupoChat })
          }
        }

        if (paraBatch.length) saveMensajeHistorialBatch(paraBatch)

        if (historial.length) {
          console.log(`[WA] Historial cargado: ${historial.length} conversaciones (${paraBatch.length} mensajes)`)
          win.webContents.send('whatsapp:historial', historial)
        }
      } catch (e) {
        console.error('[WA] Error procesando historial:', e)
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
      if (type !== 'notify') return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const msg of messages as any[]) {
        if (msg.key.fromMe) continue
        const jid = msg.key.remoteJid
        if (!jid) continue

        const esGrupo  = isJidGroup(jid)
        const phone    = jid.split('@')[0]
        const storedName = esGrupo ? null : getContactoNombre(jid)
        const pushName = msg.pushName || storedName || phone

        // Persist pushName so the name survives reconnects
        if (!esGrupo && msg.pushName && msg.pushName !== phone) {
          upsertContactoWa(jid, msg.pushName as string)
        }

        // Mensaje de ubicación GPS
        const locMsg = msg.message?.locationMessage
        if (locMsg) {
          const lat = locMsg.degreesLatitude
          const lng = locMsg.degreesLongitude
          if (lat != null && lng != null) {
            const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`
            const locObj = {
              id: Date.now(), contacto: pushName, telefono: phone,
              mensaje: mapsUrl, fecha: new Date().toISOString(),
              tipo: 'entrante' as const, procesado: 0, jid, canal: 'whatsapp',
              wa_numero: waPhone,
            }
            saveMensaje(locObj)
            win.webContents.send('whatsapp:message', locObj)
          }
          continue
        }

        // Foto de verificación de cliente
        const imgMsg = msg.message?.imageMessage
        if (imgMsg && !esGrupo) {
          const conv = getBotConversation(jid)
          if (conv?.estado === 'pedir_verificacion') {
            try {
              const buffer = await downloadMediaMessage(msg, 'buffer', {})
              if (buffer) {
                const verDir = path.join(app.getPath('userData'), 'verificaciones')
                if (!fs.existsSync(verDir)) fs.mkdirSync(verDir, { recursive: true })
                const normalizedPhone = normalizePhone(phone)
                const fotoPath = path.join(verDir, `${normalizedPhone}_${Date.now()}.jpg`)
                fs.writeFileSync(fotoPath, buffer as Buffer)
                updateClienteVerificado(normalizedPhone, fotoPath)
                deleteBotConversation(jid)
                if (waSocket && waConnected) {
                  await waSocket.sendMessage(jid, { text: '¡Gracias! Su identidad ha sido verificada correctamente. Ahora puede hacer reservas. Escriba *HOLA* para comenzar.' })
                }
                win.webContents.send('clientes:updated')
              }
            } catch (e) {
              console.error('[WA] Error guardando foto verificación:', e)
            }
          }
          continue
        }

        const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? ''
        if (!text) continue

        const mensajeObj = {
          id: Date.now(),
          contacto: pushName,
          telefono: phone,
          mensaje: esGrupo ? `[${pushName}]: ${text}` : text,
          fecha: new Date().toISOString(), tipo: 'entrante' as const,
          procesado: 0, jid, canal: 'whatsapp', wa_numero: waPhone,
        }
        saveMensaje(mensajeObj)
        win.webContents.send('whatsapp:message', mensajeObj)

        if (!esGrupo && getBotModo() === 'auto') {
          await procesarMensaje(jid, 'whatsapp', text, pushName,
            async (targetJid: string, responseText: string) => {
              if (waSocket && waConnected) {
                await waSocket.sendMessage(targetJid, { text: responseText })
              }
              // Reflejar respuesta del bot en la UI del chat
              if (!win.isDestroyed()) {
                win.webContents.send('whatsapp:message', {
                  id: Date.now(),
                  contacto: (getEmpresa()?.nombre as string) ?? 'Operadora',
                  telefono: '',
                  mensaje: responseText,
                  fecha: new Date().toISOString(),
                  tipo: 'saliente',
                  procesado: 1,
                  jid: targetJid,
                  canal: 'whatsapp',
                  wa_numero: waPhone,
                })
              }
            },
            (viaje) => {
              win.webContents.send('viajes:created', viaje)
              win.webContents.send('viajes:updated')
            }
          )
        }
      }
    })

  } catch (err) {
    console.error('[WA] Error iniciando WhatsApp:', err)
    win.webContents.send('whatsapp:error', `No se pudo iniciar WhatsApp: ${String(err)}`)
    waConnecting = false
  }
}

// ── Ventana principal ─────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 700,
    frame: false, titleBarStyle: 'hidden', backgroundColor: '#F8FAFC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
    },
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()

    // Auto-iniciar Messenger polling si hay token guardado
    const empresa = getEmpresa()
    if (empresa?.messenger_page_token && mainWindow) {
      startMessengerPolling(empresa.messenger_page_token as string, mainWindow)
    }

    // Auto-conectar WhatsApp si hay sesión guardada (sin QR)
    const sessionDir = path.join(app.getPath('userData'), 'wa-session')
    if (fs.existsSync(sessionDir) && mainWindow) {
      void iniciarWhatsApp(mainWindow)
    }
  })

  mainWindow.on('closed', () => {
    stopMessengerPolling()
    if (waSocket) { try { waSocket.end(undefined) } catch {} waSocket = null }
    mainWindow = null
  })
}

const RUTA_DESTINO: Record<string, string> = {
  'STO-UIO': 'QUITO',
  'UIO-STO': 'SANTO DOMINGO',
  'STO-GYE': 'GUAYAQUIL',
  'GYE-STO': 'SANTO DOMINGO',
  'STO-MTA': 'MANTA',
  'MTA-STO': 'SANTO DOMINGO',
}

function startBackgroundInterval() {
  setInterval(() => {
    try {
      const gruposVencidos = getViajeGruposParaAutocompletar()
      for (const grupo of gruposVencidos as any[]) {
        updateViajeGrupoEstado(grupo.id as number, 'completado')
        const ciudadDestino = RUTA_DESTINO[grupo.ruta_codigo as string]
        if (ciudadDestino && grupo.chofer_id) {
          updateChoferCiudad(grupo.chofer_id as number, ciudadDestino)
          console.log(`[Background] Grupo #${grupo.id} completado — chofer ${grupo.chofer_id} → ${ciudadDestino}`)
        }
      }
      if ((gruposVencidos as any[]).length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('choferes:updated')
        mainWindow.webContents.send('viajes:updated')
      }
    } catch (e) {
      console.error('[Background] Error en intervalo:', e)
    }
  }, 60_000)
}

function setupAutoUpdater() {
  // Logger a archivo — crea logs/main.log en userData
  const logDir = path.join(app.getPath('userData'), 'logs')
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  const logFile = path.join(logDir, 'main.log')
  const logLine = (level: string, msg: string) =>
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${level}] ${msg}\n`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  autoUpdater.logger = { info: (m: any) => logLine('INFO', String(m)), warn: (m: any) => logLine('WARN', String(m)), error: (m: any) => logLine('ERROR', String(m)), debug: (m: any) => logLine('DEBUG', String(m)) } as any

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // Sin Code Signing Certificate — deshabilitar verificación de firma
  ;(autoUpdater as any).verifyUpdateCodeSignature = false

  const send = (channel: string, ...args: unknown[]) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
  }

  autoUpdater.on('update-available', async (info: any) => {
    logLine('INFO', `Update available: ${info.version}`)
    send('update:available', info.version)
    logLine('INFO', 'Starting downloadUpdate()...')
    try {
      await autoUpdater.downloadUpdate()
    } catch (err: any) {
      logLine('ERROR', `downloadUpdate() failed: ${err?.message ?? err}`)
      send('update:error', err?.message ?? 'Error desconocido al descargar')
    }
  })

  autoUpdater.on('download-progress', (p: any) => {
    logLine('INFO', `Download progress: ${Math.round(p.percent)}%`)
    send('update:progress', Math.round(p.percent))
  })

  autoUpdater.on('update-downloaded', () => {
    logLine('INFO', 'Update downloaded')
    send('update:downloaded')
  })

  autoUpdater.on('error', (err: Error) => {
    logLine('ERROR', `Updater error: ${err.message}`)
    send('update:error', err.message)
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  setTimeout(() => {
    if (!isDev) {
      logLine('INFO', 'Checking for updates...')
      autoUpdater.checkForUpdates().catch((err: Error) => logLine('ERROR', `checkForUpdates failed: ${err.message}`))
    }
  }, 10_000)
}

app.whenReady().then(async () => {
  await initDB()
  createWindow()
  startBackgroundInterval()
  setupAutoUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (waSocket) {
    const ws = waSocket
    waSocket = null
    waConnected = false
    waConnecting = false
    try { ws.end(undefined) } catch {}
  }
})

// ── Ventana controls ──────────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ── Empresa ───────────────────────────────────────────────────────────────────
ipcMain.handle('empresa:get', () => getEmpresa())
ipcMain.handle('empresa:update', (_e, data) => updateEmpresa(data))

ipcMain.handle('empresa:selectLogo', async () => {
  if (!mainWindow) return { success: false }
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar logo de empresa',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths.length) return { success: false }
  try {
    const buffer = fs.readFileSync(filePaths[0])
    const ext    = path.extname(filePaths[0]).slice(1).toLowerCase()
    const mime   = ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : `image/${ext}`
    const logoData = `data:${mime};base64,${buffer.toString('base64')}`
    updateEmpresaLogo(logoData)
    return { success: true, logo: logoData }
  } catch (err) {
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('empresa:removeLogo', () => {
  updateEmpresaLogo(null)
  return { success: true }
})

// ── Choferes ──────────────────────────────────────────────────────────────────
ipcMain.handle('choferes:get', () => getChoferes())
ipcMain.handle('choferes:create', (_e, data) => createChofer(data))
ipcMain.handle('choferes:update', (_e, data) => updateChofer(data))

// ── Rutas ─────────────────────────────────────────────────────────────────────
ipcMain.handle('rutas:get', () => getRutas())

// ── Viajes ────────────────────────────────────────────────────────────────────
ipcMain.handle('viajes:get', (_e, fecha) => getViajes(fecha))
ipcMain.handle('viajes:getById', (_e, id) => getViajeById(id))
ipcMain.handle('viajes:create', (_e, data) => {
  const { viaje, grupo } = createViajeConGrupo(data)
  mainWindow?.webContents.send('viajes:updated')

  // Notificar al chofer por WA cuando se agenda un viaje manualmente
  const g = grupo as Record<string, unknown>
  if (waSocket && waConnected && g.chofer_telefono) {
    try {
      const todosViajes = getViajesByGrupo(g.id as number) as Array<Record<string, unknown>>
      const lineas = todosViajes.map(v =>
        `👤 ${v.cliente_nombre ?? '?'} ${v.cliente_telefono ?? ''} — desde ${v.origen ?? '?'} — $${Number(v.monto ?? 0).toFixed(2)}${v.requiere_factura ? ' 🧾' : ''}`
      )
      const rutaNombre = getRutas().find((r: any) => r.id === g.ruta_id)?.nombre ?? 'N/A'
      const msgChofer = [
        `🔔 *Viaje ${g.hora} — ${rutaNombre}*`,
        ...lineas,
        `Total: ${g.cupo_ocupado}/${g.cupo_maximo} pax`,
      ].join('\n')
      const digits = (g.chofer_telefono as string).replace(/[^\d]/g, '').replace(/^0/, '593')
      waSocket.sendMessage(`${digits}@s.whatsapp.net`, { text: msgChofer }).catch(() => {})
      if (g.chofer_grupo_wa_id) {
        waSocket.sendMessage(g.chofer_grupo_wa_id as string, { text: msgChofer }).catch(() => {})
      }
    } catch { /* WA no disponible */ }
  }

  return viaje
})
ipcMain.handle('viajes:update', (_e, data) => updateViaje(data))
ipcMain.handle('viajes:delete', (_e, id) => deleteViaje(id))

// ── Turnos ────────────────────────────────────────────────────────────────────
ipcMain.handle('turnos:porRuta', (_e, rutaId) => getTurnosPorRuta(rutaId))
ipcMain.handle('turnos:asignar', (_e, rutaId, hora) => asignarChofer(rutaId, hora))

// ── Reportes ──────────────────────────────────────────────────────────────────
ipcMain.handle('reportes:chofer', (_e, choferId, desde, hasta) => getReporteChofer(choferId, desde, hasta))

// ── Mensualidades ─────────────────────────────────────────────────────────────
ipcMain.handle('mensualidades:get', (_e, mes, anio) => getMensualidades(mes, anio))
ipcMain.handle('mensualidades:chofer', (_e, choferId, anio) => getMensualidadesChofer(choferId, anio))
ipcMain.handle('mensualidades:pagar', (_e, data) => registrarPago(data))

// ── App ───────────────────────────────────────────────────────────────────────
ipcMain.handle('app:getVersion', () => app.getVersion())

// ── Shell ─────────────────────────────────────────────────────────────────────
ipcMain.handle('shell:openPath', (_e, filePath: string) => {
  if (typeof filePath !== 'string') return
  // Restringir a rutas dentro de userData para evitar path traversal
  const resolved = path.resolve(filePath)
  const userData = app.getPath('userData')
  if (!resolved.startsWith(userData)) return
  return shell.openPath(resolved)
})

// ── WhatsApp ──────────────────────────────────────────────────────────────────
ipcMain.handle('whatsapp:status', () => ({ connected: waConnected, phone: waPhone }))

ipcMain.handle('whatsapp:getGroups', async () => {
  if (!waSocket || !waConnected) return []
  try {
    const groups = await waSocket.groupFetchAllParticipating()
    return Object.values(groups).map(g => ({ jid: g.id, name: g.subject }))
  } catch { return [] }
})

ipcMain.handle('whatsapp:connect', async () => {
  if (!mainWindow) return
  await iniciarWhatsApp(mainWindow)
})

ipcMain.handle('whatsapp:sendMessage', async (_e, jid: string, text: string, contacto?: string, telefono?: string) => {
  if (!waSocket || !waConnected) return { success: false, error: 'No conectado' }
  try {
    await waSocket.sendMessage(jid, { text })
    saveMensaje({
      id: Date.now(), contacto: contacto ?? jid.split('@')[0], telefono: telefono ?? jid.split('@')[0],
      mensaje: text, fecha: new Date().toISOString(),
      tipo: 'saliente', procesado: 1, jid, canal: 'whatsapp', wa_numero: waPhone,
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
})

ipcMain.handle('whatsapp:disconnect', async () => {
  if (waSocket) {
    try { await waSocket.logout() } catch {}
    try { await waSocket.end(undefined) } catch {}
    waSocket = null
  }
  waConnected = false; waPhone = null; waConnecting = false
  const sessionDir = path.join(app.getPath('userData'), 'wa-session')
  if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true })
  mainWindow?.webContents.send('whatsapp:statusChange', { connected: false, phone: null })
  return { success: true }
})

// ── Messenger ─────────────────────────────────────────────────────────────────
ipcMain.handle('messenger:status', () => getMessengerStatus())

ipcMain.handle('messenger:start', async (_e, pageToken: string) => {
  if (!mainWindow) return { success: false, error: 'No hay ventana principal' }
  await startMessengerPolling(pageToken, mainWindow)
  return { success: true }
})

ipcMain.handle('messenger:stop', () => {
  stopMessengerPolling()
  return { success: true }
})

ipcMain.handle('messenger:sendMessage', async (_e, psid: string, text: string) => {
  return await sendMessengerMessage(psid, text)
})

// ── Facebook OAuth ────────────────────────────────────────────────────────────

function fbGet(path: string, token: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const sep = path.includes('?') ? '&' : '?'
    const req = https.request(
      { hostname: 'graph.facebook.com', path: `/v18.0${path}${sep}access_token=${encodeURIComponent(token)}`, method: 'GET' },
      res => {
        let data = ''
        res.on('data', c => { data += c })
        res.on('end', () => { try { resolve(JSON.parse(data) as Record<string, unknown>) } catch { reject(new Error('parse')) } })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => req.destroy(new Error('timeout')))
    req.end()
  })
}

ipcMain.handle('facebook:status', () => {
  const e = getEmpresa() as Record<string, unknown> | null
  return {
    connected: !!(e?.messenger_page_token),
    pageName:  (e?.facebook_page_name as string) ?? null,
    pageId:    (e?.facebook_page_id   as string) ?? null,
  }
})

ipcMain.handle('facebook:logout', () => {
  stopMessengerPolling()
  clearFacebookPage()
  mainWindow?.webContents.send('messenger:status', { running: false })
  return { success: true }
})

ipcMain.handle('facebook:selectPage', async (_e, pageToken: string, pageName: string, pageId: string) => {
  setFacebookPage(pageToken, pageName, pageId)
  if (mainWindow) await startMessengerPolling(pageToken, mainWindow)
  return { success: true }
})

ipcMain.handle('facebook:login', () => {
  if (!mainWindow) return { success: false, error: 'No hay ventana principal' }

  const APP_ID      = '1031076559344416'
  const REDIRECT    = 'https://www.facebook.com/connect/login_success.html'
  const SCOPE       = 'pages_show_list,pages_messaging,pages_read_engagement'
  const authUrl     =
    `https://www.facebook.com/v18.0/dialog/oauth` +
    `?client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    `&scope=${SCOPE}` +
    `&response_type=token`

  return new Promise<Record<string, unknown>>(resolve => {
    const authWin = new BrowserWindow({
      width: 580, height: 720,
      parent: mainWindow!, modal: true, show: false,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    })

    // User-agent de Chrome estándar para que Facebook no bloquee la ventana de Electron
    authWin.webContents.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    )
    authWin.loadURL(authUrl)
    authWin.once('ready-to-show', () => authWin.show())

    let done = false

    const handleUrl = async (url: string) => {
      if (done) return
      if (!url.includes('login_success.html') && !url.includes('access_token=')) return

      // Extraer token antes de decidir si ya está listo
      // (will-redirect puede disparar con login_success.html pero sin el hash aún)
      let accessToken: string | null = null
      let errorCode: string | null = null
      try {
        const u = new URL(url)
        const hash  = new URLSearchParams(u.hash.replace('#', ''))
        const query = new URLSearchParams(u.search.replace('?', ''))
        accessToken = hash.get('access_token') ?? query.get('access_token')
        errorCode   = hash.get('error')        ?? query.get('error')
      } catch { /* URL inválida */ }

      // Si no hay token ni error todavía, esperar el próximo evento de navegación
      if (!accessToken && !errorCode) return

      done = true
      if (!authWin.isDestroyed()) authWin.close()

      if (errorCode) {
        resolve({ success: false, error: `Facebook devolvió error: ${errorCode}` })
        return
      }
      if (!accessToken) {
        resolve({ success: false, error: 'No se recibió el token de acceso' })
        return
      }

      // Obtener páginas que administra el usuario
      try {
        const resp  = await fbGet('/me/accounts?fields=name,access_token,id&limit=20', accessToken)
        const pages = (resp.data as Array<{ id: string; name: string; access_token: string }>) ?? []

        if (pages.length === 0) {
          resolve({ success: false, noPage: true })
          return
        }

        if (pages.length === 1) {
          // Auto-seleccionar la única página
          const pg = pages[0]
          setFacebookPage(pg.access_token, pg.name, pg.id)
          if (mainWindow) await startMessengerPolling(pg.access_token, mainWindow)
          resolve({ success: true, pageName: pg.name, pageId: pg.id })
        } else {
          // Devolver lista para que el usuario elija
          resolve({ success: true, pages })
        }
      } catch (e) {
        resolve({ success: false, error: `Error obteniendo páginas: ${String(e)}` })
      }
    }

    authWin.webContents.on('will-redirect',       (_ev, url) => { void handleUrl(url) })
    authWin.webContents.on('did-navigate',         (_ev, url) => { void handleUrl(url) })
    authWin.webContents.on('did-navigate-in-page', (_ev, url) => { void handleUrl(url) })

    authWin.on('closed', () => {
      if (!done) { done = true; resolve({ success: false, cancelled: true }) }
    })
  })
})

// ── Licencias ─────────────────────────────────────────────────────────────────
ipcMain.handle('licencia:get', () => getLicencia())

ipcMain.handle('licencia:activar', async (_e, clave: string) => {
  const key = clave.trim().toUpperCase()
  const fmtRegex = /^ALENGO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
  if (!fmtRegex.test(key)) {
    return { success: false, error: 'Formato inválido. La clave debe ser ALENGO-XXXX-XXXX-XXXX' }
  }
  const fingerprint = getFingerprint()
  try {
    const data = await licenseRequest('/activate', {
      method: 'POST', body: JSON.stringify({ key, fingerprint }),
    })
    if (!data.success) return { success: false, error: data.error ?? 'Clave inválida' }
    const hoy = new Date().toISOString().split('T')[0]
    saveLicencia({
      clave: key,
      empresa: data.empresa as string,
      email:   data.email   as string | null,
      plan:    data.plan    as string | null,
      fecha_activacion:   hoy,
      fecha_vencimiento:  data.fecha_vencimiento as string,
    })
    return { success: true, licencia: getLicencia() }
  } catch {
    return { success: false, error: 'No se pudo conectar al servidor de licencias. Verifica tu conexión a internet.' }
  }
})

ipcMain.handle('licencia:check', async () => {
  const lic = getLicencia()
  if (!lic) return { valid: false, reason: 'none' }

  const hoy      = new Date().toISOString().split('T')[0]
  const venc     = lic.fecha_vencimiento as string
  if (venc < hoy) return { valid: false, reason: 'expired' }

  const diasRestantes = Math.floor((new Date(venc).getTime() - Date.now()) / 86_400_000)
  const ultimaVal     = lic.ultima_validacion as string | null
  const WEEK_MS       = 7 * 24 * 60 * 60 * 1000

  const needsRevalidation = !ultimaVal ||
    (Date.now() - new Date(ultimaVal).getTime()) > WEEK_MS

  if (needsRevalidation) {
    try {
      const fingerprint = getFingerprint()
      const data = await licenseRequest(
        `/validate?key=${encodeURIComponent(lic.clave as string)}&fingerprint=${fingerprint}`
      )
      if (!data.valid) return { valid: false, reason: data.error === 'pc_mismatch' ? 'pc_mismatch' : 'revoked' }
      updateLicenciaValidacion()
    } catch {
      // Offline — grace period de 7 días desde ultima_validacion
      if (!ultimaVal || (Date.now() - new Date(ultimaVal).getTime()) > WEEK_MS) {
        return { valid: false, reason: 'offline' }
      }
    }
  }

  return { valid: true, diasRestantes, empresa: lic.empresa, vencimiento: venc, plan: lic.plan ?? '1y' }
})

ipcMain.handle('licencia:eliminar', () => {
  deleteLicencia()
  return { success: true }
})

// ── Bot ───────────────────────────────────────────────────────────────────────
ipcMain.handle('bot:getModo', () => getBotModo())

ipcMain.handle('bot:setModo', (_e, modo: string) => {
  setBotModo(modo)
  return { success: true }
})

ipcMain.handle('bot:test', async (_e, texto: string, senderName = 'Cliente') => {
  const respuestas: string[] = []
  const sendFn: SendFn = async (_jid: string, text: string) => {
    respuestas.push(text)
  }
  await procesarMensaje('__TEST__', 'whatsapp', texto, senderName, sendFn)
  return respuestas
})

ipcMain.handle('bot:resetTest', () => {
  deleteBotConversation('__TEST__')
  return { success: true }
})

// ── Mensajes ──────────────────────────────────────────────────────────────────
ipcMain.handle('mensajes:getAll', () => getMensajes(waPhone))
ipcMain.handle('mensajes:save', (_e, data) => { saveMensaje({ ...data, wa_numero: waPhone }); return { success: true } })

// ── Rutas Config ──────────────────────────────────────────────────────────────
ipcMain.handle('rutasConfig:get', () => getRutasConfig())
ipcMain.handle('rutasConfig:update', (_e, rutaId: number, precio: number, horarios: string[], duracionHoras?: number) => {
  upsertRutaConfig(rutaId, precio, horarios, duracionHoras)
  return { success: true }
})

// ── Clientes ──────────────────────────────────────────────────────────────────
ipcMain.handle('clientes:get', () => getClientes())
ipcMain.handle('clientes:getByTelefono', (_e, telefono: string) => getCliente(telefono))

// ── Preguntas Frecuentes ──────────────────────────────────────────────────────
ipcMain.handle('faq:get', () => getFAQ())
ipcMain.handle('faq:create', (_e, pregunta: string, respuesta: string) => createFAQ(pregunta, respuesta))
ipcMain.handle('faq:update', (_e, id: number, pregunta: string, respuesta: string) => { updateFAQ(id, pregunta, respuesta); return { success: true } })
ipcMain.handle('faq:delete', (_e, id: number) => { deleteFAQ(id); return { success: true } })

// ── Tarifas Encomiendas ───────────────────────────────────────────────────────
ipcMain.handle('tarifasEnc:get', () => getTarifasEncomiendas())
ipcMain.handle('tarifasEnc:upsert', (_e, destino: string, precioBase: number, recargoPorKg: number) => {
  upsertTarifaEncomienda(destino, precioBase, recargoPorKg)
  return { success: true }
})

// ── Tarifas Zonas ─────────────────────────────────────────────────────────────
ipcMain.handle('tarifasZonas:get', (_e, ciudad?: string, tipo?: string) => getTarifasZonas(ciudad, tipo))
ipcMain.handle('tarifasZonas:upsert', (_e, ciudad: string, zona: string, tipo: string, recargo: number) => {
  upsertTarifaZona(ciudad, zona, tipo, recargo)
  return { success: true }
})
ipcMain.handle('tarifasEncTamanos:get', () => getTarifasEncTamanos())
ipcMain.handle('tarifasEncTamanos:upsert', (_e, id: number | null, descripcion: string, precio: number) => {
  upsertTarifaEncTamano(id, descripcion, precio)
  return { success: true }
})

// ── Viaje Grupos ──────────────────────────────────────────────────────────────
ipcMain.handle('viajeGrupos:get',          (_e, fecha: string)               => getViajeGrupos(fecha))
ipcMain.handle('viajeGrupos:getViajes',    (_e, grupoId: number)             => getViajesByGrupo(grupoId))
ipcMain.handle('viajeGrupos:updateEstado', (_e, grupoId: number, estado: string) => updateViajeGrupoEstado(grupoId, estado))

// ── Ediciones Turnos ──────────────────────────────────────────────────────────
ipcMain.handle('edicionTurnos:save', (_e, fecha: string, textoGenerado: string, textoEditado: string) => {
  saveEdicionTurnos(fecha, textoGenerado, textoEditado)
  return { success: true }
})

// ── Shell ─────────────────────────────────────────────────────────────────────
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return
  return shell.openExternal(url)
})

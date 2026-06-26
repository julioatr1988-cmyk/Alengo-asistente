import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Ventana
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },

  // Empresa
  empresa: {
    get:         () => ipcRenderer.invoke('empresa:get'),
    update:      (data: unknown) => ipcRenderer.invoke('empresa:update', data),
    selectLogo:  () => ipcRenderer.invoke('empresa:selectLogo'),
    removeLogo:  () => ipcRenderer.invoke('empresa:removeLogo'),
  },

  // Choferes
  choferes: {
    get:    () => ipcRenderer.invoke('choferes:get'),
    create: (data: unknown) => ipcRenderer.invoke('choferes:create', data),
    update: (data: unknown) => ipcRenderer.invoke('choferes:update', data),
  },

  // Rutas
  rutas: {
    get: () => ipcRenderer.invoke('rutas:get'),
  },

  // Viajes
  viajes: {
    get:      (fecha?: string) => ipcRenderer.invoke('viajes:get', fecha),
    getById:  (id: number)     => ipcRenderer.invoke('viajes:getById', id),
    create:   (data: unknown)  => ipcRenderer.invoke('viajes:create', data),
    update:   (data: unknown)  => ipcRenderer.invoke('viajes:update', data),
    delete:   (id: number)     => ipcRenderer.invoke('viajes:delete', id),
  },

  // Turnos
  turnos: {
    porRuta: (rutaId: number)          => ipcRenderer.invoke('turnos:porRuta', rutaId),
    asignar: (rutaId: number, hora: string) => ipcRenderer.invoke('turnos:asignar', rutaId, hora),
  },

  // Reportes
  reportes: {
    chofer: (choferId: number, desde: string, hasta: string) =>
      ipcRenderer.invoke('reportes:chofer', choferId, desde, hasta),
  },

  // Mensualidades
  mensualidades: {
    get:    (mes: number, anio: number)    => ipcRenderer.invoke('mensualidades:get', mes, anio),
    chofer: (choferId: number, anio: number) => ipcRenderer.invoke('mensualidades:chofer', choferId, anio),
    pagar:  (data: unknown)                => ipcRenderer.invoke('mensualidades:pagar', data),
  },

  // Mensajes
  mensajes: {
    getAll: () => ipcRenderer.invoke('mensajes:getAll'),
    save:   (data: unknown) => ipcRenderer.invoke('mensajes:save', data),
  },

  // Rutas Config
  rutasConfig: {
    get:    () => ipcRenderer.invoke('rutasConfig:get'),
    update: (rutaId: number, precio: number, horarios: string[], duracionHoras?: number) =>
      ipcRenderer.invoke('rutasConfig:update', rutaId, precio, horarios, duracionHoras),
  },

  // Viaje Grupos
  viajeGrupos: {
    get:          (fecha: string)           => ipcRenderer.invoke('viajeGrupos:get', fecha),
    getViajes:    (grupoId: number)         => ipcRenderer.invoke('viajeGrupos:getViajes', grupoId),
    updateEstado: (grupoId: number, estado: string) => ipcRenderer.invoke('viajeGrupos:updateEstado', grupoId, estado),
  },

  // Viajes events
  viajesEvents: {
    onCreated:       (cb: (viaje: unknown) => void) => ipcRenderer.on('viajes:created',  (_e, v) => cb(v)),
    onUpdated:       (cb: () => void)               => ipcRenderer.on('viajes:updated',  () => cb()),
    removeListeners: () => {
      ipcRenderer.removeAllListeners('viajes:created')
      ipcRenderer.removeAllListeners('viajes:updated')
    },
  },

  // Clientes
  clientes: {
    get:          () => ipcRenderer.invoke('clientes:get'),
    getByTelefono: (tel: string) => ipcRenderer.invoke('clientes:getByTelefono', tel),
    onUpdated:    (cb: () => void) => ipcRenderer.on('clientes:updated', () => cb()),
  },

  // Tarifas Encomiendas
  tarifasEncomiendas: {
    get:    () => ipcRenderer.invoke('tarifasEnc:get'),
    upsert: (destino: string, precioBase: number, recargoPorKg: number) =>
      ipcRenderer.invoke('tarifasEnc:upsert', destino, precioBase, recargoPorKg),
  },

  // Preguntas Frecuentes
  faq: {
    get:    () => ipcRenderer.invoke('faq:get'),
    create: (pregunta: string, respuesta: string) => ipcRenderer.invoke('faq:create', pregunta, respuesta),
    update: (id: number, pregunta: string, respuesta: string) => ipcRenderer.invoke('faq:update', id, pregunta, respuesta),
    delete: (id: number) => ipcRenderer.invoke('faq:delete', id),
  },

  // WhatsApp
  whatsapp: {
    getStatus:   () => ipcRenderer.invoke('whatsapp:status'),
    connect:     () => ipcRenderer.invoke('whatsapp:connect'),
    sendMessage: (jid: string, text: string, contacto?: string, telefono?: string) =>
      ipcRenderer.invoke('whatsapp:sendMessage', jid, text, contacto, telefono),
    disconnect:  () => ipcRenderer.invoke('whatsapp:disconnect'),
    onQR:        (cb: (qr: string) => void)            => ipcRenderer.on('whatsapp:qr',          (_e, qr)  => cb(qr)),
    onConnected: (cb: (data: unknown) => void)          => ipcRenderer.on('whatsapp:connected',    (_e, d)   => cb(d)),
    onStatus:    (cb: (s: unknown) => void)             => ipcRenderer.on('whatsapp:statusChange', (_e, s)   => cb(s)),
    onMessage:   (cb: (msg: unknown) => void)           => ipcRenderer.on('whatsapp:message',      (_e, msg) => cb(msg)),
    onError:     (cb: (err: string) => void)            => ipcRenderer.on('whatsapp:error',        (_e, err) => cb(err)),
    onHistorial: (cb: (convs: unknown) => void)        => ipcRenderer.on('whatsapp:historial',    (_e, convs) => cb(convs)),
    onGrupos:    (cb: (grupos: unknown) => void)       => ipcRenderer.on('whatsapp:grupos',       (_e, grupos) => cb(grupos)),
    getGroups:   () => ipcRenderer.invoke('whatsapp:getGroups'),
    removeListeners: () => {
      ipcRenderer.removeAllListeners('whatsapp:qr')
      ipcRenderer.removeAllListeners('whatsapp:connected')
      ipcRenderer.removeAllListeners('whatsapp:statusChange')
      ipcRenderer.removeAllListeners('whatsapp:message')
      ipcRenderer.removeAllListeners('whatsapp:error')
      ipcRenderer.removeAllListeners('whatsapp:historial')
      ipcRenderer.removeAllListeners('whatsapp:grupos')
    },
  },

  // Messenger
  messenger: {
    getStatus:   () => ipcRenderer.invoke('messenger:status'),
    start:       (pageToken: string) => ipcRenderer.invoke('messenger:start', pageToken),
    stop:        () => ipcRenderer.invoke('messenger:stop'),
    sendMessage: (psid: string, text: string) => ipcRenderer.invoke('messenger:sendMessage', psid, text),
    onMessage:   (cb: (msg: unknown) => void)    => ipcRenderer.on('messenger:message', (_e, msg) => cb(msg)),
    onStatus:    (cb: (s: unknown) => void)       => ipcRenderer.on('messenger:status',  (_e, s)   => cb(s)),
    removeListeners: () => {
      ipcRenderer.removeAllListeners('messenger:message')
      ipcRenderer.removeAllListeners('messenger:status')
    },
  },

  // Facebook OAuth
  facebook: {
    status:     () => ipcRenderer.invoke('facebook:status'),
    login:      () => ipcRenderer.invoke('facebook:login'),
    logout:     () => ipcRenderer.invoke('facebook:logout'),
    selectPage: (token: string, name: string, id: string) => ipcRenderer.invoke('facebook:selectPage', token, name, id),
  },

  // Licencias
  licencia: {
    get:      () => ipcRenderer.invoke('licencia:get'),
    activar:  (clave: string) => ipcRenderer.invoke('licencia:activar', clave),
    check:    () => ipcRenderer.invoke('licencia:check'),
    eliminar: () => ipcRenderer.invoke('licencia:eliminar'),
  },

  // Bot
  bot: {
    getModo:    ()                        => ipcRenderer.invoke('bot:getModo'),
    setModo:    (modo: string)            => ipcRenderer.invoke('bot:setModo', modo),
    test:       (texto: string, nombre?: string) => ipcRenderer.invoke('bot:test', texto, nombre),
    resetTest:  ()                        => ipcRenderer.invoke('bot:resetTest'),
  },

  // Tarifas Zonas
  tarifasZonas: {
    get:    (ciudad?: string, tipo?: string) => ipcRenderer.invoke('tarifasZonas:get', ciudad, tipo),
    upsert: (ciudad: string, zona: string, tipo: string, recargo: number) =>
      ipcRenderer.invoke('tarifasZonas:upsert', ciudad, zona, tipo, recargo),
  },

  // Tarifas Encomienda Tamaños
  tarifasEncTamanos: {
    get:    () => ipcRenderer.invoke('tarifasEncTamanos:get'),
    upsert: (id: number | null, descripcion: string, precio: number) =>
      ipcRenderer.invoke('tarifasEncTamanos:upsert', id, descripcion, precio),
  },

  // Ediciones Turnos
  edicionTurnos: {
    save: (fecha: string, textoGenerado: string, textoEditado: string) =>
      ipcRenderer.invoke('edicionTurnos:save', fecha, textoGenerado, textoEditado),
  },

  // App
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },

  // Shell
  shell: {
    openPath:     (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
    openExternal: (url: string)      => ipcRenderer.invoke('shell:openExternal', url),
  },

  // Actualizador
  actualizador: {
    onUpdateAvailable:  (cb: (version: string) => void) => ipcRenderer.on('update:available',  (_e, v) => cb(v)),
    onUpdateDownloaded: (cb: () => void)                => ipcRenderer.on('update:downloaded', () => cb()),
    onUpdateProgress:   (cb: (p: number) => void)       => ipcRenderer.on('update:progress',   (_e, p) => cb(p)),
    onUpdateError:      (cb: (msg: string) => void)     => ipcRenderer.on('update:error',      (_e, m) => cb(m)),
    installUpdate:      ()                              => ipcRenderer.invoke('update:install'),
    removeListeners:    () => {
      ipcRenderer.removeAllListeners('update:available')
      ipcRenderer.removeAllListeners('update:downloaded')
      ipcRenderer.removeAllListeners('update:progress')
      ipcRenderer.removeAllListeners('update:error')
    },
  },
})

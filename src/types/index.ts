export interface Empresa {
  id: number
  nombre: string
  telefono: string
  whatsapp_numero: string
  logo: string
  grupo_operativo_id: string
  tarifa_mensual: number
  cupo_maximo: number
  messenger_page_token?: string
  facebook_page_name?: string
  facebook_page_id?: string
}

export interface FacebookStatus {
  connected: boolean
  pageName: string | null
  pageId: string | null
}

export interface FacebookPage {
  id: string
  name: string
  access_token: string
}

export type FacebookLoginResult =
  | { success: true; pageName: string; pageId: string }
  | { success: true; pages: FacebookPage[] }
  | { success: false; noPage: true }
  | { success: false; cancelled: true }
  | { success: false; error: string }

export interface Ruta {
  id: number
  codigo: string
  nombre: string
  precio_base: number
}

export interface Chofer {
  id: number
  nombre: string
  telefono: string
  numero_placa: string
  digito_placa: number
  grupo_wa_id: string
  activo: number
  orden_turno_quito: number
  orden_turno_santo: number
  orden_turno_manta: number
  orden_turno_guayaquil: number
  tarifa_mensual: number
  posicion?: number
  ultima_salida?: string
  rutas_asignadas?: string
  ciudad_actual?: string
}

export interface RutaConfig {
  ruta_id: number
  codigo: string
  nombre: string
  precio: number
  horarios: string
  duracion_horas?: number
}

export interface Cliente {
  id: number
  telefono: string
  nombre: string | null
  verificado: number
  foto_verificacion: string | null
  fecha_registro: string
  origen?: string | null
  actualizado_en?: string | null
}

export interface ClienteImportRow {
  telefono: string
  nombre: string
  existe: boolean
  nombreActual: string | null
}

export interface FAQ {
  id: number
  pregunta_clave: string
  respuesta: string
  activo: number
  created_at: string
}

export type TipoViaje = 'pasajero' | 'encomienda' | 'express' | 'flete'
export type EstadoViaje = 'pendiente' | 'confirmado' | 'en_curso' | 'completado' | 'cancelado'

export interface Viaje {
  id: number
  fecha: string
  hora: string
  ruta_id: number
  chofer_id: number
  tipo: TipoViaje
  cant_pasajeros: number
  encomiendas: string
  monto: number
  observaciones: string
  estado: EstadoViaje
  cliente_nombre: string
  cliente_telefono: string
  telefono_contacto?: string
  origen: string
  destino: string
  wa_enviado: number
  hora_llegada_estimada?: string
  viaje_grupo_id?: number
  requiere_factura?: number
  created_at: string
  // Joins
  chofer_nombre?: string
  digito_placa?: number
  chofer_grupo_wa_id?: string
  ruta_codigo?: string
  ruta_nombre?: string
}

export interface Mensualidad {
  id: number
  chofer_id: number
  mes: number
  anio: number
  monto: number
  pagado: number
  fecha_pago: string | null
  notas: string | null
  chofer_nombre?: string
  numero_placa?: string
  digito_placa?: number
}

export type Canal = 'whatsapp' | 'messenger'

export interface MensajeWA {
  id: number
  contacto: string
  telefono: string
  mensaje: string
  fecha: string
  tipo: 'entrante' | 'saliente'
  procesado: number
  jid: string
  canal?: Canal
  messenger_psid?: string
}

export interface WhatsAppStatus {
  connected: boolean
  phone: string | null
}

export interface ViajeGrupo {
  id: number
  ruta_id: number
  fecha: string
  hora: string
  chofer_id: number | null
  cupo_maximo: number
  cupo_ocupado: number
  estado: string
  created_at: string
  // Joins
  chofer_nombre?: string
  digito_placa?: number
  chofer_grupo_wa_id?: string
  ruta_codigo?: string
  ruta_nombre?: string
  total_monto?: number
  cant_encomiendas?: number
}

export interface WhatsAppGroup {
  jid: string
  name: string
}

export interface TarifaEncomienda {
  id: number
  destino: string
  precio_base: number
  recargo_por_kg: number
}

export interface TarifaZona {
  id: number
  ciudad: string
  zona: string
  tipo: string
  recargo: number
  activo: number
}

export interface TarifaEncTamano {
  id: number
  descripcion: string
  precio: number
  activo: number
}

export interface Licencia {
  id: number
  clave: string
  empresa: string
  email: string | null
  plan: string | null
  fecha_activacion: string
  fecha_vencimiento: string
  ultima_validacion: string | null
}

export type LicenciaStatus = 'loading' | 'none' | 'expired' | 'revoked' | 'offline' | 'valid' | 'pc_mismatch'
export type BotModo = 'auto' | 'manual'

export interface LicenciaCheckResult {
  valid: boolean
  reason?: 'none' | 'expired' | 'revoked' | 'offline' | 'pc_mismatch'
  diasRestantes?: number
  empresa?: string
  vencimiento?: string
  plan?: string
}

export interface MessengerStatus {
  running: boolean
  pageId?: string
  error?: string
}

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
      }
      empresa: {
        get:        () => Promise<Empresa>
        update:     (data: Partial<Empresa>) => Promise<Empresa>
        selectLogo: () => Promise<{ success: boolean; logo?: string; error?: string }>
        removeLogo: () => Promise<{ success: boolean }>
      }
      choferes: {
        get: () => Promise<Chofer[]>
        create: (data: Partial<Chofer>) => Promise<Chofer>
        update: (data: Partial<Chofer>) => Promise<Chofer>
      }
      rutas: {
        get: () => Promise<Ruta[]>
      }
      viajes: {
        get: (fecha?: string) => Promise<Viaje[]>
        getById: (id: number) => Promise<Viaje>
        create: (data: Partial<Viaje>) => Promise<Viaje>
        update: (data: Partial<Viaje>) => Promise<Viaje>
        delete: (id: number) => Promise<{ success: boolean }>
      }
      turnos: {
        porRuta: (rutaId: number) => Promise<Chofer[]>
        asignar: (rutaId: number, hora: string) => Promise<Chofer | null>
      }
      reportes: {
        chofer: (choferId: number, desde: string, hasta: string) => Promise<Viaje[]>
      }
      mensualidades: {
        get: (mes: number, anio: number) => Promise<Mensualidad[]>
        chofer: (choferId: number, anio: number) => Promise<Mensualidad[]>
        pagar: (data: Partial<Mensualidad> & { id: number }) => Promise<{ success: boolean }>
      }
      mensajes: {
        getAll: () => Promise<MensajeWA[]>
        save:   (data: Partial<MensajeWA>) => Promise<{ success: boolean }>
      }
      rutasConfig: {
        get:    () => Promise<RutaConfig[]>
        update: (rutaId: number, precio: number, horarios: string[], duracionHoras?: number) => Promise<{ success: boolean }>
      }
      viajeGrupos: {
        get:          (fecha: string) => Promise<ViajeGrupo[]>
        getViajes:    (grupoId: number) => Promise<Viaje[]>
        updateEstado: (grupoId: number, estado: string) => Promise<{ success: boolean }>
      }
      viajesEvents: {
        onCreated:       (cb: (viaje: Viaje) => void) => void
        onUpdated:       (cb: () => void) => void
        removeListeners: () => void
      }
      clientes: {
        get:                    () => Promise<Cliente[]>
        getByTelefono:          (tel: string) => Promise<Cliente | null>
        create:                 (data: { telefono: string; nombre: string }) => Promise<Cliente>
        importarBatch:          (rows: Array<{ telefono: string; nombre: string; origen: string }>) => Promise<{ success: boolean; count: number }>
        extractContactsFromDoc: (filePath: string, ext: string, filename: string) => Promise<{
          success: boolean
          contacts?: Array<{ nombre: string; telefono: string }>
          error?: string
          error_code?: string
        }>
        getNombres:             () => Promise<Record<string, string>>
        onUpdated:              (cb: () => void) => void
      }
      tarifasEncomiendas: {
        get:    () => Promise<TarifaEncomienda[]>
        upsert: (destino: string, precioBase: number, recargoPorKg: number) => Promise<{ success: boolean }>
      }
      tarifasZonas: {
        get:    (ciudad?: string, tipo?: string) => Promise<TarifaZona[]>
        upsert: (ciudad: string, zona: string, tipo: string, recargo: number) => Promise<{ success: boolean }>
      }
      tarifasEncTamanos: {
        get:    () => Promise<TarifaEncTamano[]>
        upsert: (id: number | null, descripcion: string, precio: number) => Promise<{ success: boolean }>
      }
      faq: {
        get:    () => Promise<FAQ[]>
        create: (pregunta: string, respuesta: string) => Promise<FAQ>
        update: (id: number, pregunta: string, respuesta: string) => Promise<{ success: boolean }>
        delete: (id: number) => Promise<{ success: boolean }>
      }
      whatsapp: {
        getStatus: () => Promise<WhatsAppStatus>
        connect: () => Promise<void>
        sendMessage: (jid: string, text: string, contacto?: string, telefono?: string) => Promise<{ success: boolean; error?: string }>
        disconnect: () => Promise<{ success: boolean }>
        onQR: (cb: (qr: string) => void) => void
        onConnected: (cb: (data: { phone: string | null }) => void) => void
        onStatus: (cb: (status: WhatsAppStatus) => void) => void
        onMessage:   (cb: (msg: MensajeWA) => void) => void
        onError:     (cb: (err: string) => void) => void
        onHistorial: (cb: (convs: Array<{ jid: string; contacto: string; telefono: string; mensajes: MensajeWA[]; esGrupo?: boolean }>) => void) => void
        onGrupos:    (cb: (grupos: Array<{ jid: string; name: string }>) => void) => void
        getGroups:   () => Promise<Array<{ jid: string; name: string }>>
        removeListeners: () => void
      }
      messenger: {
        getStatus: () => Promise<MessengerStatus>
        start: (pageToken: string) => Promise<{ success: boolean; error?: string }>
        stop: () => Promise<{ success: boolean }>
        sendMessage: (psid: string, text: string) => Promise<{ success: boolean; error?: string }>
        onMessage: (cb: (msg: MensajeWA) => void) => void
        onStatus: (cb: (status: MessengerStatus) => void) => void
        removeListeners: () => void
      }
      facebook: {
        status:     () => Promise<FacebookStatus>
        login:      () => Promise<FacebookLoginResult>
        logout:     () => Promise<{ success: boolean }>
        selectPage: (token: string, name: string, id: string) => Promise<{ success: boolean }>
      }
      licencia: {
        get:      () => Promise<Licencia | null>
        activar:  (clave: string) => Promise<{ success: boolean; error?: string; licencia?: Licencia }>
        check:    () => Promise<LicenciaCheckResult>
        eliminar: () => Promise<{ success: boolean }>
      }
      bot: {
        getModo:   () => Promise<BotModo>
        setModo:   (modo: BotModo) => Promise<{ success: boolean }>
        test:      (texto: string, nombre?: string) => Promise<string[]>
        resetTest: () => Promise<{ success: boolean }>
      }
      edicionTurnos: {
        save: (fecha: string, textoGenerado: string, textoEditado: string) => Promise<{ success: boolean }>
      }
      app: {
        getVersion: () => Promise<string>
      }
      shell: {
        openPath:     (filePath: string) => Promise<string>
        openExternal: (url: string)      => Promise<void>
      }
      actualizador: {
        onUpdateAvailable:  (cb: (version: string) => void) => void
        onUpdateDownloaded: (cb: () => void) => void
        onUpdateProgress:   (cb: (percent: number) => void) => void
        onUpdateError:      (cb: (msg: string) => void) => void
        installUpdate:      () => Promise<void>
        removeListeners:    () => void
      }
      contactos: {
        getNombres: () => Promise<Record<string, string>>
      }
    }
  }
}

import {
  getBotConversation, upsertBotConversation, deleteBotConversation,
  getRutas, getEmpresa,
  getRutasConfig, saveMensaje,
  getCliente, createCliente, getFAQ,
  getTarifasEncomiendas, getTarifasZonas, getTarifasEncTamanos,
  createViajeConGrupo, getViajesByGrupo,
  getMostRecentViajeByPhone, cancelarViaje,
} from './database'

function normalizePhone(raw: string): string {
  return raw
    .replace(/@.*$/, '')     // quitar @c.us / @s.whatsapp.net
    .replace(/[^\d]/g, '')   // solo dígitos
    .replace(/^0+/, '')      // quitar ceros iniciales
    .replace(/^593/, '')     // quitar código de país Ecuador
}

type Canal = 'whatsapp' | 'messenger'
type BotEstado =
  | 'idle'
  | 'pedir_verificacion'
  | 'pedir_destino'
  | 'pedir_fecha_hora'
  | 'pedir_pasajeros'
  | 'pedir_nombre'
  | 'pedir_para_quien'
  | 'pedir_telefono'
  | 'pedir_origen'
  | 'pedir_factura'
  | 'pedir_zona'
  // Flujo encomienda
  | 'pedir_destino_enc'
  | 'pedir_tamano_enc'
  | 'pedir_zona_enc'
  | 'pedir_remitente_enc'
  | 'pedir_destinatario_enc'
  | 'pedir_entrega_enc'

interface DatosReserva {
  destino_ciudad?: string
  ruta_id?: number
  fecha?: string
  hora?: string
  cant_pasajeros?: number
  nombre?: string
  telefono?: string
  telefono_contacto?: string
  para_otro?: boolean
  origen?: string
  requiere_factura?: number
  zona_destino?: string
  precio_zona?: number
  tamano_enc?: string
  zona_enc?: string
  // Encomienda
  destino_ciudad_enc?: string
  remitente_nombre?: string
  destinatario_nombre?: string
  destinatario_tel?: string
  entrega_dir?: string
}

export type SendFn   = (jid: string, text: string) => Promise<void>
export type NotifyFn = (viaje: unknown, chofer: unknown) => void

// ── Detección de ciudad ───────────────────────────────────────────────────────

const CIUDADES: Record<string, string[]> = {
  'QUITO':         ['quito', 'uio', 'carapungo', 'quitumbe', 'la marin', 'marin'],
  'GUAYAQUIL':     ['guayaquil', 'guaya', 'gye'],
  'MANTA':         ['manta', 'mta', 'portoviejo'],
  'SANTO DOMINGO': ['santo domingo', 'santodomingo', 'santo', 'sto'],
}

const MAPA_RUTA: Record<string, string> = {
  'QUITO': 'STO-UIO', 'GUAYAQUIL': 'STO-GYE', 'MANTA': 'STO-MTA', 'SANTO DOMINGO': 'UIO-STO',
}

const ZONAS_QUITO: Record<string, string[]> = {
  'Sur':                    ['sur', 'chimbacalle', 'solanda', 'guamani', 'caupicho', 'quitumbe', 'chillogallo'],
  'Centro Norte':           ['centro', 'norte', 'carolina', 'la prensa', 'cotocollao', 'inaquito', 'carcelen alto', 'carcelen alto', 'la y ', 'carapungo norte'],
  'Carcelén bajo':          ['carcelen bajo', 'carcelen bajo', 'carcelen b'],
  'Valle de los Chillos':   ['los chillos', 'chillos', 'sangolqui', 'sangolqui', 'conocoto', 'amaguana', 'amaguana'],
  'Cumbayá':                ['cumbaya', 'cumbaya', 'la vina', 'la vina', 'guangopolo'],
  'Tumbaco':                ['tumbaco'],
  'Puembo':                 ['puembo'],
  'Pifo':                   ['pifo'],
  'Aeropuerto':             ['aeropuerto', 'tababela'],
  'Calderón':               ['calderon', 'calderon', 'caleron'],
  'Carapungo':              ['carapungo'],
  'Pusuquí':                ['pusuqui', 'pusuqui'],
  'Pomasqui':               ['pomasqui'],
  'Mitad del Mundo':        ['mitad del mundo', 'san antonio', 'mitad'],
  'Jaime Roldós':           ['jaime roldo', 'roldos', 'jaime ro'],
  'Guayllabamba':           ['guayllabamba'],
  'Quinche':                ['quinche', 'el quinche'],
  'Alóag':                  ['aloag', 'aloag', 'machachi', 'aloasi', 'aloasi'],
}

const ZONAS_STO: Record<string, string[]> = {
  'El Carmen-Las Delicias-Nuevo Israel': ['el carmen', 'las delicias', 'nuevo israel'],
  'Tenis Club':             ['tenis club'],
  'Rancho San Fernando':    ['rancho san fernando', 'rancho san'],
  'La Concordia':           ['la concordia', 'concordia'],
  'Valle Hermoso':          ['valle hermoso'],
  'El Esfuerzo':            ['el esfuerzo', 'esfuerzo'],
  'Luz de América':         ['luz de america', 'luz de america', 'luz america'],
  'Cade':                   ['cade'],
  'Quinindé':               ['quininde', 'quininde'],
}

function detectarZona(texto: string, ciudad: string): string | null {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const mapa = ciudad === 'QUITO' ? ZONAS_QUITO : ZONAS_STO
  for (const [zona, palabras] of Object.entries(mapa)) {
    if (palabras.some(pp => t.includes(pp))) return zona
  }
  return null
}

function buildZonasMsg(ciudad: string): string {
  const mapa = ciudad === 'QUITO' ? ZONAS_QUITO : ZONAS_STO
  const lista = Object.keys(mapa).map(z => `• ${z}`).join('\n')
  return (
    `¿A qué sector específico de *${ciudad}* le llevamos?\n\n${lista}\n\n` +
    `Por favor indique el nombre del sector o barrio.`
  )
}

function getPrecioZona(ciudad: string, zona: string, tipo: 'pasajero' | 'encomienda'): number | null {
  const zonas = getTarifasZonas(ciudad, tipo)
  const found = zonas.find(z => z.zona === zona)
  return found ? (found.recargo as number) : null
}

function detectarCiudad(texto: string): string | null {
  const t = texto.toLowerCase()
  for (const [ciudad, palabras] of Object.entries(CIUDADES)) {
    if (palabras.some(p => t.includes(p))) return ciudad
  }
  return null
}

// ── Detección de intención ────────────────────────────────────────────────────

function esIntentReservar(texto: string) {
  const t = texto.toLowerCase()
  return /\b(reservar?|reserva|quiero|necesito|agendar?|pedir|solicitar|un\s+viaje|un\s+pasaje|un\s+cupo|un\s+puesto|llevar|taxi|servicio|viaje\s+a|voy\s+a)\b/.test(t)
}

function esConsultaDisponibilidad(texto: string) {
  const t = texto.toLowerCase()
  return /\b(hay\s+(turno|viaje|cupo|disponib|algo|servicio)|disponib|cuándo\s+(sale|hay|tienen)|horari|próximo|a\s+qué\s+hora|qué\s+hora|salen|qué\s+horarios?)\b/.test(t)
}

function esConsultaPrecio(texto: string) {
  const t = texto.toLowerCase()
  return /\b(cuánto\s+cuesta|cuanto\s+cuesta|precio|costo|tarifa|valor|cobran|cuánto\s+es|cuanto\s+es|cuánto\s+me|cuanto\s+me)\b/.test(t)
}

function esIntentEncomienda(texto: string) {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /\b(encomienda|envia[r]?|envio|paquete|caja|carga|remesa|mandar|remitir|mandar\s+algo|necesito\s+enviar|quiero\s+enviar|enviar\s+un|envio\s+de)\b/.test(t)
}

function esGrupo(jid: string) {
  return jid.endsWith('@g.us')
}

type InterrupcionTipo = 'precio' | 'disponibilidad' | 'cancelar' | 'saludo' | null

function detectarInterrupcion(texto: string): InterrupcionTipo {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (/\b(cancelar|olvida|olvídalo|no\s+quiero|no\s+gracias|salir|detener|stop)\b/.test(t)) return 'cancelar'
  if (/\b(cuanto|cuánto|precio|costo|tarifa|valor|cobran|vale|cuesta)\b/.test(t)) return 'precio'
  if (/\b(hay\s*(turno|viaje|cupo|disponib)|horari|que\s+hora|a\s+que\s+hora|cuando\s+sale|proxim|disponib)\b/.test(t)) return 'disponibilidad'
  if (/^(hola|buenas?|buenos\s*(dias?|tardes?|noches?)|hey|hi|hello|saludos?)[\s!.]*$/i.test(t.trim())) return 'saludo'
  return null
}

// ── Parser de fecha/hora ──────────────────────────────────────────────────────

function parseFechaHora(texto: string): { fecha: string; hora: string } | null {
  const ahora = new Date()
  // Normalizar acentos para buscar palabras clave
  const norm = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

  let fecha = ahora.toISOString().slice(0, 10)

  if (norm.includes('pasado') && norm.includes('manana')) {
    const d = new Date(ahora); d.setDate(d.getDate() + 2)
    fecha = d.toISOString().slice(0, 10)
  } else if (norm.includes('manana')) {
    const d = new Date(ahora); d.setDate(d.getDate() + 1)
    fecha = d.toISOString().slice(0, 10)
  }

  // Fecha explícita dd/mm
  const dmMatch = texto.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/)
  if (dmMatch) {
    const day = parseInt(dmMatch[1]), month = parseInt(dmMatch[2]) - 1
    const d = new Date(ahora.getFullYear(), month, day)
    if (d < ahora) d.setFullYear(d.getFullYear() + 1)
    fecha = d.toISOString().slice(0, 10)
  }

  // Hora: formato HH:MM
  const hhmm = texto.match(/\b(\d{1,2}):(\d{2})\b/)
  if (hhmm) {
    return { fecha, hora: `${hhmm[1].padStart(2, '0')}:${hhmm[2]}` }
  }

  // Hora: "a las H", "las H", "H am/pm", "H h"
  const mh = norm.match(/(?:a\s+las?\s+|las?\s+)?(\d{1,2})\s*(am|pm|pm\.|am\.)?(?:\s*(?:h(?:s|oras?)?|hrs?))?(?:\s|$)/)
  if (mh) {
    let h = parseInt(mh[1])
    const suf = (mh[2] ?? '').toLowerCase().replace('.', '')
    if (suf === 'pm' && h < 12) h += 12
    if (suf === 'am' && h === 12) h = 0
    // Sin sufijo: horas < 6 → asumir tarde
    if (!suf && h >= 1 && h <= 5) h += 12
    if (h >= 0 && h <= 23) return { fecha, hora: `${h.toString().padStart(2, '0')}:00` }
  }

  return null
}

// ── Disponibilidad general ────────────────────────────────────────────────────

function buildDisponibilidadMsg(nombreEmpresa: string, ciudadFiltro?: string | null): string {
  const rutasConfig = getRutasConfig()
  const lineas: string[] = []

  const destinos = ciudadFiltro
    ? [ciudadFiltro]
    : ['QUITO', 'SANTO DOMINGO', 'GUAYAQUIL', 'MANTA']

  for (const ciudad of destinos) {
    const cod = MAPA_RUTA[ciudad]
    const cfg = rutasConfig.find((r: Record<string, unknown>) => r.codigo === cod)
    if (!cfg) continue
    const horarios: string[] = JSON.parse((cfg.horarios as string) || '[]')
    const horas = horarios.length > 0
      ? horarios.join(', ')
      : 'consultar disponibilidad'
    lineas.push(`• *${ciudad}*: ${horas}`)
  }

  if (ciudadFiltro) {
    return (
      `Hola 👋 Soy el asistente de *${nombreEmpresa}*.\n\n` +
      `Para *${ciudadFiltro}* tenemos salidas a:\n${lineas.join('\n')}\n\n` +
      `¿Desea reservar? Escriba *RESERVAR*`
    )
  }

  return (
    `Hola 👋 Soy el asistente de *${nombreEmpresa}*.\n\n` +
    `Nuestros horarios de salida:\n${lineas.join('\n')}\n\n` +
    `¿A qué destino desea viajar?`
  )
}

// ── Lógica principal ──────────────────────────────────────────────────────────

export async function procesarMensaje(
  jid: string,
  canal: Canal,
  texto: string,
  senderName: string,
  sendFn: SendFn,
  notifyFn?: NotifyFn,
): Promise<void> {
  if (esGrupo(jid)) return

  const convRow = getBotConversation(jid)
  const estado  = (convRow?.estado as BotEstado) ?? 'idle'
  const datos   = convRow?.datos ? (JSON.parse(convRow.datos as string) as DatosReserva) : {} as DatosReserva
  const rutas   = getRutas()

  const empresa       = getEmpresa()
  const nombreEmpresa = (empresa?.nombre as string) ?? 'Transportes'

  const responder = async (msg: string) => {
    await sendFn(jid, msg)
    saveMensaje({ contacto: nombreEmpresa, mensaje: msg, tipo: 'saliente', jid, canal })
  }

  // ── Casos especiales en idle ──────────────────────────────────────────────
  if (estado === 'idle') {
    const tIdle = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

    // Chofer no llegó
    if (/(?:(?:el\s*)?chofer|conductor).{0,20}(?:no\s+(?:lleg[oó]|apareci[oó]|vino|ha\s+llegado))|(?:no\s+(?:lleg[oó]|apareci[oó]|vino)).{0,10}(?:el\s*)?chofer/.test(tIdle)) {
      const empresa = getEmpresa()
      const tel = empresa?.telefono as string | null
      await responder(
        `Lamentamos mucho los inconvenientes. 😔\n\n` +
        `Por favor comuníquese de inmediato con nuestra operadora:` +
        (tel ? `\n📞 *${tel}*` : '') +
        `\n\nTomaremos acción inmediata para resolver su situación.`
      )
      return
    }

    // Cancelar viaje/reserva
    if (/\b(?:cancelar?\s*(?:mi\s*)?(?:viaje|reserva|pasaje|cupo)|quiero\s+cancelar|quisiera\s+cancelar|necesito\s+cancelar)\b/.test(tIdle)) {
      const phone = normalizePhone(jid.split('@')[0])
      const viajeActivo = getMostRecentViajeByPhone(phone)
      if (viajeActivo) {
        cancelarViaje(viajeActivo.id as number)
        await responder(
          `✅ Su reserva ha sido cancelada.\n\n` +
          `📅 Viaje: *${viajeActivo.fecha}* a las *${viajeActivo.hora}*\n` +
          `🏙️ Destino: ${viajeActivo.destino ?? 'N/A'}\n\n` +
          `Si necesita hacer una nueva reserva, escriba *RESERVAR*. ¡Hasta pronto! 👋`
        )
      } else {
        const empresa = getEmpresa()
        await responder(
          `No encontramos una reserva activa a su nombre para hoy o fechas futuras.\n\n` +
          `Si necesita ayuda, contáctenos al ${(empresa?.telefono as string) ?? 'la empresa'}.`
        )
      }
      return
    }
  }

  // ── Preguntas frecuentes (antes del flujo) ────────────────────────────────
  if (estado === 'idle') {
    const faqEntries = getFAQ() as Array<{ pregunta_clave: string; respuesta: string }>
    const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    for (const faq of faqEntries) {
      const clave = faq.pregunta_clave.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const palabrasLargas = clave.split(/\s+/).filter(w => w.length > 3)
      if (t.includes(clave) || (palabrasLargas.length >= 2 && palabrasLargas.every(w => t.includes(w)))) {
        await responder(faq.respuesta)
        return
      }
    }
  }

  // ── Interrupción mid-flujo: detectar intenciones conocidas ────────────────
  const ESTADOS_CON_INPUT_LIBRE: BotEstado[] = [
    'pedir_destino', 'pedir_zona', 'pedir_fecha_hora', 'pedir_pasajeros',
    'pedir_nombre', 'pedir_para_quien', 'pedir_telefono', 'pedir_origen', 'pedir_factura',
    'pedir_destino_enc', 'pedir_tamano_enc', 'pedir_zona_enc', 'pedir_remitente_enc', 'pedir_destinatario_enc', 'pedir_entrega_enc',
  ]
  const PREGUNTA_REPETIR: Partial<Record<BotEstado, string>> = {
    pedir_destino:        '¿A qué destino desea viajar?\n\n• *QUITO*\n• *GUAYAQUIL*\n• *MANTA*\n• *SANTO DOMINGO*',
    pedir_zona:           '¿A qué sector específico le llevamos? Indique el nombre del barrio o sector.',
    pedir_fecha_hora:     '¿Para qué fecha y hora? (ej: *mañana a las 8:00*, *hoy 14:30*, *15/06 9:00*)',
    pedir_pasajeros:      '¿Cuántos pasajeros viajan?',
    pedir_nombre:         '¿Cuál es su nombre completo?',
    pedir_para_quien:     '¿La reserva es para usted o para otra persona?\n\n• *Para mí*\n• *Para otra persona*',
    pedir_telefono:       '¿Cuál es el número de teléfono del pasajero?',
    pedir_origen:         '¿Desde qué dirección le recogemos? (calle, barrio, ciudad)',
    pedir_factura:        '¿Requiere factura? (responda *Sí* o *No*)',
    pedir_destino_enc:    '¿A qué ciudad desea enviar la encomienda?\n\n• *QUITO*\n• *GUAYAQUIL*\n• *MANTA*',
    pedir_tamano_enc:     '¿Cuál es el tamaño de su encomienda?',
    pedir_zona_enc:       '¿A qué sector específico enviamos la encomienda?',
    pedir_remitente_enc:  '¿Su nombre completo como remitente?',
    pedir_destinatario_enc: '¿Nombre y teléfono de quien recibe? (ej: *Juan Pérez 0991234567*)',
    pedir_entrega_enc:    '¿Dirección de entrega o punto de recogida en destino?',
  }

  if (ESTADOS_CON_INPUT_LIBRE.includes(estado)) {
    const interrupcion = detectarInterrupcion(texto)
    if (interrupcion) {
      if (interrupcion === 'cancelar') {
        deleteBotConversation(jid)
        await responder('De acuerdo, hemos cancelado el proceso. ¡Hasta luego! Si necesita algo más, escríbanos. 😊')
        return
      }
      if (interrupcion === 'saludo') {
        await responder(`Hola! 😊 Estamos en proceso de reserva. ${PREGUNTA_REPETIR[estado] ?? '¿En qué paso estamos?'}`)
        return
      }
      if (interrupcion === 'precio') {
        const rutasConfig = getRutasConfig()
        if (datos.ruta_id) {
          const cfg = rutasConfig.find((r: Record<string, unknown>) => r.ruta_id === datos.ruta_id)
          const precio = cfg ? `$${(cfg.precio as number).toFixed(2)}` : 'a consultar'
          await responder(
            `El precio para ${datos.destino_ciudad ?? 'su ruta'} es *${precio}* por pasajero.\n\n` +
            `Continuando con su reserva: ${PREGUNTA_REPETIR[estado] ?? ''}`
          )
        } else {
          const precios = rutasConfig
            .filter((r: Record<string, unknown>) => ['STO-UIO','STO-GYE','STO-MTA'].includes(r.codigo as string))
            .map((r: Record<string, unknown>) => `• ${(r.nombre as string).split('→')[1]?.trim()}: *$${(r.precio as number).toFixed(2)}*`)
            .join('\n')
          await responder(
            `Nuestras tarifas por pasajero:\n${precios}\n\n` +
            `Continuando: ${PREGUNTA_REPETIR[estado] ?? ''}`
          )
        }
        return
      }
      if (interrupcion === 'disponibilidad') {
        const ciudad = datos.destino_ciudad ?? null
        await responder(buildDisponibilidadMsg(nombreEmpresa, ciudad) + `\n\nContinuando con su reserva: ${PREGUNTA_REPETIR[estado] ?? ''}`)
        return
      }
    }

    // FAQ mid-flow: verificar antes de capturar como valor literal del campo
    const faqEntries = getFAQ() as Array<{ pregunta_clave: string; respuesta: string }>
    const tNorm = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    for (const faq of faqEntries) {
      const clave = faq.pregunta_clave.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      const palabrasLargas = clave.split(/\s+/).filter(w => w.length > 3)
      if (tNorm.includes(clave) || (palabrasLargas.length >= 2 && palabrasLargas.every(w => tNorm.includes(w)))) {
        const continuacion = PREGUNTA_REPETIR[estado]
        await responder(faq.respuesta + (continuacion ? `\n\n${continuacion}` : ''))
        return
      }
    }
  }

  // ── Verificación pendiente ────────────────────────────────────────────────

  if (estado === 'pedir_verificacion') {
    await responder(
      '📷 Para su seguridad, antes de continuar necesitamos que nos envíe una foto *sosteniendo su cédula o documento de identidad junto a su rostro*, donde se vean claramente su cara y el documento.'
    )
    return
  }

  // ── Paso 1: destino ───────────────────────────────────────────────────────

  if (estado === 'pedir_destino') {
    const ciudad = detectarCiudad(texto)
    if (!ciudad) {
      await responder(
        'No reconocí el destino. ¿A cuál de estas ciudades desea viajar?\n\n' +
        '• *QUITO*\n• *GUAYAQUIL*\n• *MANTA*\n• *SANTO DOMINGO*'
      )
      return
    }
    const ruta = rutas.find(r => r.codigo === MAPA_RUTA[ciudad])
    const rutasConfig = getRutasConfig()
    const rutaCfg = rutasConfig.find((r: Record<string, unknown>) => r.ruta_id === ruta?.id)
    const horarios: string[] = JSON.parse((rutaCfg?.horarios as string) ?? '[]')
    const horariosTexto = horarios.length > 0
      ? `Horarios disponibles: ${horarios.join(', ')}\n\n`
      : 'Permítame consultar con un operador y le confirmamos en breve.\n\n'
    if (ciudad === 'QUITO' || ciudad === 'SANTO DOMINGO') {
      const zonaYaMencionada = detectarZona(texto, ciudad)
      if (zonaYaMencionada) {
        const precioZona = getPrecioZona(ciudad, zonaYaMencionada, 'pasajero')
        const precioFinal = precioZona ?? (rutaCfg?.precio as number ?? 0)
        upsertBotConversation(jid, canal, 'pedir_fecha_hora', {
          ...datos, destino_ciudad: ciudad, ruta_id: ruta?.id,
          zona_destino: zonaYaMencionada, precio_zona: precioFinal
        })
        await responder(
          `Destino *${ciudad}* — sector *${zonaYaMencionada}* ✓ (precio: $${precioFinal.toFixed(2)}/pax)\n\n` +
          horariosTexto +
          `¿Para qué fecha y hora?...`
        )
      } else {
        upsertBotConversation(jid, canal, 'pedir_zona', { ...datos, destino_ciudad: ciudad, ruta_id: ruta?.id })
        await responder(`Destino *${ciudad}* ✓\n\n${buildZonasMsg(ciudad)}`)
      }
      return
    }
    upsertBotConversation(jid, canal, 'pedir_fecha_hora', { ...datos, destino_ciudad: ciudad, ruta_id: ruta?.id })
    await responder(
      `Destino *${ciudad}* ✓\n\n` +
      horariosTexto +
      `¿Para qué fecha y hora? (ej: *mañana a las 8:00*, *hoy 14:30*, *15/06 9:00*)`
    )
    return
  }

  // ── Paso 1b: zona (QUITO / SANTO DOMINGO) ────────────────────────────────

  if (estado === 'pedir_zona') {
    const ciudad = datos.destino_ciudad!
    const zona = detectarZona(texto, ciudad)
    if (!zona) {
      await responder(buildZonasMsg(ciudad))
      return
    }
    const precioZona = getPrecioZona(ciudad, zona, 'pasajero')
    const rutasConfig = getRutasConfig()
    const rutaCfg = rutasConfig.find((r: Record<string, unknown>) => r.ruta_id === datos.ruta_id)
    const precioBase = (rutaCfg?.precio as number) ?? 0
    const precioFinal = precioZona ?? precioBase
    upsertBotConversation(jid, canal, 'pedir_fecha_hora', { ...datos, zona_destino: zona, precio_zona: precioFinal })
    await responder(
      `Sector *${zona}* ✓\n💰 Precio: *$${precioFinal.toFixed(2)}* por pasajero\n\n¿Para qué fecha y hora? (ej: *mañana a las 8:00*, *hoy 14:30*)`
    )
    return
  }

  // ── Paso 2: fecha y hora ──────────────────────────────────────────────────

  if (estado === 'pedir_fecha_hora') {
    const fh = parseFechaHora(texto)
    if (!fh) {
      await responder(
        'No pude reconocer la fecha u hora. Por favor indique, por ejemplo:\n' +
        '• *mañana a las 8:00*\n• *hoy 14:30*\n• *8am*\n• *15:00*'
      )
      return
    }
    upsertBotConversation(jid, canal, 'pedir_pasajeros', { ...datos, fecha: fh.fecha, hora: fh.hora })
    await responder(`📅 ${fh.fecha} a las ${fh.hora} ✓\n\n¿Cuántos pasajeros viajan?`)
    return
  }

  // ── Paso 3: pasajeros ─────────────────────────────────────────────────────

  if (estado === 'pedir_pasajeros') {
    const num = parseInt(texto.match(/\d+/)?.[0] ?? '')
    if (isNaN(num) || num < 1 || num > 20) {
      await responder('¿Cuántos pasajeros viajan? (ejemplo: 1, 2, 3...)')
      return
    }
    upsertBotConversation(jid, canal, 'pedir_nombre', { ...datos, cant_pasajeros: num })
    await responder(`${num} pasajero(s) ✓\n\n¿Cuál es su nombre completo?`)
    return
  }

  // ── Paso 4: nombre ────────────────────────────────────────────────────────

  if (estado === 'pedir_nombre') {
    const nombre = texto.trim()
    if (nombre.length < 2) { await responder('Por favor indique su nombre completo.'); return }
    upsertBotConversation(jid, canal, 'pedir_para_quien', { ...datos, nombre })
    await responder(
      `Gracias, *${nombre}* ✓\n\n` +
      `¿La reserva es para usted o para otra persona?\n\n` +
      `• *Para mí*\n• *Para otra persona*`
    )
    return
  }

  // ── Paso 4b: ¿para quién? ─────────────────────────────────────────────────

  if (estado === 'pedir_para_quien') {
    const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const esParaMi = /\b(para\s*mi|yo|mi\s*mismo|para\s*mi\s*mismo|yo\s*mismo|si\s*para\s*mi|para\s*mi\s*soy|soy\s*yo|la\s*reserva\s*es\s*para\s*mi)\b/.test(t)
      || /^(mi|yo|si|ok|okay|bueno|dale|listo|claro|para mi)$/i.test(t.trim())
    if (esParaMi) {
      const myPhone = jid.split('@')[0]
      upsertBotConversation(jid, canal, 'pedir_origen', { ...datos, telefono: myPhone, para_otro: false })
      await responder(`Perfecto ✓\n\n¿Desde qué dirección le recogemos? (calle, barrio, ciudad)`)
    } else {
      const miTelefono = jid.split('@')[0]
      upsertBotConversation(jid, canal, 'pedir_telefono', { ...datos, telefono_contacto: miTelefono, para_otro: true })
      await responder(`¿Cuál es el número de teléfono del pasajero? (ej: 0991234567)`)
    }
    return
  }

  // ── Paso 5: teléfono del pasajero (solo si es para otro) ─────────────────

  if (estado === 'pedir_telefono') {
    const tel = texto.replace(/[\s\-\(\)]/g, '').replace(/^\+593/, '0')
    if (tel.replace(/\D/g, '').length < 7) {
      await responder('Por favor ingrese un número de teléfono válido. (ej: 0991234567)')
      return
    }
    upsertBotConversation(jid, canal, 'pedir_origen', { ...datos, telefono: tel })
    await responder(`Teléfono registrado ✓\n\n¿Desde qué dirección lo recogemos? (calle, barrio, ciudad)`)
    return
  }

  // ── Paso 6: origen ───────────────────────────────────────────────────────

  if (estado === 'pedir_origen') {
    const origen = texto.trim()
    if (origen.length < 3) { await responder('Por favor indique su dirección de recogida.'); return }
    upsertBotConversation(jid, canal, 'pedir_factura', { ...datos, origen })
    await responder(`Dirección de recogida: *${origen}* ✓\n\n¿Requiere factura electrónica? (Responda *Sí* o *No*)`)
    return
  }

  // ── Paso 7: factura → crear viaje ────────────────────────────────────────

  if (estado === 'pedir_factura') {
    const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const requiere = /\b(si|yes|necesito|con\s*factura|factura\s*si)\b/.test(t)
    const noRequiere = /\b(no|nope|sin|no\s*necesito|no\s*gracias)\b/.test(t)
    if (!requiere && !noRequiere) {
      await responder('Por favor responda *Sí* o *No* a: ¿Requiere factura?')
      return
    }
    const requiere_factura = requiere ? 1 : 0

    const ruta_id = datos.ruta_id
    if (!ruta_id) {
      deleteBotConversation(jid)
      await responder('Ocurrió un error. Por favor escriba *RESERVAR* para intentar nuevamente.')
      return
    }

    const ruta        = rutas.find(r => r.id === ruta_id)
    const rutasConfig = getRutasConfig()
    const rutaCfg     = rutasConfig.find((r: Record<string, unknown>) => r.ruta_id === ruta_id)
    const precioUnitario = datos.precio_zona ?? ((rutaCfg?.precio as number) ?? (ruta?.precio_base as number) ?? 0)

    const { viaje, grupo } = createViajeConGrupo({
      fecha:             datos.fecha ?? new Date().toISOString().slice(0, 10),
      hora:              datos.hora ?? '00:00',
      ruta_id,
      tipo:              'pasajero',
      cant_pasajeros:    datos.cant_pasajeros ?? 1,
      monto:             precioUnitario * (datos.cant_pasajeros ?? 1),
      estado:            'confirmado',
      cliente_nombre:    datos.nombre,
      cliente_telefono:  datos.telefono,
      telefono_contacto: datos.telefono_contacto ?? null,
      origen:            datos.origen,
      destino:           datos.destino_ciudad,
      requiere_factura,
    })

    deleteBotConversation(jid)

    const precio         = `$${(precioUnitario * (datos.cant_pasajeros ?? 1)).toFixed(2)}`
    const g              = grupo as Record<string, unknown>
    const choferNombre   = (viaje as Record<string, unknown>).chofer_nombre as string | null
    const choferDigito   = (viaje as Record<string, unknown>).digito_placa
    const choferTelefono = g.chofer_telefono as string | null
    const choferLabel    = choferNombre
      ? `*${choferNombre}* (placa *${choferDigito}*)`
      : 'próximo disponible'

    const confirmacion = [
      `✅ *Reserva confirmada* — gracias, ${datos.nombre}`,
      ``,
      `📍 Recogida: ${datos.origen}`,
      `🏙️ Destino: *${datos.destino_ciudad}*`,
      `📅 Fecha y hora: ${datos.fecha} a las ${datos.hora}`,
      `👤 Pasajeros: ${datos.cant_pasajeros}`,
      `💰 Total: ${precio}`,
      `🧾 Factura: ${requiere_factura ? 'Sí' : 'No'}`,
      `🚗 Chofer: ${choferLabel}`,
      choferTelefono ? `📱 Tel. chofer: *${choferTelefono}*` : null,
      ``,
      `🧳 Cada pasajero puede llevar *1 maleta de mano sin costo*. Maletas adicionales tienen costo extra.`,
      ``,
      `¡Gracias por su reserva! 🚐 El chofer asignado se pondrá en contacto con usted una hora antes del viaje. ¡Gracias por confiar en *${nombreEmpresa}*!`,
    ].filter(Boolean).join('\n')

    await responder(confirmacion)

    // Notificar al grupo del chofer Y a su número personal con la lista de pasajeros
    if (canal === 'whatsapp') {
      const todosViajes = getViajesByGrupo(g.id as number) as Array<Record<string, unknown>>
      const lineas = todosViajes.map(v =>
        `👤 ${v.cliente_nombre ?? '?'} ${v.cliente_telefono ?? ''} — desde ${v.origen ?? '?'} — $${Number(v.monto ?? 0).toFixed(2)}${v.requiere_factura ? ' 🧾' : ''}`
      )
      const totalGrupo = todosViajes.reduce((s, v) => s + Number(v.monto ?? 0), 0)
      const msgChofer = [
        `🔔 *Viaje ${datos.hora} → ${datos.destino_ciudad}*`,
        ...lineas,
        `Total: ${g.cupo_ocupado}/${g.cupo_maximo} pax — $${totalGrupo.toFixed(2)}`,
      ].join('\n')

      if (g.chofer_grupo_wa_id) {
        await sendFn(g.chofer_grupo_wa_id as string, msgChofer)
      }
      if (choferTelefono) {
        const digitos = choferTelefono.replace(/[^\d]/g, '').replace(/^0/, '593')
        const choferJid = `${digitos}@s.whatsapp.net`
        await sendFn(choferJid, msgChofer)
      }
    }

    if (notifyFn) notifyFn(viaje, null)
    return
  }

  // ── Flujo encomienda ──────────────────────────────────────────────────────

  if (estado === 'pedir_destino_enc') {
    const DESTINOS_ENC: Record<string, string> = { 'QUITO': 'QUITO', 'GUAYAQUIL': 'GUAYAQUIL', 'MANTA': 'MANTA', 'LOS VALLES': 'LOS VALLES' }
    const ciudad = detectarCiudad(texto) ?? (Object.keys(DESTINOS_ENC).find(d => texto.toUpperCase().includes(d)) ?? null)
    if (!ciudad || !DESTINOS_ENC[ciudad]) {
      await responder('No reconocí el destino. ¿A cuál de estas ciudades desea enviar?\n\n• *QUITO*\n• *GUAYAQUIL*\n• *MANTA*')
      return
    }
    const tamanos = getTarifasEncTamanos()
    const lista = tamanos.map((tt, i) => `${i + 1}. ${tt.descripcion as string} — *$${Number(tt.precio).toFixed(2)}*`).join('\n')
    upsertBotConversation(jid, canal, 'pedir_tamano_enc', { ...datos, destino_ciudad_enc: ciudad })
    await responder(`Destino *${ciudad}* ✓\n\nPor favor elija el tamaño de su encomienda respondiendo el número:\n\n${lista}`)
    return
  }

  if (estado === 'pedir_tamano_enc') {
    const tamanos = getTarifasEncTamanos()
    const t = texto.toLowerCase()
    let matched: Record<string, import('sql.js').SqlValue> | null = null
    const num = parseInt(t.match(/\d+/)?.[0] ?? '')
    if (!isNaN(num) && num >= 1 && num <= tamanos.length) {
      matched = tamanos[num - 1]
    } else {
      matched = tamanos.find(tt => t.includes((tt.descripcion as string).toLowerCase().slice(0, 8))) ?? null
    }
    if (!matched) {
      const lista = tamanos.map((tt, i) => `${i + 1}. ${tt.descripcion as string} — *$${Number(tt.precio).toFixed(2)}*`).join('\n')
      await responder(`Por favor elija el tamaño de su encomienda respondiendo el número:\n\n${lista}`)
      return
    }
    upsertBotConversation(jid, canal, 'pedir_zona_enc', { ...datos, tamano_enc: matched.descripcion as string, precio_zona: matched.precio as number })
    await responder(`*${matched.descripcion as string}* ✓ (precio base: $${Number(matched.precio).toFixed(2)})\n\n¿A qué sector de *${datos.destino_ciudad_enc ?? 'destino'}* enviamos la encomienda?`)
    return
  }

  if (estado === 'pedir_zona_enc') {
    const ciudad = datos.destino_ciudad_enc ?? 'QUITO'
    const zona = detectarZona(texto, ciudad)
    if (!zona) {
      await responder(buildZonasMsg(ciudad))
      return
    }
    const recargo = getPrecioZona(ciudad, zona, 'encomienda') ?? 0
    const precioFinal = (datos.precio_zona ?? 0) + recargo
    upsertBotConversation(jid, canal, 'pedir_remitente_enc', { ...datos, zona_enc: zona, precio_zona: precioFinal })
    const recMsg = recargo > 0 ? ` + $${recargo.toFixed(2)} por zona` : ''
    await responder(
      `Zona *${zona}* ✓\n💰 Total estimado: *$${precioFinal.toFixed(2)}* (base${recMsg})\n\n¿Su nombre completo como remitente?`
    )
    return
  }

  if (estado === 'pedir_remitente_enc') {
    const nombre = texto.trim()
    if (nombre.length < 2) { await responder('Por favor indique su nombre completo.'); return }
    upsertBotConversation(jid, canal, 'pedir_destinatario_enc', { ...datos, remitente_nombre: nombre })
    await responder(`Remitente *${nombre}* ✓\n\n¿Nombre y teléfono de quien recibe la encomienda?\n(Ej: *Juan Pérez 0991234567*)`)
    return
  }

  if (estado === 'pedir_destinatario_enc') {
    const t = texto.trim()
    const telMatch = t.match(/(\d[\d\s\-]{6,})/)?.[1]?.replace(/\s/g, '')
    const nombreDest = t.replace(/\d[\d\s\-]{6,}/, '').trim() || t
    if (nombreDest.length < 2) { await responder('Por favor indique el nombre y teléfono del destinatario.'); return }
    upsertBotConversation(jid, canal, 'pedir_entrega_enc', {
      ...datos,
      destinatario_nombre: nombreDest,
      destinatario_tel: telMatch ?? null,
    })
    await responder(`Destinatario *${nombreDest}* ✓\n\n¿Dirección de entrega o punto de recogida en ${datos.destino_ciudad_enc ?? 'destino'}?`)
    return
  }

  if (estado === 'pedir_entrega_enc') {
    const entregaDir = texto.trim()
    if (entregaDir.length < 3) { await responder('Por favor indique la dirección de entrega.'); return }

    const tarifas = getTarifasEncomiendas() as Array<{ destino: string; precio_base: number }>
    const ciudad = datos.destino_ciudad_enc ?? 'QUITO'
    const tarifa = tarifas.find(t => t.destino === ciudad)
    const monto  = datos.precio_zona ?? tarifa?.precio_base ?? 10
    const rutaEnc = rutas.find(r => r.codigo === MAPA_RUTA[ciudad] || r.codigo === 'STO-UIO')

    const { viaje, grupo } = createViajeConGrupo({
      fecha:            new Date().toISOString().slice(0, 10),
      hora:             '08:00',
      ruta_id:          rutaEnc?.id ?? null,
      tipo:             'encomienda',
      cant_pasajeros:   0,
      encomiendas:      `Remitente: ${datos.remitente_nombre ?? 'N/A'} | Destinatario: ${datos.destinatario_nombre ?? 'N/A'} ${datos.destinatario_tel ?? ''} | Entrega: ${entregaDir}`,
      monto,
      estado:           'pendiente',
      cliente_nombre:   datos.remitente_nombre,
      cliente_telefono: normalizePhone(jid.split('@')[0]),
      destino:          ciudad,
      observaciones:    `Destinatario: ${datos.destinatario_nombre ?? ''} ${datos.destinatario_tel ?? ''}`,
    })

    deleteBotConversation(jid)

    const confirmacion = [
      `📦 *Encomienda registrada*`,
      ``,
      `👤 Remitente: *${datos.remitente_nombre}*`,
      `👥 Destinatario: *${datos.destinatario_nombre}*${datos.destinatario_tel ? ` (${datos.destinatario_tel})` : ''}`,
      `🏙️ Destino: *${ciudad}*`,
      `📍 Entrega en: ${entregaDir}`,
      `💰 Precio base: *$${monto.toFixed(2)}*`,
      ``,
      `Un operador se comunicará para coordinar el retiro y entrega. ¡Gracias por confiar en *${nombreEmpresa}*! 📦`,
    ].join('\n')

    await responder(confirmacion)
    if (notifyFn) notifyFn(viaje, null)
    return
  }

  // ── Sin estado activo: detectar intención ─────────────────────────────────

  if (esIntentEncomienda(texto) && !esIntentReservar(texto)) {
    upsertBotConversation(jid, canal, 'pedir_destino_enc', {})
    const tarifas = getTarifasEncomiendas() as Array<{ destino: string; precio_base: number }>
    const lista = tarifas.map(t => `• *${t.destino}*: $${t.precio_base.toFixed(2)}`).join('\n')
    await responder(
      `📦 ¡Claro! Con gusto le ayudo a registrar su encomienda.\n\n` +
      (lista ? `Nuestras tarifas de envío:\n${lista}\n\n` : '') +
      `¿A qué ciudad desea enviar?\n\n• *QUITO*\n• *GUAYAQUIL*\n• *MANTA*`
    )
    return
  }

  if (esIntentReservar(texto)) {
    const phone = normalizePhone(jid.split('@')[0])
    const cliente = getCliente(phone)
    if (!cliente) {
      createCliente({ telefono: phone, nombre: senderName || null })
      upsertBotConversation(jid, canal, 'pedir_verificacion', {})
      await responder(
        `Hola${senderName ? ` *${senderName}*` : ''}! 👋 Bienvenido/a a *${nombreEmpresa}*.\n\n` +
        `Para su seguridad, antes de continuar necesitamos que nos envíe una foto *sosteniendo su cédula o documento de identidad junto a su rostro*, donde se vean claramente su cara y el documento.`
      )
      return
    }
    if (!cliente.verificado) {
      upsertBotConversation(jid, canal, 'pedir_verificacion', {})
      await responder(
        `Hola${senderName ? ` *${senderName}*` : ''}! Para continuar necesitamos verificar su identidad.\n\n` +
        `Por favor envíenos una foto *sosteniendo su cédula o documento de identidad junto a su rostro*, donde se vean claramente su cara y el documento.`
      )
      return
    }
    // Detectar si ya mencionó la ciudad en el mismo mensaje
    const ciudadMencionada = detectarCiudad(texto)
    if (ciudadMencionada) {
      const ruta = rutas.find(r => r.codigo === MAPA_RUTA[ciudadMencionada])
      const rutasConfig = getRutasConfig()
      const rutaCfg = rutasConfig.find((r: Record<string, unknown>) => r.ruta_id === ruta?.id)
      const horarios: string[] = JSON.parse((rutaCfg?.horarios as string) ?? '[]')
      const horariosTexto = horarios.length > 0 ? `Horarios disponibles: ${horarios.join(', ')}\n\n` : ''
      upsertBotConversation(jid, canal, 'pedir_fecha_hora', { destino_ciudad: ciudadMencionada, ruta_id: ruta?.id })
      await responder(
        `Hola${senderName ? ` ${senderName}` : ''}! 😊 Con gusto te ayudo a reservar tu viaje a *${ciudadMencionada}*.\n\n` +
        horariosTexto +
        `¿Para qué fecha y hora? (ej: *mañana a las 8:00*, *hoy 14:30*)`
      )
    } else {
      upsertBotConversation(jid, canal, 'pedir_destino', {})
      await responder(
        `Hola${senderName ? ` ${senderName}` : ''}! 😊 Con gusto te ayudo a reservar tu viaje.\n\n` +
        `*Paso 1 de 5* — ¿A qué destino vas?\n\n` +
        `• *QUITO*\n• *GUAYAQUIL*\n• *MANTA*\n• *SANTO DOMINGO*`
      )
    }
    return
  }

  if (esConsultaDisponibilidad(texto)) {
    const ciudad = detectarCiudad(texto)
    await responder(buildDisponibilidadMsg(nombreEmpresa, ciudad))
    return
  }

  if (esConsultaPrecio(texto)) {
    const rutasConfig = getRutasConfig()
    const ciudad = detectarCiudad(texto)
    if (ciudad) {
      const cod = MAPA_RUTA[ciudad]
      const cfg = rutasConfig.find((r: Record<string, unknown>) => r.codigo === cod)
      if (cfg) {
        await responder(
          `El servicio a *${ciudad}* tiene un costo de *$${(cfg.precio as number).toFixed(2)}* por pasajero.\n\n` +
          `Escribe *RESERVAR* para agendar tu viaje. 😊`
        )
        return
      }
    }
    const precios = rutasConfig
      .filter((r: Record<string, unknown>) => ['STO-UIO', 'STO-GYE', 'STO-MTA'].includes(r.codigo as string))
      .map((r: Record<string, unknown>) => `  • ${(r.nombre as string).split('→')[1]?.trim()}: *$${(r.precio as number).toFixed(2)}*`)
      .join('\n')
    await responder(
      `Nuestras tarifas por pasajero:\n${precios}\n\n` +
      `Escribe *RESERVAR* para agendar. 😊`
    )
    return
  }

  // Mensaje de bienvenida / fallback
  const hora    = new Date().getHours()
  const saludo  = hora < 12 ? 'Buenos días' : hora < 18 ? 'Buenas tardes' : 'Buenas noches'
  await responder(
    `${saludo}! 👋 Soy el asistente de *${nombreEmpresa}*.\n\n` +
    `Puedo ayudarte con:\n\n` +
    `1️⃣ *RESERVAR* — Agendar un viaje de pasajeros\n` +
    `2️⃣ *ENCOMIENDA* — Envío de paquetes y encomiendas\n` +
    `3️⃣ Consultar disponibilidad (ej: "¿hay turnos a Quito?")\n` +
    `4️⃣ Consultar precios (ej: "¿cuánto cuesta a Manta?")\n\n` +
    `¿En qué te puedo ayudar?`
  )
}

import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import type { Database as SqlJsDB, SqlValue } from 'sql.js'

const DB_PATH = path.join(app.getPath('userData'), 'database.sqlite')
let db: SqlJsDB

function sv(v: unknown): SqlValue {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  if (v instanceof Uint8Array) return v
  return String(v)
}

function p(...args: unknown[]): SqlValue[] {
  return args.map(sv)
}

function saveDB() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

export async function initDB() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const initSqlJs = require('sql.js')
  // En packaged, el WASM está en app.asar.unpacked (asarUnpack). Usar process.resourcesPath
  // evita que sql.js lo busque vía fetch() dentro del asar (que falla en Node 20).
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    : path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  const SQL = await initSqlJs({ locateFile: () => wasmPath })

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }
  createTables()
  seedData()
  migrarViajesAGrupos()
  saveDB()
}

function runSQL(sql: string, params: SqlValue[] = []) {
  db.run(sql, params)
  saveDB()
}

function getAll(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: Record<string, SqlValue>[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, SqlValue>)
  }
  stmt.free()
  return rows
}

function getOne(sql: string, params: SqlValue[] = []): Record<string, SqlValue> | undefined {
  return getAll(sql, params)[0]
}

function getLastId(): number {
  const result = getOne('SELECT last_insert_rowid() as id')
  return (result?.id as number) ?? 0
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS rutas_config (
      ruta_id      INTEGER PRIMARY KEY,
      precio       REAL NOT NULL,
      horarios     TEXT NOT NULL DEFAULT '[]',
      duracion_horas REAL NOT NULL DEFAULT 3
    );
    CREATE TABLE IF NOT EXISTS clientes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono        TEXT NOT NULL UNIQUE,
      nombre          TEXT,
      verificado      INTEGER NOT NULL DEFAULT 0,
      foto_verificacion TEXT,
      fecha_registro  TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS empresa (
      id INTEGER PRIMARY KEY, nombre TEXT NOT NULL DEFAULT 'Mi Empresa',
      telefono TEXT, whatsapp_numero TEXT, logo TEXT,
      grupo_operativo_id TEXT, tarifa_mensual REAL DEFAULT 50,
      messenger_page_token TEXT, messenger_verify_token TEXT,
      cupo_maximo INTEGER DEFAULT 3
    );
    CREATE TABLE IF NOT EXISTS viaje_grupos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ruta_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      chofer_id INTEGER,
      cupo_maximo INTEGER NOT NULL DEFAULT 3,
      cupo_ocupado INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'abierto',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS rutas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE, nombre TEXT NOT NULL, precio_base REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS choferes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL,
      telefono TEXT, numero_placa TEXT, digito_placa INTEGER,
      grupo_wa_id TEXT, activo INTEGER NOT NULL DEFAULT 1,
      orden_turno_quito INTEGER DEFAULT 99, orden_turno_santo INTEGER DEFAULT 99,
      orden_turno_manta INTEGER DEFAULT 99, orden_turno_guayaquil INTEGER DEFAULT 99,
      tarifa_mensual REAL DEFAULT 50
    );
    CREATE TABLE IF NOT EXISTS viajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, hora TEXT NOT NULL,
      ruta_id INTEGER, chofer_id INTEGER, tipo TEXT NOT NULL DEFAULT 'pasajero',
      cant_pasajeros INTEGER DEFAULT 0, encomiendas TEXT, monto REAL DEFAULT 0,
      observaciones TEXT, estado TEXT NOT NULL DEFAULT 'pendiente',
      cliente_nombre TEXT, cliente_telefono TEXT, telefono_contacto TEXT,
      origen TEXT, destino TEXT, wa_enviado INTEGER DEFAULT 0,
      hora_llegada_estimada TEXT, viaje_grupo_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS turnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chofer_id INTEGER NOT NULL,
      ruta_id INTEGER NOT NULL, posicion INTEGER NOT NULL DEFAULT 0,
      ultima_salida TEXT, UNIQUE(chofer_id, ruta_id)
    );
    CREATE TABLE IF NOT EXISTS mensualidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chofer_id INTEGER NOT NULL,
      mes INTEGER NOT NULL, anio INTEGER NOT NULL, monto REAL NOT NULL DEFAULT 50,
      pagado INTEGER NOT NULL DEFAULT 0, fecha_pago TEXT, notas TEXT,
      UNIQUE(chofer_id, mes, anio)
    );
    CREATE TABLE IF NOT EXISTS mensajes_wa (
      id INTEGER PRIMARY KEY AUTOINCREMENT, contacto TEXT, telefono TEXT,
      mensaje TEXT, fecha TEXT DEFAULT (datetime('now','localtime')),
      tipo TEXT DEFAULT 'entrante', procesado INTEGER DEFAULT 0, jid TEXT,
      canal TEXT DEFAULT 'whatsapp', messenger_psid TEXT
    );
    CREATE TABLE IF NOT EXISTS bot_conversations (
      jid TEXT PRIMARY KEY,
      canal TEXT DEFAULT 'whatsapp',
      estado TEXT NOT NULL DEFAULT 'idle',
      datos TEXT DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS licencia (
      id INTEGER PRIMARY KEY DEFAULT 1,
      clave TEXT NOT NULL,
      empresa TEXT,
      email TEXT,
      fecha_activacion TEXT NOT NULL,
      fecha_vencimiento TEXT NOT NULL,
      ultima_validacion TEXT
    );
  `)

  // Migrations para bases de datos existentes
  const migrations = [
    'ALTER TABLE choferes ADD COLUMN orden_turno_manta INTEGER DEFAULT 99',
    'ALTER TABLE choferes ADD COLUMN orden_turno_guayaquil INTEGER DEFAULT 99',
    'ALTER TABLE empresa ADD COLUMN messenger_page_token TEXT',
    'ALTER TABLE empresa ADD COLUMN messenger_verify_token TEXT',
    'ALTER TABLE mensajes_wa ADD COLUMN canal TEXT DEFAULT "whatsapp"',
    'ALTER TABLE mensajes_wa ADD COLUMN messenger_psid TEXT',
    'ALTER TABLE empresa ADD COLUMN facebook_page_name TEXT',
    'ALTER TABLE empresa ADD COLUMN facebook_page_id TEXT',
    "ALTER TABLE empresa ADD COLUMN bot_modo TEXT DEFAULT 'auto'",
    "ALTER TABLE licencia ADD COLUMN plan TEXT DEFAULT '1y'",
    'ALTER TABLE mensajes_wa ADD COLUMN wa_msg_id TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_msg_id ON mensajes_wa(wa_msg_id) WHERE wa_msg_id IS NOT NULL',
    "ALTER TABLE choferes ADD COLUMN rutas_asignadas TEXT DEFAULT '[]'",
    `UPDATE choferes SET rutas_asignadas='["STO-UIO","UIO-STO"]' WHERE numero_placa='ABC-1238' AND rutas_asignadas='[]'`,
    `UPDATE choferes SET rutas_asignadas='["STO-GYE","GYE-STO"]' WHERE numero_placa='DEF-4565' AND rutas_asignadas='[]'`,
    `UPDATE choferes SET rutas_asignadas='["STO-MTA","MTA-STO"]' WHERE numero_placa='GHI-7892' AND rutas_asignadas='[]'`,
    `UPDATE choferes SET rutas_asignadas='["STO-UIO","STO-GYE"]' WHERE numero_placa='JKL-3455' AND rutas_asignadas='[]'`,
    "ALTER TABLE choferes ADD COLUMN ciudad_actual TEXT DEFAULT 'SANTO DOMINGO'",
    'ALTER TABLE rutas_config ADD COLUMN duracion_horas REAL DEFAULT 3',
    // Rutas a GYE y MTA tienen 4 horas de duración
    "UPDATE rutas_config SET duracion_horas=4 WHERE ruta_id IN (SELECT id FROM rutas WHERE codigo IN ('STO-GYE','GYE-STO','STO-MTA','MTA-STO'))",
    'ALTER TABLE viajes ADD COLUMN hora_llegada_estimada TEXT',
    'ALTER TABLE viajes ADD COLUMN telefono_contacto TEXT',
    'ALTER TABLE mensajes_wa ADD COLUMN wa_numero TEXT',
    `CREATE TABLE IF NOT EXISTS preguntas_frecuentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pregunta_clave TEXT NOT NULL,
      respuesta TEXT NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS tarifas_encomiendas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destino TEXT NOT NULL UNIQUE,
      precio_base REAL NOT NULL DEFAULT 10,
      recargo_por_kg REAL NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS viaje_grupos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ruta_id INTEGER NOT NULL, fecha TEXT NOT NULL, hora TEXT NOT NULL,
      chofer_id INTEGER, cupo_maximo INTEGER NOT NULL DEFAULT 3,
      cupo_ocupado INTEGER NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'abierto',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    'ALTER TABLE viajes ADD COLUMN viaje_grupo_id INTEGER',
    'ALTER TABLE empresa ADD COLUMN cupo_maximo INTEGER DEFAULT 3',
    'ALTER TABLE viajes ADD COLUMN requiere_factura INTEGER DEFAULT 0',
    `CREATE TABLE IF NOT EXISTS ediciones_turnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      texto_generado TEXT NOT NULL,
      texto_editado TEXT NOT NULL,
      usuario TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS tarifas_zonas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ciudad TEXT NOT NULL,
      zona TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'pasajero',
      recargo REAL NOT NULL DEFAULT 0,
      activo INTEGER NOT NULL DEFAULT 1,
      UNIQUE(ciudad, zona, tipo)
    )`,
    `CREATE TABLE IF NOT EXISTS tarifas_enc_tamanos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descripcion TEXT NOT NULL UNIQUE,
      precio REAL NOT NULL DEFAULT 0,
      activo INTEGER NOT NULL DEFAULT 1
    )`,
  ]
  for (const sql of migrations) {
    try { db.run(sql) } catch { /* columna ya existe */ }
  }
}

function seedData() {
  if (!getOne('SELECT id FROM empresa LIMIT 1')) {
    db.run("INSERT INTO empresa (id, nombre, telefono, tarifa_mensual) VALUES (1, 'Transportes Alengo', '0999999999', 50)")
  }

  if (!getOne('SELECT id FROM rutas LIMIT 1')) {
    const rutas = [
      ['STO-UIO', 'Santo Domingo → Quito', 5.00],
      ['UIO-STO', 'Quito → Santo Domingo', 5.00],
      ['STO-GYE', 'Santo Domingo → Guayaquil', 6.00],
      ['GYE-STO', 'Guayaquil → Santo Domingo', 6.00],
      ['STO-MTA', 'Santo Domingo → Manta', 7.00],
      ['MTA-STO', 'Manta → Santo Domingo', 7.00],
    ]
    for (const [c, n, pr] of rutas) {
      db.run('INSERT INTO rutas (codigo, nombre, precio_base) VALUES (?, ?, ?)', p(c, n, pr))
    }
  }

  // Seed rutas_config con precios, horarios y duración por defecto
  const DEFAULT_HORARIOS = JSON.stringify(['06:00','09:00','12:00','15:00','18:00'])
  const DURACIONES: Record<string, number> = {
    'STO-UIO': 3, 'UIO-STO': 3, 'STO-GYE': 4, 'GYE-STO': 4, 'STO-MTA': 4, 'MTA-STO': 4,
  }
  for (const r of getAll('SELECT * FROM rutas')) {
    const dur = DURACIONES[r.codigo as string] ?? 3
    db.run(
      'INSERT OR IGNORE INTO rutas_config (ruta_id, precio, horarios, duracion_horas) VALUES (?, ?, ?, ?)',
      p(r.id, r.precio_base, DEFAULT_HORARIOS, dur)
    )
  }

  // Seed tarifas de encomiendas si no existen
  const encSeed = [
    ['QUITO', 10, 0],
    ['LOS VALLES', 15, 0],
    ['GUAYAQUIL', 15, 0],
    ['MANTA', 15, 0],
  ]
  for (const [d, p_, r] of encSeed) {
    db.run('INSERT OR IGNORE INTO tarifas_encomiendas (destino, precio_base, recargo_por_kg) VALUES (?, ?, ?)', p(d, p_, r))
  }

  // Seed tarifas_zonas pasajero QUITO
  const tarifasZonasQuitoPax: [string, number][] = [
    ['Sur', 18], ['Centro Norte', 18], ['Carcelén bajo', 20], ['Valle de los Chillos', 23],
    ['Cumbayá', 23], ['Tumbaco', 25], ['Puembo', 33], ['Pifo', 33], ['Aeropuerto', 38],
    ['Calderón', 23], ['Carapungo', 23], ['Pusuquí', 23], ['Pomasqui', 23], ['Mitad del Mundo', 25],
    ['Jaime Roldós', 20], ['Guayllabamba', 45], ['Quinche', 38], ['Alóag', 17],
  ]
  for (const [zona, recargo] of tarifasZonasQuitoPax) {
    db.run('INSERT OR IGNORE INTO tarifas_zonas (ciudad, zona, tipo, recargo) VALUES (?,?,?,?)', p('QUITO', zona, 'pasajero', recargo))
  }

  // Seed tarifas_zonas pasajero SANTO DOMINGO
  const tarifasZonasStoPax: [string, number][] = [
    ['El Carmen-Las Delicias-Nuevo Israel', 10], ['Tenis Club', 5], ['Rancho San Fernando', 5],
    ['La Concordia', 15], ['Valle Hermoso', 10], ['El Esfuerzo', 12], ['Luz de América', 12],
    ['Cade', 5], ['Quinindé', 45],
  ]
  for (const [zona, recargo] of tarifasZonasStoPax) {
    db.run('INSERT OR IGNORE INTO tarifas_zonas (ciudad, zona, tipo, recargo) VALUES (?,?,?,?)', p('SANTO DOMINGO', zona, 'pasajero', recargo))
  }

  // Seed tarifas_zonas encomienda QUITO
  const tarifasZonasQuitoEnc: [string, number][] = [
    ['Sur', 0], ['Centro Norte', 0], ['Carcelén bajo', 5], ['Valle de los Chillos', 5],
    ['Cumbayá', 5], ['Tumbaco', 10], ['Puembo', 20], ['Pifo', 20], ['Aeropuerto', 20],
    ['Calderón', 5], ['Carapungo', 5], ['Pusuquí', 5], ['Mitad del Mundo', 10], ['Jaime Roldós', 5],
  ]
  for (const [zona, recargo] of tarifasZonasQuitoEnc) {
    db.run('INSERT OR IGNORE INTO tarifas_zonas (ciudad, zona, tipo, recargo) VALUES (?,?,?,?)', p('QUITO', zona, 'encomienda', recargo))
  }

  // Seed tarifas_zonas encomienda SANTO DOMINGO
  for (const [zona, recargo] of tarifasZonasStoPax) {
    db.run('INSERT OR IGNORE INTO tarifas_zonas (ciudad, zona, tipo, recargo) VALUES (?,?,?,?)', p('SANTO DOMINGO', zona, 'encomienda', recargo))
  }

  // Seed tarifas_enc_tamanos
  const tamanosSeed: [string, number][] = [
    ['1 maleta de 25 kg', 15],
    ['Sobre o paquete pequeño', 10],
    ['Cartón mediano', 10],
    ['Cartón grande (mitad del maletero)', 20],
    ['Carga completa de cajuela', 45],
  ]
  for (const [desc, precio] of tamanosSeed) {
    db.run('INSERT OR IGNORE INTO tarifas_enc_tamanos (descripcion, precio) VALUES (?,?)', p(desc, precio))
  }

  if (!getOne('SELECT id FROM choferes LIMIT 1')) {
    const choferes: [string, string, string, number, number, number, number, number, string][] = [
      ['Alberto Morales',  '0991234567', 'ABC-1238', 8, 1, 1, 2, 3, '["STO-UIO","UIO-STO"]'],
      ['José Gutiérrez',   '0992345678', 'DEF-4565', 5, 2, 3, 1, 4, '["STO-GYE","GYE-STO"]'],
      ['Martín Vargas',    '0993456789', 'GHI-7892', 2, 3, 4, 3, 1, '["STO-MTA","MTA-STO"]'],
      ['Franklin Torres',  '0994567890', 'JKL-3455', 5, 4, 2, 4, 2, '["STO-UIO","STO-GYE"]'],
    ]
    for (const [nom, tel, placa, dig, oq, os, om, og, ra] of choferes) {
      db.run(
        'INSERT INTO choferes (nombre, telefono, numero_placa, digito_placa, orden_turno_quito, orden_turno_santo, orden_turno_manta, orden_turno_guayaquil, tarifa_mensual, rutas_asignadas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 50, ?)',
        p(nom, tel, placa, dig, oq, os, om, og, ra)
      )
    }
    const choferesBD = getAll('SELECT id, orden_turno_quito, orden_turno_santo, orden_turno_manta, orden_turno_guayaquil FROM choferes')
    const rutasBD    = getAll('SELECT id, codigo FROM rutas')
    for (const c of choferesBD) {
      for (const r of rutasBD) {
        const cod = r.codigo as string
        let pos: SqlValue
        if (cod.includes('UIO')) pos = c.orden_turno_quito
        else if (cod.includes('MTA')) pos = c.orden_turno_manta
        else if (cod.includes('GYE')) pos = c.orden_turno_guayaquil
        else pos = c.orden_turno_santo
        db.run('INSERT OR IGNORE INTO turnos (chofer_id, ruta_id, posicion) VALUES (?, ?, ?)', p(c.id, r.id, pos))
      }
    }
  }
}

// ── Empresa ───────────────────────────────────────────────────────────────────
export function getEmpresa() {
  return getOne('SELECT * FROM empresa WHERE id = 1')
}

export function updateEmpresa(data: Record<string, unknown>) {
  runSQL(
    'UPDATE empresa SET nombre=?, telefono=?, whatsapp_numero=?, grupo_operativo_id=?, tarifa_mensual=?, cupo_maximo=? WHERE id=1',
    p(data.nombre, data.telefono, data.whatsapp_numero, data.grupo_operativo_id, data.tarifa_mensual, data.cupo_maximo ?? 3)
  )
  return getEmpresa()
}

export function setFacebookPage(pageToken: string, pageName: string, pageId: string) {
  runSQL(
    'UPDATE empresa SET messenger_page_token=?, facebook_page_name=?, facebook_page_id=? WHERE id=1',
    p(pageToken, pageName, pageId)
  )
  return getEmpresa()
}

export function getBotModo(): string {
  const row = getOne('SELECT bot_modo FROM empresa WHERE id = 1')
  return (row?.bot_modo as string) ?? 'auto'
}

export function setBotModo(modo: string) {
  runSQL("UPDATE empresa SET bot_modo=? WHERE id=1", [modo])
}

export function clearFacebookPage() {
  runSQL(
    'UPDATE empresa SET messenger_page_token=NULL, facebook_page_name=NULL, facebook_page_id=NULL WHERE id=1'
  )
  return getEmpresa()
}

// ── Rutas ─────────────────────────────────────────────────────────────────────
export function getRutas() {
  return getAll('SELECT * FROM rutas ORDER BY id')
}

// ── Choferes ──────────────────────────────────────────────────────────────────
export function getChoferes() {
  return getAll('SELECT * FROM choferes ORDER BY orden_turno_quito')
}

export function createChofer(data: Record<string, unknown>) {
  runSQL(
    'INSERT INTO choferes (nombre, telefono, numero_placa, digito_placa, grupo_wa_id, activo, tarifa_mensual, rutas_asignadas, ciudad_actual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    p(data.nombre, data.telefono, data.numero_placa, data.digito_placa, data.grupo_wa_id ?? null, data.activo ?? 1, data.tarifa_mensual ?? 50, data.rutas_asignadas ?? '[]', data.ciudad_actual ?? 'SANTO DOMINGO')
  )
  const chofer = getOne('SELECT * FROM choferes ORDER BY id DESC LIMIT 1')
  const id = (chofer?.id as number) ?? 0
  for (const r of getRutas()) {
    db.run('INSERT OR IGNORE INTO turnos (chofer_id, ruta_id, posicion) VALUES (?, ?, 99)', p(id, r.id))
  }
  saveDB()
  return chofer
}

export function updateChofer(data: Record<string, unknown>) {
  runSQL(
    'UPDATE choferes SET nombre=?, telefono=?, numero_placa=?, digito_placa=?, grupo_wa_id=?, activo=?, orden_turno_quito=?, orden_turno_santo=?, orden_turno_manta=?, orden_turno_guayaquil=?, tarifa_mensual=?, rutas_asignadas=?, ciudad_actual=? WHERE id=?',
    p(data.nombre, data.telefono, data.numero_placa, data.digito_placa, data.grupo_wa_id ?? null, data.activo,
      data.orden_turno_quito ?? 99, data.orden_turno_santo ?? 99,
      data.orden_turno_manta ?? 99, data.orden_turno_guayaquil ?? 99,
      data.tarifa_mensual ?? 50, data.rutas_asignadas ?? '[]',
      data.ciudad_actual ?? 'SANTO DOMINGO', data.id)
  )
  return getOne('SELECT * FROM choferes WHERE id = ?', p(data.id))
}

export function updateChoferCiudad(choferId: number, ciudad: string) {
  runSQL('UPDATE choferes SET ciudad_actual=? WHERE id=?', p(ciudad, choferId))
}

// ── Turnos ────────────────────────────────────────────────────────────────────
export function getTurnosPorRuta(rutaId: number) {
  const ruta   = getOne('SELECT codigo FROM rutas WHERE id = ?', [rutaId])
  const codigo = ruta?.codigo as string | undefined
  const rows   = getAll(
    'SELECT c.*, t.posicion, t.ultima_salida FROM choferes c JOIN turnos t ON t.chofer_id = c.id WHERE t.ruta_id = ? AND c.activo = 1 ORDER BY t.posicion ASC',
    [rutaId]
  )
  if (!codigo) return rows
  return rows.filter(c => {
    const asignadas = JSON.parse((c.rutas_asignadas as string) || '[]') as string[]
    return asignadas.length > 0 && asignadas.includes(codigo)
  })
}

export function asignarChofer(rutaId: number, hora: string, fecha?: string) {
  const rutaRow    = getOne('SELECT codigo FROM rutas WHERE id=?', [rutaId])
  const rutaCodigo = (rutaRow?.codigo as string) ?? ''

  // Selecciona el chofer con menor posición en turno para esta ruta,
  // filtrando por rutas_asignadas y (si se pasa fecha) excluyendo choferes
  // que ya tienen un grupo activo en ese slot ruta+fecha+hora.
  function pickChofer(excludeSlot: boolean): Record<string, SqlValue> | null {
    const params: SqlValue[] = [rutaId, `%"${rutaCodigo}"%`]
    let sql = `SELECT c.*, t.posicion FROM choferes c
      JOIN turnos t ON t.chofer_id = c.id
      WHERE t.ruta_id = ? AND c.activo = 1
        AND c.rutas_asignadas LIKE ?`
    if (excludeSlot && fecha) {
      sql += ` AND NOT EXISTS (
        SELECT 1 FROM viaje_grupos vg2
        WHERE vg2.chofer_id = c.id AND vg2.ruta_id = ? AND vg2.fecha = ? AND vg2.hora = ?
          AND vg2.estado NOT IN ('completado','cancelado')
      )`
      params.push(rutaId, fecha, hora)
    }
    sql += ' ORDER BY t.posicion ASC LIMIT 1'
    return getOne(sql, params) ?? null
  }

  // Intentar primero con exclusión; si todos están ocupados en ese slot, tomar el siguiente en turno sin exclusión
  const chofer = pickChofer(true) ?? pickChofer(false)
  if (!chofer) return null

  const maxResult = getOne('SELECT MAX(posicion) as max FROM turnos WHERE ruta_id = ?', [rutaId])
  const maxPos    = (maxResult?.max as number) ?? 0
  db.run("UPDATE turnos SET posicion=?, ultima_salida=datetime('now','localtime') WHERE chofer_id=? AND ruta_id=?",
    p(maxPos + 1, chofer.id, rutaId))
  const todos = getAll('SELECT id FROM turnos WHERE ruta_id=? ORDER BY posicion', [rutaId])
  todos.forEach((t, i) => db.run('UPDATE turnos SET posicion=? WHERE id=?', [i + 1, t.id]))
  saveDB()
  return chofer
}

// ── Viajes ────────────────────────────────────────────────────────────────────
const JOIN_VIAJE = `SELECT v.*, c.nombre as chofer_nombre, c.digito_placa, c.grupo_wa_id as chofer_grupo_wa_id, r.codigo as ruta_codigo, r.nombre as ruta_nombre
  FROM viajes v LEFT JOIN choferes c ON c.id = v.chofer_id LEFT JOIN rutas r ON r.id = v.ruta_id`

export function getViajes(fecha?: string) {
  if (fecha) return getAll(`${JOIN_VIAJE} WHERE v.fecha=? ORDER BY v.hora ASC`, [fecha])
  return getAll(`${JOIN_VIAJE} ORDER BY v.fecha DESC, v.hora ASC LIMIT 500`)
}

export function getViajeById(id: number) {
  return getOne(`${JOIN_VIAJE} WHERE v.id=?`, [id])
}

export function getViajesByFechaHora(fecha: string, hora: string, rutaId: number) {
  return getAll(`${JOIN_VIAJE} WHERE v.fecha=? AND v.hora>=? AND v.ruta_id=? ORDER BY v.hora ASC LIMIT 5`, [fecha, hora, rutaId])
}

export function createViaje(data: Record<string, unknown>) {
  // Auto-calcular hora_llegada_estimada si no viene en data
  let horaLlegada = (data.hora_llegada_estimada as string | null) ?? null
  if (!horaLlegada && data.ruta_id && data.fecha && data.hora) {
    const cfg = getOne('SELECT duracion_horas FROM rutas_config WHERE ruta_id=?', [data.ruta_id as number])
    const dur = (cfg?.duracion_horas as number) ?? 3
    const dt = new Date(`${data.fecha}T${data.hora}:00`)
    dt.setTime(dt.getTime() + dur * 3_600_000)
    horaLlegada = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`
  }
  runSQL(
    'INSERT INTO viajes (fecha, hora, ruta_id, chofer_id, tipo, cant_pasajeros, encomiendas, monto, observaciones, estado, cliente_nombre, cliente_telefono, telefono_contacto, origen, destino, hora_llegada_estimada, viaje_grupo_id, requiere_factura) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    p(data.fecha, data.hora, data.ruta_id, data.chofer_id ?? null, data.tipo, data.cant_pasajeros ?? 0,
      data.encomiendas ?? null, data.monto ?? 0, data.observaciones ?? null, data.estado ?? 'pendiente',
      data.cliente_nombre ?? null, data.cliente_telefono ?? null, data.telefono_contacto ?? null,
      data.origen ?? null, data.destino ?? null, horaLlegada, data.viaje_grupo_id ?? null,
      data.requiere_factura ?? 0)
  )
  return getOne(`${JOIN_VIAJE} ORDER BY v.id DESC LIMIT 1`)
}

export function updateViaje(data: Record<string, unknown>) {
  runSQL(
    'UPDATE viajes SET fecha=?, hora=?, ruta_id=?, chofer_id=?, tipo=?, cant_pasajeros=?, encomiendas=?, monto=?, observaciones=?, estado=?, cliente_nombre=?, cliente_telefono=?, telefono_contacto=?, origen=?, destino=?, wa_enviado=?, requiere_factura=? WHERE id=?',
    p(data.fecha, data.hora, data.ruta_id, data.chofer_id, data.tipo, data.cant_pasajeros ?? 0,
      data.encomiendas ?? null, data.monto ?? 0, data.observaciones ?? null, data.estado,
      data.cliente_nombre ?? null, data.cliente_telefono ?? null, data.telefono_contacto ?? null,
      data.origen ?? null, data.destino ?? null, data.wa_enviado ?? 0,
      data.requiere_factura ?? 0, data.id)
  )
  return getViajeById(data.id as number)
}

export function deleteViaje(id: number) {
  runSQL('DELETE FROM viajes WHERE id=?', [id])
  return { success: true }
}

// ── Reportes ──────────────────────────────────────────────────────────────────
export function getReporteChofer(choferId: number, desde: string, hasta: string) {
  if (choferId === 0) {
    return getAll(
      `${JOIN_VIAJE} WHERE v.fecha BETWEEN ? AND ? AND v.estado NOT IN ('cancelado') ORDER BY v.fecha ASC, v.hora ASC`,
      [desde, hasta]
    )
  }
  return getAll(
    `${JOIN_VIAJE} WHERE v.chofer_id=? AND v.fecha BETWEEN ? AND ? AND v.estado NOT IN ('cancelado') ORDER BY v.fecha ASC, v.hora ASC`,
    [choferId, desde, hasta]
  )
}

// ── Mensualidades ─────────────────────────────────────────────────────────────
export function getMensualidades(mes: number, anio: number) {
  const choferes = getAll('SELECT * FROM choferes WHERE activo=1')
  const empresa = getEmpresa()
  const tarifa = (empresa?.tarifa_mensual as number) ?? 50
  for (const c of choferes) {
    db.run('INSERT OR IGNORE INTO mensualidades (chofer_id, mes, anio, monto) VALUES (?, ?, ?, ?)',
      p(c.id, mes, anio, (c.tarifa_mensual as number) ?? tarifa))
  }
  saveDB()
  return getAll(
    'SELECT m.*, c.nombre as chofer_nombre, c.numero_placa, c.digito_placa FROM mensualidades m JOIN choferes c ON c.id=m.chofer_id WHERE m.mes=? AND m.anio=? ORDER BY c.nombre',
    [mes, anio]
  )
}

export function getMensualidadesChofer(choferId: number, anio: number) {
  return getAll(
    'SELECT m.*, c.nombre as chofer_nombre FROM mensualidades m JOIN choferes c ON c.id=m.chofer_id WHERE m.chofer_id=? AND m.anio=? ORDER BY m.mes ASC',
    [choferId, anio]
  )
}

export function registrarPago(data: Record<string, unknown>) {
  runSQL('UPDATE mensualidades SET pagado=1, fecha_pago=?, notas=?, monto=? WHERE id=?',
    p(data.fecha_pago, data.notas ?? null, data.monto, data.id))
  return { success: true }
}

// ── Mensajes ──────────────────────────────────────────────────────────────────
export function saveMensaje(data: Record<string, unknown>) {
  runSQL(
    'INSERT INTO mensajes_wa (contacto, telefono, mensaje, tipo, jid, canal, messenger_psid, wa_numero) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    p(data.contacto, data.telefono ?? null, data.mensaje, data.tipo ?? 'entrante',
      data.jid ?? null, data.canal ?? 'whatsapp', data.messenger_psid ?? null,
      data.wa_numero ?? null)
  )
  return (getOne('SELECT id FROM mensajes_wa ORDER BY id DESC LIMIT 1')?.id as number) ?? 0
}

export function getMensajes(waNumero?: string | null, limit = 2000) {
  if (waNumero) {
    return getAll(
      'SELECT * FROM mensajes_wa WHERE wa_numero=? OR canal=? ORDER BY fecha ASC LIMIT ?',
      [waNumero, 'messenger', limit]
    )
  }
  return getAll('SELECT * FROM mensajes_wa ORDER BY fecha ASC LIMIT ?', [limit])
}

// ── Rutas Config ──────────────────────────────────────────────────────────────
export function getRutasConfig() {
  return getAll(`
    SELECT r.id as ruta_id, r.codigo, r.nombre,
           COALESCE(rc.precio, r.precio_base)   as precio,
           COALESCE(rc.horarios, '[]')           as horarios,
           COALESCE(rc.duracion_horas, 3)        as duracion_horas
    FROM rutas r
    LEFT JOIN rutas_config rc ON rc.ruta_id = r.id
    ORDER BY r.id
  `)
}

export function upsertRutaConfig(rutaId: number, precio: number, horarios: string[], duracionHoras?: number) {
  runSQL(
    `INSERT INTO rutas_config (ruta_id, precio, horarios, duracion_horas)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(ruta_id) DO UPDATE SET
       precio=excluded.precio,
       horarios=excluded.horarios,
       duracion_horas=excluded.duracion_horas`,
    p(rutaId, precio, JSON.stringify(horarios), duracionHoras ?? 3)
  )
}

// ── Bot Conversations ─────────────────────────────────────────────────────────
export function getBotConversation(jid: string) {
  return getOne('SELECT * FROM bot_conversations WHERE jid = ?', [jid])
}

export function upsertBotConversation(jid: string, canal: string, estado: string, datos: object) {
  runSQL(
    `INSERT INTO bot_conversations (jid, canal, estado, datos, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(jid) DO UPDATE SET
       canal=excluded.canal, estado=excluded.estado,
       datos=excluded.datos, updated_at=excluded.updated_at`,
    p(jid, canal, estado, JSON.stringify(datos))
  )
}

export function deleteBotConversation(jid: string) {
  runSQL('DELETE FROM bot_conversations WHERE jid = ?', [jid])
}

// ── Licencias ─────────────────────────────────────────────────────────────────
export function getLicencia() {
  return getOne('SELECT * FROM licencia WHERE id = 1')
}

export function saveLicencia(data: {
  clave: string; empresa: string; email?: string | null;
  fecha_activacion: string; fecha_vencimiento: string; plan?: string | null;
}) {
  runSQL(
    `INSERT OR REPLACE INTO licencia (id, clave, empresa, email, fecha_activacion, fecha_vencimiento, ultima_validacion, plan)
     VALUES (1, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)`,
    p(data.clave, data.empresa, data.email ?? null, data.fecha_activacion, data.fecha_vencimiento, data.plan ?? '1y')
  )
  return getLicencia()
}

export function updateLicenciaValidacion() {
  runSQL("UPDATE licencia SET ultima_validacion = datetime('now','localtime') WHERE id = 1")
}

export function deleteLicencia() {
  runSQL('DELETE FROM licencia WHERE id = 1')
}

// ── Grupos para autocompletar (job de fondo cada 1 min) ───────────────────────
export function getViajeGruposParaAutocompletar() {
  return getAll(`
    SELECT vg.*, r.codigo as ruta_codigo,
      COALESCE(rc.duracion_horas, 3) as duracion_horas
    FROM viaje_grupos vg
    JOIN rutas r ON r.id = vg.ruta_id
    LEFT JOIN rutas_config rc ON rc.ruta_id = vg.ruta_id
    WHERE vg.estado IN ('abierto','lleno','en_curso')
      AND datetime(vg.fecha || ' ' || vg.hora, '+' || CAST(CAST(COALESCE(rc.duracion_horas, 3) AS INTEGER) AS TEXT) || ' hours') <= datetime('now','localtime')
  `)
}

// ── Clientes ──────────────────────────────────────────────────────────────────
export function getCliente(telefono: string) {
  return getOne('SELECT * FROM clientes WHERE telefono = ?', [telefono])
}

export function createCliente(data: { telefono: string; nombre?: string | null }) {
  runSQL(
    'INSERT OR IGNORE INTO clientes (telefono, nombre) VALUES (?, ?)',
    p(data.telefono, data.nombre ?? null)
  )
  return getCliente(data.telefono)
}

export function updateClienteVerificado(telefono: string, fotoPath: string) {
  runSQL(
    "UPDATE clientes SET verificado=1, foto_verificacion=? WHERE telefono=?",
    p(fotoPath, telefono)
  )
  return getCliente(telefono)
}

export function getClientes() {
  return getAll('SELECT * FROM clientes ORDER BY fecha_registro DESC')
}

// ── Logo empresa ──────────────────────────────────────────────────────────────
export function updateEmpresaLogo(logoData: string | null) {
  runSQL('UPDATE empresa SET logo=? WHERE id=1', p(logoData))
  return getEmpresa()
}

// ── Historial WhatsApp ────────────────────────────────────────────────────────
export function saveMensajeHistorial(data: {
  wa_msg_id: string; contacto: string; telefono?: string | null;
  mensaje: string; tipo: 'entrante' | 'saliente'; jid: string; fecha: string;
  wa_numero?: string | null;
}) {
  runSQL(
    'INSERT OR IGNORE INTO mensajes_wa (wa_msg_id, contacto, telefono, mensaje, tipo, jid, canal, fecha, wa_numero) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    p(data.wa_msg_id, data.contacto, data.telefono ?? null, data.mensaje,
      data.tipo, data.jid, 'whatsapp', data.fecha, data.wa_numero ?? null)
  )
}

// Versión batch: inserta múltiples mensajes históricos con un solo saveDB al final.
// Evita el freeze causado por llamar saveDB() cientos de veces al cargar el historial.
export function saveMensajeHistorialBatch(messages: Array<{
  wa_msg_id: string; contacto: string; telefono?: string | null;
  mensaje: string; tipo: 'entrante' | 'saliente'; jid: string; fecha: string;
  wa_numero?: string | null;
}>) {
  for (const data of messages) {
    try {
      db.run(
        'INSERT OR IGNORE INTO mensajes_wa (wa_msg_id, contacto, telefono, mensaje, tipo, jid, canal, fecha, wa_numero) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        p(data.wa_msg_id, data.contacto, data.telefono ?? null, data.mensaje,
          data.tipo, data.jid, 'whatsapp', data.fecha, data.wa_numero ?? null)
      )
    } catch { /* duplicado: ignora */ }
  }
  saveDB()
}

// ── Viaje Grupos ──────────────────────────────────────────────────────────────

const JOIN_GRUPO = `
  SELECT vg.*,
    c.nombre as chofer_nombre, c.digito_placa, c.grupo_wa_id as chofer_grupo_wa_id,
    r.codigo as ruta_codigo, r.nombre as ruta_nombre,
    COALESCE((SELECT SUM(v2.monto) FROM viajes v2 WHERE v2.viaje_grupo_id = vg.id), 0) as total_monto,
    COALESCE((SELECT COUNT(*) FROM viajes v2 WHERE v2.viaje_grupo_id = vg.id AND v2.tipo = 'encomienda' AND v2.estado != 'cancelado'), 0) as cant_encomiendas
  FROM viaje_grupos vg
  LEFT JOIN choferes c ON c.id = vg.chofer_id
  LEFT JOIN rutas r ON r.id = vg.ruta_id
`

export function getViajeGrupos(fecha: string) {
  return getAll(`${JOIN_GRUPO} WHERE vg.fecha=? ORDER BY vg.hora ASC, vg.id ASC`, [fecha])
}

export function getViajesByGrupo(grupoId: number) {
  return getAll(`${JOIN_VIAJE} WHERE v.viaje_grupo_id=? ORDER BY v.id ASC`, [grupoId])
}

export function updateViajeGrupoEstado(grupoId: number, estado: string) {
  runSQL('UPDATE viaje_grupos SET estado=? WHERE id=?', p(estado, grupoId))
  if (estado === 'completado' || estado === 'cancelado' || estado === 'en_curso') {
    runSQL('UPDATE viajes SET estado=? WHERE viaje_grupo_id=?', p(estado, grupoId))
  }
  return { success: true }
}

export function getOrCreateViajeGrupo(
  rutaId: number,
  fecha: string,
  hora: string,
  cantUnidades: number,  // 0 para encomiendas → no consume cupo de pasajeros
  cupoMaximo: number,
): Record<string, SqlValue> {
  if (cantUnidades === 0) {
    // Encomienda: se une al grupo activo sin afectar cupo_ocupado
    const existing = getOne(
      `SELECT * FROM viaje_grupos WHERE ruta_id=? AND fecha=? AND hora=?
       AND estado NOT IN ('completado','cancelado') ORDER BY id ASC LIMIT 1`,
      [rutaId, fecha, hora]
    )
    if (existing) return existing
    // No hay grupo para ese slot — crear uno con el siguiente chofer (cupo_ocupado=0)
    const chofer = asignarChofer(rutaId, hora, fecha)
    runSQL(
      'INSERT INTO viaje_grupos (ruta_id, fecha, hora, chofer_id, cupo_maximo, cupo_ocupado, estado) VALUES (?, ?, ?, ?, ?, 0, ?)',
      p(rutaId, fecha, hora, chofer?.id ?? null, cupoMaximo, 'abierto')
    )
    return getOne(
      'SELECT * FROM viaje_grupos WHERE ruta_id=? AND fecha=? AND hora=? ORDER BY id DESC LIMIT 1',
      [rutaId, fecha, hora]
    )!
  }

  // Pasajero: buscar grupo con cupo disponible
  const existing = getOne(
    `SELECT * FROM viaje_grupos
     WHERE ruta_id=? AND fecha=? AND hora=? AND estado='abierto'
     AND (cupo_ocupado + ?) <= cupo_maximo
     ORDER BY id ASC LIMIT 1`,
    [rutaId, fecha, hora, cantUnidades]
  )
  if (existing) {
    const newCupo   = (existing.cupo_ocupado as number) + cantUnidades
    const newEstado = newCupo >= (existing.cupo_maximo as number) ? 'lleno' : 'abierto'
    runSQL('UPDATE viaje_grupos SET cupo_ocupado=?, estado=? WHERE id=?', p(newCupo, newEstado, existing.id))
    return { ...existing, cupo_ocupado: newCupo, estado: newEstado }
  }
  // No hay grupo abierto — crear uno nuevo con el siguiente chofer en turno
  const chofer    = asignarChofer(rutaId, hora, fecha)
  const newEstado = cantUnidades >= cupoMaximo ? 'lleno' : 'abierto'
  runSQL(
    'INSERT INTO viaje_grupos (ruta_id, fecha, hora, chofer_id, cupo_maximo, cupo_ocupado, estado) VALUES (?, ?, ?, ?, ?, ?, ?)',
    p(rutaId, fecha, hora, chofer?.id ?? null, cupoMaximo, cantUnidades, newEstado)
  )
  return getOne(
    'SELECT * FROM viaje_grupos WHERE ruta_id=? AND fecha=? AND hora=? ORDER BY id DESC LIMIT 1',
    [rutaId, fecha, hora]
  )!
}

export function createViajeConGrupo(data: Record<string, unknown>) {
  const cupoMaximo  = (getOne('SELECT cupo_maximo FROM empresa WHERE id=1')?.cupo_maximo as number) ?? 3
  const tipo        = (data.tipo as string) ?? 'pasajero'
  const cantUnidades = tipo === 'encomienda' ? 0 : Math.max(1, Number(data.cant_pasajeros ?? 1))

  const grupo = getOrCreateViajeGrupo(
    data.ruta_id as number,
    data.fecha as string,
    data.hora as string,
    cantUnidades,
    cupoMaximo,
  )

  const viaje = createViaje({ ...data, chofer_id: grupo.chofer_id, viaje_grupo_id: grupo.id })

  const choferRow = grupo.chofer_id
    ? getOne('SELECT grupo_wa_id, telefono FROM choferes WHERE id=?', [grupo.chofer_id]) ?? null
    : null
  const choferWaId    = (choferRow?.grupo_wa_id as string | null) ?? null
  const choferTelefono = (choferRow?.telefono  as string | null) ?? null

  return { viaje, grupo: { ...grupo, chofer_grupo_wa_id: choferWaId, chofer_telefono: choferTelefono } }
}

export function getMostRecentViajeByPhone(telefono: string) {
  const today = new Date().toISOString().slice(0, 10)
  return getOne(
    `SELECT * FROM viajes WHERE cliente_telefono=? AND estado='confirmado' AND fecha >= ? ORDER BY fecha ASC, hora ASC LIMIT 1`,
    [telefono, today]
  ) ?? null
}

export function cancelarViaje(id: number): boolean {
  const viaje = getOne('SELECT * FROM viajes WHERE id=?', [id])
  if (!viaje) return false
  runSQL('UPDATE viajes SET estado=? WHERE id=?', p('cancelado', id))
  if (viaje.viaje_grupo_id && Number(viaje.cant_pasajeros) > 0) {
    runSQL(
      `UPDATE viaje_grupos SET cupo_ocupado = MAX(0, cupo_ocupado - ?),
       estado = CASE WHEN estado = 'lleno' THEN 'abierto' ELSE estado END WHERE id=?`,
      p(Number(viaje.cant_pasajeros), viaje.viaje_grupo_id)
    )
  }
  return true
}

export function migrarViajesAGrupos() {
  const cupoMaximo = (getOne('SELECT cupo_maximo FROM empresa WHERE id=1')?.cupo_maximo as number) ?? 3
  const slots = getAll(`
    SELECT DISTINCT ruta_id, fecha, hora FROM viajes
    WHERE viaje_grupo_id IS NULL AND estado != 'cancelado'
    ORDER BY ruta_id, fecha, hora
  `)
  for (const slot of slots) {
    const viajes = getAll(
      `SELECT * FROM viajes WHERE ruta_id=? AND fecha=? AND hora=? AND viaje_grupo_id IS NULL ORDER BY id ASC`,
      [slot.ruta_id, slot.fecha, slot.hora]
    )
    let grupoId: number | null = null
    let cupoOcupado = 0
    for (const v of viajes) {
      const unidades = (v.tipo as string) === 'encomienda' ? 1 : Math.max(1, (v.cant_pasajeros as number) ?? 1)
      if (grupoId === null || cupoOcupado + unidades > cupoMaximo) {
        const estado = unidades >= cupoMaximo ? 'lleno' : 'abierto'
        db.run(
          'INSERT INTO viaje_grupos (ruta_id, fecha, hora, chofer_id, cupo_maximo, cupo_ocupado, estado) VALUES (?, ?, ?, ?, ?, ?, ?)',
          p(slot.ruta_id, slot.fecha, slot.hora, v.chofer_id ?? null, cupoMaximo, 0, estado)
        )
        grupoId    = getLastId()
        cupoOcupado = 0
      }
      cupoOcupado += unidades
      const est = cupoOcupado >= cupoMaximo ? 'lleno' : 'abierto'
      db.run('UPDATE viaje_grupos SET cupo_ocupado=?, estado=? WHERE id=?', p(cupoOcupado, est, grupoId))
      db.run('UPDATE viajes SET viaje_grupo_id=? WHERE id=?', p(grupoId, v.id))
    }
  }
  saveDB()
}

// ── Tarifas Encomiendas ───────────────────────────────────────────────────────
export function getTarifasEncomiendas() {
  return getAll('SELECT * FROM tarifas_encomiendas ORDER BY destino ASC')
}

export function upsertTarifaEncomienda(destino: string, precioBase: number, recargoPorKg: number) {
  runSQL(
    `INSERT INTO tarifas_encomiendas (destino, precio_base, recargo_por_kg)
     VALUES (?, ?, ?)
     ON CONFLICT(destino) DO UPDATE SET
       precio_base=excluded.precio_base,
       recargo_por_kg=excluded.recargo_por_kg`,
    p(destino, precioBase, recargoPorKg)
  )
}

// ── Preguntas Frecuentes ──────────────────────────────────────────────────────
export function getFAQ() {
  return getAll('SELECT * FROM preguntas_frecuentes WHERE activo=1 ORDER BY id ASC')
}

export function createFAQ(preguntaClave: string, respuesta: string) {
  runSQL('INSERT INTO preguntas_frecuentes (pregunta_clave, respuesta) VALUES (?, ?)', p(preguntaClave, respuesta))
  return getOne('SELECT * FROM preguntas_frecuentes ORDER BY id DESC LIMIT 1')
}

export function updateFAQ(id: number, preguntaClave: string, respuesta: string) {
  runSQL('UPDATE preguntas_frecuentes SET pregunta_clave=?, respuesta=? WHERE id=?', p(preguntaClave, respuesta, id))
}

export function deleteFAQ(id: number) {
  runSQL('DELETE FROM preguntas_frecuentes WHERE id=?', p(id))
}

export function saveEdicionTurnos(fecha: string, textoGenerado: string, textoEditado: string) {
  runSQL(
    'INSERT INTO ediciones_turnos (fecha, texto_generado, texto_editado) VALUES (?, ?, ?)',
    p(fecha, textoGenerado, textoEditado)
  )
}

// ── Tarifas Zonas ─────────────────────────────────────────────────────────────
export function getTarifasZonas(ciudad?: string, tipo?: string): Record<string, SqlValue>[] {
  let sql = 'SELECT * FROM tarifas_zonas WHERE activo=1'
  const params: SqlValue[] = []
  if (ciudad) { sql += ' AND ciudad=?'; params.push(ciudad) }
  if (tipo)   { sql += ' AND tipo=?';   params.push(tipo) }
  sql += ' ORDER BY zona'
  return getAll(sql, params)
}

export function upsertTarifaZona(ciudad: string, zona: string, tipo: string, recargo: number) {
  runSQL(
    'INSERT OR REPLACE INTO tarifas_zonas (ciudad, zona, tipo, recargo, activo) VALUES (?,?,?,?,1)',
    p(ciudad, zona, tipo, recargo)
  )
}

// ── Tarifas Encomienda Tamaños ────────────────────────────────────────────────
export function getTarifasEncTamanos(): Record<string, SqlValue>[] {
  return getAll('SELECT * FROM tarifas_enc_tamanos WHERE activo=1 ORDER BY precio')
}

export function upsertTarifaEncTamano(id: number | null, descripcion: string, precio: number) {
  if (id) {
    db.run('UPDATE tarifas_enc_tamanos SET descripcion=?, precio=? WHERE id=?', p(descripcion, precio, id))
  } else {
    db.run('INSERT OR REPLACE INTO tarifas_enc_tamanos (descripcion, precio, activo) VALUES (?,?,1)', p(descripcion, precio))
  }
  saveDB()
}

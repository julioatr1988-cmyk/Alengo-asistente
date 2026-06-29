# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Regla obligatoria: usar Context7 para estas librerías

Antes de escribir o corregir código que involucre `@whiskeysockets/baileys`, `electron`, `electron-builder`, `electron-updater`, `sql.js`, `mammoth`, `pdfjs-dist`, `React` o `TypeScript`, consultar la documentación actual con Context7. Varios bugs concretos vinieron de detalles que cambiaron (error "browser is already running", rutas WASM de sql.js con Node 20, ícono del instalador).

## Comandos

```bash
# Desarrollo (Vite en :5173 + Electron en paralelo)
npm run dev

# Verificar TypeScript — AMBAS configs son necesarias
./node_modules/.bin/tsc --noEmit                             # renderer (src/)
./node_modules/.bin/tsc -p tsconfig.electron.json --noEmit  # main process (electron/)

# Build y empaquetado
npm run build       # compila TS + Vite
npm run dist:win    # genera instalador Windows (.exe) en release/

# Publicar release a GitHub (requiere GH_TOKEN)
GH_TOKEN=$(gh auth token) ./node_modules/.bin/electron-builder --win --publish always

# Desplegar Worker de licencias
cd workers && npx wrangler deploy
```

No hay tests automatizados. La verificación es `tsc --noEmit` en ambas configs. `tsconfig.node.json` solo cubre `vite.config.ts` — no usarlo para verificar `electron/`. Los errores del main process no aparecen en la config del renderer.

## Arquitectura

**Stack**: Electron 29 (Node.js 20) · React 18 · TypeScript · Vite · Tailwind · Zustand · sql.js · Baileys v7 · v1.5.0

App de escritorio para call centers de transporte interprovincial en Ecuador. Gestiona viajes, choferes, turnos, pagos mensuales, y tiene bot automático de WhatsApp y Facebook Messenger.

```
Renderer (React/Vite)          Main process (Electron/Node)
  src/pages/                     electron/main.ts       ← IPC handlers + cliente WA + auto-updater
  src/components/                electron/database.ts   ← SQLite via sql.js WASM
  src/store/useAppStore.ts       electron/bot.ts        ← máquina de estados del bot
  src/types/index.ts             electron/messenger.ts  ← polling Graph API Facebook
        │                                │
        └──── electron/preload.ts ───────┘
               contextBridge → window.electronAPI
```

Toda comunicación renderer↔main pasa por `ipcRenderer.invoke` / `ipcMain.handle`. Cualquier función nueva en database.ts requiere el flujo completo: export → import en main.ts → `ipcMain.handle` → entrada en preload.ts → tipo en `Window.electronAPI` en `src/types/index.ts`.

## Base de datos (sql.js)

SQLite corre en WASM en memoria, persistido en `AppData/Roaming/alengo-asistente/database.sqlite`.

- **Flush periódico**: `runSQL()` llama `db.run()` y activa `dbDirty = true`. Un `setInterval` de 1 500 ms escribe a disco solo si `dbDirty`. NO hay escritura síncrona por operación. `flushDB()` (llamado en `before-quit`) garantiza la escritura final.
- **Operaciones bulk**: usar `db.run()` en el loop y `saveDB()` una sola vez al final para escritura inmediata garantizada. Ver `saveMensajeHistorialBatch()` y `upsertClientesBatch()` como ejemplos.
- **`getAll()` / `getOne()`** para lecturas; devuelven `Record<string, SqlValue>[]`.
- **Migraciones**: array `migrations` en `createTables()`. SQLite no tiene `ADD COLUMN IF NOT EXISTS` — usar try/catch con `/* columna ya existe */`.
- **Seed**: `seedData()` usa `INSERT OR IGNORE` — seguro en cada arranque.
- `initDB()`: `createTables()` → `seedData()` → `migrarViajesAGrupos()` → `saveDB()`.

**WASM en app empaquetada** (Node.js 20 tiene `fetch()` global, sql.js lo usa para rutas internas del asar que fallan):
```typescript
app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  : path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
```
El WASM está en `asarUnpack` en `electron-builder.config.js`.

**Tarifas por zona** (`tarifas_zonas`): `UNIQUE(ciudad, zona, tipo)`. `tipo` = `'pasajero'` | `'encomienda'`. Para pasajeros QUITO el `recargo` es el precio total (no suplemento); para STO y encomiendas es un recargo adicional.

## Modelo viaje_grupos

Un `viaje_grupo` es un vehículo físico (chofer + ruta + fecha + hora). Varios `viajes` pertenecen al mismo grupo vía `viaje_grupo_id`.

Reglas críticas:
- `cupo_ocupado` solo cuenta pasajeros (`cant_pasajeros`). Encomiendas usan `cantUnidades = 0`.
- Usar siempre `createViajeConGrupo()` — nunca `createViaje()` + `asignarChofer()` por separado.
- `createViajeConGrupo()` retorna `{ viaje, grupo }` donde `grupo` incluye `chofer_grupo_wa_id` y `chofer_telefono`.
- `asignarChofer(rutaId, hora, fecha?)`: filtra por `rutas_asignadas LIKE '%"CODIGO"%'` y excluye choferes con grupo activo en ese slot. Fallback: ignora exclusión si todos están ocupados.

## WhatsApp (Baileys v7)

Baileys es ESM-only. El main process compila a CJS — TypeScript convertiría `import()` a `require()` (que falla con ESM). Solución:
```typescript
const esmImport = (m: string): Promise<any> => new Function('m', 'return import(m)')(m)
const { default: makeWASocket, ... } = await esmImport('@whiskeysockets/baileys')
```
El `import type` estático sí funciona porque no genera código en runtime.

- **NO instalar pino** — pino v10+ no es compatible con el Node.js de Electron 28.
- JIDs individuales: `@s.whatsapp.net` (no `@c.us`). Grupos: `@g.us`.
- Cerrar sin logout: `sock.end(undefined)`. Logout del usuario: `await sock.logout()` + borrar `wa-session/`.
- La sesión persiste en `AppData/wa-session/` via `useMultiFileAuthState`.
- Al conectar, carga historial via `messaging-history.set` y grupos via `groupFetchAllParticipating()`.
- Nombres de contactos se persisten en tabla `contactos_wa` (JID → nombre). Fuentes: `contacts.upsert`, `contacts.update`, `messaging-history.set` (campo `contacts`), y `pushName` de mensajes entrantes. `getContactoNombre(jid)` → fallback cuando `pushName` no está disponible. **CRÍTICO**: usar `c.phoneNumber || c.id` como clave de almacenamiento — `c.id` puede ser formato LID (`@lid`) que no coincide con JIDs de mensajes (`@s.whatsapp.net`).
- Mensajes multimedia (imagen, audio, video, documento, sticker) se guardan en DB con texto descriptivo emoji (ej. `📷 Imagen`, `🎤 Nota de voz`). Las imágenes de verificación de cliente se procesan aparte y no se muestran en el chat. `getContactosWaNombres()` devuelve todos los contactos como `Record<string, string>` para override en el renderer.
- Preload.ts usa patrón singleton para listeners WA: `ipcRenderer.on` se registra una sola vez al cargar el preload; los callbacks son variables reemplazables (no se agregan nuevos listeners en cada montaje de Chat).
- Al reconectar (`connection === 'open'`), se llama `limpiarConversacionesAntiguas(8)` para resetear conversaciones del bot atascadas más de 8 horas — evita que clientes verificados sean tratados como nuevos.
- Fotos de verificación de clientes: `AppData/verificaciones/`.

**Estado de conexión** (`waSocket`, `waConnected`, `waConnecting`, `waQrTimer` en main.ts):
- `waConnecting = true` desde que empieza `iniciarWhatsApp` hasta `connection === 'open'` o `'close'`.
- `waQrTimer`: si el QR se muestra y no se escanea en 2 minutos, resetea `waConnecting` y notifica al usuario. Sin esto, la app quedaría trabada sin poder reconectar.
- `fetchLatestBaileysVersion()` tiene timeout de 8s via `Promise.race` con versión fallback — evita colgar la conexión si no hay red.
- Reconexión automática: 3 segundos tras cierre, solo si `statusCode !== DisconnectReason.loggedOut`.

**Prioridad de nombre en Chat** (aplicada en `cargarMensajesDB` en Chat.tsx):
1. `clientes.nombre` — verificado por el operador (importación Excel/PDF/manual)
2. `contactos_wa.nombre` — directorio telefónico del dispositivo
3. `pushName` — auto-reportado por el remitente en el mensaje
4. Número de teléfono como fallback

**Alta automática de clientes**: cualquier mensaje entrante de un número individual (no grupo) llama `upsertClienteFromWA(normalizePhone(phone), nombre)` en main.ts antes de invocar el bot. Crea la fila con `origen='whatsapp'` si no existe; si existe con `nombre IS NULL`, rellena el nombre. Nunca pisa un nombre ya guardado.

## Bot de WhatsApp (bot.ts)

Máquina de estados con `BotEstado` en tabla `bot_conversations` (por JID). Grupos `@g.us` son ignorados.

**Flujo pasajero**:
```
pedir_destino → pedir_zona* → pedir_fecha_hora → pedir_pasajeros → pedir_nombre
  → pedir_para_quien → (pedir_telefono?) → pedir_origen → pedir_factura → crear viaje
```
`*pedir_zona` se salta si el usuario ya menciona un barrio reconocido. QUITO y SANTO DOMINGO tienen zonas con precios diferenciados; GUAYAQUIL y MANTA tienen precio plano.

**Flujo encomienda**:
```
pedir_destino_enc → pedir_tamano_enc → pedir_zona_enc → pedir_remitente_enc
  → pedir_destinatario_enc → pedir_entrega_enc → crear viaje (tipo='encomienda')
```

**Precio final**: `datos.precio_zona ?? rutaCfg.precio`. `datos.precio_zona` se setea en `pedir_zona` o si el usuario mencionó el sector en el mismo mensaje del destino.

**En estado idle**, antes del flujo normal:
1. Detección "chofer no llegó" → teléfono de empresa.
2. Detección "cancelar viaje" → `getMostRecentViajeByPhone()` + `cancelarViaje()`.
3. FAQ lookup contra `preguntas_frecuentes`.

**En flujo activo**, antes de capturar como valor literal:
1. `detectarInterrupcion()` → cancelar / precio / disponibilidad / saludo.
2. FAQ lookup.

## Auto-updater

`electron-updater` revisa actualizaciones 10s después del arranque (omitido en dev). `autoDownload = false` pero el handler de `update-available` llama `downloadUpdate()` manualmente — en la práctica es auto-descarga con control de errores. `autoInstallOnAppQuit: true`.

- GitHub: `owner: 'julioatr1988-cmyk'`, `repo: 'Alengo-asistente'` en `electron-builder.config.js`.
- Para publicar: `AlengoAsistente-Setup.exe` + `.exe.blockmap` + `latest.yml` deben estar en el release de GitHub.
- `verifyUpdateCodeSignature = false` — no hay Code Signing Certificate.

## Comportamientos críticos de UI

**NuevoViajeModal**: `onCreated` en Dashboard **no debe** llamar `setShowModal(false)`. El modal muestra confirmación interna; cerrarlo desde fuera evita que el usuario la vea y provoca clics duplicados.
```tsx
onCreated={() => { void loadTurnos(); void loadGrupos() }}  // correcto
```

**"Publicar en grupo"**: no envía directo. Abre modal con `<textarea>` editable. Si el texto fue modificado, se guarda en `ediciones_turnos`.

**Activacion.tsx**: no mostrar precios ($50/$90) en la pantalla de activación de licencia.

## Job de fondo

`startBackgroundInterval()` corre cada 60s. Marca `viaje_grupos` activos como `completado` cuando `hora + duracion_horas` ya pasó, y actualiza `ciudad_actual` del chofer al destino de la ruta.

## Panel de licencias (workers/)

Cloudflare Worker en `workers/license-worker.js`. Sirve API de licencias + panel admin web.

Endpoints públicos: `GET /validate?key=&fingerprint=`, `POST /activate { key, fingerprint }`, `POST /ai/extract-contacts { key, fingerprint, text, filename }`.  
Endpoints admin (Bearer `ADMIN_SECRET`): `/admin/list`, `/admin/create`, `/admin/toggle`, `/admin/renew`, `/admin/transfer`.

**`/ai/extract-contacts`**: recibe texto plano (máx 8 000 chars) extraído de .docx/.pdf, llama a Claude Haiku, devuelve `{ success, contacts: [{nombre,telefono}][], usage, limit }`. Rate limit: 50 llamadas/mes/licencia, clave KV `usage:${licKey}:YYYY-MM` con TTL 35 días. Auth hacia Anthropic: detecta prefijo `sk-ant-oat` → `Authorization: Bearer`; de lo contrario → `x-api-key`.

**`/admin/transfer`**: resetea `fingerprint_pc` y `activada` a null/false. Usar cuando el fingerprint de la PC cambió (ej. adaptadores de red virtuales reinstalados) y el usuario ve `pc_mismatch`. Tras el transfer, el usuario debe re-activar desde Configuración.

**Trampa crítica**: el HTML del panel está en un template literal (backticks). `\'` dentro → `'` en el HTML servido, lo que rompe strings JS en `<script>`. `\n` → salto de línea real, SyntaxError en strings de una línea. Solución: atributos `data-*` para valores dinámicos; nunca strings con comilla simple que contengan datos del servidor.

Verificar JS del panel: `curl -s <URL>/ | sed -n '/<script>/,/<\/script>/p' | sed '1d;$d' | node --check`

## Fingerprint de licencia

`getFingerprint()` en main.ts: hash SHA-256 de `hostname + hasta 3 MACs` ordenadas, separadas por `|`, excluyendo interfaces que coincidan con `/virtual|loopback|vmware|vbox|vpn/i`. Truncado a 32 chars hex. Identifica el equipo para activación y para `/ai/extract-contacts`.

**Trampa de estabilidad**: el filtro de nombres no excluye adaptadores Hyper-V (`vEthernet (Default Switch)`). Si el adaptador virtual se reinstala, su MAC cambia y el fingerprint cambia → `pc_mismatch`. Solución temporal: usar `/admin/transfer` + re-activar.

## Módulo Clientes (página /clientes)

Tabla `clientes` es la fuente única para todos los clientes, independiente del canal de entrada.

**Columnas añadidas** (migraciones): `origen TEXT DEFAULT 'whatsapp'` · `actualizado_en TEXT`.  
`origen` puede ser `'whatsapp'` | `'importado'` | `'manual'`.

**Regla crítica en upsert**: nunca pisar `verificado` ni `foto_verificacion`. El SQL de upsert solo actualiza `nombre`, `origen`, `actualizado_en`:
```sql
INSERT INTO clientes (telefono, nombre, origen, actualizado_en)
VALUES (?, ?, ?, datetime('now','localtime'))
ON CONFLICT(telefono) DO UPDATE SET nombre=excluded.nombre, origen=excluded.origen, actualizado_en=excluded.actualizado_en
```

**`upsertClientesBatch(rows)`** en database.ts: patrón bulk estándar — `db.run()` en loop + `saveDB()` una vez al final.

**`upsertClienteFromWA(telefono, nombre)`**: variante de inserción para alta automática desde WhatsApp. Solo rellena `nombre` si el registro existente tiene `nombre IS NULL` — nunca sobreescribe un nombre importado o manual. Se llama en `main.ts` ante cualquier mensaje entrante no-grupo, antes de invocar el bot.

**`getClientesNombres()`**: retorna `Record<telefono, nombre>` de todos los clientes con nombre no nulo. Expuesto como `clientes:getNombres` IPC y usado en Chat.tsx como capa de override de nombre de mayor prioridad.

**Importación Excel**: la lógica de parsing (`parseExcel`) vive en el renderer (`src/pages/Clientes.tsx`), no en el main process. Usa `await import('exceljs')` + `wb.xlsx.load(arrayBuffer)` (ExcelJS soporta ArrayBuffer en browser). Detecta headers automáticamente (`nombre/name/celular/phone/…`); sino auto-detecta columnas por heurística (texto = nombre, 7-15 dígitos = teléfono). Normaliza con la misma lógica que `normalizePhone` en main.ts.

**Importación Word/PDF**: el botón acepta `.xlsx`, `.docx` y `.pdf`. Para Word/PDF, el renderer obtiene `(file as File & { path: string }).path` (disponible en Electron con `sandbox: false`) y llama `window.electronAPI.clientes.extractContactsFromDoc(filePath, ext, filename)`. El main process extrae el texto (`mammoth` para .docx, `pdfjs-dist/legacy/build/pdf.js` para .pdf) y llama al Worker `/ai/extract-contacts`. Razón para extraer en el main: la licencia/fingerprint están ahí, evita serializar ArrayBuffers grandes por IPC, y pdfjs-dist no requiere configurar worker en contexto browser.

- `mammoth`: CJS puro, sin binarios nativos — `mammoth.extractRawText({ buffer: fs.readFileSync(path) })`
- `pdfjs-dist@3` (pinado a v3): `require('pdfjs-dist/legacy/build/pdf.js')`. Debe fijar `GlobalWorkerOptions.workerSrc = false` antes de llamar `getDocument()`. Los warnings de canvas/DOMMatrix son inofensivos — canvas solo se necesita para rendering, no para extracción de texto.

**`ContactosPreview`** (`src/components/ContactosPreview.tsx`): componente reutilizable de vista previa editable. Recibe `rows: ClienteImportRow[]` + `onConfirm/onCancel`. Muestra tabla editable con checkboxes, badges "Nuevo" / "Actualiza nombre". Usado tanto para Excel como para Word/PDF — no duplicar esta lógica.

## Reset de datos

```powershell
# Borrar solo la BD (sesión WA se conserva)
Remove-Item "$env:APPDATA\alengo-asistente\database.sqlite" -Force
```

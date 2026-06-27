# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Regla obligatoria: usar Context7 para estas librerías

Antes de escribir o corregir código que involucre `@whiskeysockets/baileys`, `electron`, `electron-builder`, `electron-updater`, `sql.js`, `React` o `TypeScript`, consultar la documentación actual con Context7. Varios bugs concretos vinieron de detalles que cambiaron (error "browser is already running", rutas WASM de sql.js con Node 20, ícono del instalador).

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

**Stack**: Electron 29 (Node.js 20) · React 18 · TypeScript · Vite · Tailwind · Zustand · sql.js · Baileys v7 · v1.4.6

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

- **`saveDB()`** escribe el DB completo a disco (síncrono). `runSQL()` la llama automáticamente. Las escrituras directas con `db.run()` dentro de loops (migraciones, seeds) no la llaman — llamar al final del bloque.
- **Operaciones bulk**: usar `db.run()` en el loop y `saveDB()` una sola vez al final. **Nunca** llamar `runSQL()` en un loop de cientos de registros — cada llamada escribe todo el archivo al disco y congela el proceso. Ver `saveMensajeHistorialBatch()` como ejemplo del patrón correcto.
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

Endpoints públicos: `GET /validate?key=&fingerprint=`, `POST /activate { key, fingerprint }`.  
Endpoints admin (Bearer `ADMIN_SECRET`): `/admin/list`, `/admin/create`, `/admin/toggle`, `/admin/renew`, `/admin/transfer`.

**Trampa crítica**: el HTML del panel está en un template literal (backticks). `\'` dentro → `'` en el HTML servido, lo que rompe strings JS en `<script>`. `\n` → salto de línea real, SyntaxError en strings de una línea. Solución: atributos `data-*` para valores dinámicos; nunca strings con comilla simple que contengan datos del servidor.

Verificar JS del panel: `curl -s <URL>/ | sed -n '/<script>/,/<\/script>/p' | sed '1d;$d' | node --check`

## Fingerprint de licencia

`getFingerprint()` en main.ts: hash SHA-256 de `hostname + hasta 3 MACs` (excluyendo interfaces virtuales/VPN). Truncado a 32 chars hex. Identifica el equipo para activación.

## Reset de datos

```powershell
# Borrar solo la BD (sesión WA se conserva)
Remove-Item "$env:APPDATA\alengo-asistente\database.sqlite" -Force
```

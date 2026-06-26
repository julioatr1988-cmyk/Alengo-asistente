# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Desarrollo (Vite en :5173, Electron en paralelo)
npm run dev

# Verificar TypeScript — AMBAS configs son necesarias
npx tsc --noEmit                              # renderer (React, usa tsconfig.json)
npx tsc -p tsconfig.electron.json --noEmit   # main process (Electron)

# Build y empaquetado
npm run build        # compila TS + Vite
npm run dist:win     # genera instalador Windows (.exe)

# Desplegar Worker de licencias (desde workers/)
cd workers && npx wrangler deploy
```

No hay tests automatizados. La verificación es `tsc --noEmit` en ambas configs. `tsconfig.node.json` solo cubre `vite.config.ts` — no lo uses para verificar `electron/`.

## Arquitectura general

**Stack**: Electron 29 (Node.js 20) · React 18 · TypeScript · Vite · Tailwind · Zustand · sql.js
**Versión actual**: 1.4.1 (ver package.json). `whatsapp-web.js` y `better-sqlite3` fueron removidos — el proyecto usa Baileys + sql.js únicamente.

El proyecto es una app de escritorio para call centers de transporte interprovincial en Ecuador. Gestiona viajes, choferes, turnos, pagos, y tiene bot de WhatsApp y Messenger.

### Procesos y capas

```
Renderer (React/Vite)          Main process (Electron/Node)
  src/pages/                     electron/main.ts       ← IPC handlers + WA client + auto-updater
  src/components/                electron/database.ts   ← SQLite (sql.js)
  src/store/useAppStore.ts       electron/bot.ts        ← máquina de estados del bot
  src/types/index.ts             electron/messenger.ts  ← polling Graph API FB
        │                                │
        └──── electron/preload.ts ───────┘
               contextBridge → window.electronAPI
```

Toda comunicación renderer↔main pasa por `ipcRenderer.invoke` / `ipcMain.handle`. El preload.ts expone la API tipada completa. Cualquier función nueva en database.ts necesita: export en database.ts → import en main.ts → handler `ipcMain.handle` → entrada en preload.ts → tipo en `Window.electronAPI` en types/index.ts.

### Base de datos (sql.js)

SQLite corre en WASM en memoria, persistido manualmente en `AppData/Roaming/alengo-asistente/database.sqlite`.

- **`saveDB()`** debe llamarse tras cada escritura. `runSQL()` la llama automáticamente; las escrituras directas con `db.run()` dentro de loops (migraciones, seeds) no la llaman — se llama al final del bloque.
- **`getAll()` / `getOne()`** para lecturas; devuelven `Record<string, SqlValue>[]`.
- **Migraciones**: array `migrations` en `createTables()` — cada entrada es una SQL idempotente (SQLite no tiene `ADD COLUMN IF NOT EXISTS`, se usa try/catch con comentario `/* columna ya existe */`).
- **Seed**: `seedData()` usa `INSERT OR IGNORE` — es seguro correr en cada arranque.
- `initDB()` en arranque: `createTables()` → `seedData()` → `migrarViajesAGrupos()` → `saveDB()`.
- **WASM en app empaquetada**: En Node.js 20 `fetch()` es global y sql.js lo puede usar con rutas internas del asar (que fallan). Solución: siempre usar path explícito:
  ```typescript
  app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    : path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
  ```
  El WASM está en `asarUnpack` en electron-builder.config.js.

**Tablas de tarifas por zona** (agregadas en v1.3.2):
- `tarifas_zonas (ciudad, zona, tipo, recargo, activo)` — `UNIQUE(ciudad, zona, tipo)`. `tipo` = `'pasajero'` | `'encomienda'`. Para pasajeros QUITO el `recargo` es el precio total (no un suplemento); para STO y encomiendas es un recargo adicional. CRUD: `getTarifasZonas(ciudad?, tipo?)` / `upsertTarifaZona(ciudad, zona, tipo, recargo)`.
- `tarifas_enc_tamanos (descripcion, precio, activo)` — tamaños de paquete con precio base. CRUD: `getTarifasEncTamanos()` / `upsertTarifaEncTamano(id, descripcion, precio)`.

### Modelo de datos clave: viaje_grupos

Un **`viaje_grupo`** representa un vehículo físico (chofer + ruta + fecha + hora). Varios **`viajes`** (pasajeros/encomiendas) pertenecen al mismo grupo vía `viaje_grupo_id`.

Reglas críticas:
- `cupo_ocupado` solo cuenta **pasajeros** (`cant_pasajeros`). Las encomiendas usan `cantUnidades = 0` y no modifican cupo.
- `getOrCreateViajeGrupo()`: si `cantUnidades === 0`, busca cualquier grupo activo del slot sin tocar cupo; si hay cupo disponible reutiliza grupo existente; si está lleno crea uno nuevo con `asignarChofer()`.
- `asignarChofer(rutaId, hora, fecha?)`: filtra por `rutas_asignadas LIKE '%"CODIGO"%'` y excluye choferes que ya tienen un grupo activo en ese slot ruta+fecha+hora. Fallback: ignora la exclusión si todos están ocupados.
- Usar siempre `createViajeConGrupo()` para crear viajes — nunca llamar `createViaje()` + `asignarChofer()` por separado.
- `createViajeConGrupo()` retorna `{ viaje, grupo }` donde `grupo` incluye `chofer_grupo_wa_id` y `chofer_telefono` (obtenidos en la misma llamada). Al crear un viaje, main.ts envía WA al grupo del chofer Y a su número personal (`593XXXXXXXXX@s.whatsapp.net`).

### Tabla ediciones_turnos

Registra ediciones que el operador hace al mensaje de turnos antes de publicarlo en WhatsApp. Solo se inserta cuando el texto final difiere del generado automáticamente.

- Función: `saveEdicionTurnos(fecha, textoGenerado, textoEditado)` en database.ts
- IPC: `edicionTurnos:save`
- Propósito: análisis posterior de qué corrige el operador para mejorar la generación automática.

### Bot de WhatsApp (bot.ts)

Máquina de estados con `BotEstado` guardado en tabla `bot_conversations` (por JID).

**Flujo pasajero** (destinos que tienen zonas: QUITO y SANTO DOMINGO):
```
pedir_destino → pedir_zona* → pedir_fecha_hora → pedir_pasajeros → pedir_nombre
  → pedir_para_quien → (pedir_telefono?) → pedir_origen → pedir_factura → crear viaje
```
`*pedir_zona` se salta si el usuario ya menciona un barrio/sector reconocido en el mismo mensaje que el destino. Para GUAYAQUIL y MANTA no hay `pedir_zona` (precio plano).

**Flujo encomienda**:
```
pedir_destino_enc → pedir_tamano_enc → pedir_zona_enc* → pedir_remitente_enc
  → pedir_destinatario_enc → pedir_entrega_enc → crear viaje (tipo='encomienda')
```
`*pedir_zona_enc` pide el barrio de entrega en QUITO; suma el recargo de zona al precio base del tamaño.

**Precio final en `pedir_factura`**: `datos.precio_zona ?? rutaCfg.precio` por pasajero. `datos.precio_zona` queda seteado desde `pedir_zona` (precio de la zona para QUITO/STO) o desde `pedir_destino` si el usuario ya mencionó el sector.

**Estado idle — detecciones especiales** (antes de FAQ y flujo normal):
- "Chofer no llegó" → responde con teléfono de la empresa.
- "Cancelar mi viaje" → busca viaje activo con `getMostRecentViajeByPhone()`, llama `cancelarViaje()`.

Antes de procesar cualquier input como valor literal de campo en flujo activo, se evalúa:
1. `detectarInterrupcion()` → cancelar / precio / disponibilidad / saludo
2. FAQ lookup contra tabla `preguntas_frecuentes`

Grupos WhatsApp (`@g.us`) son ignorados por el bot (`esGrupo(jid)` check al inicio de `procesarMensaje`).

**Notificación al chofer**: Al confirmar una reserva de pasajero vía bot, se envía el resumen del grupo al `chofer_grupo_wa_id` Y al número personal del chofer (`chofer_telefono` → `593XX...@s.whatsapp.net`). El mensaje de confirmación al cliente incluye el teléfono del chofer si está disponible.

### Auto-updater (main.ts)

`electron-updater` revisa actualizaciones 10 segundos después del arranque (omitido en dev). `autoDownload: true` — descarga en segundo plano. `autoInstallOnAppQuit: true`.

- `update:available` → renderer muestra banner con versión y "Descargando..."
- `update:downloaded` → botón "Actualizar" se activa; al pulsar se llama `autoUpdater.quitAndInstall()` via IPC `update:install`.
- Configuración de GitHub en `electron-builder.config.js`: `owner: 'julioatr1988-cmyk'`, `repo: 'Alengo-asistente'`.
- Para publicar: subir `AlengoAsistente-Setup.exe`, `.exe.blockmap` y `latest.yml` al release de GitHub.

### Job de fondo (main.ts `startBackgroundInterval`)

Corre cada 60 s. Busca `viaje_grupos` activos cuya hora+duración_horas ya pasó y los marca `completado` vía `updateViajeGrupoEstado()`, que también actualiza todos sus viajes hijos. Luego mueve el `ciudad_actual` del chofer al destino de la ruta.

Al crear un viaje (IPC `viajes:create` o vía bot), se emite `viajes:updated` para que el Dashboard recargue grupos y turnos.

### WhatsApp (main.ts) — bugs conocidos resueltos en v1.4.1

- **Freeze al cargar historial**: `messaging-history.set` usaba `saveMensajeHistorial()` por cada mensaje → `saveDB()` n veces. Resuelto con `saveMensajeHistorialBatch()` que hace un solo `saveDB()` al final.
- **`waConnecting` bloqueado para siempre**: si el QR se mostraba pero no se escaneaba, `waConnecting` nunca se reseteaba. Resuelto con `waQrTimer` (timeout de 2 min) que libera el estado y notifica al usuario.
- **`fetchLatestBaileysVersion()` podía colgar**: sin red, la petición no tenía límite de tiempo. Resuelto con `Promise.race` y timeout de 8s + versión fallback.
- **`shell:openExternal` sin validación**: acepta ahora solo URLs que empiezen con `http://` o `https://`.
- **`shell:openPath` sin validación**: acepta ahora solo rutas dentro de `app.getPath('userData')`.

### WhatsApp (main.ts)

Cliente `@whiskeysockets/baileys` v7 (WebSocket puro, sin navegador/Puppeteer). La sesión persiste en `AppData/wa-session/` via `useMultiFileAuthState`. Al conectar, carga historial via evento `messaging-history.set` y grupos via `groupFetchAllParticipating()`. Fotos de verificación de clientes se guardan en `AppData/verificaciones/`.

**Importante**: Baileys es ESM-only (`"type": "module"`). El main process de Electron compila a CJS, así que TypeScript convertiría `import()` a `require()` (que falla con ESM). Solución: usar `new Function` para preservar el dynamic import real en el output CJS:
```typescript
const esmImport = (m: string): Promise<any> => new Function('m', 'return import(m)')(m)
const { default: makeWASocket, ... } = await esmImport('@whiskeysockets/baileys')
```
El `import type` para TypeScript sí puede ser estático (no genera código en runtime): `import type { WASocket } from '@whiskeysockets/baileys'`. NO instalar pino — pino v10+ tampoco es compatible con el Node.js de Electron 28 y fue removido.

JIDs: individuales usan `@s.whatsapp.net` (no `@c.us` como whatsapp-web.js), grupos siguen usando `@g.us`.

Para cerrar sin logout (app cerrándose): `sock.end(undefined)`. Para logout del usuario: `await sock.logout()` luego borrar sessionDir.

Los mensajes salientes del bot se emiten al renderer via `win.webContents.send('whatsapp:message', ...)` para que aparezcan en el chat en tiempo real.

### TypeScript configs

| Archivo | Scope | Uso |
|---------|-------|-----|
| `tsconfig.json` | `src/` (renderer React) | build + check |
| `tsconfig.electron.json` | `electron/` | build + check (`--noEmit`) |
| `tsconfig.node.json` | `vite.config.ts` solo | check interno de Vite |

Los errores de `electron/` no aparecen en `tsc --noEmit` (que usa tsconfig.json). Siempre correr `tsc -p tsconfig.electron.json --noEmit` también.

## Comportamientos críticos de UI

### NuevoViajeModal — no cerrar en onCreated

El callback `onCreated` en Dashboard **no debe** cerrar el modal (`setShowModal(false)`). El modal muestra una pantalla de confirmación interna y el usuario la cierra manualmente con "Cerrar". Si `onCreated` cierra el modal inmediatamente, el usuario no ve la confirmación y cree que nada pasó, lo que provoca clics múltiples y viajes duplicados.

Dashboard.tsx correcto:
```tsx
onCreated={() => { void loadTurnos(); void loadGrupos() }}
// NO: onCreated={() => { setShowModal(false); void loadTurnos(); ... }}
```

### "Publicar en grupo" — vista previa editable

Clic en "Publicar en grupo" **no envía directo a WhatsApp**. Abre un modal con el mensaje en un `<textarea>` editable. Solo al confirmar se envía. Si el texto fue modificado respecto al generado, se guarda en `ediciones_turnos`.

### Activacion.tsx — sin precios

La pantalla de activación de licencia no muestra precios ($50/$90). No agregar esos bloques de nuevo.

## Panel de administración de licencias (workers/)

Separado de la app Electron — es un Cloudflare Worker que sirve tanto la API de licencias como un panel web de administración.

```
workers/
  license-worker.js   ← Worker + panel HTML embebido en GET /
  admin.html          ← Copia standalone del panel (puede abrirse localmente)
  wrangler.toml       ← KV namespace LICENSES, secret ADMIN_SECRET
```

**Endpoints públicos** (sin auth):
- `GET /validate?key=...&fingerprint=...` — validar licencia
- `POST /activate` `{ key, fingerprint }` — activar primera vez

**Endpoints admin** (`Authorization: Bearer <ADMIN_SECRET>`):
- `GET /admin/list` — listar todas las licencias
- `POST /admin/create` `{ empresa, email?, plan }` — generar clave nueva
- `POST /admin/toggle` `{ key }` — activar/revocar
- `POST /admin/renew` `{ key, meses }` — extender vencimiento
- `POST /admin/transfer` `{ key }` — resetear fingerprint de PC

**Auth del panel**: la clave de admin es el `ADMIN_SECRET` configurado como secret de Cloudflare (`wrangler secret put ADMIN_SECRET`). El panel la pide en login y la guarda en `localStorage`. Nunca está en el código ni en wrangler.toml.

**Estructura KV** (por clave `ALENGO-XXXX-XXXX-XXXX`):
```json
{ "clave", "empresa", "email", "plan", "fecha_creacion", "fecha_vencimiento",
  "activo", "activada", "fecha_primera_activacion", "fingerprint_pc" }
```

**Trampa crítica — template literal en `license-worker.js`**

El HTML del panel (`ADMIN_HTML`) es un template literal (backticks). Dentro de él, los escapes de JS para el bloque `<script>` embebido tienen comportamiento inesperado:

- `\'` en template literal → `'` en el HTML servido. Si ese `'` está dentro de un string de comilla simple en el `<script>`, rompe la sintaxis JS del string (string literals adyacentes sin `+`). **Solución**: usar atributos `data-*` para valores dinámicos en handlers onclick, leer con `this.dataset.key`.
- `\n` en template literal → salto de línea real. Dentro de un string de comilla simple en `<script>`, es un SyntaxError. **Solución**: reemplazar con espacio o concatenar `+ '\n' +` como string separado.

Ambos errores producen un `SyntaxError` que impide que el `<script>` entero cargue — el panel muestra el formulario de login pero el botón "Entrar" no hace nada.

Para verificar el JS del panel desplegado: `curl -s <URL>/ | sed -n '/<script>/,/<\/script>/p' | sed '1d;$d' | node --check`

## Inicializar con DB limpia

```powershell
# Detener app, borrar DB, reiniciar
Remove-Item "$env:APPDATA\alengo-asistente\database.sqlite" -Force
# La sesión WA se conserva en wa-session/
```

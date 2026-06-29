/**
 * Cloudflare Worker — Servidor de licencias Alengo v2
 *
 * KV namespace "LICENSES" bindeado como env.LICENSES
 * Secret: ADMIN_SECRET (configurar con wrangler secret put ADMIN_SECRET)
 *
 * GET  /                                             → panel admin HTML
 * GET  /validate?key=ALENGO-XXXX&fingerprint=HEX    → validar (público)
 * POST /activate     { key, fingerprint }            → activar (público)
 * POST /ai/extract-contacts { key, fingerprint, text, filename } → extraer contactos con IA (requiere ANTHROPIC_API_KEY)
 * POST /admin/create { empresa, email, plan }        → crear licencia
 * GET  /admin/list                                   → listar licencias
 * POST /admin/toggle  { key }                        → activar/desactivar
 * POST /admin/transfer { key }                       → resetear fingerprint de PC
 * POST /admin/renew   { key, meses }                 → extender vencimiento
 */

// ── Admin panel HTML ──────────────────────────────────────────────────────────
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Alengo — Admin Licencias</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="bg-gray-50 text-gray-900 min-h-screen">
<div id="page-login" class="min-h-screen flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
    <div class="text-center mb-6">
      <div class="inline-flex items-center justify-center w-14 h-14 bg-[#0F1E3C] rounded-2xl mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      </div>
      <h1 class="text-xl font-bold text-gray-900">Alengo Admin</h1>
      <p class="text-sm text-gray-400 mt-1">Panel de licencias</p>
    </div>
    <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Clave de administrador</label>
    <input id="inp-secret" type="password" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[#0F1E3C]" placeholder="••••••••••••••••" />
    <p id="login-error" style="display:none;color:#dc2626;font-size:12px;margin-bottom:8px">Clave incorrecta. Verifica y vuelve a intentarlo.</p>
    <button id="btn-login" class="w-full bg-[#0F1E3C] text-white rounded-lg py-2.5 text-sm font-semibold hover:opacity-90">Entrar</button>
  </div>
</div>
<div id="page-dashboard" style="display:none;min-height:100vh;flex-direction:column">
  <header class="bg-[#0F1E3C] text-white px-6 py-3 flex items-center justify-between flex-shrink-0">
    <div><span class="font-bold text-base">Alengo</span><span class="text-blue-300 text-xs ml-2">/ Admin Licencias</span></div>
    <button id="btn-logout" class="text-blue-300 text-xs hover:text-white">Cerrar sesión</button>
  </header>
  <div class="grid grid-cols-2 gap-4 p-5 pb-0 max-w-5xl w-full mx-auto">
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
      <div class="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0"><span id="stat-activas" class="text-xl font-bold text-green-700">—</span></div>
      <div><p class="text-xs text-gray-400">Licencias activas</p><p class="text-sm font-semibold text-gray-700">de <span id="stat-total">—</span> en total</p></div>
    </div>
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
      <div class="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0"><span id="stat-vencen" class="text-xl font-bold text-amber-700">—</span></div>
      <div><p class="text-xs text-gray-400">Vencen en 30 días</p><p class="text-sm font-semibold text-gray-700">requieren renovación</p></div>
    </div>
  </div>
  <div class="max-w-5xl w-full mx-auto px-5 py-4 flex items-center gap-3">
    <input id="inp-buscar" type="search" placeholder="Buscar empresa o clave…" class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0F1E3C]" />
    <button id="btn-refresh" class="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50">↻ Actualizar</button>
    <button id="btn-crear" class="bg-[#0F1E3C] text-white rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90">+ Nueva licencia</button>
  </div>
  <div class="max-w-5xl w-full mx-auto px-5 pb-8 flex-1">
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="border-b bg-gray-50 text-xs text-gray-500 font-semibold uppercase tracking-wide">
            <th class="text-left px-4 py-3">Clave</th><th class="text-left px-4 py-3">Empresa</th>
            <th class="text-left px-4 py-3">Plan</th><th class="text-left px-4 py-3">Creada</th>
            <th class="text-left px-4 py-3">Vence</th><th class="text-left px-4 py-3">Estado</th>
            <th class="text-left px-4 py-3">Hardware</th><th class="text-left px-4 py-3">Acciones</th>
          </tr></thead>
          <tbody id="tabla-body"><tr><td colspan="8" class="text-center py-10 text-gray-400">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>
</div>
<div id="modal-crear" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:50;padding:16px">
  <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm">
    <div class="flex items-center justify-between px-5 py-4 border-b">
      <h3 class="font-semibold">Nueva licencia</h3>
      <button onclick="closeModal('modal-crear')" class="text-gray-400 hover:text-gray-600 text-lg">✕</button>
    </div>
    <form id="form-crear" class="p-5 space-y-4">
      <div><label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Empresa *</label><input id="crear-empresa" type="text" required class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0F1E3C]" placeholder="Transportes Ejemplo S.A." /></div>
      <div><label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Email <span class="text-gray-400 normal-case font-normal">(opcional)</span></label><input id="crear-email" type="email" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0F1E3C]" placeholder="contacto@empresa.com" /></div>
      <div><label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Plan</label><select id="crear-plan" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0F1E3C]"><option value="1y">1 año (12 meses)</option><option value="6m">6 meses</option></select></div>
      <div class="flex gap-3 pt-1">
        <button type="button" onclick="closeModal('modal-crear')" class="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
        <button type="submit" class="flex-1 bg-[#0F1E3C] text-white rounded-lg py-2 text-sm font-semibold">Generar clave</button>
      </div>
    </form>
  </div>
</div>
<div id="modal-renovar" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:50;padding:16px">
  <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm">
    <div class="flex items-center justify-between px-5 py-4 border-b">
      <h3 class="font-semibold">Renovar licencia</h3>
      <button onclick="closeModal('modal-renovar')" class="text-gray-400 hover:text-gray-600 text-lg">✕</button>
    </div>
    <div class="p-5 space-y-4">
      <div class="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
        <p class="text-gray-500">Empresa: <strong class="text-gray-900" id="renovar-empresa">—</strong></p>
        <p class="text-gray-500">Vencimiento actual: <span id="renovar-vence" class="font-mono">—</span></p>
      </div>
      <div><label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Extender por</label><select id="renovar-meses" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#0F1E3C]"><option value="6">6 meses</option><option value="12" selected>12 meses (1 año)</option></select></div>
      <div class="flex gap-3 pt-1">
        <button type="button" onclick="closeModal('modal-renovar')" class="flex-1 border border-gray-200 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
        <button id="btn-confirmar-renovar" class="flex-1 bg-[#0F1E3C] text-white rounded-lg py-2 text-sm font-semibold">Confirmar renovación</button>
      </div>
    </div>
  </div>
</div>
<div id="modal-clave" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);align-items:center;justify-content:center;z-index:50;padding:16px">
  <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm">
    <div class="p-5 text-center space-y-4">
      <div class="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" stroke="#16a34a" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <h3 class="font-semibold text-gray-900 text-lg">Licencia creada</h3>
      <div>
        <p class="text-xs text-gray-500 mb-2">Clave de licencia (comparte esto con el cliente):</p>
        <div class="flex items-center gap-2 bg-gray-50 rounded-lg p-3 border">
          <code id="clave-generada" class="flex-1 font-mono text-sm text-gray-900 tracking-widest text-center select-all"></code>
          <button onclick="copiarClave()" class="flex-shrink-0 px-2 py-1 text-xs bg-[#0F1E3C] text-white rounded hover:opacity-90">Copiar</button>
        </div>
      </div>
      <p id="clave-vence" class="text-xs text-gray-400"></p>
      <button onclick="closeModal('modal-clave')" class="w-full bg-[#0F1E3C] text-white rounded-lg py-2.5 text-sm font-semibold hover:opacity-90">Listo</button>
    </div>
  </div>
</div>
<div id="toast" style="display:none;position:fixed;top:16px;right:16px;z-index:100;padding:12px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.2);font-size:14px;font-weight:500;color:white;max-width:320px"></div>
<script>
var API = '';
var TOKEN = localStorage.getItem('alengo_admin_token') || '';
var allLicenses = [];
var renewKey = null;
var toastTimer = null;

function todayStr() { return new Date().toISOString().split('T')[0]; }

function addDays(d, n) {
  var dt = new Date(d); dt.setDate(dt.getDate() + n);
  return dt.toISOString().split('T')[0];
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showError(msg) {
  var el = document.getElementById('login-error');
  el.textContent = msg || 'Clave incorrecta. Verifica y vuelve a intentarlo.';
  el.style.display = 'block';
}

function hideError() {
  var el = document.getElementById('login-error');
  el.style.display = 'none';
}

function showToast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = (type === 'error') ? '#dc2626' : '#16a34a';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.style.display = 'none'; }, 4000);
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function estadoBadge(l) {
  var t = todayStr();
  if (!l.activo)             return '<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">Revocada</span>';
  if (l.fecha_vencimiento < t) return '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">Vencida</span>';
  if (!l.activada)           return '<span style="background:#fef9c3;color:#92400e;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">Sin activar</span>';
  return '<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600">Activa</span>';
}

function planLabel(plan) {
  return plan === '6m' ? '6 meses' : '1 año';
}

function renderTable(lics) {
  var q = (document.getElementById('inp-buscar').value || '').toLowerCase().trim();
  var filtered = q ? lics.filter(function(l) {
    return (l.empresa||'').toLowerCase().indexOf(q) >= 0 || (l.clave||'').toLowerCase().indexOf(q) >= 0;
  }) : lics;

  if (!filtered.length) {
    document.getElementById('tabla-body').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Sin resultados</td></tr>';
    return;
  }

  var t = todayStr();
  var rows = '';
  for (var i = 0; i < filtered.length; i++) {
    var l = filtered[i];
    var k = esc(l.clave || '');
    var e = esc(l.empresa || '—');
    var vp = l.activo && l.fecha_vencimiento >= t && l.fecha_vencimiento <= addDays(t, 30);
    var venceColor = l.fecha_vencimiento < t ? 'color:#dc2626;font-weight:700' : vp ? 'color:#d97706;font-weight:700' : 'color:#6b7280';
    var toggleLabel = l.activo ? 'Revocar' : 'Activar';
    var toggleStyle = l.activo ? 'background:#fee2e2;color:#b91c1c' : 'background:#dcfce7;color:#15803d';
    var pcShort = l.fingerprint_pc ? l.fingerprint_pc.slice(0, 8) + '…' : '—';
    var vence = esc(l.fecha_vencimiento||'');
    var transferBtn = l.fingerprint_pc
      ? '<button data-key="' + k + '" onclick="transferirLic(this.dataset.key)" style="padding:2px 8px;font-size:11px;background:#f3f4f6;color:#374151;border:none;border-radius:4px;cursor:pointer;margin-left:4px">Transf. PC</button>'
      : '';

    rows += '<tr style="border-bottom:1px solid #f3f4f6">'
      + '<td style="padding:10px 16px;font-family:monospace;font-size:12px;color:#4b5563">' + k + '</td>'
      + '<td style="padding:10px 16px;font-weight:600">' + e + '</td>'
      + '<td style="padding:10px 16px;font-size:12px">' + planLabel(l.plan) + '</td>'
      + '<td style="padding:10px 16px;font-size:12px;color:#9ca3af">' + (l.fecha_creacion || '—') + '</td>'
      + '<td style="padding:10px 16px;font-size:12px;' + venceColor + '">' + (l.fecha_vencimiento || '—') + '</td>'
      + '<td style="padding:10px 16px">' + estadoBadge(l) + '</td>'
      + '<td style="padding:10px 16px;font-family:monospace;font-size:12px;color:#9ca3af">' + pcShort + '</td>'
      + '<td style="padding:10px 16px">'
        + '<button data-key="' + k + '" data-empresa="' + e + '" data-vence="' + vence + '" onclick="openRenovar(this.dataset.key,this.dataset.empresa,this.dataset.vence)" style="padding:2px 8px;font-size:11px;background:#dbeafe;color:#1d4ed8;border:none;border-radius:4px;cursor:pointer">Renovar</button>'
        + '<button data-key="' + k + '" onclick="toggleLic(this.dataset.key)" style="padding:2px 8px;font-size:11px;' + toggleStyle + ';border:none;border-radius:4px;cursor:pointer;margin-left:4px">' + toggleLabel + '</button>'
        + transferBtn
      + '</td>'
      + '</tr>';
  }
  document.getElementById('tabla-body').innerHTML = rows;
}

function renderStats(lics) {
  var t = todayStr();
  var d30 = addDays(t, 30);
  var activas = lics.filter(function(l) { return l.activo && l.fecha_vencimiento >= t; }).length;
  var vencen  = lics.filter(function(l) { return l.activo && l.fecha_vencimiento >= t && l.fecha_vencimiento <= d30; }).length;
  document.getElementById('stat-total').textContent   = lics.length;
  document.getElementById('stat-activas').textContent = activas;
  document.getElementById('stat-vencen').textContent  = vencen;
}

function apiReq(path, opts, onOk, onErr) {
  var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN };
  fetch(API + path, Object.assign({}, opts, { headers: headers }))
    .then(function(res) {
      if (res.status === 401) { showError('Clave incorrecta (401).'); TOKEN = ''; throw new Error('401'); }
      return res.json();
    })
    .then(onOk)
    .catch(function(err) { if (onErr) onErr(err); });
}

function loadLicenses(onDone, onErr) {
  document.getElementById('tabla-body').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#9ca3af">Cargando…</td></tr>';
  apiReq('/admin/list', {}, function(data) {
    allLicenses = data.licenses || [];
    renderTable(allLicenses);
    renderStats(allLicenses);
    if (onDone) onDone();
  }, function(err) {
    if (onErr) onErr(err);
  });
}

function showLogin() {
  localStorage.removeItem('alengo_admin_token');
  TOKEN = '';
  document.getElementById('page-login').style.display = 'flex';
  document.getElementById('page-dashboard').style.display = 'none';
}

function showDashboard() {
  document.getElementById('page-login').style.display = 'none';
  document.getElementById('page-dashboard').style.display = 'flex';
}

document.getElementById('btn-login').addEventListener('click', function() {
  var s = document.getElementById('inp-secret').value.trim();
  if (!s) return;
  TOKEN = s;
  hideError();
  var btn = document.getElementById('btn-login');
  btn.textContent = 'Verificando…';
  btn.disabled = true;
  loadLicenses(
    function() {
      localStorage.setItem('alengo_admin_token', TOKEN);
      btn.textContent = 'Entrar';
      btn.disabled = false;
      showDashboard();
    },
    function() {
      btn.textContent = 'Entrar';
      btn.disabled = false;
      TOKEN = '';
      showError('Clave incorrecta. Verifica y vuelve a intentarlo.');
    }
  );
});

document.getElementById('inp-secret').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});

document.getElementById('btn-logout').addEventListener('click', function() {
  showLogin();
  hideError();
  document.getElementById('inp-secret').value = '';
});

document.getElementById('inp-buscar').addEventListener('input', function() { renderTable(allLicenses); });
document.getElementById('btn-refresh').addEventListener('click', function() { loadLicenses(); });

document.getElementById('btn-crear').addEventListener('click', function() {
  document.getElementById('crear-empresa').value = '';
  document.getElementById('crear-email').value   = '';
  document.getElementById('crear-plan').value    = '1y';
  document.getElementById('modal-crear').style.display = 'flex';
  setTimeout(function() { document.getElementById('crear-empresa').focus(); }, 50);
});

document.getElementById('form-crear').addEventListener('submit', function(e) {
  e.preventDefault();
  var empresa = document.getElementById('crear-empresa').value.trim();
  var email   = document.getElementById('crear-email').value.trim();
  var plan    = document.getElementById('crear-plan').value;
  var btn = e.target.querySelector('button[type=submit]');
  btn.textContent = 'Generando…'; btn.disabled = true;
  apiReq('/admin/create', { method: 'POST', body: JSON.stringify({ empresa: empresa, email: email || null, plan: plan }) },
    function(data) {
      btn.textContent = 'Generar clave'; btn.disabled = false;
      if (!data.success) { showToast('Error: ' + data.error, 'error'); return; }
      closeModal('modal-crear');
      document.getElementById('clave-generada').textContent = data.clave;
      document.getElementById('clave-vence').textContent = 'Plan ' + (plan === '6m' ? '6 meses' : '1 año') + ' — vence ' + data.fecha_vencimiento;
      document.getElementById('modal-clave').style.display = 'flex';
      if (navigator.clipboard) navigator.clipboard.writeText(data.clave).catch(function(){});
      loadLicenses();
    },
    function() { btn.textContent = 'Generar clave'; btn.disabled = false; }
  );
});

function copiarClave() {
  var c = document.getElementById('clave-generada').textContent;
  if (navigator.clipboard) navigator.clipboard.writeText(c).then(function() { showToast('Clave copiada al portapapeles'); });
}

function toggleLic(key) {
  var lic = allLicenses.filter(function(l) { return l.clave === key; })[0];
  var accion = lic && lic.activo ? 'revocar' : 'activar';
  if (!confirm('¿' + accion.charAt(0).toUpperCase() + accion.slice(1) + ' la licencia de "' + (lic ? lic.empresa : key) + '"?')) return;
  apiReq('/admin/toggle', { method: 'POST', body: JSON.stringify({ key: key }) }, function(data) {
    if (data.success) { showToast('Licencia ' + (data.activo ? 'activada' : 'revocada')); loadLicenses(); }
    else showToast(data.error || 'Error', 'error');
  });
}

function openRenovar(key, empresa, vence) {
  renewKey = key;
  document.getElementById('renovar-empresa').textContent = empresa;
  document.getElementById('renovar-vence').textContent   = vence || '—';
  document.getElementById('renovar-meses').value         = '12';
  document.getElementById('modal-renovar').style.display = 'flex';
}

document.getElementById('btn-confirmar-renovar').addEventListener('click', function() {
  if (!renewKey) return;
  var meses = parseInt(document.getElementById('renovar-meses').value, 10);
  var btn = document.getElementById('btn-confirmar-renovar');
  btn.textContent = 'Renovando…'; btn.disabled = true;
  apiReq('/admin/renew', { method: 'POST', body: JSON.stringify({ key: renewKey, meses: meses }) }, function(data) {
    btn.textContent = 'Confirmar renovación'; btn.disabled = false;
    if (data.success) { closeModal('modal-renovar'); showToast('Renovada hasta ' + data.fecha_vencimiento); loadLicenses(); }
    else showToast(data.error || 'Error al renovar', 'error');
  }, function() { btn.textContent = 'Confirmar renovación'; btn.disabled = false; });
});

function transferirLic(key) {
  var lic = allLicenses.filter(function(l) { return l.clave === key; })[0];
  if (!confirm('¿Resetear la huella de PC de "' + (lic ? lic.empresa : key) + '"? La licencia podrá activarse en un equipo diferente.')) return;
  apiReq('/admin/transfer', { method: 'POST', body: JSON.stringify({ key: key }) }, function(data) {
    if (data.success) { showToast('Huella de PC reseteada'); loadLicenses(); }
    else showToast(data.error || 'Error', 'error');
  });
}

// Init
document.getElementById('page-login').style.display = TOKEN ? 'none' : 'flex';
document.getElementById('page-dashboard').style.display = 'none';
if (TOKEN) {
  loadLicenses(showDashboard, function() {
    showError('La sesión expiró. Vuelve a ingresar la clave.');
    document.getElementById('page-login').style.display = 'flex';
  });
}
<\/script>
</body>
</html>`

export default {
  async fetch(request, env) {
    const url  = new URL(request.url)
    const cors = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    // ── GET / → Panel de administración ───────────────────────────────────────
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(ADMIN_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', ...cors },
      })

    // ── GET /validate ──────────────────────────────────────────────────────────
    if (url.pathname === '/validate' && request.method === 'GET') {
      const key         = url.searchParams.get('key')?.trim().toUpperCase()
      const fingerprint = url.searchParams.get('fingerprint')?.trim()

      if (!key) return json({ valid: false, error: 'Clave requerida' }, 400)

      const lic = await env.LICENSES.get(key, { type: 'json' })
      if (!lic || !lic.activo)
        return json({ valid: false, error: 'Licencia no encontrada o desactivada' })

      if (lic.fecha_vencimiento < today())
        return json({ valid: false, error: 'Licencia vencida' })

      // Validar fingerprint si ya estaba registrado
      if (fingerprint && lic.fingerprint_pc && lic.fingerprint_pc !== fingerprint)
        return json({ valid: false, error: 'pc_mismatch', empresa: lic.empresa })

      return json({
        valid: true,
        empresa: lic.empresa,
        email: lic.email,
        plan: lic.plan ?? '1y',
        fecha_vencimiento: lic.fecha_vencimiento,
      })
    }

    // ── POST /activate ─────────────────────────────────────────────────────────
    if (url.pathname === '/activate' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ success: false, error: 'JSON inválido' }, 400) }

      const key         = body.key?.trim().toUpperCase()
      const fingerprint = body.fingerprint?.trim()

      if (!key) return json({ success: false, error: 'Clave requerida' }, 400)
      if (!isValidFormat(key)) return json({ success: false, error: 'Formato de clave inválido. Debe ser ALENGO-XXXX-XXXX-XXXX' }, 400)

      const lic = await env.LICENSES.get(key, { type: 'json' })
      if (!lic || !lic.activo)
        return json({ success: false, error: 'Clave inválida o licencia desactivada' })

      if (lic.fecha_vencimiento < today())
        return json({ success: false, error: 'Esta licencia ha vencido. Contáctanos para renovar.' })

      // Si ya fue activada en OTRO PC → error
      if (lic.activada && fingerprint && lic.fingerprint_pc && lic.fingerprint_pc !== fingerprint) {
        return json({
          success: false,
          error: 'Esta licencia ya está activada en otro equipo. Contacta a Alengo para transferirla.',
          error_code: 'pc_mismatch',
        })
      }

      // Primera activación o misma PC
      if (!lic.activada) {
        lic.activada = true
        lic.fecha_primera_activacion = today()
      }
      if (fingerprint && !lic.fingerprint_pc) {
        lic.fingerprint_pc = fingerprint
      }
      await env.LICENSES.put(key, JSON.stringify(lic))

      return json({
        success: true,
        empresa: lic.empresa,
        email: lic.email,
        plan: lic.plan ?? '1y',
        fecha_vencimiento: lic.fecha_vencimiento,
      })
    }

    // ── POST /ai/extract-contacts — extrae contactos de un documento con IA ─────
    // Requiere ANTHROPIC_API_KEY como wrangler secret.
    if (url.pathname === '/ai/extract-contacts' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ success: false, error: 'JSON inválido' }, 400) }

      const { key, fingerprint, text, filename } = body
      if (!key || !text) return json({ success: false, error: 'Faltan parámetros: key, text' }, 400)

      const licKey = String(key).trim().toUpperCase()
      const lic = await env.LICENSES.get(licKey, { type: 'json' })
      if (!lic || !lic.activo)
        return json({ success: false, error: 'Licencia inválida o desactivada', error_code: 'invalid_license' }, 401)
      if (lic.fecha_vencimiento < today())
        return json({ success: false, error: 'La licencia ha vencido', error_code: 'expired' }, 401)
      if (fingerprint && lic.fingerprint_pc && lic.fingerprint_pc !== String(fingerprint))
        return json({ success: false, error: 'Licencia activada en otro equipo', error_code: 'pc_mismatch' }, 401)

      const MONTHLY_LIMIT = 50
      const monthKey = `usage:${licKey}:${today().slice(0, 7)}`
      const usageRaw = await env.LICENSES.get(monthKey)
      const usage = usageRaw ? parseInt(usageRaw, 10) : 0
      if (usage >= MONTHLY_LIMIT) {
        return json({
          success: false,
          error_code: 'rate_limited',
          error: `Límite mensual de ${MONTHLY_LIMIT} extracciones de documentos alcanzado. Se reinicia el 1ro del próximo mes.`,
        }, 429)
      }

      if (!env.ANTHROPIC_API_KEY) {
        return json({ success: false, error: 'Servicio de IA no configurado en el servidor' }, 503)
      }

      const truncatedText = String(text).slice(0, 8000)
      const safeFilename = String(filename || 'documento').replace(/"/g, '')
      const prompt = `Extrae TODOS los contactos (nombre y número de teléfono) del siguiente texto.\nDevuelve ÚNICAMENTE un JSON array con objetos {"nombre": string, "telefono": string}.\nReglas:\n- "telefono" debe contener solo dígitos (sin +, espacios ni guiones).\n- Si hay duplicados de teléfono, incluye solo el primero.\n- Si el texto no contiene contactos, devuelve [].\n- No incluyas texto ni explicaciones fuera del JSON array.\n\nTexto del archivo "${safeFilename}":\n${truncatedText}`

      try {
        const anthropicAuthHeader = String(env.ANTHROPIC_API_KEY).startsWith('sk-ant-oat')
          ? { 'Authorization': `Bearer ${env.ANTHROPIC_API_KEY}` }
          : { 'x-api-key': env.ANTHROPIC_API_KEY }
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...anthropicAuthHeader,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!aiRes.ok) {
          return json({ success: false, error: 'Error en el servicio de IA. Intenta de nuevo.' }, 500)
        }

        const aiData = await aiRes.json()
        const rawContent = aiData.content?.[0]?.text || '[]'

        let contacts = []
        try {
          contacts = JSON.parse(rawContent.trim())
        } catch {
          try {
            const match = rawContent.match(/\[[\s\S]*\]/)
            if (match) contacts = JSON.parse(match[0])
          } catch {
            contacts = []
          }
        }

        // Incrementar contador de uso mensual (expira en 35 días para limpieza automática)
        await env.LICENSES.put(monthKey, String(usage + 1), { expirationTtl: 60 * 60 * 24 * 35 })

        return json({ success: true, contacts, usage: usage + 1, limit: MONTHLY_LIMIT })
      } catch {
        return json({ success: false, error: 'Error interno al procesar el documento.' }, 500)
      }
    }

    // ── Rutas admin — requieren Authorization ──────────────────────────────────
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`)
      return json({ error: 'No autorizado' }, 401)

    // ── POST /admin/create ─────────────────────────────────────────────────────
    if (url.pathname === '/admin/create' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ success: false, error: 'JSON inválido' }, 400) }

      const { empresa, email = null, plan = '1y', meses } = body
      if (!empresa) return json({ success: false, error: 'Nombre de empresa requerido' }, 400)

      const mesesFinal = meses
        ? Number(meses)
        : plan === '6m' ? 6 : 12

      const key        = generateKey()
      const hoy        = today()
      const vencimiento = addMonths(hoy, mesesFinal)

      await env.LICENSES.put(key, JSON.stringify({
        clave: key, empresa, email,
        plan: plan || (mesesFinal <= 6 ? '6m' : '1y'),
        fecha_creacion: hoy,
        fecha_vencimiento: vencimiento,
        activo: true,
        activada: false,
        fecha_primera_activacion: null,
        fingerprint_pc: null,
      }))

      return json({ success: true, clave: key, fecha_vencimiento: vencimiento, empresa, plan })
    }

    // ── GET /admin/list ────────────────────────────────────────────────────────
    if (url.pathname === '/admin/list' && request.method === 'GET') {
      const list   = await env.LICENSES.list()
      const lics   = await Promise.all(list.keys.map(({ name }) => env.LICENSES.get(name, { type: 'json' })))
      const sorted = lics.filter(Boolean).sort((a, b) => (b.fecha_creacion ?? '').localeCompare(a.fecha_creacion ?? ''))
      return json({ licenses: sorted, total: sorted.length })
    }

    // ── POST /admin/toggle ─────────────────────────────────────────────────────
    if (url.pathname === '/admin/toggle' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ success: false, error: 'JSON inválido' }, 400) }
      const key = body.key?.trim().toUpperCase()
      if (!key) return json({ success: false, error: 'Clave requerida' }, 400)
      const lic = await env.LICENSES.get(key, { type: 'json' })
      if (!lic) return json({ success: false, error: 'Licencia no encontrada' })
      lic.activo = !lic.activo
      await env.LICENSES.put(key, JSON.stringify(lic))
      return json({ success: true, activo: lic.activo })
    }

    // ── POST /admin/transfer — resetear fingerprint (cambio de PC) ─────────────
    if (url.pathname === '/admin/transfer' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ success: false, error: 'JSON inválido' }, 400) }
      const key = body.key?.trim().toUpperCase()
      if (!key) return json({ success: false, error: 'Clave requerida' }, 400)
      const lic = await env.LICENSES.get(key, { type: 'json' })
      if (!lic) return json({ success: false, error: 'Licencia no encontrada' })
      lic.fingerprint_pc = null
      lic.activada = false
      await env.LICENSES.put(key, JSON.stringify(lic))
      return json({ success: true, mensaje: 'Fingerprint de PC reseteado. La licencia puede activarse en otro equipo.' })
    }

    // ── POST /admin/renew — extender vencimiento ───────────────────────────────
    if (url.pathname === '/admin/renew' && request.method === 'POST') {
      let body
      try { body = await request.json() } catch { return json({ success: false, error: 'JSON inválido' }, 400) }
      const key   = body.key?.trim().toUpperCase()
      const meses = Number(body.meses ?? 12)
      if (!key) return json({ success: false, error: 'Clave requerida' }, 400)
      if (!meses || meses < 1) return json({ success: false, error: 'Meses inválidos' }, 400)
      const lic = await env.LICENSES.get(key, { type: 'json' })
      if (!lic) return json({ success: false, error: 'Licencia no encontrada' })

      // Extender desde hoy si ya venció, o desde la fecha de vencimiento actual
      const base = lic.fecha_vencimiento < today() ? today() : lic.fecha_vencimiento
      lic.fecha_vencimiento = addMonths(base, meses)
      lic.activo = true
      await env.LICENSES.put(key, JSON.stringify(lic))
      return json({ success: true, fecha_vencimiento: lic.fecha_vencimiento, empresa: lic.empresa })
    }

    return json({ error: 'Ruta no encontrada' }, 404)
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sin I, O, 0, 1

function generateKey() {
  let key = 'ALENGO'
  for (let g = 0; g < 3; g++) {
    key += '-'
    for (let i = 0; i < 4; i++) {
      const arr = new Uint8Array(1)
      crypto.getRandomValues(arr)
      key += CHARSET[arr[0] % CHARSET.length]
    }
  }
  return key
}

function isValidFormat(key) {
  return /^ALENGO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}

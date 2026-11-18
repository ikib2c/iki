// ============================================================
// DropAnalytics Overlay - content script (mundo aislado)
// 1. Escucha los productos que la app recibe (via main-world.js)
// 2. Observa el DOM del catalogo con MutationObserver
// 3. Para cada tarjeta de producto: busca el nombre en el mapa vivo
//    y consulta el servidor local (localhost:3777) por el delta
// 4. Inyecta el badge con ventas/dia, tier, margen y tendencia
// ============================================================
let LIVE = new Map();            // normName -> {id, name, supplier(norm), prices}
let CACHE = new Map();           // normName -> respuesta del servidor (o null)
let pendientes = new Set();      // nombres en consulta
const SERVER = 'http://localhost:3777';
let habilitado = true;

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// ---------- 1. recibir productos del mundo MAIN ----------
window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || !d.__dpanalytics || d.type !== 'products') return;
  try {
    console.log('[DP CONTENT] mensaje recibido len=' + (d.text || '').length);
    const j = JSON.parse(d.text);
    const n = (j.objects || []).length;
    for (const o of (j.objects || [])) {
      if (o && o.name) LIVE.set(norm(o.name), o);
    }
    console.log('[DP CONTENT] mapa vivo ahora: ' + LIVE.size + ' (llegaron ' + n + ')');
    scheduleScan(200);
  } catch (e) { console.log('[DP CONTENT] parse err: ' + e.message); }
});

// ---------- 2. observer del DOM ----------
let scanTimer = null;
function scheduleScan(delay) {
  if (scanTimer) return;
  scanTimer = setTimeout(() => { scanTimer = null; scanCards(); }, delay || 400);
}

const NOISE = new Set(['STOCK', 'CANTIDAD', 'ENVIAR A CLIENTE', 'PRECIO PROVEEDOR:', 'PRECIO SUGERIDO', 'PROVIDER:', 'VER TODOS', 'NUEVO']);

function findCards() {
  // tarjetas = elementos con texto 'Precio proveedor' que no contengan otra tarjeta igual dentro
  const all = [...document.querySelectorAll('div, app-product, [class*=card]')].filter(el =>
    el.offsetParent !== null &&
    /precio proveedor/i.test(el.innerText || '') &&
    /provider:/i.test(el.innerText || '')
  );
  return all.filter(el => !all.some(o => o !== el && el.contains(o)));
}

function findBadgeHost(card) {
  // el host donde inyectamos: el ancestro mas externo del grupo (la tarjeta visual)
  let el = card;
  const startText = norm(card.innerText).length;
  let parent = card.parentElement;
  while (parent && parent !== document.body) {
    const t = norm(parent.innerText);
    if (/precio proveedor/i.test(t) && t.length < startText + 220) { el = parent; parent = parent.parentElement; } else break;
  }
  return el;
}

function nameFromCard(card) {
  // el nombre = la linea mas larga ANTES de 'Provider:' que no sea ruido/categoria/precio
  const lines = (card.innerText || '').split('\n').map(l => norm(l)).filter(Boolean);
  let sawProvider = false, name = '';
  for (const l of lines) {
    if (/^PROVIDER:?/.test(l)) { sawProvider = true; continue; }
    if (sawProvider) break;
    if (NOISE.has(l)) continue;
    if (/^\$|^\d+$/.test(l)) continue;
    if (/^(ROPA DEPORTIVA|BISUTERIA|VAPORIZADORES|MASCOTAS|MODA|TECNOLOGIA|COCINA|BELLEZA|SALUD|HOGAR|NATURAL HOME|DEPORTES|MAD|SEX SHOP|BEBE|ASEO|BIENESTAR|CAMPING|PESCA|DEFENSA PERSONAL|OTRO|VEHICULOS|JUGUETERIA|PINATERIA|HERRAMIENTAS|NAVIDAD|HALLOWEEN|LIBROS|PAPELERIA|CYBER DAYS)$/.test(l)) continue;
    if (LIVE.has(l)) { name = l; break; }        // coincidencia exacta con el mapa vivo
    if (!name && l.length > 2) name = l;          // candidato por defecto
  }
  return name;
}

// ---------- 3. consultas al servidor (via background service worker: sin CORS) ----------
async function queryServer(name, proveedor) {
  const key = norm(name);
  if (CACHE.has(key)) return CACHE.get(key);
  if (pendientes.has(key)) return null;
  pendientes.add(key);
  try {
    const url = SERVER + '/api/producto?nombre=' + encodeURIComponent(key) + (proveedor ? '&proveedor=' + encodeURIComponent(proveedor) : '');
    const resp = await new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'fetch', url }, r => {
          if (chrome.runtime.lastError) resolve({ ok: false });
          else resolve(r || { ok: false });
        });
      } catch (e) { resolve({ ok: false }); }
    });
    const j = (resp && resp.ok) ? resp.data : null;
    const val = (j && j.encontrado) ? j : null;
    CACHE.set(key, val);
    return val;
  } catch (e) { CACHE.set(key, null); return null; }
  finally { pendientes.delete(key); }
}

// ---------- 4. inyeccion del badge ----------
const TIERC = { S: '#3fb950', A: '#58a6ff', B: '#d29922', C: '#8b949e', D: '#f85149' };

function injectBadge(host, data) {
  if (!data || !data.encontrado) return;
  if (!data.vendidas_total || data.vendidas_total <= 0) return;   // sin ventas medidas = sin badge (menos ruido)
  if (host.querySelector('.dp-badge')) return;
  const b = document.createElement('div');
  b.className = 'dp-badge';
  const tc = TIERC[data.tier] || '#8b949e';
  const tend = data.tendencia || '';
  const margen = data.margen_pct !== null && data.margen_pct !== undefined ? data.margen_pct + '%' : '?';
  b.style.cssText = 'position:relative;z-index:50;display:inline-flex;gap:6px;align-items:center;margin:4px 0;padding:3px 8px;border-radius:6px;background:#0d1117;color:#e6edf3;font-family:Segoe UI,sans-serif;font-size:11px;border:1px solid #30363d;box-shadow:0 1px 4px rgba(0,0,0,.35)';
  b.innerHTML =
    `<span title="tier" style="background:${tc};color:#0d1117;font-weight:800;border-radius:4px;padding:0 6px">${data.tier}</span>` +
    `<span title="ventas por dia (delta de stock)" style="color:#3fb950;font-weight:700">${data.vendidas_ultimo}/d&iacute;a</span>` +
    (tend ? `<span style="color:#58a6ff;font-weight:700">${tend}</span>` : '') +
    `<span title="margen sugerido" style="color:#8b949e">${margen}</span>` +
    (data.vendidas_total ? `<span title="total medido" style="color:#8b949e">&Sigma;${data.vendidas_total}</span>` : '');
  host.insertBefore(b, host.firstChild);
}

async function scanCards() {
  console.log('[DP v1.0.2 SCAN] inicio');
  try {
    if (!habilitado) return;
    const cards = findCards();
    console.log('[DP v1.0.2 SCAN] tarjetas: ' + cards.length);
    if (!cards.length) return;
    const jobs = [];
    for (const card of cards) {
      const host = findBadgeHost(card);
      if (host.querySelector('.dp-badge') || host.dataset.dpdone === '1') continue;
      host.dataset.dpdone = '1';
      const name = nameFromCard(card);
      const mProv = (card.innerText || '').match(/Provider:\s*([^\n]+)/i);
      const proveedor = mProv ? norm(mProv[1]) : '';
      console.log('[DP SCAN] tarjeta nombre="' + String(name).substring(0, 40) + '" proveedor="' + String(proveedor).substring(0, 30) + '"');
      if (!name) continue;
      jobs.push((async () => {
        let data = await queryServer(name, proveedor);
        if (!data || !data.encontrado) {
          const lines = (card.innerText || '').split('\n').map(l => norm(l)).filter(l => l.length > 3 && !NOISE.has(l) && !/^\$|^\d+$/.test(l)).slice(0, 4);
          for (const l of lines) {
            if (l === norm(name)) continue;
            data = await queryServer(l, proveedor);
            if (data && data.encontrado) break;
          }
        }
        console.log('[DP SCAN] respuesta "' + String(name).substring(0, 30) + '": ' + (data ? (data.encontrado ? 'ENCONTRADO tier ' + data.tier + ' ' + data.vendidas_ultimo + '/dia' : 'no en indice') : 'sin respuesta'));
        if (data && data.encontrado) injectBadge(host, data);
      })());
    }
    await Promise.all(jobs);
  } catch (e) { console.log('[DP v1.0.2 SCAN] ERROR: ' + e.message); }
}

// ---------- 5. popup: toggle ----------
try {
  chrome.storage.local.get(['dpOn'], v => { habilitado = v.dpOn !== false; });
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && 'dpOn' in ch) { habilitado = ch.dpOn.newValue !== false; if (habilitado) scheduleScan(100); } });
} catch (e) {}

// ---------- 6. stats para el popup ----------
let badgesInyectados = 0;
const origInject = injectBadge;
injectBadge = function (host, data) { if (data && data.encontrado) badgesInyectados++; return origInject(host, data); };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'stats') sendResponse({ live: LIVE.size, badges: badgesInyectados });
  return true;
});

// ---------- arranque ----------
scheduleScan(500);
const mo = new MutationObserver(() => scheduleScan(300));
mo.observe(document.body, { subtree: true, childList: true });
console.log('[DP v1.0.2 Overlay activo]');

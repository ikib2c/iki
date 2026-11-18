// ============================================================
// DropAnalytics - Servidor local de deltas para la extension Chrome
// Sirve los datos de ventas (delta de stock) en http://localhost:3777
// Uso: node scripts/servidor-delta.js   (dejar corriendo mientras navegas Dropi)
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3777;

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// ---------- cargar todos los snapshots y construir series por producto ----------
function loadSeries() {
  const series = new Map(); // id -> {name, supplier, supplier_id, sale_price, suggested_price, days: Map(fecha->stock)}
  const roots = [
    path.join(ROOT, 'data', 'suppliers'),
    path.join(ROOT, 'data', 'categories')
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root)) {
      const dir = path.join(root, d);
      if (!fs.statSync(dir).isDirectory()) continue;
      const files = fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}(-\d{2,4})?\.json$/.test(f)).sort();
      for (const f of files) {
        const date = f.replace('.json', '');
        let prods = [];
        try { prods = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { continue; }
        for (const p of prods) {
          if (!series.has(String(p.id))) {
            series.set(String(p.id), {
              id: p.id, name: p.name, supplier: p.supplier || null, supplier_id: p.supplier_id || null,
              sale_price: p.sale_price, suggested_price: p.suggested_price,
              imagenes: p.imagenes || [],
              days: new Map()
            });
          }
          const s = series.get(String(p.id));
          if (!s.days.has(date)) s.days.set(date, [int(p.stock), int(p.sale_price), int(p.suggested_price)]);
        }
      }
    }
  }
  return series;
}
const int = v => (v === null || v === undefined) ? 0 : (parseInt(v) || 0);

// ---------- calcular ventas (deltas) por producto ----------
function buildIndex() {
  const series = loadSeries();
  const byName = new Map();      // normName -> entry (primero gana; los duplicados comparten nombre raro)
  const byNameSup = new Map();   // normName + '|' + normSupplier -> entry (match preciso)
  const stats = { productos: series.size, conVentas: 0, unidadesTotal: 0, fechas: new Set() };

  for (const [, s] of series) {
    const dates = [...s.days.keys()].sort();
    for (const d of dates) stats.fechas.add(d);
    // deltas entre fechas consecutivas (por bodega ya sumadas al guardar)
    let ventasTotal = 0, ventasUltimo = 0, lastDate = null;
    const deltas = [];
    for (let i = 1; i < dates.length; i++) {
      const a = s.days.get(dates[i - 1]), b = s.days.get(dates[i]);
      const dv = a[0] - b[0];
      if (dv > 0) { deltas.push({ date: dates[i], v: dv }); ventasTotal += dv; lastDate = dates[i]; ventasUltimo = dv; }
    }
    stats.unidadesTotal += ventasTotal;
    if (ventasTotal > 0) stats.conVentas++;
    // serie compacta para tendencia
    const serie = dates.map(d => ({ d, s: s.days.get(d)[0] }));
    const entry = {
      id: s.id, name: s.name, supplier: s.supplier, supplier_id: s.supplier_id,
      sale_price: s.sale_price, suggested_price: s.suggested_price,
      imagenes: s.imagenes || [],
      stock: serie.length ? serie[serie.length - 1].s : 0,
      vendidas_total: ventasTotal,
      vendidas_ultimo: ventasUltimo,
      ultimo_delta_date: lastDate,
      margen_pct: (s.suggested_price && int(s.suggested_price) > 0) ? Math.round((int(s.suggested_price) - int(s.sale_price)) / int(s.suggested_price) * 100) : null,
      serie
    };
    entry.tier = tierOf(entry, deltas);
    const k = norm(s.name);
    if (k && !byName.has(k)) byName.set(k, entry);
    byNameSup.set(k + '|' + norm(s.supplier), entry);
  }
  // tiers necesitan percentiles: segunda pasada
  const all = [...byName.values()];
  const vels = all.map(e => e.vendidas_ultimo).sort((a, b) => a - b);
  const pct = p => { const i = Math.ceil(p * vels.length) - 1; return vels[Math.min(Math.max(i, 0), vels.length - 1)] || 0; };
  const p85 = pct(0.85), p60 = pct(0.60);
  for (const e of all) {
    if (e.vendidas_ultimo > 0) {
      if (e.vendidas_ultimo >= p85 && (e.margen_pct === null || e.margen_pct >= 40)) e.tier = 'S';
      else if (e.vendidas_ultimo >= p60 && (e.margen_pct === null || e.margen_pct >= 30)) e.tier = 'A';
      else e.tier = 'B';
    } else e.tier = 'C';
  }
  return { byName, byNameSup, stats };
}

function tierOf(entry, deltas) {
  // pre-tier bruto (se recalcula con percentiles en buildIndex)
  return 'C';
}

// ---------- api ----------
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');   // Chrome Private Network Access: pagina publica -> localhost
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, productos: INDEX.byName.size, proveedores: PROVEEDORES, fechas: [...INDEX.stats.fechas].sort(), unidades: INDEX.stats.unidadesTotal }));
    return;
  }
  if (u.pathname === '/api/producto') {
    const nombre = norm(u.searchParams.get('nombre'));
    const proveedor = norm(u.searchParams.get('proveedor') || '');
    let hit = null;
    if (nombre) {
      if (proveedor) hit = INDEX.byNameSup.get(nombre + '|' + proveedor) || null;
      if (!hit) hit = INDEX.byName.get(nombre) || null;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (!hit) { res.end(JSON.stringify({ encontrado: false })); return; }
    const tendencia = (() => {
      const s = hit.serie || [];
      if (s.length < 3) return '';
      const last = s[s.length - 1].s, prev = s[s.length - 2].s;
      return last < prev ? '↓' : (last > prev ? '↑' : '');
    })();
    res.end(JSON.stringify({
      encontrado: true, id: hit.id, name: hit.name, proveedor: hit.supplier,
      vendidas_total: hit.vendidas_total, vendidas_ultimo: hit.vendidas_ultimo,
      ultimo_delta_date: hit.ultimo_delta_date, tier: hit.tier, margen_pct: hit.margen_pct,
      stock: hit.stock, tendencia, costo: hit.sale_price, pvp: hit.suggested_price
    }));
    return;
  }
  res.writeHead(404); res.end();
});

// ---------- arranque con recarga cada 10 min (nuevos snapshots) ----------
let INDEX = null, PROVEEDORES = 0;
function rebuild() {
  INDEX = buildIndex();
  const supRoot = path.join(ROOT, 'data', 'suppliers');
  PROVEEDORES = fs.existsSync(supRoot) ? fs.readdirSync(supRoot).length : 0;
  console.log(`[DropAnalytics] indice listo: ${INDEX.byName.size} productos | ${INDEX.stats.conVentas} con ventas | ${INDEX.stats.unidadesTotal} unidades medidas | fechas: ${[...INDEX.stats.fechas].join(', ')}`);
}
rebuild();
setInterval(rebuild, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`[DropAnalytics] servidor de deltas en http://localhost:${PORT}  (dejar abierto mientras navegas Dropi)`));

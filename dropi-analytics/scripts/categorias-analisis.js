// DropAnalytics - Analisis por categorias de producto (keywords sobre nombre)
// Genera por cada corrida (dropi-analytics/data/analysis/categorias/):
//   {cat}-catalogo-{fecha}.csv                     catalogo monitoreado por categoria
//   resumen-{fecha}.json                           agregados
//   informe-categorias-{fecha}.html (+ copia sin fecha)   informe: IDs copiables con clic + boton Exportar PDF
//   informe-categorias-detallado-{fecha}.xlsx (+ copia)   Excel: Info + Resumen + 1 hoja por categoria + Top Ventas
//   informe-categorias-{fecha}.pdf (+ copia)       PDF del informe (solo con --pdf; requiere Playwright/Chromium)
// Uso: node scripts/categorias-analisis.js [--fecha 2026-10-20] [--pdf]
//
// Dropi NO tiene categorias finas (perfumes, calzado, relojes, pijamas...): su taxonomia es
// gruesa (Belleza, Moda, Bisuteria...). Este script clasifica los productos monitoreados por
// keywords sobre el nombre y cruza con las ventas medidas (dashboard/data.js).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');

// ---------- argumentos ----------
const args = process.argv.slice(2);
const fechaArg = args.includes('--fecha') ? args[args.indexOf('--fecha') + 1] : null;
const conPdf = args.includes('--pdf');

// ---------- utilidades ----------
function readJson(p) {
  let t = fs.readFileSync(p, 'utf8');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  return JSON.parse(t);
}
const cop$ = n => n == null ? '—' : '$' + Number(n).toLocaleString('es-CO');
const num$ = n => n == null ? '—' : Number(n).toLocaleString('es-CO');

// ---------- reglas de clasificacion ----------
// Un producto puede pertenecer a varias categorias; las reglas se aplican sobre el nombre
// (los tokens de categoria Dropi son poco confiables a nivel producto) con exclusiones
// para falsos positivos (munecas con ropa, fundas-"pijama" de carritos, compresion, etc).
const REGLAS = [
  {
    key: 'pijamas',
    label: 'Pijamas y ropa de dormir',
    re: /pijama|piyama|pyjama|camison|baby ?doll|negligee|bata de ba(n|n)o|bata de dormir|sleep ?dress/i,
    excl: /dispositivo|antifaz|bolsa de dormir|saco de dormir|mascarilla|maquina|venda|auricul|bluetooth|espia|moto|bicicleta|carro|carpa|forro|mu(ñ|n)eca|osito/i,
    catTokens: []
  },
  {
    key: 'calzado',
    label: 'Calzado',
    re: /\btenis\b|tenis |zapato|zapatilla|sandalia|chancla|pantufla|\bbota\b|\bbotas\b|tacon|crocs?\b|sneaker|botin|mocasin|alpargat|escarpin|zapat(o|ó)n/i,
    excl: /organizador|cubre|funda|soporte|limpia|impermeable|zapaton|plantilla|protector|mu(ñ|n)eca|bolsa/i,
    catTokens: []
  },
  {
    key: 'relojes',
    label: 'Relojes',
    re: /reloj|smartwatch|\bwatch\b/i,
    excl: /despertador|de pared|pared\b|arena|cofre|caja|pila|bater|soporte|organizador|de mesa|maquina|estante|crono ?metro|relojero|magis|tv stick/i,
    catTokens: []
  },
  {
    key: 'joyas',
    label: 'Joyas y bisuteria',
    re: /joya|arete|argolla|pulsera|collar|anillo|gargantilla|brazalete|dije|candonga|tobillera|solitario|bisuter|zarcillo|esclava|\bcadena\b/i,
    excl: /joyero|organizador|cofre|caja|soporte|linterna|bici|moto\b|antirrobo|reloj despertador|roachines|reloj|compresion|mu(ñ|n)equera|peluche|capibara/i,
    catTokens: []
  },
  {
    key: 'perfumeria',
    label: 'Perfumeria: lociones, fragancias y perfumes',
    re: /perfum|parfum|fraganc|fragance|colonia|body ?splash|\bsplash\b|locion|lotion|eau ?de|bruma|\bmist\b|desodorant|aftershave|feromona/i,
    excl: /velocim|difusor|pebetero|humidificador|aromatizad|ambientad|vela |home ?scent/i,
    catTokens: []
  },
  {
    key: 'ropa',
    label: 'Ropa',
    re: /vestid|blusa|jean|camiseta|sudadera|pantal(o|ó)n|pantaloneta|short|falda|hoodie|buso\b|leggin|camisa|chaqueta|corset|corse|enterizo|blazer|faja|overol|ropa interior|conjunto deport|top deport|musculosa/i,
    excl: /cama|sabana|tendedero|cesto|secadora|organizador|impermeable metalizado|varilla|carrito|mascotas|bicicleta|moto\b|mu(ñ|n)eca/i,
    catTokens: []
  }
];

const LABEL = Object.fromEntries(REGLAS.map(r => [r.key, r.label]));
const REPORT_ORDER = ['perfumeria', 'joyas', 'ropa', 'calzado', 'relojes', 'pijamas'];

function clasifica(p) {
  const cats = norm(p.categories || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const r of REGLAS) {
    if (r.excl.test(p.name)) continue;
    if (r.re.test(p.name) || r.catTokens.some(t => cats.includes(t))) out.push(r.key);
  }
  return out;
}

function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// ---------- cargar snapshots: estado mas reciente por producto ----------
const supDir = path.join(DATA, 'suppliers');
const prods = new Map(); // id -> producto con su foto mas reciente
const fechasFoto = new Set();
for (const s of fs.readdirSync(supDir)) {
  const sd = path.join(supDir, s);
  if (!fs.statSync(sd).isDirectory()) continue;
  for (const f of fs.readdirSync(sd)) {
    if (!f.endsWith('.json')) continue;
    const fecha = f.replace('.json', '');
    let arr;
    try { arr = readJson(path.join(sd, f)); } catch (e) { continue; }
    for (const p of (arr || [])) {
      let e = prods.get(p.id);
      if (!e) { e = { ...p, date: '' }; prods.set(p.id, e); }
      if (fecha >= e.date) Object.assign(e, p, { date: fecha });
      fechasFoto.add(fecha);
    }
  }
}

// ---------- cargar ventas medidas (dashboard/data.js) ----------
let ventas = new Map();
const dataJs = path.join(ROOT, 'dashboard', 'data.js');
if (fs.existsSync(dataJs)) {
  const t = fs.readFileSync(dataJs, 'utf8');
  const d = JSON.parse(t.slice(t.indexOf('=') + 1).trim().replace(/;$/, ''));
  for (const r of d.ranking_total || []) ventas.set(r.id, r);
  for (const r of d.ranking_hoy || []) {
    const v = ventas.get(r.id) || { id: r.id };
    v.vendidas_hoy = r.vendidas_hoy != null ? r.vendidas_hoy : v.vendidas_hoy;
    ventas.set(r.id, v);
  }
}

// ---------- proveedores del universo (BFF pedidos/mes) ----------
let universo = [];
const ranked = path.join(ROOT, '..', '.firecrawl', 'suppliers-ranked.json');
if (fs.existsSync(ranked)) universo = readJson(ranked);

const TOKENS_UNIVERSO = {
  perfumeria: ['belleza'],
  joyas: ['bisuteria'],
  ropa: ['ropa', 'ropa deportiva', 'moda'],
  calzado: ['calzado'],
  relojes: [],
  pijamas: []
};

// ---------- clasificar y agregar ----------
const hoy = fechaArg || new Date().toISOString().slice(0, 10);
const resumen = { generado: new Date().toISOString(), productos_monitor: prods.size, fechas_foto: [...fechasFoto].sort(), categorias: {} };
const itemsPorCat = {}; // key -> items[] (para Excel/HTML)
const outDir = path.join(DATA, 'analysis', 'categorias');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const r of REGLAS) {
  const items = [];
  for (const p of prods.values()) {
    if (!clasifica(p).includes(r.key)) continue;
    const v = ventas.get(p.id) || {};
    const margen = v.margen_pct != null ? v.margen_pct
      : (p.sale_price > 0 && p.suggested_price >= p.sale_price ? Math.round((1 - p.sale_price / p.suggested_price) * 100) : null);
    items.push({
      id: p.id, nombre: p.name, proveedor: p.supplier, proveedor_id: p.supplier_id,
      categorias: p.categories, precio_proveedor: p.sale_price, precio_sugerido: p.suggested_price,
      stock: p.stock, vendidas_total: v.vendidas_total || 0, vendidas_dia: v.vendidas_dia || 0,
      tier: v.tier || '', margen_pct: margen
    });
  }
  items.sort((a, b) => (b.vendidas_total - a.vendidas_total) || (b.stock - a.stock));
  itemsPorCat[r.key] = items;

  // CSV de la categoria
  const esc = s => '\u0022' + String(s == null ? '' : s).replace(/\u0022/g, '\u0022\u0022') + '\u0022';
  const csv = ['id,nombre,proveedor,proveedor_id,categorias,precio_proveedor,precio_sugerido,stock,vendidas_total,vendidas_dia,tier,margen_pct']
    .concat(items.map(i => [i.id, esc(i.nombre), esc(i.proveedor), i.proveedor_id, esc(i.categorias), i.precio_proveedor, i.precio_sugerido, i.stock, i.vendidas_total, i.vendidas_dia, i.tier, i.margen_pct].join(',')))
    .join('\r\n');
  fs.writeFileSync(path.join(outDir, `${r.key}-catalogo-${hoy}.csv`), '\ufeff' + csv);

  // agregados
  const porProv = {};
  for (const i of items) {
    porProv[i.proveedor] = porProv[i.proveedor] || { productos: 0, unidades: 0, con_ventas: 0 };
    porProv[i.proveedor].productos++;
    porProv[i.proveedor].unidades += i.vendidas_total;
    if (i.vendidas_total > 0) porProv[i.proveedor].con_ventas++;
  }
  const topProv = Object.entries(porProv).sort((a, b) => b[1].productos - a[1].productos);
  const conVentas = items.filter(i => i.vendidas_total > 0);
  const unidMedidas = conVentas.reduce((s, i) => s + i.vendidas_total, 0);
  const precios = items.filter(i => i.precio_sugerido > 0).map(i => i.precio_sugerido).sort((a, b) => a - b);
  const margenes = items.filter(i => i.margen_pct != null).map(i => i.margen_pct).sort((a, b) => a - b);
  const med = a => a.length ? a[Math.floor(a.length / 2)] : null;

  const univ = TOKENS_UNIVERSO[r.key].length
    ? universo.filter(s => TOKENS_UNIVERSO[r.key].some(t => norm(s.categorias || '').split(',').map(x => x.trim()).includes(t)))
    : [];
  const univTop = univ.filter(s => s.pedidos_ultimo_mes > 0).sort((a, b) => b.pedidos_ultimo_mes - a.pedidos_ultimo_mes).slice(0, 8);

  resumen.categorias[r.key] = {
    label: r.label,
    productos_monitor: items.length,
    proveedores_monitor: topProv.length,
    productos_con_ventas: conVentas.length,
    unidades_medidas: unidMedidas,
    precio_sugerido_mediana: med(precios),
    margen_mediana_pct: med(margenes),
    top_proveedores_monitor: topProv.slice(0, 10).map(([n, v]) => ({ proveedor: n, ...v })),
    top_productos: conVentas.slice(0, 10),
    top_universo_bff: univTop.map(s => ({ id: s.id, proveedor: s.proveedor, ciudad: s.ciudad, pedidos_mes: s.pedidos_ultimo_mes, num_productos: s.num_productos })),
    universo_proveedores_token: univ.length
  };

  console.log(`\n=== ${r.label.toUpperCase()} ===`);
  console.log(`monitoreados: ${items.length} productos en ${topProv.length} proveedores | ventas medidas: ${conVentas.length} productos / ${unidMedidas} u`);
  console.log(`precio sugerido mediana: ${cop$(med(precios))} | margen mediana: ${med(margenes)}%`);
  console.log(`proveedores monitor top: ` + topProv.slice(0, 5).map(([n, v]) => `${n} (${v.productos}p${v.unidades ? ', ' + v.unidades + 'u' : ''})`).join(' · '));
  if (univTop.length) console.log(`universo BFF (token ${TOKENS_UNIVERSO[r.key].join('/')}): ${univ.length} proveedores, top pedidos/mes: ` + univTop.slice(0, 5).map(s => `${s.proveedor} ${s.pedidos_ultimo_mes.toLocaleString('es-CO')}`).join(' · '));
  if (conVentas.length) console.log(`top productos: ` + conVentas.slice(0, 5).map(i => `${i.nombre.slice(0, 40)} ${i.vendidas_total}u ${i.tier || '-'}`).join(' | '));
  else console.log(`(sin ventas medidas aun: los 3 proveedores con historial no venden esta categoria o los deltas arrancan con la proxima corrida)`);
}

fs.writeFileSync(path.join(outDir, `resumen-${hoy}.json`), JSON.stringify(resumen, null, 2));

// =====================================================================
// INFORME HTML (IDs copiables con clic + boton Exportar PDF)
// =====================================================================
const TIER_CLS = { S: 'tierS', A: 'tierA', B: 'tierB', C: 'tierC', D: 'tierD' };

function filaHtml(i, n) {
  const tier = i.tier ? `<span class="tier ${TIER_CLS[i.tier] || 'tierC'}" title="tier ${i.tier}">${i.tier}</span>` : '—';
  return `<tr>
    <td class="rank">${n}</td>
    <td class="pid" title="Clic para copiar el ID" onclick="copyId('${i.id}',event)">${i.id}<span class="cp">&#10697;</span></td>
    <td><b>${i.nombre || '—'}</b><div class="mut">${(i.categorias || '').slice(0, 60)}</div></td>
    <td>${i.proveedor}</td>
    <td class="num">${cop$(i.precio_proveedor)}</td>
    <td class="num">${cop$(i.precio_sugerido)}</td>
    <td class="num">${i.margen_pct != null ? i.margen_pct + '%' : '—'}</td>
    <td class="num">${num$(i.stock)}</td>
    <td class="num ${i.vendidas_total > 0 ? 'pos' : ''}">${i.vendidas_total || '—'}</td>
    <td class="tcell">${tier}</td>
  </tr>`;
}

function seccionHtml(key) {
  const r = resumen.categorias[key];
  const items = itemsPorCat[key] || [];
  const top = items.slice(0, 100);
  const provChips = r.top_proveedores_monitor.slice(0, 6).map(p => `<span class="chip">${p.proveedor} <b>${p.productos}p</b>${p.unidades ? ` · <b class="pos">${p.unidades}u</b>` : ''}</span>`).join(' ');
  const univ = r.top_universo_bff.length
    ? `<div class="note"><b>Universo BFF</b> (${TOKENS_UNIVERSO[key].join(' / ')}, cosecha 10-16, metrica volatil): ` + r.top_universo_bff.slice(0, 5).map(s => `${s.proveedor} ${s.pedidos_mes.toLocaleString('es-CO')} ped/mes`).join(' · ') + `</div>`
    : `<div class="note"><b>Universo:</b> sin token propio en el directorio de 2.390 proveedores — categoria invisible para el BFF, solo medible con nuestro delta.</div>`;
  const ventas = r.unidades_medidas > 0
    ? `${r.unidades_medidas} u medidas (${r.productos_con_ventas} producto${r.productos_con_ventas === 1 ? '' : 's'})`
    : '0 u (deltas arrancan con las proximas corridas)';
  return `
<section class="cat">
  <h2>${r.label}</h2>
  <div class="cstats">
    <span class="chip">productos monitor <b>${r.productos_monitor}</b></span>
    <span class="chip">proveedores <b>${r.proveedores_monitor}</b></span>
    <span class="chip">PVP mediana <b>${cop$(r.precio_sugerido_mediana)}</b></span>
    <span class="chip">margen mediano <b>${r.margen_mediana_pct != null ? r.margen_mediana_pct + '%' : '—'}</b></span>
    <span class="chip">ventas medidas <b class="${r.unidades_medidas > 0 ? 'pos' : ''}">${ventas}</b></span>
  </div>
  ${univ}
  <div class="note"><b>Proveedores monitoreados top:</b> ${provChips}</div>
  <table>
    <tr><th>#</th><th title="Clic en el ID para copiarlo">ID Dropi ⧉</th><th>Producto</th><th>Proveedor</th><th class="num">Costo</th><th class="num">PVP sugg.</th><th class="num">Margen</th><th class="num">Stock</th><th class="num">Vendidas</th><th>Tier</th></tr>
    ${top.map((i, n) => filaHtml(i, n + 1)).join('')}
  </table>
  ${items.length > top.length ? `<div class="trunc hint">Mostrando top ${top.length} de ${items.length} — catalogo completo en el CSV y en la hoja "${LABEL[key].slice(0, 28)}" del Excel detallado.</div>` : ''}
</section>`;
}

function informeHtml() {
  const cats = REPORT_ORDER;
  const totalProd = cats.reduce((s, k) => s + resumen.categorias[k].productos_monitor, 0);
  const totalProv = new Set(cats.flatMap(k => (itemsPorCat[k] || []).map(i => i.proveedor))).size;
  const totalU = cats.reduce((s, k) => s + resumen.categorias[k].unidades_medidas, 0);
  const conV = cats.reduce((s, k) => s + resumen.categorias[k].productos_con_ventas, 0);

  const resumenTabla = cats.map(k => {
    const r = resumen.categorias[k];
    return `<tr><td><b>${r.label}</b></td><td class="num">${r.productos_monitor}</td><td class="num">${r.proveedores_monitor}</td><td class="num">${cop$(r.precio_sugerido_mediana)}</td><td class="num">${r.margen_mediana_pct != null ? r.margen_mediana_pct + '%' : '—'}</td><td class="num ${r.unidades_medidas > 0 ? 'pos' : ''}">${r.unidades_medidas}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DropAnalytics — Informe por categorias ${hoy}</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--txt:#e6edf3;--muted:#8b949e;--acc:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--txt);font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;padding:22px}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:21px}h1 span{color:var(--acc)}
.sub{color:var(--muted);font-size:12px;margin:4px 0 14px}
.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap}
.btn{background:#1c2735;border:1px solid var(--acc);color:var(--acc);padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}
.btn:hover{background:var(--acc);color:#0d1117}
.hint{color:var(--muted);font-size:11px}
.kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}
.kpi{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 16px}
.kpi .v{font-size:20px;color:var(--acc);font-weight:700}
.kpi .v.green{color:var(--green)}
.kpi .l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
h2{font-size:16px;margin:0 0 8px}
.cat{margin-top:26px}
.cstats{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 8px}
.chip{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:3px 12px;font-size:11px;color:var(--muted)}
.chip b{color:var(--txt)}
.note{color:var(--muted);font-size:11px;margin:6px 0}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin:6px 0 4px}
th{background:#1c2129;color:var(--muted);text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;white-space:nowrap}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
td{padding:7px 10px;border-top:1px solid var(--border);vertical-align:top}
tr:hover td{background:#1a2029}
.pos{color:var(--green);font-weight:700}
.mut{color:var(--muted);font-size:11px}
.rank{color:var(--muted);font-family:Consolas,monospace}
.pid{cursor:pointer;font-family:Consolas,monospace;color:var(--yellow);font-size:12px;white-space:nowrap}
.pid:hover{text-decoration:underline}
.pid .cp{opacity:.6;font-size:10px;margin-left:3px}
.tier{color:#0d1117;font-weight:800;border-radius:4px;padding:1px 7px;font-size:11px}
.tierS{background:#3fb950}.tierA{background:#58a6ff}.tierB{background:#d29922}.tierC{background:#8b949e}.tierD{background:#f85149}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#3fb950;color:#0d1117;font-weight:700;padding:9px 20px;border-radius:20px;font-size:13px;display:none;box-shadow:0 4px 14px rgba(0,0,0,.4)}
footer{margin-top:26px;color:var(--muted);font-size:11px;line-height:1.6}
@media print{
  body{background:#fff;color:#111;font-size:10.5px;padding:0}
  .toolbar,.hint,.trunc{display:none!important}
  .wrap{max-width:none}
  table{background:#fff;border:1px solid #999;border-radius:0;margin:6px 0 2px}
  th{background:#eee;color:#333}
  td{border-top:1px solid #ddd}
  tr:hover td{background:#fff}
  .pid{color:#7a5c00}
  .pos{color:#0a7a28}
  .kpi,.chip{background:#fff;border:1px solid #bbb}
  .kpi .v{color:#0a58ca}.kpi .v.green{color:#0a7a28}
  .kpi .l,.chip,.note,footer,.sub,.mut,.rank{color:#555}
  h1 span{color:#0a58ca}
  .cat{break-before:page;margin-top:8px}
  tr{break-inside:avoid}
  .toast{display:none!important}
}
@page{size:A4;margin:12mm}
</style>
</head>
<body>
<div class="wrap">
<h1>Drop<span>Analytics</span> — Informe por categorias</h1>
<div class="sub">Perfumeria (lociones, fragancias, perfumes) · Joyas · Ropa · Calzado · Relojes · Pijamas &nbsp;|&nbsp; foto: ${[...fechasFoto].sort().join(' → ')} · productos monitor: ${num$(prods.size)} · generado: ${hoy}</div>

<div class="toolbar">
  <button class="btn" onclick="window.print()">&#11037; Exportar PDF</button>
  <span class="hint">Clic en cualquier <b>ID Dropi</b> para copiarlo al portapapeles · en el dialogo de impresion usa Destino: "Guardar como PDF" · se imprime 1 categoria por pagina</span>
</div>

<div class="kpis">
  <div class="kpi"><div class="l">Categorias</div><div class="v">6</div></div>
  <div class="kpi"><div class="l">Productos clasificados</div><div class="v">${num$(totalProd)}</div></div>
  <div class="kpi"><div class="l">Proveedores involucrados</div><div class="v">${num$(totalProv)}</div></div>
  <div class="kpi"><div class="l">Ventas medidas (u)</div><div class="v green">${num$(totalU)}</div></div>
  <div class="kpi"><div class="l">Productos con ventas</div><div class="v">${num$(conV)}</div></div>
</div>

<table>
  <tr><th>Categoria</th><th class="num">Productos monitor</th><th class="num">Proveedores</th><th class="num">PVP mediana</th><th class="num">Margen mediano</th><th class="num">Ventas medidas (u)</th></tr>
  ${resumenTabla}
</table>
<div class="note">Ventas medidas = delta de stock (reducciones; las reposiciones se descartan). Los proveedores recien monitoreados generan su primer delta en la corrida siguiente — re-ejecutar este informe tras cada snapshot diario.</div>

${cats.map(seccionHtml).join('')}

<footer>
<b>Fuente:</b> dropi-analytics/data/suppliers/*.json (snapshots) + dashboard/data.js (deltas medidos) + .firecrawl/suppliers-ranked.json (directorio BFF)<br>
<b>Entregables de esta corrida:</b> informe-categorias-${hoy}.html · informe-categorias-${hoy}.pdf · informe-categorias-detallado-${hoy}.xlsx · {categoria}-catalogo-${hoy}.csv · resumen-${hoy}.json — en dropi-analytics/data/analysis/categorias/<br>
<b>Tier:</b> S velocidad p85+ y margen &ge;40% · A p60+ y &ge;30% · B vende sin llegar a A · C sin ventas · D sospechoso (reglas de veracidad)
</footer>
</div>
<div class="toast" id="toast"></div>
<script>
function copyId(id, ev){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  var s = String(id);
  var ok = function(){ toast('ID ' + s + ' copiado'); };
  var fb = function(){
    var ta = document.createElement('textarea'); ta.value = s;
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); ok(); } catch(e) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(s).then(ok).catch(fb); }
  else fb();
}
function toast(m){
  var t = document.getElementById('toast'); t.textContent = m; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(function(){ t.style.display = 'none'; }, 1500);
}
</script>
</body>
</html>`;
}

const htmlDated = path.join(outDir, `informe-categorias-${hoy}.html`);
fs.writeFileSync(htmlDated, informeHtml());
fs.writeFileSync(path.join(outDir, 'informe-categorias.html'), fs.readFileSync(htmlDated));
console.log(`\nHTML  -> ${htmlDated} (+ copia informe-categorias.html)`);

// =====================================================================
// EXCEL DETALLADO (Info + Resumen + 6 hojas + Top Ventas) — sin dependencias
// =====================================================================
const { writeXlsx } = require('./xlsx-writer');

const catSheet = key => {
  const r = resumen.categorias[key];
  return {
    name: key === 'perfumeria' ? 'Perfumeria' : key === 'joyas' ? 'Joyas' : key[0].toUpperCase() + key.slice(1),
    widths: [10, 52, 22, 12, 30, 13, 15, 9, 9, 12, 11, 7],
    rows: [
      ['ID Dropi', 'Producto', 'Proveedor', 'ID Proveedor', 'Categorias Dropi', 'Costo (COP)', 'PVP sugerido (COP)', 'Margen %', 'Stock', 'Vendidas total', 'Vendidas/dia', 'Tier'],
      ...(itemsPorCat[key] || []).map(i => [i.id, i.nombre, i.proveedor, i.proveedor_id, i.categorias, i.precio_proveedor || null, i.precio_sugerido || null, i.margen_pct, i.stock || null, i.vendidas_total || null, i.vendidas_dia || null, i.tier || null])
    ]
  };
};

const topVentasRows = [];
for (const [id, v] of ventas) {
  const p = prods.get(id);
  if (!p || !v.vendidas_total) continue;
  const cats = clasifica(p);
  topVentasRows.push([id, p.name, p.supplier, v.vendidas_total, v.vendidas_dia || null, v.vendidas_hoy != null ? v.vendidas_hoy : null, v.tier || '', v.margen_pct != null ? v.margen_pct : '', v.precio_proveedor || null, v.precio_sugerido || null, p.stock != null ? p.stock : null, cats.length ? cats.map(k => LABEL[k]).join(' + ') : '— fuera de las 6']);
}
topVentasRows.sort((a, b) => (b[3] - a[3]));

const resumenRows = [
  ['Categoria', 'Productos monitor', 'Proveedores', 'PVP mediana (COP)', 'Margen mediano %', 'Ventas medidas (u)', 'Productos con ventas', 'Top proveedor monitor', 'Top prov. — productos', 'Token universo', 'Proveedores universo'],
  ...REPORT_ORDER.map(k => {
    const r = resumen.categorias[k];
    const tp = r.top_proveedores_monitor[0];
    return [r.label, r.productos_monitor, r.proveedores_monitor, r.precio_sugerido_mediana, r.margen_mediana_pct, r.unidades_medidas, r.productos_con_ventas, tp ? tp.proveedor : '', tp ? tp.productos : null, TOKENS_UNIVERSO[k].join(' / ') || '—', r.universo_proveedores_token || null];
  })
];

const xlsxSheets = [
  { name: 'Info', widths: [26, 90], rows: [
    ['DropAnalytics — Informe por categorias', ''],
    ['', ''],
    ['Generado', new Date().toISOString()],
    ['Fecha del informe', hoy],
    ['Fotos de proveedores', [...fechasFoto].sort().join(' | ')],
    ['Productos monitorizados', prods.size],
    ['Metodo de ventas', 'Delta de stock entre snapshots (reducciones); las reposiciones (stock que sube) se descartan'],
    ['Clasificacion', 'Keywords sobre el nombre del producto (Dropi no tiene categorias finas) — ver scripts/categorias-analisis.js'],
    ['Fuentes', 'data/suppliers/*.json + dashboard/data.js + .firecrawl/suppliers-ranked.json'],
    ['Advertencia BFF', 'pedidos_mes del universo = metrica volatil (cache); el delta propio es la medida confiable'],
    ['', ''],
    ['Salidas de esta corrida', `informe-categorias-${hoy}.html · informe-categorias-${hoy}.pdf · informe-categorias-detallado-${hoy}.xlsx · {categoria}-catalogo-${hoy}.csv · resumen-${hoy}.json`],
    ['Como actualizar', 'RUN-DIARIO.bat ejecuta este analisis tras cada corrida: node scripts/categorias-analisis.js --pdf']
  ]},
  { name: 'Resumen', widths: [34, 13, 11, 14, 13, 13, 13, 24, 12, 14, 12], rows: resumenRows },
  ...REPORT_ORDER.map(catSheet),
  { name: 'Top Ventas', widths: [10, 48, 20, 12, 11, 11, 7, 10, 12, 14, 9, 40], rows: [
    ['ID Dropi', 'Producto', 'Proveedor', 'Vendidas total', 'Vendidas/dia', 'Vendidas hoy', 'Tier', 'Margen %', 'Costo (COP)', 'PVP sugg. (COP)', 'Stock', 'Categoria del analisis'],
    ...topVentasRows
  ]}
];

const xlsxDated = path.join(outDir, `informe-categorias-detallado-${hoy}.xlsx`);
writeXlsx(xlsxDated, xlsxSheets);
fs.writeFileSync(path.join(outDir, 'informe-categorias-detallado.xlsx'), fs.readFileSync(xlsxDated));
console.log(`Excel -> ${xlsxDated} (${xlsxSheets.length} hojas, ${Object.values(itemsPorCat).reduce((s, a) => s + a.length, 0) + topVentasRows.length} filas) (+ copia informe-categorias-detallado.xlsx)`);

// =====================================================================
// PDF del informe (opcional, --pdf) — Playwright/Chromium headless
// =====================================================================
if (conPdf) {
  (async () => {
    try {
      const { chromium } = require('playwright');
      const { pathToFileURL } = require('url');
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlDated).href, { waitUntil: 'networkidle' });
      const pdfDated = path.join(outDir, `informe-categorias-${hoy}.pdf`);
      await page.pdf({ path: pdfDated, printBackground: true, preferCSSPageSize: true });
      await browser.close();
      fs.writeFileSync(path.join(outDir, 'informe-categorias.pdf'), fs.readFileSync(pdfDated));
      console.log(`PDF   -> ${pdfDated} (+ copia informe-categorias.pdf)`);
    } catch (e) {
      console.warn(`PDF omitido (${e.message.split('\n')[0]}) — el boton "Exportar PDF" del HTML sigue disponible (Ctrl+P).`);
    }
  })();
}

console.log(`\nOK: 6 categorias -> ${outDir}`);

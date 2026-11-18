const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const responses = [];
  await page.route('**/api/orders/myorders/v2*', async route => {
    const u = route.request().url();
    await route.continue({ url: u.split('?')[0] + '?exportAs=orderByRow&orderBy=id&orderDirection=desc&result_number=100&start=0' });
  });
  page.on('response', async r => {
    if (r.url().includes('/api/orders/myorders/v2')) responses.push(await r.text().catch(() => 'ERR'));
  });
  await page.goto('https://app.dropi.co/dashboard/orders', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  if (!responses.length) { console.log('SIN RESPUESTA'); await ctx.close(); return; }
  const j = JSON.parse(responses[0]);
  const orders = j.objects || [];
  console.log('ORDENES:', orders.length);
  const dir = path.join(ROOT, 'data', 'orders');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'orders.json'), JSON.stringify(orders, null, 1));
  console.log('guardado -> data/orders/orders.json');
  // resumen
  const prods = [];
  for (const o of orders) {
    const ops = o.products || [];
    for (const p of ops) {
      prods.push({
        order_id: o.id, fecha: o.created_at, status: o.status,
        product_id: p.id, qty: p.quantity, price: p.price,
        supplier: p.user ? (p.user.store_name || p.user.name) : (p.supplier || '?')
      });
    }
  }
  console.log('LINEAS DE PRODUCTO TOTALES:', prods.length);
  fs.writeFileSync(path.join(dir, 'lineas-producto.json'), JSON.stringify(prods, null, 1));
  // muestras
  console.log('=== ULTIMAS 12 LINEAS ===');
  prods.slice(0, 12).forEach(p => console.log(`${p.order_id} | ${String(p.fecha).substring(0, 10)} | ${p.status} | prod #${p.product_id} x${p.qty} | ${p.supplier}`));
  const fechas = {};
  for (const p of prods) { const d = String(p.fecha).substring(0, 10); fechas[d] = (fechas[d] || 0) + 1; }
  console.log('=== LINEAS POR FECHA ===');
  Object.keys(fechas).sort().reverse().forEach(d => console.log(d + ': ' + fechas[d]));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

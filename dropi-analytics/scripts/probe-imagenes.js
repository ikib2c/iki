// Probe: volca el primer objeto crudo de products/v4/index para ver
// donde viven las URLs de imagen (regla R1 de KACHE).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  let capturado = null;

  await page.route('**/products/v4/index', async route => {
    try {
      const d = JSON.parse(route.request().postData() || '{}');
      d.supplier_id = 205895; d.pageSize = 100; d.startData = 0;
      d.no_count = false; d.order_by = 'id'; d.order_type = 'asc';
      await route.continue({ postData: JSON.stringify(d) });
    } catch (e) { await route.continue(); }
  });
  page.on('response', async r => {
    if (capturado || !r.url().includes('products/v4/index')) return;
    const t = await r.text().catch(() => '');
    try {
      const j = JSON.parse(t);
      if (j.objects && j.objects.length) capturado = j.objects[0];
    } catch (e) {}
  });

  await page.goto('https://app.dropi.co/dashboard/provider/205895/goldbox', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  if (!capturado) { await page.reload({ waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(5000); }

  if (!capturado) { console.log('SIN RESPUESTA DEL BFF'); await ctx.close(); process.exit(1); }

  // Claves top-level + valores con urls
  console.log('=== CLAVES TOP-LEVEL ===');
  console.log(Object.keys(capturado).join(', '));
  console.log('=== OBJETO CRUDO ===');
  fs.writeFileSync(path.join(__dirname, 'bff-sample.json'), JSON.stringify(capturado, null, 2));
  const s = JSON.stringify(capturado);
  const hits = s.match(/https?:\/\/[^"\\ ]+/g) || [];
  console.log('=== URLs ENCONTRADAS EN EL OBJETO ===');
  hits.slice(0, 10).forEach(u => console.log(u.substring(0, 160)));
  console.log('total urls:', hits.length);
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

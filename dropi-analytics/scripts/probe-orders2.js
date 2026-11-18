const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  let respText = null;
  page.on('response', async r => {
    if (r.url().includes('/api/orders/myorders/v2') && !respText) {
      respText = await r.text().catch(() => 'ERR');
    }
  });
  await page.goto('https://app.dropi.co/dashboard/orders', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  if (!respText) { console.log('SIN RESPUESTA'); await ctx.close(); return; }
  console.log('LEN:', respText.length);
  try {
    const j = JSON.parse(respText);
    const objs = j.objects || [];
    console.log('isSuccess:', j.isSuccess, '| orders:', Array.isArray(objs) ? objs.length : 'objeto');
    if (Array.isArray(objs) && objs.length > 0) {
      console.log('=== PRIMERA ORDEN (700 chars) ===');
      console.log(JSON.stringify(objs[0]).substring(0, 700));
      const keys = Object.keys(objs[0]);
      console.log('=== KEYS ===');
      console.log(keys.join(', '));
      if (objs[0].products) console.log('=== PRODUCTS ===', JSON.stringify(objs[0].products).substring(0, 400));
    }
  } catch (e) { console.log('parse err:', e.message); console.log(respText.substring(0, 400)); }
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

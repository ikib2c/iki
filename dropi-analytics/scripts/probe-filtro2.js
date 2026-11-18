const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const reqs = [];
  page.on('request', r => { if (r.url().includes('products/v4/index')) reqs.push({ body: r.postData() || 'NONE', at: 'req' }); });
  page.on('response', async r => {
    if (r.url().includes('products/v4/index')) {
      const t = await r.text().catch(() => 'err');
      reqs.push({ body: t.substring(0, 900), at: 'resp' });
    }
  });
  await page.goto('https://app.dropi.co/dashboard/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  // abrir multiselect y elegir Jugueteria
  await page.getByText('Categorías', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  const opt = page.locator('li').filter({ hasText: 'Jugueteria' }).first();
  const cnt = await opt.count();
  console.log('opciones Jugueteria (li):', cnt);
  await opt.click();
  await page.waitForTimeout(5000);
  // click fuera para cerrar el panel y que aplique
  await page.mouse.click(600, 300);
  await page.waitForTimeout(4000);
  console.log('=== PETICIONES/RESPUESTAS (ultima de cada tipo) ===');
  const lastReq = [...reqs].reverse().find(x => x.at === 'req');
  const lastResp = [...reqs].reverse().find(x => x.at === 'resp');
  console.log('BODY ENVIADO:', lastReq ? lastReq.body : 'ninguno');
  console.log('RESPUESTA:', lastResp ? lastResp.body : 'ninguna');
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const reqs = [];
  page.on('request', r => { if (r.url().includes('products/v4/index')) reqs.push({ body: r.postData() || 'NONE' }); });
  page.on('response', async r => {
    if (r.url().includes('products/v4/index')) {
      const t = await r.text().catch(() => 'err');
      try { const j = JSON.parse(t); reqs.push({ respCount: (j.objects || []).length, sample: (j.objects || [])[0] ? j.objects[0].name : '-', cats: (j.objects || []).slice(0, 3).map(o => (o.categories || []).map(c => c.name).join('+')).join(' | ') }); } catch (e) { reqs.push({ respErr: t.substring(0, 100) }); }
    }
  });
  await page.goto('https://app.dropi.co/dashboard/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  reqs.length = 0;
  await page.getByText('Categorías', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('li').filter({ hasText: 'Jugueteria' }).first().click();
  await page.waitForTimeout(1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const ap = page.getByText('Aplicar filtros', { exact: true });
  console.log('boton Aplicar filtros:', await ap.count());
  await ap.first().click();
  await page.waitForTimeout(6000);
  console.log('=== PETICIONES TRAS APLICAR ===');
  reqs.forEach((x, i) => console.log(i + ':', JSON.stringify(x).substring(0, 400)));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const reqs = [];
  page.on('request', r => { if (r.url().includes('products/v4/index')) reqs.push({ at: Date.now(), body: r.postData() || 'NONE' }); });
  page.on('response', async r => {
    if (r.url().includes('products/v4/index')) {
      const t = await r.text().catch(() => 'err');
      reqs.push({ at: Date.now(), resp: t.substring(0, 300) });
    }
  });
  await page.goto('https://app.dropi.co/dashboard/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const t0 = Date.now();
  await page.getByText('Categorías', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('li').filter({ hasText: 'Jugueteria' }).first().click();
  await page.waitForTimeout(6000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  console.log('=== TODAS LAS PETICIONES ===');
  reqs.forEach((x, i) => {
    if (x.body) console.log('REQ ' + i + ' (t+' + (x.at - t0) + 'ms): ' + x.body.substring(0, 300));
    else console.log('RESP ' + i + ' (t+' + (x.at - t0) + 'ms): ' + x.resp.substring(0, 200));
  });
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

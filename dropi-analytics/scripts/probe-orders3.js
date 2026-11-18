const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const responses = [];
  await page.route('**/api/orders/myorders/v2*', async route => {
    const u = route.request().url();
    const clean = u.split('?')[0] + '?exportAs=orderByRow&orderBy=id&orderDirection=desc&result_number=100&start=0';
    await route.continue({ url: clean });
  });
  page.on('response', async r => {
    if (r.url().includes('/api/orders/myorders/v2')) responses.push(await r.text().catch(() => 'ERR'));
  });
  await page.goto('https://app.dropi.co/dashboard/orders', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  console.log('respuestas:', responses.length);
  if (responses.length) {
    try {
      const j = JSON.parse(responses[0]);
      console.log('isSuccess:', j.isSuccess, '| count campo:', j.count, '| orders:', (j.objects || []).length);
    } catch (e) { console.log(responses[0].substring(0, 300)); }
  }
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

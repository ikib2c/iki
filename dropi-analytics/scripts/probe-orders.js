const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const calls = [];
  page.on('request', r => {
    const u = r.url();
    if (u.includes('api.dropi.co') && !u.includes('.png') && !u.includes('.jpg')) {
      calls.push(r.method() + ' ' + u.substring(0, 130) + (r.postData() ? ' | BODY: ' + r.postData().substring(0, 200) : ''));
    }
  });
  await page.goto('https://app.dropi.co/dashboard/orders', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  console.log('=== LLAMADAS API EN MIS PEDIDOS ===');
  [...new Set(calls)].forEach(c => console.log(c));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

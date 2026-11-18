const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://app.dropi.co/dashboard/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const res = await page.evaluate(async () => {
    const tokRaw = localStorage.getItem('DROPI_LoginResult') || '{}';
    const tok = 'Bearer ' + (JSON.parse(tokRaw).token || '');
    const r = await fetch('https://api-v2.dropi.co/bff/product-hunts/categories', {
      headers: { accept: 'application/json, text/plain, */*', authorization: tok, 'x-authorization': tok, 'x-host': 'co' }
    });
    return await r.text();
  });
  const j = JSON.parse(res);
  const data = j.data || [];
  console.log('TOTAL:', data.length);
  for (const c of data) console.log(c.id + ' = ' + c.name);
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://app.dropi.co/dashboard/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  // fetch desde el CONTEXTO DE PAGINA (no content script) a localhost
  const r1 = await page.evaluate(async () => {
    try {
      const r = await fetch('http://localhost:3777/api/ping');
      return 'status ' + r.status + ' | ' + (await r.text()).substring(0, 120);
    } catch (e) { return 'FETCH ERR: ' + e.message; }
  });
  console.log('fetch pagina->localhost:', r1);
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

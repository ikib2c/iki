const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1366, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  let cats = null;
  page.on('response', async r => {
    if (r.url().includes('/api/categories') && !cats) {
      try { cats = JSON.parse(await r.text()); } catch (e) {}
    }
  });
  await page.goto('https://app.dropi.co/dashboard/providers', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(7000);
  if (!cats) { console.log('NO CAPTURADO /api/categories'); }
  else {
    const objs = cats.objects || (Array.isArray(cats) ? cats : []);
    console.log('TOTAL CATEGORIAS:', objs.length);
    for (const c of objs) { console.log(c.id + ' = ' + c.name + (c.white_brand_id !== undefined ? ' (wb ' + c.white_brand_id + ')' : '')); }
  }
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

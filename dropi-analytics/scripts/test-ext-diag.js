// Diagnostico: fetch parcheado? la app dispara products/v4/index?
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
const EXT = path.join(ROOT, 'extension');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 950 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(m.text()));
  let reqCount = 0;
  page.on('request', r => { if (r.url().includes('products/v4/index')) reqCount++; });
  await page.goto('https://app.dropi.co/dashboard/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const fetchSrc = await page.evaluate(() => { try { return window.fetch.toString().substring(0, 100); } catch (e) { return 'ERR'; } });
  console.log('fetch.toString():', fetchSrc);
  console.log('peticiones products/v4/index:', reqCount);
  console.log('=== LOGS DE CONSOLA (DropAnalytics/DP) ===');
  logs.filter(l => l.includes('DropAnalytics') || l.includes('DP ')).slice(0, 6).forEach(l => console.log('  ' + l));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

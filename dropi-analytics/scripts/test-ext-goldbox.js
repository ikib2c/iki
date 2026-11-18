// Prueba E2E con matching por texto: pagina de GOLDBOX (todas sus tarjetas estan en el indice)
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
  await page.goto('https://app.dropi.co/dashboard/provider/205895/goldbox', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(12000);
  const count = async () => await page.evaluate(() => document.querySelectorAll('.dp-badge').length);
  console.log('badges en GOLDBOX (inicial):', await count());
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(2000); }
  console.log('badges tras scroll:', await count());
  const sample = await page.evaluate(() => {
    const b = document.querySelector('.dp-badge');
    return b ? b.innerText.replace(/\n/g, ' | ') : 'sin badge';
  });
  console.log('ejemplo badge:', sample);
  console.log('=== LOGS DP ===');
  logs.filter(l => l.includes('DP') || l.includes('DropAnalytics')).slice(0, 12).forEach(l => console.log('  ' + l.substring(0, 120)));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

// Prueba E2E de la extension: Chrome con la extension cargada + catalogo Dropi
const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
const EXT = path.join(ROOT, 'extension');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1400, height: 950 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`
    ]
  });
  let swPage = null;
  ctx.on('backgroundpage', b => { });
  const page = ctx.pages()[0] || await ctx.newPage();
  const consoleLogs = [];
  page.on('console', m => { if (m.text().includes('DropAnalytics')) consoleLogs.push(m.text()); });
  const badgeCount = async () => await page.evaluate(() => document.querySelectorAll('.dp-badge').length);
  const liveCount = async () => await page.evaluate(() => (window.__dpLive || 0));

  await page.goto('https://app.dropi.co/dashboard/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(9000);
  const c1 = await badgeCount();
  console.log('badges tras cargar catalogo:', c1);
  // scrollear para cargar mas productos
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 2000); await page.waitForTimeout(2500); }
  const c2 = await badgeCount();
  console.log('badges tras scroll:', c2);
  const sample = await page.evaluate(() => {
    const b = document.querySelector('.dp-badge');
    return b ? b.innerText.replace(/\n/g, ' | ') : 'sin badge';
  });
  console.log('ejemplo badge:', sample);
  console.log('console de la extension:', consoleLogs.slice(0, 5));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

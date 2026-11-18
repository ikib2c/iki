// Muestra el contenido de los badges inyectados en GOLDBOX
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
  await page.goto('https://app.dropi.co/dashboard/provider/205895/goldbox', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(10000);
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(2000); }
  const badges = await page.evaluate(() => {
    return [...document.querySelectorAll('.dp-badge')].slice(0, 6).map(b => {
      let card = b.parentElement;
      let hops = 0;
      while (card && hops < 6 && !/PROVIDER/i.test(card.innerText || '')) { card = card.parentElement; hops++; }
      const nameLine = ((card ? card.innerText : '') || '').split('\n').find(l => l.trim().length > 2 && !/precio|provider|stock/i.test(l));
      return { badge: b.innerText.replace(/\n/g, ' '), producto: (nameLine || '').trim().substring(0, 40) };
    });
  });
  console.log('BADGES EN PANTALLA (' + badges.length + '):');
  badges.forEach(x => console.log('  ' + x.badge + '  <- ' + x.producto));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

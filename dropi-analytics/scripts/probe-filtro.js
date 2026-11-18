const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  const bodies = [];
  page.on('request', r => { if (r.url().includes('products/v4/index')) bodies.push(r.postData() || 'NONE'); });
  await page.goto('https://app.dropi.co/dashboard/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(6000);
  console.log('=== REQUESTS SIN FILTRO (los 2 primeros) ===');
  bodies.slice(0, 2).forEach((b, i) => console.log('#' + i + ':', b));
  // diagnosticar dropdown de categorias
  const info = await page.evaluate(() => {
    const els = [...document.querySelectorAll('*')].filter(e => e.offsetParent !== null && /Categor/i.test(e.innerText || '') && (e.innerText || '').trim().length < 30 && e.children.length === 0);
    return els.map(e => e.tagName + '.' + String(e.className || '').substring(0, 60) + ' | texto="' + (e.innerText || '').trim() + '" | parent=' + e.parentElement.tagName + '.' + String(e.parentElement.className || '').substring(0, 40));
  });
  console.log('=== ELEMENTOS CON "Categor" ===');
  info.forEach(x => console.log(x));
  // intentar abrir: click en cada candidato visible y ver si aparecen opciones
  for (const cand of info.slice(0, 6)) {
    const txt = cand.split('texto="')[1].split('"')[0];
    try {
      const el = page.getByText(txt, { exact: true }).first();
      await el.click({ timeout: 3000 });
      await page.waitForTimeout(1200);
      const opts = await page.evaluate(() => {
        const oo = [...document.querySelectorAll('[class*=option], [class*=Option], li, [role=option]')];
        return oo.filter(e => e.offsetParent !== null && (e.innerText || '').trim().length > 0 && (e.innerText || '').trim().length < 25).map(e => (e.innerText || '').trim());
      });
      if (opts.includes('Jugueteria')) { console.log('>>> DROPDOWN ABIERTO con trigger "' + txt + '":', JSON.stringify(opts)); break; }
      if (opts.length > 15) console.log('   trigger "' + txt + '" abre menu pero sin Jugueteria?:', JSON.stringify(opts.slice(0, 20)));
    } catch (e) {}
  }
  await page.waitForTimeout(3000);
  console.log('=== REQUESTS TRAS INTENTOS (los 2 ultimos) ===');
  bodies.slice(-2).forEach((b, i) => console.log('#' + (bodies.length - 2 + i) + ':', b));
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://app.dropi.co/dashboard/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const found = await page.evaluate(async () => {
    const out = {};
    const dbs = ['dropi_cache_storage'];
    for (const name of dbs) {
      const db = await new Promise((ok, no) => { const q = indexedDB.open(name); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
      for (const s of db.objectStoreNames) {
        const store = db.transaction(s, 'readonly').objectStore(s);
        const all = await new Promise(ok => { const r = store.getAll(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });
        const keys = await new Promise(ok => { const r = store.getAllKeys(); r.onsuccess = () => ok(r.result); r.onerror = () => ok([]); });
        for (let i = 0; i < keys.length; i++) {
          const raw = String(keys[i]);
          let decoded = raw;
          try { decoded = atob(raw.replace(/^cache_/, '')); } catch (e) {}
          if (/categor/i.test(decoded) || /categor/i.test(JSON.stringify(all[i] || '').substring(0, 200))) {
            out[decoded] = JSON.stringify(all[i]).substring(0, 4000);
          }
        }
      }
    }
    return out;
  }).catch(e => ({ err: e.message }));
  for (const k of Object.keys(found)) {
    console.log('=== ' + k + ' ===');
    console.log(found[k].substring(0, 4000));
  }
  await ctx.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

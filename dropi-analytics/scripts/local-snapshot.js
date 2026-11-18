// ============================================================
// DropAnalytics - Extractor LOCAL con Playwright (gratis, ilimitado)
// Reemplaza la dependencia de Firecrawl/creditos.
//
// Uso:
//   node scripts/local-snapshot.js --login          Login (abre navegador visible; con totp_secret en credenciales.json
//                                                   ingresa usuario, clave y clave dinamica SOLO; sin el, espera a que la tipies)
//   node scripts/local-snapshot.js --supplier 6606 Snapshot de un proveedor
//   node scripts/local-snapshot.js --all            Snapshot de todos los proveedores de config
//   node scripts/local-snapshot.js --toys           Catalogo filtrado por categoria "Jugueteria"
//   node scripts/local-snapshot.js --check          Verificar sesion (login vigente?)
//   --headless (o env DROPANALYTICS_HEADLESS=1)     Navegador en segundo plano (requiere totp_secret;
//                                                   sin el se ignora porque el 2FA manual necesita ventana)
//
// Sesion persistente: auth/profile (userDataDir) - el login dura ~12h (JWT Dropi)
// ============================================================
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(ROOT, 'auth', 'profile');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'suppliers.json'), 'utf8').replace(/^\uFEFF/, ''));
const SUP_DIR = id => path.join(ROOT, 'data', 'suppliers', String(id));
const STATE = path.join(ROOT, 'data', 'state');
const today = new Date().toISOString().slice(0, 10);
// Credenciales: config/credenciales.json (gitignored). Nunca hardcodeadas aqui.
function loadCreds() {
  const credPath = path.join(ROOT, 'config', 'credenciales.json');
  if (!fs.existsSync(credPath)) {
    console.error('FALTA config/credenciales.json — crear con {"usuario":"...","contrasena":"..."}');
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(credPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!c.usuario || !c.contrasena) {
    console.error('credenciales.json incompleto: necesita "usuario" y "contrasena"');
    process.exit(1);
  }
  return { user: c.usuario, pass: c.contrasena, totp: String(c.totp_secret || '').replace(/[\s-]/g, '').trim() };
}
const CREDS = loadCreds();
const TOTP_SECRET = CREDS.totp; // si esta definido, el 2FA se ingresa SOLO (login 100% automatico)

const args = process.argv.slice(2);
const mode = args[0] || '--check';

async function launch(headless) {
  fs.mkdirSync(path.dirname(PROFILE), { recursive: true });
  try {
    return await chromium.launchPersistentContext(PROFILE, {
      headless: !!headless,
      viewport: { width: 1366, height: 900 },
      // headless fue PROBADO (2026-11-17) y Dropi lo bloquea: el modal 2FA nunca
      // aparece tras enviar credenciales. Se mantiene headed + flags anti-throttling
      // para poder minimizar/tapar la ventana durante la extraccion sin castigo.
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling'
      ]
    });
  } catch (e) {
    console.error('');
    console.error('*** No se pudo abrir el navegador: el perfil auth/profile esta EN USO por otra corrida ***');
    console.error('*** Cierra otra ventana del extractor (Chromium visible) o espera a que termine y reintenta. ***');
    console.error('   Detalle:', String(e.message).split('\n')[0]);
    process.exit(1);
  }
}

async function pageOf(ctx) { return ctx.pages()[0] || await ctx.newPage(); }

// la sesion se valida con el JWT real (campo exp), no por la URL:
// la SPA tarda en redirigir y un token VENCIDO seguia dando falso "SESION OK" -> el run
// extraia vacio durante horas sin abrir jamás el login (incidente 2026-11-01).
function jwtPayload(tok) {
  try {
    const b = String(tok).split('.')[1];
    if (!b) return null;
    return JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (e) { return null; }
}

// devuelve el token; null SOLO si no se pudo leer (evaluate fallo: contexto
// destruido por una navegacion a medias -> no confundir con "sin sesion")
// Dropi 3.4.0 (2026-11-17) MOVIO el JWT: ya no esta en DROPI_LoginResult.token (esa
// clave ahora solo trae configuracion); el JWT vive como string crudo en DROPI_token.
// Sin este fix loggedIn() nunca ve la sesion -> "expirada" fantasma + re-logins infinitos.
async function readLoginToken(page) {
  for (let i = 0; i < 2; i++) {
    try {
      const t = await page.evaluate(() => {
        const nuevo = localStorage.getItem('DROPI_token');
        if (nuevo) return nuevo.replace(/^"|"$/g, '');
        try { return JSON.parse(localStorage.getItem('DROPI_LoginResult') || '{}').token || ''; }
        catch (e) { return ''; }
      });
      return t || '';
    } catch (e) { await page.waitForTimeout(800).catch(() => {}); }
  }
  return null;
}

async function sessionToken(page) {
  return readLoginToken(page);
}

async function loggedIn(page) {
  if (page.url().includes('/auth/login')) return false;
  const tok = await sessionToken(page);
  if (tok === null) return page.url().includes('/dashboard'); // no se pudo leer: no declarar sesion muerta por esto
  if (tok) {
    const p = jwtPayload(tok);
    if (p && p.exp) return p.exp * 1000 > Date.now() + 60000; // margen 1 min
    return tok.length > 100; // token opaco (no-JWT): confiar en el formato
  }
  return false; // sin token = sin sesion (aunque la URL siga en /dashboard por la SPA)
}

async function ensureLogin(ctx) {
  const page = await pageOf(ctx);
  await page.goto('https://app.dropi.co/dashboard/home', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6; i++) { // la SPA puede tardar en decidir/mostrar la sesion
    if (await loggedIn(page)) { console.log('SESION OK (login vigente)'); return true; }
    if (page.url().includes('/auth/login')) break;
    await page.waitForTimeout(2500);
  }
  console.log(TOTP_SECRET
    ? 'Sesion expirada - se renovara automaticamente (clave dinamica calculada sola)...'
    : 'Sesion expirada. Ejecutar: node scripts/local-snapshot.js --login');
  return false;
}

// exige sesion viva: si expiro, abre el login y NO deja morir el proceso en seco.
//  - CON totp_secret (credenciales.json): calcula la clave dinamica tipo Google
//    Authenticator y la ingresa sola -> tambien sirve en corridas desatendidas
//    (RUN-AUTO) porque no necesita a nadie en el teclado.
//  - SIN totp_secret (modo interactivo): deja la ventana abierta para tipear el
//    codigo a mano (30 min por defecto; env DROPANALYTICS_2FA_MIN para cambiarlo).
//    Nunca cierra la ventana en el primer tropiezo: reintenta y sigue esperando.
//  - SIN totp_secret y DESATENDIDA (DROPANALYTICS_DESATENDIDA=1): comportamien-
//    to antiguo, cierra y sale con errorlevel 1 para que el bat muestre el popup.
async function requireLogin(ctx, interactive = true) {
  if (await ensureLogin(ctx)) return true;
  if (TOTP_SECRET || (interactive && !process.env.DROPANALYTICS_DESATENDIDA)) {
    console.log(TOTP_SECRET
      ? 'Sesion expirada - relogin automatico con TOTP...'
      : 'Sesion expirada - se abre el login para ingresar el codigo 2FA. La ventana NO se cierra sola.');
    try { await doLogin(ctx); return true; }
    catch (e) { console.error('No se completo el login 2FA:', e.message); }
  } else {
    console.log('Sesion expirada. Ejecutar: node scripts/local-snapshot.js --login');
  }
  await ctx.close().catch(() => {});
  process.exit(1);
}

const TWOFA_TIMEOUT_MS = Math.max(1, parseInt(process.env.DROPANALYTICS_2FA_MIN || '30', 10) || 30) * 60 * 1000;

// TOTP RFC 6238 compatible con Google Authenticator: base32 -> HMAC-SHA1 -> 6 digitos.
// Es el mismo algoritmo de la app del celular: genera el codigo vigente de 30 s.
function totpCode(secretB32, atMs = Date.now()) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bitstr = '';
  for (const ch of secretB32.toUpperCase()) {
    const v = A.indexOf(ch);
    if (v >= 0) bitstr += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.alloc(Math.floor(bitstr.length / 8));
  for (let i = 0; i + 8 <= bitstr.length; i += 8) key[i / 8] = parseInt(bitstr.slice(i, i + 8), 2);
  if (!key.length) throw new Error('totp_secret invalido (se espera la clave base32 de Google Authenticator)');
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}

async function visibleOtpInputs(page) {
  return page.locator('input:visible:not([type=email]):not([type=password]):not([type=checkbox]):not([type=hidden]):not([type=radio])');
}

// cajas del codigo 2FA: (a) 6 casillas maxlength=1 estilo antiguo, (b) 6 casillas
// type=text SIN maxlength estilo nuevo (Dropi 3.4.0: la primera lleva
// autocomplete=one-time-code y NINGUNA auto-avanza), (c) input unico, (d) generico
async function otpBoxes(page) {
  const m1 = page.locator('input[maxlength="1"]:visible');
  if ((await m1.count().catch(() => 0)) >= 4) return m1;
  const gen = page.locator('input[type=text]:visible');
  if ((await gen.count().catch(() => 0)) >= 4) return gen; // 6 casillas nuevas (v3.4.0)
  const ac = page.locator('input[autocomplete="one-time-code"]:visible');
  if ((await ac.count().catch(() => 0)) >= 1) return ac;
  return visibleOtpInputs(page);
}

// detecta si el navegador esta en la pantalla de clave dinamica (no importa si el
// formulario de usuario/clave sigue visible DETRAS del modal: por eso ya no se usa
// el conteo de inputs[type=password] como unica senal)
async function enPantalla2fa(page) {
  if ((await page.locator('input[maxlength="1"]:visible').count().catch(() => 0)) >= 4) return true;
  if ((await page.locator('input[autocomplete="one-time-code"]:visible').count().catch(() => 0)) >= 1) return true;
  try {
    // estilo nuevo (v3.4.0): 4+ casillas de texto + titulo del modal presente
    if ((await page.locator('input[type=text]:visible').count().catch(() => 0)) >= 4) {
      const t = await page.locator('body').innerText();
      if (/autenticaci[oó]n de dos factores|clave din[aá]mica|c[oó]digo de verificaci[oó]n/i.test(t)) return true;
    }
  } catch (e) {}
  try {
    const t = await page.locator('body').innerText();
    return /autenticaci[oó]n de dos factores|clave din[aá]mica|c[oó]digo de verificaci[oó]n/i.test(t)
      && (await visibleOtpInputs(page).count()) >= 1;
  } catch (e) { return false; }
}

// ingresa el codigo en la pantalla de clave dinamica. Con 6+ casillas llena UN
// DIGITO POR CASILLA (fill individual: sirve tanto si auto-avanzan como si no;
// desde Dropi 3.4.0 ya NO auto-avanzan y el tipeo en cascada dejaba solo 1 digito)
async function tipOtp(page, code, cascada) {
  const ins = await otpBoxes(page);
  const n = await ins.count();
  if (n >= 6) {
    for (let i = 0; i < Math.min(6, n); i++) await ins.nth(i).fill(code[i]);
  } else if (n >= 2) {
    for (let i = 0; i < Math.min(n, code.length); i++) await ins.nth(i).fill(code[i]);
  } else if (n === 1) {
    await ins.first().fill(code);
  } else {
    await page.keyboard.type(code, { delay: 150 }); // foco ya puesto por el sitio
  }
  await page.keyboard.press('Enter').catch(() => {});
  const btn = page.locator('button:visible').filter({ hasText: /verificar|validar|confirmar|continuar|verify|confirm|submit/i });
  if (await btn.count().catch(() => 0)) await btn.first().click({ timeout: 3000 }).catch(() => {});
}

async function doLogin(ctx) {
  const page = await pageOf(ctx);
  const deadline = Date.now() + TWOFA_TIMEOUT_MS;
  console.log('Abriendo login de Dropi...');
  doLogin._avisoManual = false;
  // PASO 1: usuario + clave (con reintentos: la SPA a veces tarda en renderizar)
  for (let intento = 1; intento <= 4 && Date.now() < deadline; intento++) {
    await page.goto('https://app.dropi.co/auth/login', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    if (await loggedIn(page)) { console.log('LOGIN OK - la sesion ya estaba vigente'); return; }
    try {
      // selectores REALES del formulario (correo/password), no posicion de inputs
      const user = page.locator('input#email:visible, input[type=email]:visible').first();
      const pass = page.locator('input#password:visible, input[type=password]:visible').first();
      await user.waitFor({ state: 'visible', timeout: 60000 });
      await user.fill(CREDS.user);
      await pass.waitFor({ state: 'visible', timeout: 20000 });
      await pass.fill(CREDS.pass);
      const okU = (await user.inputValue().catch(() => '')) === CREDS.user;
      const okP = (await pass.inputValue().catch(() => '')) === CREDS.pass;
      if (!okU || !okP) throw new Error('los campos no aceptaron el texto');
      const submit = page.locator('button[type=submit]:visible').first();
      if (await submit.count().catch(() => 0)) await submit.click({ timeout: 10000 });
      else await pass.press('Enter'); // respaldo si el boton cambia de forma
      console.log('Credenciales registradas (usuario y clave) - esperando la pantalla de la clave dinamica...');
      break;
    } catch (e) {
      console.log(`   intento ${intento} de llenar credenciales fallo (${String(e.message).split('\n')[0]}) - reintento...`);
      if (intento === 4) console.log('   No se pudo llenar el formulario solo: tipa usuario/clave a mano si hace falta.');
      await page.waitForTimeout(5000);
    }
  }
  // PASO 2: clave dinamica
  if (TOTP_SECRET) {
    console.log('>>> 2FA AUTOMATICO: la clave dinamica se calcula y se ingresa sola <<<');
  } else {
    console.log('\n==========================================================');
    console.log('>>> TIPA EL CODIGO DE GOOGLE AUTHENTICATOR EN LA VENTANA DEL NAVEGADOR <<<');
    console.log(`>>> La ventana NO se cierra sola: tienes ${Math.round(TWOFA_TIMEOUT_MS / 60000)} minutos. <<<`);
    console.log('>>> Si el codigo falla o vence, tipa el nuevo: se sigue verificando. <<<');
    console.log('==========================================================\n');
  }
  let otpHechos = 0, credExtra = 0, ultimoMs = 0;
  const submitMs = Date.now();
  for (;;) {
    if (await loggedIn(page)) break;
    if (Date.now() > deadline) {
      throw new Error(`Login no completado en ${Math.round(TWOFA_TIMEOUT_MS / 60000)} min. La ventana sigue abierta: tipa el codigo o vuelve a correr --login.`);
    }
    if (TOTP_SECRET) {
      const en2fa = await enPantalla2fa(page);
      const enCredenciales = !en2fa && (await page.locator('input[type=password]:visible').count().catch(() => 0)) > 0;
      if (enCredenciales && Date.now() - submitMs > 15000 && credExtra < 2) {
        // el sitio volvio a pedir usuario/clave (p.ej. vencio el paso anterior) - reenviar
        credExtra++;
        try {
          const user = page.locator('input#email:visible, input[type=email]:visible').first();
          const pass = page.locator('input#password:visible, input[type=password]:visible').first();
          await user.fill(CREDS.user);
          await pass.fill(CREDS.pass);
          const submit = page.locator('button[type=submit]:visible').first();
          if (await submit.count().catch(() => 0)) await submit.click({ timeout: 10000 });
          else await pass.press('Enter');
          console.log(`   credenciales reenviadas (intento ${credExtra})...`);
        } catch (e) {}
      } else if (en2fa && otpHechos < 4 && Date.now() - ultimoMs > 32000) {
        // reintenta con un codigo nuevo cada ventana de 30 s (max 4 intentos; si
        // el secreto es correcto el primero entra; los fallos suelen ser reloj)
        ultimoMs = Date.now();
        otpHechos++;
        try { await tipOtp(page, totpCode(TOTP_SECRET), otpHechos === 1); }
        catch (e) { console.log('   aviso OTP:', String(e.message).split('\n')[0]); }
      } else if (en2fa && otpHechos >= 4 && !doLogin._avisoManual) {
        doLogin._avisoManual = true;
        console.log('   4 intentos TOTP sin exito: la clave dinamica automatica no entro.');
        console.log('   Revisa que totp_secret corresponda a ESTA cuenta y que el reloj del PC este en hora.');
        console.log('   La ventana queda abierta y SIN interferencias: tipa el codigo de Google Authenticator a mano.');
      }
    } else {
      const restante = Math.ceil((deadline - Date.now()) / 60000);
      if (restante !== doLogin._lastMin) {
        doLogin._lastMin = restante;
        console.log(`   esperando el codigo 2FA... quedan ~${restante} min (tipalo en la ventana del navegador)`);
      }
    }
    await page.waitForTimeout(3000);
  }
  doLogin._lastMin = Infinity;
  await page.waitForTimeout(4000);
  console.log('LOGIN OK - sesion persistida en auth/profile (~12h)');
}

function parsePages(pages) {
  const map = new Map();
  for (const t of pages) {
    try {
      const j = JSON.parse(t);
      if (!j.objects) continue;
      for (const o of j.objects) {
        if (map.has(o.id)) continue;
        let stock = 0;
        if (o.type === 'SIMPLE') { if (o.warehouse_product) for (const w of o.warehouse_product) stock += w.stock; }
        else if (o.variations) for (const v of o.variations) stock += v.stock;
        map.set(o.id, {
          id: o.id, sku: o.sku, name: o.name, type: o.type, sale_price: o.sale_price, suggested_price: o.suggested_price, stock,
          imagenes: extractImages(o), // fotos del producto (regla dura R1 de KACHE)
          supplier_id: o.user ? o.user.id : null,
          supplier: o.user ? (o.user.store_name || o.user.name) : null,
          categories: (o.categories || []).map(c => c.name).join('; '),
          warehouses: (o.warehouse_product || []).map(w => ({ id: w.warehouse_id, stock: w.stock }))
        });
      }
    } catch (e) {}
  }
  return [...map.values()];
}

// Extrae las URLs de foto de un producto BFF de forma tolerante. Las fotos viven
// en gallery[i].urlS3 con ruta S3 RELATIVA (colombia/products/...); tambien soporta
// campos absolutos (urlImage/image/...) y codifica espacios a %20 para URLs validas.
function extractImages(o) {
  const out = [];
  const abs = u => {
    u = (u || '').trim();
    if (!u) return null;
    if (/^https?:\/\//i.test(u)) return u.replace(/ /g, '%20');
    if (/^(colombia|mexico)\//i.test(u)) return ('https://dropi.s3.amazonaws.com/' + u).replace(/ /g, '%20');
    return null;
  };
  const push = v => {
    if (!v) return;
    if (typeof v === 'string') { const a = abs(v); if (a) out.push(a); }
    else if (Array.isArray(v)) v.forEach(push);
    else if (typeof v === 'object') push(v.url || v.urlImage || v.url_image || v.urlS3 || v.path || v.src || v.file);
  };
  push(o.urlImage); push(o.url_image); push(o.image); push(o.photo);
  push(o.images); push(o.multimedia); push(o.gallery); push(o.photos);
  return [...new Set(out)].slice(0, 6);
}

// ---- cosecha por proveedor (tecnica de intercepcion probada) ----
async function harvestSupplier(ctx, supId, slug, maxPages = 40) {
  const page = await ctx.newPage();
  let pageNo = 0; const pages = []; let empty = false; let sessionDead = false; let authErr = 0;
  await page.route('**/products/v4/index', async route => {
    try {
      const d = JSON.parse(route.request().postData() || '{}');
      d.supplier_id = supId; d.pageSize = 100; d.startData = pageNo * 100;
      d.no_count = false; d.order_by = 'id'; d.order_type = 'asc';
      await route.continue({ postData: JSON.stringify(d) });
      pageNo++;
    } catch (e) { await route.continue(); }
  });
  page.on('response', async r => {
    if (r.url().includes('products/v4/index')) {
      if (r.status() === 401 || r.status() === 403) { authErr++; return; } // puede ser transitorio: no abortar por UNO
      authErr = 0;
      const t = await r.text().catch(() => 'err');
      pages.push(t);
      try { const j = JSON.parse(t); if (!j.objects || !j.objects.length) empty = true; } catch (e) {}
    }
  });
  await page.goto(`https://app.dropi.co/dashboard/provider/${supId}/${slug}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  if (page.url().includes('/auth/login')) sessionDead = true;
  for (let i = 0; i < maxPages && !empty && !sessionDead; i++) {
    if (i >= 2 && pages.length === 0) break; // 3 cargas sin UNA respuesta = pagina rota / slug malo / sesion muerta: no insistir 40 veces
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(3000);
    if (page.url().includes('/auth/login')) { sessionDead = true; break; }
    // chequeo de token SOLO como confirmacion (nunca por una carrera de evaluate):
    // - con 401/403 previo: si el token de verdad ya no es valido
    // - sin ninguna respuesta: si ademas el token no es valido (nada vino y no hay sesion)
    if ((authErr > 0 || pages.length === 0) && !(await loggedIn(page))) { sessionDead = true; break; }
  }
  await page.close().catch(() => {});
  return { products: parsePages(pages), empty, sessionDead };
}

async function snapshotSupplier(ctx, t, force) {
  const dir = SUP_DIR(t.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, today + '.json');
  if (!force && fs.existsSync(file)) { console.log(`SKIP ${t.nombre} (${today} ya capturado)`); return { ok: true, sessionDead: false }; }
  const slug = t.slug || (t.nombre || 'p').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  console.log(`== ${t.nombre} (id ${t.id}) ==`);
  let res = { products: [], empty: false, sessionDead: false };
  for (let attempt = 1; attempt <= 3; attempt++) {
    res = await harvestSupplier(ctx, t.id, slug);
    console.log(`   intento ${attempt}: ${res.products.length} productos (completo: ${res.empty}${res.sessionDead ? ', sesion dudosa' : ''})`);
    if (res.sessionDead && res.products.length === 0) { console.log(`   SESION EXPIRADA durante la extraccion`); return { ok: false, sessionDead: true }; }
    if (res.products.length > 0) break; // si capturo algo, se guarda aunque la sesion haya quedado dudosa
    await new Promise(r => setTimeout(r, 15000));
  }
  if (res.products.length === 0) { console.log(`   FALLO ${t.nombre}`); return { ok: false, sessionDead: false }; }
  fs.writeFileSync(file, JSON.stringify(res.products, null, 1));
  console.log(`   OK -> ${file} (${res.products.length} productos)`);
  return { ok: true, sessionDead: res.sessionDead };
}

// ---- refresco de config: re-mide metricas BFF del universo y reconstruye la lista ----
async function refreshConfig(ctx, capActivos) {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://app.dropi.co/dashboard/home', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const tok = 'Bearer ' + (await readLoginToken(page) || '');
  const H = { accept: 'application/json, text/plain, */*', authorization: tok, 'x-authorization': tok, 'x-host': 'co' };
  const uniPath = path.join(ROOT, 'data', 'universe-suppliers.json');
  if (!fs.existsSync(uniPath)) throw new Error('Falta data/universe-suppliers.json');
  const universe = JSON.parse(fs.readFileSync(uniPath, 'utf8').replace(/^\uFEFF/, ''));
  console.log('Universo:', universe.length, 'proveedores. Midiendo metricas BFF...');

  const fetchOne = async (id) => {
    try {
      const r = await fetch('https://api-v2.dropi.co/bff/indicators/supplier/' + id + '/metrics', { headers: H });
      const j = await r.json();
      return (j && j.data) ? (j.data.total_monthly_orders || 0) : 0;
    } catch (e) { return -1; }
  };
  const ids = universe.map(s => String(s.id));
  const metrics = {};
  const BATCH = 12;
  for (let i = 0; i < ids.length; i += BATCH) {
    await Promise.all(ids.slice(i, i + BATCH).map(async id => { metrics[id] = await fetchOne(id); }));
    await new Promise(r => setTimeout(r, 100));
    if ((i / BATCH) % 25 === 0) console.log('   progreso:', Math.min(i + BATCH, ids.length), '/', ids.length);
  }
  let failed = ids.filter(id => metrics[id] === -1);
  for (const id of failed) { metrics[id] = await fetchOne(id); await new Promise(r => setTimeout(r, 120)); }
  failed = ids.filter(id => metrics[id] === -1);
  console.log('   metricas OK. errores:', failed.length);
  // GOLDBOX (privado, fuera del universo)
  metrics['205895'] = await fetchOne('205895');
  fs.writeFileSync(path.join(ROOT, 'data', 'universe-metrics-' + today + '.json'), JSON.stringify(metrics));

  // construir filas
  const rows = [];
  for (const s of universe) {
    const id = String(s.id);
    const nombre = (s.store_name && s.store_name !== 'null') ? s.store_name : (s.name || ('ID ' + id));
    const cities = [...new Set((s.warehouses || []).map(w => w.city && w.city.name).filter(Boolean))].join(', ');
    rows.push({
      id: s.id, nombre, ciudad: cities,
      pedidos_mes: Math.max(0, metrics[id] || 0),
      num_productos: s.products_count || 0,
      slug: String(s.name || nombre || 'p').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    });
  }
  // proveedores con historial de snapshots (mantener continuidad de datos)
  const histIds = new Set();
  const supRoot = path.join(ROOT, 'data', 'suppliers');
  if (fs.existsSync(supRoot)) for (const d of fs.readdirSync(supRoot)) histIds.add(d);

  // seleccion: activos + top12 catalogos grandes + historial + GOLDBOX
  const activeSorted = rows.filter(r => r.pedidos_mes > 0).sort((a, b) => b.pedidos_mes - a.pedidos_mes);
  if (capActivos > 0 && activeSorted.length > capActivos) {
    console.log('   cap activos: ' + activeSorted.length + ' -> ' + capActivos + ' (top por pedidos)');
    activeSorted.length = capActivos;
  }
  const active = activeSorted;
  const bigCats = rows.filter(r => r.pedidos_mes === 0 && r.num_productos >= 300)
    .sort((a, b) => b.num_productos - a.num_productos).slice(0, 12);
  const hist = rows.filter(r => histIds.has(String(r.id)) && r.pedidos_mes === 0 && !bigCats.includes(r));
  const goldbox = { id: 205895, nombre: 'GOLDBOX', ciudad: 'BOGOTA', pedidos_mes: Math.max(0, metrics['205895'] || 0), num_productos: 237, slug: 'goldbox' };

  const seen = new Set(); const sel = [];
  for (const r of [...active, ...bigCats, ...hist, goldbox]) {
    if (!seen.has(String(r.id))) { seen.add(String(r.id)); sel.push(r); }
  }
  sel.sort((a, b) => b.pedidos_mes - a.pedidos_mes);

  // comparar con config anterior y respaldar
  const cfgPath = path.join(ROOT, 'config', 'suppliers.json');
  const oldIds = new Set(CFG.proveedores.map(p => String(p.id)));
  const nuevos = sel.filter(r => !oldIds.has(String(r.id)));
  const fuera = CFG.proveedores.filter(p => !seen.has(String(p.id)));
  if (fs.existsSync(cfgPath)) fs.copyFileSync(cfgPath, path.join(ROOT, 'config', 'suppliers.backup-' + today + '.json'));
  fs.writeFileSync(cfgPath, JSON.stringify({ proveedores: sel, actualizado: today, total: sel.length,
    criterio: 'activos (BFF>0) + top12 catalogos>=300 + historial + GOLDBOX' }, null, 2));

  console.log('');
  console.log('=== CONFIG ACTUALIZADA: ' + sel.length + ' proveedores ===');
  console.log('Activos: ' + active.length + ' | Catalogos grandes: ' + bigCats.length + ' | Por historial: ' + hist.length + ' | GOLDBOX: 1');
  if (nuevos.length) { console.log('NUEVOS (' + nuevos.length + '):'); nuevos.forEach(r => console.log('  + ' + r.nombre + ' (id ' + r.id + ') ' + r.pedidos_mes + ' ped/mes | ' + r.num_productos + ' prods')); }
  if (fuera.length) { console.log('FUERA (' + fuera.length + '):'); fuera.forEach(r => console.log('  - ' + r.nombre + ' (id ' + r.id + ')')); }
  if (!nuevos.length && !fuera.length) console.log('Sin cambios respecto a la config anterior.');
  return true;
}
async function getCategoryByName(ctx, catName) {
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    const tok = 'Bearer ' + (await readLoginToken(page) || '');
    const r = await fetch('https://api-v2.dropi.co/bff/product-hunts/categories', {
      headers: { accept: 'application/json, text/plain, */*', authorization: tok, 'x-authorization': tok, 'x-host': 'co' }
    });
    const j = JSON.parse(await r.text());
    const data = j.data || [];
    for (const c of data) { if (String(c.name || '').toLowerCase().includes(catName.toLowerCase())) return c.id; }
    console.log('   categorias BFF disponibles:', data.map(c => c.id + '=' + c.name).slice(0, 30).join(', '));
  } catch (e) { console.log('   aviso BFF categories:', e.message); }
  return null;
}

// ---- cosecha por categoria (ej. Jugueteria) ----
async function harvestCategory(ctx, catName) {
  const page = await ctx.newPage();
  const catId = await getCategoryByName(ctx, catName);
  console.log('   categoryId(' + catName + '):', catId);
  if (catId === null) { await page.close().catch(() => {}); return []; }
  const CANDIDATES = [
    d => { d.category = [catName]; },
    d => { d.category = [String(catId)]; },
    d => { d.categories = [catName]; },
    d => { d.category_id = catName; },
    d => { d.categoria = [catName]; }
  ];
  let candIdx = 0; let pageNo = 0; const pages = []; let empty = false; let consecEmpty = 0;
  await page.route('**/products/v4/index', async route => {
    try {
      const d = JSON.parse(route.request().postData() || '{}');
      delete d.category; delete d.categories; delete d.category_id; delete d.category_ids; delete d.categoria;
      CANDIDATES[Math.min(candIdx, CANDIDATES.length - 1)](d);
      d.pageSize = 100; d.startData = pageNo * 100; d.no_count = false; d.order_by = 'id'; d.order_type = 'asc';
      await route.continue({ postData: JSON.stringify(d) });
      pageNo++;
    } catch (e) { await route.continue(); }
  });
  page.on('response', async r => {
    if (r.url().includes('products/v4/index')) {
      const t = await r.text().catch(() => 'err');
      pages.push(t);
      try {
        const j = JSON.parse(t);
        if (!j.objects || !j.objects.length) {
          if (pageNo > 0) pageNo--;            // reintentar la misma pagina en el siguiente click
          consecEmpty++;
          if (consecEmpty >= 2) empty = true;   // dos vacias seguidas = fin real
        } else { consecEmpty = 0; }
      } catch (e) {}
    }
  });
  await page.goto('https://app.dropi.co/dashboard/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  // probar candidatos: pagina 0 debe traer >= 60% de productos de la categoria
  let filterOk = false;
  for (let probe = 0; probe < CANDIDATES.length && !filterOk; probe++) {
    candIdx = probe; pageNo = 0; pages.length = 0; empty = false;
    await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(4000);
    if (pages.length === 0) { await page.reload({ waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(4000); }
    try {
      const j0 = JSON.parse(pages[0] || '{}');
      const objs = j0.objects || [];
      const n = objs.filter(o => (o.categories || []).some(c => String(c.name || '').toLowerCase().includes(catName.toLowerCase()))).length;
      const ok = (j0.isSuccess !== false);
      console.log('   candidato #' + (probe + 1) + ': ' + n + '/' + objs.length + ' de la categoria | isSuccess: ' + j0.isSuccess + (j0.message ? ' | msg: ' + String(j0.message).substring(0, 70) : ''));
      if (objs.length === 0 && ok === true) { filterOk = true; empty = true; break; }   // categoria realmente vacia
      if (objs.length > 0 && n / objs.length >= 0.6) filterOk = true;
    } catch (e) {}
  }
  if (!filterOk) { console.log('   NINGUN candidato funciono'); await page.close().catch(() => {}); return []; }
  consecEmpty = 0; console.log('   filtro OK (candidato #' + (candIdx + 1) + '), paginando...');
  let stale = 0; const partialFile = path.join(ROOT, 'data', 'categories', catName.toLowerCase().replace(/[^a-z0-9]/g, ''), today + '.json');
  for (let i = 0; i < 80 && !empty; i++) {
    const btn = page.getByText('Mostrar m', { exact: false }).first();
    const visible = await btn.isVisible().catch(() => false);
    if (!visible) {
      stale++;
      if (stale > 4 && stale % 5 === 0) { await page.reload({ waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(4000); }
      if (stale > 10) break;
      await page.waitForTimeout(1500);
      continue;
    }
    const before = pages.length;
    try { await btn.click(); } catch (e) { stale++; continue; }
    await page.waitForResponse(r => r.url().includes('products/v4/index'), { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (pages.length === before) { stale++; if (stale > 8) break; } else { stale = 0; }
    if (pages.length % 10 === 0) {
      console.log('   paginas capturadas:', pages.length);
      fs.mkdirSync(path.dirname(partialFile), { recursive: true });
      fs.writeFileSync(partialFile, JSON.stringify(parsePages(pages), null, 1));
    }
  }
  await page.close().catch(() => {});
  return parsePages(pages);
}

(async () => {
  // headed por defecto (tecnica probada y el 2FA manual necesita ventana visible);
  // --headless o DROPANALYTICS_HEADLESS=1 lo pone en segundo plano SOLO con totp_secret
  const pideHeadless = args.includes('--headless') || process.env.DROPANALYTICS_HEADLESS === '1';
  const QUIERE_HEADLESS = pideHeadless && !!TOTP_SECRET;
  if (pideHeadless && !QUIERE_HEADLESS) console.log('headless ignorado: sin totp_secret el 2FA manual necesita la ventana visible');
  const ctx = await launch(QUIERE_HEADLESS);
  try {
    if (mode === '--login') { await doLogin(ctx); }
    else if (mode === '--refresh-config') {
      await requireLogin(ctx);
      const capIdx = args.indexOf('--cap');
      const capActivos = capIdx > 0 ? parseInt(args[capIdx + 1]) || 0 : 0;
      await refreshConfig(ctx, capActivos);
    }
    else if (mode === '--check') {
      let ok = await ensureLogin(ctx);
      if (!ok && TOTP_SECRET) {
        console.log('Sesion expirada - relogin automatico con TOTP (no hace falta nadie en el teclado)...');
        try { await doLogin(ctx); ok = true; } catch (e) { console.error('Relogin automatico fallo:', e.message); }
      }
      console.log('LOGGED:', ok);
      if (!ok) { await ctx.close().catch(() => {}); process.exit(1); }
    }
    else if (mode === '--supplier') {
      await requireLogin(ctx);
      const id = parseInt(args[1]);
      const t = CFG.proveedores.find(s => s.id === id) || { id, nombre: 'ID ' + id, slug: 'p' };
      let r = await snapshotSupplier(ctx, t, args.includes('--force'));
      if (r.sessionDead) { await requireLogin(ctx); r = await snapshotSupplier(ctx, t, args.includes('--force')); }
      console.log(r.ok ? 'SNAPSHOT OK' : 'SNAPSHOT FALLO');
    }
    else if (mode === '--all') {
      await requireLogin(ctx);
      const cpFile = path.join(STATE, 'local-state.json');
      let done = {}; try { done = JSON.parse(fs.readFileSync(cpFile, 'utf8')).date === today ? JSON.parse(fs.readFileSync(cpFile, 'utf8')).done : {}; } catch (e) {}
      for (const t of CFG.proveedores) {
        if (done[t.id]) continue;
        let r = await snapshotSupplier(ctx, t, false);
        if (r.sessionDead) {
          console.log('Sesion expirada durante la extraccion - renovando login...');
          await requireLogin(ctx);
          r = await snapshotSupplier(ctx, t, false);
          if (r.sessionDead) { console.log('La sesion volvio a vencer: se detiene la corrida para no capturar vacios.'); break; }
        }
        if (r.ok) { done[t.id] = true; fs.mkdirSync(STATE, { recursive: true }); fs.writeFileSync(cpFile, JSON.stringify({ date: today, done })); }
      }
      console.log('RUN COMPLETO TERMINADO');
    }
    else if (mode === '--toys') {
      await requireLogin(ctx);
      console.log('Extrayendo catalogo de Jugueteria...');
      let prods = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        prods = await harvestCategory(ctx, 'Jugueteria');
        console.log(`   intento ${attempt}: ${prods.length} productos`);
        if (prods.length > 0) break;
        if (attempt < 3) await new Promise(r => setTimeout(r, 15000));
      }
      if (prods.length === 0) { console.error('JUGUETES: captura vacia — NO se escribe archivo (correr de nuevo)'); process.exit(1); }
      const dir = path.join(ROOT, 'data', 'categories', 'jugueteria');
      fs.mkdirSync(dir, { recursive: true });
      let file = path.join(dir, today + '.json');
      if (fs.existsSync(file)) {
        const hm = new Date().toISOString().substring(11, 16).replace(':', '');
        file = path.join(dir, today + '-' + hm + '.json');
      }
      fs.writeFileSync(file, JSON.stringify(prods, null, 1));
      console.log(`JUGUETES: ${prods.length} productos -> ${path.relative(ROOT, file)}`);
    }
    else { console.log('Modo desconocido:', mode); }
  } finally {
    await ctx.close();
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

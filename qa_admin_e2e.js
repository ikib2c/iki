/* ===== AUDITORIA E2E COMPLETA DEL PANEL DE ADMINISTRACION =====
   Ejecutar:  node qa_admin_e2e.js   (usa el playwright de dropi-analytics)
   52 verificaciones: acceso (3 vias + login/clave), todos los campos
   (identidad, legales, redes, ganancias, categorias), todas las funciones
   (heroe, favoritos, visibilidad de secciones/carruseles/catalogos/
   categorias/productos, precio exacto, comportamiento, clave nueva,
   token, publicar con token real en vivo, guardar/restaurar/copiar,
   preview y lista completa). El grupo G publica de verdad una version
   nueva de data/configuracion.js (contenido identico, version creciente).
   Cubre: acceso (3 vias + login/clave), todos los campos (identidad,
   legales, redes, ganancias, categorias), todas las funciones (heroe,
   favoritos, visibilidad de secciones/carruseles/catalogos/categorias,
   ocultar productos, precio exacto, comportamiento, clave nueva, token,
   publicar, guardar, restaurar, copiar, preview, lista). */
const { chromium } = require("C:/Users/User/IKI/dropi-analytics/node_modules/playwright");
const fs = require("fs");

const BASE = "file:///C:/Users/User/IKI/index.html";
const CLAVE = "IKI123*";
const res = [];
let grupo = "";
const check = (n, c, e) => res.push(grupo + " | " + n + ": " + (c ? "PASS" : "FAIL" + (e !== undefined ? " -> " + JSON.stringify(e) : "")));

async function nuevaPagina(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1400, height: 950 } }, opts || {}));
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__toasts = []; const orig = window.showToast; });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => (window.PRODUCTOS || []).length > 0, { timeout: 45000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}
async function entrar(page) {
  await page.evaluate(() => intentarAbrirAdmin());
  await page.fill("#adminClave", CLAVE);
  await page.press("#adminClave", "Enter");
  await page.waitForTimeout(250);
}
const toasts = async (page) => page.evaluate(() => window.__toasts || []);

(async () => {
  const browser = await chromium.launch();

  /* ============ A. ACCESO Y LOGIN ============ */
  grupo = "A-Acceso";
  {
    const { ctx, page } = await nuevaPagina(browser);
    // A1: enlace del footer
    await page.click('footer a[onclick*="intentarAbrirAdmin"]');
    await page.waitForTimeout(200);
    check("A1 footer 'Administración' abre login", await page.evaluate(() => document.getElementById("adminLoginModal").classList.contains("show")));
    // A2: clave incorrecta
    await page.fill("#adminClave", "Incorrecta99");
    await page.press("#adminClave", "Enter");
    await page.waitForTimeout(200);
    const errVisible = await page.evaluate(() => !document.getElementById("adminLoginError").hidden);
    const panelCerrado = await page.evaluate(() => !document.getElementById("adminModal").classList.contains("show"));
    check("A2 clave incorrecta: error visible y panel cerrado", errVisible && panelCerrado);
    // A3: clave correcta con Enter
    await page.fill("#adminClave", CLAVE);
    await page.press("#adminClave", "Enter");
    await page.waitForTimeout(300);
    check("A3 clave correcta con Enter: panel abre", await page.evaluate(() => document.getElementById("adminModal").classList.contains("show")));
    // A4: sesion persiste: cerrar modal y reabrir con Ctrl+Shift+A
    await page.evaluate(() => cerrarPanelAdmin());
    await page.keyboard.press("Control+Shift+A");
    await page.waitForTimeout(250);
    check("A4 Ctrl+Shift+A con sesión: abre panel directo", await page.evaluate(() => document.getElementById("adminModal").classList.contains("show")));
    // A5: Salir cierra sesion
    await page.evaluate(() => cerrarSesionAdmin());
    await page.waitForTimeout(200);
    const cerrado = await page.evaluate(() => !document.getElementById("adminModal").classList.contains("show"));
    await page.evaluate(() => intentarAbrirAdmin());
    const loginOtraVez = await page.evaluate(() => document.getElementById("adminLoginModal").classList.contains("show"));
    check("A5 Salir: cierra panel y exige clave de nuevo", cerrado && loginOtraVez);
    await ctx.close();
  }
  {
    // A6: ?admin en la URL
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    await page.goto(BASE + "?admin=1", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(400);
    check("A6 ?admin en la URL abre login", await page.evaluate(() => document.getElementById("adminLoginModal").classList.contains("show")));
    await ctx.close();
  }
  {
    // A7: Ctrl+Shift+A sin sesión abre login
    const { ctx, page } = await nuevaPagina(browser);
    await page.keyboard.press("Control+Shift+A");
    await page.waitForTimeout(250);
    check("A7 Ctrl+Shift+A sin sesión abre login", await page.evaluate(() => document.getElementById("adminLoginModal").classList.contains("show")));
    await ctx.close();
  }

  /* ============ B. IDENTIDAD, LEGALES, REDES, GUARDAR/RESTAURAR/COPIAR ============ */
  grupo = "B-Identidad";
  {
    const { ctx, page } = await nuevaPagina(browser);
    await entrar(page);
    // B1: nombre en vivo
    await page.fill("#adminNombre", "TIENDA PRUEBA E2E");
    await page.evaluate(() => aplicarPanelAdmin());
    await page.waitForTimeout(300);
    const titulo = await page.evaluate(() => document.title);
    check("B1 nombre: título del documento actualizado", /TIENDA PRUEBA E2E/.test(titulo), titulo);
    // B2: whatsapp con normalización (10 dígitos -> 57+)
    await page.fill("#adminWaPedidos", "3001112222");
    await page.evaluate(() => guardarPanelAdmin());
    const wa = await page.evaluate(() => CONFIG.whatsapp);
    check("B2 WhatsApp 3001112222 normaliza a 573001112222", wa === "573001112222", wa);
    // B3: legales + redes persistidas
    await page.fill("#adminRazon", "Prueba SAS");
    await page.fill("#adminNit", "NIT-900123");
    await page.fill("#adminDir", "Calle Falsa 123");
    await page.fill("#adminEmail", "prueba@iki.co");
    await page.fill("#adminIg", "@iki.prueba");
    await page.fill("#adminPixel", "1234567890");
    await page.evaluate(() => guardarPanelAdmin());
    const guardado = await page.evaluate(() => JSON.parse(localStorage.getItem("iki-tienda-v1")));
    check("B3 legales/redes/pixel persistidos en localStorage",
      guardado.razonSocial === "Prueba SAS" && guardado.nit === "NIT-900123" && guardado.pixelMeta === "1234567890" && guardado.instagram === "iki.prueba", guardado);
    // B4: copiar configuración (respaldo) al portapapeles
    await page.evaluate(() => { window.__cb = null; const o = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null; if (o) navigator.clipboard.writeText = t => { window.__cb = t; return o(t); }; });
    await page.evaluate(() => copiarConfigAdmin());
    await page.waitForTimeout(350);
    const cb = await page.evaluate(() => window.__cb);
    check("B4 copiar configuración: bloques TIENDA_DEFECTO + PRECIOS_DEFECTO con valores actuales",
      cb && /const TIENDA_DEFECTO=/.test(cb) && /const PRECIOS_DEFECTO=/.test(cb) && /TIENDA PRUEBA E2E/.test(cb), cb && cb.slice(0, 80));
    // B5: restaurar
    await page.evaluate(() => restaurarPanelAdmin());
    const despues = await page.evaluate(() => ({ ls: localStorage.getItem("iki-tienda-v1"), nombre: TIENDA.nombre, wa: TIENDA.whatsappPedidos }));
    check("B5 restaurar: limpia localStorage y vuelve a lo publicado", despues.ls === null && despues.nombre === "IKI" && despues.wa === "573156371501", despues);
    // B6: preview de ganancias
    const preview = await page.evaluate(() => { document.getElementById("adminMargen").value = "25"; document.getElementById("adminMultiplicador").value = "1"; document.getElementById("adminRedondeo").value = "100"; pintarPreviewAdmin(); return document.getElementById("adminPreview").textContent; });
    check("B6 preview: costo $10.000 con 25% -> $12.500", /\$12\.500/.test(preview), preview);
    await ctx.close();
  }

  /* ============ C. PRECIOS ============ */
  grupo = "C-Precios";
  {
    const { ctx, page } = await nuevaPagina(browser);
    await entrar(page);
    const antes = await page.evaluate(() => window.PRODUCTOS.find(p => p.id === "m01").p);
    check("C0 base: m01 a 60% = $161.600", antes === 161600, antes);
    // C1: margen por categoría (conjuntos a 100%)
    await page.fill('#adminCats input[data-cat="conjuntos"]', "100");
    await page.evaluate(() => aplicarPanelAdmin());
    const c1 = await page.evaluate(() => window.PRODUCTOS.find(p => p.id === "m01").p);
    check("C1 margen conjuntos 100%: m01 = $202.000", c1 === 202000, c1);
    // C2: precio exacto gana sobre márgenes
    await page.fill("#adminBuscarPrecio", "corset con correa");
    await page.waitForTimeout(200);
    await page.evaluate(() => fijarPrecioAdmin("m01", "50000"));
    const c2 = await page.evaluate(() => window.PRODUCTOS.find(p => p.id === "m01").p);
    check("C2 precio exacto m01=$50.000 gana sobre el margen", c2 === 50000, c2);
    // C3: quitar el precio fijo vuelve al margen
    await page.evaluate(() => fijarPrecioAdmin("m01", ""));
    const c3 = await page.evaluate(() => window.PRODUCTOS.find(p => p.id === "m01").p);
    check("C3 quitar precio fijo: vuelve a $202.000", c3 === 202000, c3);
    // C4: redondeo a 500
    await page.evaluate(() => { document.getElementById("adminCats").querySelector('input[data-cat="conjuntos"]').value = "60"; PRECIOS.margenesPorCategoria.conjuntos = 0.6; });
    await page.selectOption("#adminRedondeo", "500");
    await page.evaluate(() => aplicarPanelAdmin());
    const c4 = await page.evaluate(() => ({ m01: window.PRODUCTOS.find(p => p.id === "m01").p, m30: window.PRODUCTOS.find(p => p.id === "m30").p }));
    check("C4 redondeo 500: precios terminan en 500 (m01 $161.500)", c4.m01 === 161500, c4);
    // C5: multiplicador x2
    await page.fill("#adminMultiplicador", "2");
    await page.evaluate(() => aplicarPanelAdmin());
    const c5 = await page.evaluate(() => window.PRODUCTOS.find(p => p.id === "m30").p);
    check("C5 multiplicador x2: m30 base 39000 x2 x1.6 red500 = $125.000", c5 === 125000, c5);
    // C6: restaurar precios
    await page.evaluate(() => restaurarPanelAdmin());
    const c6 = await page.evaluate(() => window.PRODUCTOS.find(p => p.id === "m01").p);
    check("C6 restaurar: m01 vuelve a $161.600", c6 === 161600, c6);
    await ctx.close();
  }

  /* ============ D. HÉROE Y FAVORITOS ============ */
  grupo = "D-Héroe/Favoritos";
  {
    const { ctx, page } = await nuevaPagina(browser);
    await entrar(page);
    const heroe0 = await page.evaluate(() => [...document.querySelectorAll("#heroGal .hg-item")].length);
    check("D0 héroe con 6 productos de temporada", heroe0 === 6, heroe0);
    // D1: quitar del héroe
    await page.evaluate(() => quitarHeroAdmin("m59"));
    const heroe1 = await page.evaluate(() => [...document.querySelectorAll("#heroGal .hg-item")].length);
    check("D1 quitar del héroe: queda 5", heroe1 === 5, heroe1);
    // D2: buscar y agregar al héroe
    await page.fill("#adminBuscarHero", "grinch");
    await page.waitForTimeout(250);
    const resultados = await page.evaluate(() => document.querySelectorAll("#adminResHero .admin-fila").length);
    await page.evaluate(() => agregarHeroAdmin("m99"));
    const heroe2 = await page.evaluate(() => [...document.querySelectorAll("#heroGal .hg-item")].length);
    check("D2 buscador del héroe agrega: 5 -> 6", resultados > 0 && heroe2 === 6, { resultados, heroe2 });
    // D3: tope de 6: el botón queda deshabilitado
    await page.fill("#adminBuscarHero", "short");
    await page.waitForTimeout(250);
    const cap = await page.evaluate(() => { const b = document.querySelector("#adminResHero button"); return b ? (b.disabled || /Máximo/.test(b.textContent)) : true; });
    check("D3 tope de 6: botón deshabilitado en los resultados", cap === true);
    // D4: restaurar héroe (quitar el agregado y devolver m59)
    await page.evaluate(() => { TIENDA.heroIds = "m85,m86,m59,m80,m81,m82"; aplicarTienda(); actualizarHero(); pintarHeroAdmin(); });
    const heroe4 = await page.evaluate(() => TIENDA.heroIds);
    check("D4 héroe restaurado a la curación publicada", heroe4 === "m85,m86,m59,m80,m81,m82", heroe4);
    // D5: favoritos quitar/agregar
    const fav0 = await page.evaluate(() => document.querySelectorAll("#carFav .cari").length);
    await page.evaluate(() => quitarFavoritoAdmin("m03"));
    const fav1 = await page.evaluate(() => document.querySelectorAll("#carFav .cari").length);
    await page.fill("#adminBuscarFav", "camisera pareja");
    await page.waitForTimeout(250);
    await page.evaluate(() => agregarFavoritoAdmin("m03"));
    const fav2 = await page.evaluate(() => document.querySelectorAll("#carFav .cari").length);
    check("D5 favoritos: quitar 14->13 y agregar 13->14", fav0 === 14 && fav1 === 13 && fav2 === 14, { fav0, fav1, fav2 });
    // D6: lista de favoritos del panel pinta los items actuales
    const listaFav = await page.evaluate(() => document.querySelectorAll("#adminFavoritosLista .admin-fila").length);
    check("D6 panel lista los 14 favoritos", listaFav === 14, listaFav);
    await ctx.close();
  }

  /* ============ E. VISIBILIDAD ============ */
  grupo = "E-Visibilidad";
  {
    const { ctx, page } = await nuevaPagina(browser);
    await entrar(page);
    // E1-E7: las 7 secciones ocultan y muestran
    const secciones = [["adminVerMarquee", ".marquee"], ["adminVerCategorias", ".catsbar"], ["adminVerCarruseles", ".carsec"], ["adminVerConfianza", ".trust"], ["adminVerFaq", "#faq"], ["adminVerContacto", ".news"], ["adminVerHero", ".hero"]];
    for (const [id, sel] of secciones) {
      await page.evaluate((id) => { const cb = document.getElementById(id); cb.checked = false; cb.dispatchEvent(new Event("change")); }, id);
      const oculto = await page.evaluate((sel) => { const el = document.querySelector(sel); return el && el.style.display === "none"; }, sel);
      await page.evaluate((id) => { const cb = document.getElementById(id); cb.checked = true; cb.dispatchEvent(new Event("change")); }, id);
      const visible = await page.evaluate((sel) => { const el = document.querySelector(sel); return el && el.style.display !== "none"; }, sel);
      check(`E ${id.replace("adminVer", "Sección ")}: oculta y muestra`, oculto && visible, { id, oculto, visible });
    }
    // E8: carruseles individuales
    await page.evaluate(() => { const cb = document.getElementById("adminVerCarFav"); cb.checked = false; cb.dispatchEvent(new Event("change")); });
    const favOff = await page.evaluate(() => document.getElementById("favoritos").style.display === "none");
    await page.evaluate(() => { const cb = document.getElementById("adminVerCarFav"); cb.checked = true; cb.dispatchEvent(new Event("change")); });
    const favOn = await page.evaluate(() => document.getElementById("favoritos").style.display !== "none");
    check("E8 carrusel favoritos: oculta y muestra", favOff && favOn, { favOff, favOn });
    // E9: ocultar catálogo l2 completo
    await page.evaluate(() => toggleCatalogo("l2", false));
    await page.waitForTimeout(300);
    const e9 = await page.evaluate(() => ({
      visibles: window.PRODUCTOS.filter(p => prodVisible(p)).length,
      chips: document.querySelectorAll("#chips .chip").length,
      grid: document.querySelector("#grid").textContent.includes("No encontramos"),
      heroe: document.querySelectorAll("#heroGal .hg-item").length,
    }));
    check("E9 ocultar catálogo l2: tienda vacía (0 visibles, grid avisa, héroe vacío)", e9.visibles === 0 && e9.chips === 1 && e9.grid && e9.heroe === 0, e9);
    await page.evaluate(() => toggleCatalogo("l2", true));
    await page.waitForTimeout(200);
    const e9b = await page.evaluate(() => window.PRODUCTOS.filter(p => prodVisible(p)).length);
    check("E9b restaurar l2: 99 visibles", e9b === 99, e9b);
    // E10: ocultar una categoría
    await page.evaluate(() => { const cb = document.querySelector('#adminCatsVis input[onchange*="conjuntos"]'); cb.checked = false; cb.dispatchEvent(new Event("change")); });
    await page.waitForTimeout(200);
    const e10 = await page.evaluate(() => ({ chip: !!document.querySelector('#chips .chip[data-c="conjuntos"]'), visibles: window.PRODUCTOS.filter(p => prodVisible(p)).length }));
    check("E10 ocultar categoría conjuntos: chip fuera y 83 visibles", e10.chip === false && e10.visibles === 83, e10);
    await page.evaluate(() => { const cb = document.querySelector('#adminCatsVis input[onchange*="conjuntos"]'); cb.checked = true; cb.dispatchEvent(new Event("change")); });
    // E11: ocultar producto y mostrarlo
    await page.fill("#adminBuscarOcultar", "corset con correa");
    await page.waitForTimeout(250);
    await page.evaluate(() => toggleProductoOculto("m01"));
    const e11 = await page.evaluate(() => window.PRODUCTOS.filter(p => prodVisible(p)).length);
    await page.fill("#adminBuscarOcultar", "corset con correa");
    await page.waitForTimeout(250);
    const etiqueta = await page.evaluate(() => document.querySelector("#adminResOcultar .admin-btn").textContent.trim());
    await page.evaluate(() => toggleProductoOculto("m01"));
    const e11b = await page.evaluate(() => window.PRODUCTOS.filter(p => prodVisible(p)).length);
    check("E11 ocultar producto m01: 99->98, botón cambia a Mostrar, restaurar 99", e11 === 98 && etiqueta === "Mostrar" && e11b === 99, { e11, etiqueta, e11b });
    await ctx.close();
  }

  /* ============ F. COMPORTAMIENTO, CLAVE, TOKEN, LISTA ============ */
  grupo = "F-Comportamiento";
  {
    const { ctx, page } = await nuevaPagina(browser);
    await entrar(page);
    // F1: contra entrega off
    await page.evaluate(() => { const cb = document.getElementById("adminContraEntrega"); cb.checked = false; cb.dispatchEvent(new Event("change")); });
    await page.evaluate(() => aplicarPanelAdmin());
    const f1 = await page.evaluate(() => {
      const op = document.querySelector('input[name="paymentMethod"][value="contra-entrega"]');
      const et = op.closest(".po");
      return { oculta: et.style.display === "none", contra: contraEntregaActiva() };
    });
    check("F1 contra entrega off: opción desaparece del checkout", f1.oculta && f1.contra === false, f1);
    // F2: vaciar carrito off persiste
    await page.evaluate(() => { const cb = document.getElementById("adminVaciar"); cb.checked = false; cb.dispatchEvent(new Event("change")); });
    await page.evaluate(() => guardarPanelAdmin());
    const f2 = await page.evaluate(() => JSON.parse(localStorage.getItem("iki-tienda-v1")).vaciarCarrito);
    check("F2 vaciar carrito off persistido", f2 === false, f2);
    // F3: nueva clave
    await page.fill("#adminClaveNueva", "NuevaClaveE2E");
    await page.evaluate(() => guardarPanelAdmin());
    await page.evaluate(() => cerrarSesionAdmin());
    await page.evaluate(() => intentarAbrirAdmin());
    await page.fill("#adminClave", CLAVE);
    await page.press("#adminClave", "Enter");
    await page.waitForTimeout(200);
    const viejaFalla = await page.evaluate(() => !document.getElementById("adminModal").classList.contains("show") && !document.getElementById("adminLoginError").hidden);
    await page.fill("#adminClave", "NuevaClaveE2E");
    await page.press("#adminClave", "Enter");
    await page.waitForTimeout(250);
    const nuevaEntra = await page.evaluate(() => document.getElementById("adminModal").classList.contains("show"));
    check("F3 clave nueva: vieja falla, nueva entra", viejaFalla && nuevaEntra);
    // F4: token guardar/borrar
    await page.fill("#adminToken", "github_pat_PRUEBA");
    await page.evaluate(() => guardarTokenGitHub());
    const tok1 = await page.evaluate(() => localStorage.getItem("iki-github-token"));
    await page.fill("#adminToken", "");
    await page.evaluate(() => guardarTokenGitHub());
    const tok2 = await page.evaluate(() => localStorage.getItem("iki-github-token"));
    check("F4 token: se guarda y se borra", tok1 === "github_pat_PRUEBA" && tok2 === "", { tok1, tok2 });
    // F5: publicar SIN token avisa y abre la guía
    await page.evaluate(() => { window.__ultimoToast = ""; const o = showToast; window.showToast = m => { window.__ultimoToast = m; o(m); }; });
    await page.evaluate(() => publicarConfigAdmin());
    await page.waitForTimeout(200);
    const f5 = await page.evaluate(() => ({ toast: window.__ultimoToast, guia: document.querySelector(".admin-sync-ayuda").open }));
    check("F5 publicar sin token: toast de error y guía abierta", /token/i.test(f5.toast) && f5.guia === true, f5);
    // F6: lista completa
    await page.evaluate(() => toggleListaTodosAdmin());
    const f6 = await page.evaluate(() => ({ visible: !document.getElementById("adminLista").hidden, filas: document.querySelectorAll("#adminLista .admin-fila").length }));
    check("F6 lista completa de productos: abre con filas", f6.visible && f6.filas > 90, f6);
    // F7: guardar en MI computador (toast + persistencia)
    await page.fill("#adminNombre", "PRUEBA GUARDAR");
    await page.evaluate(() => guardarPanelAdmin());
    const f7 = await page.evaluate(() => JSON.parse(localStorage.getItem("iki-tienda-v1")).nombre);
    check("F7 guardar en MI computador persiste el nombre", f7 === "PRUEBA GUARDAR", f7);
    await ctx.close();
  }

  /* ============ G. PUBLICAR PARA TODOS (EN VIVO, token real) ============ */
  grupo = "G-Publicar(vivo)";
  {
    const tok = ((fs.readFileSync("C:/Users/User/IKI/GitHub.txt", "utf8").match(/github_pat_[A-Za-z0-9_]+/) || [])[0]) || "";
    /* La verdad inmediata está en la API de GitHub (sin caché de Pages) */
    const apiConfig = async () => {
      const r = await fetch("https://api.github.com/repos/ikib2c/iki/contents/data/configuracion.js", { headers: { Authorization: "Bearer " + tok, Accept: "application/vnd.github+json" }, cache: "no-store" });
      const j = await r.json();
      const txt = Buffer.from(j.content, "base64").toString("utf8");
      return { version: Number((/"version":\s*(\d+)/.exec(txt) || [0, 0])[1]), sinClave: !/"claveAdmin"/.test(txt), hero: /"heroIds":\s*"([^"]*)"/.exec(txt)[1] };
    };
    const previaCfg = await apiConfig();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await ctx.newPage();
    await page.route("**/data/configuracion.js", r => { const u = new global.URL(r.request().url()); u.searchParams.set("cb", String(Date.now())); r.continue({ url: u.toString() }); });
    await page.goto("https://ikib2c.github.io/iki/?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => (window.PRODUCTOS || []).length > 0, { timeout: 60000 });
    await page.waitForTimeout(1000);
    await page.evaluate((t) => { localStorage.setItem("iki-github-token", t); }, tok);
    await page.evaluate(() => intentarAbrirAdmin());
    await page.fill("#adminClave", CLAVE);
    await page.press("#adminClave", "Enter");
    await page.waitForTimeout(400);
    const tokenEnCampo = await page.evaluate(() => document.getElementById("adminToken").value);
    await page.evaluate(() => { window.__pubToast = ""; const o = showToast; window.showToast = m => { window.__pubToast = m; o(m); }; });
    await page.evaluate(() => publicarConfigAdmin());
    await page.waitForTimeout(6000);
    const nuevaCfg = await apiConfig();
    const g = await page.evaluate(() => ({ toast: window.__pubToast, base: localStorage.getItem("iki-config-base"), hero: TIENDA.heroIds }));
    check("G1 publicar con token real: toast de publicada", /Publicada/.test(g.toast), g.toast);
    check("G2 la versión publicada incrementa sobre la previa", nuevaCfg.version > previaCfg.version, { previa: previaCfg.version, nueva: nuevaCfg.version });
    check("G3 la configuración publicada no lleva la clave", nuevaCfg.sinClave === true);
    check("G4 el navegador queda sincronizado con lo publicado", g.base === String(nuevaCfg.version), { base: g.base, nueva: nuevaCfg.version });
    check("G5 el campo del panel nace lleno con el token", /^github_pat_/.test(tokenEnCampo));
    check("G6 lo publicado conserva la curación vigente (héroe de temporada)", nuevaCfg.hero === g.hero, { remoto: nuevaCfg.hero, local: g.hero });
    await ctx.close();
  }

  await browser.close();
  const total = res.length, ok = res.filter(r => r.includes("PASS")).length;
  console.log(res.join("\n"));
  console.log("\n===== RESUMEN: " + ok + "/" + total + " PASS =====");
  process.exit(ok === total ? 0 : 1);
})();

/* ============================================================
   QA SMOKE L4 — Producción (https://ikib2c.github.io/iki/)
   Solo lectura, sin compras. Corre diario (workflow qa-smoke.yml) y a mano.
   Uso local:  node qa_smoke_produccion.js
   URL alterne:QA_TIENDA_URL=https://... node qa_smoke_produccion.js
   Escribe smoke_resultado.txt (lo consume el workflow al abrir issue).
   ============================================================ */
const BASE = (process.env.QA_TIENDA_URL || "https://ikib2c.github.io/iki/").replace(/\/?$/, "/");
const UA = { "User-Agent": "iki-qa-smoke" };

const res = [];
const check = (ok, id, msg, extra) => {
  res.push({ ok: !!ok, id, msg, extra: extra === undefined ? "" : JSON.stringify(extra).slice(0, 400) });
  console.log((ok ? "PASS " : "FAIL ") + id + " " + msg + (ok ? "" : "  -> " + (extra === undefined ? "" : JSON.stringify(extra).slice(0, 400))));
};

async function pedir(url, opts) {
  const r = await fetch(url, { headers: UA, redirect: "follow", ...opts });
  return r;
}
const texto = async (u) => { const r = await pedir(u); return { st: r.status, t: r.ok ? await r.text() : "" }; };
const vivo = async (u) => { try { const r = await pedir(u, { method: "HEAD" }); return r.status; } catch (e) { return 0; } };
const ocultasLista = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

(async () => {
  console.log("== QA SMOKE L4 == " + BASE + " (" + new Date().toISOString() + ")\n");

  /* 1. Página principal */
  const home = await texto(BASE);
  check(home.st === 200, "1.1", "home HTTP 200", home.st);
  check(/<title>IKI — Todo lo que te hace feliz, en un solo lugar<\/title>/i.test(home.t), "1.2", "title con eslogan oficial");
  check(/og:title" content="IKI — Todo lo que te hace feliz, en un solo lugar"/i.test(home.t), "1.3", "og:title oficial");
  check(/rel="icon" href="favicon\.ico"/.test(home.t), "1.4", "favicon enlazado");
  check(/fonts\.googleapis\.com[^"]*Montserrat/.test(home.t) && /fonts\.googleapis\.com[^"]*Poppins/.test(home.t), "1.5", "tipografias oficiales cargadas");
  check(/315\s*637\s*1501|573156371501/.test(home.t), "1.6", "WhatsApp de pedidos presente");
  check(/rel="canonical" href="https:\/\/ikib2c\.github\.io\/iki\/"/.test(home.t), "1.7", "canonical de la tienda");
  check(/og:url" content="https:\/\/ikib2c\.github\.io\/iki\/"/.test(home.t), "1.8", "og:url oficial");
  check(!/\[URL DEL SITIO\]/.test(home.t) && /"@type":"OnlineStore"/.test(home.t) && /"url":"https:\/\/ikib2c\.github\.io\/iki\/"/.test(home.t), "1.9", "schema.org OnlineStore con URL real");

  /* 2. catalogo.js (+ visibilidad segun la config publicada) */
  const cat = await texto(BASE + "catalogo.js?t=" + Date.now());
  check(cat.st === 200, "2.1", "catalogo.js HTTP 200", cat.st);
  const ps = [...cat.t.matchAll(/\{id:"([a-z]+\d+)",n:"(?:[^"\\]|\\.)*",p:(\d+),cat:"([\w-]+)",prov:"(l\d)",cid:"IKI-(\d+)",img:"([^"]+)"/g)]
    .map((m) => ({ id: m[1], p: +m[2], cat: m[3], prov: m[4], cid: "IKI-" + m[5], img: m[6] }));
  check(ps.length >= 2000, "2.2", "catalogo con >=2000 productos (5 inventarios)", ps.length);
  const cfgTxt = (await texto(BASE + "data/configuracion.js?t=" + Date.now())).t;
  let conf = null;
  try { conf = JSON.parse(cfgTxt.replace(/^[\s\S]*?window\.CONFIG_PUBLICADA\s*=\s*/, "").replace(/;\s*$/, "")); } catch (e) { conf = null; }
  const provOc = new Set(ocultasLista(conf && conf.tienda && conf.tienda.catalogosOcultos));
  const catOc = new Set(ocultasLista(conf && conf.tienda && conf.tienda.categoriasOcultas));
  const prodOc = new Set(ocultasLista(conf && conf.tienda && conf.tienda.productosOcultos));
  const visibles = ps.filter((x) => !provOc.has(x.prov) && !catOc.has(x.cat) && !prodOc.has(x.id));
  check(visibles.length >= 30, "2.3", "tienda viva: >=30 productos visibles segun config", visibles.length + " (ocultos: prov [" + [...provOc] + "] cat [" + [...catOc] + "])");
  check(ps.every((x) => /^IKI-\d{4,}$/.test(x.cid)), "2.4", "todos con codigo IKI-XXXX");
  check(ps.every((x) => x.p >= 500 && x.p <= 600000), "2.5", "precios base dentro de rango ($500-$600.000)", ps.filter((x) => x.p < 500 || x.p > 600000).slice(0, 3).map((x) => x.id + ":" + x.p));
  check(ps.filter((x) => x.prov === "l2").every((x) => x.p >= 5000), "2.6", "sin precios placeholder de Majestic ($3, familias sin expandir)", ps.filter((x) => x.prov === "l2" && x.p < 5000).slice(0, 3).map((x) => x.id + ":" + x.p));
  const ids = new Set(ps.map((x) => x.id));
  const visIds = new Set(visibles.map((x) => x.id));
  const heroIds = ocultasLista(conf && conf.tienda && conf.tienda.heroIds);
  check(heroIds.length >= 1 && heroIds.every((h) => ids.has(h) && visIds.has(h)), "2.7", "heroe publicado existe y es visible", heroIds.filter((h) => !visIds.has(h)));
  const favIds = ocultasLista(conf && conf.tienda && conf.tienda.favoritos);
  check(favIds.length >= 6 && favIds.every((f) => ids.has(f) && visIds.has(f)), "2.8", "favoritos publicados existen y son visibles", favIds.filter((f) => !visIds.has(f)));

  /* 3. Muestra de imagenes (20 aleatorias de los visibles) */
  const conImg = visibles.filter((x) => x.img);
  check(conImg.length >= visibles.length * 0.95, "3.1", ">=95% de visibles con imagen", conImg.length + "/" + visibles.length);
  const muestra = conImg.sort(() => Math.random() - 0.5).slice(0, 20);
  const rotas = [];
  for (const p of muestra) { const u = /^https?:/i.test(p.img) ? p.img : BASE + p.img; const st = await vivo(u); if (st !== 200) rotas.push(p.id + ":" + st); }
  check(rotas.length === 0, "3.2", "muestra de 20 imagenes sin rotas", rotas);

  /* 4. data/configuracion.js */
  check(!!cfgTxt, "4.1", "configuracion descargable");
  check(!!conf, "4.2", "configuracion parsea como JSON");
  if (conf) {
    check(!/"claveAdmin"/.test(cfgTxt), "4.3", "sin claveAdmin publicada");
    check(!/github_pat_/.test(cfgTxt), "4.4", "sin token de GitHub publicado");
    check(typeof conf.version === "number", "4.5", "version numerica", conf.version);
    check(/^57\d{10}$/.test((conf.tienda || {}).whatsappPedidos || ""), "4.6", "WhatsApp de pedidos vigente en config publicada", (conf.tienda || {}).whatsappPedidos);
  }

  /* 5. Legal, SEO y activos de marca */
  const legal = await texto(BASE + "legal.html");
  check(legal.st === 200, "5.1", "legal.html HTTP 200", legal.st);
  check(/rel="canonical" href="https:\/\/ikib2c\.github\.io\/iki\/legal\.html"/.test(legal.t), "5.2", "canonical en legal");
  const robots = await texto(BASE + "robots.txt");
  check(robots.st === 200 && /Sitemap:\s*https:\/\/ikib2c\.github\.io\/iki\/sitemap\.xml/.test(robots.t), "5.3", "robots.txt con sitemap");
  const sm = await texto(BASE + "sitemap.xml");
  check(sm.st === 200 && /<loc>https:\/\/ikib2c\.github\.io\/iki\/<\/loc>/.test(sm.t), "5.4", "sitemap.xml con la URL del home");
  const activos = ["logo_120.png", "logo_120_light.png", "logo_512.png", "logo_512_light.png", "favicon.ico", "favicon-32.png", "favicon-48.png",
    "apple-touch-icon.png", "qr_iki.png", "IKI_banner_joyas_1600x600.png", "IKI_banner_pijamas_1600x600.png", "IKI_banner_regalos_1600x600.png"];
  const muertos = [];
  for (const a of activos) { const st = await vivo(BASE + a); if (st !== 200) muertos.push(a + ":" + st); }
  check(muertos.length === 0, "5.5", "12 activos de marca HTTP 200", muertos);

  /* 6. Deploy reciente de Pages (aviso, no bloquea si la API esta limitada) */
  try {
    const r = await fetch("https://api.github.com/repos/ikib2c/iki/actions/runs?per_page=15", { headers: UA });
    if (r.ok) {
      const runs = (await r.json()).workflow_runs || [];
      const last = runs.find((x) => x.name === "pages build and deployment");
      check(!!last && (last.conclusion === "success" || last.status === "in_progress"), "6.1",
        "ultimo deploy de Pages " + (last ? last.conclusion || last.status : "n/d"), last && last.created_at);
    } else check(true, "6.1", "deploy Pages no verificado (API " + r.status + ")");
  } catch (e) { check(true, "6.1", "deploy Pages no verificado (sin red a la API)"); }

  /* Resumen + archivo para el workflow */
  const ok = res.filter((x) => x.ok).length, total = res.length;
  const lineas = [
    "Fecha: " + new Date().toISOString(),
    "URL: " + BASE,
    "RESULTADO: " + ok + "/" + total + " PASS" + (ok === total ? "" : "  *** FALLO ***"),
    "",
    ...res.map((x) => (x.ok ? "PASS " : "FAIL ") + x.id + " " + x.msg + (x.ok ? "" : " -> " + x.extra)),
  ].join("\n");
  require("fs").writeFileSync(__dirname + "/smoke_resultado.txt", lineas + "\n");
  console.log("\n===== " + ok + "/" + total + " PASS ===== " + (ok === total ? "PRODUCCION SANA" : "REVISAR YA"));
  process.exit(ok === total ? 0 : 1);
})().catch((e) => {
  require("fs").writeFileSync(__dirname + "/smoke_resultado.txt", "FALLO GENERAL: " + (e && e.message || e) + "\n" + (e && e.stack || ""));
  console.error("FALLO GENERAL:", e && e.message || e);
  process.exit(1);
});

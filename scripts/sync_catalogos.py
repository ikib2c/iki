# -*- coding: utf-8 -*-
"""Sincroniza el catalogo de IKI desde los 5 proveedores y actualiza:
  - catalogo.js  : productos curados (con galerias y variantes) para la tienda
  - 5 Excel      : catalogos completos de cada proveedor (Gava, Majestic, Taiwan, Solobabys, OpenMind)

Fuentes (todas publicas):
  - Gava Joyeria          -> Shopify products.json + colecciones
  - Sublimados Majestic   -> Supabase REST (publishable key del bundle publico)
  - Jugueteria Taiwan     -> catalogo.js publico de su GitHub Pages (cron del proveedor)
  - Solobabys             -> Shopify products.json + colecciones
  - Open Mind             -> Shopify products.json (tiendasopenmind.com, ropa urbana)

Ejecutar:  python scripts/sync_catalogos.py   (sin argumentos; escribe en la raiz del repo)
Cron:      .github/workflows/sync-catalogos.yml (cada 6 horas + manual)
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import time
import html as htmlmod
import urllib.request
import urllib.error
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
PEQ = {"de", "del", "la", "el", "los", "las", "y", "con", "para", "en", "x", "por", "al", "un", "una"}

# ============================================================================
# Utilidades de red y texto
# ============================================================================

def get(url, headers=None, intentos=3):
    h = dict(UA)
    if headers:
        h.update(headers)
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", errors="replace")
        except Exception as e:
            if i == intentos - 1:
                print("  ! fallo", url[:90], str(e)[:90])
                return ""
            time.sleep(2)

def get_json(url, headers=None):
    txt = get(url, headers)
    return json.loads(txt) if txt else {}

def get_bin(url, intentos=3):
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers=dict(UA))
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:
            if i == intentos - 1:
                print("  ! fallo bin", url[:80], str(e)[:80])
                return None
            time.sleep(1.5)

def limpiar_nombre(s):
    s = re.sub(r"\s+", " ", (s or "")).strip()
    s = re.split(r"\s*\|\s*", s)[0].strip()
    s = re.sub(r"\s*Ref\.?\s*[\w\-]+", "", s, flags=re.I).strip()
    return s

def titulo(s):
    s = limpiar_nombre(s)
    out = []
    for w in s.split(" "):
        if any(c.islower() for c in w):
            out.append(w)
        elif w.lower() in PEQ:
            out.append(w.lower())
        else:
            out.append(w[0] + w[1:].lower())
    return " ".join(out)

def plano(s):
    s = re.sub(r"<[^>]+>", " ", htmlmod.unescape(s or ""))
    return re.sub(r"\s+", " ", s).strip()

def js_str(s):
    return json.dumps(s, ensure_ascii=False)

# ============================================================================
# 1. DESCARGAS
# ============================================================================

def descargar_gava():
    """Gava Joyeria: 897+ productos Shopify con colecciones."""
    prods = {}
    for page in range(1, 7):
        d = get_json("https://www.gavajoyeria.com/products.json?limit=250&page=%d" % page)
        ps = d.get("products") or []
        if not ps:
            break
        for p in ps:
            prods[p["handle"]] = p
    COLECCIONES = [
        ("filigrana-con-esmeralda-de-laboratorio-1", "Esmeralda de Laboratorio"),
        ("anillos", "Anillos"), ("silver-gold", "Aretes"), ("aretes-con-piedras", "Aretes con Piedras"),
        ("brazalete", "Brazalete"), ("cadena", "Cadena"), ("candongas", "Candongas"),
        ("coleccion-de-insectos", "Colección de Insectos"), ("coleccion-flores", "Colección Flores"),
        ("coleccion-piedra-jade", "Colección Piedra Jade"), ("choker", "Collares"),
        ("earcuff", "Earcuff"), ("filigrana", "Filigrana"), ("aretes", "Morralla de Esmeralda"),
        ("campana", "Pulsera Religiosas"), ("pulseras", "Pulseras"), ("topos", "Topos"),
    ]
    h2c = {}
    for handle, nombre in COLECCIONES:
        page = 1
        while True:
            d = get_json("https://www.gavajoyeria.com/collections/%s/products.json?limit=250&page=%d" % (handle, page))
            ps = d.get("products") or []
            if not ps:
                break
            for p in ps:
                h2c.setdefault(p["handle"], []).append(nombre)
            if len(ps) < 250:
                break
            page += 1
        time.sleep(0.2)
    return list(prods.values()), h2c

def descargar_majestic():
    """Sublimados Majestic (pijamasalmayor.com): Supabase REST con publishable key."""
    KEY = "sb_publishable_-6hv7O7DhudWC7NAW8izOw_PAc8hPre"
    SB = "https://dowbsbxvxjzjjhyqmyfr.supabase.co/rest/v1/productos"
    HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
    out, desde = [], 0
    while True:
        d = get_json(SB + "?select=*&tenant_id=eq.sublimados_majestic&order=created_at.desc&limit=1000&offset=%d" % desde, HDR)
        if not isinstance(d, list) or not d:
            break
        out.extend(d)
        if len(d) < 1000:
            break
        desde += 1000
    return out

def descargar_taiwan():
    """Jugueteria Taiwan: catalogo.js publico -> JSON via node (disponible en runners y local)."""
    js = get("https://jugueteriataiwanoficial.github.io/jugueteriataiwan/catalogo.js")
    if not js:
        return []
    tmp = os.path.join(RAIZ, "_taiwan_tmp.js")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(js)
    try:
        codigo = ("const fs=require('fs');let src=fs.readFileSync(%r,'utf8');"
                  "src=src.replace('const CATALOGO_BASE','globalThis.CATALOGO_BASE');"
                  "eval(src);"
                  "process.stdout.write(JSON.stringify(globalThis.CATALOGO_BASE||[]));") % tmp
        r = subprocess.run(["node", "-e", codigo], capture_output=True, text=True, timeout=120)
        return json.loads(r.stdout or "[]")
    except Exception as e:
        print("  ! taiwan:", str(e)[:120])
        return []
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

def descargar_solobabys():
    """Solobabys: Shopify products.json + colecciones."""
    prods = {}
    for page in range(1, 5):
        d = get_json("https://www.solobabys.com/products.json?limit=250&page=%d" % page)
        ps = d.get("products") or []
        if not ps:
            break
        for p in ps:
            prods[p["id"]] = p
    COLECCIONES = [
        ("recien-nacido", "Recién nacido"), ("ropa", "Ropa"), ("bacinillas", "Bacinillas"),
        ("aseo", "Aseo y cuidado"), ("teteros", "Teteros"), ("lactancia", "Lactancia"),
        ("alimentacion", "Alimentación"), ("cobijas-y-toallas", "Cobijas y toallas"),
        ("paseo-y-descanso", "Paseo y descanso"), ("panaleras", "Pañaleras"), ("juguetes", "Juguetes"),
        ("accesorios", "Accesorios"), ("combos", "Combos"), ("baby-shower", "Baby shower"),
        ("mas-vendidos", "Más vendidos"),
    ]
    h2c = {}
    for handle, nombre in COLECCIONES:
        page = 1
        while True:
            d = get_json("https://www.solobabys.com/collections/%s/products.json?limit=250&page=%d" % (handle, page))
            ps = d.get("products") or []
            if not ps:
                break
            for p in ps:
                h2c.setdefault(p["handle"], []).append(nombre)
            if len(ps) < 250:
                break
            page += 1
        time.sleep(0.2)
    return list(prods.values()), h2c

def descargar_openmind():
    """Open Mind (tiendasopenmind.com): Shopify products.json paginado (ropa urbana caleña)."""
    prods = {}
    for page in range(1, 12):
        d = get_json("https://tiendasopenmind.com/products.json?limit=250&page=%d" % page)
        ps = d.get("products") or []
        if not ps:
            break
        for p in ps:
            prods[p["id"]] = p
        time.sleep(0.2)
    return list(prods.values())

# ============================================================================
# 2. CURACION (seleccion para la tienda) + VARIANTES
# ============================================================================

def parse_tallas(s):
    if not s:
        return None
    s = str(s).strip()
    if s.lower() in ("unica", "única", "talla única", "unitalla"):
        return None
    partes = [x.strip() for x in s.split(",") if x.strip()]
    return partes if len(partes) > 1 else None

def parse_estampados(s):
    """'PIOLIN, GATO ROSA, MY MELODDY' -> ['Piolin', 'Gato Rosa', ...] (max 8, sin duplicados).
    Se descartan valores puramente numericos: en algunos productos el proveedor
    guarda referencias (ej. 1003558423) en lugar de nombres de estampado."""
    if not s:
        return None
    vistos, out = set(), []
    for x in str(s).split(","):
        x = titulo(x)
        if x and not x.isdigit() and any(c.isalpha() for c in x) and x.lower() not in vistos:
            vistos.add(x.lower())
            out.append(x)
    return out[:8] if len(out) > 1 else None

def opciones_shopify(p):
    """Grupos de variantes de un producto Shopify (ej. Color: Azul/Verde) de variantes DISPONIBLES.
    options puede venir como ["Color"] o como [{"name":"Color",...}]."""
    grupos = {}
    opts = p.get("options") or []
    nombres = []
    for o in opts:
        if isinstance(o, dict):
            n = o.get("name") or o.get("position")
            if n:
                nombres.append(str(n))
        elif o:
            nombres.append(str(o))
    for i, nombre_op in enumerate(nombres):
        if not nombre_op or nombre_op.lower() in ("title", "default title"):
            continue
        valores = []
        for v in p.get("variants") or []:
            if not v.get("available"):
                continue
            val = (v.get("option%d" % (i + 1)) or "").strip()
            if val and val.lower() not in ("default title",) and val not in valores:
                valores.append(val)
        if len(valores) > 1:
            grupos[nombre_op.title()] = valores
    return grupos or None

def curar_joyas_gava(prods, h2c):
    """TODOS los productos de Gava con imagen y precio valido, dedup por nombre.
    Ya no filtra por coleccion: carga el inventario completo y deduplica."""
    FIX = {"Dije e cruz con piedra Jade": "Dije de cruz con piedra Jade",
           "Aretes De Filigrana": "Aretes de Filigrana"}
    vistos, sel = set(), []
    for p in prods:
        if not p.get("images"):
            continue
        precio = float(p["variants"][0]["price"]) if p.get("variants") else 0
        if not (5000 <= precio <= 500000):
            continue
        nombre = re.sub(r"\s+", " ", p["title"]).strip()
        nombre = FIX.get(nombre, titulo(nombre))
        if not nombre or nombre.lower() in vistos:
            continue
        vistos.add(nombre.lower())
        imgs = ["https:" + im["src"] if im["src"].startswith("//") else im["src"]
                for im in p["images"][:4]]
        sel.append({"nombre": nombre, "precio": int(precio),
                    "imgs": imgs, "var": None,
                    "sku": (str(p["variants"][0].get("sku") or "").strip() or None) if p.get("variants") else None})
    sel.sort(key=lambda x: x["precio"])
    return sel


def curar_moda_majestic(items):
    """Curacion de Sublimados Majestic: precios 18k-110k, con tallas y
    estampados, y CLASIFICACION por nombre en categorias de tienda (la
    'categoria' del proveedor viene muy sucia: 'shortiras', 'familiar',
    'shorts' vs 'Short Dama', 'Sin categoria'...)."""
    GENERICOS = {"conjunto", "body", "shorts", "pijama pink", "pijama"}
    # Typos visibles al cliente: se corrigen aqui y la preservacion de ids
    # es tolerante (norm_clave) para no romper enlaces de pedidos viejos.
    FIXES = [("CORSERT", "CORSET"), ("BODDY", "BODY")]

    def nombre_limpio(nombre):
        n = re.sub(r"\s+", " ", (nombre or "")).strip().rstrip(".")
        for a, b in FIXES:
            n = n.replace(a, b)
        return n

    def clasificar_prenda(nombre):
        """Organiza el catalogo en 8 categorias de tienda a partir del
        nombre. Orden: temporada > ninos > pijamas/pareja > enterizos >
        conjuntos > interior > pantalones/trios > shorts > juanitas."""
        n = (nombre or "").upper()
        if re.search(r"NAVIDAD|NAVIDE|HALLOWEEN|GRINCH|SANTA\b", n):
            return "navidad"
        if re.search(r"NIÑO|NIÑA|NIÑOS|NIÑAS", n):
            return "ninos"
        if "PIJAMA" in n or "PAREJA" in n:
            return "pijamas"
        if "ENTERIZO" in n or "BATOLA" in n:
            return "enterizos"
        if re.search(r"CONJUNTO|CORSET|BODY|BLUSON|VESTIDO|CHAQUETA|EVILLA", n):
            return "conjuntos"
        if re.search(r"\bSET\b|LEVANTADORA", n):
            return "interior"
        if "PANTALON" in n or "CAPRI" in n or "TRIO" in n:
            return "pantalones"
        if "SHORT" in n or "BERMUDA" in n:
            return "shorts"
        if "JUANITA" in n:
            return "interior"
        return "moda"

    def candidato(p):
        if p.get("oculto"):
            return None
        precio = float(p.get("precio") or 0)
        if not (18000 <= precio <= 110000) or not p.get("imagen_url"):
            return None
        nombre = nombre_limpio(p.get("nombre"))
        if "(Copia)" in nombre or not nombre or limpiar_nombre(nombre).lower() in GENERICOS:
            return None
        return p

    def con_datos(p):
        nombre = nombre_limpio(p.get("nombre"))
        tallas = parse_tallas(p.get("tallas"))
        var = {}
        if tallas:
            var["Talla"] = tallas
        est = parse_estampados(p.get("estampados"))
        if est:
            var["Estampado"] = est
        extras = p.get("imagenes_extra")
        urls = []
        if isinstance(extras, list):
            urls = [x for x in extras if isinstance(x, str)]
        elif isinstance(extras, str) and extras.strip():
            try:
                j = json.loads(extras)
                urls = [x for x in j if isinstance(x, str)] if isinstance(j, list) else []
            except Exception:
                urls = []
        gal = []
        for u in urls:
            u = str(u).split("|")[0].strip()
            if u.startswith("http") and u != p["imagen_url"] and u not in gal:
                gal.append(u)
        ref = str(p.get("referencia") or "").strip()
        return {"nombre": titulo(nombre), "precio": int(float(p.get("precio") or 0)),
                "imgs": [p["imagen_url"]] + gal[:3],
                "cat": clasificar_prenda(nombre),
                "var": (var if var else None), "sku": (ref if ref else None)}

    # TODOS los validos (sin tope por categoria)
    elegidos = [con_datos(p) for p in (candidato(x) for x in items) if p]
    elegidos = [p for p in elegidos if p and len(p.get("nombre") or "") >= 6]
    elegidos.sort(key=lambda x: -x["precio"])
    return elegidos

ETIQ_TW = {"jugueteria": "Juguetería", "juego-de-mesa": "Juego de mesa", "burbujeros": "Burbujeros",
           "cacharro": "Cacharro", "piñateria": "Piñatería", "slime": "Slime", "cubo-rubik": "Cubo Rubik",
           "didactico": "Didáctico", "deporte": "Deporte", "termos": "Termos", "animales": "Animales",
           "colecciones": "Colecciones", "armatodo": "Armatodo", "escolar": "Escolar",
           "peluches": "Peluches", "hogar": "Hogar", "bebe": "Bebé"}

def curar_taiwan(base, categorias, lo, hi, n=None):
    """Seleccion alternada entre categorias con dedupe de nombres parecidos."""
    por_cat = {c: [] for c in categorias}
    for p in base:
        if p.get("category") not in por_cat:
            continue
        precio = p.get("price") or 0
        if not (lo <= precio <= hi):
            continue
        nombre = re.sub(r"\s+", " ", p.get("name") or "").strip()
        if not nombre or not p.get("image"):
            continue
        por_cat[p["category"]].append({"nombre": titulo(nombre), "precio": precio, "imgs": [p["image"]],
                                        "sku": (str(p.get("sku") or "").strip() or None)})
    sel, vistos = [], set()
    for c, lst in por_cat.items():
        for x in lst:
            if x["nombre"].lower() in vistos:
                continue
            vistos.add(x["nombre"].lower())
            sel.append(x)
    sel.sort(key=lambda x: x["precio"])
    for x in sel:
        x["var"] = None
    return sel

def curar_solobabys(prods, h2c):
    """Bebé: 12 (5k-160k, 2 por tipo) y Regalos: 4 combos disponibles."""
    def info(p):
        vs = p.get("variants") or []
        precios = [float(v["price"]) for v in vs if v.get("price")]
        antes = [float(v["compare_at_price"]) for v in vs if v.get("compare_at_price")]
        imgs = []
        for im in (p.get("images") or [])[:4]:
            s = im.get("src", "")
            if s.startswith("//"):
                s = "https:" + s
            if s and s not in imgs:
                imgs.append(s)
        return {"nombre": titulo(p["title"]),
                "precio": int(min(precios)) if precios else 0,
                "antes": int(max(antes)) if antes else None,
                "disp": any(v.get("available") for v in vs),
                "imgs": imgs, "var": opciones_shopify(p),
                "cols": h2c.get(p.get("handle"), []), "tipo": p.get("product_type") or ""}
    combos, bebes = [], []
    for p in prods:
        i = info(p)
        if not i["disp"] or not i["imgs"][0]:
            continue
        if "Combos" in i["cols"] and 30000 <= i["precio"] <= 200000:
            if not any(c["nombre"] == i["nombre"] for c in combos):
                combos.append(i)
        elif "Combos" not in i["cols"] and 5000 <= i["precio"] <= 500000:
            bebes.append(i)
    combos.sort(key=lambda x: -x["precio"])
    sel_b = sorted(bebes, key=lambda x: x["precio"])
    return sel_b, combos[:10]

def curar_urbana_openmind(prods):
    """Open Mind: TODOS los disponibles con precio real e imagen, dedup por nombre.
    Descarta agotados y placeholders a precio 0 (prendas por llegar)."""
    vistos, sel = set(), []
    for p in prods:
        vs = p.get("variants") or []
        if not any(v.get("available") for v in vs):
            continue
        precios = [float(v["price"]) for v in vs if v.get("available") and float(v.get("price") or 0) > 0]
        if not precios:
            continue
        nombre = re.sub(r"\s+", " ", p["title"]).strip()
        if not nombre or not p.get("images") or nombre.lower() in vistos:
            continue
        vistos.add(nombre.lower())
        imgs = []
        for im in p["images"][:4]:
            s = im.get("src", "")
            if s.startswith("//"):
                s = "https:" + s
            if s and s not in imgs:
                imgs.append(s)
        if not imgs:
            continue
        sel.append({"nombre": titulo(nombre), "precio": int(min(precios)),
                    "imgs": imgs, "var": opciones_shopify(p),
                    "sku": (str(vs[0].get("sku") or "").strip() or None)})
    sel.sort(key=lambda x: x["precio"])
    return sel

# ============================================================================
# 3. ESCRITURA: catalogo.js y Excel
# ============================================================================

def norm_clave(nombre):
    """Clave de preservacion de ids/cids TOLERANTE a correcciones de
    nombre: los typos corregidos (Corsert->Corset, Boddy->Body) mantienen
    su id y su Cat permanente, asi los enlaces de pedidos viejos (?art=)
    y la curacion del heroe/favoritos no se rompen."""
    n = (nombre or "").lower()
    for a, b in (("corsert", "corset"), ("boddy", "body")):
        n = n.replace(a, b)
    return n


def escribir_catalogo_js(secciones):
    """secciones: [(prefijo, categoria, proveedor, [productos])] -> catalogo.js con ids ESTABLES.
    Los ids se reutilizan del catalogo.js anterior (clave: prefijo + nombre
    normalizado en minusculas), asi el heroe, los favoritos y los precios
    fijos del admin no se rompen cuando cambian precios, el orden o se
    corrigen typos del proveedor. Respeta la categoria POR PRODUCTO cuando
    la curacion la trae (clasificacion de Majestic)."""
    previos = {}
    usados = {}
    previos_cid = {}
    usados_cid = set()
    try:
        with open(os.path.join(RAIZ, "catalogo.js"), encoding="utf-8") as f:
            texto_previo = f.read()
            for mm in re.finditer(r'\{id:"([a-z]+)(\d+)",n:"((?:[^"\\]|\\.)*)"', texto_previo):
                previos[(mm.group(1), norm_clave(mm.group(3)))] = int(mm.group(2))
                usados.setdefault(mm.group(1), set()).add(int(mm.group(2)))
            for mm in re.finditer(r'cid:"IKI-(\d+)"', texto_previo):
                usados_cid.add(int(mm.group(1)))
            for mm in re.finditer(r'\{id:"([a-z]+)\d+",n:"((?:[^"\\]|\\.)*)"[^}]*?cid:"IKI-(\d+)"', texto_previo):
                previos_cid[(mm.group(1), norm_clave(mm.group(2)))] = int(mm.group(3))
    except Exception:
        pass

    def num_libre(prefijo):
        s = usados.setdefault(prefijo, set())
        n = 1
        while n in s:
            n += 1
        s.add(n)
        return n

    def cid_libre():
        n = 1
        while n in usados_cid:
            n += 1
        usados_cid.add(n)
        return n

    lineas = []
    lineas.append("// ======================================================================")
    lineas.append("// catalogo.js de IKI - generado automaticamente por scripts/sync_catalogos.py")
    lineas.append("// (%s). NO editar a mano: el cron de GitHub Actions lo regenera." % time.strftime("%Y-%m-%d %H:%M"))
    lineas.append("// Fuentes: inventario propio de la marca (gestión interna de IKI)")
    lineas.append("// ======================================================================")
    lineas.append("const CATALOGO_IKI=[")
    total = 0
    for prefijo, cat, prov, items in secciones:
        lineas.append("/* %s: %d productos */" % (cat, len(items)))
        claves = set()
        claves_cid = set()
        for p in items:
            clave = (prefijo, norm_clave(p["nombre"]))
            if clave in previos and clave not in claves:
                num = previos[clave]
            else:
                num = num_libre(prefijo)
            claves.add(clave)
            if clave in previos_cid and clave not in claves_cid:
                cid_num = previos_cid[clave]
                usados_cid.add(cid_num)
            else:
                cid_num = cid_libre()
            claves_cid.add(clave)
            partes = ['{id:"%s%02d"' % (prefijo, num), "n:%s" % js_str(p["nombre"]), "p:%d" % p["precio"], 'cat:"%s"' % (p.get("cat") or cat), 'prov:"%s"' % prov, 'cid:"IKI-%04d"' % cid_num]
            imgs = p.get("imgs") or []
            if imgs:
                partes.append("img:%s" % js_str(imgs[0]))
                if len(imgs) > 1:
                    partes.append("imgs:[%s]" % ",".join(js_str(x) for x in imgs[1:4]))
            if p.get("var"):
                var = p["var"]
                partes.append("var:{%s}" % ",".join("%s:[%s]" % (js_str(g), ",".join(js_str(v) for v in vals)) for g, vals in var.items()))
            if p.get("sku"):
                partes.append("sku:%s" % js_str(p["sku"]))
            if p.get("antes") and p["antes"] > p["precio"]:
                partes.append("antes:%d" % p["antes"])
            lineas.append(",".join(partes) + "},")
            total += 1
    lineas.append("];")
    # Guarda-red: si un proveedor cayo o la conexion fallo a medias, NO
    # destruir el catalogo vigente (protege ids/cids estables y la tienda).
    if previos and total < len(previos) * 0.5:
        print("  ! ABORTADO: %d productos vs %d previos (descarga parcial): se conserva el catalogo vigente." % (total, len(previos)))
        return 0
    with open(os.path.join(RAIZ, "catalogo.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lineas) + "\n")
    print("catalogo.js: %d productos" % total)
    return total

def escribir_excel(archivo, hojas):
    """hojas: [(titulo, headers, filas, anchos, cols_cop, resumen)]"""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Border, Side
    from openpyxl.utils import get_column_letter
    thin = Border(bottom=Side(style="thin", color="EADFCB"))
    for titulo, headers, filas, anchos, cols_cop, resumen in hojas:
        wb = Workbook()
        ws = wb.active
        ws.title = titulo
        ws.append(headers)
        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=c)
            cell.font = Font(name="Poppins", bold=True, color="FFF8E9", size=11)
            cell.fill = PatternFill("solid", fgColor="242424")
            cell.border = thin
        for f in filas:
            ws.append(f)
        last = ws.max_row
        for row in ws.iter_rows(min_row=2, max_row=last):
            for cell in row:
                cell.border = thin
                cell.font = Font(name="Calibri", size=10)
        for col in cols_cop:
            for r in range(2, last + 1):
                ws.cell(row=r, column=col).number_format = '"$"#,##0'
        for i, w in enumerate(anchos, 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = "A1:%s%d" % (get_column_letter(len(headers)), last)
        if resumen:
            rs = wb.create_sheet("Resumen")
            rs.append(["Resumen — " + titulo])
            rs["A1"].font = Font(name="Poppins", bold=True, size=13)
            for linea in resumen:
                rs.append(linea)
            for c in range(1, 5):
                cel = rs.cell(row=3, column=c)
                cel.font = Font(bold=True, color="FFF8E9")
                cel.fill = PatternFill("solid", fgColor="242424")
            for r in range(4, rs.max_row + 1):
                if "COP" in str(rs.cell(row=r, column=1).value or ""):
                    rs.cell(row=r, column=2).number_format = '"$"#,##0'
            for i, w in enumerate([40, 16, 16, 16], 1):
                rs.column_dimensions[get_column_letter(i)].width = w
        wb.save(os.path.join(RAIZ, archivo))
        print("%s: %d filas" % (archivo, len(filas)))

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("== Descargando proveedores ==")
    gava, gava_cols = descargar_gava()
    print("  gava:", len(gava))
    majestic = descargar_majestic()
    print("  majestic:", len(majestic))
    taiwan = descargar_taiwan()
    print("  taiwan:", len(taiwan))
    solobabys, sb_cols = descargar_solobabys()
    print("  solobabys:", len(solobabys))
    openmind = descargar_openmind()
    print("  openmind:", len(openmind))

    print("== Curando seleccion de la tienda ==")
    joyas = curar_joyas_gava(gava, gava_cols)
    moda = curar_moda_majestic(majestic)
    juguetes = curar_taiwan(taiwan, ["jugueteria", "peluches", "burbujeros", "armatodo", "didactico", "juego-de-mesa", "cacharro", "piñateria", "animales", "colecciones", "slime", "deporte", "termos"], 500, 200000)
    escolar = curar_taiwan(taiwan, ["escolar", "cubo-rubik"], 500, 200000)
    bebes, combos = curar_solobabys(solobabys, sb_cols)
    urbana = curar_urbana_openmind(openmind)
    print("  joyas=%d moda=%d juguetes=%d escolar=%d bebe=%d regalos=%d urbana=%d" % (len(joyas), len(moda), len(juguetes), len(escolar), len(bebes), len(combos), len(urbana)))

    # --- Marca unica: rehostear imagenes cuyo dominio delata al proveedor.
    #     Incremental: solo descarga las que falten en img/p/ (hash del URL).
    #     El catalogo de Taiwan ahora sirve miniaturas webp (~25 KB) con
    #     rutas RELATIVAS (assets/fotos/...) que solo existen en SU
    #     repositorio: se resuelven contra su base publica y se rehostean
    #     igual — el hash del URL ABSOLUTO mantiene el rehost incremental
    #     (las ya descargadas no se vuelven a bajar) y la marca sigue sin
    #     exponer ningun dominio ajeno en las fotos.
    TAIWAN_BASE = "https://jugueteriataiwanoficial.github.io/jugueteriataiwan/"
    def rehost_imgs(items):
        carpeta = os.path.join(RAIZ, "img", "p")
        os.makedirs(carpeta, exist_ok=True)
        n = 0
        for x in items:
            nuevas = []
            for u in x.get("imgs") or []:
                if not u:
                    continue
                if u.startswith("assets/"):
                    original = TAIWAN_BASE + u
                elif "jugueteriataiwan" in u:
                    original = u
                else:
                    nuevas.append(u)
                    continue
                h = hashlib.md5(original.encode()).hexdigest()[:16]
                dest = os.path.join(carpeta, h + ".webp")
                if not os.path.exists(dest):
                    data = get_bin(original)
                    if not data:
                        nuevas.append(u)
                        continue
                    with open(dest, "wb") as f:
                        f.write(data)
                nuevas.append("img/p/" + h + ".webp")
                n += 1
            x["imgs"] = nuevas
        if n:
            print("  rehost: %d imagenes locales" % n)
        return items

    juguetes = rehost_imgs(juguetes)
    escolar = rehost_imgs(escolar)

    print("== catalogo.js ==")
    escribir_catalogo_js([
        ("m", "moda", "l2", moda),
        ("t", "juguetes", "l3", juguetes),
        ("s", "escolar", "l3", escolar),
        ("b", "bebe", "l4", bebes),
        ("r", "regalos", "l4", combos),
        ("j", "joyas", "l1", joyas),
        ("u", "urbana", "l5", urbana),
    ])

    print("== Excel de cada proveedor ==")
    # --- Gava ---
    filas = []
    for p in sorted(gava, key=lambda x: (x.get("product_type") or "", -(float(x["variants"][0]["price"]) if x.get("variants") else 0))):
        vs = p.get("variants") or []
        precios = [float(v["price"]) for v in vs if v.get("price")]
        antes = [float(v["compare_at_price"]) for v in vs if v.get("compare_at_price")]
        img = p["images"][0]["src"] if p.get("images") else ""
        filas.append([p["id"], re.sub(r"\s+", " ", p["title"]).strip(), p.get("product_type") or "Sin categoría",
                      ", ".join(dict.fromkeys(gava_cols.get(p["handle"], []))),
                      min(precios) if precios else None, max(precios) if len(set(precios)) > 1 else None,
                      max(antes) if antes else None,
                      round((1 - min(precios) / max(antes)) * 100) if (antes and precios and max(antes) > min(precios)) else None,
                      len(vs), "Sí" if any(v.get("available") for v in vs) else "No",
                      ", ".join(p.get("tags") or [])[:60], p.get("vendor") or "",
                      "https://www.gavajoyeria.com/products/%s" % p["handle"],
                      ("https:" + img) if img.startswith("//") else img, len(p.get("images") or []),
                      plano(p.get("body_html"))[:400]])
    precios_todos = [f[4] for f in filas if f[4]]
    escribir_excel("Gava_Joyeria_Catalogo.xlsx", [(
        "Catálogo",
        ["ID", "Nombre", "Categoría", "Colecciones", "Precio (COP)", "Precio máx. variante", "Precio antes",
         "Descuento %", "Variantes", "Disponible", "Etiquetas", "Proveedor", "URL producto", "URL imagen principal",
         "N.º imágenes", "Descripción"],
        filas, [12, 52, 24, 30, 13, 15, 13, 12, 10, 11, 22, 14, 55, 70, 10, 60], (5, 6, 7),
        [["Métrica", "Valor"], ["Total de productos", len(filas)],
         ["Disponibles", sum(1 for f in filas if f[9] == "Sí")],
         ["Precio mínimo (COP)", min(precios_todos) if precios_todos else 0],
         ["Precio máximo (COP)", max(precios_todos) if precios_todos else 0],
         ["Fecha de extracción", time.strftime("%Y-%m-%d %H:%M")]])])

    # --- Majestic ---
    def extra_n(v):
        if isinstance(v, list):
            return len(v)
        if isinstance(v, str) and v.strip():
            try:
                return len(json.loads(v))
            except Exception:
                return 1
        return 0
    filas = []
    for p in sorted(majestic, key=lambda x: (x.get("categoria") or "Sin categoría", -(x.get("precio") or 0))):
        filas.append([p.get("id", ""), p.get("referencia") or "", re.sub(r"\s+", " ", p.get("nombre") or "").strip(),
                      p.get("categoria") or "Sin categoría", p.get("subcategoria") or "", p.get("tallas") or "",
                      p.get("precio"), p.get("precio_por_mayor"), p.get("precio_50_unidades"), p.get("costo"),
                      p.get("stock"), "Sí" if p.get("oculto") else "No", p.get("estampados") or "",
                      plano(p.get("descripcion"))[:400], p.get("imagen_url") or "", extra_n(p.get("imagenes_extra"))])
    escribir_excel("Sublimados_Majestic_Catalogo.xlsx", [(
        "Catálogo",
        ["ID", "Referencia", "Nombre", "Categoría", "Subcategoría", "Tallas", "Precio (COP)", "Precio por mayor",
         "Precio 50 und.", "Costo", "Stock", "Oculto", "Estampados", "Descripción", "URL imagen", "N.º imágenes extra"],
        filas, [38, 12, 44, 22, 14, 18, 13, 15, 14, 11, 8, 8, 30, 46, 70, 12], (7, 8, 9, 10),
        [["Métrica", "Valor"], ["Total de productos", len(filas)],
         ["Ocultos", sum(1 for f in filas if f[11] == "Sí")],
         ["Fecha de extracción", time.strftime("%Y-%m-%d %H:%M")]])])

    # --- Taiwan ---
    filas = []
    for p in sorted(taiwan, key=lambda x: (x.get("category", ""), -(x.get("price") or 0))):
        filas.append([p.get("id", ""), re.sub(r"\s+", " ", p.get("name") or "").strip(),
                      ETIQ_TW.get(p.get("category", ""), p.get("category", "")), p.get("price"),
                      p.get("comparePrice"), p.get("sku") or "", p.get("url") or "", p.get("image") or "",
                      len(p.get("images") or []), p.get("description") or ""])
    escribir_excel("Jugueteria_Taiwan_Catalogo.xlsx", [(
        "Catálogo",
        ["ID", "Nombre", "Categoría", "Precio (COP)", "Precio antes", "SKU", "URL producto", "URL imagen",
         "N.º imágenes", "Descripción"],
        filas, [40, 52, 20, 13, 13, 18, 60, 70, 11, 40], (4, 5),
        [["Métrica", "Valor"], ["Total de productos", len(filas)],
         ["Fecha de extracción", time.strftime("%Y-%m-%d %H:%M")]] +
        [["Productos en " + (ETIQ_TW.get(c, c), sum(1 for x in taiwan if x.get("category") == c))[0],
          (ETIQ_TW.get(c, c), sum(1 for x in taiwan if x.get("category") == c))[1]]
         for c in sorted({x.get("category") for x in taiwan})])])

    # --- Solobabys ---
    filas = []
    for p in sorted(solobabys, key=lambda x: ((x.get("product_type") or "Sin categoría"), -(float(x["variants"][0]["price"]) if x.get("variants") else 0))):
        vs = p.get("variants") or []
        precios = [float(v["price"]) for v in vs if v.get("price")]
        antes = [float(v["compare_at_price"]) for v in vs if v.get("compare_at_price")]
        img = p["images"][0]["src"] if p.get("images") else ""
        filas.append([p["id"], re.sub(r"\s+", " ", p["title"]).strip(), p.get("product_type") or "Sin categoría",
                      ", ".join(dict.fromkeys(sb_cols.get(p["handle"], []))),
                      min(precios) if precios else None, max(antes) if antes else None,
                      ", ".join("%s: %s" % kv for kv in (opciones_shopify(p) or {}).items())[:80],
                      len(vs), "Sí" if any(v.get("available") for v in vs) else "No",
                      "https://www.solobabys.com/products/%s" % p["handle"],
                      ("https:" + img) if img.startswith("//") else img,
                      len(p.get("images") or []), plano(p.get("body_html"))[:400]])
    escribir_excel("Solobabys_Catalogo.xlsx", [(
        "Catálogo",
        ["ID", "Nombre", "Tipo", "Colecciones", "Precio (COP)", "Precio antes", "Variantes", "N.º variantes",
         "Disponible", "URL producto", "URL imagen", "N.º imágenes", "Descripción"],
        filas, [14, 52, 16, 34, 13, 13, 34, 11, 12, 58, 70, 11, 50], (5, 6),
        [["Métrica", "Valor"], ["Total de productos", len(filas)],
         ["Disponibles", sum(1 for f in filas if f[8] == "Sí")],
         ["Fecha de extracción", time.strftime("%Y-%m-%d %H:%M")]] +
        [["En colección " + c, sum(1 for v in sb_cols.values() if c in v)]
         for c in sorted({x for v in sb_cols.values() for x in v})])])

    # --- OpenMind ---
    filas = []
    for p in sorted(openmind, key=lambda x: (re.sub(r"\s+", " ", x["title"]).strip(), -(float(x["variants"][0]["price"]) if x.get("variants") else 0))):
        vs = p.get("variants") or []
        precios = [float(v["price"]) for v in vs if v.get("price")]
        antes = [float(v["compare_at_price"]) for v in vs if v.get("compare_at_price")]
        img = p["images"][0]["src"] if p.get("images") else ""
        tallas = []
        for v in vs:
            for k in ("option1", "option2", "option3"):
                val = (v.get(k) or "").strip()
                if val and val.lower() not in ("default title",) and val not in tallas:
                    tallas.append(val)
        filas.append([p["id"], re.sub(r"\s+", " ", p["title"]).strip(),
                      (p.get("product_type") or "").strip() or "Sin categoría",
                      ", ".join(p.get("tags") or [])[:60],
                      min(precios) if precios else None, max(antes) if antes else None,
                      len(vs), "Sí" if any(v.get("available") for v in vs) else "No",
                      ", ".join(tallas)[:80],
                      "https://tiendasopenmind.com/products/%s" % p["handle"],
                      ("https:" + img) if img.startswith("//") else img,
                      len(p.get("images") or [])])
    precios_todos = [f[4] for f in filas if f[4]]
    escribir_excel("OpenMind_Catalogo.xlsx", [(
        "Catálogo",
        ["ID", "Nombre", "Tipo", "Etiquetas", "Precio (COP)", "Precio antes", "N.º variantes",
         "Disponible", "Tallas", "URL producto", "URL imagen", "N.º imágenes"],
        filas, [14, 44, 18, 30, 13, 13, 12, 12, 30, 58, 70, 11], (5, 6),
        [["Métrica", "Valor"], ["Total de productos", len(filas)],
         ["Disponibles", sum(1 for f in filas if f[7] == "Sí")],
         ["Con precio y disponibles (tienda)", sum(1 for f in filas if f[7] == "Sí" and f[4])],
         ["Precio mínimo disponible (COP)", min([f[4] for f in filas if f[4] and f[7] == "Sí"] or [0])],
         ["Precio máximo disponible (COP)", max([f[4] for f in filas if f[4] and f[7] == "Sí"] or [0])],
         ["Fecha de extracción", time.strftime("%Y-%m-%d %H:%M")]])])

    print("== Sincronización completa ==")

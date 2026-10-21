# IKI — Todo lo que te hace feliz

Tienda online multicategoría de IKI (Colombia): venta asistida por WhatsApp,
publicada en **https://ikib2c.github.io/iki/** desde el repositorio
`github.com/ikib2c/iki`. Sin frameworks, sin build, sin backend: HTML + CSS +
JS en un archivo, catálogo generado automáticamente y panel de administración
que publica la configuración por API.

Este documento cubre el sistema al 100%, con énfasis en la **actualización
del catálogo**.

---

## 1. Arquitectura de archivos

| Archivo / carpeta | Rol |
|---|---|
| `index.html` | Tienda completa (HTML + CSS + JS en un archivo). Todo el comportamiento vive aquí |
| `catalogo.js` | Catálogo activo (2.089 productos). **Lo genera el cron**: no se edita a mano |
| `data/configuracion.js` | Configuración publicada desde el panel ("Publicar para TODOS"). La mantiene el panel vía API de GitHub: nadie la edita a mano |
| `legal.html` | 8 políticas con anclas; absorbe la configuración publicada (razón social, NIT, contacto) |
| `scripts/sync_catalogos.py` | Descarga los 5 proveedores, normaliza, cura, clasifica, escribe `catalogo.js` y los 5 Excel |
| `.github/workflows/sync-catalogos.yml` | Cron cada 6 horas (+ manual): sincroniza, commitea y publica (con `pull --rebase` para absorber lo publicado por el panel) |
| `img/p/` | Imágenes rehospedadas de la tienda (miniaturas webp, hash del URL) |
| `generar_enlace_config.py` | **Local** (en `.gitignore`): arma el enlace de configuración de un solo toque (token) |
| `GitHub.txt` | **Local** (en `.gitignore`): donde vive el token de GitHub |
| `IKI_Brief_Branding.md` | Manual de marca y del sistema publicado |
| `*_Catalogo.xlsx` | Excel completos por proveedor (5), generados por el sync |
| `dropi-analytics/` | **Sistema de inteligencia de Dropi** (externo a la tienda): mide ventas reales por delta de stock, genera el informe por categorías (perfumería, joyas, ropa, calzado, relojes, pijamas) en HTML/PDF/Excel y corre automático 2 veces al día — ver su `README.md` |

---

## 2. Actualización del catálogo (pipeline completo)

El cron corre `scripts/sync_catalogos.py` cada 6 horas. El pipeline, paso a paso:

### 2.1 Descarga de los 5 proveedores

Cada proveedor es una **línea de inventario interna** (`l1`–`l5`): ante el
cliente nunca aparece un nombre de proveedor (una sola marca: IKI).

| Línea | Proveedor | Fuente | Categorías que alimenta |
|---|---|---|---|
| `l1` | Gava Joyería | Shopify `products.json` (17 colecciones) | joyas |
| `l2` | Sublimados Majestic | Supabase REST (pijamasalmayor.com) | pijamas, conjuntos, pantalones, shorts, interior, enterizos, ninos, navidad |
| `l3` | Juguetería Taiwan | `catalogo.js` público (GitHub Pages) | juguetes, escolar |
| `l4` | Solobabys | Shopify (15 colecciones) | bebe, regalos |
| `l5` | Open Mind | Shopify | urbana |

### 2.2 Curación por proveedor

- **Gava → joyas**: con imagen, precio $5k–$500k, dedup por nombre, máx. 4 fotos por producto.
- **Majestic → 8 categorías** (ver 2.3 y 2.4): rango $18k–$110k, exige imagen, descarta ocultos y "(Copia)", tallas y estampados como variantes (máx. 8).
- **Taiwan → juguetes y escolar**: 13 categorías + escolar/cubo-rubik, rango $500–$200k, dedup por nombre.
- **Solobabys → bebe y regalos**: solo disponibles; no-combos a bebe, los 10 combos más caros a regalos.
- **Open Mind → urbana**: disponibles con precio real e imagen.

### 2.3 Organización de Majestic en 8 categorías (clasificador por nombre)

La "categoría" del proveedor viene sucia (`shortiras`, `familiar`, `shorts`
vs `Short Dama`, `Sin categoría`…), así que el sync clasifica por **nombre**
con reglas ordenadas:

```
temporada (navidad/halloween/grinch/santa)  >  niños  >  pijamas/pareja  >
enterizos/batolas  >  conjuntos/blusas  >  ropa interior  >  pantalones/trios  >
shorts/bermudas  >  juanitas
```

Categorías resultantes de tienda (tono suave e icono propios en `CATS`):

| Categoría | Productos |
|---|---|
| Pijamas de pareja | 7 |
| Conjuntos y blusas | 16 |
| Pantalones y capris | 16 |
| Shorts y bermudas | 15 |
| Ropa interior y juanitas | 13 |
| Enterizos y batolas | 7 |
| Niños y niñas | 8 |
| Navidad y Halloween | 17 |

### 2.4 Pijamas de familia: precio real por prenda

Majestic publica las pijamas de familia con precio **placeholder** ($3), pero
la tarjeta trae `precios_familia` con el precio real **por prenda y talla**
(dama, dama plus, caballero, 2XL unisex, niño 2/4–14/16). El sync las expande
en un producto por prenda:

- Nombre: `Pijama Familiar Navideña · Dama` (3 familias: de Personajes, Navideña y Grinch).
- **Tallas como chips**: niño con 2/4, 6/8, 10/12, 14/16; dama/caballero con Única/Plus/2XL.
- **Estampados de familia como chips**: Grinch, Reno, Santa y Mickey, Simpsons, Stitch, Avengers, Ironman, Capitán América… (máx. 8).
- Se respetan las **opciones deshabilitadas** de cada tarjeta (match exacto por etiqueta: "Dama" no cae dentro de "Dama Plus").
- Piezas de niño también quedan en "Niños y niñas".

### 2.5 Nombres limpios

- Typos del proveedor corregidos: `Corsert`→`Corset`, `Boddy`→`Body`, punto final suelto (`Bolero Tanga.`→`Bolero Tanga`).
- Título tipo español con palabras cortas en minúscula (de, con, y, x…).
- Las etiquetas de prenda (`· 2XL Unisex`) NO pasan por el formateador de títulos.

### 2.6 IDs y Catálogos permanentes (IKI-XXXX)

`catalogo.js` reutiliza el `id` (`m30`, `t409`…) y el `cid` (`IKI-0030`) de
cada producto por clave **prefijo + nombre normalizado** (`norm_clave`),
tolerante a las correcciones de nombre: los enlaces de pedidos viejos
(`?art=IKI-XXXX`) y la curación del héroe/favoritos no se rompen.

Protecciones activas:

- **`norm_clave`**: minúsculas + `corsert→corset` + `boddy→body` + punto final.
- **`ID_FIJOS` / `CID_FIJOS`**: restauraciones manuales (el Pantalon Bolero
  Tanga recuperó su `m30`/`IKI-0030` tras perderlos con la corrección del
  punto). Los números restaurados no pueden heredarse por nombre.
- **`QUEMADOS_ID` / `QUEMADOS_CID`**: números que pertenecieron a un producto
  durante unas horas y jamás se reemiten (nadie hereda enlaces ajenos).
- **Guarda-red**: si el catálogo nuevo queda con <50% de los productos
  previos (proveedor caído/descarga parcial), se aborta y se conserva el
  catálogo vigente.

### 2.7 Imágenes propias

- **Miniaturas de Taiwan rehospedadas** en `img/p/<md16>.webp` (rutas
  relativas `assets/fotos/…` resueltas contra su base pública; rehost
  incremental por hash del URL absoluto). Cero dominios ajenos en las fotos.
- **Cadena de respaldo en la tienda**: foto fallida → siguiente foto de la
  galería del producto → placeholder "IKI" de la categoría (`fbkFrom`
  anti-bucles; el lightbox y los carruseles reciclan el mismo `<img>`).

### 2.8 Excel por proveedor

5 Excel con formato de marca (cabecera carbón, moneda COP, autofiltro y hoja
Resumen), generados en cada corrida.

### 2.9 Cron de GitHub Actions

Cada 6 horas: checkout con historial completo → sync → `git add catalogo.js
*.xlsx img` → si hay cambios: commit `[skip ci]` → **`git pull --rebase`**
(absorbe lo publicado por el panel vía API, sin conflicto posible: el panel
solo toca `data/configuracion.js`) → push.

---

## 3. Precios

`precioFinal = base × multiplicador × (1 + margen) → redondeado a 100`

Prioridad: **1)** precio exacto fijado en el panel → **2)** margen de
temporada → **3)** margen de categoría → **4)** margen global.

- Márgenes por categoría: las 8 de Majestic al **60%** (mismo precio final que
  la antigua "moda"), joyas 70%, juguetes/escolar 50%, regalos 30%, bebé 25%,
  urbana 20%, global 25%.
- **Temporada navideña automática** del 15-nov al 6-ene: +10 puntos solo en
  categorías de regalo (`juguetes, regalos, joyas, navidad`).

---

## 4. Panel de administración

Acceso: footer "Administración", `?admin` o Ctrl+Shift+A (clave de
conveniencia, no seguridad).

- **Publicar para TODOS**: sube la configuración vigente (tienda + precios,
  **SIN la clave del panel**) a `data/configuracion.js` vía API de GitHub, con
  **versión siempre creciente**; todos los visitantes la ven en ~1 minuto.
  Reintenta si alguien publicó en paralelo (409/422).
- **Precedencias**: lo publicado manda sobre la fábrica del archivo; lo
  guardado en el navegador ("Guardar en MI computador") solo previsualiza
  hasta que exista algo publicado más nuevo (la absorción lo descarta).
- **Token de GitHub**: fine-grained, Contents Read and write, solo este
  repositorio; vive únicamente en el navegador. Se puede cargar con el
  **enlace de configuración** de un solo toque (`python
  generar_enlace_config.py`, local): viaja en el `#fragmento` de la URL (nunca
  al servidor) y se autolimpia de la barra y del historial.
- **Copiar configuración (respaldo)**: el flujo antiguo por portapapeles,
  queda como respaldo sin conexión.

---

## 5. Visibilidad (una sola fuente de verdad)

`prodVisible` (categoría viva + no oculto + catálogo no oculto) y `catViva`
(al menos un producto visible) gobiernan TODAS las superficies: grid,
subnav, burbujas (con precio "desde" real), chips (conteos honestos), menú
móvil, carruseles (sin filas vacías), héroe, favoritos, buscador, upsells del
lightbox y enlaces de Tienda del footer. Ocultar un catálogo en el panel
arrastra todo lo suyo; el filtro activo vuelve a "Todo" si su categoría
murió.

**Estado actual (octubre 2026)**: solo la línea `l2` (Sublimados Majestic)
está visible — `l1/l3/l4/l5` ocultas desde el panel. Para volver a mostrar
todo: panel → Catálogos de inventario → marcar las líneas → "Publicar para
TODOS".

---

## 6. Héroe y favoritos

- **Héroe de temporada** (solo escritorio, hasta 6 productos): 2 Halloween +
  4 Navidad, con texto "Halloween y Navidad ya llegaron / Pijamas y outfits
  para toda la familia". Se cura desde el panel (heroIds) y se publica.
- **Favoritos del carrusel**: 14 prendas de moda seleccionadas.
- Los IDs son estables: la curación sobrevive a los syncs.

---

## 7. Compra y dopamina

- **Checkout por fases** (pedido → datos → entrega → pago → notas) con
  validación en vivo y consecutivo `PED-YYYYMMDD-NNN`.
- **Vuelo al carrito**: la foto de la tarjeta vuela al carrito (WAAPI, arco
  ~520 ms, miniatura en caché); sin vuelo con checkout abierto o
  `prefers-reduced-motion`; badge con rebote elástico y vibración en celulares.
- **Pedido en móvil**: la hoja PNG del pedido viaja **junto con el texto** por
  Web Share (wa.me no admite adjuntos); en escritorio, wa.me + descarga.
- **Enlace de alistamiento**: cada artículo del pedido lleva enlace
  `?art=IKI-XXXX` a su ficha (CIDs permanentes, jamás reutilizados).

---

## 8. Pruebas

Cada cambio de fondo se verifica antes de publicar (bloques reales extraídos
del código + E2E en navegador contra la tienda en vivo):

| Suite | Cobertura |
|---|---|
| Config publicada | 38/38: absorción, precedencias, PUT con sha/409/403, clave nunca publicada |
| Dopamina | 24 de lógica + 10 E2E: vuelo, bump, autolimpieza, reduced-motion |
| Visibilidad | 18/18: ocultar l3 (mata 2 categorías), restauración, filtro muerto |
| Organización | 11/11: 8 categorías, m30 restaurado, márgenes, precios exactos |
| Familiares | 11/11: 13 prendas, tallas/estampados, enlaces viejos |
| Pedido móvil | 5/5: share con imagen+texto, fallbacks |
| **Panel admin (`qa_admin_e2e.js`)** | **52/52: las 3 vías de acceso + login/clave nueva, todos los campos y funciones del panel (identidad, legales, redes, ganancias por categoría, precio exacto, héroe con tope de 6, favoritos, 7 secciones + carruseles + catálogo completo + categorías + productos, contra entrega, token, publicar en vivo, guardar/restaurar/copiar, preview y lista completa)** |

---

## 9. Operación diaria

| Tarea | Cómo |
|---|---|
| Cambiar precios, héroe, favoritos, ocultar productos/categorías/catálogos | Panel → "Ver cambios ahora" (previsualiza) → "Publicar para TODOS" |
| Previsualizar sin publicar | Panel → "Guardar en MI computador" (solo este navegador) |
| Configurar un navegador nuevo del panel | `python generar_enlace_config.py` → abrir el enlace una vez |
| Refrescar el catálogo ya | Pestana Actions → "Sincronizar catalogos" → Run workflow |
| Volver a mostrar todas las líneas | Panel → Catálogos de inventario → marcar l1/l3/l4/l5 → Publicar |
| Respaldar la configuración sin GitHub | Panel → "Copiar configuración (respaldo)" |

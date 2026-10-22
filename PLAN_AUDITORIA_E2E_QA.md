# IKI — Plan de Auditoría E2E y QA

**Versión:** 1.0 · **Fecha:** octubre 2026 · **Alcance:** todo el sistema publicado
(https://ikib2c.github.io/iki/) y su pipeline.

> Objetivo: garantizar que la tienda venda bien, cobre bien y no se caiga.
> Prioridad de riesgos: (1) cobrar mal, (2) catálogo roto, (3) pedido no llega
> por WhatsApp, (4) tienda caída, (5) daño de imagen legal/visual.

---

## 1. Alcance de la auditoría

| # | Componente | Archivo(s) | Riesgo principal |
|---|---|---|---|
| 1 | Tienda (catálogo multicategoría, precios, carrito, checkout, WhatsApp) | `index.html` + `catalogo.js` | Cobrar mal / pedido incompleto |
| 2 | Panel de administración | `index.html` (sección admin) | Publicar configuración corrupta; fuga de token/clave |
| 3 | Publicación por API | fetch a Contents API (`data/configuracion.js`) | Sobreescribir el cron; claves en el repo |
| 4 | Cron de sincronización (cada 6 h) | `scripts/sync_catalogos.py` + workflow | Proveedor caído → tienda vacía; IDs cambiados → pedidos viejos rotos |
| 5 | Catálogo y datos (2.089 productos, 5 líneas `l1`–`l5`) | `catalogo.js`, `data/configuracion.js`, 5 Excel | Precios con margen equivocado; imágenes rotas |
| 6 | Legales | `legal.html` | Datos legales desactualizados; config no absorbida |
| 7 | Marca y activos | logos, favicons, banners, QR | Recurso 404; logo viejo en cualquier superficie |
| 8 | No funcionales | móvil, a11y, performance, SEO, seguridad | Venta perdida en celular; penalización Google |

---

## 2. Niveles de prueba (L0 → L5)

### L0 — Estático (cada commit, ~1 min)
- HTML válido: sin atributos mal cerrados (lección del bug de comillas del héroe:
  `style="…" "Montserrat"…` rompía el atributo sin romper la página).
- `node --check` sobre JS inline extraído y sobre `catalogo.js`.
- Todos los recursos locales existen: `logo_120.png`, `logo_120_light.png`,
  `logo_512*.png`, `favicon*`, `apple-touch-icon.png`,
  `IKI_banner_{joyas,pijamas,regalos}_1600x600.png`, `qr_iki.png`,
  `robots.txt`, `sitemap.xml`.
- Una sola marca: grep `LUNARIA|LUN-` da 0 en `index.html`/`legal.html`
  (plantilla de origen); nombres de proveedores (`Gava|Majestic|Taiwan|
  Solobabys|OpenMind`) dan 0 en superficies visibles (título, metas, textos
  renderizados; los comentarios internos del código no cuentan).
- Secretos: `git ls-files` NO contiene `GitHub.txt`, `iki_token.txt`,
  `DROPI.txt`, `Goldbox.txt`, `enlace-config.txt`,
  `dropi-analytics/config/credenciales.json`; grep `github_pat_` en lo
  trackeado = 0.

### L1 — Pipeline del sync (cada cambio del script + 1 vez por semana)
Corrida local en seco antes de publicar cambios del pipeline:
```
python scripts/sync_catalogos.py          # compara contra el catalogo.js vigente
```
Verificaciones:
- [ ] Total de productos ≥ 90% del vigente (el guarda-red del script aborta < 50%; la auditoría es más estricta a propósito).
- [ ] IDs (`m30`, `t409`…) y códigos `IKI-XXXX` de los 20 favoritos + 6 del héroe
  SIN CAMBIOS (estabilidad por `norm_clave`, `ID_FIJOS`/`CID_FIJOS`).
- [ ] Ningún número `IKI-` reutilizado: los números de `QUEMADOS_ID`/`QUEMADOS_CID`
  no reaparecen (nadie hereda enlaces ajenos).
- [ ] Precios: `venta = techo(base × (1 + margen))` con margen por categoría
  (Majestic 60%, joyas 70%, juguetes/escolar 50%, regalos 30%, bebé 25%,
  urbana 20%) y redondeo comercial hacia arriba a $1.000 (jamás colas .400/.600).
- [ ] Sin precios placeholder ($3 de Majestic) en el catálogo final; familias
  expandidas con precio real por prenda y talla.
- [ ] Los 5 Excel regenerados: cabecera carbón `#242424`, hojas Catálogo y
  Resumen, fecha de extracción de hoy.
- [ ] Imágenes: toda `img/p/*.webp` referenciada existe; cero dominios ajenos
  en las fotos de `l2`/`l3` (rehospedadas). `l1`/`l4`/`l5` hoy sirven CDN
  externo por diseño (líneas ocultas) — ver backlog §7.
- [ ] Prueba de fallo simulada: desconexión a mitad de descarga → el script
  debe abortar y conservar el catálogo vigente.

### L2 — Tienda E2E (cada cambio funcional de `index.html`)
Suite existente: `node qa_aterrizaje_precios.js` (51 verificaciones; usa el
playwright de `dropi-analytics/node_modules`).
Cubre: 20 favoritos, primero y último de los 5 carruseles por categoría,
6 prendas del héroe, buscador (sin tildes/ñ, palabras sueltas, `IKI-XXXX`,
SKU), `?art=` de alistamiento, los 99 precios de la línea visible contra el
catálogo, matemática de carrito, mensaje WhatsApp con total exacto, hoja de
pedido PNG.
Complementos NUEVOS (a incorporar a la suite):
- [ ] **Checkout por fases completo**: pedido → datos → entrega → pago → notas;
  validación en vivo (teléfono colombiano, dirección, ciudad); consecutivo
  `PED-YYYYMMDD-NNN` secuencial en el mismo día.
- [ ] **Persistencia**: carrito y favoritos sobreviven recarga (localStorage).
- [ ] **Lightbox**: navegación prev/next, contador, cierre con Escape.
- [ ] **Móvil (viewport 360×740)**: menú móvil abre/cierra, subnav con snap,
  barra de pago visible con carrito lleno, botón WhatsApp flotante, héroe
  oculto (cero descargas regaladas).
- [ ] **Estados de error**: foto rota → cadena de respaldo (galería →
  placeholder IKI de la categoría, `fbkFrom` anti-bucles); categoría vacía →
  mensaje, no pantalla en blanco.
- [ ] **Dopamina**: vuelo al carrito y badge con rebote respetan
  `prefers-reduced-motion`.

### L3 — Panel E2E + publicación (cada cambio del panel)
Suite existente: `node qa_admin_e2e.js` (52 verificaciones: 3 vías de acceso +
login/clave, identidad, legales, redes, ganancias, categorías, héroe,
favoritos, visibilidad de secciones/carruseles/catálogos/categorías/productos,
precio exacto, comportamiento, clave nueva, token, publicar en vivo con token
real, guardar/restaurar/copiar, preview y lista completa). Complementos NUEVOS:
- [ ] **Publicar para TODOS** contra un **repositorio de pruebas** (fork/rama),
  nunca contra producción durante la auditoría: verificar
  `data/configuracion.js` resultante con `version` creciente y **sin
  `claveAdmin` ni token** (grep).
- [ ] Token guardado SOLO en localStorage del navegador de prueba; borrado al
  salir; el enlace de configuración de un toque no filtra el token en la URL
  del historial (viaja en `#fragmento`).
- [ ] Absorción panel↔cron: publicar por API mientras un commit del cron
  entra → el `pull --rebase` del workflow absorbe sin conflicto (simular
  con 2 commits; el panel solo toca `data/configuracion.js`).

### L4 — Producción (smoke después de cada deploy + 1 vez/día)
Contra https://ikib2c.github.io/iki/ (solo lectura, sin comprar):
```
node qa_smoke_produccion.js     # 31 checks, escribe smoke_resultado.txt
```
- [ ] HTTP 200 en `/`, `/catalogo.js`, `/data/configuracion.js`,
  `/legal.html`, `/robots.txt`, `/sitemap.xml` y los 12 activos de marca.
- [ ] Catálogo ≥ 2.000 productos y ≥ 30 visibles según la config publicada
  (respeta `catalogosOcultos`/`categoriasOcultas`/`productosOcultos`).
- [ ] Héroe y favoritos publicados existen, son visibles y sin placeholders.
- [ ] Título, `og:`, canonical y schema.org OnlineStore con la URL real
  (sin el placeholder `[URL DEL SITIO]`); tipografías oficiales cargadas.
- [ ] 20 imágenes de producto aleatorias: 0 rotas (HTTP 200).
- [ ] Config publicada sin `claveAdmin` ni token; `version` numérica; WhatsApp
  de pedidos con formato `57XXXXXXXXXX`.
- [ ] Deploy de Pages < 5 min después del push (Actions → pages-build-deployment success).

### L5 — No funcionales (1 vez por mes y antes de cada temporada)
- **Móvil real**: iPhone SE y Android gama media (Chrome): carrito, checkout,
  WhatsApp, hoja de pedido descargable.
- **Accesibilidad**: contraste AA (carbón `#242424` sobre crema `#FFF8E9` ≈ 14:1 ✓;
  botones amarillos `#F5AE23` con texto carbón ✓), foco visible, navegación
  por teclado del checkout completo, `aria-label` en iconos.
- **Performance (móvil, medido oct-2026)**: LCP ~508 ms, carga ~1 s,
  descarga inicial ~3 MB (fotos webp ~46 KB promedio, todas lazy; héroe lazy
  en móvil). Objetivo Lighthouse ≥ 85; monitorear que la vitrina no crezca.
- **SEO**: canonical en home y legal, `og:url`, robots.txt con sitemap,
  sitemap.xml (home + legal), schema.org OnlineStore con URL real, títulos
  únicos, cero dominios ajenos en fotos visibles.
- **Seguridad**: token solo en navegador; `claveAdmin` nunca en
  `data/configuracion.js` ni en el HTML servido por encima del default; sin
  secretos en git (revisión L0).

---

## 3. Entornos y datos de prueba

| Entorno | URL / mecanismo | Uso |
|---|---|---|
| Local | `index.html` directo + `catalogo.js` vigente | L0–L3 |
| Staging | rama `qa/` con Pages de repositorio espejo | L3 (publicación real sin riesgo) |
| Producción | ikib2c.github.io/iki | L4 smoke (solo lectura) |
| Datos | WhatsApp de prueba `573001112222` (patrón de normalización de la suite); las suites de aterrizaje corren contra producción en modo lectura: validan el enlace `wa.me` generado, nunca lo envían | suites |

Reglas: nunca publicar a producción desde QA salvo el grupo G de
`qa_admin_e2e.js` (publica contenido idéntico con versión creciente, en
ventana controlada); nunca comprar real en pruebas; el WhatsApp de pedidos
real (573156371501 / Nequi 315 637 1501) solo se valida leyendo el enlace
generado, no enviándolo.

---

## 4. Severidad y criterios de salida

| Sev | Definición | Ejemplo | Acción |
|---|---|---|---|
| S1 | Cobra mal o pierde pedidos | total del carrito errado; WhatsApp sin total; precio ≠ fórmula de márgenes | Bloquea deploy |
| S2 | Catálogo/tienda rota para el usuario | catálogo < 2.000 o visibles < 30; imagen placeholder masiva; checkout no avanza; héroe/favoritos muertos | Bloquea deploy |
| S3 | Degradación visible sin pérdida | badge sin rebote; lightbox sin contador | Fix en 7 días |
| S4 | Cosmético | espaciado, tipografía menor | Backlog |

**Salida de la auditoría:** 0 × S1/S2 abiertos, ≥ 95% de checks PASS en L2/L3,
smoke L4 verde, y reporte firmado con fecha.

---

## 5. Calendario

| Momento | Qué corre |
|---|---|
| Cada push (pre-commit manual) | L0 completo |
| Cada cambio de `sync_catalogos.py` | L1 en seco |
| Cada cambio funcional de tienda/panel | L2 / L3 según corresponda |
| Diario (automatizado con workflow `qa-smoke.yml`) | L4 smoke de producción |
| Semanal (lunes) | L1 + revisión de los runs del cron de las 6 h |
| Mensual | L5 no funcionales |
| **15-nov (antes de temporada)** | Auditoría completa L0–L5 + revisión del margen de temporada (+10 pts en `juguetes, regalos, joyas, navidad` del 15-nov al 6-ene) |

---

## 6. Reporte (plantilla por corrida)

```
Fecha / corrida:            Ejecutor:
L0 estático:        PASS/FAIL (detalle)
L1 pipeline:        productos ANTES=2089 DESPUÉS=nnnn | IDs héroe/favoritos estables: SÍ/NO
L2 aterrizajes:     nn/nn PASS  | fallos:
L3 panel:           nn/nn PASS  | fallos:
L4 producción:      HTTP/precios/imágenes/SEO | deploy: min
L5 (si aplica):     Lighthouse móv=nn | a11y | contraste
Sev abiertas:       S1:[] S2:[] S3:[] S4:[]
Decisión:           PUBLICAR / NO PUBLICAR (motivo)
```

---

## 7. Backlog de automatización (orden sugerido)

1. ✅ **Hecho:** `qa_smoke_produccion.js` — L4 automático (31 checks: página,
   catálogo, visibilidad, configuración, imágenes, SEO, activos, deploy de Pages).
2. Ampliar `qa_aterrizaje_precios.js` con el bloque de checkout por fases y móvil (L2 nuevos).
3. Ampliar `qa_admin_e2e.js` con publicación a repositorio espejo (L3).
4. ✅ **Hecho:** workflow `qa-smoke.yml` diario (12:00 UTC) que corre L4 y
   abre/cierra issue automático con etiqueta `qa-smoke`.
5. Extracción del JS inline a `scripts/extraer_js.py` para `node --check` en L0.
6. Rehost de las fotos de `l1` (Gava), `l4` (Solobabys) y `l5` (Open Mind) a
   `img/p/` (webp reducidas, como l2/l3) para cero dominios ajenos al
   desocultar esas líneas.

---

## 8. Registro de corridas

| Fecha | Corrida | Resultado | Acción |
|---|---|---|---|
| 22-oct-2026 | **L4 smoke de producción** (`qa_smoke_produccion.js`, 31 checks) | **31/31 PASS** contra la copia local publicable; al correrlo contra producción ANTES de publicar este cambio dio 25/31: los 6 checks de SEO (canonical, `og:url`, schema.org, robots/sitemap) exigen este deploy y pasan solos al publicarse | Automatizado con `qa-smoke.yml` (12:00 UTC) |
| 22-oct-2026 | **SEO on-page**: canonical + `og:url` en `index.html`, canonical en `legal.html`, URL real en schema.org (era `[URL DEL SITIO]`), `robots.txt` + `sitemap.xml` publicados; copias viejas (`index (5).html`, `index_jugueteria.html`) fuera del índice | Completo; verificado por los checks 1.7–1.9 y 5.3–5.4 del smoke | Enviar sitemap a Google Search Console |
| 22-oct-2026 | **Auditoría de secretos** (`git ls-files` + `git grep` sobre lo trackeado) | **0 fugas.** Credenciales reales ausentes del repo (`GitHub.txt`, `iki_token.txt`, `DROPI.txt`, `Goldbox.txt`, credenciales de dropi-analytics en `.gitignore`); config publicada sin `claveAdmin` ni token. 3 hallazgos evaluados como aceptados por diseño: (1) `github_pat_…` como texto de ayuda del panel, (2) `github_pat_PRUEBA` valor falso de la suite (el token real lo lee del `GitHub.txt` local ignorado), (3) clave `sb_publishable_` del proveedor en el sync (pública por diseño) | Ninguna obligatoria |

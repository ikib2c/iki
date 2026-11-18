# DropAnalytics — Nuestro propio Dropdata

Sistema de analítica de **ventas reales de Dropi por producto**, construido sobre el método
de **delta de stock** (el mismo que usa Dropdata): Dropi expone el stock de cada producto en
el catálogo; comparando snapshots consecutivos → `ventas = stock_anterior − stock_actual`.

> **Novedad 2026-11-10:** los snapshots ahora incluyen **`imagenes[]`** (hasta 6 URLs http/https
> por producto, extraídas defensivamente de `urlImage`/`url_image`/`image`/`photo`/`images`/
> `multimedia`/`gallery`/`photos` del BFF). Se propagan a `data.js` (campo `imagenes`) y a
> `servidor-delta.js`, y son el insumo de la regla R1 (foto obligatoria) del módulo de
> sincronización Dropi → KACHE del plugin LT Marketplace Suite.

## Estructura

```
dropi-analytics/
├── RUN-DIARIO.bat             Doble clic: sesion (si expiro, pide el 2FA sin cerrarse) + snapshot (108 provs) + analisis + dashboard
├── RUN-AUTO.bat               Rutina DESATENDIDA para el Programador de tareas (popup si expiro la sesion; DROPANALYTICS_DESATENDIDA=1)
├── RUN-JUGUETES.bat           Doble clic: snapshot juguetes + ranking de mas vendidos
├── config/
│   ├── suppliers.json         Proveedores monitoreados (refresco automatico cada 7 dias en RUN-AUTO)
│   ├── credenciales.json      Credenciales Dropi (GITIGNORED — cambiables, ver abajo)
├── scripts/
│   ├── local-snapshot.js      Extractor LOCAL Playwright (--login --all --supplier --toys --refresh-config --refresh-if-old)
│   ├── servidor-delta.js      Servidor local de deltas (puerto 3777) para la extension
│   ├── aviso-login.ps1        Popup "Sesion expirada" con boton que lanza RUN-DIARIO (login 2FA)
│   ├── analyze.ps1            Motor de deltas + tier list -> dashboard
│   ├── toys-delta.ps1         Ranking de juguetes + veracidad + tier
│   ├── categorias-analisis.js Analisis por categoria (perfumeria, joyas, ropa, calzado, relojes, pijamas) -> CSVs
│   ├── tier.ps1               Libreria compartida de tiers S/A/B/C
│   ├── snapshot.ps1           (respaldo) extractor via Firecrawl
│   └── extract-orders.js      Extractor de pedidos propios (verdad de terreno)
├── extension/                 EXTENSION CHROME: overlay de ventas sobre el catalogo Dropi
│   ├── manifest.json          MV3 (content + background service worker)
│   ├── content.js             Observa tarjetas e inyecta badges [Tier] X/dia · margen%
│   ├── background.js          Puente de fetch a localhost (sin CORS/PNA)
│   └── popup.html/.js         Panel: estado del servidor + toggle
├── data/
│   ├── suppliers/{id}/{fecha}.json   Snapshots diarios por proveedor
│   ├── categories/jugueteria/        Snapshots de la categoria + ranking HTML/CSV
│   ├── analysis/categorias/          INFORME por categoria: HTML (ID copiable) + PDF + Excel detallado + CSVs
│   ├── orders/                       Tus pedidos reales (verdad de terreno)
│   ├── universe-suppliers.json       Los 2.390 proveedores del directorio
│   ├── state/                        Checkpoints de reanudacion
│   └── (*.bad)                       Snapshots vacios/parciales en cuarentena (excluidos de todo calculo)
└── dashboard/
    ├── index.html             Dashboard (tiers, buscador, sparklines)
    └── data.js                Generado por analyze.ps1
```
## Operación diaria (3 pasos — o dejarle todo a la tarea programada)

```powershell
# 0. LOGIN (solo si la sesion expiro, ~cada 12h) — abre un navegador visible
#    y llena las credenciales solo. CON totp_secret en config\credenciales.json
#    tambien ingresa la clave dinamica SOLO (login 100% automatico). Sin el,
#    tu tipas el codigo 2FA en la ventana.
#    NO hace falta correrlo a mano casi nunca: si la sesion expira durante un
#    run (RUN-DIARIO, --all, --supplier, --toys, incluso la rutina automatica),
#    el login se abre SOLO y la ventana NO se cierra hasta terminar el acceso
#    (espera hasta 30 min; variable DROPANALYTICS_2FA_MIN para cambiarlo):
node scripts\local-snapshot.js --login

# 1. SNAPSHOT — extrae stock de todos los proveedores de config (reanudable):
node scripts\local-snapshot.js --all
#    Un solo proveedor:    node scripts\local-snapshot.js --supplier 205895
#    Catalogo de juguetes: node scripts\local-snapshot.js --toys
#    Refrescar config:      node scripts\local-snapshot.js --refresh-config
#        Solo si tiene >7 dias: node scripts\local-snapshot.js --refresh-if-old 7  (lo usa RUN-AUTO)
#        Con tope de activos:   node scripts\local-snapshot.js --refresh-config --cap 50
#        Con tope total:        node scripts\local-snapshot.js --refresh-config --max 120
#    Verificar sesion:     node scripts\local-snapshot.js --check

# 2. ANÁLISIS — calcula ventas (deltas) y genera el dashboard
.\scripts\analyze.ps1
#    Analisis por categorias (perfumeria, joyas, ropa, calzado, relojes, pijamas):
#    CSVs + informe HTML (fotos + dias de inventario + enlace al producto + IDs copiables)
#    + Excel detallado + PDF:
node scripts\categorias-analisis.js --pdf

# 3. ABRIR DASHBOARD
start .\dashboard\index.html
```

### Automatización: Windows lo corre solo (2026-10-21)

La tarea programada **"DropAnalytics Rutina Diaria"** (Programador de tareas de Windows)
ejecuta `RUN-AUTO.bat` **2 veces al día: 07:00 y 19:00**. Ya está registrada en este
equipo — usuario actual, solo con sesión iniciada, y si el PC estaba apagado a la hora
programada, corre apenas se enciende (`StartWhenAvailable`).

| Pieza | Rol |
|---|---|
| `RUN-AUTO.bat` | Rutina desatendida: check de sesión → refresco de proveedores si la config tiene >7 días → snapshots (reanudable) → análisis → informe por categorías (CSVs + Excel + HTML + PDF). Sin pausas, no abre dashboards; todo queda en `data\state\run-auto.log` |
| `scripts/aviso-login.ps1` | Si la sesión expiró: popup con botón **Sí → abre RUN-DIARIO.bat** para renovar con el 2FA (auto-cierra en 1 h) |

**El 2FA puede ser 100% automático**: la sesión de Dropi dura ~12 h. Cuando expira, si
configuraste `totp_secret` (clave base32 de Google Authenticator, ver `config\credenciales.json`),
el sistema **calcula la clave dinámica solo y re-loguea sin intervención** — también en las
corridas desatendidas de 07:00/19:00 (el `--check` detecta la sesión vencida, se re-loguea y
la rutina sigue completa). Sin `totp_secret`, la corrida desatendida salta la extracción,
**regenera los informes con la última data** y avisa con el popup (renovar toma ~30 s: tipear
el código de Google Authenticator). En las corridas interactivas (RUN-DIARIO, RUN-JUGUETES o
cualquier modo de `local-snapshot.js`) la renovación es directa: **el login se abre solo, se
registran las credenciales y la ventana del navegador NO se cierra hasta terminar el acceso**
(espera hasta 30 min con cuenta atrás; si el código falla o vence, se tipa el nuevo y sigue
verificando; el llenado de credenciales reintenta 4 veces si la página tarda en cargar — ya no
se cierra de golpe por un tropiezo de red). El interruptor `DROPANALYTICS_DESATENDIDA=1`
(lo define RUN-AUTO.bat) solo aplica cuando NO hay `totp_secret`: restaura el comportamiento
no-bloqueante en la tarea programada. Variable `DROPANALYTICS_SIN_AVISO=1` silencia el popup.

Durante la extracción se abre una ventana de Chromium (headed, a propósito: la técnica
está probada así) — es normal verla trabajar en el horario programado. El modo headless
(segundo plano) **fue probado el 2026-11-17 y Dropi lo bloquea**: tras enviar credenciales
el modal 2FA nunca aparece (detección anti-bot silenciosa) — por eso el extractor fuerza
headed salvo que se pase `--headless`/`DROPANALYTICS_HEADLESS=1` (ignorado sin
`totp_secret`). Para no ver la operación: **minimizar la ventana** es seguro — se agregaron
flags anti-throttling (`--disable-backgrounding-occluded-windows`,
`--disable-renderer-backgrounding`, `--disable-background-timer-throttling`) para que la
extracción no se ralentice con la ventana minimizada o tapada.

```powershell
# Administrar la tarea (PowerShell):
Get-ScheduledTask -TaskName 'DropAnalytics Rutina Diaria'           # estado
Start-ScheduledTask -TaskName 'DropAnalytics Rutina Diaria'         # correr ahora
Disable-ScheduledTask -TaskName 'DropAnalytics Rutina Diaria'       # pausar
Unregister-ScheduledTask -TaskName 'DropAnalytics Rutina Diaria'    # eliminar

# Registrar (o cambiar horas — en OTRO PC ajustar rutas):
$action = New-ScheduledTaskAction -Execute 'C:\Users\User\IKI\dropi-analytics\RUN-AUTO.bat' -WorkingDirectory 'C:\Users\User\IKI\dropi-analytics'
$t1 = New-ScheduledTaskTrigger -Daily -At '07:00'
$t2 = New-ScheduledTaskTrigger -Daily -At '19:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 14)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName 'DropAnalytics Rutina Diaria' -Action $action -Trigger $t1,$t2 -Settings $settings -Principal $principal -Force
```

### Extensión Chrome con overlay en Dropi (OPERATIVA 2026-10-17)

Mientras navegas el catálogo de Dropi, inyecta sobre cada tarjeta de producto que **tenga ventas medidas**:
`[Tier] X/día ↑ margen% Σtotal` — con tus datos privados (nada sale de tu PC).

**Instalación (una vez):**
1. Correr el servidor: `node scripts\servidor-delta.js` (dejar abierto; recarga índice cada 10 min)
2. Chrome → `chrome://extensions` → modo desarrollador → "Cargar extensión sin empaquetar" →
   seleccionar la carpeta `dropi-analytics\extension\`
3. Abrir app.dropi.co → los badges aparecen solos (gris si el servidor está apagado; solo
   se muestran productos con ventas medidas)

**Arquitectura:** `servidor-delta.js` (puerto 3777, índice por nombre, API `/api/producto`)
+ extensión MV3 (`content.js` con MutationObserver + matching por nombre normalizado,
`background.js` como puente de fetch sin CORS — el fetch directo del content script a
localhost está bloqueado por Private Network Access de Chrome, `main-world.js` sniffer
reservado para el futuro). Archivos de prueba E2E: `scripts/test-ext-*.js`.

**Cobertura:** solo productos de proveedores con snapshot (crece con cada corrida —
100 proveedores en la del 20-oct) — y en las páginas de proveedores monitoreados,
~todas las tarjetas llevan badge.

### Refresco de la selección de proveedores (`--refresh-config`)

La config NO es fija: Dropi cambia a diario. El modo `--refresh-config`:
1. Re-mide las métricas BFF de los 2.390 proveedores del universo (~3 min, gratis)
2. Reconstruye la lista con las reglas: **activos (BFF>0) + top 12 catálogos ≥300 + proveedores con historial de snapshots + GOLDBOX**
3. Respalda la config anterior (`config/suppliers.backup-{fecha}.json`) y reporta altas/bajas
4. `--cap N` limita los activos a los N mayores (para acotar el tiempo del run diario)

**Ya no es manual:** `RUN-AUTO.bat` corre `--refresh-if-old 7 --max 120` antes de cada
rutina — si `config/suppliers.json` tiene 7+ días se reconstruye solo, con guardas: sin
token de sesión o con >20% de métricas BFF fallidas **aborta y conserva la config
anterior** (no puede vaciar la cartera por una caída). El `--max 120` reserva GOLDBOX +
top-12 catálogos grandes y completa por pedidos/mes: sin él, el refresco del 11-18 subió
la lista de 108 a 225 proveedores (~17 h de extracción). Tiempo del run diario: ~2-5 min
por proveedor (observado 20-oct: 100 proveedores ≈ 7,5 h; con `--cap 50` ≈ la mitad).
Los 8 que no se capturan son catálogos vacíos/no visibles (7) o paginación atascada (1).

**Advertencia descubierta (2026-10-17):** la métrica BFF `total_monthly_orders` es VOLÁTIL —
en 24h GOLDBOX pasó de 660K a 0, KAES de 30K a 0, mientras Quality quedó idéntico (cache).
Sirve como brújula de actividad, pero **el delta de stock propio es la medición confiable**.
Confirmado el 20-oct: GOLDBOX y Ecomlab reportaban `pedidos_mes = 0` en el BFF mientras
vendían 2.259 y 588 unidades medidas por delta de stock.

### Extractor local (Playwright) vs Firecrawl

| | local-snapshot.js (Playwright local) | snapshot.ps1 (Firecrawl) |
|---|---|---|
| Costo | **GRATIS, ilimitado** | ~8-20 créditos por sesión |
| Sesiones | sin límite de tiempo | ~10 min por sesión |
| Salida | directa a archivos | truncada a 1MB por llamada |
| Requisitos | Node.js + Playwright (ya instalado) | créditos Firecrawl |
| 2FA | automático con `totp_secret` (TOTP calculado en el PC); sin él, ventana visible | flujo asistido por terminal |

`snapshot.ps1` queda como respaldo; el extractor local es el recomendado.


## Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| Extracción | **Node.js 18+ · Playwright · Chromium** | local, gratis, ilimitado — reemplazó Firecrawl/credits |
| Sesión | Perfil persistente de Chromium (`auth/profile`) | login Dropi con JWT ~12h; 2FA **100% automático** con `totp_secret` (TOTP propio); sin él, ventana visible |
| Análisis | **PowerShell 5.1** (nativo de Windows) | `analyze.ps1`, `toys-delta.ps1` — sin dependencias |
| Almacenamiento | Archivos planos JSON (por proveedor/fecha) + CSV | sin base de datos ni nube — portable y auditable |
| Dashboard | HTML + JS + CSS **vanilla** (cero frameworks) | lee `data.js` generado; se abre en cualquier navegador |
| Reportes Excel | PowerShell + Excel COM | opcional, requiere MS Excel instalado |
| Lanzadores | `.bat` de Windows | operación de doble clic |
| Costo total | **$0** | sin nube, sin suscripciones, sin API keys |

## Credenciales y cambio de cuenta

**Las credenciales viven en `config/credenciales.json`** (gitignored — nunca en el código,
nunca en git). Formato: `{"usuario": "...", "contrasena": "..."}`.

**Para cambiar de cuenta Dropi:**
1. Editar `config/credenciales.json` con el usuario/contraseña de la nueva cuenta
2. Borrar la carpeta `auth\` (la sesión de la cuenta vieja no sirve)
3. `node scripts\local-snapshot.js --login` → tipiar el 2FA de la NUEVA cuenta
4. `--refresh-config` para re-medir el universo con la nueva cuenta

**Advertencias al cambiar de cuenta:**
- La nueva cuenta debe ser **dropshipper de Dropi COLOMBIA** (el sistema está ajustado a
  `country: COLOMBIA` y `x-host: co`; para otro país habría que cambiar esos valores)
- Los proveedores **privados/favoritos pueden variar por cuenta** (ej.: GOLDBOX es privado
  y podría no ser visible desde otra) — los públicos (2.390) son iguales para todos
- El histórico (`data\`) es de PRODUCTOS, no de la cuenta → se conserva y sigue siendo válido

| Requisito | Detalle |
|---|---|
| **Node.js 18+** | https://nodejs.org (LTS) — ya instalado en este equipo |
| **Playwright + Chromium** | `npm install playwright` + `npx playwright install chromium` (ya instalado) |
| Sesión Dropi activa | JWT ~12h. Si expira: `node scripts\local-snapshot.js --login` (o simplemente correr RUN-DIARIO: el login se abre solo) → con `totp_secret` configurado **todo el acceso es automático**; sin él, se abre Chrome y **la ventana NO se cierra hasta tipear el código de Google Authenticator** (espera hasta 30 min; credenciales en `config\credenciales.json`) |
| Windows + PowerShell | scripts PS 5.1 · `.bat` de doble clic |
| **Costo** | **$0 — extractor local, sin Firecrawl ni créditos** |

**¿Correrlo en otro computador?** Sí — tutorial completo: `INSTALACION-OTRO-PC.md`
(solo requiere Node.js + re-login con 2FA; copiar `data\` para conservar el historial).

## Cadencia recomendada

- **1 snapshot diario** (misma hora idealmente) — con 2+ snapshots/día se detectan
  reposiciones y mejora la precisión
- **Refresco de proveedores automático** (`--refresh-if-old 7` en RUN-AUTO; semanal) para
  adaptar la lista (Dropi cambia a diario: el primer refresco detectó 94 activos vs 38 dos días antes)

## Lecciones técnicas incorporadas en los scripts

1. **Slug del proveedor**: la URL usa el campo `name` (no store_name): `/dashboard/provider/{id}/{slug}`. Si el slug es incorrecto la página queda EN BLANCO y no dispara la API. Los slugs ya van en `config/suppliers.json`.
2. **Sesiones viven ~10 min** → el snapshot procesa por bloques (`-MaxPagesPerSession 8`) y reanuda en nueva sesión.
3. **Salida de interact se trunca a 1MB** → máximo ~8 páginas de 100 productos por llamada.
4. **Conflictos de perfil** ("Browser operation conflicts"): el backend del perfil se bloquea si se encadenan scrapes/interacts sin pausa → los scripts incluyen pausas de 3–30 s.
5. **`$pid` es variable reservada de PowerShell** (bug corregido en analyze.ps1).
6. Orden inestable del catálogo → se usa `order_by=id&order_type=asc` y se deduplica por id.
7. **Deltas por producto, no por fecha global** (bug corregido 20-oct): si un proveedor no
   tiene foto de una fecha intermedia, `analyze.ps1` perdía TODO su delta (GOLDBOX sin foto
   del 17-oct reportaba 0 ventas con 2.259 reales). Ahora calcula sobre las fechas propias
   de cada producto, igual que `servidor-delta.js`.
8. **PowerShell 5.1 lee JSON UTF-8 sin BOM como ANSI** → nombres con tildes corruptos
   ("Plǭstico", "BebǸs"). Fix: `Get-Content -Raw -Encoding UTF8` + `TrimStart(BOM)` en
   `analyze.ps1` y `toys-delta.ps1` (los JSON viejos de la era Firecrawl traen BOM).
9. **Nunca escribir snapshots vacíos** (bug corregido 20-oct): una captura fallida de
   juguetería (0 productos) se guardaba igual y rompía el ranking en silencio. `--toys`
   ahora reintenta 3× y se niega a escribir capturas vacías (los archivos malos quedan
   renombrados `*.bad`).
10. **Parcial + final del mismo día**: la captura por categoría escribe un parcial cada 10
    páginas y un final con sufijo `-HHMM`; `toys-delta.ps1` debe agrupar por DÍA y comparar
    los 2 días distintos más recientes (antes comparaba parcial vs final de la misma
    cosecha: ventana de 2 minutos, ranking en 0).
11. **`Add-TierToRows` exige el campo correcto**: el ranking "hoy" salía todo tier C porque
     se llamaba sin `-VelocityField 'vendidas_hoy'` (el default `vendidas` no existe en
     esas filas → velocidad 0 → C).
12. **Mediana = percentil sobre array ORDENADO** (bug corregido 10-21): el array de
     márgenes no se ordenaba antes de tomar `a[length/2]` → relojes reportaba 53% (era un
     elemento aleatorio; el real es 20%). Toda agregación de mediana/percentil ordena primero.
13. **`--check` debe salir con exit code 1 si la sesión expiró** (bug corregido 10-21:
     salía 0 → RUN-DIARIO/RUN-AUTO no detectaban el vencimiento). Además, `requireLogin`
     cierra el contexto de Chromium antes del `process.exit(1)` — un exit abrupto se salta
     el `finally` y deja el navegador huérfano.
14. **Pitfalls de .bat para tareas programadas**: paréntesis dentro de bloques `if (...)`
     rompen el parser ("No se esperaba...") → estilo goto/etiquetas sin bloques; y
     `%DATE%` con `chcp 65001` doble-codifica los acentos en el log → timestamps ISO
     vía `powershell Get-Date -Format` con `for /f`.
15. **XLSX sin dependencias** (`scripts/xlsx-writer.js`): contenedor OOXML escrito a mano
     (ZIP: `zlib.deflateRawSync` + CRC32 propia; hojas `inlineStr` + autofiltro + freeze).
     El punto que rompe es el escape de entidades XML — validar con Excel COM después de
     cualquier cambio. Genera el informe-categorias-detallado.xlsx sin tener Excel.
16. **La ventana NO se cierra sin el 2FA** (bug corregido 10-21): `requireLogin` cerraba el
     navegador y salía con exit 1 al detectar sesión expirada — en un run interactivo el
     usuario nunca alcanzaba a tipar el código. Ahora `requireLogin` abre el login (`doLogin`)
     y espera hasta **30 min** el acceso (polling de `loggedIn` cada 3 s; antes
     `waitForURL` con timeout de solo 5 min), con cuenta atrás en consola y re-verificación
     si el código falla o vence. Solo sale sin login en modo desatendido
     (`DROPANALYTICS_DESATENDIDA=1`, definido por RUN-AUTO.bat y solo si no hay `totp_secret`)
     para no colgar la tarea programada: cierra el contexto ANTES del `process.exit(1)` y el
     bat muestra el popup.
17. **Login blindado + 2FA automático** (10-23): se reportó una corrida donde el navegador se
     cerró de inmediato sin registrar credenciales ni dar tiempo a la clave dinámica: `doLogin`
     llenaba `input:visible` nth(0)/nth(1) sin esperar el render de la SPA — si el fill fallaba,
     la excepción llegaba al `finally { ctx.close() }` y mataba la ventana. Ahora: (a) el llenado
     de credenciales espera los inputs hasta 60 s y reintenta 4 veces; (b) el deadline de 2FA es
     configurable (`DROPANALYTICS_2FA_MIN`, 30 min por defecto) y al vencer NUNCA cierra sin
     avisar — queda la ventana abierta; (c) `totp_secret` (base32 de Google Authenticator) en
     `config\credenciales.json` activa el **TOTP RFC 6238 propio** (`totpCode`, solo `crypto` de
     Node): calcula la clave dinámica vigente cada 30 s y la ingresa sola (6 casillas con
     auto-avance → `pressSequentially`; casillas por dígito → `fill`; input único → `fill`;
     con foco ya puesto → `keyboard.type`), con hasta 4 reintentos y reenvío de credenciales si
     el sitio vuelve a pedirlas; (d) `--check` se auto-recupera: si la sesión venció y hay
     `totp_secret`, re-loguea y devuelve exit 0 → la rutina desatendida de 07:00/19:00 se
     repara sola.
18. **La sesión se valida con el JWT real, no con la URL** (corregido 11-01, incidente real):
     `loggedIn()` daba por viva la sesión si la URL seguía en `/dashboard` (la SPA tarda en
     redirigir) o si `DROPI_LoginResult` tenía un token VENCIDO → `--check` decía "SESION OK"
     con la sesión muerta: el run extraía vacío durante horas (40 recargas por proveedor) y
     **jamás abría el login** — el usuario no podía ingresar credenciales ni clave dinámica
     porque nadie se las pedía. Ahora: `loggedIn()` decodifica el JWT (campo `exp`) y exige
     token vigente; el extractor detecta la sesión vencida a mitad de la extracción
     (redirección a `/auth/login`, 401/403, token sin exp) y renueva el login en el momento
     (automático con `totp_secret`, o ventana abierta para tipear el código); el llenado de
     credenciales usa los selectores reales del formulario (`input#email` / `input#password`)
     y verifica que el texto entró; y si el perfil `auth/profile` está en uso por otra corrida,
     el error lo dice claro en vez de morir con un mensaje críptico.
19. **Dropi 3.4.0 cambió la pantalla 2FA: casillas sin maxlength y sin auto-avance** (corregido
     11-17): las 6 casillas ahora son `type=text` SIN `maxlength=1` y ya NO auto-avanzan (la
     primera lleva `autocomplete=one-time-code`) → el tipeo en cascada (`pressSequentially`
     sobre la casilla 0) dejaba **solo 1 dígito** ingresado y TODOS los códigos eran rechazados
     — parecía secreto inválido o reloj desincronizado (el reloj estaba bien: +0,36 s vs NTP).
     Ahora `otpBoxes` detecta las 6 casillas `type=text` (estilo nuevo) además de las
     `maxlength=1` (estilo viejo), y `tipOtp` llena **un dígito por casilla** (sirve con o sin
     auto-avance). Mismo día: se importó el secreto TOTP desde el QR de **exportación** de
     Google Authenticator del celular (`otpauth-migration://offline?data=...`, protobuf con
     secreto base32 de 10 bytes) → `totp_secret` ahora es el del teléfono (`6VMN...`, cuenta
     Dropi-CO-DROP). Verificado con QA: login E2E en perfil desechable al primer intento
     (17 s, JWT ~12 h) + re-login real de producción con exit 0. La clave ya no vive solo en
     el celular: PC y teléfono comparten el mismo secreto.
20. **Dropi 3.4.0 movió el JWT de localStorage** (corregido 11-17): el token ya NO está en
     `DROPI_LoginResult.token` (esa clave ahora solo trae configuración) — vive como string
     crudo en **`DROPI_token`**. Síntoma traicionero: `--check` decía "expirada" con la sesión
     VIVA y los re-logins "colgaban" en silencio (logueaban bien —el pantallazo del dashboard
     lo probó— pero `loggedIn()` nunca veía el token y el bucle seguía para siempre; también
     explica los "4 intentos TOTP sin exito" espurios del 11-16). Fix: nuevo `readLoginToken()`
     lee `DROPI_token` (con fallback a la clave vieja) y alimenta `sessionToken`/`loggedIn`,
     el BFF de `--refresh-config` y `getCategoryByName` (`--toys`). QA: `--check` SESION OK
     instantáneo sin re-login + BFF categorías HTTP 200 (31 categorías). Además se probó
     headless (2026-11-17): Dropi lo bloquea (el modal 2FA nunca aparece) → se mantiene
     headed, ahora con flags anti-throttling para poder minimizar la ventana durante la
     extracción.
21. **Fotos y enlaces de producto de Dropi** (11-18): las fotos de los snapshots apuntaban a
     `dropi.s3.amazonaws.com`, que hoy devuelve **403**; el host vivo es el CDN
     `d39ru7awumhhs2.cloudfront.net` (misma ruta `colombia/products/...`). `extractImages()`
     ya guarda el CDN y el informe reescribe las URLs viejas. La ficha real de producto es
     `/dashboard/product-details/<id>/<slug>` (sacada del bundle de la app; el router usa
     solo el ID, el slug puede ir simplificado). El informe ahora trae foto + días de
     inventario (stock ÷ ventas/día, rojo ≤7 / ámbar ≤20) + enlace; el PDF pesa ~40 MB
     por las fotos embebidas (el HTML es liviano: carga lazy).

## Datos cargados (histórico → 2026-10-20)

- **GOLDBOX** (id 205895): 237 productos · historial 10-15 → 10-20 · **88 productos con
  ventas, 2.259 u** en la ventana 10-17 → 10-20 (≈ 565 u/día; en 10-15→16 fueron ~1.300)
- **Ecomlab Desarrollos** (id 19662): 133 productos · **33 con ventas, 588 u** (10-16 → 10-20)
- **Quality Tienda** (id 6606): 542 productos · **39 con ventas, 389 u** (10-17 → 10-20)
- **2026-10-20, primera corrida completa:** 100/108 proveedores capturados (7 catálogos
  vacíos + 1 paginación atascada), **22.052 productos monitor** — los otros 97 arrancan a
  producir deltas desde la corrida siguiente. Ranking del día en el dashboard:
  Forge Skin 261 u (S) · Breatify 165 u (S, margen 73%) · Uro Probiotic 153 u (S) ·
  Audífonos U9 58 u · Picador 4-en-1 49 u...
- **Juguetería, primer ranking real (10-17 → 10-20):** 94 juguetes con ventas,
  **1.056 u** (977 confirmadas · 79 sospechosas en 1 juguete con CAIDA>50%). Top:
  Moto Carro Recargable 119 u · Impermeable Metalizado 97 u (S, 50%) · Faja Térmica 85 u
  (S, 69%). Catálogo monitoreado: 5.314 juguetes (línea base: 5.566).
- **Análisis por categorías (10-21, `categorias-analisis.js`):** clasificación por
  keywords de los 22.052 productos monitor → **calzado 65 p (margen mediano 44%, el
  mejor) · ropa 157 p (40%) · joyas/bisutería 998 p (20%, saturada; 92% es Alanashop) ·
  relojes 798 p (PVP alto $129.900 pero margen 20% a valor fijo) · perfumería 50 p (24%;
  nicho = fragancias de feromonas; 1 producto con ventas medidas: Golden Lure 6 u) ·
  pijamas 5 p (Dropi no es fuente viable de pijamas)**. Ventas medidas por categoría:
  aún casi 0 (solo 3 proveedores tienen historial) — se llenan con las corridas diarias.
  Cada corrida genera: CSVs + `informe-categorias-{fecha}.html` (fotos de producto,
  días de inventario, enlace al producto en Dropi, IDs copiables con clic + botón
  Exportar PDF) + `informe-categorias-{fecha}.pdf` (con `--pdf`; ~40 MB por las fotos) +
  `informe-categorias-detallado-{fecha}.xlsx` (Info · Resumen · 6 hojas de categoría ·
  Top Ventas) — todo en `data\analysis\categorias\`.

## Roadmap (inspirado en Dropkiller/Dropdata — ver `.firecrawl/dropkiller-home.md`)

- [x] Run completo de los proveedores activos (config auto-actualizable con `--refresh-config`;
      primera corrida completa el 20-oct: 100/108 proveedores, 22.052 productos)
- [x] Snapshots por categoría (juguetería operativa; cualquier categoría agregable)
- [x] **Tier list S/A/B/C en el dashboard y rankings** (velocidad × margen; D = veracidad.
      Reglas: S = vel p85+ y margen ≥40% · A = p60+ y ≥30% · B = vende · C = sin ventas ·
      D = sospechoso. Librería compartida: `scripts/tier.ps1`)
- [ ] **Servidor MCP "Conectar IA"**: consultar DropAnalytics desde Claude/ChatGPT/opencode
      ("¿qué juguetes vendieron más ayer?") — servidor Node leyendo los JSON locales
- [x] **Extensión Chrome con overlay en Dropi** (operativa 2026-10-17; ver sección arriba)
- [ ] **Validador de anuncios**: para cada producto top, buscar en la biblioteca pública
      de Meta Ads si hay anuncios activos (columna de validación de demanda)
- [ ] **Store Radar Shopify**: analizar tiendas de competidores (productos + estimación
      de ventas por delta sobre /products.json público — misma técnica que Dropi)
- [x] 2+ snapshots/día (detectar reposiciones con precisión) — tarea programada 07:00 y 19:00 desde 2026-10-21
- [ ] Alertas de tendencias (producto que entra al top, spikes)
- [ ] Margen calculado con costo de envío por ciudad
- [ ] Histórico 30/90 días y curvas por producto
- [ ] Multi-país (Dropi .mx/.pe/.cl...: cambiar `x-host`, cuenta y universo por país)
- [ ] Integración con IKI: catálogo filtrado por proveedor con margen objetivo

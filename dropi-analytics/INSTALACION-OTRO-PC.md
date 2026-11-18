# DropAnalytics — Instalación en OTRO computador (tutorial completo)

> El sistema es 100% local y portable: **sí se puede correr en otro equipo**.
> Lo único que no se traslada es la sesión abierta de Dropi (cada equipo hace su propio
> login). El `totp_secret` **sí** se puede copiar: es de la CUENTA, no de la máquina — con
> él el equipo nuevo se re-loguea solo y el celular no hace falta.

---

## Requisitos del equipo nuevo

| Requisito | Detalle |
|---|---|
| Windows 10/11 + internet | Todo corre local; internet solo para extraer |
| **Node.js 18+** | Descargar LTS de https://nodejs.org (instalación siguiente-siguiente) |
| Opcional: celular con **Google Authenticator** | Solo si NO configuras `totp_secret`. Con el secreto TOTP en `config\credenciales.json` el login es 100% automático |
| Opcional: Excel / LibreOffice | Solo para ABRIR los .xlsx — el sistema los genera solo (sin Excel instalado) |

**No necesita:** Firecrawl ni créditos · la sesión del equipo anterior · carpetas de `.firecrawl`

---

## Paso 1 — Copiar el proyecto

Lleva la carpeta completa `dropi-analytics\` (en zip o USB) al nuevo equipo, por ejemplo a `C:\dropi-analytics`.

Puedes excluir estas carpetas (se regeneran solas):
- `node_modules\` — se reinstala en el paso 3
- `auth\` — sesión del equipo viejo, no sirve en otro equipo

**Importante si quieres conservar el historial:** copia también la carpeta `data\`
(contiene los snapshots diarios). Sin ella, el equipo nuevo arranca con línea base nueva
(ya no podrá calcular las ventas de los días anteriores).

## Paso 2 — Instalar Node.js

1. Entra a **https://nodejs.org** y descarga la versión **LTS**
2. Instala con opciones por defecto
3. Verifica — abre **PowerShell** y escribe:

```powershell
node --version
```
Debe responder algo como `v22.x.x` o superior.

## Paso 3 — Instalar Playwright (3 comandos, una sola vez)

En PowerShell, dentro de la carpeta del proyecto:

```powershell
cd C:\dropi-analytics
npm install playwright
npx playwright install chromium
```

El último comando descarga Chromium (~118 MB, unos minutos).

## Paso 4 — Primer login de Dropi (automático si copias el `totp_secret`)

> Las credenciales están en `config\credenciales.json` (usuario + contraseña + `totp_secret`).
> **Copia ese archivo tal cual al equipo nuevo** (nunca se sube a git): el `totp_secret` es la
> clave base32 de Google Authenticator y es de la CUENTA, no de la máquina — con él, el login
> (incluida la clave dinámica de 6 dígitos) es **100% automático** y **no hace falta el celular**.
> Si no lo tienes: en Dropi → 2FA → "No puedo escanear el QR" (o el QR de exportación de
> Google Authenticator) → copiar la clave base32 (letras A-Z y números 2-7).
> Sin `totp_secret`, crear el archivo con `{"usuario": "...", "contrasena": "..."}` y el login
> abre la ventana para tipear el código (hasta 30 min).

```powershell
node scripts\local-snapshot.js --login
```

1. Se abre una ventana de Chromium (**necesaria**: Dropi bloquea el modo headless)
2. Las credenciales se llenan solas
3. Con `totp_secret`, la clave de 6 dígitos se calcula en el PC y se ingresa sola;
   sin él, tipea el código de tu Google Authenticator ahí (la ventana **NO se cierra sola**:
   espera hasta 30 minutos, y si el código falla o vence, tipa el nuevo y sigue verificando)
4. Espera el mensaje `LOGIN OK - sesión persistida` (JWT ~12 horas; se renueva solo en cada corrida)

## Paso 5 — Probar que todo funciona

```powershell
node scripts\local-snapshot.js --check              # debe decir "SESION OK"
node scripts\local-snapshot.js --supplier 205895     # extrae GOLDBOX (~2 min)
```

## Paso 6 — Operación diaria

Doble clic en los lanzadores:
- **`RUN-DIARIO.bat`** — si la sesión expiró, renueva el login solo (100% automático con `totp_secret`; sin él, abre la ventana y espera el 2FA sin cerrarse);
  luego snapshot de todos los proveedores + dashboard + informe por categorías (HTML con
  fotos, días de inventario y enlaces a Dropi + PDF + Excel detallado en `data\analysis\categorias\`)
- **`RUN-JUGUETES.bat`** — snapshot de juguetes + ranking de más vendidos (mismo manejo de 2FA)

La lista de proveedores se refresca **sola** en la rutina automática cada 7 días
(`--refresh-if-old 7`); el manual sigue disponible:
`node scripts\local-snapshot.js --refresh-config`.

## Paso 7 — Automatización (recomendado: Windows corre todo solo)

La tarea programada **"DropAnalytics Rutina Diaria"** ejecuta `RUN-AUTO.bat` a las
**07:00 y 19:00** (si el PC estaba apagado, corre apenas se enciende). Antes de extraer,
refresca la lista de proveedores si tiene 7+ días. Sin pausas, todo
queda en `data\state\run-auto.log`. Con `totp_secret` la corrida se **re-loguea sola** al
expirar la sesión (~12 h) y sigue completa, sin popups. Sin él, regenera los informes con
la última data y muestra un popup: botón **"Sí" → abre RUN-DIARIO** para renovar con el 2FA (~30 s).

En PowerShell (ajustar la ruta a la carpeta del equipo nuevo):

```powershell
$action = New-ScheduledTaskAction -Execute 'C:\dropi-analytics\RUN-AUTO.bat' -WorkingDirectory 'C:\dropi-analytics'
$t1 = New-ScheduledTaskTrigger -Daily -At '07:00'
$t2 = New-ScheduledTaskTrigger -Daily -At '19:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 14)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
Register-ScheduledTask -TaskName 'DropAnalytics Rutina Diaria' -Action $action -Trigger $t1,$t2 -Settings $settings -Principal $principal -Force
```

Administrarla: `Start-ScheduledTask` / `Disable-ScheduledTask` /
`Unregister-ScheduledTask -TaskName 'DropAnalytics Rutina Diaria'`.

## Paso 8 (opcional) — Extensión Chrome con overlay en Dropi

1. Correr el servidor: `node scripts\servidor-delta.js` (dejar abierto mientras navegas)
2. Chrome → `chrome://extensions` → Modo desarrollador → "Cargar extensión sin empaquetar" →
   seleccionar la carpeta `extension\` del proyecto
3. Abrir app.dropi.co → las tarjetas con ventas medidas muestran el badge
   `[Tier] X/día · margen%` con tus datos privados

---

## ¿Dos equipos a la vez?

**Sí puede**, cada uno con su propio login (Dropi lo permite), pero:
- Cada equipo guarda su propio histórico → los datos se dividen
- **Recomendado:** un solo equipo "de análisis" · si necesitas dos, sincroniza la carpeta
  `data\` por OneDrive/Google Drive (la estructura de archivos lo soporta sin conflictes
  si extraen proveedores distintos o a horas distintas)

## Problemas comunes

| Síntoma | Solución |
|---|---|
| `SESION EXPIRADA` al correr | Ya no bloquea: con `totp_secret` el re-login es automático; sin él, RUN-DIARIO/RUN-JUGUETES abren el login solos y la ventana espera el 2FA (hasta 30 min). A mano: `node scripts\local-snapshot.js --login` (cada ~12h) |
| Popup "Sesión expirada" 2 veces al día | Solo ocurre sin `totp_secret`: clic "Sí" → RUN-DIARIO → tipear el 2FA (o correr `--login` directo). Con `totp_secret` la rutina se re-loguea sola y no hay popup |
| El navegador no abre | Repite `npx playwright install chromium` |
| Se ve la ventana de Chromium trabajando | Es normal: la extracción corre en ventana visible. Se puede **minimizar** (flags anti-throttling). El modo headless está bloqueado por Dropi (probado) — no usar |
| `node` no se reconoce | Cerrar y reabrir PowerShell tras instalar Node.js |
| Un proveedor da 0 productos | Verificar el `slug` en `config\suppliers.json` (debe venir del campo name) |
| El .bat no corre | Ejecutarlo desde la carpeta raíz del proyecto (cd correcto) |
| Response vacía intermitente | El sistema reintenta solo; volver a correr reanuda donde quedó |
| No aparece el PDF del informe | El PDF usa Playwright: verificar `npx playwright install chromium`; el botón "Exportar PDF" del HTML siempre funciona (Ctrl+P) |
| El PDF pesa ~40 MB | Normal: incluye las fotos de los productos. El HTML es liviano (carga lazy) y abre al instante |

## Checklist de traslado

```
[ ] Carpeta dropi-analytics copiada (con data\ si quieres historial)
[ ] Node.js instalado (node --version responde)
[ ] npm install playwright ejecutado
[ ] npx playwright install chromium ejecutado
[ ] --login hecho (automático con totp_secret; sin él, código 2FA tipeado)
[ ] --check dice "SESION OK"
[ ] RUN-DIARIO.bat corre y abre el dashboard
[ ] Tarea programada registrada (Paso 7) — opcional pero recomendado
```

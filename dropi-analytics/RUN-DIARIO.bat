@echo off
chcp 65001 >nul
title DropAnalytics - Rutina Diaria
cd /d "%~dp0"

echo ============================================================
echo   DROPANALYTICS - RUTINA DIARIA
echo   (extraer ventas reales de Dropi - metodo delta de stock)
echo ============================================================
echo.

echo [PASO 1/5] Verificando sesion de Dropi...
call node scripts\local-snapshot.js --check
if errorlevel 1 goto login2fa
goto paso2

:login2fa
echo.
echo   LA SESION EXPIRO. Se abre Chrome. Si configuro totp_secret en
echo   config\credenciales.json el login es 100% automatico (usuario,
echo   clave y clave dinamica los ingresa el sistema solo). Si no,
echo   tipa ahi el codigo de Google Authenticator (la ventana NO se
echo   cierra sola, tienes 30 minutos; variable DROPANALYTICS_2FA_MIN
echo   para cambiar ese tiempo).
call node scripts\local-snapshot.js --login
if errorlevel 1 goto fin

:paso2
echo.
echo [PASO 2/5] Extrayendo catalogos de los 51 proveedores...
echo   (si la sesion expira, se abrira Chrome: tipea el codigo 2FA ahi)
call node scripts\local-snapshot.js --all

echo.
echo [PASO 3/5] Calculando ventas (delta de stock ayer vs hoy)...
powershell -ExecutionPolicy Bypass -File scripts\analyze.ps1

echo.
echo [PASO 4/5] Informe por categorias (perfumeria, joyas, ropa, calzado, relojes, pijamas)...
echo   CSVs + Excel detallado + HTML (IDs copiables) + PDF
call node scripts\categorias-analisis.js --pdf

echo.
echo [PASO 5/5] Abriendo dashboard e informe...
start "" "dashboard\index.html"
start "" "data\analysis\categorias\informe-categorias.html"

echo.
echo ============================================================
echo   LISTO! Se abrieron el dashboard y el informe por categorias.
echo   Entregables de hoy en data\analysis\categorias\:
echo     informe-categorias.html / .pdf       (informe navegable / PDF)
echo     informe-categorias-detallado.xlsx     (Info+Resumen+6 hojas+Top ventas)
echo     {categoria}-catalogo-*.csv + resumen-*.json
echo   Si la sesion expiro a mitad del proceso, vuelve a correr
echo   este archivo: reanuda donde quedo (no repite lo capturado).
echo ============================================================
pause
goto :eof

:fin
echo.
echo ============================================================
echo   NO SE PUDO COMPLETAR EL LOGIN 2FA (30 min sin codigo).
echo   Vuelve a correr este archivo y tipa el codigo cuando
echo   Chrome lo pida (o configura totp_secret en
echo   config\credenciales.json para que sea automatico).
echo ============================================================
pause

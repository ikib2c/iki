@echo off
chcp 65001 >nul
title DropAnalytics - Rutina Automatica (Programador de tareas)
cd /d "%~dp0"

rem Rutina DESATENDIDA para el Programador de tareas de Windows:
rem   - sin pausas, no abre dashboards, todo queda en el log
rem   - si configuro totp_secret en config\credenciales.json, cuando la sesion
rem     expira el sistema se reloguea SOLO (calcula la clave dinamica tipo
rem     Google Authenticator) y la rutina sigue completa sin nadie en el PC.
rem   - sin totp_secret: DROPANALYTICS_DESATENDIDA=1 hace que NO espere el 2FA
rem     (nadie en el PC): regenera los informes con la ultima data, escribe
rem     el aviso en el log y muestra un popup que permite lanzar
rem     RUN-DIARIO.bat (login 2FA) con un clic. Define la variable
rem     DROPANALYTICS_SIN_AVISO=1 para silenciar el popup (pruebas).
rem Tarea programada: "DropAnalytics Rutina Diaria" - diario 07:00 y 19:00
rem Log: data\state\run-auto.log

set DROPANALYTICS_DESATENDIDA=1
set LOG=data\state\run-auto.log
if not exist data\state mkdir data\state

call :ts
echo. >> %LOG%
echo =============== [%TS%] INICIO RUN AUTOMATICO =============== >> %LOG%

call :ts
echo [%TS%] Verificando sesion de Dropi... >> %LOG%
call node scripts\local-snapshot.js --check >> %LOG% 2>&1
if errorlevel 1 goto sinSesion

call :ts
echo [%TS%] Sesion OK - extrayendo catalogos, Chromium visible en pantalla, es normal... >> %LOG%
call node scripts\local-snapshot.js --all >> %LOG% 2>&1
if errorlevel 1 goto aviso_parcial
goto analisis

:aviso_parcial
call :ts
echo [%TS%] AVISO: la extraccion corto a mitad - se analiza lo capturado, la proxima corrida reanuda donde quedo >> %LOG%

:analisis
call :ts
echo [%TS%] PASO analisis: calculando ventas por delta de stock... >> %LOG%
powershell -ExecutionPolicy Bypass -File scripts\analyze.ps1 >> %LOG% 2>&1

call :ts
echo [%TS%] PASO informe: CSVs + Excel detallado + HTML con IDs copiables + PDF... >> %LOG%
call node scripts\categorias-analisis.js --pdf >> %LOG% 2>&1

call :ts
echo [%TS%] RUN AUTOMATICO COMPLETADO >> %LOG%
goto fin

:sinSesion
call :ts
echo [%TS%] ! SESION DE DROPI EXPIRADA y no se pudo reloguer automatico (falta totp_secret en config\credenciales.json o fallo) >> %LOG%
echo [%TS%] Regenerando informes con la ultima data capturada... >> %LOG%
powershell -ExecutionPolicy Bypass -File scripts\analyze.ps1 >> %LOG% 2>&1
call node scripts\categorias-analisis.js --pdf >> %LOG% 2>&1
if defined DROPANALYTICS_SIN_AVISO goto fin
call :ts
echo [%TS%] Mostrando popup de aviso al usuario... >> %LOG%
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\aviso-login.ps1"

:fin
call :ts
echo =============== [%TS%] FIN RUN AUTOMATICO =============== >> %LOG%
goto :eof

:ts
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "TS=%%i"
goto :eof

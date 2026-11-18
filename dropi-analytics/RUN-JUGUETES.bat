@echo off
chcp 65001 >nul
title DropAnalytics - Solo Jugueteria
cd /d "%~dp0"

echo ============================================================
echo   DROPANALYTICS - SNAPSHOT DE JUGUETES (5.200+ productos)
echo ============================================================
echo.

echo [1/3] Extrayendo catalogo de Jugueteria...
call node scripts\local-snapshot.js --toys

echo.
echo [2/3] Ranking de juguetes mas vendidos (delta vs snapshot anterior)...
powershell -ExecutionPolicy Bypass -File scripts\toys-delta.ps1

echo.
echo [3/3] Abriendo resultados...
start "" "data\categories\jugueteria\ranking-juguetes.html"

pause

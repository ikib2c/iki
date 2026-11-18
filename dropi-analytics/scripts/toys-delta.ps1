# ============================================================
# DROPANALYTICS - Ranking de juguetes mas vendidos
# Compara los 2 snapshots mas recientes de data/categories/jugueteria/
# ventas = stock_anterior - stock_hoy   (si > 0)
# Genera: ranking-juguetes.html + ranking-juguetes.csv
# ============================================================
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot '..\data\categories\jugueteria'
$files = Get-ChildItem $dir -Filter '*.json' | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}(-\d{2,4})?\.json$' -and $_.Name -notmatch 'ranking' } | Sort-Object LastWriteTime
# un mismo dia puede tener varios snapshots (parcial + final -HHMM): agrupar por dia,
# quedarse con el ultimo de cada dia y comparar los 2 DIAS distintos mas recientes
$byDay = @{}
foreach ($f in $files) {
    $day = $f.BaseName.Substring(0, 10)
    if (-not $byDay.ContainsKey($day) -or $f.LastWriteTime -gt $byDay[$day].LastWriteTime) { $byDay[$day] = $f }
}
$days = @($byDay.Keys | Sort-Object)
if ($days.Count -lt 2) {
    Write-Output "Solo hay $($days.Count) dia(s) con snapshot. Se necesitan 2 dias distintos para calcular ventas."
    Write-Output "Corre RUN-JUGUETES.bat de nuevo manana (o en unas horas) para el segundo snapshot."
    if ($days.Count -eq 1) {
        $today = (Get-Content -Raw -Encoding UTF8 $byDay[$days[0]].FullName).TrimStart([char]0xFEFF) | ConvertFrom-Json
        Write-Output "Snapshot existente: $($byDay[$days[0]].BaseName) con $($today.Count) juguetes (linea base registrada)."
    }
    exit 0
}
$prevDate = $byDay[$days[-2]].BaseName
$currDate = $byDay[$days[-1]].BaseName
$prev = @{}; foreach ($p in ((Get-Content -Raw -Encoding UTF8 $byDay[$days[-2]].FullName).TrimStart([char]0xFEFF) | ConvertFrom-Json)) { $prev[[string]$p.id] = $p }
$curr = (Get-Content -Raw -Encoding UTF8 $byDay[$days[-1]].FullName).TrimStart([char]0xFEFF) | ConvertFrom-Json

$rows = @()
$sospCount = 0; $sospUnid = 0; $agotados = 0
foreach ($t in $curr) {
    $tid = [string]$t.id
    if ($prev.ContainsKey($tid)) {
        $delta = [int]$prev[$tid].stock - [int]$t.stock
        if ($delta -gt 0) {
            # ---- REGLAS DE VERACIDAD ----
            $aviso = ''
            if ([int]$t.stock -eq 0) { $aviso = 'AGOTADO/RETIRADO?'; $agotados++ }
            elseif ($delta -gt ([int]$prev[$tid].stock * 0.5)) { $aviso = 'CAIDA>50%' }
            if ($aviso -ne '') { $sospCount++; $sospUnid += $delta }
            $rows += [PSCustomObject]@{
                id = $t.id; nombre = $t.name; proveedor = $t.supplier; proveedor_id = $t.supplier_id
                vendidas = $delta; stock_antes = $prev[$tid].stock; stock_hoy = $t.stock
                precio_proveedor = $t.sale_price; precio_sugerido = $t.suggested_price
                categorias = $t.categories; aviso = $aviso
            }
        }
    }
}
$rows = $rows | Sort-Object vendidas -Descending
$total = ($rows | Measure-Object -Property vendidas -Sum).Sum
if ($null -eq $total) { $total = 0 }
$confUnid = $total - $sospUnid

# tier list S/A/B/C/D (velocidad x margen, D = sospechoso por veracidad)
. "$PSScriptRoot\tier.ps1"
$rows = Add-TierToRows -Rows $rows
Write-Output "Periodo: $prevDate -> $currDate"
Write-Output "Juguetes con ventas: $($rows.Count) | Unidades vendidas: $total"
Write-Output "  confirmadas (reglas de veracidad): $confUnid | sospechosas (retiradas/agotadas/caidas): $sospUnid en $sospCount juguetes"
Write-Output "  productos retirados del catalogo (no cuentan como venta): $($prev.Count - $curr.Count) menos que el snapshot anterior (los que desaparecen no entran al calculo)"
$rows | Export-Csv -Path (Join-Path $dir "ranking-juguetes-$currDate.csv") -NoTypeInformation -Encoding UTF8

# ---------- HTML ----------
Add-Type -AssemblyName System.Web
$trs = ''
$i = 1
$tierColor = @{ S = '#3fb950'; A = '#58a6ff'; B = '#d29922'; C = '#8b949e'; D = '#f85149' }
$tierDesc = @{ S = 'vel p85+ y margen 40%+'; A = 'vel p60+ y margen 30%+'; B = 'vende, sin llegar a A'; C = 'sin ventas'; D = 'sospechoso (veracidad)' }
foreach ($r in ($rows | Select-Object -First 300)) {
    $costo = '$' + ([int]$r.precio_proveedor).ToString('N0')
    $pvp = '$' + ([int]$r.precio_sugerido).ToString('N0')
    $margin = if ($r.precio_sugerido) { '$' + ([int]$r.precio_sugerido - [int]$r.precio_proveedor).ToString('N0') } else { '-' }
    $nomb = [System.Web.HttpUtility]::HtmlEncode("$($r.nombre)")
    $prov = [System.Web.HttpUtility]::HtmlEncode("$($r.proveedor)")
    $avisoH = if ($r.aviso) { "<span style='color:#d29922;font-size:10px'> &middot; $([System.Web.HttpUtility]::HtmlEncode($r.aviso))</span>" } else { '' }
    $vColor = if ($r.aviso) { '#d29922' } else { '#3fb950' }
    $tc = $tierColor[[string]$r.tier]
    $margenH = if ($null -ne $r.margen_pct) { "$($r.margen_pct)%" } else { '?' }
    $trs += "<tr><td>$i</td><td><span style='background:$tc;color:#0d1117;font-weight:800;border-radius:4px;padding:1px 7px;font-size:12px' title='$($tierDesc[[string]$r.tier])'>$($r.tier)</span></td><td><b>$nomb</b>$avisoH<div style='color:#f1c40f;font-family:monospace;font-size:11px'>ID $($r.id)</div></td><td>$prov</td><td style='color:$vColor;font-weight:700'>$($r.vendidas)</td><td>$($r.stock_antes) &rarr; $($r.stock_hoy)</td><td>$costo</td><td>$pvp</td><td>$margin <span style='color:#8b949e;font-size:11px'>($margenH)</span></td></tr>"
    $i++
}
$html = @"
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Ranking Juguetes Dropi</title>
<style>body{background:#0d1117;color:#e6edf3;font-family:'Segoe UI',sans-serif;max-width:1100px;margin:0 auto;padding:24px}
h1{font-size:20px}h1 span{color:#58a6ff}.sub{color:#8b949e;font-size:12px;margin:4px 0 18px}
table{width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
th{background:#1c2129;color:#8b949e;text-align:left;padding:9px 12px;font-size:11px;text-transform:uppercase}
td{padding:8px 12px;border-top:1px solid #30363d}tr:hover td{background:#1a2029}
.pos{color:#3fb950;font-weight:700}.kpis{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.kpi{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 18px}.kpi .v{font-size:20px;color:#58a6ff;font-weight:700}.kpi .l{font-size:10px;color:#8b949e;text-transform:uppercase}</style></head><body>
<h1>Drop<span>Analytics</span> â€” Juguetes mas vendidos en Dropi</h1>
<div class="sub">Periodo: $prevDate &rarr; $currDate &middot; ventas = reduccion de stock &middot; reposiciones (stock que sube) se descartan</div>
<div class="kpis">
<div class="kpi"><div class="l">Unidades vendidas</div><div class="v">$total</div></div>
<div class="kpi"><div class="l">Juguetes con ventas</div><div class="v">$($rows.Count)</div></div>
<div class="kpi"><div class="l">Catalogo monitoreado</div><div class="v">$($curr.Count)</div></div>
</div>
<table><tr><th>#</th><th>Tier</th><th>Producto</th><th>Proveedor</th><th>Vendidas</th><th>Stock</th><th>Costo</th><th>PVP sugg.</th><th>Margen</th></tr>$trs</table>
<div style="color:#8b949e;font-size:11px;margin-top:14px">Tier: <b style="color:#3fb950">S</b> velocidad p85+ y margen &ge;40% &middot; <b style="color:#58a6ff">A</b> p60+ y margen &ge;30% &middot; <b style="color:#d29922">B</b> vende sin llegar a A &middot; <b style="color:#8b949e">C</b> sin ventas &middot; <b style="color:#f85149">D</b> marcado por reglas de veracidad</div>
<div style="color:#8b949e;font-size:11px;margin-top:6px">Fuente: catalogo publico de Dropi Colombia (categoria Jugueteria, $($curr.Count) productos) &middot; CSV: data/categories/jugueteria/ranking-juguetes-$currDate.csv</div>
</body></html>
"@
$htmlPath = Join-Path $dir 'ranking-juguetes.html'
$html | Out-File -FilePath $htmlPath -Encoding utf8
Write-Output "OK -> $htmlPath"
Write-Output "OK -> ranking-juguetes-$currDate.csv"

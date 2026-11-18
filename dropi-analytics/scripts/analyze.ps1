# ============================================================
# DROPANALYTICS - Motor de analisis (deltas de stock)
# ventas(producto, dia) = stock(dia-1) - stock(dia)   [si > 0]
# Genera: dashboard/data.js + CSVs en data/analysis/
# ============================================================

param(
    [string]$DataDir = "",
    [int]$TopN = 100
)
if (-not $DataDir) { $DataDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath) }
$SuppliersDir = Join-Path $DataDir 'data\suppliers'
$AnalysisDir = Join-Path $DataDir 'data\analysis'
$DashDir = Join-Path $DataDir 'dashboard'
$CfgFile = Join-Path $DataDir 'config\suppliers.json'
New-Item -ItemType Directory -Force -Path $AnalysisDir | Out-Null

# ---------- cargar snapshots ----------
$cfg = @{}
try { foreach ($s in ((Get-Content -Raw $CfgFile | ConvertFrom-Json).proveedores)) { $cfg[[string]$s.id] = $s } } catch {}

$provDirs = Get-ChildItem $SuppliersDir -Directory
$allDates = @{}
$series = @{}   # productId -> @{ name; supplier_id; sale_price; suggested_price; days: @{date -> stock} }
$provInfo = @{} # sid -> @{ nombre; ciudad; productos; fechas }

foreach ($pd in $provDirs) {
    $sid = $pd.Name
    $files = Get-ChildItem $pd.FullName -Filter '*.json' | Sort-Object Name
    if ($files.Count -eq 0) { continue }
    $pinfo = @{ nombre = $sid; ciudad = ''; productos = 0; fechas = @() }
    if ($cfg.ContainsKey($sid)) { $pinfo.nombre = $cfg[$sid].nombre; $pinfo.ciudad = $cfg[$sid].ciudad; $pinfo.pedidos_mes = [int]$cfg[$sid].pedidos_mes }
    foreach ($f in $files) {
        $date = $f.BaseName
        $allDates[$date] = $true
        $pinfo.fechas += $date
        try {
            $prods = (Get-Content -Raw -Encoding UTF8 $f.FullName).TrimStart([char]0xFEFF) | ConvertFrom-Json
            foreach ($p in $prods) {
                $prodId = [string]$p.id
                if (-not $series.ContainsKey($prodId)) {
                    $series[$prodId] = @{ name = $p.name; sku = $p.sku; type = $p.type; supplier_id = $sid; sale_price = $p.sale_price; suggested_price = $p.suggested_price; imagenes = $p.imagenes; days = @{} }
                }
                $series[$prodId].days[$date] = [int]$p.stock
                if ($p.sale_price) { $series[$prodId].sale_price = $p.sale_price }
                if ($p.imagenes -and @($p.imagenes).Count -gt 0) { $series[$prodId].imagenes = $p.imagenes }  # fotos del snapshot mas reciente
            }
        } catch {}
    }
    $pinfo.fechas = @($pinfo.fechas | Sort-Object -Unique)
    $pinfo.productos = ($series.Values | Where-Object { $_.supplier_id -eq $sid }).Count
    $provInfo[$sid] = $pinfo
}
$dates = @($allDates.Keys | Sort-Object)
if ($dates.Count -eq 0) { Write-Output 'No hay snapshots. Ejecutar snapshot.ps1 primero.'; exit 1 }
Write-Output "Fechas disponibles: $($dates -join ', ') | productos unicos: $($series.Count)"

# ---------- calcular ventas por dia ----------
# ventas[pid][date] = stock(foto previa DEL PRODUCTO) - stock(foto actual)  si > 0
# (fechas propias de cada producto: un proveedor sin foto de una fecha intermedia no pierde su delta)
$ventas = @{}
foreach ($prodId in $series.Keys) {
    $v = @{}
    $pd = @($series[$prodId].days.Keys | Sort-Object)
    for ($i = 1; $i -lt $pd.Count; $i++) {
        $d0 = $pd[$i - 1]; $d1 = $pd[$i]
        $delta = $series[$prodId].days[$d0] - $series[$prodId].days[$d1]
        if ($delta -gt 0) { $v[$d1] = $delta }
    }
    if ($v.Count -gt 0) { $ventas[$prodId] = $v }
}

# ---------- rankings ----------
$lastDate = $dates[-1]
$prevDate = if ($dates.Count -ge 2) { $dates[-2] } else { $null }

# libreria de tier list (S/A/B/C)
. "$PSScriptRoot\tier.ps1"

function Build-Row($prodId) {
    $s = $series[$prodId]
    $lastStock = $s.days[$lastDate]
    $sid = $s.supplier_id
    $pName = if ($provInfo.ContainsKey($sid)) { $provInfo[$sid].nombre } else { $sid }
    $city = if ($provInfo.ContainsKey($sid)) { $provInfo[$sid].ciudad } else { '' }
    return [PSCustomObject]@{
        id = [int]$prodId; nombre = $s.name; proveedor = $pName; proveedor_id = [int]$sid; ciudad = $city
        tipo = $s.type; precio_proveedor = $s.sale_price; precio_sugerido = $s.suggested_price
        imagenes = $s.imagenes
        stock = $lastStock
    }
}

$rankingHoy = @()
$rankingTotal = @()
foreach ($prodId in $ventas.Keys) {
    $v = $ventas[$prodId]
    $hoy = if ($v.ContainsKey($lastDate)) { $v[$lastDate] } else { 0 }
    $total = 0; foreach ($k in $v.Keys) { $total += $v[$k] }
    $pDates = @($series[$prodId].days.Keys | Sort-Object)
    $elapsed = [Math]::Max(1, ([datetime]$pDates[-1] - [datetime]$pDates[0]).Days)   # dias reales entre primera y ultima foto del producto
    $r = Build-Row $prodId
    if ($hoy -gt 0) { $rankingHoy += $r | Add-Member -PassThru -Force -NotePropertyName vendidas_hoy -NotePropertyValue $hoy | Add-Member -PassThru -Force -NotePropertyName vendidas_total -NotePropertyValue $total }
    $r2 = $r.PSObject.Copy()
    $rankingTotal += $r2 | Add-Member -PassThru -Force -NotePropertyName vendidas_hoy -NotePropertyValue $hoy | Add-Member -PassThru -Force -NotePropertyName vendidas_total -NotePropertyValue $total | Add-Member -PassThru -Force -NotePropertyName vendidas_dia -NotePropertyValue ([int][Math]::Round($total / $elapsed))
}
# tier list: hoy usa velocidad del dia; total usa promedio por dia
$rankingHoy = Add-TierToRows -Rows ($rankingHoy | Sort-Object vendidas_hoy -Descending | Select-Object -First $TopN) -VelocityField 'vendidas_hoy'
$rankingTotal = Add-TierToRows -Rows ($rankingTotal | Sort-Object vendidas_total -Descending | Select-Object -First $TopN) -VelocityField 'vendidas_dia'
$rankingHoy = $rankingHoy | Sort-Object vendidas_hoy -Descending
$rankingTotal = $rankingTotal | Sort-Object vendidas_total -Descending

# ventas por proveedor hoy
$provHoy = @()
foreach ($sid in $provInfo.Keys) {
    $uds = 0; $prodsActivos = 0
    foreach ($prodId in $ventas.Keys) {
        if ($series[$prodId].supplier_id -eq $sid) {
            if ($ventas[$prodId].ContainsKey($lastDate)) { $uds += $ventas[$prodId][$lastDate]; $prodsActivos++ }
        }
    }
    $provHoy += [PSCustomObject]@{ id = [int]$sid; nombre = $provInfo[$sid].nombre; ciudad = $provInfo[$sid].ciudad; pedidos_mes = $provInfo[$sid].pedidos_mes; productos = $provInfo[$sid].productos; unidades_hoy = $uds; productos_activos = $prodsActivos }
}
$provHoy = $provHoy | Sort-Object unidades_hoy -Descending

$ventasPorDia = @{}
for ($i = 1; $i -lt $dates.Count; $i++) {
    $d1 = $dates[$i]; $tot = 0
    foreach ($prodId in $ventas.Keys) { if ($ventas[$prodId].ContainsKey($d1)) { $tot += $ventas[$prodId][$d1] } }
    $ventasPorDia[$d1] = $tot
}

# ---------- salidas ----------
$rankingHoy | Export-Csv -Path (Join-Path $AnalysisDir "top-productos-$lastDate.csv") -NoTypeInformation -Encoding UTF8
$provHoy | Export-Csv -Path (Join-Path $AnalysisDir "proveedores-$lastDate.csv") -NoTypeInformation -Encoding UTF8

$productosOut = @()
foreach ($prodId in $rankingTotal) {
    $s = $series[[string]$prodId.id]
    $serie = @()
    foreach ($d in $dates) { if ($null -ne $s.days[$d]) { $serie += @{ d = $d; s = $s.days[$d]; v = $(if ($ventas.ContainsKey([string]$prodId.id) -and $ventas[[string]$prodId.id].ContainsKey($d)) { $ventas[[string]$prodId.id][$d] } else { 0 }) } } }
    $productosOut += @{ id = $prodId.id; nombre = $prodId.nombre; proveedor = $prodId.proveedor; proveedor_id = $prodId.proveedor_id; ciudad = $prodId.ciudad; precio_proveedor = $prodId.precio_proveedor; precio_sugerido = $prodId.precio_sugerido; imagenes = $prodId.imagenes; stock = $prodId.stock; vendidas_hoy = $prodId.vendidas_hoy; vendidas_total = $prodId.vendidas_total; serie = $serie }
}

$payload = @{
    generado = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
    fecha = $lastDate
    fechas = $dates
    totales = @{ productos_monitor = $series.Count; unidades_hoy = $ventasPorDia[$lastDate]; proveedores_con_ventas = @($provHoy | Where-Object { $_.unidades_hoy -gt 0 }).Count }
    ranking_hoy = $rankingHoy
    ranking_total = $rankingTotal
    proveedores = $provHoy
    ventas_por_dia = $ventasPorDia
    productos = $productosOut
}
$json = $payload | ConvertTo-Json -Depth 6 -Compress
$jsFile = Join-Path $DashDir 'data.js'
"const DASH_DATA = $json;" | Set-Content -Path $jsFile -Encoding UTF8
Write-Output "OK -> $jsFile ($([Math]::Round((Get-Item $jsFile).Length / 1KB, 1)) KB)"
Write-Output "OK -> CSVs en $AnalysisDir"
Write-Output "Unidades vendidas hoy ($lastDate): $($ventasPorDia[$lastDate]) | ranking hoy: $($rankingHoy.Count) productos"

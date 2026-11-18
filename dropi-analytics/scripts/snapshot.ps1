# ============================================================
# DROPANALYTICS - Snapshot diario de catalogo Dropi
# Extrae productos+stock por proveedor via firecrawl (perfil dropi-iki)
# Ventas = delta de stock entre snapshots (metodo dropdata)
# ============================================================
# Uso:
#   .\snapshot.ps1                        -> todos los proveedores de config (reanudable)
#   .\snapshot.ps1 -SupplierId 205895     -> un solo proveedor
#   .\snapshot.ps1 -MaxPagesPerSession 6  -> mas conservador con sesiones
# Requisito: sesion Dropi activa (JWT valido ~12h). Si expiro, hacer login asistido primero.

param(
    [int]$SupplierId = 0,
    [int]$MaxPagesPerSession = 8,
    [string]$DataDir = ""
)

$ErrorActionPreference = 'Continue'
if (-not $DataDir) { $DataDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath) }
$SuppliersDir = Join-Path $DataDir 'data\suppliers'
$StateDir = Join-Path $DataDir 'data\state'
$CfgFile = Join-Path $DataDir 'config\suppliers.json'
$LogFile = Join-Path $DataDir ("snapshot-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")

function Log($msg) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
    Write-Output $line
    Add-Content -Path $LogFile -Value $line
}

New-Item -ItemType Directory -Force -Path $SuppliersDir, $StateDir | Out-Null
if (-not (Test-Path $CfgFile)) { Log "ERROR: no existe $CfgFile"; exit 1 }

$today = Get-Date -Format 'yyyy-MM-dd'
$cfg = Get-Content -Raw $CfgFile | ConvertFrom-Json
$targets = @()
if ($SupplierId -gt 0) {
    $targets = @($cfg.proveedores | Where-Object { $_.id -eq $SupplierId })
    if ($targets.Count -eq 0) { $targets = @([PSCustomObject]@{ id = $SupplierId; nombre = "ID $SupplierId" }) }
} else {
    $targets = $cfg.proveedores
}

# ---------- checkpoint ----------
$cpFile = Join-Path $StateDir 'snapshot-state.json'
$cp = @{ date = $today; done = @(); current = $null; pages = 0 }
if (Test-Path $cpFile) {
    try {
        $prev = Get-Content -Raw $cpFile | ConvertFrom-Json
        if ($prev.date -eq $today) { $cp = @{ date = $prev.date; done = @($prev.done); current = $prev.current; pages = $prev.pages } }
    } catch {}
}
function Save-Checkpoint {
    $cp | ConvertTo-Json -Depth 4 | Set-Content -Path $cpFile -Encoding UTF8
}

# ---------- sesion firecrawl ----------
function New-Session([int]$supId, [string]$slug) {
    $url = "https://app.dropi.co/dashboard/provider/$supId/$slug"
    $out = & firecrawl scrape $url --profile dropi-iki -o "$env:TEMP\dp-scrape-out.md" 2>&1
    if ($LASTEXITCODE -ne 0) { Log "scrape fallo: $out"; return $false }
    Start-Sleep -Seconds 2
    $code = "{ await page.waitForTimeout(3500); const u = page.url(); console.log('CHECK|' + (u.indexOf('dashboard') >= 0 ? 'OK' : 'LOGIN') + '|' + u); }"
    $res = & firecrawl interact -c $code --timeout 45 2>&1
    if ("$res" -match 'CHECK\|LOGIN') { Log "SESION EXPIRADA: hay que hacer login asistido (2FA) y volver a ejecutar"; return $false }
    if ("$res" -notmatch 'CHECK\|OK') { Log "check ambiguo: $res"; return $false }
    return $true
}

# ---------- cosecha de productos (tecnica de intercepcion probada) ----------
function Invoke-Harvest([int]$supId, [int]$startPage, [int]$maxPages) {
    # devuelve: @{ products = @(...); pages = n; empty = bool }
    $rid = -join ((97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
    $js = "{ let ${rid}_n = $startPage; const ${rid}_pages = []; let ${rid}_empty = false; let ${rid}_count = 0; await page.unroute('**/products/v4/index').catch(() => {}); await page.route('**/products/v4/index', async route => { try { const d = route.request().postDataJSON(); d.supplier_id = $supId; d.pageSize = 100; d.startData = ${rid}_n * 100; d.no_count = false; d.order_by = 'id'; d.order_type = 'asc'; await route.continue({postData: JSON.stringify(d)}); ${rid}_n++; } catch(e) { await route.continue(); } }); page.on('response', async r => { if (r.url().indexOf('products/v4/index') >= 0) { const t = await r.text().catch(() => 'err'); ${rid}_pages.push(t); try { const j = JSON.parse(t); if (!j.objects || j.objects.length === 0) { ${rid}_empty = true; } else { ${rid}_count += j.objects.length; } } catch(e) {} } }); await page.reload({waitUntil: 'networkidle'}).catch(() => {}); await page.waitForTimeout(4000); for (let i = 0; i < $maxPages && !${rid}_empty; i++) { await page.reload({waitUntil: 'networkidle'}).catch(() => {}); await page.waitForTimeout(2500); } console.log('META|pages:' + ${rid}_pages.length + '|empty:' + ${rid}_empty + '|prods:' + ${rid}_count); console.log('===DATA_START==='); console.log(${rid}_pages.join('[[PAGEBREAK]]')); console.log('===DATA_END===') }"
    $tmpOut = "$env:TEMP\dp-harvest-$rid.txt"
    & firecrawl interact -c $js --timeout 240 -o $tmpOut 2>&1 | Out-Null
    if (-not (Test-Path $tmpOut)) { Log "harvest sin salida"; return @{ products = @(); pages = 0; empty = $false } }
    $raw = Get-Content -Raw $tmpOut
    Remove-Item $tmpOut -Force -ErrorAction SilentlyContinue
    $meta = @{ pages = 0; empty = $false }
    if ($raw -match 'META\|pages:(\d+)\|empty:(\w+)') { $meta.pages = [int]$Matches[1]; $meta.empty = ($Matches[2] -eq 'true') }
    $products = @()
    $s = $raw.IndexOf('===DATA_START===')
    if ($s -ge 0) {
        $e = $raw.IndexOf('===DATA_END===')
        if ($e -lt 0) { $e = $raw.Length }
        $data = $raw.Substring($s + 17, $e - $s - 17).Trim()
        foreach ($p in ($data -split '\[\[PAGEBREAK\]\]')) {
            try {
                $j = $p | ConvertFrom-Json
                if ($j.objects) {
                    foreach ($o in $j.objects) {
                        $stock = 0
                        if ($o.type -eq 'SIMPLE') { if ($o.warehouse_product) { foreach ($w in $o.warehouse_product) { $stock += $w.stock } } }
                        else { if ($o.variations) { foreach ($v in $o.variations) { $stock += $v.stock } } }
                        # imagenes: tolerante — absolutas (urlImage/image/...), rutas S3 relativas
                        # (gallery[i].urlS3 como en el BFF real) y objetos {url|urlS3}; espacios -> %20
                        $rawImgs = @()
                        foreach ($g in (@($o.urlImage, $o.url_image, $o.image) + @($o.images) + @($o.multimedia) + @($o.gallery) + @($o.photos))) {
                            if ($g -is [string]) { $rawImgs += $g }
                            elseif ($g) { $rawImgs += @($g.urlS3, $g.url, $g.urlImage) }
                        }
                        $imagenes = $rawImgs | Where-Object { $_ } | ForEach-Object {
                            $u = [string]$_
                            if ($u -match '^(colombia|mexico)/') { 'https://dropi.s3.amazonaws.com/' + $u }
                            else { $u }
                        } | ForEach-Object { $_ -replace ' ', '%20' } | Select-Object -Unique -First 6
                        $products += [PSCustomObject]@{ id = $o.id; sku = $o.sku; name = $o.name; type = $o.type; sale_price = $o.sale_price; suggested_price = $o.suggested_price; imagenes = $imagenes; stock = $stock }
                    }
                }
            } catch {}
        }
    }
    return @{ products = $products; pages = $meta.pages; empty = $meta.empty }
}

# ---------- loop principal ----------
$doneHash = @{}
foreach ($d in $cp.done) { $doneHash[[string]$d] = $true }

foreach ($t in $targets) {
    $sid = [int]$t.id
    $sname = $t.nombre
    $supDir = Join-Path $SuppliersDir $sid
    $dayFile = Join-Path $supDir "$today.json"
    if ($doneHash.ContainsKey([string]$sid) -and (Test-Path $dayFile)) { Log "SKIP $sname (ya capturado hoy)"; continue }
    New-Item -ItemType Directory -Force -Path $supDir | Out-Null
    $slug = $t.slug
    if (-not $slug) { $slug = ($t.nombre -replace '[^a-zA-Z0-9]', '').ToLower() }
    if (-not $slug) { $slug = 'p' }
    Log "== INICIO $sname (id $sid) =="

    # reanudar productos ya capturados hoy (si venimos de un fallo)
    $allProducts = @()
    $pmap = @{}
    if (Test-Path $dayFile) {
        try { foreach ($p in (Get-Content -Raw $dayFile | ConvertFrom-Json)) { $pmap[[string]$p.id] = $true; $allProducts += $p } } catch {}
        Log "reanudando con $($allProducts.Count) productos ya guardados"
    }
    $startPage = 0
    $finished = $false
    $sessionFails = 0
    while (-not $finished -and $sessionFails -lt 3) {
        if (-not (New-Session $sid $slug)) { $sessionFails = 3; break }
        Start-Sleep -Seconds 5
        $h = Invoke-Harvest $sid $startPage $MaxPagesPerSession
        $newProds = 0
        foreach ($p in $h.products) {
            if (-not $pmap.ContainsKey([string]$p.id)) { $pmap[[string]$p.id] = $true; $allProducts += $p; $newProds++ }
        }
        Log "   sesion: $($h.pages) paginas, $($h.products.Count) productos leidos, $newProds nuevos (total $($allProducts.Count))"
        if ($h.empty) { $finished = $true }
        elseif ($h.products.Count -eq 0) { $sessionFails++; Log "   sin productos, reintento ($sessionFails/3) tras pausa"; Start-Sleep -Seconds 30 }
        else { $startPage += $h.pages; Start-Sleep -Seconds 3 }
        # guardar progreso parcial
        $allProducts | ConvertTo-Json -Depth 4 | Set-Content -Path $dayFile -Encoding UTF8
    }
    if ($finished -or $allProducts.Count -gt 0) {
        if (-not $doneHash.ContainsKey([string]$sid)) { $cp.done += $sid; $doneHash[[string]$sid] = $true }
        Save-Checkpoint
        Log "== FIN $sname : $($allProducts.Count) productos -> $dayFile (completo: $finished) =="
    } else {
        Log "== FALLO $sname (reintentar ejecutando de nuevo) =="
    }
}
Log "SNAPSHOT TERMINADO"

# ============================================================
# DROPANALYTICS - Libreria de Tier List S/A/B/C (compartida)
# Dot-source desde analyze.ps1 y toys-delta.ps1:
#   . "$PSScriptRoot\tier.ps1"
# Reglas (transparentes y ajustables):
#   S : velocidad >= p85 del ranking Y margen >= 40% (o n/d)
#   A : velocidad >= p60 Y margen >= 30% (o n/d)
#   B : tiene ventas pero no llega a A
#   C : sin ventas en el periodo
#   D : marcado por reglas de veracidad (retirado/agotado/sospechoso)
# ============================================================
function Add-TierToRows {
    param(
        $Rows,
        [string]$VelocityField = 'vendidas'
    )
    if (-not $Rows -or @($Rows).Count -eq 0) { return @() }
    $Rows = @($Rows)
    $vels = @($Rows | ForEach-Object { [double]$_.PSObject.Properties[$VelocityField].Value } | Sort-Object)
    if ($vels.Count -eq 0) { return $Rows }
    function Get-PctValue($arr, [double]$p) {
        $i = [Math]::Ceiling($p * $arr.Count) - 1
        if ($i -lt 0) { $i = 0 }
        return [double]$arr[[Math]::Min($i, $arr.Count - 1)]
    }
    $p85 = Get-PctValue $vels 0.85
    $p60 = Get-PctValue $vels 0.60
    foreach ($r in $Rows) {
        $v = [double]($r.PSObject.Properties[$VelocityField].Value)
        $costo = $r.PSObject.Properties['precio_proveedor'].Value
        $pvp = $r.PSObject.Properties['precio_sugerido'].Value
        $mr = $null
        if ($pvp -and [double]$pvp -gt 0 -and $null -ne $costo) {
            $mr = ([double]$pvp - [double]$costo) / [double]$pvp
        }
        $tier = 'C'
        if ($v -gt 0) {
            if ($v -ge $p85 -and ($null -eq $mr -or $mr -ge 0.40)) { $tier = 'S' }
            elseif ($v -ge $p60 -and ($null -eq $mr -or $mr -ge 0.30)) { $tier = 'A' }
            else { $tier = 'B' }
        }
        $aviso = $r.PSObject.Properties['aviso'].Value
        if ($aviso) { $tier = 'D' }
        $r | Add-Member -Force -NotePropertyName tier -NotePropertyValue $tier
        $r | Add-Member -Force -NotePropertyName margen_pct -NotePropertyValue $(if ($null -ne $mr) { [int][Math]::Round($mr * 100) } else { $null })
    }
    return $Rows
}

# DropAnalytics - Aviso emergente cuando la sesion de Dropi expiro en una corrida automatica
# Lo lanza RUN-AUTO.bat. Popup con auto-cierre en 1h; "Si" abre RUN-DIARIO.bat
# (que verifica sesion y hace el login asistido: tipear el codigo 2FA en Chrome).

$sh = New-Object -ComObject WScript.Shell
$nl = [Environment]::NewLine
$msg = "DropAnalytics: la sesion de Dropi expiro (dura ~12h).$nl$nl" +
       "No se pudo re-loguear automatico (falta totp_secret en config\credenciales.json o fallo).$nl" +
       "Los informes ya se regeneraron con la ultima data capturada.$nl" +
       "Para volver a capturar hay que renovar la sesion con el codigo 2FA (30 segundos).$nl$nl" +
       "Renovar ahora? Se abrira RUN-DIARIO: Chrome pide el codigo de Google Authenticator.$nl$nl" +
       "TIP: configurar totp_secret (ver config\credenciales.json) hace el login 100% automatico y este popup deja de aparecer."
$r = $sh.Popup($msg, 3600, "DropAnalytics - Sesion expirada", 4 + 48)   # 4=Si/No, 48=advertencia, timeout 3600s
if ($r -eq 6) {
    Start-Process cmd -ArgumentList '/c RUN-DIARIO.bat' -WorkingDirectory (Join-Path $PSScriptRoot '..')
}

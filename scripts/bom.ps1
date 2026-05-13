$f = "c:\work\clawpanel-main\clawpanel-main\clawpanel-main\scripts\install-openclaw.ps1"
$c = [System.IO.File]::ReadAllText($f)
$bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($f, $c, $bom)
Write-Host "BOM OK"

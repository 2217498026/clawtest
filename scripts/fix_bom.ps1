$target = "c:\work\clawpanel-main\clawpanel-main\clawpanel-main\scripts\install-openclaw.ps1"
$utf8 = [System.Text.Encoding]::UTF8
$bytes = [System.IO.File]::ReadAllBytes($target)
# BOM = 0xEF 0xBB 0xBF
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    Write-Host "BOM already present"
    exit 0
}
$content = $utf8.GetString($bytes)
$bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($target, $content, $bom)
Write-Host "BOM added"

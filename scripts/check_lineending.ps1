$f = "c:\work\clawpanel-main\clawpanel-main\clawpanel-main\scripts\install_openclaw.bat"
$raw = [System.IO.File]::ReadAllBytes($f)
Write-Host "File size: $($raw.Length) bytes"
Write-Host "First 30 bytes:"
for ($i = 0; $i -lt 30; $i++) {
    Write-Host ("  [{0,3}] 0x{1:X2} ({2})" -f $i, $raw[$i], [char]$raw[$i])
}
$crCount = 0
$lfCount = 0
$crlfPairs = 0
$i = 0
while ($i -lt $raw.Length) {
    if ($raw[$i] -eq 0x0D) { $crCount++ }
    if ($raw[$i] -eq 0x0A) { $lfCount++ }
    if ($i -lt ($raw.Length - 1) -and $raw[$i] -eq 0x0D -and $raw[$i+1] -eq 0x0A) { $crlfPairs++; $i++ }
    $i++
}
Write-Host "CR count: $crCount"
Write-Host "LF count: $lfCount"
Write-Host "CRLF pairs: $crlfPairs"

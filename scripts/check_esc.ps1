$f = "c:\work\clawpanel-main\clawpanel-main\clawpanel-main\scripts\install_openclaw.bat"
$raw = [System.IO.File]::ReadAllBytes($f)

# Search for ESC byte (0x1B)
for ($i = 0; $i -lt $raw.Length; $i++) {
    if ($raw[$i] -eq 0x1B) {
        Write-Host "Found ESC (0x1B) at byte index $i"
        $start = [Math]::Max(0, $i - 10)
        $end = [Math]::Min($raw.Length - 1, $i + 15)
        for ($j = $start; $j -le $end; $j++) {
            $c = [char]$raw[$j]
            if ($raw[$j] -lt 0x20 -or $raw[$j] -gt 0x7E) {
                $c = "."
            }
            Write-Host ("  [{0,4}] 0x{1:X2} '{2}'" -f $j, $raw[$j], $c)
        }
        break
    }
}

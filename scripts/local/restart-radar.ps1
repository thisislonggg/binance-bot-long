<#
  Jalankan ulang Radar P2P sepenuhnya (wajib setelah mengubah file .env).
  Pemakaian: powershell -ExecutionPolicy Bypass -File scripts\local\restart-radar.ps1
#>
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

# "\start-radar.ps1" (dengan backslash) agar tidak ikut cocok dengan skrip ini sendiri (restart-radar.ps1).
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*\start-radar.ps1*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*$($root.Path)\.output\server\index.mjs*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 2

if (Get-ScheduledTask -TaskName "Radar P2P" -ErrorAction SilentlyContinue) {
  Start-ScheduledTask -TaskName "Radar P2P"
} else {
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $root 'scripts\local\start-radar.ps1')`""
}
Write-Host "Radar P2P dijalankan ulang. Buka http://localhost:3000 dalam beberapa detik."

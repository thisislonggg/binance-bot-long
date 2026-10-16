<#
  Ambil kode terbaru dari GitHub, build ulang, lalu jalankan ulang Radar P2P.
  Pemakaian: powershell -ExecutionPolicy Bypass -File scripts\local\update-radar.ps1
#>
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

Write-Host "1/4 Mengambil kode terbaru..."
git pull --ff-only
if ($LASTEXITCODE -ne 0) { Write-Host "git pull gagal (ada perubahan lokal?). Update dibatalkan."; exit 1 }

Write-Host "2/4 Memasang dependensi..."
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
npm ci
if ($LASTEXITCODE -ne 0) { Write-Host "npm ci gagal. Update dibatalkan."; exit 1 }

Write-Host "3/4 Build (server tetap berjalan dengan versi lama selama build)..."
$env:NITRO_PRESET = "node-server"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Build gagal. Versi lama tetap berjalan."; exit 1 }

Write-Host "4/4 Menjalankan ulang server..."
# Hentikan proses node Radar; skrip start-radar.ps1 otomatis menjalankannya lagi dengan build baru.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*$($root.Path)\.output\server\index.mjs*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Selesai. Server akan aktif lagi dalam beberapa detik."

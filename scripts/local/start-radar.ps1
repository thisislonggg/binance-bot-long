<#
  Jalankan Radar P2P di komputer sendiri (pengganti Vercel).

  - Membaca pengaturan dari file .env di folder proyek (format NAMA=nilai, satu per baris).
  - Server otomatis dijalankan ulang bila berhenti/crash.
  - Log harian di folder logs\ (diabaikan git).

  Pemakaian manual:   powershell -ExecutionPolicy Bypass -File scripts\local\start-radar.ps1
  Otomatis saat login: jalankan scripts\local\install-autostart.ps1 sekali.
#>
param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

# Task Scheduler tidak selalu membawa PATH terbaru (node/npm bisa "tidak ditemukan").
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  Add-Content -Path (Join-Path $logDir ("radar-{0}.log" -f (Get-Date -Format "yyyyMMdd"))) -Value $line -Encoding utf8
  Write-Host $line
}

# ── Muat .env ────────────────────────────────────────────────────────────────
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  Write-Log "File .env tidak ditemukan di $root. Salin nilai dari Vercel ke file itu dulu."
  exit 1
}
foreach ($raw in Get-Content $envFile -Encoding utf8) {
  $line = $raw.Trim()
  if (-not $line -or $line.StartsWith("#")) { continue }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { continue }
  $name = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1).Trim()
  if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ($value) { Set-Item -Path "Env:$name" -Value $value }
}
if (-not $env:DASHBOARD_PASSWORD) {
  Write-Log "PERINGATAN: DASHBOARD_PASSWORD kosong. Dashboard bisa dibuka tanpa password oleh siapa pun yang bisa mengakses komputer ini."
}

$env:NODE_ENV = "production"
$env:PORT = "$Port"
$env:NITRO_PORT = "$Port"

# PowerShell 5.1: dengan "Stop", baris stderr dari node/npm dianggap error fatal dan mematikan skrip.
$ErrorActionPreference = "Continue"

# ── Build bila belum ada ─────────────────────────────────────────────────────
$entry = Join-Path $root ".output\server\index.mjs"
if (-not (Test-Path $entry)) {
  Write-Log "Build belum ada, membangun aplikasi (beberapa menit)..."
  $env:NITRO_PRESET = "node-server"
  npm run build 2>&1 | ForEach-Object { Write-Log $_ }
  if (-not (Test-Path $entry)) { Write-Log "Build gagal."; exit 1 }
}

# ── Jalankan & awasi ─────────────────────────────────────────────────────────
Write-Log "Radar P2P berjalan di http://localhost:$Port"
while ($true) {
  $started = Get-Date
  & node $entry 2>&1 | ForEach-Object { Write-Log $_ }
  $code = $LASTEXITCODE
  # Berhenti cepat berulang-ulang (mis. port dipakai) = jangan spam restart.
  $wait = if (((Get-Date) - $started).TotalSeconds -lt 10) { 30 } else { 5 }
  Write-Log "Server berhenti (kode $code). Menjalankan ulang dalam $wait detik..."
  Start-Sleep -Seconds $wait
}

<#
  Daftarkan Radar P2P agar otomatis berjalan (tersembunyi) setiap kali Anda login ke Windows.
  Pemakaian:  powershell -ExecutionPolicy Bypass -File scripts\local\install-autostart.ps1
  Hapus:      powershell -ExecutionPolicy Bypass -File scripts\local\install-autostart.ps1 -Remove
#>
param([switch]$Remove)

$taskName = "Radar P2P"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$startScript = Join-Path $root "scripts\local\start-radar.ps1"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Autostart '$taskName' dihapus."
  exit 0
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Server lokal Radar P2P (pengganti Vercel)" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Autostart '$taskName' terpasang & dijalankan. Dashboard: http://localhost:3000"

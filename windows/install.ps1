# AM PC Remote - install / uninstall helper (run PowerShell as Administrator)
param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$startScript = Join-Path $root 'start.ps1'
$configPath = Join-Path $root 'config.json'

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$tcpPort = if ($config.port) { [int]$config.port } else { 9600 }
$udpPort = if ($config.discoveryPort) { [int]$config.discoveryPort } else { 9601 }

$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'AM PC Remote.lnk'
$tcpRule = "AM PC Remote (TCP $tcpPort)"
$udpRule = "AM PC Remote (UDP $udpPort)"

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($Uninstall) {
  if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Removed startup shortcut."
  }
  foreach ($rule in @($tcpRule, $udpRule)) {
    Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  }
  Write-Host "AM PC Remote startup + firewall entries removed. Data in .\data was kept."
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js 20+ is required. Install it from https://nodejs.org and run this script again." -ForegroundColor Red
  exit 1
}

Write-Host "Node: $((node --version))"

# Startup shortcut (runs hidden at logon)
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'AM PC Remote server'
$shortcut.Save()
Write-Host "Startup shortcut: $shortcutPath"

if (Test-Admin) {
  if (-not (Get-NetFirewallRule -DisplayName $tcpRule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $tcpRule -Direction Inbound -Protocol TCP -LocalPort $tcpPort `
      -Action Allow -Profile Private | Out-Null
  }
  if (-not (Get-NetFirewallRule -DisplayName $udpRule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $udpRule -Direction Inbound -Protocol UDP -LocalPort $udpPort `
      -Action Allow -Profile Private | Out-Null
  }
  Write-Host "Firewall rules allow TCP $tcpPort and UDP $udpPort on private networks."
} else {
  Write-Host "Not elevated: firewall rules were skipped." -ForegroundColor Yellow
  Write-Host "Run this script as Administrator to add the private-network firewall rules." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Installed. Start it now with:  .\start.ps1"
Write-Host "Pairing PIN and admin:        http://localhost:$tcpPort/admin"

# AM PC Remote - start the server in this console
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js was not found. Install Node.js 20 or newer, then run this again." -ForegroundColor Red
  exit 1
}
node src/server.js

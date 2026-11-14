# AM PC Remote - notification-area companion.
#
# Started hidden by the server. It shows a green/red status icon, talks to the
# loopback-only admin API, and offers the actions that would otherwise need a
# console window: PIN controls, firewall rules, start with Windows, restart
# and stop. It exits when the server process disappears.

param(
  [int]$Port = 9600,
  [int]$DiscoveryPort = 9601,
  [int]$ParentPid = 0,
  [string]$Version = '',
  [string]$ExePath = '',
  [string]$AppRoot = '',
  [int]$Standalone = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security

if (-not ('AmTray.Native' -as [type])) {
  Add-Type -Namespace AmTray -Name Native -MemberDefinition @'
[DllImport("user32.dll")]
public static extern bool DestroyIcon(IntPtr handle);
'@
}

$AppName = 'AM PC Remote'
$BaseUrl = "http://127.0.0.1:$Port"
$DataDir = if ($AppRoot) { Join-Path $AppRoot 'data' } else { Join-Path $env:LOCALAPPDATA 'AM PC Remote\app\data' }
$LogFile = Join-Path $DataDir 'server.log'
$StartupDir = [Environment]::GetFolderPath('Startup')
$Shortcut = Join-Path $StartupDir 'AM PC Remote.lnk'
$IconDir = Join-Path $env:TEMP ('am-pc-remote-tray-' + $PID)
$GreenIconPath = Join-Path $IconDir 'green.ico'
$RedIconPath = Join-Path $IconDir 'red.ico'

New-Item -ItemType Directory -Force -Path $IconDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

function New-DotIcon {
  param([System.Drawing.Color]$Color, [string]$Path)
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 0, 0, 0))
  $g.FillEllipse($shadow, 3, 4, 26, 26)
  $brush = New-Object System.Drawing.SolidBrush $Color
  $g.FillEllipse($brush, 2, 2, 26, 26)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(245, 255, 255, 255)), 2
  $g.DrawEllipse($pen, 2, 2, 26, 26)
  # Small white "phone" body so the icon reads at 16x16.
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.FillRectangle($white, 12, 8, 8, 16)
  $screen = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 35, 42, 58))
  $g.FillRectangle($screen, 13, 10, 6, 11)
  $g.Dispose()
  $handle = $bmp.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($handle)
  $stream = [System.IO.File]::Create($Path)
  $icon.Save($stream)
  $stream.Close()
  $icon.Dispose()
  [AmTray.Native]::DestroyIcon($handle) | Out-Null
  $bmp.Dispose()
  $brush.Dispose()
  $shadow.Dispose()
  $pen.Dispose()
  $white.Dispose()
  $screen.Dispose()
}

New-DotIcon -Color ([System.Drawing.Color]::FromArgb(255, 34, 197, 94)) -Path $GreenIconPath
New-DotIcon -Color ([System.Drawing.Color]::FromArgb(255, 239, 68, 68)) -Path $RedIconPath

$greenIcon = New-Object System.Drawing.Icon($GreenIconPath)
$redIcon = New-Object System.Drawing.Icon($RedIconPath)

function Get-ServerStatus {
  try {
    return Invoke-RestMethod -Uri "$BaseUrl/api/admin/status" -TimeoutSec 2 -ErrorAction Stop
  } catch {
    return $null
  }
}

function Invoke-AdminPost {
  param([string]$Path, [string]$Body = '{}')
  try {
    return Invoke-RestMethod -Uri "$BaseUrl$Path" -Method Post -ContentType 'application/json' -Body $Body -TimeoutSec 4 -ErrorAction Stop
  } catch {
    Show-Balloon 'AM PC Remote' "The request failed: $($_.Exception.Message)" 'Warning'
    return $null
  }
}

function Show-Balloon {
  param([string]$Title, [string]$Text, [string]$Icon = 'Info')
  try {
    $notify.BalloonTipTitle = $Title
    $notify.BalloonTipText = $Text
    $notify.BalloonTipIcon = $Icon
    $notify.ShowBalloonTip(4000)
  } catch {
    # Balloons are best effort (Focus Assist hides them).
  }
}

function Show-Info {
  param([string]$Text, [string]$Title = $AppName)
  [System.Windows.Forms.MessageBox]::Show($Text, $Title, 'OK', 'Information') | Out-Null
}

function Open-Admin {
  try {
    Start-Process "http://127.0.0.1:$Port/admin" | Out-Null
  } catch {
    Show-Info "Could not open the admin page.`n`n$($_.Exception.Message)"
  }
}

function Copy-Pin {
  param([string]$Pin)
  if (-not $Pin) { return }
  try {
    [System.Windows.Forms.Clipboard]::SetText($Pin)
    Show-Balloon $AppName "PIN $Pin copied to the clipboard." 'Info'
  } catch {
    try {
      $Pin | clip.exe
      Show-Balloon $AppName "PIN $Pin copied to the clipboard." 'Info'
    } catch {
      Show-Info "Pairing PIN: $Pin"
    }
  }
}

function Show-Pin {
  $status = Get-ServerStatus
  if (-not $status) {
    Show-Info 'The server is not responding.'
    return
  }
  $mode = if ($status.pinRequired) { 'A PIN is required.' } else { 'PIN check is currently DISABLED.' }
  $body = "Pairing PIN: $($status.pin)`n`n$mode`n`nEnter it in the AM PC Remote Android app.`nRotating the PIN signs out every paired device."
  Show-Info $body
}

function Get-StatusObject {
  return Get-ServerStatus
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.ShowImageMargin = $false

$itemHeader = New-Object System.Windows.Forms.ToolStripMenuItem
$itemHeader.Enabled = $false
$itemHeader.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)

$itemState = New-Object System.Windows.Forms.ToolStripMenuItem
$itemState.Enabled = $false

$itemOpen = New-Object System.Windows.Forms.ToolStripMenuItem 'Open admin page'
$itemPin = New-Object System.Windows.Forms.ToolStripMenuItem 'Show pairing PIN'
$itemCopyPin = New-Object System.Windows.Forms.ToolStripMenuItem 'Copy PIN'
$itemDevices = New-Object System.Windows.Forms.ToolStripMenuItem 'Paired devices'
$itemRotate = New-Object System.Windows.Forms.ToolStripMenuItem 'Rotate PIN (sign out all)'
$itemTogglePin = New-Object System.Windows.Forms.ToolStripMenuItem 'Disable PIN'

$itemFirewall = New-Object System.Windows.Forms.ToolStripMenuItem 'Allow firewall access'
$itemStartup = New-Object System.Windows.Forms.ToolStripMenuItem 'Start with Windows'
$itemStartup.CheckOnClick = $false

$itemData = New-Object System.Windows.Forms.ToolStripMenuItem 'Open data folder'
$itemLog = New-Object System.Windows.Forms.ToolStripMenuItem 'Open server log'
$itemRestart = New-Object System.Windows.Forms.ToolStripMenuItem 'Restart server'
$itemStop = New-Object System.Windows.Forms.ToolStripMenuItem 'Stop server'

$itemHeader.Text = if ($Version) { "$AppName $Version" } else { $AppName }
$itemOpen.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)

$menu.Items.Add($itemHeader) | Out-Null
$menu.Items.Add($itemState) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menu.Items.Add($itemOpen) | Out-Null
$menu.Items.Add($itemPin) | Out-Null
$menu.Items.Add($itemCopyPin) | Out-Null
$menu.Items.Add($itemDevices) | Out-Null
$menu.Items.Add($itemRotate) | Out-Null
$menu.Items.Add($itemTogglePin) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menu.Items.Add($itemFirewall) | Out-Null
$menu.Items.Add($itemStartup) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$menu.Items.Add($itemData) | Out-Null
$menu.Items.Add($itemLog) | Out-Null
$menu.Items.Add($itemRestart) | Out-Null
$menu.Items.Add($itemStop) | Out-Null

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $greenIcon
$notify.Text = $AppName
$notify.Visible = $true
$notify.ContextMenuStrip = $menu

$script:lastStatus = $null
$script:lastReachable = $null

function Update-Tray {
  $status = Get-ServerStatus
  $script:lastStatus = $status
  if ($status) {
    $script:lastReachable = $true
    $notify.Icon = $greenIcon
    $count = @($status.clients).Count
    $connected = [int]$status.connected
    $notify.Text = "$AppName - running on port $Port ($count paired)"
    if ($notify.Text.Length -gt 63) { $notify.Text = "$AppName - running" }
    $itemState.Text = "Running - port $Port - $count paired"
    $itemTogglePin.Text = if ($status.pinRequired) { 'Disable PIN' } else { 'Enable PIN' }
    $pin = [string]$status.pin
    if ($status.pinRequired) {
      $itemCopyPin.Text = "Copy PIN ($pin)"
      $itemCopyPin.Enabled = $true
    } else {
      $itemCopyPin.Text = 'Copy PIN (PIN disabled)'
      $itemCopyPin.Enabled = $false
    }
    $itemDevices.DropDownItems.Clear()
    $clients = @($status.clients)
    if ($clients.Count -eq 0) {
      $none = New-Object System.Windows.Forms.ToolStripMenuItem 'No paired devices'
      $none.Enabled = $false
      $itemDevices.DropDownItems.Add($none) | Out-Null
    } else {
      foreach ($client in $clients) {
        $label = "$($client.name)  ($($client.ip))"
        $entry = New-Object System.Windows.Forms.ToolStripMenuItem $label
        $entry.ToolTipText = "Platform: $($client.platform) - last seen $($client.lastSeen)"
        $id = [string]$client.id
        $name = [string]$client.name
        $entry.add_Click({
          $answer = [System.Windows.Forms.MessageBox]::Show(
            "Sign out '$name'?", $AppName, 'YesNo', 'Question')
          if ($answer -eq 'Yes') {
            $body = '{"id":"' + $id + '"}'
            if (Invoke-AdminPost '/api/admin/revoke' $body) {
              Show-Balloon $AppName "$name was signed out." 'Info'
            }
            Update-Tray
          }
        }.GetNewClosure())
        $itemDevices.DropDownItems.Add($entry) | Out-Null
      }
    }
  } else {
    if ($script:lastReachable -ne $false) {
      $script:lastReachable = $false
    }
    $notify.Icon = $redIcon
    $notify.Text = "$AppName - server not responding"
    $itemState.Text = 'Server not responding'
    $itemDevices.DropDownItems.Clear()
    $none = New-Object System.Windows.Forms.ToolStripMenuItem 'Server offline'
    $none.Enabled = $false
    $itemDevices.DropDownItems.Add($none) | Out-Null
  }
}

function Close-Tray {
  try {
    $notify.Visible = $false
    $notify.Dispose()
  } catch {
    # ignore
  }
  try {
    Remove-Item -LiteralPath $IconDir -Recurse -Force -ErrorAction SilentlyContinue
  } catch {
    # ignore
  }
  [System.Windows.Forms.Application]::Exit()
}

function Stop-Server {
  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/admin/stop" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
  } catch {
    # The server may already be gone.
  }
  if ($ParentPid -gt 0) {
    for ($i = 0; $i -lt 25; $i++) {
      if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 200
    }
    if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
      Stop-Process -Id $ParentPid -Force -ErrorAction SilentlyContinue
    }
  }
  Close-Tray
}

function Start-Server {
  if ($Standalone -eq 1 -and $ExePath) {
    Start-Process -FilePath $ExePath -WorkingDirectory (Split-Path -Parent $ExePath) | Out-Null
  } elseif ($ExePath -and $AppRoot) {
    $script = Join-Path $AppRoot 'src\server.js'
    Start-Process -FilePath $ExePath -ArgumentList "`"$script`"" -WorkingDirectory $AppRoot -WindowStyle Hidden | Out-Null
  }
}

function Restart-Server {
  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/admin/stop" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 3 -ErrorAction SilentlyContinue | Out-Null
  } catch {
    # ignore
  }
  if ($ParentPid -gt 0) {
    for ($i = 0; $i -lt 25; $i++) {
      if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 200
    }
    if (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
      Stop-Process -Id $ParentPid -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 400
  Start-Server
  Close-Tray
}

function Add-FirewallRules {
  $temp = Join-Path $IconDir 'firewall.ps1'
  # Windows can create a "Block" rule for this exe when the app first listens
  # (the firewall prompt defaults to Cancel). A block rule always wins over an
  # allow rule, so remove the old per-application prompt rules as well.
  $targets = @(
    "AM PC Remote (TCP $Port)",
    "AM PC Remote (UDP $DiscoveryPort)",
    "AM PC Remote LAN (TCP $Port)",
    "AM PC Remote LAN (UDP $DiscoveryPort)",
    'AM PC Remote Server'
  )
  $lines = @(
    "`$exe = '$ExePath'",
    "`$names = @(" + (($targets | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ',') + ")",
    "foreach (`$n in `$names) { Get-NetFirewallRule -DisplayName `$n -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue }",
    "New-NetFirewallRule -DisplayName `"AM PC Remote LAN (TCP $Port)`" -Description 'AM PC Remote LAN server' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program `$exe -Profile Any -Enabled True | Out-Null",
    "New-NetFirewallRule -DisplayName `"AM PC Remote LAN (UDP $DiscoveryPort)`" -Description 'AM PC Remote LAN discovery' -Direction Inbound -Action Allow -Protocol UDP -LocalPort $DiscoveryPort -Program `$exe -Profile Any -Enabled True | Out-Null"
  )
  Set-Content -LiteralPath $temp -Value $lines -Encoding ASCII
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -ArgumentList @(
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $temp
    )
    Show-Balloon $AppName "Firewall rules added for TCP $Port and UDP $DiscoveryPort." 'Info'
  } catch {
    Show-Info "Firewall changes were cancelled or could not be elevated.`n`n$($_.Exception.Message)"
  }
}

$itemOpen.add_Click({ Open-Admin })
$itemPin.add_Click({ Show-Pin })
$itemCopyPin.add_Click({
  $status = Get-ServerStatus
  if ($status) { Copy-Pin ([string]$status.pin) }
})
$itemRotate.add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show(
    'Create a new PIN and sign out every paired device?', $AppName, 'YesNo', 'Question')
  if ($answer -ne 'Yes') { return }
  $result = Invoke-AdminPost '/api/admin/pin'
  if ($result) {
    Show-Info "New pairing PIN: $($result.pin)`n`nAll devices were signed out."
  }
  Update-Tray
})
$itemTogglePin.add_Click({
  $status = Get-ServerStatus
  if (-not $status) { return }
  $target = -not [bool]$status.pinRequired
  $body = if ($target) { '{"value":true}' } else { '{"value":false}' }
  $result = Invoke-AdminPost '/api/admin/require-pin' $body
  if ($result) {
    if ($result.requirePin) { Show-Balloon $AppName 'PIN requirement enabled.' 'Info' }
    else { Show-Balloon $AppName 'PIN requirement disabled. Anyone on the LAN can pair.' 'Warning' }
  }
  Update-Tray
})
$itemFirewall.add_Click({ Add-FirewallRules })
$itemStartup.add_Click({
  if (Test-Path $Shortcut) {
    Remove-Item -LiteralPath $Shortcut -Force
    Show-Balloon $AppName 'AM PC Remote will no longer start with Windows.' 'Info'
    Update-Tray
    return
  }
  if (-not $ExePath) { return }
  try {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Shortcut)
    $link.TargetPath = $ExePath
    $link.WorkingDirectory = Split-Path -Parent $ExePath
    $link.Description = 'AM PC Remote server'
    $link.Save()
    Show-Balloon $AppName 'AM PC Remote will start with Windows.' 'Info'
  } catch {
    Show-Info "Could not create the startup shortcut.`n`n$($_.Exception.Message)"
  }
  Update-Tray
})
$itemData.add_Click({ Start-Process explorer.exe $DataDir })
$itemLog.add_Click({
  if (Test-Path $LogFile) { Start-Process notepad.exe $LogFile }
  else { Show-Info "No log file yet.`n`n$LogFile" }
})
$itemRestart.add_Click({ Restart-Server })
$itemStop.add_Click({ Stop-Server })
$notify.add_DoubleClick({ Open-Admin })

$script:menuOpen = $false
$menu.add_Opening({
  Update-Tray
  $itemStartup.Checked = Test-Path $Shortcut
  $itemStartup.Enabled = [bool]$ExePath
})
$menu.add_Opened({ $script:menuOpen = $true })
$menu.add_Closed({ $script:menuOpen = $false; Update-Tray })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.add_Tick({
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
    Close-Tray
    return
  }
  if ($script:menuOpen) { return }
  Update-Tray
})
$timer.Start()

Update-Tray
Show-Balloon $AppName "Running in the notification area. Click for the admin page, right-click for controls." 'Info'

[System.Windows.Forms.Application]::Run()

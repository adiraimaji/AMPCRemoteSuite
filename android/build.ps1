# Builds and signs the AM PC Remote Android APK without Gradle.
#
# Everything this script needs lives in this folder:
#   android.jar            local copy of the platform jar (optional)
#   keystore.properties    signing settings  (copy keystore.properties.example)
#   keystore.jks           signing key        (path set by storeFile)
#
#   .\build.ps1              build the APK
#   .\build.ps1 -Install     build, then install over adb
#   .\build.ps1 -Install -Launch
#   .\build.ps1 -Properties .\my-signing.properties
#
param(
  [switch]$Install,
  [switch]$Launch,
  [string]$Serial = "",
  [string]$Properties = ""
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = $PSScriptRoot
$build = Join-Path $root '.build'
$out = Join-Path $build 'out'
$gen = Join-Path $out 'gen'
$classes = Join-Path $out 'classes'
$dexDir = Join-Path $out 'dex'
$apkUnsigned = Join-Path $out 'unsigned.apk'
$apkAligned = Join-Path $out 'aligned.apk'
$apkFinal = Join-Path $root 'dist\AM-PC-Remote-1.0.0.apk'

function Fail($message) {
  Write-Host ""
  Write-Host "Build failed: $message" -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------- signing
function Read-Properties([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#') -or $trimmed.StartsWith('!')) { continue }
    $index = $trimmed.IndexOf('=')
    if ($index -lt 1) { continue }
    $name = $trimmed.Substring(0, $index).Trim()
    $value = $trimmed.Substring($index + 1).Trim()
    if ($value.Length -ge 2) {
      $quoted = ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
      if ($quoted) { $value = $value.Substring(1, $value.Length - 2) }
    }
    $values[$name] = $value
  }
  return $values
}

$propertiesPath = if ($Properties) {
  if ([System.IO.Path]::IsPathRooted($Properties)) { $Properties } else { Join-Path $root $Properties }
} else {
  Join-Path $root 'keystore.properties'
}
if (-not (Test-Path $propertiesPath)) {
  Fail "Signing settings not found: $propertiesPath`nCopy keystore.properties.example to keystore.properties and fill in your values."
}
$signing = Read-Properties $propertiesPath

$storeFile = $signing['storeFile']
if (-not $storeFile) { $storeFile = 'keystore.jks' }
if (-not [System.IO.Path]::IsPathRooted($storeFile)) {
  $storeFile = Join-Path $root $storeFile
}

$storePassword = $signing['storePassword']
$keyAlias = $signing['keyAlias']
$keyPassword = $signing['keyPassword']
if (-not $keyPassword) { $keyPassword = $storePassword }

if (-not $storePassword) { Fail "keystore.properties must define storePassword." }
if (-not $keyAlias) { Fail "keystore.properties must define keyAlias." }

# ---------------------------------------------------------------- toolchain
$androidJar = $env:ANDROID_JAR
if (-not $androidJar) {
  $localJar = Join-Path $root 'android.jar'
  if (Test-Path $localJar) { $androidJar = $localJar }
}

if (-not $androidJar) {
  $sdk = $env:ANDROID_HOME
  if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
  if (-not $sdk) {
    $candidate = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if (Test-Path $candidate) { $sdk = $candidate }
  }
  if (-not $sdk -or -not (Test-Path $sdk)) {
    Fail "android.jar not found. Put it in $root\android.jar or set ANDROID_HOME."
  }

  $androidJar = Join-Path $sdk 'platforms\android-35\android.jar'
  if (-not (Test-Path $androidJar)) {
    $platform = Get-ChildItem (Join-Path $sdk 'platforms') -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 1
    if ($platform) { $androidJar = Join-Path $platform.FullName 'android.jar' }
  }
}
if (-not (Test-Path $androidJar)) { Fail "android.jar not found: $androidJar" }

$sdk = $env:ANDROID_HOME
if (-not $sdk) { $sdk = $env:ANDROID_SDK_ROOT }
if (-not $sdk) {
  $candidate = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  if (Test-Path $candidate) { $sdk = $candidate }
}

$buildTools = $env:BUILD_TOOLS
if (-not $buildTools) {
  if (-not $sdk) { Fail "Android SDK not found. Set ANDROID_HOME or BUILD_TOOLS." }
  $buildTools = Join-Path $sdk 'build-tools\35.0.0'
}
if (-not (Test-Path (Join-Path $buildTools 'aapt2.exe'))) {
  if ($sdk) {
    $latest = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) { $buildTools = $latest.FullName }
  }
}
if (-not (Test-Path (Join-Path $buildTools 'aapt2.exe'))) { Fail "aapt2 not found in $buildTools" }

$jdk = $env:JAVA_HOME
if (-not $jdk -or -not (Test-Path (Join-Path $jdk 'bin\javac.exe'))) {
  $candidates = @('C:\Program Files\Java\jdk-21', 'C:\Program Files\Android\Android Studio\jbr')
  foreach ($candidate in $candidates) {
    if (Test-Path (Join-Path $candidate 'bin\javac.exe')) { $jdk = $candidate; break }
  }
}
if (-not $jdk -or -not (Test-Path (Join-Path $jdk 'bin\javac.exe'))) { Fail "A JDK 17+ was not found. Set JAVA_HOME." }

$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"

$javac = Join-Path $jdk 'bin\javac.exe'
$jarTool = Join-Path $jdk 'bin\jar.exe'
$aapt2 = Join-Path $buildTools 'aapt2.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'

foreach ($tool in @($aapt2, $d8, $zipalign, $apksigner)) {
  if (-not (Test-Path $tool)) { Fail "Missing build tool: $tool" }
}
if (-not (Test-Path $storeFile)) { Fail "Signing keystore not found: $storeFile" }

Write-Host "android.jar: $androidJar"
Write-Host "Build tools: $buildTools"
Write-Host "JDK:         $jdk"
Write-Host "Keystore:    $storeFile"

# ---------------------------------------------------------------- clean
if (Test-Path $build) { Remove-Item -LiteralPath $build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out, $gen, $classes, $dexDir, (Join-Path $root 'dist') | Out-Null

# ---------------------------------------------------------------- resources
Write-Host "`nCompiling resources..."
$resZip = Join-Path $out 'resources.zip'
& $aapt2 compile --dir (Join-Path $root 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { Fail "aapt2 compile failed." }

Write-Host "Linking resources and manifest..."
& $aapt2 link `
  -o $apkUnsigned `
  -I $androidJar `
  --manifest (Join-Path $root 'AndroidManifest.xml') `
  --java $gen `
  --auto-add-overlay `
  $resZip
if ($LASTEXITCODE -ne 0) { Fail "aapt2 link failed." }

# ---------------------------------------------------------------- java
Write-Host "Compiling Java..."
$sources = @()
$sources += Get-ChildItem (Join-Path $root 'java') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$sources += Get-ChildItem $gen -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$argFile = Join-Path $out 'javac.args'
$arguments = @('--release', '8', '-encoding', 'UTF-8',
  '-classpath', $androidJar.Replace('\', '/'),
  '-d', $classes.Replace('\', '/'))
foreach ($source in $sources) { $arguments += '"' + $source.Replace('\', '/') + '"' }
Set-Content -LiteralPath $argFile -Value $arguments -Encoding ASCII

& $javac "@$argFile"
if ($LASTEXITCODE -ne 0) { Fail "javac failed." }

Write-Host "Dexing..."
$classesJar = Join-Path $out 'classes.jar'
& $jarTool cf $classesJar -C $classes .
if ($LASTEXITCODE -ne 0) { Fail "jar failed." }

& $d8 --min-api 23 --lib $androidJar --output $dexDir $classesJar
if ($LASTEXITCODE -ne 0) { Fail "d8 failed." }

$dex = Join-Path $dexDir 'classes.dex'
if (-not (Test-Path $dex)) { Fail "classes.dex was not produced." }

Write-Host "Adding classes.dex to the APK..."
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($apkUnsigned, 'Update')
try {
  $existing = $zip.GetEntry('classes.dex')
  if ($existing) { $existing.Delete() }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip, $dex, 'classes.dex', [System.IO.Compression.CompressionLevel]::NoCompression) | Out-Null
} finally {
  $zip.Dispose()
}

Write-Host "Aligning..."
& $zipalign -f -p 4 $apkUnsigned $apkAligned
if ($LASTEXITCODE -ne 0) { Fail "zipalign failed." }

Write-Host "Signing..."
& $apksigner sign `
  --ks $storeFile `
  --ks-key-alias $keyAlias `
  --ks-pass "pass:$storePassword" `
  --key-pass "pass:$keyPassword" `
  --out $apkFinal `
  $apkAligned
if ($LASTEXITCODE -ne 0) { Fail "apksigner failed." }

& $apksigner verify $apkFinal
if ($LASTEXITCODE -ne 0) { Fail "APK verification failed." }
$certs = & $apksigner verify --print-certs $apkFinal
if ($LASTEXITCODE -ne 0) { Fail "APK certificate check failed." }
$certs | Select-Object -First 3

$sizeMb = [Math]::Round((Get-Item $apkFinal).Length / 1MB, 2)
$hash = (Get-FileHash $apkFinal -Algorithm SHA256).Hash
Write-Host ""
Write-Host "Built $apkFinal"
Write-Host "Size: $sizeMb MB"
Write-Host "SHA-256: $hash"

# ---------------------------------------------------------------- install
if ($Install) {
  $adb = if ($sdk) { Join-Path $sdk 'platform-tools\adb.exe' } else { '' }
  if (-not $adb -or -not (Test-Path $adb)) { $adb = 'adb' }
  if ($Serial) {
    & $adb -s $Serial install -r $apkFinal
  } else {
    & $adb install -r $apkFinal
  }
  if ($LASTEXITCODE -ne 0) { Fail "adb install failed." }
  if ($Launch) {
    if ($Serial) {
      & $adb -s $Serial shell monkey -p com.adiraimaji.ampcremote -c android.intent.category.LAUNCHER 1
    } else {
      & $adb shell monkey -p com.adiraimaji.ampcremote -c android.intent.category.LAUNCHER 1
    }
  }
}

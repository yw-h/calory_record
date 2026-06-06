param(
  [string]$NodeExe = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = "DailyNutritionLedger"
$releaseRoot = Join-Path $root "release"
$packageName = "$appName-win-x64"
$packageDir = Join-Path $releaseRoot $packageName
$runtimeDir = Join-Path $packageDir "runtime"
$zipPath = Join-Path $releaseRoot "$packageName.zip"
$launcherExe = Join-Path $packageDir "$appName.exe"

function Find-Csc {
  $candidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Find-Node {
  param([string]$Preferred)

  if ($Preferred -and (Test-Path $Preferred)) {
    return (Resolve-Path $Preferred).Path
  }

  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $common = @(
    "D:\nodes\node.exe",
    "$env:ProgramFiles\nodejs\node.exe"
  )

  foreach ($candidate in $common) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

if (Test-Path $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$csc = Find-Csc
if (-not $csc) {
  throw "C# compiler was not found. Cannot build launcher."
}

$launcherSource = Join-Path $root "launcher.cs"
$compileArgs = @(
  "/nologo",
  "/target:winexe",
  "/out:$launcherExe",
  $launcherSource,
  "/r:System.Windows.Forms.dll",
  "/r:System.dll",
  "/r:System.Drawing.dll"
)
& $csc @compileArgs

$node = Find-Node $NodeExe
if (-not $node) {
  throw "node.exe was not found. Install Node.js or pass -NodeExe with the node.exe path."
}

Copy-Item -LiteralPath $node -Destination (Join-Path $runtimeDir "node.exe") -Force

$files = @(
  "index.html",
  "styles.css",
  "app.js",
  "server.js",
  "README.md"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $packageDir -Force
}

@"
Daily Nutrition Ledger

How to use:
1. Extract the whole folder.
2. Double-click DailyNutritionLedger.exe.
3. To use the local DeepSeek proxy, set DEEPSEEK_API_KEY in Windows environment variables, then reopen the app.

Notes:
- Do not copy only the exe. The runtime folder, server.js, index.html, styles.css, and app.js are required.
- The app starts a local service on port 5173 and opens your browser automatically.
"@ | Set-Content -Path (Join-Path $packageDir "README-release.txt") -Encoding UTF8

Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force

Write-Host "Release generated:"
Write-Host $packageDir
Write-Host $zipPath

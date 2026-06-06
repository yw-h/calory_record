$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $PSScriptRoot "app\src\main\assets"

New-Item -ItemType Directory -Force -Path $assets | Out-Null
Copy-Item -Force (Join-Path $root "index.html") (Join-Path $assets "index.html")
Copy-Item -Force (Join-Path $root "app.js") (Join-Path $assets "app.js")
Copy-Item -Force (Join-Path $root "styles.css") (Join-Path $assets "styles.css")

$appJs = Join-Path $assets "app.js"
$content = Get-Content -Raw -Encoding UTF8 $appJs
$content = $content -replace 'document\.addEventListener\("DOMContentLoaded", \(\) => \{', 'document.addEventListener("DOMContentLoaded", () => {
  if (isAndroidApp() && state.api.mode === "proxy") {
    state.api.mode = "direct";
    saveState({ touch: false, sync: false });
  }'
Set-Content -Path $appJs -Value $content -Encoding UTF8

Write-Host "Android assets synced."

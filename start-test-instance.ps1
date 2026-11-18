# Start a throwaway DSH web instance for testing this plugin.
#
# A fresh DSH_HOME shows the login dialog every time. This script keeps one home
# under %TEMP%, copies this machine's account store into it once, links the
# plugin, and always binds the same port so the browser keeps its origin.
#
#   .\start-test-instance.ps1
#   $env:DSH_TEST_PORT = 58001; .\start-test-instance.ps1
param(
  [string]$TestHome = $(if ($env:DSH_TEST_HOME) { $env:DSH_TEST_HOME } else { Join-Path $env:TEMP 'dsh-ide-test' }),
  [int]$Port = $(if ($env:DSH_TEST_PORT) { [int]$env:DSH_TEST_PORT } else { 57999 }),
  [string]$Workspace = $(if ($env:DSH_TEST_WORKSPACE) { $env:DSH_TEST_WORKSPACE } else { '' })
)
$ErrorActionPreference = 'Stop'

$repo = $PSScriptRoot
$app = if ($env:DSH_APP) { $env:DSH_APP }
  elseif (Test-Path "$env:LOCALAPPDATA\Programs\DeepSeek Harness") { "$env:LOCALAPPDATA\Programs\DeepSeek Harness" }
  else { "$env:ProgramFiles\DeepSeek Harness" }
$electron = Join-Path $app 'DeepSeek Harness.exe'
$cli = Join-Path $app 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path $cli)) { $cli = Join-Path $app 'Resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js' }
if (-not (Test-Path $electron)) {
  Write-Error "DSH is not installed where this script expects it: $electron"
}
if (-not $Workspace) { $Workspace = (Get-Location).Path }

New-Item -ItemType Directory -Force -Path (Join-Path $TestHome 'sessions'), (Join-Path $TestHome 'storages') | Out-Null

$credentials = Join-Path $env:USERPROFILE '.dsh\.credentials.yaml'
if (-not (Test-Path $credentials)) {
  Write-Error 'No credentials at %USERPROFILE%\.dsh\.credentials.yaml — log in once in DSH first.'
}
Copy-Item $credentials (Join-Path $TestHome '.credentials.yaml') -Force
Write-Host "account credentials copied into $TestHome"

# Attachment cache, harmless and keeps shared attachments readable.
if (-not (Test-Path (Join-Path $TestHome 'llm-deepseek'))) {
  $cache = Join-Path $env:USERPROFILE '.dsh\llm-deepseek'
  if (Test-Path $cache) { Copy-Item $cache (Join-Path $TestHome 'llm-deepseek') -Recurse -Force }
}

# Sessions are read-only fixtures here: copy the known workspaces once.
if (-not (Get-ChildItem (Join-Path $TestHome 'sessions') -ErrorAction SilentlyContinue)) {
  $sessions = Join-Path $env:USERPROFILE '.dsh\sessions'
  Get-ChildItem $sessions -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*bluewhale-order-service*' -or $_.Name -like '*dsh-ide-window*' } |
    ForEach-Object { Copy-Item $_.FullName (Join-Path $TestHome 'sessions') -Recurse -Force }
  $workspaceStore = Join-Path $env:USERPROFILE '.dsh\storages\workspace.json'
  if (Test-Path $workspaceStore) { Copy-Item $workspaceStore (Join-Path $TestHome 'storages\workspace.json') -Force }
  Write-Host "workspace fixtures copied into $TestHome"
}

if (-not (Test-Path $Workspace)) {
  Write-Error "workspace not found: $Workspace (set DSH_TEST_WORKSPACE)"
}

$env:DSH_HOME = $TestHome
$env:ELECTRON_RUN_AS_NODE = '1'
& $electron $cli plugin --profile web add "link:$repo" 2>&1 | Out-Null
& $electron $cli --profile web --port $Port --no-open 2>&1 | Tee-Object -FilePath (Join-Path $TestHome 'url.log')

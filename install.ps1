# Install the dsh-ide-window plugin into a DSH profile (Windows).
#
#   .\install.ps1                  # clone/pull into %USERPROFILE%\dev\dsh-ide-window, install into `desktop`
#   .\install.ps1 -Profile web     # another profile
#   .\install.ps1 -Dir C:\src\x    # another checkout location
#   .\install.ps1 -WithLsp         # also add the LSP pipeline packages
#   .\install.ps1 -NoPull          # keep the checkout as it is
#
# Safe to re-run: an existing checkout is fast-forwarded, and `plugin add` on an
# already linked package is a no-op. The DSH application itself is never modified.
#
# If PowerShell refuses to run this file ("execution policy"), start it with:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
param(
  [string]$Profile = 'desktop',
  [string]$Dir = $(if ($env:DSH_IDE_DIR) { $env:DSH_IDE_DIR } else { Join-Path $env:USERPROFILE 'dev\dsh-ide-window' }),
  [switch]$WithLsp,
  [switch]$NoPull
)
$ErrorActionPreference = 'Stop'

# A window that flashes and closes hides the reason. Every terminating error is
# printed with its source, and the console waits for a key before exiting.
trap {
  Write-Host ''
  Write-Host "安装失败：$($_.Exception.Message)" -ForegroundColor Red
  if ($_.InvocationInfo -and $_.InvocationInfo.PositionMessage) {
    Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkYellow
  }
  if ([Environment]::UserInteractive -and $Host.Name -ne 'ServerRemoteHost') {
    Write-Host '按回车键退出…' -ForegroundColor Yellow
    [void](Read-Host)
  }
  exit 1
}

$repoUrl = 'https://github.com/simons-jiang/dsh-ide-window.git'
$packageName = '@local/dsh-ide-window'
$lspPackages = @('@deepseek-ai/dsh-lsp@0.2.2-rc.3', '@deepseek-ai/dsh-lsp-stdio@0.2.2-rc.3')

function Step([string]$Text) { Write-Host "`n==> $Text" }
# `exit` would close the console when the script runs through `irm | iex`, which
# looks like a window that flashes and disappears. Throwing keeps the window and
# prints the reason.
function Fail([string]$Text) {
  Write-Host "错误：$Text" -ForegroundColor Red
  throw "dsh-ide-window: $Text"
}

# ---- 1. locate DSH and its CLI ---------------------------------------------

Step '检查 DSH'
$candidates = @()
if ($env:LOCALAPPDATA) { $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe') }
if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe') }
if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness\DeepSeek Harness.exe') }
$appBin = $null
foreach ($candidate in $candidates) {
  if (Test-Path $candidate) { $appBin = $candidate; break }
}
if (-not $appBin) { Fail '没找到 DeepSeek Harness.exe，请先安装并登录 DSH。' }
# On Windows the asar sits next to the executable: <app dir>\resources\app.asar
$appDir = Split-Path $appBin -Parent
$cliJs = $null
foreach ($resources in @('resources', 'Resources')) {
  if (Test-Path (Join-Path $appDir $resources)) {
    $cliJs = Join-Path $appDir "$resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js"
    break
  }
}
if (-not $cliJs) { Fail "DSH 安装不完整：找不到 $appDir\resources\app.asar" }

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"

# Same binary in Node mode: used for every JSON edit below, so the script does
# not depend on a system Node installation.
function Invoke-Node([string]$Script, [string[]]$Arguments) {
  $previous = $env:ELECTRON_RUN_AS_NODE
  $env:ELECTRON_RUN_AS_NODE = '1'
  try {
    & $appBin -e $Script @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Node 模式执行失败（exit $LASTEXITCODE）" }
  } finally {
    $env:ELECTRON_RUN_AS_NODE = $previous
  }
}

try {
  Invoke-Node 'process.exit(require("node:fs").existsSync(process.argv[1]) ? 0 : 1)' @($cliJs) | Out-Null
} catch {
  Fail "DSH 安装不完整：找不到内置 CLI（$cliJs）"
}

$dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
if ($dshCommand) {
  Write-Host "    使用命令行：$($dshCommand.Source)"
  function Invoke-Dsh { & dsh @args; if ($LASTEXITCODE -ne 0) { throw "dsh 执行失败（exit $LASTEXITCODE）" } }
} else {
  Write-Host '    命令行 dsh 不在 PATH，改用应用自带的 CLI'
  function Invoke-Dsh {
    $previous = $env:ELECTRON_RUN_AS_NODE
    $env:ELECTRON_RUN_AS_NODE = '1'
    try {
      & $appBin $cliJs @args
      if ($LASTEXITCODE -ne 0) { throw "DSH CLI 执行失败（exit $LASTEXITCODE）" }
    } finally {
      $env:ELECTRON_RUN_AS_NODE = $previous
    }
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail '需要 git，请先安装（https://git-scm.com/download/win）。' }

# ---- 2. checkout ------------------------------------------------------------

# Reduce every clone URL to `owner/repo`, so a checkout created over SSH (or
# copied from another machine) still counts as the same repository.
function Normalize-Remote([string]$Remote) {
  $normalized = $Remote -replace '^git@[^:]*:', 'https://github.com/'
  $normalized = $normalized -replace '^ssh://git@[^/]*/', 'https://github.com/'
  $normalized = $normalized -replace '^https?://[^/]*/', 'https://github.com/'
  $normalized = $normalized -replace '\.git$', '' -replace '/+$', ''
  return ($normalized -replace '^https://github.com/', '')
}

if (Test-Path (Join-Path $Dir '.git')) {
  $have = (git -C $Dir remote get-url origin 2>$null)
  if ((Normalize-Remote $have) -ne (Normalize-Remote $repoUrl)) {
    Fail "${Dir}已存在，但不是本仓库（origin: $have）；换一个 -Dir 再试。"
  }
  if ($NoPull) {
    Step "使用现有仓库：${Dir}（-NoPull）"
  } else {
    Step "更新仓库：${Dir}"
    git -C $Dir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail 'git pull 失败，请手动处理后重跑。' }
  }
} else {
  Step "克隆仓库到 ${Dir}"
  $parent = Split-Path $Dir -Parent
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  git clone $repoUrl $Dir
  if ($LASTEXITCODE -ne 0) { Fail 'git clone 失败，请检查网络或代理。' }
}
foreach ($required in @('package.json', 'client.js')) {
  if (-not (Test-Path (Join-Path $Dir $required))) { Fail "${Dir}里缺少 $required，仓库不完整。" }
}

# ---- 3. install into the profile -------------------------------------------

Step "安装插件到 profile：$Profile"
# The `desktop` profile is owned by the application: its CLI answers
# "managed exclusively by the Electron application" for every command. The app
# itself installs through pnpm inside the profile directory, so fall back to
# exactly that instead of failing.
$installed = $false
try {
  Invoke-Dsh plugin --profile $Profile add "link:$Dir"
  $installed = $true
} catch {
  Write-Host '    该 profile 由应用托管，改用 profile 内的 pnpm'
}
if (-not $installed) {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Fail '需要 pnpm（DSH 安装插件也依赖它）：npm i -g pnpm'
  }
  if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
    Fail "profile ${Profile}尚未初始化：先启动一次 DSH，再重跑本脚本。"
  }
  Push-Location $profileDir
  try {
    pnpm add "link:$Dir"
    if ($LASTEXITCODE -ne 0) { Fail 'pnpm add 失败，请检查网络或代理。' }
  } finally {
    Pop-Location
  }
}

if ($WithLsp) {
  Step '安装 LSP 管道包（语言服务器本身还要另外准备）'
  Invoke-Dsh plugin --profile $Profile add @lspPackages
}

# ---- 4. make sure the bundle is listed -------------------------------------

Step '确认 bundle 已登记'
$ensure = @'
const fs = require("node:fs")
const [file, name] = process.argv.slice(1)
const data = JSON.parse(fs.readFileSync(file, "utf8"))
data.dsh ??= {}
data.dsh.profile ??= {}
data.dsh.profile.bundles ??= []
if (data.dsh.profile.bundles.includes(name)) {
  console.log("    已登记: " + name)
  process.exit(0)
}
data.dsh.profile.bundles.push(name)
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n")
console.log("    已登记: " + name)
'@
Invoke-Node $ensure @((Join-Path $profileDir 'package.json'), $packageName)

# ---- 5. verify -------------------------------------------------------------

Step '校验安装结果'
$verify = @'
const fs = require("node:fs")
const [file, name, dir] = process.argv.slice(1)
const data = JSON.parse(fs.readFileSync(file, "utf8"))
const deps = data.dependencies ?? {}
const bundles = data.dsh?.profile?.bundles ?? []
const linked = deps[name] ?? ""
console.log("    依赖: " + (linked === "" ? "缺失" : linked))
console.log("    bundle: " + (bundles.includes(name) ? "已登记" : "缺失"))
process.exit(bundles.includes(name) && String(linked).includes(dir) ? 0 : 1)
'@
try {
  Invoke-Node $verify @((Join-Path $profileDir 'package.json'), $packageName, $Dir)
} catch {
  Fail '装完了但校验没过，请把上面的输出发给维护者。'
}

Write-Host "`n全部完成。" -ForegroundColor Green
Write-Host "  仓库：$Dir"
Write-Host "  profile：$profileDir"
Write-Host "`n下一步：完全退出 DSH（托盘里退出，不是关窗口）再打开，左侧导航或左下角会出现「代码工作区」。"
if (-not $WithLsp) {
  Write-Host '代码导航（可选）：还需要 LSP 管道包与语言服务器，见 README 第五节，或重跑本脚本加 -WithLsp。'
} else {
  Write-Host 'LSP 管道包已装（DSH 提示「declares no dsh.bundle」是正常的：它靠 profile 的 cordis.patch.yml 挂载）。'
  Write-Host '还差两步：把语言服务器放到本机，并在 cordis.patch.yml 里加 lsp / lsp-stdio 两行——见 README 第五节。'
}

# Install the dsh-ide-window plugin into a DSH profile (Windows).
#
#   .\install.ps1                  # clone/pull into %USERPROFILE%\dev\dsh-ide-window, install into `desktop`
#   .\install.ps1 -Profile web     # another profile
#   .\install.ps1 -Dir C:\src\x    # another checkout location
#   .\install.ps1 -WithLsp         # also add the LSP pipeline packages
#   .\install.ps1 -NoPull          # keep the checkout as it is
#
# Safe to re-run: an existing checkout is fast-forwarded, and installing an
# already linked package changes nothing. The DSH application itself is never
# modified.
#
# Only pnpm and plain PowerShell are used: the Electron binary is a GUI
# application on Windows, so driving it in Node mode from PowerShell would
# neither wait nor capture output.
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
function Fail([string]$Text) {
  Write-Host "错误：$Text" -ForegroundColor Red
  throw "dsh-ide-window: $Text"
}

# ---- 1. locate DSH and pnpm -------------------------------------------------

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
Write-Host "    DSH：$appBin"

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"

# pnpm from PATH, otherwise the copy DSH ships next to its own Node runtime.
$pnpmCommand = $null
$pnpmArgs = @()
$onPath = Get-Command pnpm -ErrorAction SilentlyContinue
if ($onPath) {
  $pnpmCommand = $onPath.Source
} else {
  $runtime = Join-Path $dshHome 'dsh-runtimes\dsh-primary-runtime\dependencies'
  $nodeExe = Join-Path $runtime 'node\node.exe'
  $pnpmCjs = Join-Path $runtime 'pnpm\bin\pnpm.cjs'
  if ((Test-Path $nodeExe) -and (Test-Path $pnpmCjs)) {
    $pnpmCommand = $nodeExe
    $pnpmArgs = @($pnpmCjs)
  }
}
if (-not $pnpmCommand) { Fail '需要 pnpm：npm i -g pnpm（也可以先启动一次 DSH，它会自带一份 pnpm）。' }
Write-Host "    pnpm：$pnpmCommand"

function Invoke-Pnpm([string[]]$Arguments, [string]$WorkDir) {
  Push-Location $WorkDir
  try {
    $all = @($pnpmArgs) + @($Arguments)
    & $pnpmCommand @all
    if ($LASTEXITCODE -ne 0) { throw "pnpm 执行失败（exit $LASTEXITCODE）" }
  } finally {
    Pop-Location
  }
}

# ---- 2. checkout ------------------------------------------------------------

function Normalize-Remote([string]$Remote) {
  $normalized = $Remote -replace '^git@[^:]*:', 'https://github.com/'
  $normalized = $normalized -replace '^ssh://git@[^/]*/', 'https://github.com/'
  $normalized = $normalized -replace '^https?://[^/]*/', 'https://github.com/'
  $normalized = $normalized -replace '\.git$', '' -replace '/+$', ''
  return ($normalized -replace '^https://github.com/', '')
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail '需要 git，请先安装（https://git-scm.com/download/win）。'
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

if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  Fail "profile ${Profile}还没有初始化：先启动一次 DSH，再重跑本脚本。"
}

Step "安装插件到 profile：$Profile"
$installed = $false
$dshCommand = Get-Command dsh -ErrorAction SilentlyContinue
if ($dshCommand) {
  try {
    & dsh plugin --profile $Profile add "link:$Dir"
    if ($LASTEXITCODE -eq 0) { $installed = $true }
  } catch {
    $installed = $false
  }
}
if (-not $installed) {
  # `desktop` is owned by the application and its CLI refuses every command; the
  # application itself installs through pnpm inside the profile directory.
  Write-Host '    改用 profile 内的 pnpm 安装'
  Invoke-Pnpm @('add', "link:$Dir") $profileDir
}

if ($WithLsp) {
  Step '安装 LSP 管道包（语言服务器本身还要另外准备）'
  Invoke-Pnpm (@('add') + $lspPackages) $profileDir
}

# ---- 4. make sure the bundle is listed -------------------------------------

Step '确认 bundle 已登记'
$packageJsonPath = Join-Path $profileDir 'package.json'
$packageJson = Get-Content -Path $packageJsonPath -Raw | ConvertFrom-Json
if ($null -eq $packageJson.dsh) { $packageJson | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $packageJson.dsh.profile) { $packageJson.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
if ($null -eq $packageJson.dsh.profile.bundles) { $packageJson.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() }
$bundles = @($packageJson.dsh.profile.bundles)
if ($bundles -contains $packageName) {
  Write-Host "    已登记: $packageName"
} else {
  $packageJson.dsh.profile.bundles = @($bundles + $packageName)
  # UTF-8 without BOM: the profile loader parses this file as JSON.
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($packageJsonPath, ($packageJson | ConvertTo-Json -Depth 20), $utf8)
  Write-Host "    已登记: $packageName"
}

# ---- 5. verify -------------------------------------------------------------

Step '校验安装结果'
$check = Get-Content -Path $packageJsonPath -Raw | ConvertFrom-Json
$linkedEntry = $check.dependencies.PSObject.Properties[$packageName]
$linked = if ($null -eq $linkedEntry) { $null } else { $linkedEntry.Value }
$bundleList = @($check.dsh.profile.bundles)
$linkedText = if ($null -eq $linked) { '' } else { [string]$linked }
Write-Host "    依赖: $(if ($linkedText -eq '') { '缺失' } else { $linkedText })"
Write-Host "    bundle: $(if ($bundleList -contains $packageName) { '已登记' } else { '缺失' })"
if ($linkedText -eq '' -or -not $linkedText.Contains($Dir) -or -not ($bundleList -contains $packageName)) {
  Fail '装完了但校验没过，请把上面的输出发给维护者。'
}

Write-Host "`n全部完成。" -ForegroundColor Green
Write-Host "  仓库：$Dir"
Write-Host "  profile：$profileDir"
Write-Host "`n下一步：完全退出 DSH（托盘里退出，不是关窗口）再打开，左侧导航或左下角会出现「代码工作区」。"
if (-not $WithLsp) {
  Write-Host '代码导航（可选）：再运行 enable-navigation.ps1，见 README 第五节。'
} else {
  Write-Host 'LSP 管道包已装；还差语言服务器与 cordis.patch.yml 两行——enable-navigation.ps1 会一次做完。'
}

# Turn code navigation (LSP) on for dsh-ide-window — Windows.
#
#   .\enable-navigation.ps1                 # packages + server download + patch lines
#   .\enable-navigation.ps1 -NoDownload     # skip the server download (already have it)
#   .\enable-navigation.ps1 -Profile web    # another profile
#
# Safe to re-run. Only writes under %USERPROFILE%\.dsh (profile, lsp-bin,
# lsp-data); the DSH application itself is never modified.
#
# If PowerShell refuses to run this file ("execution policy"), start it with:
#   powershell -ExecutionPolicy Bypass -File .\enable-navigation.ps1
param(
  [string]$Profile = 'desktop',
  [switch]$NoDownload
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

$lspVersion = '0.2.2-rc.3'
$packages = @("@deepseek-ai/dsh-lsp@$lspVersion", "@deepseek-ai/dsh-lsp-stdio@$lspVersion")

# JetBrains publishes the server per platform under the same build. The CDN host
# only serves signed URLs, so the download always goes through
# download.jetbrains.com.
$build = '271.2085.0'
$arm = $env:PROCESSOR_ARCHITECTURE -eq 'ARM64'
$archiveName = if ($arm) { "intellij-server-$build-aarch64.win.zip" } else { "intellij-server-$build.win.zip" }
$archiveUrl = "https://download.jetbrains.com/language-server/intellij-server/$build/$archiveName"

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileDir = Join-Path $dshHome "profiles\$Profile"
$lspBin = Join-Path $dshHome 'lsp-bin'
$lspData = Join-Path $dshHome 'lsp-data\intellij-server'

function Step([string]$Text) { Write-Host "`n==> $Text" }
# `exit` would close the console when the script runs through `irm | iex`, which
# looks like a window that flashes and disappears. Throwing keeps the window and
# prints the reason.
function Fail([string]$Text) {
  Write-Host "错误：$Text" -ForegroundColor Red
  throw "dsh-ide-window: $Text"
}

if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  Fail "profile ${Profile}还没有初始化：先启动一次 DSH 再重跑。"
}
# The copy DSH ships comes first: the profile was installed by that exact pnpm,
# and a different major version uses a different store directory — pnpm then
# refuses with ERR_PNPM_UNEXPECTED_STORE.
$pnpmCommand = $null
$pnpmArgs = @()
$runtime = Join-Path $dshHome 'dsh-runtimes\dsh-primary-runtime\dependencies'
$nodeExe = Join-Path $runtime 'node\node.exe'
$pnpmCjs = Join-Path $runtime 'pnpm\bin\pnpm.cjs'
if ((Test-Path $nodeExe) -and (Test-Path $pnpmCjs)) {
  $pnpmCommand = $nodeExe
  $pnpmArgs = @($pnpmCjs)
} else {
  $onPath = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($onPath) { $pnpmCommand = $onPath.Source }
}
if (-not $pnpmCommand) { Fail '需要 pnpm：npm i -g pnpm（也可以先启动一次 DSH，它会自带一份 pnpm）。' }
$pnpmVersion = (& $pnpmCommand @pnpmArgs --version 2>$null | Out-String).Trim()
Write-Host "    pnpm：$pnpmCommand $pnpmVersion"

# ---- 1. pipeline packages ---------------------------------------------------

Step "安装 LSP 管道包（$lspVersion）"

# Run pnpm with its output captured: the npm error code (a store mismatch, a
# blocked registry, a missing version) is the only useful clue, and it was being
# swallowed before.
function Install-Packages([string[]]$Arguments) {
  Push-Location $profileDir
  try {
    $all = @($pnpmArgs) + $Arguments
    $output = & $pnpmCommand @all 2>&1
    $code = $LASTEXITCODE
    return [pscustomobject]@{ Code = $code; Output = ($output | Out-String).Trim() }
  } finally {
    Pop-Location
  }
}

$attempt = Install-Packages (@('add') + @($packages))
if ($attempt.Code -ne 0) {
  Write-Host '    第一次安装失败，pnpm 输出如下：' -ForegroundColor Yellow
  Write-Host $attempt.Output
  Write-Host '    改用 npmmirror 镜像重试…' -ForegroundColor Yellow
  $attempt = Install-Packages (@('add', '--registry', 'https://registry.npmmirror.com') + @($packages))
}
if ($attempt.Code -ne 0) {
  Write-Host '    镜像也失败，pnpm 输出如下：' -ForegroundColor Red
  Write-Host $attempt.Output
  Fail "pnpm add 失败（exit $($attempt.Code)）：看上面的 npm 错误码。ERR_PNPM_UNEXPECTED_STORE 表示 pnpm 的 store 版本和 profile 里的不一致；EAI_AGAIN/ETIMEDOUT/ECONNREFUSED 是网络或代理。"
}
Write-Host '    已安装：@deepseek-ai/dsh-lsp、dsh-lsp-stdio'

# ---- 2. language server -----------------------------------------------------

Step '准备语言服务器'
New-Item -ItemType Directory -Path $lspBin, $lspData -Force | Out-Null
$serverBin = $null
if (Test-Path $lspBin) {
  $found = Get-ChildItem -Path $lspBin -Recurse -Filter 'intellij-server.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\bin\\' } |
    Select-Object -First 1
  if ($found) { $serverBin = $found.FullName }
}

if (-not $serverBin -and -not $NoDownload) {
  Write-Host "    未找到服务器，开始下载 $archiveName（约 390 MB）"
  $zip = Join-Path ([System.IO.Path]::GetTempPath()) "intellij-server-$build.zip"
  try {
    Invoke-WebRequest -Uri $archiveUrl -OutFile $zip -UseBasicParsing
  } catch {
    Fail "下载失败，可手动下载：$archiveUrl"
  }
  # The Windows archive has no top-level folder (`bin/`, `jbr/`, `plugins/` sit at
  # the root), so it must be unpacked into a versioned directory: the host looks
  # for `lsp-bin\intellij-server-*\bin\<launcher>`.
  $serverDir = Join-Path $lspBin 'intellij-server-2027.1'
  New-Item -ItemType Directory -Path $serverDir -Force | Out-Null
  Write-Host "    解压到 $serverDir"
  Expand-Archive -Path $zip -DestinationPath $serverDir -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  $found = Get-ChildItem -Path $lspBin -Recurse -Filter 'intellij-server.exe' |
    Where-Object { $_.FullName -match '\\bin\\' } |
    Select-Object -First 1
  if ($found) { $serverBin = $found.FullName }
}

if (-not $serverBin) {
  Fail "缺少服务器。手动下载 $archiveUrl ，解压到 $lspBin，再重跑本脚本。"
}
Write-Host "    服务器：$serverBin"

# ---- 3. patch lines ---------------------------------------------------------

Step '写入 cordis.patch.yml 的 lsp / lsp-stdio 两行'
$patchPath = Join-Path $profileDir 'cordis.patch.yml'
# Forward slashes: the loader YAML needs no escaping, and Node spawns .exe directly.
$serverPosix = $serverBin -replace '\\', '/'
$dataPosix = $lspData -replace '\\', '/'
$block = @"
# 代码导航：IntelliJ Language Server
- insert:
    - id: lsp
      name: "@deepseek-ai/dsh-lsp"
    - id: lsp-stdio
      name: "@deepseek-ai/dsh-lsp-stdio"
      config:
        servers:
          java:
            command: $serverPosix
            extensionToLanguage:
              ".java": java
            args:
              - --stdio
              - --eula=cd82e6cdaf2790f1
              - --system-path=$dataPosix
              - --data-sharing=none
              - --log-level=WARNING
            maxDocumentBytes: 4000000
"@

# A `$` in a Windows user name would be read as a regex replacement token, so
# escape it before handing the path to the replacement string.
function Escape-Replacement([string]$Value) { return ($Value -replace '\$', '$$$$') }

$text = if (Test-Path $patchPath) { Get-Content -Path $patchPath -Raw } else { '' }
if ($text -match '(?m)^\s*- id: lsp$') {
  # Rewrite paths in place: they may come from another machine or build.
  $text = [regex]::Replace($text, 'command:\s*\S*/bin/intellij-server(\.exe)?', ('command: ' + (Escape-Replacement $serverPosix)))
  $text = [regex]::Replace($text, '--system-path=\S+', ('--system-path=' + (Escape-Replacement $dataPosix)))
  Write-Host '    已有 lsp 两行，已按本机路径校正'
} else {
  $text = $block + $text
  Write-Host '    已写入 lsp 两行'
}
# UTF-8 without BOM: the profile loader reads YAML, and a BOM would end up in
# the first key.
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($patchPath, $text, $utf8)

# ---- 4. license -------------------------------------------------------------

Step '检查 JetBrains 服务器授权'
& $serverBin license status
if ($LASTEXITCODE -ne 0) {
  Write-Host '    未授权或已失效。执行下面这条，按浏览器提示登录后再重启 DSH：' -ForegroundColor Yellow
  Write-Host "    `"$serverBin`" license login"
}

Write-Host "`n下一步：完全退出 DSH（托盘里退出，不是关窗口）再打开；进入代码工作区不再弹「代码导航未就绪」即成功。" -ForegroundColor Green

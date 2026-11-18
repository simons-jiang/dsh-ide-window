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
function Fail([string]$Text) { Write-Host "错误：$Text" -ForegroundColor Red; exit 1 }

if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  Fail "profile ${Profile}还没有初始化：先启动一次 DSH 再重跑。"
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Fail '需要 pnpm：npm i -g pnpm（DSH 的插件安装也依赖它）'
}

# ---- 1. pipeline packages ---------------------------------------------------

Step "安装 LSP 管道包（$lspVersion）"
Push-Location $profileDir
try {
  pnpm add @packages | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'pnpm add 失败，请检查网络或代理。' }
} finally {
  Pop-Location
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

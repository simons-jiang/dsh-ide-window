# Restore the plugin and the LSP configuration after a DSH upgrade.
#
#   .\restore-profile.ps1
$ErrorActionPreference = 'Stop'

$profile = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
$pluginDir = $PSScriptRoot
$serverDir = Join-Path $env:USERPROFILE '.dsh\lsp-bin\intellij-server-2027.1\bin'
$server = @('intellij-server.bat', 'intellij-server.exe', 'intellij-server') |
  ForEach-Object { Join-Path $serverDir $_ } |
  Where-Object { Test-Path $_ } | Select-Object -First 1

Write-Host '== 1/4 检查服务器 =='
if (-not $server) {
  Write-Error "缺少 $serverDir\intellij-server.bat（下载 intellij-server 并解压到 ~/.dsh/lsp-bin/）"
}
& $server --version 2>$null | Out-Host

Write-Host '== 2/4 安装插件与 LSP 包 =='
Push-Location $profile
try {
  # Pipeline packages follow the installed DSH release (read from the executable).
  $dshExe = (Get-Command 'DeepSeek Harness' -ErrorAction SilentlyContinue)?.Source
  $lspVersion = 'latest'
  if ($dshExe) {
    $detected = (Get-Item $dshExe).VersionInfo.ProductVersion
    if ($detected) { $lspVersion = ($detected -replace '^v', '').Trim() }
  }
  pnpm add "link:$pluginDir" "@deepseek-ai/dsh-lsp@$lspVersion" "@deepseek-ai/dsh-lsp-stdio@$lspVersion" | Out-Null
} finally { Pop-Location }

Write-Host '== 3/4 写入 bundle 与 LSP 配置 =='
$pkgPath = Join-Path $profile 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$bundles = @($pkg.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-ide-window') {
  $pkg.dsh.profile.bundles = @($bundles + 'dsh-ide-window')
  $pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8
}
$patchPath = Join-Path $profile 'cordis.patch.yml'
$patch = Get-Content $patchPath -Raw
if ($patch -notmatch 'dsh-lsp-stdio') {
  $serverPath = $server -replace '\\', '/'
  $systemPath = (Join-Path $env:USERPROFILE '.dsh\lsp-data\intellij-server') -replace '\\', '/'
  $block = @"
# 代码导航：IntelliJ Language Server（授权版，271.2085.0）
- insert:
    - id: lsp
      name: "@deepseek-ai/dsh-lsp"
    - id: lsp-stdio
      name: "@deepseek-ai/dsh-lsp-stdio"
      config:
        servers:
          java:
            command: $serverPath
            extensionToLanguage:
              ".java": java
            args:
              - --stdio
              - --eula=cd82e6cdaf2790f1
              - --system-path=$systemPath
              - --data-sharing=none
              - --log-level=WARNING
            maxDocumentBytes: 4000000

"@
  Set-Content -Path $patchPath -Value ($block + $patch) -Encoding UTF8
}
Write-Host '   package.json 与 cordis.patch.yml 已就绪'

Write-Host '== 4/4 验证 =='
& $server license status 2>&1 | Select-String 'License:|Account:' | Out-Host
Write-Host '   完成。重启 DSH 生效。'

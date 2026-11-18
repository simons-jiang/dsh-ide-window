# Verify the DSH installation itself was not modified.
#
# The plugin may only write its own source, its profile configuration
# (%USERPROFILE%\.dsh\profiles\*) and session data. Touching the application
# invalidates its signature and breaks on the next upgrade.
#
#   .\check-dsh-untouched.ps1           verify
#   .\check-dsh-untouched.ps1 -Rebase   reset the baseline after an official upgrade
param([switch]$Rebase)
$ErrorActionPreference = 'Stop'

$App = if ($env:DSH_APP) { $env:DSH_APP }
  elseif (Test-Path "$env:LOCALAPPDATA\Programs\DeepSeek Harness") { "$env:LOCALAPPDATA\Programs\DeepSeek Harness" }
  else { "$env:ProgramFiles\DeepSeek Harness" }
$Asar = if (Test-Path (Join-Path $App 'resources\app.asar')) {
  Join-Path $App 'resources\app.asar'
} else {
  Join-Path $App 'Resources\app.asar'
}
$Baseline = Join-Path $PSScriptRoot '.dsh-asar.sha256'
$fail = $false

Write-Host '== 1/3 代码签名 =='
$exe = Get-ChildItem $App -Filter '*.exe' -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $exe) {
  Write-Host '   ? 没有找到可执行文件，跳过签名检查'
} else {
  $signature = Get-AuthenticodeSignature $exe.FullName
  if ($signature.Status -eq 'Valid') { Write-Host '   ✓ 签名有效' }
  else { Write-Host "   ✗ 签名校验失败（$($signature.Status)）"; $fail = $true }
}

Write-Host '== 2/3 app.asar 哈希 =='
if (-not (Test-Path $Asar)) { Write-Host "   ✗ 找不到 $Asar"; exit 1 }
$Current = (Get-FileHash $Asar -Algorithm SHA256).Hash.ToLower()
if ($Rebase) {
  Set-Content -Path $Baseline -Value $Current -NoNewline
  Write-Host "   · 基线已重设为 $($Current.Substring(0, 16))…"
} elseif (-not (Test-Path $Baseline)) {
  Set-Content -Path $Baseline -Value $Current -NoNewline
  Write-Host "   · 首次运行，已记录基线 $($Current.Substring(0, 16))…"
} elseif ((Get-Content $Baseline -Raw).Trim() -eq $Current) {
  Write-Host "   ✓ $($Current.Substring(0, 16))… 与基线一致"
} else {
  Write-Host '   ✗ 与基线不一致'
  Write-Host "     基线: $((Get-Content $Baseline -Raw).Trim().Substring(0, 16))…"
  Write-Host "     当前: $($Current.Substring(0, 16))…"
  Write-Host '     （若刚做过官方升级，用 -Rebase 重设基线）'
  $fail = $true
}

Write-Host '== 3/3 包内可疑新文件 =='
$installed = (Get-Item $Asar).LastWriteTime
$threshold = $installed.AddHours(1)
Write-Host "   安装时间: $($installed.ToString('yyyy-MM-dd HH:mm:ss'))（容忍安装后 1 小时内的写入）"
$suspect = Get-ChildItem $App -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -gt $threshold } | Select-Object -First 5
if ($null -eq $suspect) { Write-Host '   ✓ 没有超出安装窗口的新文件' }
else {
  Write-Host '   ✗ 发现可疑文件：'
  $suspect | ForEach-Object { Write-Host "     $($_.FullName)" }
  $fail = $true
}

if ($fail) { Write-Host '结论：DSH 本体可能被改动 ✗'; exit 1 }
Write-Host '结论：DSH 本体未被改动 ✓'

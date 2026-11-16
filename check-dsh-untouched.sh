#!/bin/bash
# 校验 DSH 本体未被改动。
#
# 原则：插件只能改自己的源码、自己的 profile 配置（~/.dsh/profiles/*）和会话数据，
# 绝不修改 /Applications/DeepSeek Harness.app —— 一旦改了本体，签名失效、升级会覆盖或
# 直接损坏，插件在版本升级后必然不可用。
#
# 判定依据（按可信度排序）：
#   1. 代码签名：任何密封文件被改都会让它失败，这是权威判据；
#   2. app.asar 哈希：与首次运行本脚本时记录的基线比对，精确到字节；
#   3. 包内比安装时间晚一小时以上的文件（安装过程本身会写 CodeResources 等，属正常）。
#
# 用法：
#   ./check-dsh-untouched.sh           校验
#   ./check-dsh-untouched.sh --rebase  升级 DSH 后重设基线（确认过是官方升级再用）
set -uo pipefail

APP="${DSH_APP:-/Applications/DeepSeek Harness.app}"
ASAR="$APP/Contents/Resources/app.asar"
BASELINE="$(cd "$(dirname "$0")" && pwd)/.dsh-asar.sha256"
fail=0

echo "== 1/3 代码签名 =="
if codesign --verify --deep --strict "$APP" 2>/dev/null; then
  echo "   ✓ 签名有效"
else
  echo "   ✗ 签名校验失败（本体被改过）"
  fail=1
fi

echo "== 2/3 app.asar 哈希 =="
CURRENT=$(shasum -a 256 "$ASAR" | awk '{print $1}')
if [ "${1:-}" = "--rebase" ]; then
  echo "$CURRENT" > "$BASELINE"
  echo "   · 基线已重设为 ${CURRENT:0:16}…"
elif [ ! -f "$BASELINE" ]; then
  echo "$CURRENT" > "$BASELINE"
  echo "   · 首次运行，已记录基线 ${CURRENT:0:16}…"
elif [ "$(cat "$BASELINE")" = "$CURRENT" ]; then
  echo "   ✓ ${CURRENT:0:16}… 与基线一致"
else
  echo "   ✗ 与基线不一致"
  echo "     基线: $(cut -c1-16 "$BASELINE")…"
  echo "     当前: ${CURRENT:0:16}…"
  echo "     （若刚做过官方升级，用 --rebase 重设基线）"
  fail=1
fi

echo "== 3/3 包内可疑新文件 =="
INSTALLED=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$ASAR")
THRESHOLD=$(date -j -f "%Y-%m-%d %H:%M:%S" "$INSTALLED" -v+1H "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "$INSTALLED")
echo "   安装时间: ${INSTALLED}（容忍安装后 1 小时内的写入）"
SUSPECT=$(find "$APP" -type f -newermt "$THRESHOLD" 2>/dev/null | head -5 || true)
if [ -z "$SUSPECT" ]; then
  echo "   ✓ 没有超出安装窗口的新文件"
else
  echo "   ✗ 发现可疑文件："
  echo "$SUSPECT" | sed 's/^/     /'
  fail=1
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "结论：DSH 本体未被改动 ✓"
  echo "允许写入的位置：~/.dsh/profiles、~/.dsh/sessions、~/.dsh/lsp-*、插件自身目录"
else
  echo "结论：本体可能被改动，请先核对上面的差异 ✗"
  exit 1
fi

#!/usr/bin/env bash
#
# Turn code navigation (LSP) on for dsh-ide-window — macOS.
#
#   ./enable-navigation.sh                 # packages + server download + patch lines
#   ./enable-navigation.sh --no-download   # skip the server download (already have it)
#   ./enable-navigation.sh --profile web   # another profile
#
# Safe to re-run. Only writes under ~/.dsh (profile, lsp-bin, lsp-data); the DSH
# application itself is never modified.
set -euo pipefail

LSP_VERSION="0.2.2-rc.5"
PACKAGES=("@deepseek-ai/dsh-lsp@${LSP_VERSION}" "@deepseek-ai/dsh-lsp-stdio@${LSP_VERSION}")
SERVER_URL="https://download.jetbrains.com/language-server/intellij-server/271.2085.0/intellij-server-271.2085.0-aarch64.sit"

PROFILE="${DSH_PROFILE:-desktop}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
LSP_BIN="$DSH_HOME_DIR/lsp-bin"
LSP_DATA="$DSH_HOME_DIR/lsp-data/intellij-server"
DOWNLOAD=1

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"; shift 2 ;;
    --no-download) DOWNLOAD=0; shift ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '错误：%s\n' "$1" >&2; exit 1; }

[ -f "$PROFILE_DIR/package.json" ] || fail "profile ${PROFILE}还没有初始化：先启动一次 DSH 再重跑。"
command -v pnpm >/dev/null 2>&1 || fail "需要 pnpm：npm i -g pnpm"
command -v python3 >/dev/null 2>&1 || fail "需要 python3（macOS 自带）。"

# ---- 1. pipeline packages ---------------------------------------------------

step "安装 LSP 管道包（${LSP_VERSION}）"
( cd "$PROFILE_DIR" && pnpm add "${PACKAGES[@]}" >/dev/null && echo "    已安装：@deepseek-ai/dsh-lsp、dsh-lsp-stdio" )

# ---- 2. language server -----------------------------------------------------

step "准备语言服务器"
SERVER_BIN=""
find_server() {
  local candidate
  candidate="$(find "$LSP_BIN" -maxdepth 4 -type f -name intellij-server 2>/dev/null | head -1 || true)"
  printf '%s' "$candidate"
}
mkdir -p "$LSP_BIN" "$LSP_DATA"
SERVER_BIN="$(find_server)"

if [ -z "$SERVER_BIN" ] && [ "$DOWNLOAD" = 1 ]; then
  echo "    未找到服务器，开始下载（约 1.2 GB，来自 download.jetbrains.com）"
  TMP_ZIP="$(mktemp -t intellij-server).zip"
  curl -fL --progress-bar -o "$TMP_ZIP" "$SERVER_URL" || fail "下载失败，可手动下载：$SERVER_URL"
  echo "    解压到 ${LSP_BIN}"
  unzip -q -o "$TMP_ZIP" -d "$LSP_BIN" || fail "解压失败（归档是 zip 格式，用 unzip -d 手动解开）"
  rm -f "$TMP_ZIP"
  SERVER_BIN="$(find_server)"
fi

if [ -z "$SERVER_BIN" ]; then
  fail "缺少服务器。手动下载 $SERVER_URL ，unzip 到 ${LSP_BIN}，再重跑本脚本。"
fi
chmod +x "$SERVER_BIN" 2>/dev/null || true
echo "    服务器：$SERVER_BIN"

# ---- 3. patch lines ---------------------------------------------------------

step "写入 cordis.patch.yml 的 lsp / lsp-stdio 两行"
printf '%s' "$SERVER_BIN" > /tmp/.nav-server-path
printf '%s' "$PROFILE_DIR/cordis.patch.yml" > /tmp/.nav-patch-path
printf '%s' "$LSP_DATA" > /tmp/.nav-data-path
python3 - <<'PY'
import re, pathlib
server = pathlib.Path('/tmp/.nav-server-path').read_text().strip()
patch_path = pathlib.Path(pathlib.Path('/tmp/.nav-patch-path').read_text().strip())
data_dir = pathlib.Path('/tmp/.nav-data-path').read_text().strip()

block = f'''# 代码导航：IntelliJ Language Server
- insert:
    - id: lsp
      name: "@deepseek-ai/dsh-lsp"
    - id: lsp-stdio
      name: "@deepseek-ai/dsh-lsp-stdio"
      config:
        servers:
          java:
            command: {server}
            extensionToLanguage:
              ".java": java
            args:
              - --stdio
              - --eula=cd82e6cdaf2790f1
              - --system-path={data_dir}
              - --data-sharing=none
              - --log-level=WARNING
            maxDocumentBytes: 4000000
'''

text = patch_path.read_text()
if 'id: lsp' in text:
    # Rewrite the existing block in place: paths may come from another machine.
    text = re.sub(r'command: .*/bin/intellij-server', f'command: {server}', text)
    text = re.sub(r'--system-path=\S+', f'--system-path={data_dir}', text)
    patch_path.write_text(text)
    print('    已有 lsp 两行，已按本机路径校正')
else:
    patch_path.write_text(block + text)
    print('    已写入 lsp 两行')
PY
rm -f /tmp/.nav-server-path /tmp/.nav-patch-path /tmp/.nav-data-path

# ---- 4. license -------------------------------------------------------------

step "检查 JetBrains 服务器授权"
if "$SERVER_BIN" license status >/tmp/.nav-license 2>&1; then
  head -3 /tmp/.nav-license | sed 's/^/    /'
else
  head -5 /tmp/.nav-license | sed 's/^/    /' || true
  printf '    未授权或已失效。执行下面这条，按浏览器提示登录后再重启 DSH：\n'
  printf '    %s license login\n' "$SERVER_BIN"
fi
rm -f /tmp/.nav-license

printf '\n下一步：完全退出 DSH（⌘Q）再打开；进入代码工作区不再弹「代码导航未就绪」即成功。\n'

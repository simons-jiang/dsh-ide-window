#!/bin/bash
# 升级 DSH 后一键恢复：插件 + LSP 配置
# 用法：./restore-profile.sh
set -euo pipefail

PROFILE="${DSH_PROFILE:-$HOME/.dsh/profiles/desktop}"
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$HOME/.dsh/lsp-bin/intellij-server-2027.1/bin/intellij-server"

echo "== 1/4 检查服务器 =="
if [ -x "$SERVER" ]; then
  echo "   已有 $( "$SERVER" --version 2>/dev/null )"
else
  echo "   ✗ 缺少 $SERVER"
  echo "     下载：https://download.jetbrains.com/language-server/intellij-server/271.2085.0/intellij-server-271.2085.0-aarch64.sit"
  echo "     解压后放到 ~/.dsh/lsp-bin/intellij-server-2027.1/"
  exit 1
fi

echo "== 2/4 安装插件与 LSP 包 =="
cd "$PROFILE"
pnpm add "link:$PLUGIN_DIR" @deepseek-ai/dsh-lsp@0.2.2-rc.3 @deepseek-ai/dsh-lsp-stdio@0.2.2-rc.3 >/dev/null

echo "== 3/4 写入 bundle 与 LSP 配置 =="
python3 - "$PROFILE" "$SERVER" <<'PY'
import json, sys, pathlib
profile, server = pathlib.Path(sys.argv[1]), sys.argv[2]

pkg_path = profile / 'package.json'
pkg = json.loads(pkg_path.read_text())
bundles = pkg['dsh']['profile']['bundles']
if '@local/dsh-ide-window' not in bundles:
    bundles.append('@local/dsh-ide-window')
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')

patch_path = profile / 'cordis.patch.yml'
patch = patch_path.read_text()
if 'dsh-lsp-stdio' not in patch:
    block = f"""# 代码导航：IntelliJ Language Server（授权版，271.2085.0）
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
              - --system-path={pathlib.Path.home()}/.dsh/lsp-data/intellij-server
              - --data-sharing=none
              - --log-level=WARNING
            maxDocumentBytes: 4000000
"""
    patch_path.write_text(block + patch)
print('   package.json 与 cordis.patch.yml 已就绪')
PY

echo "== 4/4 验证 =="
"$SERVER" license status 2>&1 | grep -E "License:|Account:" || true
echo "   完成。重启 DSH 生效。"

#!/bin/bash
# Start a throwaway DSH web instance for testing this plugin.
#
# Why this exists: a fresh DSH_HOME shows the "开始使用" login dialog every time.
# The fix is reuse, not clicks — this script keeps one home under /tmp, copies
# this machine's account store into it once, links the plugin, and always binds
# the same port so the browser keeps its origin (and with it, the one-time
# "预览版说明" dismissal).
#
#   ./start-test-instance.sh              # foreground; Ctrl+C stops it
#   DSH_TEST_PORT=58001 ./start-test-instance.sh
#   DSH_TEST_WORKSPACE=~/dev/other ./start-test-instance.sh
#
# The account store is a copy of ~/.dsh/llm-deepseek. `/tmp` is cleared on
# reboot; delete the home yourself to drop the copy early: rm -rf "$DSH_TEST_HOME".
set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
home="${DSH_TEST_HOME:-/tmp/dsh-ide-test}"
port="${DSH_TEST_PORT:-57999}"
workspace="${DSH_TEST_WORKSPACE:-$HOME/Documents/workspace/bluewhale-order-service}"

electron="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
cli="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"
# The CLI path lives inside app.asar: the file test does not apply (the Electron
# runtime resolves it), so only the application bundle is checked here.
if [ ! -x "$electron" ]; then
  echo "DSH is not installed where this script expects it: $electron" >&2
  exit 1
fi

mkdir -p "$home/sessions" "$home/storages"

# The login dialog is gated by the credential store, not by llm-deepseek (that
# directory only caches attachment files). Copy the machine's store so this
# instance is signed in as the same user; it is refreshed every start because the
# desktop rotation may reissue the grant.
if [ -f "$HOME/.dsh/.credentials.yaml" ]; then
  if ! cmp -s "$HOME/.dsh/.credentials.yaml" "$home/.credentials.yaml" 2>/dev/null; then
    cp "$HOME/.dsh/.credentials.yaml" "$home/.credentials.yaml"
    chmod 600 "$home/.credentials.yaml"
    echo "account credentials copied into $home"
  fi
else
  echo "No credentials at ~/.dsh/.credentials.yaml — log in once in DSH first." >&2
  exit 1
fi
# Attachment cache, harmless and keeps shared attachments readable.
if [ ! -d "$home/llm-deepseek" ] && [ -d "$HOME/.dsh/llm-deepseek" ]; then
  cp -R "$HOME/.dsh/llm-deepseek" "$home/"
fi

# Sessions are read-only fixtures here: copy the known workspaces once.
if [ -z "$(ls -A "$home/sessions" 2>/dev/null)" ]; then
  for name in \
    "--Users-simon-Documents-workspace-bluewhale-order-service--" \
    "--Users-simon-Documents-myWorkspace-~6742~9879-dsh-ide-window--"; do
    if [ -d "$HOME/.dsh/sessions/$name" ]; then
      cp -R "$HOME/.dsh/sessions/$name" "$home/sessions/"
    fi
  done
  if [ -f "$HOME/.dsh/storages/workspace.json" ]; then
    cp "$HOME/.dsh/storages/workspace.json" "$home/storages/workspace.json"
  fi
  echo "workspace fixtures copied into $home"
fi

if [ ! -d "$workspace" ]; then
  echo "workspace not found: $workspace (set DSH_TEST_WORKSPACE)" >&2
  exit 1
fi

export DSH_HOME="$home"
ELECTRON_RUN_AS_NODE=1 "$electron" "$cli" plugin --profile web add "link:$repo" >/dev/null 2>&1 || true

cd "$workspace"
echo "test instance: http://127.0.0.1:$port (home $home)"
echo "the boot line (with its token) is also appended to $home/url.log"
# `tee` keeps the tokenised URL available after the fact: the browser needs it and
# the banner is printed before the process settles.
exec env ELECTRON_RUN_AS_NODE=1 "$electron" "$cli" --profile web --port "$port" --no-open 2>&1 | tee "$home/url.log"

#!/usr/bin/env bash
#
# Install the dsh-ide-window plugin into a DSH profile (macOS).
#
#   ./install.sh                 # clone/pull into ~/dev/dsh-ide-window, install into `desktop`
#   ./install.sh --profile web   # another profile
#   ./install.sh --dir ~/src/x   # another checkout location
#   ./install.sh --with-lsp      # also add the LSP pipeline packages
#   ./install.sh --no-pull       # keep the checkout as it is
#
# Safe to re-run: an existing checkout is fast-forwarded, and `plugin add` on an
# already linked package is a no-op. The DSH application itself is never modified.
set -euo pipefail

REPO_URL="https://github.com/simons-jiang/dsh-ide-window.git"
PACKAGE="@local/dsh-ide-window"
LSP_PACKAGES=("@deepseek-ai/dsh-lsp@0.2.2-rc.3" "@deepseek-ai/dsh-lsp-stdio@0.2.2-rc.3")

PROFILE="desktop"
DIR="${DSH_IDE_DIR:-$HOME/dev/dsh-ide-window}"
WITH_LSP=0
PULL=1

usage() {
  cat <<'TEXT'
Install the dsh-ide-window plugin into a DSH profile (macOS).

  ./install.sh                                   clone/pull ~/dev/dsh-ide-window, install into `desktop`
  ./install.sh --profile web                      another profile
  ./install.sh --dir ~/src/x                      another checkout location
  ./install.sh --with-lsp                         also add the LSP pipeline packages
  ./install.sh --no-pull                          keep the checkout as it is
  curl -fsSL <raw install.sh> | bash              run without keeping the script

Also works when piped: the arguments go after `bash -s --`.
TEXT
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --dir) DIR="${2:-}"; shift 2 ;;
    --with-lsp) WITH_LSP=1; shift ;;
    --no-pull) PULL=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '错误：%s\n' "$1" >&2; exit 1; }

# ---- 1. locate DSH and its CLI ---------------------------------------------

step "检查 DSH"
APP_BIN=""
for candidate in \
  "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  "$HOME/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
do
  if [ -x "$candidate" ]; then APP_BIN="$candidate"; break; fi
done
[ -n "$APP_BIN" ] || fail "没找到 DeepSeek Harness.app，请先安装并登录 DSH。"
CONTENTS_DIR="$(cd "$(dirname "$APP_BIN")/.." && pwd)"
# The application is packed in an asar archive: the shell cannot stat a path
# inside it, only the Electron binary (Node mode) can read it.
CLI_JS="$CONTENTS_DIR/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js"

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"

# Prefer the `dsh` command (documented form); otherwise run the bundled CLI
# through the application binary in Node mode, which every install has.
if command -v dsh >/dev/null 2>&1; then
  echo "    使用命令行：$(command -v dsh)"
  dsh_cli() { dsh "$@"; }
else
  echo "    命令行 dsh 不在 PATH，改用应用自带的 CLI"
  dsh_cli() { ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$CLI_JS" "$@"; }
fi

# Same binary, Node mode: used for the JSON edits below so that the script does
# not depend on a system Node installation.
node_run() { ELECTRON_RUN_AS_NODE=1 "$APP_BIN" "$@"; }

node_run -e 'process.exit(require("node:fs").existsSync(process.argv[1]) ? 0 : 1)' "$CLI_JS" \
  || fail "DSH 安装不完整：找不到内置 CLI（${CLI_JS}）"

command -v git >/dev/null 2>&1 || fail "需要 git，请先安装（xcode-select --install）。"

# ---- 2. checkout ------------------------------------------------------------

# Reduce every clone URL to `owner/repo`, so a checkout created over SSH (or
# copied from another machine) still counts as the same repository.
normalize_remote() {
  printf '%s' "$1" \
    | sed -e 's#^git@[^:]*:#https://github.com/#' \
          -e 's#^ssh://git@[^/]*/#https://github.com/#' \
          -e 's#^https://[^/]*/#https://github.com/#' \
          -e 's#^http://[^/]*/#https://github.com/#' \
          -e 's#\.git$##' -e 's#/*$##' \
    | sed -e 's#^https://github.com/##'
}
WANT_REMOTE="$(normalize_remote "$REPO_URL")"

if [ -d "$DIR/.git" ]; then
  HAVE_REMOTE="$(git -C "$DIR" remote get-url origin 2>/dev/null || true)"
  if [ "$(normalize_remote "$HAVE_REMOTE")" != "$WANT_REMOTE" ]; then
    fail "$DIR 已存在，但不是本仓库（origin: ${HAVE_REMOTE:-无}）；换一个 --dir 再试。"
  fi
  if [ "$PULL" = 1 ]; then
    step "更新仓库：$DIR"
    git -C "$DIR" pull --ff-only
  else
    step "使用现有仓库：${DIR}（--no-pull）"
  fi
else
  step "克隆仓库到 $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone "$REPO_URL" "$DIR"
fi
[ -f "$DIR/package.json" ] || fail "$DIR 里没有 package.json，克隆不完整。"
[ -f "$DIR/client.js" ] || fail "$DIR 里没有 client.js，仓库不完整。"

# ---- 3. install into the profile -------------------------------------------

step "安装插件到 profile：$PROFILE"
# The `desktop` profile is owned by the application: its CLI answers
# "managed exclusively by the Electron application" for every command. The app
# itself installs through pnpm inside the profile directory, so fall back to
# exactly that instead of failing.
if ! dsh_cli plugin --profile "$PROFILE" add "link:$DIR"; then
  echo "    该 profile 由应用托管，改用 profile 内的 pnpm"
  command -v pnpm >/dev/null 2>&1 || fail "需要 pnpm（DSH 安装插件也依赖它）：npm i -g pnpm"
  [ -f "$PROFILE_DIR/package.json" ] || fail "profile ${PROFILE}尚未初始化：先启动一次 DSH，再重跑本脚本。"
  ( cd "$PROFILE_DIR" && pnpm add "link:$DIR" )
fi

if [ "$WITH_LSP" = 1 ]; then
  step "安装 LSP 管道包（语言服务器本身还要另外准备）"
  dsh_cli plugin --profile "$PROFILE" add "${LSP_PACKAGES[@]}"
fi

# ---- 4. make sure the bundle is listed -------------------------------------

step "确认 bundle 已登记"
node_run -e '
const fs = require("node:fs")
const [file, name] = process.argv.slice(1)
let data
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"))
} catch (error) {
  console.error("读不了 profile 的 package.json: " + file)
  process.exit(1)
}
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
' "$PROFILE_DIR/package.json" "$PACKAGE"

# ---- 5. verify -------------------------------------------------------------

step "校验安装结果"
node_run -e '
const fs = require("node:fs")
const [file, name, dir] = process.argv.slice(1)
const data = JSON.parse(fs.readFileSync(file, "utf8"))
const deps = data.dependencies ?? {}
const bundles = data.dsh?.profile?.bundles ?? []
const linked = deps[name] ?? ""
const ok = bundles.includes(name) && String(linked).includes(dir)
console.log("    依赖: " + (linked === "" ? "缺失" : linked))
console.log("    bundle: " + (bundles.includes(name) ? "已登记" : "缺失"))
process.exit(ok ? 0 : 1)
' "$PROFILE_DIR/package.json" "$PACKAGE" "$DIR" || fail "装完了但校验没过，请把上面的输出发给维护者。"

printf '\n全部完成。\n'
printf '  仓库：%s\n' "$DIR"
printf '  profile：%s\n' "$PROFILE_DIR"
printf '\n下一步：完全退出 DSH（⌘Q）再打开，左侧导航或左下角会出现「代码工作区」。\n'
if [ "$WITH_LSP" = 0 ]; then
  printf '代码导航（可选）：还需要 LSP 管道包与语言服务器，见 README 第五节，或重跑本脚本加 --with-lsp。\n'
else
  printf 'LSP 管道包已装（DSH 提示「declares no dsh.bundle」是正常的：它靠 profile 的 cordis.patch.yml 挂载）。\n'
  printf '还差两步：把语言服务器放到本机，并在 cordis.patch.yml 里加 lsp / lsp-stdio 两行——见 README 第五节。\n'
fi

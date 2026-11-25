# dsh-ide-window 项目上下文（给新会话用）

> 这份文件是**接手这个项目时该知道的一切**：约定、架构、功能、踩过的坑。
> 在这个目录下新建 DSH 会话时会被自动注入；也可以在别的会话里手动 `@AGENTS.md`。

---

## 一、一句话说清项目

给 **DeepSeek Harness（DSH）** 写的一个客户端插件：把中央区域做成 **IDEA 风格的代码工作区**——
左侧文件树 + 编辑标签页 + 实时源码，进入时自动收起 DSH 自己的左侧导航栏，
对话仍然可达（`⌘1` 返回对话 / `⌘2` 打开代码工作区）。

- 仓库：`https://github.com/simons-jiang/dsh-ide-window`（分支 `main`）
- 包名：`@local/dsh-ide-window`（以 `link:` 方式装进 DSH 的 profile）
- 目标 DSH 版本：`0.2.2-rc.3` 及以上（桌面应用 + Web profile 都要能跑）
- LSP 管道包版本**跟随当前 DSH**（脚本从 Info.plist / exe 版本读，不写死；DSH 升级后重跑脚本）
- 语言栈：宿主 `index.js`（Node ESM）+ 客户端 `src/client/*.js`（无构建链，手写 `h()`）

---

## 二、硬约束（**违反就不算完成**）

| # | 约定 | 说明 |
|---|---|---|
| 1 | **绝不修改 DSH 本体** | `/Applications/DeepSeek Harness.app` 只读。所有对 DSH 源码/类型定义的访问都是 `read-only`（用 `ELECTRON_RUN_AS_NODE=1` 读 `app.asar`）。任何写操作只能落在 `~/.dsh/profiles`、`~/.dsh/sessions`、`~/.dsh/lsp-*`、插件自身目录 |
| 2 | **每次改完必须自证** | 跑 `npm test`；`./check-dsh-untouched.sh` 必须输出「DSH 本体未被改动 ✓」；涉及 UI 的改动要用浏览器实测（见第六节） |
| 3 | **没有明确指令不提交** | 只有用户说「提交」「推送」「提交并推送」才动 git。只改代码时交付「改动清单 + 建议 commit message + 验证结果」 |
| 4 | **提交信息规范** | `<type>: <中文描述>`（feat/fix/refactor/style/chore/docs）；**不要**加 `Co-Authored-By` |
| 5 | **编译/测试失败禁止推送** | 先报告失败原因 |
| 6 | **UI 必须与 DSH 一致** | 一律用 DSH 的设计 token（`--dsw-alias-*`、`--dsw-specific-menu`、`--dsw-elevation-prominent`、`--dsw-radius-*`），不自己造色值 |
| 7 | **诚实报告** | 做不到就说做不到，不假装实现（例如 DSH 没有「插入对话草稿」的插件 API，就不要假装能一键加进上下文） |
| 8 | **每个功能都要过系统兼容** | 插件同时支持 **macOS + Windows**。任何新功能（含修 bug）在交付前都必须走一遍下面的「新增功能兼容清单」：碰路径就归一化、碰外部命令/二进制就走平台层、碰文案就区分 ⌘/Ctrl，不能只在 macOS 上验证就完事 |

---

## 三、架构

### 3.1 两半：宿主 + 客户端

```
index.js               宿主（Node ESM）：注册 14 条 HTTP 路由，转发到 DSH 服务
client.js              客户端产物（build.mjs 生成，**必须提交**）
src/client/*.js        客户端源码片段（构建时按文件名排序拼接）
build.mjs              把 17 个片段 + locale 拼成 client.js
cordis.patch.yml       bundle patch：把插件插入 profile（id: dsh-ide-window）
locale/{zh,en}.json    UI 文案（165 个键）；插件管理器也从这里读标题/描述
```

**为什么有切片 + 构建**：浏览器模块加载器每个包只吃**一个**文件，所以源码必须合并成一个 factory body。片段前缀数字 = 拼接顺序。

| 片段 | 职责 |
|---|---|
| `00-css.js` | 全部 `.iw-*` 样式（单文件注入 `<style>`） |
| `05-icons.js` | 内联 SVG 图标（`ideSvg` 统一 16 网格） |
| `05-shortcut-registry.js` | **所有快捷键的唯一登记处** `IDE_SHORTCUTS` |
| `06-platform.js` | **客户端平台层**：`toPosix/toNative`、`isAbsolutePath`、手势选项与按键文案（`apply()` 里按 `ctx.shortcuts.platform` 换实例） |
| `07-log.js` | **客户端日志**：100 条环形缓冲 `ideLogRecord/ideLogSnapshot`，供「复制诊断信息」上报 |
| `10-core.js` | store（`useSyncExternalStore` 订阅）、偏好持久化、标签页/历史/视图状态 |
| `12-theme.js` | **配色主题**：注册表（10 套）、`<link id="iw-theme-link">` 切换、状态栏切换器；主题同时提供 8 个语法色变量；对外发布主题（见 3.6） |
| `20-tree.js` | 文件树（展开、筛选、拖宽、`⌘P` 定位） |
| `30-code.js` | 代码视图（行渲染、符号点击、跳转、右键菜单挂载） |
| `40-panel.js` | 面板骨架（工具栏、横幅、布局、字号 CSS 变量） |
| `45-tracker.js` | 会话追踪（面板与当前会话/工作区绑定） |
| `59-gesture-settings.js` | 设置分区（快捷键 / 字号）+ 标签页右键菜单组件 |
| `60-jump.js` | 文件地址声明与跳转拦截（`dsh-resource://file/session/**`） |
| `65-lsp.js` | LSP 语义辅助（符号消歧、注解属性、bean 字段推断） |
| `66-callchain.js` | 调用链（Alt+单击）：沿 `findReferences` 向上递归，思维导图式浮层 |
| `68-grep.js` | 工作区搜索 + jar 源码查询客户端 |
| `70-palette.js` | Search Everywhere（所有/类/符号/文件/文本/操作，默认所有） |
| `72-screenshot.js` | **截图编辑器**：宿主按设备像素抓屏 → 铺满窗口显示 → 拖框选区（无预设）→ 选框下方浮动条（矩形/文字/撤销 | 截图/截图并跳转会话）→ 裁切导出（原始像素、≤1 MB）；含 macOS 授权引导 |
| `90-apply.js` | 全部注册（槽位、快捷键、命令、设置项）+ `enter()/openPanel()` |

### 3.2 平台层（`platform/`，只支持 macOS + Windows）

**所有与操作系统相关的行为都在这里**，上层只调 `platform.*`，不再出现 `process.platform` 分支：

| 文件 | 职责 |
|---|---|
| `platform/contract.js` | 接口文档 + `PLATFORM_METHODS`（测试用它断言实现完整） |
| `platform/macos.js` | `toPosix` 恒等、`open` 打开浏览器、`.../rg`、`intellij-server` |
| `platform/windows.js` | `\` ↔ `/` 互转、`cmd /c start` 打开 URL、`rg.exe`、`intellij-server.bat`、`.bat/.cmd` 需要 shell |
| `platform/index.js` | `createPlatform(os)`：**只有 macOS（`darwin`/`macos`/`mac`）用 macOS 实现，其他一律 Windows** |

接口：`name`、`toPosix()`、`toNative()`、`isAbsolutePath()`、`expandUserPath()`、`ripgrepSuffixes`、`serverLauncherNames`、`needsShell()`、`openUrlCommand()`、`screenshotCommand()`、`clipboardImageCommand()`。

根路径不是平台差异：需要时用 `node:path` 的 `parse(path).root`。

**路径约定**：插件内部（路由、偏好、浏览器、LSP 结果、jar 路径）**一律 POSIX 斜杠**；平台只在边界转换（`toPosix` 进、`toNative` 出），所以文件树、FQN、工作区判定这些逻辑不用关心系统。宿主：`scopeOf()` 用 `platform.isAbsolutePath()` 判根路径、`safeRelativePath()` 统一相对路径；客户端：`ideAbs/ideRelativeTo/ideSplitPath/ideAncestorDirs/ideParent/ideBasename/ideFqnOf` 先过 `idePlatform.toPosix()`，`enterProject/setRoot` 在入口归一化根路径。

新增一个系统 = 实现 `contract.js` 的接口 + 在 `platform/index.js` 注册；新增一处系统差异 = 接口加一个成员 + 两个实现各写一遍。

**新增功能兼容清单（每次加功能/修 bug 都要过一遍）**

1. **碰路径 → 归一化**：任何来自 DSH、Git、LSP、用户输入的路径，先 `toPosix`（宿主 `platform.toPosix` / 客户端 `idePlatform.toPosix`）再比较或拼接；展示/复制给用户时用 `toNative`。不要在代码里写死 `/` 或 `\\` 拼接（源文件里就是反斜杠本身）。
2. **碰外部命令/二进制/系统目录 → 走平台层**：`spawn` 的命令名、`-sources.jar` 的扫描根、IntelliJ 启动器、ripgrep 二进制、默认浏览器命令，都必须从 `platform.*` 取；发现缺口就在 `contract.js` 加成员，然后 `macos.js` 与 `windows.js` 各实现一份（`test/platform.mjs` 会自动断言实现完整）。**Windows 上 `.bat`/`.cmd` 必须带 `shell: true`**（Node CVE-2024-27980 之后直接抛 EINVAL，被 `stderr: 'spawn-failed'` 吞掉就成了「点了没反应」）——统一用 `platform.needsShell(path)` 判断。
3. **碰快捷键/手势/菜单文案 → 区分平台**：`⌘`/`⌥` 只属于 macOS，Windows 用 `Ctrl`/`Alt`；客户端统一走 `idePlatformOf(...).gestureLabelKey / gestureChoices / bindingGlyphs`，不要再写 `platform === 'macos' ? ... : ...`。
4. **碰「在系统里打开」类能力 → 先确认两端都有**：Windows 没有 Finder/终端那种统一入口，拿不准就别做成功能（本次「在 Finder 中显示 / 在终端中打开」就是因此删除的）。
5. **测试**：`npm test` 必须绿（含 `test/platform.mjs`）；涉及路径解析的功能，在 `test/harness.mjs` 里补一条注入 Windows 平台的用例（`withPlatform`）。客户端与宿主各自实现了一份路径规则（浏览器不能 import 宿主代码），`harness` 里的采样对比（`toPosix`/`isAbsolutePath` 六个样例）就是防漂移的锁，改规则必须两边一起改。
6. **实测**：macOS 上按第六节跑一遍；Windows 上至少按 `AGENTS.md` 第九节的清单人工过一遍（或等实机验证），**未验证要在交付时明确说明**。

> 规则简化：**只有 macOS 走 macOS 分支，其他系统一律按 Windows 处理**。所以新增分支时只问一句「这是 macOS 特有的吗？」，不是就写进 Windows 实现。

### 3.3 宿主路由（`index.js`）

| 路由 | 作用 | 关键实现 |
|---|---|---|
| `/dsh-ide/lsp` | 转发 `ctx.lsp`（definition/references/implementation/hover） | 0 基 UTF-16 位置 |
| `/dsh-ide/grep` | 工作区文本搜索 | 走 DSH workspaceFiles |
| `/dsh-ide/diff` | 单文件 VCS 改动块 | `git diff -U0`，解析成行区间 |
| `/dsh-ide/jar` | 依赖源码 | 扫 `~/.m2/repository/**/*-sources.jar`（1900+ 个，按 mtime 新→旧，单次预算 600），**进程内解析 ZIP 中央目录**，不反编译、不复制、不落盘 |
| `/dsh-ide/status` | 工作区未提交文件 | `git status --porcelain=v1`，返回 `{path, status}` |
| `/dsh-ide/blame` | 每行的最后提交人 | `git blame --line-porcelain`，返回 `{line, author, time}` |
| `/dsh-ide/doctor` | 依赖自检 | `ctx.get('lsp')` 是否挂载，返回 `{lsp}`；引导页据此弹出 |
| `/dsh-ide/kinds` | Java 声明类型（树图标） | 读文件头 8 KB 解析 `class/interface/enum/record/@interface`，一次最多 300 个路径 |
| `/dsh-ide/log` | 文件的提交历史 | `git log --date=short --pretty=format:%h%x09%an%x09%ad%x09%s -n ≤100 -- <path>` |
| `/dsh-ide/refs` | 分支与标签 | `git for-each-ref refs/heads refs/tags`，返回 `{name, kind}` |
| `/dsh-ide/patch` | 差异文本 | `git diff -U3 <base> [target] -- <path>`；根提交回退 `git show --patch`；未跟踪文件返回 `untracked` |
| `/dsh-ide/text` | 复制文件内容 | 读整个文件（≤512 KB），返回 `{text, truncated}` |
| `/dsh-ide/diagnostics` | 诊断日志 | `{action:'read'}` 返回本机最近 100 条事件 + 日志文件路径；`{action:'report', entries}` 接收浏览器缓冲的事件并写入同一文件（`level:'client'`） |
| `/dsh-ide/theme` | 主题样式表 | `GET ?id=<主题>` 返回 `themes/<id>.css`（唯一非 JSON 路由，浏览器用 `<link>` 取）；id 只允许 `[a-z0-9-]`，未知 404、非法 400 |
| `/dsh-ide/screenshot` | 截屏 | `{}` 抓屏（2560 长边 JPEG）返回 `{path, bytes, quality, dataUrl}`；`{copyOf:path}` 把已有文件写进剪贴板；`{copyDataUrl}` 把编辑器导出图（≤8 MB 请求体）写盘后进剪贴板。失败时 `403 no-screen-permission`（macOS 未授权）或 `500 capture-failed` |
| `/dsh-ide/screen-permission` | 打开授权面板 | 只 macOS 有效：`open x-apple.systempreferences:…Privacy_ScreenCapture`；其他系统回 `{opened:false}` |
| `/dsh-ide/license` | JetBrains 授权 | `{action:'status'}` 跑 `intellij-server license status`；`{action:'open'}` 后台跑 `license login --browser` 并回传授权 URL（6 秒内没出现 URL 就回传工具输出）。给这两个 JVM 动词加 `-Didea.log.path=<tmp>`，避免受限环境下写 `~/Library/Logs` 失败 |

### 3.3.1 跨插件主题约定（和 dsh-git-window）

代码工作区选的配色要能带着同页的 `dsh-git-window` 一起变，靠三条约定，**只有本插件写、对方只读**：

| 通道 | 形状 | 用途 |
|---|---|---|
| `localStorage['dsh-theme']` | 主题 id 字符串，空/缺失 = 跟随 DSH | 后加载的插件启动时能立刻读到 |
| `window` 事件 `dsh-theme` | `{ detail: { id } }` | 同页立即生效，不用刷新 |
| `data-dsh-theme` 属性 + `/dsh-ide/theme?id=<id>` | 主题文件选择器就是 `[data-dsh-theme="<id>"]` | 对方给自己的根节点加属性、`link` 同一份样式表即可套用 |

主题除了 alias token，还统一提供 `--dsw-alias-markdown-inline-code`（= `--dsw-alias-bg-layer-3`）给行内代码，`test/theme.mjs` 会断言 10 套主题的 token 集合一致。

改主题文件的选择器或键名 = 改接口，必须同步改 `dsh-git-window`（它的 `src/client/05-theme.js` 只读这三样）。对方没装本插件时样式请求 404，它保持自己的 token 外观，不会报错。

### 3.4 用到的 DSH 槽位

| 槽 | 用途 |
|---|---|
| `main`（keyed `dsh-ide-window:code`） | 面板占中栏 |
| `conversation.header.leading` | 会话表头左侧的入口按钮 |
| `settings.section`（id `dsh-ide-window`，order 70） | 设置左侧导航里的独立一页「代码工作区」（与「归档管理」同级） |
| `shell.overlay`（list） | 面板内浮层（用法弹层等）+ 悬浮助手卡（`dsh-ide-window:float`，order 60） |
| `sidebar.right.pane.tab` | 仅用于文件地址认领（body 不渲染） |
| `sidebar.footer.action` | 左下角入口 |

> `shell.bottom` 是**单例槽**，已被 git 插件占用，**不要抢**。

### 3.5 诊断日志（出问题先看这里）

**宿主**（`index.js`）：`logEvent(level, scope, message, detail)` 写入两个地方——

1. **内存环形缓冲**（最近 200 条），`POST /dsh-ide/diagnostics {action:'read'}` 返回最近 100 条 + `logFile`；
2. **JSONL 文件** `$DSH_HOME/logs/dsh-ide-window.log`（默认 `~/.dsh/logs/…`，测试实例落在自己的家目录），超过 512 KB 轮转为 `.1`。

默认会记的：插件启动（平台 + Node 版本）、**每条路由失败**（`level` 按状态码取 warn/error，带路由、状态码、错误码与消息）、`spawn` 起不来、授权命令起不来。写文件失败不会抛（诊断不能反过来弄坏请求）。

**客户端**（`src/client/07-log.js`）：`ideLogRecord` 维护 100 条环形缓冲，记——

- 用户看得到的每条通知（`scope:'ui'`，这就是「点了没反应」的第一手线索）；
- 路由调用失败（`scope:'route'`：网络、非 JSON、`error.code`）；
- LSP 查询失败（`scope:'lsp'`：错误码 + 服务器原话）；
- 页面级异常（`scope:'window'`：`error` / `unhandledrejection`）。

`localStorage['dsh-ide:trace'] = '1'` 会把这些同时打到控制台；`__dshIdeWindow.diagnostics()` 直接取快照。

**上报**：Search Everywhere 里的「复制诊断信息」动作 → 把客户端缓冲 POST 给宿主（追加进同一个文件）→ 读回宿主最近事件 → 复制 JSON 到剪贴板。剪贴板不可用/无响应时**不阻塞**，通知里给出日志文件路径。

**排查姿势**：

```bash
tail -f ~/.dsh/logs/dsh-ide-window.log            # 桌面端
tail -f /tmp/dsh-ide-test/logs/dsh-ide-window.log # 自测实例
```

---

## 四、功能清单（都已实现并自测）

### 4.1 工作区与代码视图
- 文件树：按需展开/筛选/拖宽/实时刷新/VCS 条；IDEA 序（文件夹在前，组内不区分大小写、自然排序 `file2` < `file10`）
- 文件树 VCS 着色：**有改动**的文件名蓝绿色（`#2fa79a`）、**新增/未跟踪**棕红色（`#b35f3d`）；数据来自 `/dsh-ide/status`（`state.vcs`，`path → 两位 porcelain 码`），在根目录确定、工作区变更帧（250ms 合并）、窗口聚焦、手动刷新时更新
- 文件图标：文件夹 20px；`.java` 按声明类型显示 `C`/`I`/`E`/`@`/`R` 徽标（`/dsh-ide/kinds`）；其他文件是文档轮廓 + 语言色首字母
- 文件树工具栏：定位当前文件 / 展开全部（逐层，≤200 目录）/ 收起全部
- 右键菜单定位：统一走 `useMenuPlacement()`——菜单挂在指针处，下方放得下就向下展开，放不下就让**菜单底边贴着指针**向上展开（高度是挂载后实测的，分隔线与分组都算）；超过面板高度才内部滚动。所以既不会被面板边缘裁掉，也不会离鼠标很远
- 标签页：多标签、中间键关闭、**右键菜单**（关闭 / 其他 / 全部 / 未修改 / 左侧 / 右侧 / 只读 / 添加到上下文 / 复制路径）
- **文件树右键菜单**：在代码工作区打开 / 复制文件内容、**复制引用回对话**、绝对路径、仓库相对路径、限定类名；**Git 分组**：使用 Git 追溯注解、显示差异（叠加层展示 unified diff）、显示历史记录、与修订比较…（最近提交列表）、与分支或标签比较…（分支/标签列表）；差异弹层与选择器用 `iw-overlay`，Esc 关闭
- 窗口聚焦：重读当前标签（`reloadActive`，内容 + git 色带）
- **导航历史记「看到哪」**：条目 `{path, line, top}`，`top` 来自 `state.scroll[path]`；`openAt(path,line,{top})` 先种 `scroll` 再清 `reveal`，否则返回会跳回第一行（有用例）
- 项目跟随会话：面板根目录**永远由当前会话决定**（`45-tracker` 解析会话 → 工作区）；项目下拉只做「切到该工作区的会话」，不再持久化手动选择（原 `preferredRoot` 已删除）；切换项目走 `enterProject(root, session)`，**会话与根目录一次 patch、一次 restart**（分两步会让旧标签以新会话作用域重读，闪出 `outside-workspace` 红字）；面板里读 `getState()` 判断而非订阅 `rootPath`，避免手动切换被跟随逻辑回滚
- 对话里的文件卡片点开都走本插件工作区，不再打开右侧预览（捕获阶段拦 `click`，随后 `selectPanel`）：
  - **「已编辑 N 个文件」卡片**：点**文件行**进工作区（行内隐藏 span 带绝对路径）；**卡片头部仍打开官方 review**——一个列表最有用的事就是看整体差异
  - **「已编辑 <文件名>」卡片**（只有 1 个文件）：整张卡点进工作区
  - **交付文件卡**（`[data-presented-file]`）：点卡片进工作区；卡片自己的操作按钮**不拦**
- 视图持久化：每个工作区记标签/激活项/展开目录/树宽/树可见性（≤3 个）
- 大文件保护：>60000 行或超字节上限时截断提示
- **Markdown 文件预览**：`.md/.markdown/.mdx` 打开即渲染（`IdeFloatMarkdown` 复用），顶部只有「预览 / 源码」两个按钮（**文件名不在这里重复**，面包屑已经写着）；判定是纯函数 `ideIsMarkdownPath`（有用例）。行内代码的底色取 `--dsw-alias-markdown-inline-code`，**10 套主题都把它定义成 `var(--dsw-alias-bg-layer-3)`**，所以工作区里不会出现「白底白字」

### 4.2 语义导航（IntelliJ LSP）
- **双击**判定「是不是声明」的关键**不是**看有没有 `(`，而是看名字前面是不是一个**返回类型**：`private void foo(` / `Resp detail(` 算声明；本类里的裸调用 `        foo();`（前面只有缩进）、`page = service.foo(`、`service.foo(` 都不算——之前的正则在裸调用上误判为声明，导致双击本类方法只提示「当前位置就是定义」而不跳转
- **双击**三义：① 访问器 → 跳字段（Lombok 无源码 getter）；② 接口/抽象方法声明 → 跳实现（没有就文本扫，多个弹选择）；③ 调用/具体方法 → 跳声明（文本兜底 / jar）。字段与具体方法声明原地不动，绝不因同名跳别处。**⌘+单击** → 实现 / 调用方弹层；**⌥+单击方法名** → 调用链（向上递归「谁调用了它」，思维导图浮层，点节点跳转）；`findReferences` 返回的声明位置会被丢弃（否则会把上一层自己的签名行误当成调用点），浮层把入口放在最上面、被点的方法放在最下面（上方调用下方），← 后是它调用下方方法的位置；每个节点都带类名；**实现方法会顺着 `implements` 找到接口里的同名方法，把接口调用方一并纳入调用链、用法计数和 ⌘+单击的调用方列表**（否则实现方法永远显示 0 用法）；手势在设置里用**下拉**选择（双击 / ⌘+单击 / Ctrl+单击（仅 macOS）/ ⌥+单击，三个动作互斥）
- 跳转成功后横幅显示 `→ 文件:行 · 查询 xms · 载入 yms`
- **Mapper 方法 → XML 语句**：MyBatis 接口方法在 Java 里没有方法体，声明点击原先只会说「当前位置就是定义」。现在双击（或声明跳转）`@Mapper` / `*Mapper.java` 接口里的方法时，会去工作区找对应 mapper XML——**先按 `namespace="<包名.类名>"` 精确匹配**，找不到再按同名 `XMapper.xml`——然后跳到 `id="方法名"` 那一行（`<select>`/`<update>`/`<insert>`/`<delete>`/`<sql>` 都算）。找不到语句才退回原来的提示，绝不会跳到别的方法。判定是纯函数 `ideMapperLooksLikeMapper`（要求 `interface` 且带 `@Mapper` 或以 `Mapper` 结尾），正则由 `ideMapperStatementPattern` 生成，两者在 `test/harness.mjs` 里有用例
- **调用链文本兜底**：某层 `findReferences` 失败/为空就改用「查看调用方」同款文本搜索逐层展开，浮层顶注明「语言服务不可用」；正常时不出现
- 注解类型名（`@OperateLog`）可点击；注解属性（`@Log(name=…)`）跳到注解类型里的 `name()` 声明——**先在工作区找同名注解文件**，找不到才去 jar 源码（工作区里被编辑的注解才是真身，jar 副本是被 `mvn install` 出来的）
- **类型名双击**（类/接口/枚举/record/注解）→ 工作区里 `class|interface|enum|record|@interface <名字>` 的声明文件，其次才是依赖 jar 源码；jar 没有 `-sources` 时提示「该 jar 没有源码」（不反编译）。工作区里的类绝不能再被同模块的 sources jar 副本抢走
  - **类型位置不会被当成「方法声明」**：`extends ServiceImpl<…>` 这种行在 `ideIsMethodDeclaration` 眼里长得像「返回类型 + 名字」，于是双击类名会走「跳实现」分支——而对一个类来说 `goToImplementation` 返回的是**所有子类**（踩过：弹出「声明 (50)」一屏 Repository）。所以跳转前先过 `ideTypePositionAt`（`extends`/`implements`/`class`/`interface`/`enum`/`record` 之后、泛型参数位置、`new X` 之后都算类型位置），类型位置直接跳过实现兜底，走「类型 → 工作区文件 → jar 源码」那条链
  - 语言服务层的兜底也加了开关：`ideLspDefinition(..., { implementationFallback })`，只有**方法声明**才允许 `goToDefinition` 为空时退到 `goToImplementation`
- 定义在依赖 jar 内时 → 自动去 sources jar 找源码（含「跳过 javadoc 里的 `{@link #x()}`」判定）
- 兜底链：LSP → 注解属性 → **工作区内文本声明**（声明形状 `类型 名字(` 的 grep，避免常见名撞上 200 条上限）→ import FQN → jar 源码 → 文本提示。工作区那一步按「接收者声明类型」锁定同名文件（`ideDeclaredType` 容忍 `private final` 修饰符），再按 `ideIsMethodDeclaration` 排除调用行；接收者由 `ideReceiverChain` 解析——返回**点号链的最左段**（`PurchaseOrderStatusEnum.TO_PURCHASE.matches(...)` → 取 `PurchaseOrderStatusEnum`；`field.method(...)` → 取声明类型）；**链式调用换行时（上一行是接收者、本行以 `.` 开头）会往上找 16 行**，这是 `.listByPaymentTradeNos(...)` 这类写法能找到声明的前提；没有接收者时只认本文件里的声明，绝不取工作区里第一个同名方法。它排在 jar 之前，因为工作区文件才是真正的源码
- **Maven 仓库位置**：发版给别人用的时候**不假设** `~/.m2/repository`——`/dsh-ide/jar` 每次请求按「插件设置 `mavenRepo` → `~/.m2/settings.xml` 的 `<localRepository>`（先剥掉 `<!-- -->` 注释，否则会读到模板里的 `/path/to/local/repo`，且要求路径真实存在）→ `~/.m2/repository`」解析，查找缓存按 `仓库|类路径` 记录；仓库不存在时返回 `{found:false, reason:'missing-repository'}`，界面提示「Maven 本地仓库不存在: <路径>」。设置项在插件设置里，留空=自动检测；**下面一行直接显示实际在用的路径**（来自 `/dsh-ide/doctor`），目录不存在时变黄标「目录不存在」——placeholder 太淡，不能当检测结果
- **Git 追溯注解**：代码左侧（git 变化条 / 行号）右键 →「使用 Git 追溯注解」，逐行显示 `日期 作者`，相邻提交交替底色；同一项可关闭。宿主路由 `/dsh-ide/blame` 一次解析整份文件；缓存按 `root|path|version` 且有 30 秒 TTL，注解开启时在「打开注解」与「窗口聚焦」时强制重读，**不跑定时器**（提交不改内容，不能靠 change 事件）；未提交行（零提交）显示「未提交」。注解开启时隐藏行尾 Code Vision。状态在 store 的 `annotate`（`path → true`）与 `codeMenu`
- **JetBrains 授权（-32802）**：IntelliJ 语言服务器需要**有效的服务器授权**，没授权时所有查询都会被拒（`-32802: Request refused: no active JetBrains license`）。处理办法在服务器自己的 CLI 里：`~/.dsh/lsp-bin/intellij-server-2027.1/bin/intellij-server license status|login|activate|trial|reset`（也可用 `INTELLIJ_SERVER_LICENSE`/`INTELLIJ_SERVER_LICENSE_FILE`/`JETBRAINS_LICENSE_SERVER` 注入），登录后**必须重启 DSH**（授权状态在服务器进程里缓存）。插件侧：识别到授权拒绝后**自动用系统浏览器打开授权页**——宿主跑 `license login --browser`（这个子命令自己会开浏览器并给 URL，宿主不再重复开）；已登录但无授权时命令只打印提示、不给 URL，此时宿主直接 `open https://account.jetbrains.com/licenses`（macOS `open` / Windows `cmd /c start ""`），不依赖 webview 的 `window.open`（Electron 里常被拒）。同时在本次页面生命周期内不再请求 LSP（调用链/定义/调用方都直接走文本兜底），横幅只给一条授权提示，不给用户刷「未找到定义」
- **LSP 报错要说清楚**：`LSP_SERVER_ERROR` 这类错误其实是服务器返回的 JSON-RPC 错误，横幅/提示会带上服务器自己的话和操作名（`LSP_SERVER_ERROR — … (-32601) (findReferences)`）；错误的文本里出现 `-32601`/method not found/not supported 时，该操作会被记为「服务器不支持」并在本次会话内跳过，改用文本匹配并提示「当前语言服务不支持这项查询」，不再反复弹错误横幅
- **调用方列表里不能出现声明行**：`findReferences` 会把声明一起返回（接口自己的签名行、另一个类的 override 签名行），契约合并（点实现方法时顺带问接口）会把它们混进 references；生成调用方前用 `ideReferenceIsDeclaration` 按行判断并剔除（形状同 `类型 名字(`），否则弹出层会出现「接口 selectPage 是实现的调用方」这种明显错误的行
- **用量兜底（LSP 无结果时）**：调用方只认同名**调用**（排除声明行）、非静态方法只认 `接收者.名字(` 且接收者的**声明类型**必须是本类/本接口（大写类名当接收者的静态/工具类调用 `ReconBillConverter.toDifferenceResp(…)` 也算本类）（`ideContractNames` 把实现类与其接口都算作 owner，所以实现方法也能找到持有接口的调用方），Java 文件限定；实现方按 `implements 接口` 找类，再在类里找该方法的声明。分节标题都带「（文本匹配）」，不冒充语义结果；三条查询全部失败时提示 `lspFailed`，不再谎报「没有已知调用点」
- **未装 LSP 的引导页**：进入代码工作区时打 `/dsh-ide/doctor`，`ctx.lsp` 没挂载就弹「代码导航未就绪」。页面**直接给可复制的命令**（不再是「去做某件事」的描述）：macOS 第 1 步 `~/dev/dsh-ide-window/enable-navigation.sh`（装包 + 下载服务器 + 写 patch），第 2 步 `~/.dsh/lsp-bin/*/bin/intellij-server license login`，最后「完全退出 DSH 再打开」；Windows 显示 profile 内的 `pnpm add` 两条。按钮是「复制命令 / 重新检测 / 关闭」，命令按 `ideRuntimeContext.platform` 切换，复制走 `ideCopyWithNotice`。授权在服务器进程内，插件只引导不登录
- **Code Vision**：可见**方法**声明行尾显示「N 个用法 · M 个实现」+ 最后提交人（`simon · 2026/11/3`）；只认类体层级（缩进 ≤4）的声明；计数用 2 次 LSP 查询、作者用 1 次 `git blame`，都按文件版本缓存，滚动不重查；LSP 不可用时只显示作者，失败的查询不写缓存（不会显示假的 0）

- **符号右键菜单**：复制名称 / 复制引用 / 复制引用回对话。引用 = `@相对路径` + `#L{n} 名字`（来自 span 的 `data-iw-line`/`data-iw-sym`）；只给路径是信息缺失。chip 要保持是 chip，行号另打字补上；jar 标签页只有「复制名称」
- **两条快捷键**：`⌘⇧C` 复制引用回对话、`⌘⌥T` 在数据窗口打开表，都作用在当前标签页
  - 复制引用的尾部 `#L<行> <符号>` 来自 `state.lastSymbol`——每一次符号手势（双击/⌘+单击/⌥+单击）和符号右键都会写它，所以快捷键与右键菜单产出**同一条引用**；符号属于别的文件时只给文件路径，不瞎带行号（`ideReferenceSuffix` 是纯函数，有用例）
  - 打开表走 `ideDataWindowOpenEntity`，与文件树菜单同一个实现：`@TableName` 解析、数据窗口未安装/无表名等提示都一致；jar 源码标签页给「依赖源码不是工作区文件」的提示
- **复制引用回对话**：回对话并把 `@引用` **追加**到草稿末尾（已有文本/附件不动，插的是真芯片）：输入框是 Lexical，`@` 从菜单选候选才变芯片，所以按人打字顺序逐段输入（Tab 进目录、末段回车），每步核对候选；对不上就退化成纯文本 `@相对路径`，绝不选错文件

### 4.2.1 截图编辑器

- 快捷键 `⌘⇧S`（Windows `Ctrl+Shift+S`），设置里可改；Search Everywhere 的「操作」里也有
- **桌面端与浏览器端同一套流程**：抓屏由**宿主**完成（宿主就跑在拥有屏幕的那台机器上），页面里的 `getDisplayMedia` 被 DSH 关掉不影响它。所以浏览器 tab 里按快捷键同样能截，不区分运行时
- **一次抓整屏，再在图上框选**：宿主抓整屏 → 拖选框 → 只导出选框内那块
- **按设备像素抓屏**（`IDE_SCREENSHOT_EDIT_EDGE = null`）：`sips` 不带 `-Z`，抓多少存多少，原 PNG 用完即删
- **导出保原始像素**：先压质量到 ≤1 MB，压不下去才按 `1 → 1/1.25 → 1/1.5 → 1/2` 缩
- **不用系统十字光标**（`-i`）：跨平台不一致，且框完没画布可标注。统一「先截、后框、再标注」
- **交互**（客户端 Canvas，两个平台同一套代码）：编辑器挂在 `shell.overlay` 上，覆盖整个窗口、不被面板 overflow 裁剪
  - **画面按屏幕坐标 1:1 贴上去**：`scale = 1/dpr`，画布 `left/top = -(screenX/screenY)`。不减去窗口偏移，画面会在窗口里居中，**窗口自己的标题栏又出现一次**（重影）；减掉后画面正好落在原屏幕位置
  - **指针换算以画布为准**：`ideShotPoint(event, canvas, scale, bounds)` 用 `canvas.getBoundingClientRect()`，不要再按 stage 居中算（画布可能超出 stage）
  - **不显示提示文案**：屏幕边缘的字只会挡内容
  - **没有预设选框**：打开时整屏压暗，用户按下左键并拖动 → 选框实时扩张 → 松开左键完成并固定
  - **Esc 随时退出整个操作**：没开始拉框、正在拉框（拖到一半）、已经拉完 —— 三种状态下按 Esc 都直接关掉编辑器，并把拖动状态清空（随后那次 `pointerup` 不会再把它救回来）。监听挂在 **window 的捕获阶段**：浮层自己永远拿不到焦点，挂在浮层上的 `onKeyDown` 基本不会触发
  - 操作条**只在松开左键之后出现**（`dragging` 为 true 时不渲染），拉框过程中界面上没有任何多余元素
  - **先抓屏、再渲染**：抓屏期间界面上不能出现任何自己的元素（连「正在截图…」的字都会被截进图里）。`startScreenshot()` 里 `screenshotBusy` 守住不重复触发，等 Host 返回后才 `setScreenshot({phase:'editing'})`；编辑器的「加载中」卡片只会在图片已经拿到之后出现
  - 选框下方 10px 弹出**浮动操作条**（底边放不下时浮到上方）：`矩形 / 文字 / 撤销 | 截图 / 截图并跳转会话`；按钮 `flex: 0 0 auto` + `white-space: nowrap`，卡片宽 392px（否则中文按钮会折成三行）
  - **外观跟随工作区**：编辑器在 `shell.overlay` 里，**不在 `.iw-root` 内**，所以必须自己 `h(IdeStyles)` 注入样式表、自己带 `data-dsh-theme`（工作区主题属性）与字体变量。漏掉前者 = 卡片掉回浏览器默认样式（白底白字按钮）；漏掉后者 = 深色工作区上出现白色卡片
  - 卡片按钮直接复用面板的 `.iw-btn`（含 `.on` / `.primary`），字号取用户在设置里配的字号（`treeFontSize`，默认 14.5px）
  - 标注只提供**矩形**与**文字**：`select` 是范围工具，`rect`/`text` 是标记；椭圆/箭头/画笔/马赛克的绘制代码仍在 `ideShotDrawOp` 里，但**不进操作条**（保持卡片小），要放开只需往 `IDE_SHOT_TOOLS` 与按钮里加一项
  - 文字用 DOM `<input>` 收输入（中文输入法可用），回车落到画布：
    - 输入框装在 `.iw-shot-frame`（与画布等宽的定位容器）里，`left/top` 直接用**点击点**的图像坐标 × 缩放——早先直接按 stage 定位，画布居中时输入框会飘出去很远
    - 样式是**透明**的：无底色、只有 1px 虚线描边（当前标注色），文字带阴影保证在任意背景上可读；字号跟着缩放走，落笔的 `stroke` 存的是同一个尺寸（图像像素），所见即所画
    - 打开时**在别处按下就取消**，但**按在输入框自己身上不算「别处」**：stage 的 `onPointerDown` 先看 `event.target.closest('.iw-shot-text')`，input 自己再 `stopPropagation()`。漏了这条，用户点一下刚出现的输入框想输入文字，输入框立刻被当成「点了别处」取消——永远打不进字（用户实测反馈）
    - Esc 先取消输入框（浮层让给 input 自己处理），再按一次才退出编辑器
  - 文字框打开期间不要用 window 捕获去抢 Esc 再自己关一次：一次按键只能做一件事，重复处理会把整个编辑器关掉
  - 标注存为**操作列表**（`{tool, color, stroke, x, y, width, height, points}`），重绘 = 底图 + 操作，撤销是 `pop()`
  - `stroke` 是笔宽，`width/height` 是图形本身——**两者绝不能共用一个字段**（踩过：共用后 lineWidth 变成矩形宽度，整屏红块）
  - 拖出来太小（< 24px）视为误点，选框清空、回到「整屏压暗」状态
- **导出**：裁出选框 → 原始像素 → JPEG 质量阶梯 `0.8/0.7/0.6/0.5/0.4`，第一个 ≤1 MB 的用（仍不合规才降分辨率）；客户端算好 data URL，两个出口：
  - **截图并跳转会话**：合成 `ClipboardEvent('paste')` + `DataTransfer` + `File` 塞进 Lexical 输入框，草稿里的文字/引用/附件不动
  - **截图**：`{copyDataUrl}` 回传宿主（宿主写临时文件再 `osascript`/`.NET` 写剪贴板）——该路由请求体上限单独放宽到 8 MB（默认 64 KB 是给命令用的）
- **macOS 屏幕录制权限**：没授权时 `screencapture` 报 `could not create image from display`，宿主归类 `403 no-screen-permission`，编辑器位置的卡片给系统化指引 + 「打开系统设置」（`x-apple.systempreferences:…Privacy_ScreenCapture`），授权后必须**完全退出应用重开**。Windows 无此权限

### 4.3 搜索
- **Search Everywhere**：双击 Shift / 工具栏放大镜 / 快捷键打开，六分类（所有 / 类 / 符号 / 文件 / 文本 / 操作），**默认「所有」**——`类` = 文件即类（`ideFqnOf` 出全限定名）；`符号` = 声明形状的 ripgrep 前缀搜索（`ideSymbolPattern`：类/接口/枚举/record、字段、方法、常量、`function/const/def`），**是文本启发式不是符号索引**，局部变量可能混入；`所有` = 类 → 符号 → 文件（非源码）→ 文本（**含源码文件**，仅去掉与符号行完全相同的行）→ 操作；**结果按匹配度排序**（符号 `ideSymbolRank`、文件 `ideFileRank`、文本 `ideMatchRank`、命令 `ideActionRank`）
- 样式用 DSH 菜单 token；`⌘P` 聚焦文件树筛选框

### 4.4.1 与数据窗口联动

`src/client/73-data-bridge.js` 是数据窗口（`dsh-data-window`）事件桥的**调用方**，契约在对方仓库的 `docs/BRIDGE.md`：

- 数据窗口激活时设置 `window.__DSH_DATA_WINDOW_BRIDGE__ = { v: 1 }`；本插件只在标记存在时显示菜单项；
- 请求 `dsh-data-window:request`（`openTable` / `openSql`），回执 `dsh-data-window:response`，按 `id` 匹配，2s 超时；
- 文件树右键 Java/Kotlin 文件 → 解析 `@TableName` 发 `openTable`；编辑器符号右键 → Mapper 方法发 `openSql`（`@Select` 等注解优先，其次按 namespace 在 XML 里找 statement，动态 SQL 会带注释提示原文粘贴）；
- MyBatis 动态 SQL 会先转成可执行 SQL：`<foreach>` 展开 3 条默认值、`#{}`/`${}` 按方法签名里的参数类型填默认值（数字 `1`、字符串 `'demo'`、日期时间），SQL 头部注释列出默认参数；XML 的 `<if>/<where>/<set>/<trim>/<choose>` 会展开成静态 SQL。仍不自动执行，用户在数据窗口里改值后自己跑。
- 本插件只解析、不执行 SQL；定位库、只读校验都在数据窗口与它的 Host 里。

### 4.4 与对话联动
- 用 DSH 自带的「已编辑 N 个文件」卡片即可：**点文件行**直接进本插件工作区（见 4.1 的拦截项）；插件不再渲染自己的改动卡片（原 `turnTail` 卡片已删除，`58-turn.js` 随之移除）

### 4.4.2 悬浮助手卡（豆包式）

`src/client/74-float.js`：浮在代码工作区上的小聊天卡，**进代码工作区自动出现、回对话自动消失**；**可拖动**（表头按下拖，位置存 `floatX/floatY`，渲染时按视口夹取，永不出屏）。

- 挂 `shell.overlay`；可见性跟 **`selectPanel()`**
- **可拖可缩**：表头拖、四边/右下角缩放（最小 280×220），手势挂 window
- `.iw-float *` 一律 `border-box`
- **字号固定 14px（DSH 正文）**，字体继承宿主；只有配色跟工作区（`data-dsh-theme`）
- **跟随面板的会话**：消息进 `state.sessionId`；模型 chip 走 `modelDirectories.directoryFor(id).store` 的 `select()`，权限 chip 发 `/permission <preset>`、显示值读投影 `projections.get('permissions').currentValue`
<!-- 改动列表：卡片已移除（插件拿不到 turn 的 deliverables，宿主摘要只在内存里且晚于回复；用户要求不要这个框） -->
- **问答也进卡片**：`ask_user_question` 是 `tool/call`，答案在配对的 `tool/result`（文本 `{"answers":[{id,selected[]}]}`）里
  - **已回答** → 右对齐蓝气泡：header 12.5px 三级色、问题 14px 二级色、选中项 14px 一级色（上边距 4px）
  - **未回答** → 整张卡（和对话里那张同一套度量）：eyebrow 11px 三级色、标题 16px、选项行 12px 圆角 + 序号徽标 20×20（radius 4，`bg-layer-3`）+ 14px 标签 + 13px 说明；卡片本身 `bg-layer-1` + `0 0 0 0.5px border-l1` 细环 + 两层软阴影（对话那张卡没有边框）；底部一行提示 + 「去对话作答」
  - **作答只能在对话里**：宿主 `ctx.remote.userQuestions.answer` 对前台问题返回 `false`（作答权由 DSH 自己的卡片持有），所以卡片的按钮走 `goToChat()` 切回对话，不假装能在这里答
- **图片点开预览**：点缩略图开卡内全屏层（`Esc` 关、`复制图片` 走 canvas→PNG）
- **能选中**：卡片与 `.iw-md` 要列进 `html.iw-select-code` 的白名单
- **中文输入法组词时按 Enter 只上屏、不发送**：keydown 里先看 `composingRef`（`compositionstart/end` 维护）、`event.isComposing`、`keyCode === 229`，再看 `compositionend` 之后 80ms 内的那次 Enter（部分输入法先发 end 再发 keydown）；三条任一命中就交给输入法。**只判断 `isComposing` 不够**——踩过，用户组词按 Enter 直接把半句话发了出去
- **进度按对话的样子进卡片**：`tool/call` 在 transcript 里**成批**变成一行步骤（`ideFloatStepKind` 把工具映射成 commands/read/write/search/web/questions/plan/tools，`ideFloatStepTitle` 复刻对话的措辞：一条=`执行了命令`、两条=`执行了命令并搜索代码`、三条以上=逗号连接+`等`，共用前缀「已」要去重）。**只有真正渲染的行（有文字/图片的消息、问题卡、交付卡）才切断批次**，别用空 assistant 消息切——那会把一次批量拆成一行一条；同一 `callId` 出现两次要按 id 去重。最后一批 `open`，`running` 时显示 `正在运行命令 · <细节>`（bash 取 `arguments.description`，没有才用 `command`）。底部计时行固定 `深度求索中，用时 X ···`，**起点取最近一条用户消息的 `time`**（不要用「发现 running 的时刻」，会重置成十几秒）。图标：步骤用 `IdeTerminalIcon`（`>_`）、计时行用 `IdeSparkleIcon`，字号 14px 与正文一致（早先 13px + 蓝点，和对话差得远）。被测：`ideFloatStepKind`/`ideFloatStepTitle`/批次切分都有用例
- **事件流里的东西不再"静默丢弃"**（`74-float.js` 的 `ideFloatTranscript` / `ideFloatNotice`）：卡片对 `binding.eventSource` 的每条事件都有交代——
  - `assistant/message` 的 `reasoning` 块 → **思考**行（折叠，预览首行）；`user/message` 且 `source.kind !== 'user'` → **上下文注入**行（`agent-instructions` / `time-context` / `runtime-context` / `skill-catalog` / `compact-checkpoint` / `tool-jobs` / `user-approval`，用 `IDE_FLOAT_CONTEXT_LABELS` 出中文名）
  - `tool/call` 的 `arguments`（原始 JSON，能解析就缩进）与 `tool/result` 的文本 / `isError` / `reason` 挂在批次行上，展开能看到 `▸ 工具名` + 参数 + `↳ 输出`
  - 其余事件一律成 **notice 行**：审批（`approval/asked|decided|policy`）、后台作业（`job/registered|settled`）、压缩（`compaction/start|summary|end|prune`）、重试（`llm/retry`）、失败尝试（`assistant/attempt`）、待办（`todo/write`）、模型/权限/沙箱切换、`workspace/changes`、`system/message`、`request/context`、`session/title*`、`developer/message`（工具增删），**未知类型兜底成 `floatEvent` + 原始 JSON**（真实会话里发现过 `request/context`/`session/title*` 这些插件事件）
  - **只吞纯簿记**（`IDE_FLOAT_SILENT_EVENTS`）：`turn/start`、`step/start`、`step/end`、`request/header`、`session/end-seed`、`llm/retry-started`、`agent/inbox/spliced`、`session-log-deepseek/delivery-accepted`——一次长会话里这些有 1.4 万条，且没有任何可读内容；`turn/end` 只在**非 completed** 时成行（回合成败要看得见）
  - **默认是「状态板」，不是阅读器**：`ideFloatVisibleRows(rows, running, detail)` 在 `detail !== true` 时只留 **最后一条你说的消息 + 最新一条输出 + 待回答的问题卡 + 最新文件卡**；`思考`、`上下文注入`、`工具批次`、notice 全部不进正文（细节去对话看）。踩过：一口气把事件都摊出来，用户看到的是一屏行，反而看不清"现在在做什么"
  - **省略号只属于状态行，回答必须完整**（踩过：一度把助手输出压成一行，用户直接指出来「输出到对话的内容不要省略，省略的是『正在调用工具』这个框」）。所以：
    - 助手回答照对话的排版**整段渲染**（`IdeFloatMarkdown`，段落/代码块/表格都在），绝不 clamp
    - 用户消息用 `iw-float-pre`（`white-space: pre-wrap` + `-webkit-line-clamp: 4`）：**保留你打的换行**（markdown 会把单个换行折成空格），超 4 行才截
    - 只有左下角那行状态（`iw-float-live` 的 `.iw-float-step-text`）是 `nowrap` + 省略号，一行到底
    - 紧凑模式只决定**显示哪几行**，不负责截断文字
  - **完整记录在设置里**：`floatEvents` 这一项现在叫 **「显示详细过程」**（默认关），打开即回到全量行模式（`detail === true`）：思考、上下文注入、工具参数与输出、系统事件（审批/作业/压缩/重试/标题/权限/沙箱/请求上下文/系统提示词/未知类型）全列出来
  - 所有行默认折叠（`IdeFloatFold`，自身 `useState`，靠 row.key 保状态），展开显示详情；详情按 `IDE_FLOAT_DETAIL_MAX`（6000 字）截断；行数上限 `IDE_FLOAT_MESSAGES` 从 6 提到 **200**（原来 6 行会把历史截没）
  - 运行中：当前批次是左下角钉住的实时状态（见上一条），因此**不在正文重复**（`ideFloatVisibleRows(rows, running)`），跑完的批次回到正文
  - **流式增量（transient）永远不成行**：`entries` 里 `type: 'transient'` 的 `assistant/live-chunk` 是"正在写的这条消息"的分片，一条 chunk 一行会刷成几十行 `事件 {attemptId…}`（踩过，用户截图直接糊了一屏）。transcript 第一件事就是跳过它们，落定的 `assistant/message` 才是正文
  - **左下角那行只显示"最新一条活动"**（`ideFloatLiveActivity(rows, rawEntries.current)`，注意要喂**原始 entries**——`entries` 状态已经是折好的行，拿它判断永远是空）：
    - **流式正文直接进正文，不出「正在输出」状态行**（用户对照 DSH 指出的：对话是边生成边打印，没有这个步骤）。`ideFloatStreamRow(liveStream)` 把 `text-delta` 累积成一条 `role: 'assistant'` 的 `.iw-float-streaming` 行接在正文末尾，按 Markdown 渲染；落定的 `assistant/message` 一到，transient 消失、这条行也随之消失，不会重复
    - 流式**思考**仍然出一行 `思考中 · <尾部>`（紧凑模式不展示思考内容，没有这行就什么也看不见）
    - 否则看**最新一批工具是否还在等结果**（批次行的 `pending`：`tool/call` 有、对应 `tool/result` 还没有）→ `正在运行命令 · <细节>`
    - 都没有 → **不显示**（旧批次不能挂到下一轮，踩过：新回合一直显示上一轮的「正在运行命令」）
    - **不能按「最新一条事件是 tool/call」来判断**：真实顺序是 `tool/call` → `job/registered` → `job/settled` → `tool/result`，执行期间最新事件往往不是 tool/call，按事件类型判断会导致整段执行期没有状态行（踩过，实测 `last: job/registered` 时长时间空白）
    - 尾部取最后 220 字再折成一行预览（`ideFloatPreview`），始终只有这一行，不随历史增长
    - **空档期显示「正在分析请求」**（`ideFloatLiveActivity(...) ?? { kind: 'analyze' }`）：DSH 对话里 `message.stepProcess.thinking` 就是这句，模型还没吐第一个字时卡片原来只剩计时行、看着像卡住。现在只要 `running` 且既没流式分片、也没有在飞的工具，就显示「正在分析请求」，阶段之间不再有空白
    - **`analyze` / `tool` 这两种状态没有 `text`**：尾部预览统一走 `ideFloatLiveTail(live)`，它先按 kind 返回空串再读 `live.text`（踩过：直接在组件里 `live.text.slice(-220)`，analyze 一出现就抛 `Cannot read properties of undefined (reading 'slice')`，整个 `shell.overlay` 槽位崩掉、连悬浮球都没了）
    - **没有可读参数时要带上工具名**（`ideFloatLiveText` 的 `suffix = detail || 工具名`）：`browser_evaluate` / `todo_write` 这类参数里没有 `description`/`command` 的工具，以前只显示「正在使用工具」，用户看不出在干嘛；现在显示「正在使用工具 · browser_evaluate」，和对话里那行一致。有可读参数时仍以参数为准（`正在运行命令 · sleep 20`）
- **排队消息也进卡片**（`ideFloatQueueRows` + 卡片底部 `renderQueue()`）：数据源与对话里那块「N 条排队消息」**完全一致**——`binding.session.projections` 的 `inbox` 投影 `next-turn`（`source.kind === 'user'` 才要），再补 `session.getSnapshot().pendingSubmissions` 里 `placement === 'queued'` 的回显（Host 还没收编时不能闪没，按 `rpcId` 去重）。
  - **附件（图片/文件）也要进队列行**（踩过：只取了 `type === 'text'` 的块，排队里的图片直接消失，连纯图片消息整行都没了）：`ideFloatQueueAttachments` 从 inbox 的 `content` 块取 `{type:'image'|'file', attachment}`，`ideFloatPendingAttachments` 从回显的 `attachments` 取（图片还带 `value.previewUrl`，可直接显示，不用再读）。**文本为空但有附件也要成行**
  - 缩略图 26×26 圆角、点击进卡内大图；Host 收编后的图片没有 URL，走和消息图片同一个 `readAttachment` 路径（`queueImageKey` 作依赖的 effect 填 `pictures` 缓存），文件名用 12px chip + 省略号抬头是 `N 条排队消息` + 收起箭头，**一条时不出抬头**（直接显示带队列图标的那一行），与 DSH 的 dock 同规则；每条可编辑（Enter 保存 / Esc 取消）、删除、插话发送（`session.updateQueue(id, {kind})`，`kind` 为 `edit`/`remove`/`steer`，运行中才可 `steer`）。投影用 `faceOf('inbox').subscribe`，拿不到就退到 `subscribeAny`
- **`/` 与 `@` 和对话一样分节、同一个数据源**：onChange 里用 `ideFloatTrigger` 取光标所在的 token（行首或空白后、到光标、无空格）。
  - `/` 三节：**添加**（文件→转 `@`、目标、计划、反馈）、**指令**（压缩、权限、模型→打开模型菜单、下载日志，外加 Host 里其他指令）、**技能**（`ctx.remote.skills.list({ sessionId })`——**这里要传对象**，传字符串拿不到）。前四项是编辑器动作，其余走 `binding.session.command('/name')`；名称/说明用本插件 locale（`floatCmdGoal`/`floatCmdGoalDesc`…），因为 Host 那份目录只有英文 name/description
  - `@` 两节：**文件与文件夹**（`workspaceFiles.list(sessionId, dir)`，`'.'` 是根、其余相对路径、条目只有 `{name,type}`）+ **对话**（按标题过滤其他会话，选中即切换悬浮卡的会话）
  - ↑/↓ 选、Enter/Tab 选中、Esc 关，目录**下钻**成 `@dir/`、文件变引用 chip、技能插入 `/<名字> `。菜单绝对定位在输入框上方（`.iw-float-input` 必须是 `position: relative`）
- **浮层挂在触发器上**：会话列表从标题 ▾ 向下、权限与模型从各自 chip 向上。菜单曾是卡片的 flex 子节点，于是点模型菜单会跑到卡片顶部——现在 `useLayoutEffect` 按触发器与卡片的 rect 算出 `left/top` 或 `right/bottom`，再用内联样式粘上去（卡片可缩放，写死偏移会漂）。`useLayoutEffect` 要记得在 `build.mjs` 的解构里导出
- **输入区 = DSH 的 composer**：一个 16px 圆角容器（内边距 `10px 10px 8px 14px`），里面是无边框 textarea（占位文案同 DSH）与底行 `＋（圆形）/ 权限 pill（锁+文字+⌄）/ 空隙 / 思考等级 / 模型 chip / 圆形发送键（↑，运行中变 ■）`；引用是蓝色 chip，粘贴图片走剪贴板 `image/*`（≤4 张、单张 8 MB），发送 `prompt([image…, {text: refs + 正文}])`
- **表头只留**：`▾` 标题（46% 截断）、`＋` 新建、`–`/`×`（模型与思考等级在输入区，别重复）
- **每次打开 DSH 都从「收起来」开始**：卡片存在，但只占一个 44px 圆球（`floatCollapsed` 初值 `true`，不持久化）；球**由 CSS 钉在窗口右下角**（`right/bottom: 20px`，`left/top: auto`），窗口放大缩小都在原位——早先用卡片坐标算，最大化后还停在旧尺寸的位置，看着像跑到屏幕中间
- **窗口尺寸变化要重渲染**：`resize` 监听里 `setViewportTick` 一次，否则卡片坐标还是旧视口的夹取结果
- **`⌥`+空格**（`dsh-ide-window.float-toggle`，可改键）：不可见→展开、球→展开、展开→收球；设置里关掉悬浮框时给一条提示而不是假装切了
- **收起/关闭/开关**：`–` 收球、`×` 关闭（`floatClosed`，只本次进程内有效，重启才恢复）、设置页开关 `floatEnabled`（默认开，持久化）；渲染处统一 `open = floatOpen && enabled && !closed`
- **可脱离工作区（`floatDetached`，默认关）**：`selectPanel()` 不再按面板开合（`panelId === IDE_PANEL_ID || detached`），`enter()` 清理也跳过。脱离时卡片按 **DSH 自己的外观**（不挂 `data-dsh-theme`、字号继承），贴回工作区才用工作区主题与字号
- **归档不列**：按 `WorkspaceSnapshot.archivedSessionIds` 过滤
- **引用优先给悬浮卡**：`referenceToChat` 命中上面 `open` 就把 `@引用` 走 `store.setFloatInsert` 追加进卡片草稿并聚焦（不跳转），否则回对话插芯片
- **切换/新建会话**：按 `cwd` 分组、当前组置顶并滚过去；切换 = `openSession` + `enterProject` + 140ms 重选面板；新建 = `startSession()`（只能按 sessionId 变化判定）
- **终止**：`session.getSnapshot().running` 为真时，发送键变「停止」→ `session.cancel()`
- **默认大小 744×560**（宽度 = DSH 对话列宽）；设置页 ±20 步进调宽/高（280–1200 px），写 `dsh-ide-window:v1` 的 `floatWidth/floatHeight`；拖动只改当前值
- **对话按 DSH 的样子排版**：**没有「你 / 助手」标签**；用户消息右对齐、`max-width: min(477px, 82%)`、气泡 `--dsw-specific-bubble` + 20px 圆角 + `10px 16px` + 14px/22px，下方右对齐 `HH:MM`（13px，取事件 `time`）+ 复制按钮；助手整宽左对齐、无气泡、14px/24px（段落/标题/列表节奏同对话：段落 16px 首尾归零）
- **正文按对话排版渲染**（`IdeFloatMarkdown`），代码块、表格、行内代码都照抄对话的度量：代码块 16px 圆角/42px 表头/11px·19px SF Mono/自动换行；表格只留行分隔线，13px/22px，单元格 `10px 16px 10px 0`；**行内代码**取对话那条规则（`display:inline-flex` + `0 5px` + `--dsw-radius-sm` + `0.875em` + `0.5px solid --dsw-alias-border-l1` + `--dsw-alias-markdown-inline-code` 底色），表格内同样 `0.875em`
- `IdeStyles` 渲染成卡片的**兄弟节点**（否则样式文本会进正文）

### 4.5 设置（设置 → 左侧导航「代码工作区」）

- **它是设置左侧导航里的独立一页**（`settings.section`，id `dsh-ide-window`，order 70，排在「归档管理」这一层），不再塞进「通用设置」里当一行——那样既挤又得先点「查看」才能看到内容。导航标签来自 `locale` 的 `settingsNav`（代码工作区 / Code workspace），由 `label: () => translate('settingsNav')` 提供
- **快捷键**（8 条，全部可改，点「修改」直接按新键；「恢复默认」逐条重置）；手势三条是下拉（双击 / ⌘+单击 / Ctrl+单击（仅 macOS）/ ⌥+单击，互斥）
- **基础设置 → 字号**：代码字号（默认 12.5）、文件树字号（默认 14.5），10–24px 步进 0.5，行高按比例联动
- **悬浮框**：启用开关、脱离代码工作区开关、默认大小（744×560）±20 步进
- **Maven 本地仓库**：留空=自动检测，下面一行直接显示当前在用的路径
- 整页样式走 `.iw-settings-section`（max-width 720px、上下留白），`IdeStyles` 由组件自己渲染（设置弹窗不在 `.iw-root` 里）

### 4.6 快捷键（唯一登记处 `IDE_SHORTCUTS`）

| id | 类型 | 默认 |
|---|---|---|
| `dsh-ide-window.toggle` | key | 桌面 `⌘2` / Web `⌥⌘I` |
| `dsh-ide-window.back-to-chat` | key | 桌面 `⌘1` / Web `⌥⌘U` |
| `dsh-ide-window.float-toggle` | key | `⌥`+空格（Windows `Alt+空格`）——显示/收起悬浮框 |
| `code-workspace.search-everywhere` | sequence | 双击 `Shift`（窗口 400ms） |
| `code-workspace.file-search` | key | `⌘P` |
| `code-workspace.screenshot` | key | `⌘⇧S`（Windows `Ctrl+Shift+S`） |
| `code-workspace.copy-reference-to-chat` | key | 桌面 `⌘⇧C`；Web `⌘⌥C`（`Ctrl+Shift+C` 是浏览器审查元素） |
| `code-workspace.open-table` | key | `⌘⌥T`（Windows `Ctrl+Alt+T`） |
| `code-workspace.gesture-definition` | gesture | 双击 / ⌘+单击 / Ctrl+单击（仅 macOS）/ ⌥+单击 |
| `code-workspace.gesture-usages` | gesture | 同上（互斥） |
| `code-workspace.gesture-chain` | gesture | ⌥+单击（三个动作互斥） |

**加一条新快捷键**：只在 `05-shortcut-registry.js` 加一条，设置页自动出现；`key`/`sequence` 由 `90-apply.js` 的派发器处理。

---

## 五、关键设计决策（为什么这么做）

1. **面板占中栏 `main`，不占右侧栏**。
   右侧栏方案试过两次都失败：面板被卸载、蒙版盖住输入框。**不要再试**。
2. **不注册进 DSH 快捷键目录**。
   那条目录就是官方「编辑快捷键」弹窗的内容，注册进去必然和 DSH 命令混在一起；用户要求「独立分类 + 可改键」，所以绑定由插件自己存（`prefs.shortcutBindings`），派发用 capture 阶段监听器。
   `ctx.shortcuts` 只用来读平台/运行时、以及 `describeBinding` 判冲突。
3. **`⌘W` 不绑**。它是 DSH 的「关闭窗口」，菜单里不写快捷键提示，避免误导。
4. **jar 源码只读**：不反编译、不复制、不落盘；进程内只缓存 `类名 → jar 路径`。
6. **状态放 store、结果缓存到模块级**。切到代码工作区会卸载对话组件，`useState` 会丢；`ideTurnStates` / `ideSummaryRequests` 是为此存在的。
7. **设置项内联展开，不弹窗**。`shell.overlay` 的层级低于设置弹窗，弹窗会被盖住。
8. **引用靠输入框自己的 `@` 流程落地，不伪造草稿**。DSH 没有给插件的「写入对话草稿」API：`conversation.input` 的 shell 是插件内部实例，客户端 Service 目录里也没有 composer 服务；直接写 `localStorage` 的草稿只有新建会话时才会被读取。所以「复制引用回对话」是先把面板切回对话，再在输入框里按人打字的顺序输入 mention 让 DSH 自己生成芯片——这是唯一能拿到真芯片、又不动已有草稿的路子。

---

## 六、怎么开发与验证

```bash
cd ~/dev/dsh-ide-window

# 改完源码后必须构建（client.js 要一起提交，别人安装时不会跑构建）
node build.mjs && node --check client.js

# 全量测试（平台 / 诊断日志 / 状态 / VM 夹具 / 归属推断 / 真实 ~/.m2 jar）
npm test

# 本体完整性（签名 + app.asar 哈希基线 + 可疑新文件）
./check-dsh-untouched.sh

# 平台兼容（每个功能都要过，清单见 3.2）
node test/platform.mjs
```

Windows 开发者把上面三条换成 `.ps1` 版本：`.\check-dsh-untouched.ps1`、`.\start-test-instance.ps1`。

### 浏览器自测（用户明确要求「每次改一个功能就自己去测」）

```bash
# 起一个独立实例（用 web profile，不污染桌面端）
cd <某个仓库> && dsh --profile web --port 0 --no-open
# 日志里会打印 http://127.0.0.1:PORT/?token=...
```

- 用浏览器自动化（bsk 工具）打开该 URL 操作；`evaluate` 可以派发 `contextmenu` 等合成事件
- 用 `./start-test-instance.sh` 起独立实例：固定端口 57999、家目录 `/tmp/dsh-ide-test`、自动把本机 **`~/.dsh/.credentials.yaml`**（真实账号/API Key，`llm-deepseek` 只是附件缓存不是凭据）复制进去，所以打开就是已登录（左下角有头像），不会再弹「开始使用」；「预览版说明」只在全新家目录出现一次，点「继续」后写进该家目录的存储，重启不再弹。带 token 的 URL 追加在 `/tmp/dsh-ide-test/url.log`，随时 `grep` 取最新一条
- 宿主在启动时缓存客户端 bundle：**重建 client.js 后必须重启这个独立实例**，只刷新页面拿到的还是旧代码
- **改完客户端代码后**：桌面窗口必须 `⌘R` 刷新；只改宿主路由要**完全退出 DSH 再打开**
- 判断是否生效：设置里能不能看到新条目 / 控制台有没有 `client.js 404`

### 装/重装

```bash
dsh plugin --profile desktop add link:~/dev/dsh-ide-window
```

---

## 七、坑与教训（都踩过）

| 症状 | 根因 | 正确做法 |
|---|---|---|
| `cannot get property "shortcuts" without inject` | 插件导出没声明该服务 | `build.mjs` 里 `inject: ['slots','locale','shortcuts']` |
| 快捷键注册整条失败 | 声明了 `web:linux` 默认值（该 profile 只允许 Slash/Comma/Period） | **不要**声明 `web:linux` |
| `plugins/...client.js?jsrev=… 404` | 重建了 bundle，已开窗口拿的是旧 rev | 让用户 `⌘R` 或重启；批量 URL 里一个过期整批 404 |
| Windows 上点授权「没反应」 | `spawn` 直接跑 `.bat`/`.cmd`，Node 拒执行抛 EINVAL，被 `child.on('error')` 吞成 `spawn-failed` | `platform.needsShell(path)` + 两个 `spawn` 都传 `shell`（`index.js` 的 `runLicenseCommand`/`openLicenseLogin`） |
| 客户端与宿主路径规则悄悄分叉 | 两份实现各自演化、没有测试 | harness 的采样对比（6 个样例）锁住 `toPosix`/`isAbsolutePath` |
| 插引用后出现「点了没反应」或拼出一半路径 | `@` 触发只在词首生效；菜单用 Escape 关闭后焦点已不在输入框 | 先用空格把 mention 与前面的文字分开；每次改插入位置前重新 `caretToEnd(editor)` 聚焦，并在关菜单后等一帧再补尾部字符 |
| 右键菜单被截断/被覆盖 | `.iw-root` 是 `overflow: hidden`，外壳还有 transform，`position: fixed` 菜单被限制在面板内 | 菜单定位统一走 `useMenuPlacement()`（四个菜单共用，别各写一套 `Math.min`） |
| 设了「Ctrl+单击」跳转，macOS 上点符号却弹右键菜单 | macOS 把 Ctrl+单击当**二级点击**（`contextmenu`，`button` 为 0），而符号菜单分支排在 Ctrl 手势判断之前；另外 Ctrl 默认没绑任何手势，未绑定时本来就该落到菜单 | Ctrl 手势判断要放在符号菜单**之前**，并用 `button === 0` 区分真正的右键（`button === 2` 仍出菜单）；默认手势是 双击/⌘/⌥，想用 Ctrl 必须去设置里指定 |
| 双击 `extends ServiceImpl` 里的类名，弹出「声明 (50)」一屏 Repository | `类型 名字` 的判定把 `extends ServiceImpl<…>` 当成了方法声明，于是走「跳实现」；类名的实现就是它的**所有子类** | 跳转前用 `ideTypePositionAt` 判类型位置（extends/implements/class/泛型/new），类型位置不走实现兜底；LSP 兜底本身也加了 `implementationFallback` 开关，只有方法声明才允许退到 `goToImplementation` |
| 点 Mapper 接口方法只提示「当前位置就是定义」 | MyBatis 的方法体不在 Java 里，LSP 只能回答「这就是声明」 | 声明点击时先按 `namespace` + `id` 去 mapper XML 找语句并跳过去；XML 里没有该 id 才保留原提示 |
| 调用链说「没有找到调用方（可能已是入口方法）」，但控制器里明明有调用 | LSP 只回了**声明**（接口签名 + 被走的实现签名，`ideContractReferences` 还会补一条接口签名），非空于是走完流程、全部被 `callerAt === 'declaration'` 丢掉，而文本兜底只在**语义结果为空**时才跑 | 语义结果非空但**一个子节点都没加上**时，必须再跑一次文本匹配兜底；`textual` 标记只在真正用到文本行时置位。首轮索引进（`ImportExecutionKt` / 索引目录还在长大）时 LSP 也会回空，两者叠加就是这个弹窗 |
| 右键菜单离鼠标很远，飘在面板上方 | 用「条目数 × 28」估高度，估小了就 `y - 估计高度`，真实菜单更高、被夹到面板底边后整体上移 | 高度必须挂载后实测：放不下时让菜单**底边贴在指针**（`top = y - height`），不要用估算值；`useLayoutEffect` 在首帧前算好并保持 `visibility: hidden` 直到定位完成 |
| 切到浅色主题后代码看不清（深色语法色仍在用） | 语法高亮是写死的深色配色，没有跟着主题走 | 语法色走 `--iw-syn-*` 变量，每套主题各给一组并按对比度校验（正文类 ≥4.5:1，注释 ≥3.5:1）；`test/theme.mjs` 断言每套主题都有这 8 个变量 |
| 截图点了没反应，或只给一句「失败」 | `screencapture` 在 macOS 未授权时报 `could not create image from display`；浏览器侧也拿不到屏幕（DSH 把 `setDisplayMediaRequestHandler` 设成 `callback({})` 直接拒绝） | 截图只能由宿主用系统工具做；失败按文案归类成 `no-screen-permission`，弹层给「打开系统设置」深链 + 系统化指引 |
| 编辑器里拖拽完全没反应（或选框永远是全屏） | ① `setPointerCapture` 对合成 pointerId 抛错，异常发生在设置拖动状态之前；② 预设了全屏选框，按下点永远"命中选框内部"，只能移动不能重画 | ① `setPointerCapture` 包 try/catch，且放在状态设置之后；② **不预设选框**，第一下按下-拖动就是画框；① 的检查同理适用于所有合成指针测试 |
| 想只加一张图却把草稿弄乱 | 直接改输入框内容会动到用户已有的文字/引用/附件 | 合成 `ClipboardEvent('paste')` + `DataTransfer` + `File` 派发给 Lexical 输入框，让 DSH 自己处理粘贴；**不要**写 editor 的 `innerHTML`/`textContent`（`test/screenshot.mjs` 会断言这一点） |
| 想在悬浮框里直接答题 | 宿主 `remote.userQuestions.answer` 需要 `inject: ['remote.userQuestions']` 才拿得到，且对前台问题一律回 `false`（作答权在 DSH 自己的问答卡上，`publishContinuedQuestions` 只接管已延续的批次） | 悬浮框只渲染题目（读 `tool/call` 的 arguments），提交按钮引导回对话，不伪造作答 |
| 点「×」关掉悬浮框后，⌥+空格再也叫不出来（也不提示） | 关闭写 `floatClosed`，只重置于重启；而 `toggleFloat` 的判断只看 `floatOpen`，于是每次都走「设为可见」但 `floatClosed` 仍是 true | `toggleFloat` 命中 `floatClosed` 时先 `setFloatClosed(false)` 再展开——快捷键就是用来叫回卡片的 |
| 卡片缩到最小后 `/` 菜单只剩一行；菜单还半透明，代码从底下透出来 | ① 菜单绝对定位在 `.iw-float-input` 里，卡片 `overflow: hidden` 把超出部分裁掉；② 底色用 `--dsw-specific-menu`，那是 `#fcfdfeb3`（DSH 靠背后模糊，卡片没有 backdrop-filter） | 菜单改成 `position: fixed` 并按输入框的 rect 算 `left/width/bottom/max-height`（fixed 不被祖先 overflow 裁），宽度至少 340 保证名称/说明不被挤；底色用不透明的 `--dsw-alias-bg-layer-1` 加细边框 |
| 设置里关掉悬浮框再打开，卡片再也出不来（快捷键也没用） | `74-float.js` 把 `useState`/`useEffect`（resize 重渲染）写在了 `if (!open) return null` **之后**：关掉时少跑两个 hook，再打开时多跑两个 → 「Rendered more hooks than during the previous render」，`shell.overlay` 把整张卡卸掉 | **所有 hook 必须在 `if (!open) return null` 之前**；`test/harness.mjs` 里有一条源码断言盯着早退之后不许出现 hook |
| 悬浮卡整张没了（重启后明显），控制台没报错 | 行渲染里把图片节点也起名 `pictures`，遮住了上层的 `pictures`（附件 id → URL），`pictures[id]` 读到 null → 含图片的消息一渲染就抛错，`shell.overlay` 插槽把整个浮层卸掉 | 行渲染抽成 `ideFloatRow`，变量不重名（图片节点叫 `pics`）；**每行 try/catch**，一行坏数据不连坐整张卡 |
| 两个插件（代码工作区 + git 窗口）配色不一致 | 各自注入 CSS、各自用 DSH token，主题是本插件私有的 | 把主题做成跨插件约定：`localStorage['dsh-theme']` + `dsh-theme` 事件 + `[data-dsh-theme]` 选择器；对方只读这三样。只在 `.iw-root` 上作用域的选择器无法共享，必须用通用属性 |

---

## 八、已知限制 / 待办

1. **DSH 重启后历史轮次没有改动摘要**（Host 内存态，官方卡片同样消失）——这是 DSH 自身行为，插件不做补偿。
2. **「添加到智能体上下文」是降级实现**：复制 `@相对路径` 并提示粘贴；DSH 未开放插件的对话草稿插入 API。
3. **分享前待办**：包名/License/`engines.dsh` 约束都已完成（MIT、`dsh-ide-window`、锁 `0.2.2-rc.3`）。
4. **每次改 `src/` 都要重新构建并提交 `client.js`**，否则别人装上跑的是旧代码。主题的调色板不在 bundle 里（`themes/*.css`），改颜色不需要重建。
5. 插件需要 `webServer` 服务：在没有 web 服务的 profile 里会显示 `pending (waiting for service: webServer)`，属正常。
6. **截图的临时文件不主动删除**：抓屏结果与「复制到剪贴板」的导出图都落在系统临时目录（`os.tmpdir()/dsh-ide-shot-<ts>.jpg`，中间 PNG 用完即删），由操作系统按自己的节奏清理。
7. **编辑器不支持再编辑已画的标注**：标注一旦落到画布就是操作记录，只能撤销最近一次，不能选中/拖动已有的矩形或文字（要做需要命中测试 + 选中态，属下一阶段）。

---

## 九、文件地图（找东西用）

```
index.js                      宿主：14 条路由 + jar ZIP 解析 + git 状态/差异/blame/kinds + 诊断日志
client.js                     构建产物（提交）
build.mjs                     拼接 + 注入校验（禁止未声明的 ide* 辅助函数）
cordis.patch.yml              profile 插入项
locale/zh.json, en.json       UI 文案（227 键）+ 插件展示信息
src/client/05-shortcut-registry.js   ★ 快捷键唯一登记处
src/client/07-log.js         客户端环形日志 + 诊断快照
src/client/10-core.js         store / 偏好 / 标签页 / 视图持久化
src/client/12-theme.js        配色主题：注册表 + <link> 切换 + 状态栏切换器
themes/*.css                  10 套调色板（5 深 5 浅），只覆盖 alias token
src/client/30-code.js         代码视图 + 跳转 + 右键菜单挂载
src/client/59-gesture-settings.js  设置分区 + 标签页菜单组件
src/client/72-screenshot.js   截图编辑器：宿主抓屏 + 选区/标注 Canvas + 导出 + 授权引导
src/client/90-apply.js        全部注册 + 入口
platform/{contract,macos,windows,index}.js  平台层（macOS / Windows 的差异都在这里）
test/platform.mjs            平台层测试：两个实现满足同一契约
test/diagnostics.mjs         诊断日志：环形缓冲、JSONL 文件、客户端上报
test/harness.mjs             VM 夹具测试（含客户端平台层）
test/inference.mjs            归属推断（bean 字段）
test/maven.mjs                真实 ~/.m2 jar 端到端
test/theme.mjs                主题：注册表/清单/文件一致、token 集合一致、读取器 400/404
test/screenshot.mjs           截图：两平台命令行、授权错误归类、选区几何、编辑器接法
check-dsh-untouched.sh        本体完整性自检（macOS/Linux）
restore-profile.sh            恢复 profile 到可用状态（macOS/Linux）
start-test-instance.sh        起独立自测实例（固定端口 + 复用本机账号，不再弹登录框）
check-dsh-untouched.ps1       ↑ 三个脚本的 PowerShell 版本（Windows 开发用）
restore-profile.ps1
start-test-instance.ps1
README.md                     面向使用者的说明（功能/手势/安装）
CHANGELOG.md                  更新日志（每次发版追加一节，跟着 npm 包一起发）
```

---

## 十、跟用户协作时的偏好（重要）

- 每次回复**开头先说「你好，simon」**。
- 一次只做**一件明确的事**，做完给「改了什么 / 怎么验证的 / 还差什么」。
- **不要**自行提交、不要自行改无关模块。
- 用户会指出「这个 UI 很突兀」「按道理应该有…」——这类反馈意味着要**对齐既有设计语言**或**补齐预期行为**，不要辩解。
- 交付前自查：`npm test` 全绿 + `./check-dsh-untouched.sh` 通过 + UI 截图/实测，缺一项就不算完成。

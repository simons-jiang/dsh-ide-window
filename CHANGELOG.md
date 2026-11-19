# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)：修 bug 递增补丁号，新增功能递增次版本号。
每次发版都会同步到 npm（`dsh-ide-window`），国内镜像（npmmirror）会在几分钟内跟上。

升级方式：DSH →「插件」→ 打开插件的「版本」区 →「检查更新」，或直接卸载后重新安装。
（`link:` 本地安装不参与版本检查，拉取仓库即可。）

## [0.3.0] — 2026-11-19

### 新增

- **主题跨插件共享**：同一页面里的 `dsh-git-window` 会跟随代码工作区的配色，切「德古拉」或「IntelliJ 浅色」时它的工具窗口同步换色，无需单独设置。
- 共享方式是三条约定，本插件只写不读：`localStorage['dsh-theme']`（当前主题 id）、`window` 事件 `dsh-theme`（同页立即生效）、`[data-dsh-theme]` 属性（配合 `/dsh-ide/theme?id=<id>` 样式表）。其他插件给自己的根节点加这个属性即可套用同一套配色。

### 变更

- 主题样式表的选择器从 `.iw-root[data-iw-theme="<id>"]` 改为通用的 `[data-dsh-theme="<id>"]`。**自己改过主题文件选择器的用户**需要同步这一行；正常使用不受影响。

## [0.2.1] — 2026-11-19

### 文档

- 增加本更新日志，并让它随 npm 包一起发布（`CHANGELOG.md` 进了 `files` 白名单）。
- README 增加「更新」一节：怎么看到新版本、怎么升级、镜像同步需要几分钟。

## [0.2.0] — 2026-11-19

### 新增

- **配色主题**：右下角「主题」按钮可在 10 套配色间切换（深色 5：海洋蓝 Oceanic、淡紫夜色 Palenight、德古拉 Dracula、Monokai Pro、夜枭 Night Owl；浅色 5：Material、GitHub、Atom One、Solarized、IntelliJ），另有「跟随 DSH」恢复宿主配色。
- 主题是独立文件（`themes/<id>.css`），只覆盖面板作用域内的设计 token，组件样式没有主题分支；改调色板不需要重新构建，刷新页面即可。
- **语法高亮随主题**：关键字 / 字符串 / 数字 / 注释 / 注解 / 类型 / 方法 / 标点各一个颜色变量，每套主题自带一组并做对比度校验（浅色主题关键字、字符串、类型 ≥4.5:1，注释 ≥3.5:1）。
- 新增宿主路由 `GET /dsh-ide/theme?id=<主题>`，只接受 `[a-z0-9-]` 形式的名字，未知主题 404、非法名字 400。

### 修复

- **Windows 上跳转报「不在当前工作区内」**：语言服务器返回小写盘符（`c:/…`）而工作区是 `C:/…`，字符串前缀比较失败。现在盘符在进入插件时归一化，工作区归属判断在 Windows 上大小写不敏感（换盘符仍然拒绝）。
- **展开大目录时 Java 图标缺失并报 413**：`/dsh-ide/kinds` 请求体超过 16 KB 上限。请求体上限提到 64 KB，客户端按 120 条一批分批请求。

### 兼容

- 对齐 DSH **0.2.2-rc.5**：LSP 管道包升级到 `@deepseek-ai/dsh-lsp@0.2.2-rc.5` / `dsh-lsp-stdio@0.2.2-rc.5`，安装与导航脚本、README 同步更新。
- `engines.dsh` 从精确版本放宽为 **`^0.2.2-rc.3`**：0.2.x 的小版本升级不再被拦截，0.3.0 及以上仍会拦下（大版本需要重新验证）。

## [0.1.1] — 2026-11-18

### 修复

- **Windows 导航脚本吞掉 pnpm 报错**：失败时只有一句「pnpm add 失败」，看不到真正原因。现在完整输出 pnpm 的报错与退出码，并提示常见错误码的含义（`ERR_PNPM_UNEXPECTED_STORE` 是 store 版本不一致，`EAI_AGAIN`/`ETIMEDOUT` 是网络或代理）。
- 首次安装失败时自动改用 npmmirror 镜像重试一次；两个源都失败才报错。
- `install.ps1` 的 pnpm 失败同样输出原始报错。

## [0.1.0] — 2026-11-18

### 首次发布到 npm

此前插件只能以本地目录（`link:`）安装，本次发布为 `dsh-ide-window`，可在插件管理器里按包名安装。

### 新增

- **macOS / Windows 一键安装脚本**：`install.sh` / `install.ps1` 负责克隆仓库、装进 profile、登记 bundle、校验结果；支持 `--profile`、`--dir`、`--with-lsp`、`--no-pull`。
- **代码导航开关脚本**：`enable-navigation.sh` / `enable-navigation.ps1` 安装 LSP 管道包、下载并解压 IntelliJ 语言服务器、写入 `cordis.patch.yml`，并给出授权命令。
- Windows 脚本出错时停在终端打印原因，不再闪退。

### 修复

- **Windows 脚本找不到内置 CLI**：原实现借用 Electron 的 Node 模式探测 `/…/app.asar/…/bin.js`，而 Windows 上 `DeepSeek Harness.exe` 是 GUI 程序，PowerShell 不会等待、也拿不到输出，于是误报「安装不完整」。现在完全不依赖 Electron：`dsh` 在 PATH 就用它，否则直接用 pnpm（PATH 没有 pnpm 时再用 DSH 自带的那份），profile 的 JSON 用 PowerShell 原生读写（UTF-8 无 BOM）。
- **pnpm 版本不一致**：优先使用 DSH 自带、与 profile 同源的 pnpm，避免 `ERR_PNPM_UNEXPECTED_STORE`。

### 本次发布的插件功能（发版时已具备）

文件树（按需展开 / 筛选 / VCS 着色 / 定位到当前文件）、多标签代码视图、Search Everywhere（类 / 符号 / 文件 / 文本 / 操作）、语义导航（双击跳转、⌘+单击实现与调用方、⌥+单击调用链、Code Vision 用法计数）、依赖 jar 源码只读查看、Git 追溯注解 / 差异 / 历史 / 分支对比、符号与文件的右键菜单、把引用以 `@路径` 形式插回对话草稿、可配置的快捷键与手势、字号设置。

---

更早的历史见仓库提交记录（`git log`）。

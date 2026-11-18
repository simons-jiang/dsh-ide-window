# dsh-ide-window

DeepSeek Harness（DSH）的 **IDEA 风格代码工作区**插件：把中央区域切成「文件树 + 编辑标签页 + 实时源码」，进入时自动收起左侧导航栏，对话随时可切回。

- 目标 DSH：**0.2.2-rc.3**（桌面版或 Web 版都可以，`engines.dsh` 会拦住不兼容版本）
- 仓库：<https://github.com/simons-jiang/dsh-ide-window>
- 包名：`@local/dsh-ide-window`

---

## 一、安装（一条命令）

前提：**已安装并能正常登录 DSH**、机器上有 `git`。插件是本地 link 包，`client.js` 已随仓库提交，**安装方不需要 Node、pnpm 或构建**。

脚本会把「克隆仓库 → 装进 profile → 登记 bundle → 校验」一次做完，可重复执行（已存在就更新）。

**macOS**

```sh
git clone https://github.com/simons-jiang/dsh-ide-window.git ~/dev/dsh-ide-window \
  && ~/dev/dsh-ide-window/install.sh
```

**Windows（PowerShell）**

```powershell
git clone https://github.com/simons-jiang/dsh-ide-window.git "$env:USERPROFILE\dev\dsh-ide-window"
& "$env:USERPROFILE\dev\dsh-ide-window\install.ps1"
```

装完**完全退出 DSH 再打开**（macOS 用 `⌘Q`，Windows 从托盘退出）——左侧导航或左下角出现「代码工作区」即成功。

脚本参数（两种系统同名）：

| 参数 | 作用 |
|---|---|
| `--profile <名字>` / `-Profile <名字>` | 装进哪个 profile，默认 `desktop` |
| `--dir <路径>` / `-Dir <路径>` | 仓库放哪，默认 `~/dev/dsh-ide-window` |
| `--with-lsp` / `-WithLsp` | 顺带装 LSP 管道包（语言服务器仍要另外准备，见第五节） |
| `--no-pull` / `-NoPull` | 不更新已有仓库，直接用当前代码 |
| `-h` / `--help` | macOS 脚本的用法说明 |

### 手动安装（脚本做的就是这三步）

```sh
git clone https://github.com/simons-jiang/dsh-ide-window.git ~/dev/dsh-ide-window
dsh plugin --profile desktop add "link:$HOME/dev/dsh-ide-window"
# 若 profile 的 package.json 里 dsh.profile.bundles 没有 @local/dsh-ide-window，手动加一行
```

Windows 把路径换成 `"$env:USERPROFILE\dev\dsh-ide-window"`。`dsh` 不在 `PATH` 时，脚本会自动改用应用自带的 CLI，无需额外配置。

### 不想 clone：直接按 commit 装

```sh
dsh plugin --profile desktop add "git+https://github.com/simons-jiang/dsh-ide-window.git#<40 位 commit>"
```

版本固定、不会被上游改动影响；缺点是更新要重新装一次新 commit。

### 验证 / 更新 / 卸载

| 做什么 | 怎么做 |
|---|---|
| 验证 | DSH 左侧导航点「代码工作区」，或会话表头左侧的按钮；左下角也有入口 |
| 更新（link 安装） | `cd ~/dev/dsh-ide-window && git pull`，然后重启 DSH |
| 卸载 | `dsh plugin --profile desktop remove @local/dsh-ide-window`，然后重启 DSH |

### 可选：代码导航（LSP）

不装也能用（浏览、搜索、Git、复制引用都正常），只是双击跳转、调用链、Code Vision 的用法计数会退化为文本匹配。**需要自己准备语言服务器**，见第五节。

---

## 二、它长什么样

进入后：

```
┌──────────────────────────────────────────────────────────────┐
│ ▣ order-service  ~/Documents/…  ⧉ 实时 ⟳ ▤ 对话              │
├──────────────┬───────────────────────────────────────────────┤
│ 筛选文件…     │ 对话 × │ Main.java × │ App.java ×              │
│ ▾ src        ├───────────────────────────────────────────────┤
│   ▾ main     │ src/main/Main.java                            │
│     App.java │  1  package demo;                             │
│     Main.java│  3  @RestController                           │
│ ▸ test       │                                               │
├──────────────┴───────────────────────────────────────────────┤
│ src/main/Main.java   128 行  Java  UTF-8  ● 实时  只读        │
└──────────────────────────────────────────────────────────────┘
```

进代码工作区：`⌘2`（Web：`⌥⌘I`）；回对话：`⌘1`（Web：`⌥⌘U`）。

---

## 三、功能

**工作区与代码视图**

- 文件树：按需展开（展开才读、才监听）、按名筛选、拖动列宽、整列隐藏；文件夹在前、文件在后，按名称自然排序（`file2` < `file10`）
- 文件图标：`.java` 按声明类型显示 `C`/`I`/`E`/`@`/`R` 徽标，其他文件显示类型首字母（`pom.xml` → `X`）
- 树工具栏：定位到当前文件 / 展开全部（上限 200 个目录）/ 收起全部
- 标签页：多标签、中键关闭、右键菜单（关闭其他/全部/未修改/左侧/右侧/只读、复制路径）
- 源码视图：行号、按语言着色、状态栏（行数/语言/编码/实时状态）、只读
- VCS 变更条：绿=新增、蓝=修改、红=删除位置，数据来自 `git diff HEAD -U0`
- 实时刷新：每个展开目录挂一条变更流；窗口重新聚焦时重读当前标签
- 视图持久化：每个工作区记住标签、活动标签、展开目录、树宽与显隐（浏览器 `localStorage`，最多 3 个工作区）
- 大文件保护：单文件读取上限 6000 行 / 900 KB，超出截断并提示

**语义导航（需要 LSP）**

- 双击：方法调用 → 声明；接口/抽象方法声明 → 实现；`getX`/`setX`/`isX` → 字段；类型名 → 工作区声明，其次依赖 jar 源码
- `⌘+单击`（Windows：`Ctrl+单击`）：弹出「实现 / 调用方」分区结果
- `⌥+单击` 方法名：调用链浮层（入口在上、被点方法在下，点节点跳转）
- 依赖 jar：目标类不在工作区时自动打开只读源码标签（解析 `-sources.jar`，不反编译、不落盘）
- Code Vision：方法行尾显示 `N 个用法 · M 个实现` + 该行最后提交人
- 没有 LSP 时全部退回文本匹配，并明确标注「文本匹配」

**搜索**

- Search Everywhere（双击 `Shift`）：所有（默认）/ 类 / 符号 / 文件 / 文本 / 操作
- 全仓库按名搜索：`⌘P`（Windows：`Ctrl+P`）聚焦搜索框
- 「符号」是声明形状的文本启发式，不是符号索引

**Git**

- 追溯注解：代码左侧右键 →「使用 Git 追溯注解」，逐行显示日期与作者，再点一次关闭
- 文件树 Git 分组：显示差异 / 显示历史记录 / 与修订比较… / 与分支或标签比较…

**引用**

- 源码里的方法名、字段、类名右键：「复制名称」「复制引用」「复制引用回对话」
- 文件树右键也有「复制引用回对话」
- 「复制引用回对话」会切回对话，把 `@文件` 引用**追加**到输入框末尾——已有文字和附件不动，插入的是真正的引用芯片；匹配不到时退化为纯文本 `@相对路径`，不会插错文件

**设置**（设置 → 通用设置 → 代码工作区设置）

- 快捷键 7 条，全部可改
- 字号：代码 12.5px、文件树 14.5px（10–24px 步进 0.5）
- Maven 本地仓库：留空=自动检测（`settings.xml` → `~/.m2/repository`），下方直接显示当前实际使用的路径

---

## 四、快捷键与手势

| 动作 | macOS | Windows |
|---|---|---|
| 打开 / 关闭代码工作区 | `⌘2` | `Ctrl+2`（Web：`⌥⌘I` / `Ctrl+Alt+I`） |
| 返回对话 | `⌘1` | `Ctrl+1` |
| 搜索无处不在 | 双击 `Shift` | 双击 `Shift` |
| 定位文件搜索框 | `⌘P` | `Ctrl+P` |
| 转到定义 / 查看实现 / 查看调用链 | 下拉选择：双击 / `⌘+单击` / `Ctrl+单击` / `⌥+单击` | 双击 / `Ctrl+单击` / `Alt+单击` |

键位全部在 设置 → 通用设置 → 代码工作区快捷键 里改；改完立即生效，存于插件偏好（不写 DSH 的快捷键目录）。

---

## 五、代码导航（可选，需要自己准备）

DSH 的 LSP 是可选能力，插件只消费它。没装时进入代码工作区会弹「代码导航未就绪」引导页，列出缺什么。三步：

**1) 管道包**（版本必须与 DSH 一致）

```sh
dsh plugin --profile desktop add @deepseek-ai/dsh-lsp@0.2.2-rc.3 @deepseek-ai/dsh-lsp-stdio@0.2.2-rc.3
```

**2) 语言服务器**：IntelliJ 授权版（build `271.2085.0`）放到本机 `~/.dsh/lsp-bin/intellij-server-2027.1/`，然后在 profile 的 `cordis.patch.yml` 里插两行：

```yaml
- insert:
    - id: lsp
      name: "@deepseek-ai/dsh-lsp"
    - id: lsp-stdio
      name: "@deepseek-ai/dsh-lsp-stdio"
      config:
        servers:
          java:
            command: /Users/<you>/.dsh/lsp-bin/intellij-server-2027.1/bin/intellij-server
            extensionToLanguage:
              ".java": java
            args:
              - --stdio
              - --eula=cd82e6cdaf2790f1
              - --system-path=/Users/<you>/.dsh/lsp-data/intellij-server
              - --data-sharing=none
              - --log-level=WARNING
            maxDocumentBytes: 4000000
```

Windows 上把这两处换成 `C:/Users/<you>/...`：`command` 指向 `...\bin\intellij-server.bat`（插件会按平台规则给 `.bat`/`.cmd` 加 shell，直接用就行），`--system-path` 指向 `C:/Users/<you>/.dsh/lsp-data/intellij-server`。

**3) 授权**：需要 IDEA Ultimate 许可。`~/.dsh/lsp-bin/intellij-server-2027.1/bin/intellij-server license status|login|activate|trial|reset`；登录后**必须重启 DSH**（授权状态缓存在服务器进程里）。

其他要点：

- 服务器约 1.2 GB，带 JetBrains 许可，**不随仓库分发**
- 索引目录：macOS `~/Library/Caches/JetBrains/IntelliJServer`（约 1.2 GB）；首次启动建索引要几分钟，期间跳转会返回空结果
- 想接别的语言：在 `servers` 下再加一项并配 `extensionToLanguage`，插件的点击逻辑与语言无关
- 回滚到 jdtls：把 `command` 换回 `/opt/homebrew/bin/jdtls`，`args` 用 `[-data, ~/.dsh/lsp-data/java]`

---

## 六、故障排查

**先看诊断日志**（插件自带）：

```bash
tail -f ~/.dsh/logs/dsh-ide-window.log
# Windows：type %USERPROFILE%\.dsh\logs\dsh-ide-window.log
```

JSONL 一行一条，含启动信息（平台 + Node 版本）、每条路由失败（路由、状态码、错误码、消息）、进程起不来、浏览器上报的通知/LSP 失败/页面异常。文件超 512 KB 轮转为 `.1`。

界面里：Search Everywhere →「复制诊断信息」，会把客户端缓冲合并进同一个文件并复制一份 JSON 快照。

| 症状 | 处理 |
|---|---|
| 找不到「代码工作区」入口 | 完全退出 DSH 再打开；确认 `dsh plugin --profile desktop list` 里有 `@local/dsh-ide-window` |
| 进入后弹「代码导航未就绪」 | 没装 LSP，按第五节准备；浏览/搜索/Git 不受影响 |
| 双击跳转提示「文本匹配」 | 同上：LSP 没挂载或未就绪（授权未生效需重启 DSH） |
| 依赖 jar 打开提示「该 jar 没有源码」 | 本地仓库里没有 `-sources.jar`；确认 Maven 本地仓库路径（设置里可覆盖） |
| 右键菜单贴边被裁掉 / 离鼠标很远 | 已修：菜单挂在指针处，放不下时底边贴着指针向上展开；若仍异常请附诊断日志 |
| 「复制引用回对话」插成了纯文本 | 该文件不在当前会话工作区内，或同名文件无法唯一确认；纯文本引用仍可用 |
| 插件显示 `pending (waiting for service: webServer)` | 该 profile 没有 Web 服务（如纯 CLI 环境），属正常 |

---

## 七、开发

```sh
node build.mjs          # src/client/*.js → client.js（浏览器只接受单文件 factory）
node --check client.js
npm test                # 平台 / 诊断日志 / 状态 / VM 夹具 / 归属推断 / 真实 ~/.m2 jar
./check-dsh-untouched.sh # 本体完整性（签名 + app.asar 哈希 + 可疑新文件）
```

自测实例（固定端口、独立家目录、复用本机账号）：

```sh
./start-test-instance.sh                                  # macOS / Linux
.\start-test-instance.ps1                                 # Windows
```

Windows 另有 `check-dsh-untouched.ps1`、`restore-profile.ps1`，与对应的 `.sh` 等价。

**片段构成**（构建顺序即文件名顺序，共 17 个）：

| 文件 | 职责 |
|---|---|
| `00-css.js` | 全部 `.iw-*` 样式，复用 DSH 主题 token |
| `05-icons.js` | 内联 SVG 图标与语言配色 |
| `05-shortcut-registry.js` | 快捷键唯一登记处 `IDE_SHORTCUTS` |
| `06-platform.js` | 客户端平台层（路径转换、手势选项与文案） |
| `07-log.js` | 客户端环形日志与诊断快照 |
| `10-core.js` | store、偏好、标签页/历史/视图持久化 |
| `20-tree.js` | 文件树、筛选、拖宽、右键菜单 |
| `30-code.js` | 代码视图、符号点击、导航 |
| `40-panel.js` | 面板骨架与菜单挂载 |
| `45-tracker.js` | 会话跟踪（记住「屏幕上」的会话） |
| `59-gesture-settings.js` | 设置分区 + 标签页/槽位/符号菜单 |
| `60-jump.js` | 文件地址声明与跳转拦截 |
| `65-lsp.js` | LSP 语义辅助 |
| `66-callchain.js` | 调用链浮层 |
| `68-grep.js` | 工作区搜索 + jar 源码查询 |
| `70-palette.js` | Search Everywhere |
| `90-apply.js` | 全部注册与入口 |

**平台层**：所有系统差异集中在 `platform/`（宿主）与 `src/client/06-platform.js`（界面）。**只有 macOS 走 macOS 分支，其他系统一律按 Windows 处理**；插件内部路径统一用 `/`，只在展示/复制时换成本机形式。新增功能必须同时过 macOS 与 Windows 的兼容检查（清单见 `AGENTS.md` 3.2）。

**改了 `src/` 要重新构建并提交 `client.js`**，否则别人装的是旧代码。

---

## 八、安全边界

插件**只写自己的目录和用户态位置**：

```
~/.dsh/profiles/<profile>/   profile 配置（bundles、cordis.patch.yml）
~/.dsh/sessions/             会话数据
~/.dsh/lsp-bin/ ~/.dsh/lsp-data/   语言服务器与索引
~/.dsh/logs/dsh-ide-window.log     诊断日志
```

**绝不写入 DSH 应用包**：改了会导致签名失效、升级被覆盖。所有对 DSH 源码/类型定义的访问都是只读（`ELECTRON_RUN_AS_NODE` 读 asar）。随时自证：

```sh
./check-dsh-untouched.sh           # 签名 + app.asar 哈希基线 + 包内可疑文件
./check-dsh-untouched.sh --rebase  # 官方升级后重设基线
```

---

## 九、已知限制

- 源码视图**只读**（目标是「看到 AI 改了什么」，需要编辑请用外部编辑器或 DSH 自身的文件视图）
- 二进制 / 超大文件显示占位提示
- 主题之外若禁用 `color-mix()`，少数强调色会退化为纯色
- 左侧导航行可能被折叠进「更多」菜单，此时用左下角按钮进入
- 引用回对话依赖对话输入框的 DOM（Lexical 编辑器 + `@` 触发菜单）；DSH 升级若改结构会退化为纯文本引用，不会插错文件
- Windows 未做完整实机回归（平台层、菜单定位、引用插入已按 Windows 规则实现并有单测）

---

## 十、许可

MIT（`package.json` 声明）。

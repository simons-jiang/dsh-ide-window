# dsh-ide-window

IDEA 风格的代码工作区插件：把 DSH 的中央区域切成「文件树 + 编辑标签页 + 实时源码视图」，进入时自动收起左侧导航栏。

> 面向 DeepSeek Harness Web / Desktop GUI。宿主侧零改动，全部能力走 DSH 已注册的服务与插槽。

## 不修改 DSH 本体（硬约束）

插件**只写自己的目录**，以及以下用户态位置：

```
~/.dsh/profiles/<profile>/   profile 配置（package.json 的 bundles、cordis.patch.yml）
~/.dsh/sessions/             会话数据
~/.dsh/lsp-bin/ ~/.dsh/lsp-data/   语言服务器与索引
```

绝不写入 `/Applications/DeepSeek Harness.app`：改了会导致签名失效，升级时被覆盖或直接损坏，插件在升级后必然不可用。所有对 DSH 源码/类型定义的访问都是**只读**（通过 `ELECTRON_RUN_AS_NODE` 读 asar）。

随时可自证：

```bash
./check-dsh-untouched.sh          # 签名 + app.asar 哈希 + 包内可疑文件
./check-dsh-untouched.sh --rebase # 官方升级后重设哈希基线
```

## 它长什么样

进入方式（任选）：

- 左侧导航里的「代码工作区」图标行；
- 左下角设置旁的「代码工作区」按钮（导航行被折叠进 More 菜单时仍然可见）；
- 对话面板顶部工具条里的按钮。

进入后：

```
┌──────────────────────────────────────────────────────────────┐
│ ▣ order-service  ~/Documents/…  ⧉ 实时 ⟳ ▤ 对话    │
├──────────────┬───────────────────────────────────────────────┤
│ 筛选文件…     │ 对话 × │ Main.java × │ App.java ×              │
│ ▾ src        ├───────────────────────────────────────────────┤
│   ▾ main     │ src/main/Main.java                            │
│     App.java │  1  package demo;                             │
│     Main.java│  2                                            │
│ ▸ test       │  3  @RestController                           │
├──────────────┴───────────────────────────────────────────────┤
│ src/main/Main.java   128 行  Java  UTF-8  ● 实时  只读        │
└──────────────────────────────────────────────────────────────┘
        ┌────────────────────────────┐
        │  对话（浮动窗口，可拖动缩放） │
        └────────────────────────────┘
```

## 功能

- **中央区主面板**：注册为 `main` 插槽的 key `dsh-ide-window:code`，占满中栏。
- **IDEA 式文件树**：按需展开目录（展开才读、才监听），按名称筛选，可拖动列宽，可整列隐藏。
- **编辑标签页**：多文件标签、`对话` 常驻标签、中键关闭、面包屑路径。
- **源码视图**：行号、按语言着色、状态栏显示行数/语言/编码/实时状态。**不用虚拟滚动**——全部已加载行直接挂载（上限 6000 行），因为窗口化渲染曾在首次测量时漏画后续行，导致「下面全空白」。行内词法着色按行 memo，几千行文件重渲染也不重复着色。
- **弹层定位**：用法弹层是 `position: fixed` 且**渲染在滚动容器之外**（否则会随源码滚动、并按代码区容器定位导致偏移），坐标用视口坐标，始终贴着鼠标出现
- **同屏尝试记录（均未采用）**：右栏放对话（外壳搬走会话主面 → 面板卸载 + 遮罩）、右栏放代码（布局反了）、自绘浮窗（用户否决）。结论：代码工作区固定占**主栏**，与对话用 `⌘1`/`⌘2` 切换
- **存取器归属类推断**（引擎解析不到时，按确定程度依次尝试）：① `Type::getX` 方法引用自带类名；② `older.getX()` 从同文件局部变量声明取类型；③ `a.b().getX()` 链式接收者 → 取链底变量（`captor`）的**泛型实参**（`ArgumentCaptor<ExchangeRateInnerQuery>`），支持带包名的写法 `org.mockito.ArgumentCaptor<T>`；④ 兜底用一次 `hover` 拿返回类型；⑤ 首字母大写当作类本身。拿到类名后用 `import` 求全限定名
- **自测**：`npm test` = 离线 harness（115 项）+ 归属推断（10 项，fixture）+ 真实 Maven 仓库端到端（3 项）。UI 层可用 `dsh --profile web` 起一个带 token 的本地实例在 Agent Window 里点（浏览器扩展协议需 ≥1.9 才能用 evaluate/sync；1.3 只能 click/fill/press）
- **依赖 jar 源码跳转**：目标类不在工作区、但 Maven 仓库里有 `-sources.jar` 时，双击直接打开**只读虚拟标签**并定位到字段/行。宿主路由 `/dsh-ide/jar` 自己解析 ZIP 中央目录（不调用 unzip），按 jar 修改时间从新到旧扫描，命中结果做进程内索引；纯二进制 jar 返回「该 jar 没有源码」
- **Lombok 存取器兜底**：引擎解析不到 `getX`/`setX`/`isX` 时，先在本文件找字段；再判断调用形态——若是方法引用 `Type::getX`，直接去 `Type.java` 里找 `x` 的字段声明并跳过去（这条不依赖引擎，因为方法引用自带归属类名）
- **对话改动列表（与代码工作区联动）**：注册进 `conversation.chat.turnTail`（列表槽、scope session），每轮末尾显示「代码改动 N +A -D」；点击某行 → 拉该文件 diff → 定位**第一个新增行** → 切到本插件主栏面板打开。数据来自 DSH 自带路由 `/api/changes.summary`、`/api/changes.diff`（与「已编辑 N 个文件」卡片同源，不解析消息、不改官方组件）。两个坑：① 摘要按 `workspace/changes` 事件序号取，不是 turn 结束序号（要从 `turn.data.get('deliverables').changes.seq` 读，用错会 404）；② **摘要在 Host 内存里**，DSH 重启后历史轮次没有摘要（官方卡片同样消失）——此时退回从 `useTrajectory` 已加载的事件窗口还原文件路径，覆盖不到的轮次就什么都不显示（不做宿主侧落盘，避免过重）
- **入口与快捷键**：入口在会话表头左侧（`conversation.header.leading`），不在左侧栏。**所有快捷键集中登记在 `src/client/05-shortcut-registry.js` 的 `IDE_SHORTCUTS` 一张表里**，加一条就自动出现在 设置 → 通用设置 → 「代码工作区快捷键」里，不需要改设置 UI。三种 `kind`：
  - `key`：注册进 DSH 快捷键目录（也在 DSH「编辑快捷键」弹窗里，标签带 `代码工作区: ` 前缀，搜「代码工作区」可筛出），桌面默认 `⌘2` / `⌘1`，Web 默认 `⌥⌘I` / `⌥⌘U`
  - `gesture`：指针手势（双击 / ⌘+单击 / ⌥+单击），在插件这一行点选，两个动作互斥
  - `fixed`：DSH 目录表达不了的行为（`双击 Shift` 打开搜索无处不在、`⌘P` 定位文件搜索框），在设置里只读展示；其键位/时间窗也从同一张表读取，不在监听器里写魔法数字

  要点：① 插件导出必须声明 `inject: [... 'shortcuts']`，否则抛 `cannot get property "shortcuts" without inject`；② **不要声明 `web:linux` 默认值**（该 profile 只允许 Slash/Comma/Period 白名单，声明了整条注册会失败）；③ 设置行必须**内联**渲染，`shell.overlay` 层级低于设置弹窗，弹窗会被盖住；④ `resolve` 返回 `{status:'handled', run}` 而不是直接执行
- **语义代码导航**（走宿主 `ctx.lsp`，由真正的语言服务器回答）：
  - 手势：**单击不触发任何导航**（拖动选中/复制不会被误判）、**⌘/Ctrl + 单击**弹出「实现 / 调用方」、**双击**跳转到定义
  - `Ctrl`/`Cmd` + 点击标识符 → `goToDefinition`，无结果自动回落 `goToImplementation`；
  - 点 Bean 存取器（`getX` / `setX` / `isX`）时继续解析到**字段** `x`：先在存取器方法体里找到该标识符（优先 `this.x`，跳过参数表里的同名参数），再对该位置发一次 `goToDefinition`，由语言服务器给出字段声明——不是按行号猜；
  - 单击标识符 → 弹出**分区结果**：先「实现」（`goToImplementation`），再「调用方」（`findReferences` 去掉声明本身），每行是「文件 行号 + 该行源码」，点一行跳到那段代码；
  - 点接口 / 抽象方法时这两区同时出现，正是「谁实现、谁在调」的区分；
  - 查询经本插件的宿主路由 `POST /dsh-ide/lsp` 转发，浏览器不猜符号；
  - **每次跳转的次数是受限的**：非存取器符号 = 1 次语言服务器查询、0 次文件读；存取器 = 1 次查询 + 1 次读（只有当服务器返回的是方法体时才追加 1 次查询去找字段）。单目标跳转不取源码片段；
  - 跳转结束 banner 会显示落点与耗时（`→ Foo.java:42 · 180ms`），分阶段明细打在 DevTools 控制台（`[dsh-ide-window] definition: lsp 120ms · read 40ms · total 180ms`）。不设任何缓存，避免过期结果。
- **引用跳转**：对话里点文件 / `文件:行号`（工具卡片、Markdown 链接、交付物、`@` 引用），中央面板自动跳到该文件的对应行并高亮。工具条「链环」图标可开关。
- **每个标签记住滚动位置**：切走再切回不再跳回文件开头；只有「新的跳转行」会覆盖它（同一行再点一次也算新跳转）。滚动位置按 150ms 去抖记录，刷新后重新读取文件也保持位置
- **导航历史**：`Alt+←`/工具栏箭头/Mouse 侧键（button 3/4）后退与前进，回到**上一个文件的同一个代码点**（记录的是文件 + 行号，不是滚动像素）；切标签也算一次导航；新的跳转会清空前进栈；每个方向保留 50 步。侧键在 `mousedown`/`mouseup` 只抑制浏览器默认行为，实际步进只由 `auxclick` 执行一次
- **Search Everywhere（双击 Shift）**：三路来源——文件（宿主索引）、文本（DSH 自带 ripgrep，带行号）、操作（面板命令）。输入支持 IDEA 的地址形式：`a.b.C` 会转成路径查询 `a/b/C.java` 再按简名兜底，`a.b.C#member` 会继续定位到该方法所在行。**没有符号索引**（DSH 的 LSP seam 不暴露符号接口），所以「类」是靠类名=文件名这个 Java 约定实现的，不是真正的符号表
- **全仓库文件搜索**：树顶部的搜索框走宿主的 `workspaceFiles.search`（不是只过滤已展开的目录），输入即搜、去抖 180ms、只采用最新一次结果；`⌘P` / `Ctrl+P` 聚焦搜索框，`Esc` 清空，点结果直接打开并跳到该文件
- **切换项目**：工具栏左上角的项目名是个下拉菜单，列出 shell 里所有工作区（外加当前会话的根目录），选一个即可切换；选择持久化在偏好里，也可以选「跟随当前会话」交回控制权。切换后按新根目录浏览（Remote 用绝对路径，不需要换会话），并且**每个项目各自记忆自己的打开标签**——切回去会恢复它上次的样子
- **面板状态持久化**：按工作区根目录记住打开的文件标签、活动标签、展开的目录、树宽与显隐，存于浏览器 `localStorage`（`dsh-ide-window:view`，400ms 去抖）；回到面板或刷新页面后自动恢复并**重新读取文件内容**（不缓存旧内容，AI 的改动立即可见）。会话切换不再清空标签。上限：16 个标签、24 个展开目录、最近 3 个工程。**不写项目里的 `.idea`**，与仓库无关
- **VCS 变更条**：行号左侧的色带标出相对 `HEAD` 的改动——绿=新增、蓝=修改、红=删除位置、整篇绿=未跟踪的新文件。宿主路由 `/dsh-ide/diff` 用 `git diff HEAD -U0` 解析 hunk，文本先显示、色带异步补上；文件在请求途中被改动则丢弃结果
- **实时刷新**：每个展开的目录各挂一条 `workspaceFiles.changes` 流。宿主的帧带的是**被监视目录**（不是变动的文件），所以目录失效时重列该层，并**重读该目录下所有已打开的文件**；窗口重新获得焦点时也会重读（覆盖外部编辑器保存、页面在后台的情况）。刷新按钮重读**所有**标签，不再只重读出错的。
- **自动收纳左侧导航栏**：进入时隐藏、离开时恢复；会先读 `data-sidebar-collapsed` 标记，已经收起就不动它。工具条上的按钮可以随时手动切换。

## 安装

插件是本地 link 包，已在 `desktop` profile 里注册。重装/更新：

```sh
dsh plugin --profile desktop add link:~/dev/dsh-ide-window
```

浏览器里**硬刷新**（Cmd/Ctrl+Shift+R）后生效。改代码后只需 `node build.mjs` 再硬刷新。

## 开发

```sh
node build.mjs        # src/client/*.js → client.js（浏览器只接受单文件 factory）
node --check client.js
node test/harness.mjs # 离线测试台：假 React + 假 ctx，跑注册与数据层
```

`src/client/` 各片段的职责：

| 文件 | 职责 |
|---|---|
| `00-css.js` | 全部样式（复用宿主主题 token） |
| `05-icons.js` | 内联 SVG 图标与语言配色 |
| `10-core.js` | store、`workspaceFiles` Remote 封装、监听、词法着色 |
| `20-tree.js` | 文件树与列宽拖拽 |
| `30-code.js` | 标签页、面包屑、源码视图、状态栏、变更条、导航历史 |
| `40-panel.js` | 中央面板装配 |
| `45-tracker.js` | 无渲染的会话跟踪器（记住「屏幕上」的会话） |
| `90-apply.js` | 全部插槽注册与沉浸模式编排 |

## 设计要点（踩过的坑）

1. **`main` 是 root 作用域，拿不到 `sessionId`。** 而且一旦全局面板占据中栏，`ctx.sidebarRight.mounted` 会变成 `undefined`，所以「当前在工作哪个工作区」必须由一个常驻的 `shell.overlay` 组件提前记住。`45-tracker.js` 就是干这个的。
2. **右侧栏的写操作依赖「屏幕上的会话」。** `openTab` / `close` 在全局面板显示时会抛 `sidebarRight: no session surface is mounted`。文件地址 claim 因此只在面板未占中栏时关闭自己那个 tab。
3. **`ctx.layout.toggleSidebar()` 是纯取反**，没有可读状态。只能读 frame 上的 `data-sidebar-collapsed` 标记来判断，避免把用户本来就收起的栏展开。
4. **不碰宿主 UI。** 不替换 `sidebar.panel.icon`、`sidebar.files.tree` 这类 Factory，也不占 `conversation` 这个 key——新 key、新 id，纯增量。
5. **浮动对话功能已移除。** 它依赖右栏页签与主栏选择，关闭浮窗时外壳会把主栏切回对话、把面板卸载；从插件侧无法稳定恢复。现在只用「回到对话」按钮回到对话。

## 代码导航：当前用 IntelliJ 引擎

| 项 | 值 |
|---|---|
| 服务器 | `~/.dsh/lsp-bin/intellij-server-2027.1/bin/intellij-server`（自带 JBR 25，不需要 JDK） |
| 启动参数 | `--stdio --eula=… --system-path=~/.dsh/lsp-data/intellij-server --data-sharing=none` |
| 工程模型/系统目录 | `~/.dsh/lsp-data/intellij-server`（**只有 816 KB**，不含索引） |
| **索引（真正的大头）** | `~/Library/Caches/JetBrains/IntelliJServer`（**约 1.2 GB**；删掉它等于强制重建索引） |
| 磁盘合计 | 服务器 1.2 GB + 索引 1.2 GB ≈ **2.4 GB**（jdtls 方案约 850 MB） |
| 许可 | 需要 IDEA Ultimate 许可（试用/订阅/激活码），`intellij-server license status` 查状态 |
| 回滚到 jdtls | `~/.dsh/profiles/desktop/cordis.patch.yml.before-ijs` |

实测（同一个工程、同一个符号、单击弹出「实现 + 调用方」）：

| | jdtls | IntelliJ |
|---|---|---|
| 总耗时 | 2516 ms | **355 ms** |
| def / impl / refs | 235 / 799 / 1472 ms | 55 / 43 / 243 ms |
| 往仓库写元数据 | `.project`/`.classpath`/`.settings`/`.factorypath` | **无** |

代价：IDEA 引擎**首次启动要建索引**（几分钟），期间点击会返回空结果（banner 会提示「若刚启动，请等索引完成后重试」）。索引建好后重启只需复用缓存。

## 代码导航依赖（jdtls，回滚时参考）

DSH 把语义导航放在可选的 LSP 能力 seam 上，本插件消费它，不带自己的解析器：

| 组件 | 作用 | 本机状态 |
|---|---|---|
| `@deepseek-ai/dsh-lsp` | seam 本体，`ctx.lsp` 提供 `goToDefinition` / `findReferences` / `goToImplementation` / `hover` | 已装入 profile（0.2.2-rc.2） |
| `@deepseek-ai/dsh-lsp-stdio` | 托管一个 stdio 语言服务器进程 | 已装入 profile（0.2.2-rc.2） |
| `jdtls`（Eclipse JDT LS） | 真正的 Java 语言服务器 | Homebrew 安装 |
| 本插件 `index.js` | 把 `ctx.lsp` 以 `POST /dsh-ide/lsp` 暴露给前端 | 本插件宿主半区 |

profile 补丁（`~/.dsh/profiles/desktop/cordis.patch.yml`）里注册的行：

```yaml
- insert:
    - id: lsp
      name: "@deepseek-ai/dsh-lsp"
    - id: lsp-stdio
      name: "@deepseek-ai/dsh-lsp-stdio"
      config:
        servers:
          java:
            command: /opt/homebrew/bin/jdtls
            extensionToLanguage:
              ".java": java
            args: [-data, ~/.dsh/lsp-data/java]
```

想接别的语言（TS/Python/Go…）只要在 `servers` 下再加一项，并把 `extensionToLanguage` 指到对应语言 id；本插件的点击逻辑与语言无关。

**注意**：jdtls 首次查询会先建索引，慢几秒；之后走缓存。`LSP` 未加载时点击会在 banner 报 `代码导航不可用（LSP）: lsp-unavailable`，不会静默。

## 已知限制

- 源码视图**只读**（v1 目标就是「看到 AI 改了什么」）；需要编辑请用右侧栏的文件视图或外部编辑器。
- 二进制/超大文件显示占位提示；单文件读取上限 6000 行 / 900 KB。
- 如果宿主主题以外的环境禁用了 `color-mix()`，部分强调色会退化为纯色。
- 侧边栏导航行可能被折叠进 More 菜单（宿主的 `entry-customization` 插件注册了 panel 动作），此时请用左下角按钮进入。

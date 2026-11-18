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
- 目标 DSH 版本：`0.2.2-rc.3`（桌面应用 + Web profile 都要能跑）
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

---

## 三、架构

### 3.1 两半：宿主 + 客户端

```
index.js               宿主（Node ESM）：注册 8 条 HTTP 路由，转发到 DSH 服务
client.js              客户端产物（build.mjs 生成，**必须提交**）
src/client/*.js        客户端源码片段（构建时按文件名排序拼接）
build.mjs              把 15 个片段 + locale 拼成 client.js
cordis.patch.yml       bundle patch：把插件插入 profile（id: dsh-ide-window）
locale/{zh,en}.json    UI 文案（165 个键）；插件管理器也从这里读标题/描述
```

**为什么有切片 + 构建**：浏览器模块加载器每个包只吃**一个**文件，所以源码必须合并成一个 factory body。片段前缀数字 = 拼接顺序。

| 片段 | 职责 |
|---|---|
| `00-css.js` | 全部 `.iw-*` 样式（单文件注入 `<style>`） |
| `05-icons.js` | 内联 SVG 图标（`ideSvg` 统一 16 网格） |
| `05-shortcut-registry.js` | **所有快捷键的唯一登记处** `IDE_SHORTCUTS` |
| `10-core.js` | store（`useSyncExternalStore` 订阅）、偏好持久化、标签页/历史/视图状态 |
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
| `90-apply.js` | 全部注册（槽位、快捷键、命令、设置项）+ `enter()/openPanel()` |

### 3.2 宿主路由（`index.js`）

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
| `/dsh-ide/open` | 文件树「打开于」 | `reveal`（Finder `open -R`）/ `terminal`（`open -a Terminal`）/ `external`（默认应用）；非 macOS 退 `xdg-open` |
| `/dsh-ide/log` | 文件的提交历史 | `git log --date=short --pretty=format:%h%x09%an%x09%ad%x09%s -n ≤100 -- <path>` |
| `/dsh-ide/refs` | 分支与标签 | `git for-each-ref refs/heads refs/tags`，返回 `{name, kind}` |
| `/dsh-ide/patch` | 差异文本 | `git diff -U3 <base> [target] -- <path>`；根提交回退 `git show --patch`；未跟踪文件返回 `untracked` |
| `/dsh-ide/text` | 复制文件内容 | 读整个文件（≤512 KB），返回 `{text, truncated}` |
| `/dsh-ide/license` | JetBrains 授权 | `{action:'status'}` 跑 `intellij-server license status`；`{action:'open'}` 后台跑 `license login --browser` 并回传授权 URL（6 秒内没出现 URL 就回传工具输出）。给这两个 JVM 动词加 `-Didea.log.path=<tmp>`，避免受限环境下写 `~/Library/Logs` 失败 |

### 3.3 用到的 DSH 槽位

| 槽 | 用途 |
|---|---|
| `main`（keyed `dsh-ide-window:code`） | 面板占中栏 |
| `conversation.header.leading` | 会话表头左侧的入口按钮 |
| `settings.general.item` | 设置 → 通用设置里的「代码工作区设置」 |
| `shell.overlay`（list） | 面板内浮层（用法弹层等） |
| `sidebar.right.pane.tab` | 仅用于文件地址认领（body 不渲染） |
| `sidebar.footer.action` | 左下角入口 |

> `shell.bottom` 是**单例槽**，已被 git 插件占用，**不要抢**。

---

## 四、功能清单（都已实现并自测）

### 4.1 工作区与代码视图
- 文件树：按需展开、筛选、拖宽、实时刷新、VCS 改动条；目录顺序按 IDEA：**文件夹在前、文件在后**，组内按名称（不区分大小写、数字自然排序：`file2` < `file10`）
- 文件树 VCS 着色：**有改动**的文件名蓝绿色（`#2fa79a`）、**新增/未跟踪**棕红色（`#b35f3d`）；数据来自 `/dsh-ide/status`（`state.vcs`，`path → 两位 porcelain 码`），在根目录确定、工作区变更帧（250ms 合并）、窗口聚焦、手动刷新时更新
- 文件图标：全部是 **1.5px 线性描边**、无填充——文件夹 20px（展开时前片翻开）；`.java` 按声明类型显示 `C`/`I`/`E`/`@`/`R` 的圆环徽标（宿主 `/dsh-ide/kinds` 读文件头，按目录批量、客户端缓存）；其他文件是文档轮廓 + 居中的类型首字母，字母用语言色（`ideTintOf`）；文件图标 21px
- 文件树工具栏：**定位到当前文件**（展开祖先目录、滚动并高亮）/ **展开全部**（逐层加载，上限 200 个目录，超限提示）/ **收起全部**
- 标签页：多标签、中间键关闭、**右键菜单**（关闭 / 其他 / 全部 / 未修改 / 左侧 / 右侧 / 只读 / 添加到上下文 / 复制路径）
- **文件树右键菜单**：在代码工作区打开 / 在 Finder 中显示 / 在终端中打开 / 复制文件内容、绝对路径、仓库相对路径、限定类名；**Git 分组**：使用 Git 追溯注解、显示差异（叠加层展示 unified diff）、显示历史记录、与修订比较…（最近提交列表）、与分支或标签比较…（分支/标签列表）；差异弹层与选择器用 `iw-overlay`，Esc 关闭
- 窗口聚焦：重读当前标签（`reloadActive`，内容 + git 色带），`git commit` 不改内容也能更新
- 项目跟随会话：面板根目录**永远由当前会话决定**（`45-tracker` 解析会话 → 工作区）；项目下拉只做「切到该工作区的会话」，不再持久化手动选择（原 `preferredRoot` 已删除）；切换项目走 `enterProject(root, session)`，**会话与根目录一次 patch、一次 restart**（分两步会让旧标签以新会话作用域重读，闪出 `outside-workspace` 红字）；面板里读 `getState()` 判断而非订阅 `rootPath`，避免手动切换被跟随逻辑回滚
- DSH 自带的「已编辑 N 个文件」卡片：点**文件行**直接在本插件工作区打开（捕获阶段拦截 + 行内隐藏的绝对路径；卡片头部仍打开官方 review）
- 视图持久化：每个工作区记住标签、激活项、展开目录、树宽、树可见性（最多保留 3 个工作区）
- 大文件保护：>60000 行或超字节上限时截断并提示

### 4.2 语义导航（IntelliJ LSP）
- **双击**判定「是不是声明」的关键**不是**看有没有 `(`，而是看名字前面是不是一个**返回类型**：`private void foo(` / `Resp detail(` 算声明；本类里的裸调用 `        foo();`（前面只有缩进）、`page = service.foo(`、`service.foo(` 都不算——之前的正则在裸调用上误判为声明，导致双击本类方法只提示「当前位置就是定义」而不跳转
- **双击**的三种语义：① 属性访问器（`getX`/`setX`/`isX`，接收者类型在本文件可见）→ 跳该类的**字段**（Lombok 没有源码 getter）；② 接口/抽象类里的方法**声明** → 跳**实现**（`goToImplementation`，没有就按 `implements`/`extends` 文本扫，多个实现弹选择，没有实现提示「当前位置就是定义」）；③ 方法**调用**或具体方法 → 跳声明（工作区文本兜底 / jar 源码）。字段声明、具体方法声明原地不动，**绝不会**因为同名就跳到别的类。**⌘+单击** → 实现 / 调用方弹层；**⌥+单击方法名** → 调用链（向上递归「谁调用了它」，思维导图浮层，点节点跳转）；`findReferences` 返回的声明位置会被丢弃（否则会把上一层自己的签名行误当成调用点），浮层把入口放在最上面、被点的方法放在最下面（上方调用下方），← 后是它调用下方方法的位置；每个节点都带类名；**实现方法会顺着 `implements` 找到接口里的同名方法，把接口调用方一并纳入调用链、用法计数和 ⌘+单击的调用方列表**（否则实现方法永远显示 0 用法）；手势在设置里用**下拉**选择（双击 / ⌘+单击 / Ctrl+单击（仅 macOS）/ ⌥+单击，三个动作互斥）
- 跳转成功后横幅显示 `→ 文件:行 · 查询 xms · 载入 yms`
- **调用链（⌥+单击）有文本兜底**：某一层 `findReferences` 失败或返回空时，改用「查看调用方」同一套文本搜索（同名调用、接收者声明类型必须是本类/本接口）逐层展开，浮层顶部注明「语言服务不可用，调用链按文本匹配展开」；语言服务正常时不出现这行，仍走语义结果
- 注解类型名（`@OperateLog`）可点击；注解属性（`@Log(name=…)`）跳到注解类型里的 `name()` 声明——**先在工作区找同名注解文件**，找不到才去 jar 源码（工作区里被编辑的注解才是真身，jar 副本是被 `mvn install` 出来的）
- **类型名双击**（类/接口/枚举/record/注解）→ 工作区里 `class|interface|enum|record|@interface <名字>` 的声明文件，其次才是依赖 jar 源码；jar 没有 `-sources` 时提示「该 jar 没有源码」（不反编译）。工作区里的类绝不能再被同模块的 sources jar 副本抢走
- 定义在依赖 jar 内时 → 自动去 sources jar 找源码（含「跳过 javadoc 里的 `{@link #x()}`」判定）
- 兜底链：LSP → 注解属性 → **工作区内文本声明**（声明形状 `类型 名字(` 的 grep，避免常见名撞上 200 条上限）→ import FQN → jar 源码 → 文本提示。工作区那一步按「接收者声明类型」锁定同名文件（`ideDeclaredType` 容忍 `private final` 修饰符），再按 `ideIsMethodDeclaration` 排除调用行；接收者由 `ideReceiverChain` 解析——返回**点号链的最左段**（`PurchaseOrderStatusEnum.TO_PURCHASE.matches(...)` → 取 `PurchaseOrderStatusEnum`；`field.method(...)` → 取声明类型）；**链式调用换行时（上一行是接收者、本行以 `.` 开头）会往上找 16 行**，这是 `.listByPaymentTradeNos(...)` 这类写法能找到声明的前提；没有接收者时只认本文件里的声明，绝不取工作区里第一个同名方法。它排在 jar 之前，因为工作区文件才是真正的源码
- **Maven 仓库位置**：发版给别人用的时候**不假设** `~/.m2/repository`——`/dsh-ide/jar` 每次请求按「插件设置 `mavenRepo` → `~/.m2/settings.xml` 的 `<localRepository>`（先剥掉 `<!-- -->` 注释，否则会读到模板里的 `/path/to/local/repo`，且要求路径真实存在）→ `~/.m2/repository`」解析，查找缓存按 `仓库|类路径` 记录；仓库不存在时返回 `{found:false, reason:'missing-repository'}`，界面提示「Maven 本地仓库不存在: <路径>」。设置项在「设置 → 通用设置 → 代码工作区设置 → Maven 本地仓库」，留空=自动检测；**输入框下面一行直接显示实际在用的路径**（`当前使用（自动检测/设置项）：<路径>`，来自 `/dsh-ide/doctor` 的 `mavenRepo` + `mavenRepoExists`），检测到的目录不存在时该行变黄并标「目录不存在」——placeholder 太淡，不能拿它当「检测结果」
- **Git 追溯注解**：代码左侧（git 变化条 / 行号）右键 →「使用 Git 追溯注解」，逐行显示 `日期 作者`，相邻提交交替底色；同一项可关闭。宿主路由 `/dsh-ide/blame` 一次解析整份文件；缓存按 `root|path|version` 且有 30 秒 TTL，注解开启时在「打开注解」与「窗口聚焦」时强制重读，**不跑定时器**（提交不改内容，不能靠 change 事件）；未提交行（零提交）显示「未提交」。注解开启时隐藏行尾 Code Vision。状态在 store 的 `annotate`（`path → true`）与 `codeMenu`
- **JetBrains 授权（-32802）**：IntelliJ 语言服务器需要**有效的服务器授权**，没授权时所有查询都会被拒（`-32802: Request refused: no active JetBrains license`）。处理办法在服务器自己的 CLI 里：`~/.dsh/lsp-bin/intellij-server-2027.1/bin/intellij-server license status|login|activate|trial|reset`（也可用 `INTELLIJ_SERVER_LICENSE`/`INTELLIJ_SERVER_LICENSE_FILE`/`JETBRAINS_LICENSE_SERVER` 注入），登录后**必须重启 DSH**（授权状态在服务器进程里缓存）。插件侧：识别到授权拒绝后**自动用系统浏览器打开授权页**——宿主跑 `license login --browser`（这个子命令自己会开浏览器并给 URL，宿主不再重复开）；已登录但无授权时命令只打印提示、不给 URL，此时宿主直接 `open https://account.jetbrains.com/licenses`（macOS `open` / Linux `xdg-open` / Windows `explorer`），不依赖 webview 的 `window.open`（Electron 里常被拒）。同时在本次页面生命周期内不再请求 LSP（调用链/定义/调用方都直接走文本兜底），横幅只给一条授权提示，不给用户刷「未找到定义」
- **LSP 报错要说清楚**：`LSP_SERVER_ERROR` 这类错误其实是服务器返回的 JSON-RPC 错误，横幅/提示会带上服务器自己的话和操作名（`LSP_SERVER_ERROR — … (-32601) (findReferences)`）；错误的文本里出现 `-32601`/method not found/not supported 时，该操作会被记为「服务器不支持」并在本次会话内跳过，改用文本匹配并提示「当前语言服务不支持这项查询」，不再反复弹错误横幅
- **调用方列表里不能出现声明行**：`findReferences` 会把声明一起返回（接口自己的签名行、另一个类的 override 签名行），契约合并（点实现方法时顺带问接口）会把它们混进 references；生成调用方前用 `ideReferenceIsDeclaration` 按行判断并剔除（形状同 `类型 名字(`），否则弹出层会出现「接口 selectPage 是实现的调用方」这种明显错误的行
- **用量兜底（LSP 无结果时）**：调用方只认同名**调用**（排除声明行）、非静态方法只认 `接收者.名字(` 且接收者的**声明类型**必须是本类/本接口（大写类名当接收者的静态/工具类调用 `ReconBillConverter.toDifferenceResp(…)` 也算本类）（`ideContractNames` 把实现类与其接口都算作 owner，所以实现方法也能找到持有接口的调用方），Java 文件限定；实现方按 `implements 接口` 找类，再在类里找该方法的声明。分节标题都带「（文本匹配）」，不冒充语义结果；三条查询全部失败时提示 `lspFailed`，不再谎报「没有已知调用点」
- **未装 LSP 的引导页**：进入代码工作区时打 `/dsh-ide/doctor`，`ctx.lsp` 没挂载就弹「代码导航未就绪」（列出管道包版本、服务器、JetBrains 授权三步 + 重新检测）；授权在服务器进程内，插件只引导不登录
- **Code Vision**：可见的**方法**声明行尾显示「N 个用法 · M 个实现」和该行最后提交人（`simon · 2026/11/3`）；只认类体层级（缩进 ≤4）的方法声明，字段与局部变量都不会出现；计数用 2 次 LSP 查询、作者用 1 次 `git blame`，都按文件版本缓存，滚动不重查；LSP 不可用时只显示作者，失败的查询不写缓存（不会显示假的 0）

### 4.3 搜索
- **Search Everywhere**：双击 Shift、工具栏放大镜、或快捷键（桌面 `⌘I` 类默认由设置里的绑定决定；Web 默认 `⌥⌘I`）打开，六分类（所有 / 类 / 符号 / 文件 / 文本 / 操作），**默认「所有」**——`类` = 文件即类（`ideFqnOf` 出全限定名）；`符号` = 声明形状的 ripgrep 前缀搜索（`ideSymbolPattern`：类/接口/枚举/record、字段、方法、常量、`function/const/def`），**是文本启发式不是符号索引**，局部变量可能混入；`所有` = 类 → 符号 → 文件（非源码）→ 文本（**含源码文件**，仅去掉与符号行完全相同的行）→ 操作；**结果按匹配度排序**（符号 `ideSymbolRank`、文件 `ideFileRank`、文本 `ideMatchRank`、命令 `ideActionRank`）
- 样式用 DSH 菜单 token；`⌘P` 聚焦文件树筛选框

### 4.4 与对话联动
- 用 DSH 自带的「已编辑 N 个文件」卡片即可：**点文件行**直接进本插件工作区（见 4.1 的拦截项）；插件不再渲染自己的改动卡片（原 `turnTail` 卡片已删除，`58-turn.js` 随之移除）

### 4.5 设置（设置 → 通用设置 → 代码工作区设置）
- **快捷键**（7 条，全部可改，点「修改」直接按新键）
- **基础设置 → 字号**：代码字号（默认 12.5）、文件树字号（默认 14.5），10–24px 步进 0.5，行高按比例联动

### 4.6 快捷键（唯一登记处 `IDE_SHORTCUTS`）

| id | 类型 | 默认 |
|---|---|---|
| `dsh-ide-window.toggle` | key | 桌面 `⌘2` / Web `⌥⌘I` |
| `dsh-ide-window.back-to-chat` | key | 桌面 `⌘1` / Web `⌥⌘U` |
| `code-workspace.search-everywhere` | sequence | 双击 `Shift`（窗口 400ms） |
| `code-workspace.file-search` | key | `⌘P` |
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
5. **改动列表用官方卡片**：插件只拦截它的文件行跳工作区，不再自己渲染卡片，也不再解析 `changes.summary`（少一处与 Host 内存态耦合的逻辑）。
6. **状态放 store、结果缓存到模块级**。切到代码工作区会卸载对话组件，`useState` 会丢；`ideTurnStates` / `ideSummaryRequests` 是为此存在的。
7. **设置项内联展开，不弹窗**。`shell.overlay` 的层级低于设置弹窗，弹窗会被盖住。

---

## 六、怎么开发与验证

```bash
cd ~/dev/dsh-ide-window

# 改完源码后必须构建（client.js 要一起提交，别人安装时不会跑构建）
node build.mjs && node --check client.js

# 全量测试（三段：VM 夹具 212 项 + 归属推断 + 真实 ~/.m2 jar）
npm test

# 本体完整性（签名 + app.asar 哈希基线 + 可疑新文件）
./check-dsh-untouched.sh
```

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
| `getBaseCurrency` 找不到定义 | 泛型接收者没解析出基类 | `ideChainBase` / `ideGenericArgument` 要容忍 `org.mockito.ArgumentCaptor<T>` |
| 跳转成功却报 `outcome is not defined` | 解构时只取 `locations`，后面又用 `outcome.ms` | 接住整个返回值；**这类错误测不到，必须给跳转逻辑写桩测试** |
| 注解点不动 | 分词把 `@X` 当成一个 `iw-ann` 运行，只有普通标识符可点击 | `ideSymbolOfRun()` 去 `@`、取简单名、算列偏移 |
| 切到代码工作区再回来卡片消失 | 组件卸载丢 `useState` | 结果缓存到模块级 Map |
| `plugins/...client.js?jsrev=… 404` | 我重建了 bundle，已开窗口拿的是旧 rev | 让用户 `⌘R` 或重启；批量 URL 里一个过期整批 404（连官方包也被连坐） |
| 设置页弹窗看不见 | `shell.overlay` 层级低于设置弹窗 | 内联展开 |
| 测试提取器截断箭头函数 | 在参数表 `)` 处就判定结束 | 只在 `}`/`]` 收尾 |

---

## 八、已知限制 / 待办

1. **DSH 重启后历史轮次没有改动摘要**（Host 内存态，官方卡片同样消失）——这是 DSH 自身行为，插件不做补偿。
2. **「添加到智能体上下文」是降级实现**：复制 `@相对路径` 并提示粘贴；DSH 未开放插件的对话草稿插入 API。
3. **分享前待办**（用户已知，尚未做）：
   - 包名 `@local/dsh-ide-window` 建议改成唯一 scope（如 `@simons-jiang/dsh-ide-window`）
   - 补 `LICENSE`（package.json 已声明 MIT 但无文件）
   - ~~加 `engines.dsh` 版本约束~~（已加，锁 `0.2.2-rc.3`）
4. **每次改 `src/` 都要重新构建并提交 `client.js`**，否则别人装上跑的是旧代码。
5. 插件需要 `webServer` 服务：在没有 web 服务的 profile 里会显示 `pending (waiting for service: webServer)`，属正常。

---

## 九、文件地图（找东西用）

```
index.js                      宿主：8 条路由 + jar ZIP 解析 + git 状态/差异/blame/kinds
client.js                     构建产物（提交）
build.mjs                     拼接 + 注入校验（禁止未声明的 ide* 辅助函数）
cordis.patch.yml              profile 插入项
locale/zh.json, en.json       UI 文案（165 键）+ 插件展示信息
src/client/05-shortcut-registry.js   ★ 快捷键唯一登记处
src/client/10-core.js         store / 偏好 / 标签页 / 视图持久化
src/client/30-code.js         代码视图 + 跳转 + 右键菜单挂载
src/client/59-gesture-settings.js  设置分区 + 标签页菜单组件
src/client/90-apply.js        全部注册 + 入口
test/harness.mjs              VM 夹具测试（当前 212 项断言）
test/inference.mjs            归属推断（bean 字段）
test/maven.mjs                真实 ~/.m2 jar 端到端
check-dsh-untouched.sh        本体完整性自检
restore-profile.sh            恢复 profile 到可用状态
start-test-instance.sh        起独立自测实例（固定端口 + 复用本机账号，不再弹登录框）
README.md                     面向使用者的说明（功能/手势/安装）
```

---

## 十、跟用户协作时的偏好（重要）

- 每次回复**开头先说「你好，simon」**。
- 一次只做**一件明确的事**，做完给「改了什么 / 怎么验证的 / 还差什么」。
- **不要**自行提交、不要自行改无关模块。
- 用户会指出「这个 UI 很突兀」「按道理应该有…」——这类反馈意味着要**对齐既有设计语言**或**补齐预期行为**，不要辩解。
- 交付前自查：`npm test` 全绿 + `./check-dsh-untouched.sh` 通过 + UI 截图/实测，缺一项就不算完成。

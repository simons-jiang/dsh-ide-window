# intellij-server 使用与接口文档

> **适用版本**：`ILS-271.2085.0`（产品版本 `2027.1`），即本机
> `~/.dsh/lsp-bin/intellij-server-2027.1`。
>
> **证据来源**（都在本机可复核，本文不写没验证过的东西）：
> 1. `bin/intellij-server --help`、`license <cmd> --help` 的全量输出（附录 A）；
> 2. `product-info.json`、`build.txt`、`bin/intellij-server.vmoptions`、`bin/idea.properties`；
> 3. **`bin/warmup.py`** —— JetBrains 自己放在包里的参考客户端，握手细节以它为准；
> 4. `~/Library/Logs/JetBrains/intellij-server2027.1/intellij-server.log` 的真实运行日志；
> 5. `license status --json` 的真实输出；
> 6. 一次 stdio 握手实测（含失败响应）。
>
> JetBrains **没有公开发布 intellij-server 的手册站**（只有 VS Code 扩展页与博客公告），
> 所以本文以这个 build 的实际行为为准，不引用二手描述当规范。

---

## 0. 一页速查

| 想干什么 | 命令 |
|---|---|
| 看版本 | `bin/intellij-server --version` → `271.2085.0` |
| 看授权 | `bin/intellij-server license status`（加 `--json` 给程序读） |
| 登录授权 | `bin/intellij-server license login --browser` |
| 消费掉试用 | `bin/intellij-server license trial` |
| 换账号 | `license reset --account` → 再 `login` |
| 跑成语言服务器（给编辑器用） | `bin/intellij-server --stdio --eula=<hash> --system-path=<dir>` |
| 跑成常驻服务（多客户端复用） | `bin/intellij-server --socket=127.0.0.1:9999 --multi-client --port-file=<path>` |
| 预热索引 / 导出工作区模型 | `python3 bin/warmup.py <项目目录> <索引目录> --dump-workspace` |
| 看日志 | `~/Library/Logs/JetBrains/intellij-server2027.1/intellij-server.log` |

---

## 1. 它是什么

JetBrains 把 IntelliJ 引擎做成了**独立运行的语言服务器**（JetBrains 于 2026-08 发布，VS Code 扩展
ID 为 `JetBrains.intellij-server`；抢先版免费、每个新版本重置 30 天评估期，正式后需要
IntelliJ IDEA Ultimate 授权 —— 这条来自第三方报道，官方页面未逐条核实）。

三个必须分清的概念：

| | IntelliJ IDEA 桌面版 | intellij-server |
|---|---|---|
| 形态 | GUI 应用 | 无头 JVM，`-Djava.awt.headless=true`，`product.mode=language_server` |
| 入口 | `IntelliJ IDEA.app` | `bin/intellij-server`（自带 JBR 25） |
| 协议 | — | LSP（JSON-RPC over stdio 或 TCP） |
| 配置目录 | `IntelliJIdea*` | `intellij-server2027.1` |
| 授权 | 桌面授权 | **同一套 JetBrains 授权体系，但独立存储**（`.../IntelliJServer/intellij-server.key`） |

### 关键结论（做集成时最容易踩）

1. **它不是 IDEA.app 的子进程**，不读 IDEA 的 `vmoptions`，也**不吃**给 IDEA 打的补丁；
   它的启动参数完全由调用方（本项目的 `cordis.patch.yml`）决定。
2. 授权状态**缓存在服务器进程里**：改完授权必须**重启服务器**（对本项目而言就是完全退出 DSH）。
3. 未授权时服务器**照常启动、照常完成 initialize**，但每个 feature 请求都被拒，返回
   `-32802`。所以「连上了」不等于「能用」。

---

## 2. 安装布局

```
intellij-server-2027.1/
├── bin/
│   ├── intellij-server          启动器（Mach-O / .exe / .bat）
│   ├── intellij-server.vmoptions 默认 JVM 参数（-Xmx2048m、headless、product.mode 等）
│   ├── idea.properties          平台路径与文件大小上限（intellisense 2500 KB / 打开 20000 KB）
│   ├── lsp-router               把一个 LSP 编辑器接到「该工作区对应的服务器」上
│   ├── warmup.py                ★ 官方参考客户端（见 3.7）
│   └── restarter                自更新用的重启器
├── jbr/                         自带 JetBrains Runtime（Java 25）
├── lib/                         平台 jars（含 fleet.lsp.protocol.jar）
├── plugins/                     34 个插件：java.lsp / kotlin.lsp / spring.lsp / properties.lsp
│                                / bazel.lsp / json / xml / lombok / mcp / junit / testng …
├── modules/                     模块描述符
├── license/                     JetBrains 授权相关资源
├── EULA.txt                     终端用户协议（`--eula` 传的是它的哈希）
├── build.txt                    ILS-271.2085.0
└── product-info.json            产品标识与启动描述
```

`product-info.json` 里值得记的字段：`productCode: ILS`、`dataDirectoryName: intellij-server2027.1`
（**决定日志/配置目录名**）、`minRequiredJavaVersion: 25`、`launch[].javaExecutablePath:
jbr/Contents/Home/bin/java`。

---

## 3. 使用文档（CLI）

### 3.1 三种进程模式

| 模式 | 开关 | 行为 |
|---|---|---|
| **stdio**（本项目用这个） | `--stdio` | 在当前进程的 stdin/stdout 上跑 LSP。编辑器自己 spawn 一个服务器，一对一。 |
| **server** | 默认（不传 `--stdio`/`--client`） | 监听 `--socket`（默认 `127.0.0.1:9999`），可有多个客户端连入。 |
| **client** | `--client` | 不新建服务器，作为客户端连到 `--socket` 指向的服务器。 |

两个常被忽略但很实用的开关：

- `--multi-client`：不传时，**第一个客户端断开就关服**；要让多个编辑器/多个窗口复用同一台服务器，必须加上。
- `--idle-timeout=10m`：没有客户端连接这么久就自动退出（默认关）。
- `--port-file=<path>`：把实际绑定的端口写进文件，客户端读文件找服务器（端口 0 也能用）。

多编辑器共用的标准做法是 **`lsp-router`**：

```
编辑器 --stdio--> lsp-router --启动/复用--> intellij-server（每个工作区一台）
```

`lsp-router` 自己的参数：`--server-launcher <path>`（没有服务器服务该工作区时启动哪个）、
`--system-path`（默认落在缓存根下、按工作区命名）、`--workspace-id`（不传则取
`initializationOptions.workspaceId`，再退到 root）；后续 `--` 之后的参数原样透传给服务器。
环境变量 `DEV_PORT` 让它只连已监听的本机端口、绝不自己拉起服务器（开发用）。

### 3.2 参数全表

| 参数 | 说明 |
|---|---|
| `--stdio` | stdio 模式。不传则走 server 模式（见 `--socket`） |
| `--client` | 客户端模式，连到 `--socket` 的服务器 |
| `--socket=<value>` | 服务器模式监听地址，默认 `127.0.0.1:9999` |
| `--port-file=<path>` | 把绑定的 TCP 端口写到此文件，供客户端发现 |
| `--system-path=<path>` | 该服务器的 config + system 目录 + 锁文件。**一台服务器独占一个**，第二台要用另一个路径。索引数据库不在这里（在用户缓存目录，或客户端 `indexDir` 指定的位置） |
| `--idle-timeout=<value>` | 无连接这么久后关服，如 `10s`、`5m`。默认关 |
| `--multi-client` | 多客户端模式；不传则首个客户端断开即关服 |
| `--log-level=<value>` | 全局日志级别：`TRACE/DEBUG/INFO/WARNING/ERROR/OFF/ALL` |
| `--log-category=<value>` | 按类目设级别（`category:LEVEL`），可重复；显式参数优先于系统属性 |
| `--data-sharing=<value>` | 遥测：`full`（用量统计 + 完整错误上报）/ `anonymous`（用量 + 脱敏错误）/ `test`（只落盘不外发）/ `none`（都不）。**默认 none** |
| `--region=<value>` | 产品条款与数据处理区域：`africa/americas/apac/china/europe/middle_east/oceania` |
| `--ca-certificate=<value>` | 额外受信 CA（PEM/DER），可重复；环境变量版本是 `:` 分隔；未设时读 `NODE_EXTRA_CA_CERTS` |
| `--eula=<text>` | 已接受的 `EULA.txt` 哈希。**捆绑发行版首启必填**，接受后记在用户+机器上；`-Dintellij.server.eula.persistence=false` 可禁用记忆 |
| `--license-key=<text>` | 本次运行的授权文本（等价 `INTELLIJ_SERVER_LICENSE`）。只驻内存、不写授权存储，且**权威**：设了就忽略其他来源 |
| `--license-key-file=<text>` | 授权文本文件路径（等价 `INTELLIJ_SERVER_LICENSE_FILE`）。`--license-key` 优先；文件不可读/无效则**未授权** |
| `--license-server=<text>` | JetBrains License Server（FLS）URL，启动时取浮动授权（等价 `JETBRAINS_LICENSE_SERVER`） |
| `--show-eula` / `--reset-eula` | 打印 / 忘记 EULA 接受记录 |
| `--version` | 打印版本 |
| `-h, --help` | 帮助 |

### 3.3 环境变量

| 变量 | 用途 | 坑 |
|---|---|---|
| `IJ_JAVA_OPTIONS` | **服务器 JVM 的额外参数**，空格分隔，启动器在起 JVM 前读取 | 不是命令行参数，`intellij-server -Dfoo=bar` 会报 `no such option` |
| `INTELLIJ_SERVER_LICENSE` | 直接注入授权文本 | 权威且只驻内存；此时除 `status` 与 `reset --account` 外，其他授权动词拒绝执行 |
| `INTELLIJ_SERVER_LICENSE_FILE` | 授权文本文件 | 同上；`INTELLIJ_SERVER_LICENSE` 优先 |
| `JETBRAINS_LICENSE_SERVER` | FLS 授权服务器 URL | 设了之后每次启动都重连，`reset` 会拒绝执行 |
| `NODE_EXTRA_CA_CERTS` | 未被 `--ca-certificate` 覆盖时作为 CA 来源 | — |

### 3.4 EULA

`--eula` 传的是 `EULA.txt` 的哈希（本项目 patch 里写死为 `cd82e6cdaf2790f1`）。
这是**捆绑发行版的首启门槛**：没传就起不来；接受一次后记在用户+机器上，后续可省略。
换 build 时哈希会变，需要重新接受。想复现「首次启动」用 `--reset-eula`。

### 3.5 日志与缓存路径

| 内容 | 路径（macOS） |
|---|---|
| 日志 | `~/Library/Logs/JetBrains/intellij-server2027.1/intellij-server.log`（macOS 实测；Windows 按 `dataDirectoryName` 推断在 `%LOCALAPPDATA%\JetBrains\intellij-server2027.1\log`，未实机核对） |
| 索引/工作区缓存 | `~/Library/Caches/JetBrains/IntelliJServer/workspaces/<hash>` |
| 授权存储 | `~/Library/Application Support/JetBrains/IntelliJServer/intellij-server.key` |
| 改日志目录 | `IJ_JAVA_OPTIONS=-Didea.log.path=/some/dir` |

> **受限环境必须改日志目录**：日志写在 `~/Library/Logs` 下，如果启动它的进程没有该目录的写权限
> （沙箱、容器、权限收紧的 CI），服务器会在**打印任何有用信息之前**就崩在
> `RollingFileHandler` 上：
>
> ```
> java.nio.file.FileSystemException: ~/Library/Logs/JetBrains/.../intellij-server.log: Operation not permitted
> ```
>
> 本项目宿主就是这么修的：跑 `license` 命令时给 JVM 加 `-Didea.log.path=<tmpdir>`。

### 3.6 JVM 调优

默认 `-Xmx2048m`（见 `bin/intellij-server.vmoptions`）。大工程索引吃紧时：

```bash
IJ_JAVA_OPTIONS="-Xmx4096m" ~/.dsh/lsp-bin/.../bin/intellij-server --stdio ...
```

其他现成可调项：`-Didea.log.path`（日志目录）、`-Didea.caches.path`（缓存目录）、
`-Dintellij.server.license.dir`（授权存储位置）、`-Dintellij.server.eula.persistence=false`、
`-Didea.log.debug.categories=...` / `trace` / `all`（按类目开日志）。

### 3.7 `bin/warmup.py`：官方参考客户端（重要）

这个脚本是**包里唯一一份「怎么正确跟它对话」的样例**，把它当接口文档读：

```bash
python3 bin/warmup.py <项目目录> <索引目录> \
  --eula cd82e6cdaf2790f1 \
  --log-level INFO \
  --build-tool maven \
  --dump-workspace \
  --timeout 600
```

它做的事，正好是一条完整的会话：

1. 以 `--stdio --system-path <索引目录>` 起服务器（`--eula` / `--log-level` 可透传）；
2. 发 `initialize`，`initializationOptions = { indexDir: <索引目录>, buildTools: { "<项目 file:// URI>": "maven" } }`，
   客户端能力只声明 `window.workDoneProgress`；
3. 收到 `initialize` 响应后发 `initialized`；
4. 打印服务器发来的**每一条通知**，直到收到 `intellij/ready-for-test`（索引建完并刷盘）；
5. 指定 `--dump-workspace` 时，再发 `workspace/executeCommand` → `exportWorkspace`，
   把工作区模型写成 `<项目目录>/workspace.json`；
6. 走 `shutdown` → `exit` 优雅关闭；
7. JVM 参数用 `-J<flag>` 透传（JDK 工具惯例，如 `-J-Xmx4g`），内部转成 `IJ_JAVA_OPTIONS`。

---

## 4. 授权

### 4.1 子命令

| 命令 | 作用 | 关键参数 |
|---|---|---|
| `license status` | 打印本机授权状态 | `--json`（输出 `LicensingState` 线格式）、`--verbose`（打印本命令自己的授权日志） |
| `license login` | 用 JetBrains Account 登录并下发授权 | `--browser`（本地浏览器 + loopback）/ `--code`（打印 URL，从 stdin 读码；SSH 无浏览器时自动选）/ `--timeout=5m` |
| `license activate <value>` | 用激活码 / 密钥文件 / 授权服务器 URL 激活 | `<value>` 可为激活码、密钥文件路径、FLS URL，或 `-` 从 stdin 读 |
| `license trial` | 开一个匿名试用 | — |
| `license reset` | 注销并移除本机的服务器授权 | `--account` 同时登出 JetBrains Account（同账号的桌面 IDE 一起登出） |

### 4.2 授权来源优先级（高 → 低）

```
--license-key / INTELLIJ_SERVER_LICENSE        （内存，权威，设了就不看别的）
--license-key-file / INTELLIJ_SERVER_LICENSE_FILE
--license-server / JETBRAINS_LICENSE_SERVER    （FLS 浮动授权）
license login / activate 写入的本地存储         （<store>/intellij-server.key）
无 → 未授权（请求被拒 -32802）
```

### 4.3 真实输出（本机，2026-11）

人读格式：

```
No valid license found
License: not licensed, feature requests are parked (NoLicenseDiscovered)
Account: <display name> <you@example.com>
Store: /Users/<you>/Library/Application Support/JetBrains/IntelliJServer/intellij-server.key
```

`--json`：

```json
{
  "jbaLicensingState": {
    "authenticationStatus": "Authenticated",
    "accountInfo": { "displayName": "<display name>", "email": "<you@example.com>" },
    "availableSubscriptions": []
  },
  "licenseServerFlowState": { "kind": "notConfigured" },
  "featuresDeclined": true,
  "parkedReason": "StartedUnlicensed"
}
```

读这个 JSON 时注意：**人读那行 `No valid license found` 会先打到 stdout**，所以消费 `--json`
不能直接 `JSON.parse(stdout)`，要从第一个 `{` 开始截。

### 4.4 授权闸门状态机（日志实证）

```
启动 → License gate: Licensed
     → License gate: Parked(reason=StartedUnlicensed)     # 启动时没有授权
     → 登录后复查 → Parked(reason=NoLicenseDiscovered)     # 账号登了，但这个账号没有可用授权
```

- `StartedUnlicensed`：进程起来时没有任何授权源。
- `NoLicenseDiscovered`：账号已登录，`availableSubscriptions` 为空 —— **缺的是授权，不是登录**。
- 仓库里还留有一条实证：`license trial` → 「You already have an active IntelliJ IDEA Ultimate
  2026.2 trial」 —— 试用是按账号计的，用过就没有了。

### 4.5 授权生效的唯一姿势

```bash
~/.dsh/lsp-bin/*/bin/intellij-server license login --browser
# 登录并确认账号下有 IDEA Ultimate 授权
# 然后：完全退出 DSH，重新打开
```

**为什么必须重启**：授权闸门在服务器进程里缓存（见 4.4 的 gate 日志）。
`license status` 是**另起一个 JVM** 读存储，它的结果比运行中的服务器新 —— 这就是
「status 说好了，但导航还报 -32802」的全部原因。

---

## 5. 接口文档（LSP）

### 5.1 传输层

stdio 模式是标准的 LSP 分帧：

```
Content-Length: <字节数>\r\n
\r\n
<UTF-8 JSON 体>
```

`Content-Length` 是**字节数**不是字符数（中文/emoji 会算错）。server 模式的帧格式相同，只是走 TCP。

### 5.2 会话生命周期

```
客户端                                    服务器
  │ initialize ───────────────────────────>│   （可能先发若干 window/logMessage）
  │<───────────────────── result/error ────│
  │ initialized ──────────────────────────>│
  │                                        │  ⋯ window/logMessage、$/progress、
  │<──────────────── intellij/ready-for-test│  window/workDoneProgress/create …
  │ textDocument/definition 等 ───────────>│
  │<──────────────────────── locations ────│
  │ shutdown ─────────────────────────────>│
  │ exit ─────────────────────────────────>│
```

要点：

- **`initialize` 之前没有任何请求是合法的**；`exit` 之后进程退出。
- `processId` 可以传 `null`（DSH 的提供方就这么做：服务器不该监视宿主 PID）。
- 服务器**在 initialize 阶段就会失败**，见下面两个实测错误。

### 5.3 `initialize` 参数（本项目相关字段）

```jsonc
{
  "processId": null,
  "clientInfo": { "name": "dsh-ide-window" },
  "rootUri": "file:///path/to/project",
  "rootPath": "/path/to/project",
  "workspaceFolders": [{ "uri": "file:///path/to/project", "name": "project" }],
  "capabilities": {
    "window": { "workDoneProgress": true },
    "textDocument": { "definition": { "linkSupport": true } }
  },
  "initializationOptions": {
    "indexDir": "/path/to/index",          // 索引/缓存落点，不给就落到用户缓存目录
    "buildTools": { "file:///path/to/project": "maven" },  // 导入器：maven / gradle / "*" / ""
    "workspaceId": "some-stable-id"        // 工作区身份，lsp-router 用它复用服务器
  }
}
```

| 选项 | 作用 | 不给会怎样 |
|---|---|---|
| `indexDir` | 索引数据库目录 | 落到 `~/Library/Caches/JetBrains/IntelliJServer/workspaces/<hash>` |
| `buildTools` | 指定用哪个构建工具导入项目（决定依赖/模块模型） | 服务器自行判断（相当于 `"*"`）；Maven 工程建议显式给 `maven` |
| `workspaceId` | 工作区稳定标识，多客户端复用时靠它对齐 | 用 root 推断 |

### 5.4 服务器 → 客户端

| 方向 | 消息 | 说明 |
|---|---|---|
| 通知 | `window/logMessage` | 启动横幅、System Info、阶段信息都走这里（`type: 3` = info）。**排错第一现场** |
| 通知 | `intellij/ready-for-test` | 索引建完并刷盘。这是 JetBrains 自定义通知，warmup.py 靠它判断「可以开始查了」 |
| 通知 | `$/progress` | 索引进度（客户端能力里声明了 `workDoneProgress` 才会发） |
| 请求 | `window/workDoneProgress/create`、`workspace/configuration` 等 | 参考客户端对**所有**服务器发起的请求统一 `result: null`。DSH 的提供方则用 `configuration` 静态配置回答、并**拒绝** `workspace/applyEdit`（绝不代改文件、不执行命令） |
| 通知 | `textDocument/publishDiagnostics` | 本项目不消费（LSP 只用于导航，不做诊断） |

### 5.5 自定义命令

| 命令 | 参数 | 作用 |
|---|---|---|
| `workspace/executeCommand` → `exportWorkspace` | `["<项目目录>"]` | 把解析后的工作区模型写成 `<项目目录>/workspace.json`，用于核对「服务器到底认到了什么模块/依赖」 |

### 5.6 本项目实际只用到 4 个操作

`ctx.lsp` 的封闭词汇，宿主 `index.js` 里的 `OPERATIONS`：

| 操作 | LSP 方法 | 备注 |
|---|---|---|
| `goToDefinition` | `textDocument/definition` | `Location` 或 `LocationLink`（取 `targetUri` + `targetSelectionRange`） |
| `findReferences` | `textDocument/references` | **始终包含声明**（影响分析不漏定义） |
| `goToImplementation` | `textDocument/implementation` | 接口 → 实现 |
| `hover` | `textDocument/hover` | `MarkupContent` 或 `MarkedString`，渲染成文本 |

不做的：重命名、格式化、code action、诊断、符号列表。**所以别指望从这条链路拿到 `workspace/symbol`** ——
本插件的 Search Everywhere 是 ripgrep 文本启发式，不是符号索引。

### 5.7 坐标与编码

- LSP 线上坐标：**0 基行、0 基字符**，字符单位是 **UTF-16 code unit**（不是字节、不是码点）。
- 插件内部：宿主 `/dsh-ide/lsp` 返回 **1 基行 + 0 基字符**（编辑器直接可用）。
- 编码协商：客户端声明 `utf-16`；服务器**省略** `positionEncoding` 时按 `utf-16` 处理，声明别的值即失败
  （`LSP_UNSUPPORTED_ENCODING`）。

### 5.8 错误码

**实测到的服务器自定义码**（JSON-RPC 错误响应里的 `code`）：

| code | 文本 / 场景 | 处置 |
|---|---|---|
| `-32802` | `Request refused: no active JetBrains license` | 授权问题，见第 4 节；**不是**代码问题 |
| `-32803` | `<path>: Operation not permitted` | 服务器要写的目录没权限（本项目实测就是 `~/Library/Caches/.../workspaces/<hash>`）。受限环境要放行缓存目录，或改 `indexDir` |
| `-32601` | `Method not found` | 该操作这个 build 不支持 → 本项目会记「服务器不支持」并改走文本兜底 |
| `-32700` / `-32600` / `-32602` / `-32603` | 解析 / 非法请求 / 参数错 / 内部错误 | 标准 JSON-RPC |

**DSH 侧 `LspError` 的稳定 code**（消费方按 `code` 路由，别解析 message）：

| code | 含义 |
|---|---|
| `LSP_UNAVAILABLE` | 没有提供方处理该扩展名 / seam 未挂载 |
| `LSP_UNSUPPORTED_OPERATION` | 服务器没声明这项能力 |
| `LSP_UNSUPPORTED_ENCODING` | 位置编码不是 utf-16 |
| `LSP_MALFORMED_RESPONSE` | 返回的载荷不合规（范围/位置坏了） |
| `LSP_SERVER_ERROR` | 服务器返回 JSON-RPC 错误（**`-32802` 就走这里**） |
| `LSP_SPAWN_FAILED` / `LSP_SERVER_EXITED` / `LSP_PROTOCOL_ERROR` / `LSP_MESSAGE_TOO_LARGE` | 进程或流故障 |
| `LSP_FILE_OUTSIDE_WORKSPACE` | 查询源文件在规范工作区之外 |

### 5.9 最小可运行客户端（30 行）

```python
import json, os, subprocess

server = os.path.expanduser("~/.dsh/lsp-bin/intellij-server-2027.1/bin/intellij-server")
cmd = [server, "--stdio", "--eula=cd82e6cdaf2790f1", "--system-path=/tmp/ils-index",
       "--data-sharing=none", "--log-level=WARNING"]
env = dict(os.environ, IJ_JAVA_OPTIONS="-Didea.log.path=/tmp/ils-log")
p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)

def send(msg):
    body = json.dumps(dict(msg, jsonrpc="2.0")).encode()
    p.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body); p.stdin.flush()

def recv():
    n = 0
    while True:
        line = p.stdout.readline()
        if line in (b"\r\n", b"\n"): break
        if line.lower().startswith(b"content-length:"): n = int(line.split(b":")[1])
    return json.loads(p.stdout.read(n))

send({"id": 1, "method": "initialize", "params": {
    "processId": None, "rootUri": "file:///tmp/proj", "capabilities": {},
    "initializationOptions": {"indexDir": "/tmp/ils-index"}}})
print(recv())                      # 未授权时这里就是 -32802 / -32803
```

---

## 6. 在 dsh-ide-window 里的接线

### 6.1 链路

```
浏览器（编辑器 UI）
  │  POST /dsh-ide/lsp   （本项目宿主 index.js）
  ▼
ctx.lsp  ← @deepseek-ai/dsh-lsp     能力 seam，按扩展名选提供方
  ▼
@deepseek-ai/dsh-lsp-stdio           spawn 服务器、翻译 JSON-RPC、临时打开/关闭文档
  ▼
intellij-server --stdio              JetBrains 引擎（本机 JVM）
```

### 6.2 `cordis.patch.yml` 片段

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

可选加固（本文档建议）：

```yaml
            initializationOptions:
              indexDir: /Users/<you>/.dsh/lsp-data/intellij-index
              buildTools: { "file:///path/to/project": "maven" }
```

Windows 换成 `...\bin\intellij-server.bat`（`.bat`/`.cmd` 必须带 `shell: true`，本项目已用
`platform.needsShell()` 处理，否则 Node 抛 EINVAL 被吞成「点了没反应」）。

### 6.3 `dsh-lsp-stdio` 配置字段

| 字段 | 默认 | 含义 |
|---|---|---|
| `command` | 必填 | 可执行文件，绝对路径或从 PATH 解析；不起 shell |
| `extensionToLanguage` | 必填 | 小写带点扩展名 → LSP language id |
| `args` | `[]` | 透传参数 |
| `env` | `{}` | 额外环境变量（`*KEY*/*PASSWORD*/*SECRET*/*TOKEN*` 与 `DSH_*` 不会转发） |
| `initializationOptions` | `null` | 透传给 `initialize`（本节 6.2 的加固项就是它） |
| `configuration` | `null` | 静态回答 `workspace/configuration` |
| `maxMessageBytes` | 16 MB | 单条 framed 消息上限 |
| `maxStderrBytes` | 1 MB | 保留的 stderr 尾部 |
| `maxDocumentBytes` | 4 MB | 可打开源文件上限 |
| `shutdownTimeoutMs` / `killGraceMs` | 5000 / 2000 | 优雅关闭预算、取消与 SIGTERM→SIGKILL 宽限 |

行为要点：每个规范工作区一台**池化进程**；每次查询 `didOpen`（全文）→ 请求 → `didClose`，
**不保留文档状态**，所以服务器看到的永远是磁盘上的最新字节；同一工作区查询串行、不同工作区并行；
传输故障会在新进程上重试一次。

### 6.4 `POST /dsh-ide/lsp` 契约

请求：

```jsonc
{
  "operation": "goToDefinition",        // goToDefinition | findReferences | goToImplementation | hover
  "filePath": "src/main/java/.../Foo.java",
  "workspaceRoot": "/abs/workspace",
  "position": { "line": 57, "character": 12 }   // 0 基行，0 基 UTF-16 字符
}
```

成功响应：

```jsonc
{ "ok": true, "value": { "kind": "locations", "locations": [
  { "path": "src/main/java/.../Bar.java", "uri": "file:///...", "line": 59, "character": 4 }
] } }
// hover：{ "ok": true, "value": { "kind": "hover", "hover": <规范化悬停> | null } }
```

失败响应：**HTTP 200 + `ok:false`**（这是故意的：seam 错误要保留自己的 code 给浏览器读）

```jsonc
{ "ok": false, "error": { "code": "LSP_SERVER_ERROR", "message": "… -32802 … (findReferences)" } }
```

其余边界：`operation` 不在四个里 → 400 `invalid-operation`；缺 `filePath`/`workspaceRoot` → 400
`invalid-arguments`；`ctx.lsp` 未挂载 → 503 `lsp-unavailable`。返回的 `path` 是**工作区相对 POSIX 路径**。

---

## 7. 排错对照表

| 现象 | 原因 | 处置 |
|---|---|---|
| 导航全部报 `-32802` | 服务器授权闸门是 Parked | 第 4 节；登录后**完全退出 DSH** |
| `license status` 说已授权，导航仍 `-32802` | 授权缓存在运行中的服务器进程内 | 重启 DSH（不是刷新页面） |
| `NoLicenseDiscovered` | 账号登录了，但该账号没有 IDEA Ultimate 授权 | 换有授权的账号，或 `login --browser` 后确认订阅 |
| `license trial` 失败：「already have an active … trial」 | 试用按账号，已用过 | 没有第二次 | 
| 进程秒退，栈里是 `RollingFileHandler` / `Operation not permitted` | `~/Library/Logs` 不可写 | `IJ_JAVA_OPTIONS=-Didea.log.path=/tmp/...` |
| `initialize` 返回 `-32803`，路径是 `~/Library/Caches/.../workspaces/<hash>` | 缓存目录不可写（沙箱/权限） | 放行缓存目录，或 `initializationOptions.indexDir` 指到可写位置 |
| 首启报 EULA 相关错误 | 没传 `--eula` 或哈希与 build 不匹配 | 传 `--eula=cd82e6cdaf2790f1`（换 build 需重新取值）；或 `--reset-eula` 复位 |
| 日志里有 `https.proxyHost=127.0.0.1` 警告 | JVM 被设了本地代理 | 影响不大；授权/网络异常时优先查它 |
| Maven 依赖解析不到、跳不进 jar | 没导入构建模型 | `initializationOptions.buildTools` 显式给 `maven`，或用 `exportWorkspace` 核对模型 |
| 多个窗口共用一个服务器时互相踢掉 | 没开 `--multi-client` | 加 `--multi-client`（或走 `lsp-router`） |

---

## 附录 A：CLI `--help` 原文

<details>
<summary>展开：top-level 帮助为逐字原文；license 子命令与 lsp-router 部分为要点摘录（完整输出见下）</summary>

```
Usage: intellij-server [<options>] [<command>] <command> [<args>]...

Options:
  --show-eula                Print the bundled EULA and exit
  --reset-eula               Forget the accepted-EULA record for this user and
                             machine and exit; the next launch requires
                             `--eula` again
  --version                  Print version and exit
  --socket=<value>           Socket for `intellij-server` connections. Default
                             is 127.0.0.1:9999
  --stdio                    Run `intellij-server` in stdio mode. If not set,
                             server mode will be used with a port specified by
                             `socket`
  --client                   Run `intellij-server` in client mode. If not set,
                             server mode will be used with a port specified by
                             `socket`
  --system-path=<path>       Path for the config, the system directory and the
                             lock of this server. One server owns it; another
                             server needs another path. Databases do not live
                             here: they go under the caches directory of the
                             user, or wherever a client's indexDir names.
  --port-file=<path>         Where to publish the bound TCP port. A client that
                             knows this path can find and connect to this
                             server. The client chooses the path, so the server
                             needs no rule for naming it.
  --idle-timeout=<value>     Shut a server down after this period with no
                             connected client (e.g. `10s`, `5m`). Off by
                             default.
  --log-level=<value>        Global log level. Supported values: TRACE, DEBUG,
                             INFO, WARNING, ERROR, OFF, ALL.
  --log-category=<value>     Per-category log level (category:LEVEL). Can be
                             repeated. Unspecified categories use the global
                             log level. The `idea.log.debug.categories`,
                             `idea.log.trace.categories`, and
                             `idea.log.all.categories` system properties add
                             comma-separated categories at those levels; pass
                             them through `IJ_JAVA_OPTIONS`. An explicit option
                             wins for the same category.
  --multi-client             Run `intellij-server` in multiclient mode. If not
                             set, server will be shut down after the first
                             client disconnects.
  --data-sharing=<value>     Telemetry level: full | anonymous | test | none.
                             'full' sends anonymous usage statistics and full
                             error reports; 'anonymous' sends anonymous usage
                             statistics and stripped error reports; 'test'
                             records anonymous usage statistics on disk but
                             sends nothing; 'none' sends nothing. None by
                             default.
  --region=<value>           Region for product terms and data processing
                             (africa, americas, apac, china, europe,
                             middle_east, oceania)
  --ca-certificate=<value>   A trusted CA certificate file (PEM or DER), in
                             addition to the ones the JVM and the operating
                             system provide. Can be repeated; the environment
                             variable takes a `:`-separated list.
                             `NODE_EXTRA_CA_CERTS` is read when unset.
  --eula=<text>              Hash of the bundled EULA (`EULA.txt`) that the
                             user has accepted. Required for bundled
                             distributions; the launcher passes the hash from
                             its bundle. An accepted hash is remembered for the
                             user and machine, so only the first launch
                             requires it
                             (`-Dintellij.server.eula.persistence=false`
                             disables the record). Ignored when running from
                             sources.
  --license-key=<text>       License key text for this server run; also the
                             `INTELLIJ_SERVER_LICENSE` environment variable.
                             Held in memory only, never written to the license
                             store, and authoritative: while set, no other
                             license source is considered.
  --license-key-file=<text>  Path to a file holding the license key text; also
                             the `INTELLIJ_SERVER_LICENSE_FILE` environment
                             variable. Same in-memory semantics as
                             `--license-key`, which wins when both are set; an
                             unreadable or invalid file leaves the server
                             unlicensed.
  --license-server=<text>    JetBrains License Server (FLS) URL to obtain a
                             floating license from at startup; also the
                             `JETBRAINS_LICENSE_SERVER` environment variable
  -h, --help                 Show this message and exit

Commands:
  license  Manage the `intellij-server` license without starting the server

Environment variables:

`IJ_JAVA_OPTIONS`: extra JVM options for the `intellij-server` process,
space-separated (e.g. `-Xmx4g -Dsome.property=value`). Read by the launcher
before the JVM starts, so it is not a command-line option.
```

```
Usage: intellij-server license status [<options>]
  Print the licensing state of this machine
Options:
  --json      Print the licensing state as JSON (the `LicensingState` wire object)
  --verbose   Also print this command's own licensing journal
  -h, --help  Show this message and exit

Usage: intellij-server license login [<options>]
  Sign in with a JetBrains Account and provision a license
Options:
  --code             Sign in with a manually pasted code: print the sign-in URL
                     and read the code from stdin. Auto-selected over SSH or
                     when no local browser is available.
  --browser          Sign in through the local browser and a loopback redirect
  --timeout=<value>  How long to wait for the sign-in to complete, e.g. 5m or 300s

Usage: intellij-server license activate [<options>] <value>
  Activate with a code, key file, or license server URL
Options:
  --code / --browser  License-server sign-in only (same semantics as login)
Arguments:
  <value>  An activation code, a license key file path, a license server URL,
           or `-` to read the key from stdin

Usage: intellij-server license trial [<options>]
  Start an anonymous trial

Usage: intellij-server license reset [<options>]
  Deactivate and remove this machine's server license
Options:
  --account   Also sign out of the JetBrains Account on this machine; desktop
              IDEs sharing the account are signed out too
```

`lsp-router --help`：

```
lsp-router - routes an LSP editor on stdio to the language server for its workspace

Usage:
  lsp-router --server-launcher <path> [-- <server argument>...]
  lsp-router --help

Options:
  --server-launcher <path>  The language server launcher to run when no server serves the
                            workspace yet. Not needed when DEV_PORT is set.
  --system-path <path>      The config, the system directory and the lock of the server this
                            router starts. Defaults to a directory under the cache root, named
                            after the workspace. One server owns it.
  --workspace-id <id>       The identity of the workspace. Without it the router takes the
                            workspaceId of initializationOptions, else the root. A flag that
                            differs from the option, and a blank id, refuse the start.
  --                        Every later argument goes to the server as it is.

Environment:
  DEV_PORT  Connect to a server already listening on this port of the loopback
            interface, and never start one. For development.
```

</details>

---

## 附录 B：参考链接

| 主题 | 链接 |
|---|---|
| LSP 规范（3.17） | <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/> |
| IntelliJ 平台 LSP 支持的能力清单（IDE 侧，可对照） | <https://plugins.jetbrains.com/docs/intellij/language-server-protocol.html> |
| IDEA 连接外部语言服务器（help） | <https://www.jetbrains.com/help/idea/language-servers.html> |
| VS Code 扩展（使用同一服务器的产品入口） | <https://marketplace.visualstudio.com/items?itemName=JetBrains.intellij-server> |
| intellij-server 发布背景（第三方报道，含授权模型） | <http://www.charlie27.com/2026/08/2026-08-05-jetbrains-%e8%ae%93-intellij-%e5%bc%95%e6%93%8e%e5%8c%96%e8%ba%ab-lsp-server%ef%bc%8cjava-kotlin-%e6%99%ba%e6%85%a7%e9%80%b2%e9%a7%90-vs-code-%e8%88%87-cursor/> |
| DSH 侧 seam 文档（本机安装） | `~/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-lsp/README.zh.md` |
| DSH 侧 stdio 提供方文档（本机安装） | `~/.dsh/profiles/desktop/node_modules/@deepseek-ai/dsh-lsp-stdio/README.zh.md` |
| 本项目对授权失败的处置 | `AGENTS.md` §4.2「JetBrains 授权（-32802）」、`README.md` §安装 |

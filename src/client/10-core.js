/**
 * Store, Host Remote face and code tokenizer for the code workspace.
 *
 * One store instance is created in `apply` and shared by every seat the plugin
 * registers (the centre panel, the sidebar entry and the floating conversation
 * card), so a click in the tree is the same selection the editor renders.
 *
 * File access goes through the shipped `workspaceFiles` Remote namespace — the
 * same one the built-in Files page uses — so this plugin adds no Host half:
 *
 *  - `list(sessionId, workspacePath, signal)`  speaks workspace-relative paths;
 *  - `read(sessionId, absolutePath, range, signal)` and
 *    `changes(sessionId, absolutePath, lifetime)` speak absolute paths.
 *
 * That is why the store keeps both the workspace root (absolute) and the
 * workspace-relative tree paths side by side.
 */

/** Locale namespace, shared with `locale/*.json`. */
const IDE_NS = 'dsh-ide-window'

/** Keyed main-panel id of the code workspace. */
const IDE_PANEL_ID = 'dsh-ide-window:code'

/** Preference key (panel geometry and view options). */
const IDE_PREFS_KEY = 'dsh-ide-window:v1'

/** Lines kept in one editor tab before the file counts as too large. */
const IDE_MAX_LINES = 6000

/** Bytes kept per editor tab. */
const IDE_MAX_BYTES = 900000

/**
 * Build the plugin's translator.
 *
 * The framework's `t` (from the `locale` registration option) is preferred, but
 * a locale id the plugin has no dictionary for makes it echo the key back. A
 * raw key in the UI is never acceptable, so the bundle's own dictionaries are
 * the guaranteed last resort: the active locale id from the locale service,
 * then the page language, decides between Chinese and English.
 */
function ideMakeTranslator(ctx, boundT) {
  const localeId = () => {
    try {
      const snapshot = ctx?.locale?.getSnapshot?.()
      if (typeof snapshot?.active === 'string' && snapshot.active !== '') return snapshot.active
    } catch (error) {
      void error
    }
    if (typeof document !== 'undefined' && typeof document.documentElement?.lang === 'string') {
      return document.documentElement.lang
    }
    return typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : ''
  }
  const dictionary = () => (/^zh/i.test(localeId()) ? IDE_TEXT_ZH : IDE_TEXT_EN)
  const translate = (key) => {
    if (typeof boundT === 'function') {
      const value = boundT(key)
      if (typeof value === 'string' && value !== '' && value !== key) return value
    }
    const table = dictionary()
    return table[key] ?? IDE_TEXT_EN[key] ?? key
  }
  return translate
}

/** Clamp a number into a range. */
function ideClamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/** Persisted preferences, tolerant of a corrupt or unavailable store. */
function ideReadPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(IDE_PREFS_KEY)
    if (typeof raw !== 'string' || raw === '') return {}
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Merge a partial preference document back into storage. */
/**
 * The configured Maven repository.
 *
 * The panel state lives inside the store factory, but the jar request is a plain
 * module function, so the current value is mirrored here on every change.
 */
let ideMavenRepoPref = ''

/** The repository the reader configured, or '' to let the Host resolve it. */
function ideMavenRepoOfState() {
  return typeof ideMavenRepoPref === 'string' ? ideMavenRepoPref : ''
}

function ideWritePrefs(patch) {
  try {
    const next = { ...ideReadPrefs(), ...patch }
    globalThis.localStorage?.setItem(IDE_PREFS_KEY, JSON.stringify(next))
  } catch {
    /* a browser with storage disabled simply forgets geometry */
  }
}

/**
 * The floating card's shipped size, and the bounds the settings page accepts.
 *
 * The width matches DSH's own conversation column (744px at the reference
 * viewport), so the card reads at the same measure as the chat behind it.
 */
const IDE_FLOAT_DEFAULT_WIDTH = 744
const IDE_FLOAT_DEFAULT_HEIGHT = 560
const IDE_FLOAT_MIN_WIDTH = 280
const IDE_FLOAT_MIN_HEIGHT = 220
const IDE_FLOAT_MAX_WIDTH = 1200
const IDE_FLOAT_MAX_HEIGHT = 900

/** The card's default size: the preference, clamped, or the shipped size. */
function ideFloatDefaultSize() {
  const prefs = ideReadPrefs()
  const width = Number(prefs.floatWidth)
  const height = Number(prefs.floatHeight)
  return {
    width: Number.isFinite(width)
      ? ideClamp(Math.round(width), IDE_FLOAT_MIN_WIDTH, IDE_FLOAT_MAX_WIDTH)
      : IDE_FLOAT_DEFAULT_WIDTH,
    height: Number.isFinite(height)
      ? ideClamp(Math.round(height), IDE_FLOAT_MIN_HEIGHT, IDE_FLOAT_MAX_HEIGHT)
      : IDE_FLOAT_DEFAULT_HEIGHT,
  }
}

/** How many navigation positions are remembered in each direction. */
const IDE_HISTORY_LIMIT = 50

/** Persisted panel view, so returning to the panel reopens what was open. */
const IDE_VIEW_KEY = 'dsh-ide-window:view'

/** Read the whole view map: workspace root → `{ tabs, activePath, expanded, … }`. */
function ideReadViewMap() {
  try {
    const raw = globalThis.localStorage?.getItem(IDE_VIEW_KEY)
    if (typeof raw !== 'string' || raw === '') return {}
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Write the view map back, tolerating an unavailable store. */
function ideWriteViewMap(map) {
  try {
    globalThis.localStorage?.setItem(IDE_VIEW_KEY, JSON.stringify(map))
  } catch {
    /* storage is a convenience; a full or denied store only loses restoration */
  }
}

/** Join an absolute directory and a workspace-relative path (POSIX result). */
function ideAbs(root, path) {
  const base = idePlatform.toPosix(root)
  if (path === '' || path === undefined || path === null) return base
  if (base === '') return idePlatform.toPosix(path)
  return `${base.replace(/\/+$/, '')}/${idePlatform.toPosix(path).replace(/^\/+/, '')}`
}

/**
 * Turn an absolute path (what the Host and the resource addresses speak) into a
 * workspace-relative one, so a reference can be matched against tree entries.
 *
 * @returns the relative path, or `null` when the path lies outside the root.
 */
function ideRelativeTo(root, path) {
  if (typeof path !== 'string' || path === '') return null
  const text = idePlatform.toPosix(path)
  const trimmedRoot = idePlatform.toPosix(root).replace(/\/+$/, '')
  if (trimmedRoot === '') return text.startsWith('/') ? null : text
  // Windows is case-insensitive (and the language server may hand back a lower
  // -case drive); the key folds that without changing the length, so the
  // relative path is still a slice of the original text.
  const key = idePlatform.pathKey(text)
  const rootKey = idePlatform.pathKey(trimmedRoot)
  if (key === rootKey) return ''
  if (key.startsWith(`${rootKey}/`)) return text.slice(trimmedRoot.length + 1)
  return idePlatform.isAbsolutePath(text) ? null : text
}

/** Split a path into its dimmed directory and the file name. */
function ideSplitPath(path) {
  const text = idePlatform.toPosix(path)
  const index = text.lastIndexOf('/')
  return index < 0 ? { dir: '', name: text } : { dir: text.slice(0, index + 1), name: text.slice(index + 1) }
}

/** Ancestors of a workspace path, shallowest first: `a/b/C.java` → `a`, `a/b`. */
function ideAncestorDirs(path) {
  const parts = idePlatform.toPosix(path).split('/')
  parts.pop()
  const dirs = []
  for (let index = 1; index <= parts.length; index += 1) {
    dirs.push(parts.slice(0, index).join('/'))
  }
  return dirs
}

/** Most directories one "expand all" run may open. */
const IDE_MAX_EXPANDED_DIRS = 200

/** Directory of a workspace path (`` for a top-level entry). */
/**
 * The `@` mention text for a workspace path.
 *
 * DSH quotes a mention only when the path contains whitespace, and a directory
 * keeps its trailing slash; both rules come from the reference codec, because a
 * mention that does not match is rendered as an invalid chip.
 */
function ideReferenceMention(relative, isDir) {
  const posix = idePlatform.toPosix(String(relative ?? '')).replace(/^\/+/, '')
  const trimmed = posix.replace(/\/+$/, '')
  const path = isDir === true ? `${trimmed}/` : trimmed
  // A quote inside the path would break the quoted form; DSH drops it too.
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(path) || path.includes('"')) return ''
  if (!/\s/u.test(path)) return `@${path}`
  return isDir === true ? `@"${path}` : `@"${path}"`
}

function ideParent(path) {
  const text = idePlatform.toPosix(path)
  const index = text.lastIndexOf('/')
  return index < 0 ? '' : text.slice(0, index)
}

/** Basename of an absolute or workspace path. */
function ideBasename(path) {
  const trimmed = idePlatform.toPosix(path).replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index < 0 ? trimmed : trimmed.slice(index + 1)
}

/** Extension → language id for the tokenizer and the status bar. */
function ideLangOf(path) {
  const name = String(path ?? '').toLowerCase()
  if (name.endsWith('dockerfile') || name.endsWith('.dockerfile')) return 'dockerfile'
  if (name.endsWith('.gitignore') || name.endsWith('.env') || name.endsWith('.editorconfig')) return 'conf'
  const index = name.lastIndexOf('.')
  if (index < 0) return ''
  const ext = name.slice(index + 1)
  const map = {
    java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy', gradle: 'groovy',
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
    json: 'json', jsonc: 'json', json5: 'json', xml: 'xml', html: 'html', htm: 'html', vue: 'html',
    css: 'css', scss: 'css', less: 'css', yml: 'yaml', yaml: 'yaml', toml: 'toml',
    py: 'py', go: 'go', rs: 'rs', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp',
    cs: 'cs', php: 'php', rb: 'rb', swift: 'swift', sh: 'sh', bash: 'sh', zsh: 'sh',
    sql: 'sql', md: 'md', markdown: 'md', txt: 'txt', properties: 'properties',
    conf: 'conf', ini: 'conf', proto: 'proto', graphql: 'proto', gql: 'proto',
  }
  return map[ext] ?? ''
}

/** Display label of a language id. */
function ideLangLabel(lang) {
  const map = {
    java: 'Java', kotlin: 'Kotlin', scala: 'Scala', groovy: 'Groovy', js: 'JavaScript', ts: 'TypeScript',
    json: 'JSON', xml: 'XML', html: 'HTML', css: 'CSS', yaml: 'YAML', toml: 'TOML', py: 'Python',
    go: 'Go', rs: 'Rust', c: 'C', cpp: 'C++', cs: 'C#', php: 'PHP', rb: 'Ruby', swift: 'Swift',
    sh: 'Shell', sql: 'SQL', md: 'Markdown', txt: 'Text', properties: 'Properties', conf: 'Conf',
    proto: 'Proto', dockerfile: 'Dockerfile',
  }
  return map[lang] ?? (lang === '' ? 'Text' : lang)
}

/**
 * One language family's keyword set.
 *
 * 关键字**按语言分开**，不要混成一份：早先是一张多语言大表，于是 Java 里名叫
 * `type` / `object` / `range` 的普通参数被当成关键字染色，同一行里有的参数有色、
 * 有的没有（用户实测反馈）。现在按 `ideLangOf` 的语言 id 取自己对的那张表。
 */
function ideKeywordSet(words) {
  return new Set(words.split(/\s+/).filter(Boolean))
}

/** Java：`type` / `object` / `map` 都不是关键字。 */
const IDE_KEYWORDS_JAVA = ideKeywordSet(
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
  'final finally float for goto if implements import instanceof int interface long native new package private ' +
  'protected public return short static strictfp super switch synchronized this throw throws transient try void ' +
  'volatile while true false null var yield record sealed permits',
)

/** Kotlin：比 Java 多 `fun`/`val`/`when`/`object` 等，但同样没有 `type`。 */
const IDE_KEYWORDS_KOTLIN = ideKeywordSet(
  'as break class continue do else false for fun if in interface is null object package return super this throw ' +
  'true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get ' +
  'import init param property receiver set setparam where actual abstract annotation companion const ' +
  'crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out ' +
  'override private protected public reified sealed suspend tailrec vararg',
)

/** JavaScript / TypeScript / JSON：`type` 在这里**是**关键字。 */
const IDE_KEYWORDS_TS = ideKeywordSet(
  'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
  'function if import in instanceof let new null return static super switch this throw true try typeof var void ' +
  'while with yield async await as from of get set constructor declare infer keyof module namespace readonly ' +
  'satisfies type interface implements abstract any boolean number object string symbol unknown never undefined ' +
  'public private protected',
)

/** Go。 */
const IDE_KEYWORDS_GO = ideKeywordSet(
  'break case chan const continue default defer else fallthrough for func go goto if import interface map ' +
  'package range return select struct switch type var nil true false iota',
)

/** Python。 */
const IDE_KEYWORDS_PY = ideKeywordSet(
  'and as assert async await break class continue def del elif else except False finally for from global if ' +
  'import in is lambda None nonlocal not or pass raise return True try while with yield self match case',
)

/** Rust。 */
const IDE_KEYWORDS_RUST = ideKeywordSet(
  'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod ' +
  'move mut pub ref return self Self static struct super trait true type unsafe use where while',
)

/** C / C++ / C#：`type`、`object` 都只是普通标识符。 */
const IDE_KEYWORDS_C = ideKeywordSet(
  'auto break case char const continue default do double else enum extern float for goto if inline int long ' +
  'register return short signed sizeof static struct switch typedef union unsigned void volatile while class ' +
  'namespace new delete public private protected virtual template typename using bool true false nullptr constexpr ' +
  'nullptr_t override final abstract async await base catch decimal explicit fixed foreach implicit in internal ' +
  'is lock object out params readonly ref sbyte sealed stackalloc string throw try uint ulong unchecked unsafe ' +
  'ushort var volatile',
)

/** Shell。 */
const IDE_KEYWORDS_SH = ideKeywordSet(
  'if then else elif fi for while until do done case esac function return local export declare readonly shift ' +
  'break continue in select time',
)

/** SQL。 */
const IDE_KEYWORDS_SQL = ideKeywordSet(
  'add all alter and any as asc between by case cast check column commit constraint create cross current ' +
  'database default delete desc distinct drop else end escape except exists foreign from full group having in ' +
  'index inner insert intersect into is join key left like limit not null offset on or order outer primary ' +
  'references right rollback select set table then to transaction union unique update values view when where ' +
  'with',
)

/** JSON / YAML / TOML 这类只有字面量的语言。 */
const IDE_KEYWORDS_DATA = ideKeywordSet('true false null yes no on off')

/** Swift。 */
const IDE_KEYWORDS_SWIFT = ideKeywordSet(
  'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator ' +
  'private protocol public rethrows static struct subscript typealias var break case continue default defer do ' +
  'else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self ' +
  'throw throws true try',
)

/** Scala / Groovy。 */
const IDE_KEYWORDS_SCALA = ideKeywordSet(
  'abstract case catch class def do else extends false final finally for forSome if implicit import lazy match ' +
  'new null object override package private protected return sealed super this throw trait true try type val ' +
  'var while with yield def as in trait',
)

/** 没有关键字可染色的语言（XML / CSS / 纯文本 / 未知后缀）。 */
const IDE_KEYWORDS_NONE = new Set()

/**
 * The keyword table for one language id.
 *
 * @param lang - language id from {@link ideLangOf}.
 * @returns the set to paint as keywords; empty when the language has none we know.
 */
function ideKeywordsOf(lang) {
  switch (lang) {
    case 'java': return IDE_KEYWORDS_JAVA
    case 'kotlin': return IDE_KEYWORDS_KOTLIN
    case 'scala': return IDE_KEYWORDS_SCALA
    case 'groovy': return IDE_KEYWORDS_SCALA
    case 'js': return IDE_KEYWORDS_TS
    case 'ts': return IDE_KEYWORDS_TS
    case 'json': return IDE_KEYWORDS_DATA
    case 'yaml': return IDE_KEYWORDS_DATA
    case 'toml': return IDE_KEYWORDS_DATA
    case 'properties': return IDE_KEYWORDS_DATA
    case 'conf': return IDE_KEYWORDS_DATA
    case 'go': return IDE_KEYWORDS_GO
    case 'py': return IDE_KEYWORDS_PY
    case 'rs': return IDE_KEYWORDS_RUST
    case 'c': return IDE_KEYWORDS_C
    case 'cpp': return IDE_KEYWORDS_C
    case 'cs': return IDE_KEYWORDS_C
    case 'sh': return IDE_KEYWORDS_SH
    case 'sql': return IDE_KEYWORDS_SQL
    case 'swift': return IDE_KEYWORDS_SWIFT
    case 'php': return IDE_KEYWORDS_TS
    case 'rb': return IDE_KEYWORDS_PY
    default: return IDE_KEYWORDS_NONE
  }
}

/** Languages whose `#` starts a line comment. */
const IDE_HASH_COMMENT = new Set(['py', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'rb', 'toml', 'conf', 'properties', 'dockerfile'])

/** Languages that never carry useful tokens here. */
const IDE_PLAIN_LANGS = new Set(['md', 'txt', 'log', 'csv', 'tsv', 'lock'])

/**
 * Split one code line into coloured runs.
 *
 * 单词只有三条判断：命中本语言的关键字 → 关键字色；首字母大写 → 类型色；
 * 后面跟 `(` 或前面是 `::` → 方法色；其余一律无色（参数名大多落在这里）。
 *
 * @param text - the source line.
 * @param lang - language id from {@link ideLangOf}; also picks the keyword table.
 * @returns `{ text, cls }` runs; a single plain run when nothing matches.
 */
/**
 * 括号层级一共几档颜色（超过 10 层回到第 0 档）。
 *
 * 颜色不再是「借语法色」：语法色只有 8–9 个且互相撞色（`annotation` 与
 * `type`/`function` 同色），最多撑到 4 档。现在每套主题显式定义
 * `--iw-br-0..9` 十个括号色（色相 36° 一档铺满一圈），层级色直接取它。
 */
const IDE_BRACKET_LEVELS = 10

/**
 * 参数名：`类型 名字` 形状、且这段后面紧接 `,` 或 `)`。
 *
 * 只在「看起来就是参数表」的位置匹配——段内不能出现 `=`、调用、分号，
 * 所以 `foo(a, b)` 这种调用不会误判，`String lockKey = …` 也不会。
 */
const IDE_PARAM_PAIR = /(?:^|[(,])\s*(?:@[A-Za-z_][\w.]*(?:\([^()]*\))?\s*)*(?:final\s+)?([A-Za-z_$][\w$.]*(?:\s*<[^<>()]*>)?(?:\s*\[\s*\])*)\s+([A-Za-z_$][\w$]*)\s*(?=[,)])/g

/** Columns of the parameter names on one line. */
function ideParamColumns(text) {
  const columns = new Set()
  IDE_PARAM_PAIR.lastIndex = 0
  let match = IDE_PARAM_PAIR.exec(text)
  while (match !== null) {
    const name = match[2]
    // 这一段的起点到名字之间不能出现 `=`/`(`/`;`，否则就不是声明。
    // 名字在整段里的位置：注解前缀里可能出现同名，所以取最后一次出现。
    const offset = match[0].lastIndexOf(name)
    const head = text.slice(0, match.index + offset)
    const segment = head.slice(Math.max(head.lastIndexOf('('), head.lastIndexOf(','), head.lastIndexOf(';')) + 1)
    if (!/[=(;]/.test(segment)) columns.add(match.index + offset)
    match = IDE_PARAM_PAIR.exec(text)
  }
  return columns
}

/**
 * Split one code line into coloured runs, tracking bracket nesting.
 *
 * @param text - the source line.
 * @param lang - language id; also picks the keyword table.
 * @param depth - bracket depth at the start of this line (from the previous line).
 * @returns `{ runs, depth }` — the runs and the depth at the next line.
 */
function ideTokenizeTracked(text, lang, depth = 0) {
  const start = Number.isFinite(depth) ? Math.max(0, depth) : 0
  if (text === '' || IDE_PLAIN_LANGS.has(lang) || text.length > 1200) {
    return { runs: [{ text, cls: '', at: 0 }], depth: start }
  }
  const keywords = ideKeywordsOf(lang)
  const hashComments = IDE_HASH_COMMENT.has(lang)
  const level = (value) => `level-${value % IDE_BRACKET_LEVELS}`
  let nesting = start
  const trimmed = text.trimStart()
  if (trimmed.startsWith('*') || trimmed.startsWith('*/') || trimmed.startsWith('//') || (hashComments && trimmed.startsWith('#'))) {
    return { runs: [{ text, cls: 'iw-com', at: 0 }], depth: nesting }
  }
  if (trimmed.startsWith('/*') && trimmed.indexOf('*/') < 0) return { runs: [{ text, cls: 'iw-com', at: 0 }], depth: nesting }

  const runs = []
  const push = (value, cls, at) => {
    if (value === '') return
    const last = runs[runs.length - 1]
    if (last !== undefined && last.cls === cls) last.text += value
    else runs.push({ text: value, cls, at })
  }
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)
    const quote = rest[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      let end = index + 1
      while (end < text.length) {
        if (text[end] === '\\') { end += 2; continue }
        if (text[end] === quote) { end += 1; break }
        end += 1
      }
      push(text.slice(index, end), 'iw-str', index)
      index = end
      continue
    }
    if (quote === '/' && rest[1] === '/') {
      push(rest, 'iw-com', index)
      break
    }
    if (quote === '@' && /[A-Za-z]/.test(rest[1] ?? '')) {
      const match = /^@[A-Za-z_][\w.]*/.exec(rest)
      push(match[0], 'iw-ann', index)
      index += match[0].length
      continue
    }
    if (hashComments && quote === '#') {
      push(rest, 'iw-com', index)
      break
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest)
    if (word !== null) {
      const value = word[0]
      // `A::b` 里的 b 是方法引用：后面没有 `(`，但仍按方法上色，
      // 否则同一个名字在这里和 `.b(` 那里会两种颜色。
      const reference = text.slice(Math.max(0, index - 2), index) === '::'
      // `StringUtils.isBlank(`、`UrlVersionConstant.WEB`：接收者首字母大写 → 大概率是静态成员，
      // Material 主题把静态成员显示成斜体。
      const receiver = /(?:^|[^\w$.])([A-Z][\w$]*)\.$/.exec(text.slice(0, index))
      const statics = receiver === null ? '' : ' iw-static'
      if (keywords.has(value)) push(value, 'iw-kw', index)
      // 常量（WEB / UTF_8 / CONTENT_DISPOSITION）：Material 里用数字色，和类型分开。
      else if (/^[A-Z][A-Z0-9_]{2,}$/.test(value)) push(value, `iw-type iw-const${statics}`, index)
      else if (/^[A-Z]/.test(value)) push(value, `iw-type${statics}`, index)
      else if (text[index + value.length] === '(' || reference) push(value, `iw-fn${statics}`, index)
      else push(value, statics === '' ? '' : 'iw-static', index)
      index += value.length
      continue
    }
    if (quote === '{' || quote === '}' || quote === '(' || quote === ')' || quote === '[' || quote === ']') {
      // 闭合括号用它那一层的颜色，和开括号对上；其余括号用当前层。
      const closing = quote === '}' || quote === ')' || quote === ']'
      const use = closing ? Math.max(0, nesting - 1) : nesting
      const family = quote === '(' || quote === ')' || quote === '[' || quote === ']' ? 'iw-pa' : 'iw-br'
      push(quote, `${family} ${level(use)}`, index)
      nesting = closing ? Math.max(0, nesting - 1) : nesting + 1
      index += 1
      continue
    }
    const numeric = /^0[xXbB][0-9a-fA-F_]+|^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[fFdDlL]?/.exec(rest)
    if (numeric !== null) {
      push(numeric[0], 'iw-num', index)
      index += numeric[0].length
      continue
    }
    push(quote, 'iw-punct', index)
    index += 1
  }
  // 方法签名里的形参单独一色：和正文里的同名变量区分开。
  const params = ideParamColumns(text)
  if (params.size > 0) {
    for (const run of runs) {
      if (run.cls === '' && params.has(run.at)) run.cls = 'iw-param'
    }
  }
  return { runs, depth: nesting }
}

/**
 * Split one code line into coloured runs (no nesting context).
 *
 * @param text - the source line.
 * @param lang - language id from {@link ideLangOf}.
 * @param depth - bracket depth at the start of the line, when the caller tracks it.
 * @returns `{ text, cls }` runs; a single plain run when nothing matches.
 */
function ideTokenize(text, lang, depth = 0) {
  return ideTokenizeTracked(text, lang, depth).runs.map((run) => ({ text: run.text, cls: run.cls }))
}

/**
 * 文件内查找：把查询编译成匹配器。
 *
 * @param options - `{ query, regex, caseSensitive, whole }`
 * @returns `(line) => ranges`，或 `undefined`（查询为空 / 正则写错）。
 */
function ideFindMatcher(options) {
  const query = String(options?.query ?? '')
  if (query === '') return undefined
  // 不开正则时把查询当纯文本：`.`、`(` 这些不能当元字符。
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const source = options?.regex === true ? query : escaped
  const whole = options?.whole === true ? `\\b(?:${source})\\b` : source
  let pattern
  try {
    pattern = new RegExp(whole, options?.caseSensitive === true ? 'g' : 'gi')
  } catch {
    return undefined
  }
  return (line) => {
    const ranges = []
    pattern.lastIndex = 0
    let match = pattern.exec(line)
    while (match !== null) {
      // 零宽匹配（`^`、`a*`）不会自己前进，必须手动跳过，否则死循环。
      if (match[0] === '') {
        pattern.lastIndex += 1
        match = pattern.exec(line)
        continue
      }
      ranges.push([match.index, match.index + match[0].length])
      if (ranges.length >= 500) break
      match = pattern.exec(line)
    }
    return ranges
  }
}

/**
 * Scan every line for the current query.
 *
 * @param lines - the file's lines.
 * @param options - `{ query, regex, caseSensitive, whole }`
 * @returns `{ invalid, perLine, total }`；`perLine[i]` 是 `{ start, end, order }`，
 *   `order` 是整份文件里的序号，上下跳转按它走。
 */
function ideFindScan(lines, options) {
  const matcher = ideFindMatcher(options)
  if (matcher === undefined) {
    return { invalid: String(options?.query ?? '') !== '', perLine: [], total: 0 }
  }
  const perLine = []
  let total = 0
  for (const line of lines) {
    const hits = []
    for (const [start, end] of matcher(line)) {
      hits.push({ start, end, order: total })
      total += 1
    }
    perLine.push(hits)
  }
  return { invalid: false, perLine, total }
}

/**
 * Split tokenizer runs at find-hit boundaries so a hit can be wrapped without
 * losing its syntax colour.
 *
 * @param runs - tokenizer runs, each carrying the column it starts at (`at`).
 * @param hits - `{ start, end, order }` for this line, ascending.
 * @returns `{ text, cls, find? }` segments; `find` is the global hit order.
 */
function ideFindSegments(runs, hits) {
  if (!Array.isArray(hits) || hits.length === 0) {
    return runs.map((run) => ({ text: run.text, cls: run.cls }))
  }
  const out = []
  for (const run of runs) {
    const at = Number(run.at ?? 0)
    const end = at + run.text.length
    let cursor = at
    for (const hit of hits) {
      if (hit.end <= cursor || hit.start >= end) continue
      if (hit.start > cursor) out.push({ text: run.text.slice(cursor - at, hit.start - at), cls: run.cls })
      const from = Math.max(hit.start, cursor)
      const to = Math.min(hit.end, end)
      out.push({ text: run.text.slice(from - at, to - at), cls: run.cls, find: hit.order })
      cursor = to
    }
    if (cursor < end) out.push({ text: run.text.slice(cursor - at), cls: run.cls })
  }
  return out
}

/**
 * 让同一个形参在**整条方法体里**保持同一种颜色。
 *
 * 词法器只能认出签名里的声明；正文里的 `billType` 会被当成普通标识符，于是同一个
 * 字段在签名里一个色、在正文里另一个色（用户实测反馈）。这里按「签名声明 → 方法体
 * 作用域」补一遍：进入方法体时记下形参名，遇到同名标识符就标成 `iw-param`。
 *
 * @param lines - the file's lines.
 * @param runsByLine - tokenizer runs per line (each run keeps `at`).
 * @returns 新的 runsByLine（不改入参）。
 */
function ideMarkParamScopes(lines, runsByLine) {
  const out = runsByLine.map((runs) => runs.map((run) => ({ ...run })))
  let depth = 0
  const scopes = []
  // 签名可能跨行（`String a,` 换行 `String b)` 再接方法体开括号），
  // 形参名要跨行攒着，等方法体真的开始（深度增加）时再一起登记。
  // 注意：这个函数里不能出现花括号字面量，grabSource 靠括号配对截取函数体。
  let pending = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    const runs = out[index]
    const start = depth
    const scope = scopes[scopes.length - 1]
    if (scope !== undefined) {
      for (const run of runs) {
        if (run.cls === '' && scope.names.has(run.text)) run.cls = 'iw-param'
      }
    }
    const declared = runs.filter((run) => run.cls === 'iw-param').map((run) => run.text)
    for (const name of declared) pending.add(name)
    // 只数花括号：开括号 123、闭括号 125。这里刻意不写字符字面量——
    // harness 的 grabSource 按括号配对截取函数体，字符串里的花括号会让它数错。
    for (const run of runs) {
      if (run.cls.startsWith('iw-br') !== true) continue
      if (run.text.charCodeAt(0) === 125) depth -= 1
      else depth += 1
    }
    if (pending.size > 0 && depth > start) {
      scopes.push({ depth: start, names: pending })
      pending = new Set()
    } else if (pending.size > 0 && runs.some((run) => run.cls === 'iw-punct' && run.text === ';')) {
      // 抽象/接口方法：只有签名没有方法体，别把名字带进下一个方法。
      pending = new Set()
    }
    while (scopes.length > 0 && depth <= scopes[scopes.length - 1].depth) scopes.pop()
  }
  return out
}

/**
 * `static` 成员的声明行也标成斜体（Material 主题的静态成员约定）。
 *
 * `ClassName.member` 这种访问词法器里就能认出来，但声明行（`private static final
 * String X = …` / `public static void run(`）要靠这一遍：行里出现 static 就把它
 * 声明的那个名字标上。
 *
 * 注意：函数体里不能写花括号字面量，harness 按括号配对截取源码。
 */
function ideMarkStatics(lines, runsByLine) {
  const out = runsByLine.map((runs) => runs.map((run) => ({ ...run })))
  const declared = /^\s*(?:(?:public|private|protected)\s+)?static\b[^=(]*?([A-Za-z_]\w*)\s*(?:\(|;|=)/
  for (let index = 0; index < lines.length; index += 1) {
    const match = declared.exec(lines[index])
    if (match === null) continue
    const name = match[1]
    for (const run of out[index]) {
      if (run.text !== name) continue
      if (run.cls.split(' ').includes('iw-static')) break
      run.cls = run.cls === '' ? 'iw-static' : `${run.cls} iw-static`
      break
    }
  }
  return out
}

/**
 * Call one `workspaceFiles` method and unwrap its `RemoteResult` envelope.
 *
 * @param face - the `workspaceFiles` namespace object captured inside the
 *   injected context. The namespace is its own inject key on the Remote face,
 *   so reading it later through the proxy throws; the object itself is safe.
 * @param method - `list`, `read` or `stat`.
 * @returns `{ ok: true, value }` or `{ ok: false, error }`.
 */
async function ideCall(face, method, args) {
  if (face === undefined || face === null || typeof face[method] !== 'function') {
    return { ok: false, error: 'workspace-files-unavailable' }
  }
  let result
  try {
    result = await face[method](...args)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (result === undefined || result === null) return { ok: false, error: 'empty-result' }
  if (result.ok !== true) {
    // Keep both halves: the Host's codes are terse (`gateway/bad-request`) and
    // the message is what says which argument it refused.
    const failure = result.error ?? {}
    const code = typeof failure.code === 'string' ? failure.code : ''
    const detail = typeof failure.message === 'string' && failure.message !== ''
      ? failure.message
      : (typeof failure.details?.path === 'string' ? failure.details.path : '')
    return { ok: false, error: code !== '' && detail !== '' ? `${code}: ${detail}` : (code !== '' ? code : (detail !== '' ? detail : 'remote-failure')) }
  }
  return { ok: true, value: result.value }
}

/**
 * Open one directory-observation stream through the Remote supervisor.
 *
 * `$stream` owns reconnection and disposal; `open(lifetime)` receives the
 * signal the supervisor aborts on dispose, which is exactly what the stream
 * method wants as its third argument.
 *
 * @returns a disposer; calling it ends the stream.
 */
function ideWatch(remote, face, sessionId, absolutePath, onFrame, onError) {
  const supervisor = remote?.$stream
  if (typeof supervisor !== 'function' || face === undefined || face === null) {
    onError({ code: 'workspace-files-unavailable' })
    return () => {}
  }
  let stream
  try {
    stream = supervisor.call(remote, {
      name: `workspace ${absolutePath}`,
      open: (lifetime) => face.changes(sessionId, absolutePath, lifetime),
      ended: () => new Error(`watch ended: ${absolutePath}`),
    })
  } catch (error) {
    onError(error)
    return () => {}
  }
  let disposed = false
  const run = async () => {
    try {
      for await (const item of stream) {
        if (disposed) return
        const frame = item?.value ?? item
        if (frame?.kind === 'ready') {
          if (typeof item?.accept === 'function') item.accept()
          continue
        }
        if (frame?.kind === 'change') onFrame(frame.change)
      }
    } catch (error) {
      if (!disposed) onError(error)
    }
  }
  void run()
  return () => {
    disposed = true
    try {
      const pending = stream?.dispose?.()
      if (pending !== undefined && typeof pending.catch === 'function') pending.catch(() => {})
    } catch (error) {
      void error
    }
  }
}

/**
 * Build the store. `layoutRef` and `remoteRef` are resolved lazily so the store
 * can exist before those services are reachable.
 */
function ideCreateStore(refs) {
  const prefs = ideReadPrefs()
  const defaultFloatSize = ideFloatDefaultSize()
  let state = {
    sessionId: null,
    // The floating quick-ask card: shown whenever the code workspace owns the
    // centre column, collapsed to a ball on request.
    // A detached card is on screen from the start, wherever the app opens.
    floatOpen: prefs.floatDetached === true,
    // 每次打开 DSH 都从「收起来」开始：卡片在，但只占一个小球。
    floatCollapsed: true,
    // Where the user dragged the card (null = the bottom-right corner).
    floatX: null,
    floatY: null,
    // Card size: the persisted default, replaced when the user drags the grip.
    floatWidth: defaultFloatSize.width,
    floatHeight: defaultFloatSize.height,
    // The default the settings page edits; a manual resize does not move it.
    floatDefaultWidth: defaultFloatSize.width,
    floatDefaultHeight: defaultFloatSize.height,
    // The card's lifetime controls: `floatEnabled` is a preference, `floatClosed`
    // lasts until DSH restarts (the user asked for "stay closed until restart").
    floatEnabled: prefs.floatEnabled !== false,
    // System events are noise for most reads; the switch in Settings turns them on.
    floatEvents: prefs.floatEvents === true,
    // Detached cards stay on screen in every panel, not only the workspace.
    floatDetached: prefs.floatDetached === true,
    // 跟随当前会话（默认）：关掉后，DSH 里切会话不再带动卡片，只能在卡片里手动切。
    floatFollow: prefs.floatFollow !== false,
    // 不跟随时卡片自己钉住的会话（只本次进程有效，重启回到当前会话）。
    floatSessionId: null,
    floatClosed: false,
    // One reference waiting to be appended to the card's draft.
    floatInsert: null,
    rootPath: '',
    /** True once the `workspaceFiles` Remote face is reachable. */
    remoteReady: false,
    /** The tab context menu, or null: `{ path, x, y }` in panel coordinates. */
    tabMenu: null,
    /** The code-gutter context menu, or null: `{ path, x, y }`. */
    codeMenu: null,
    // 「在文件中查找」的一次性请求：右键菜单写它，代码视图读到就打开查找条并清空。
    findRequest: null,
    // The symbol last clicked in the code view: `{path, line, symbol}`. The
    // keyboard shortcut for 「复制引用回对话」 has no pointer to read it from, so
    // the click leaves it here instead of keeping it inside the context menu.
    lastSymbol: null,
    codeSymbolMenu: null,
    /** The file-tree context menu, or null: `{ path, isDir, x, y }`. */
    treeMenu: null,
    /** A file-tree overlay (diff or picker), or null. */
    treePopup: null,
    /** A file the tree should scroll to: `{ path, stamp }`, or null. */
    revealFile: null,
    /** Files shown with Git annotate: `path → true`. */
    annotate: {},
    /** Colour theme id (a file in `themes/`); empty follows the DSH palette. */
    theme: typeof prefs.theme === 'string' ? prefs.theme : '',
    /** Whether the palette popup is open (rendered at panel level, not in the bar). */
    themeMenu: false,
    /**
     * Screenshot dialog: `null` when closed, otherwise
     * `{ phase: 'editing' | 'error', dataUrl?, path?, code?, message? }`.
     */
    screenshot: null,
    /** Editor and tree font sizes, in px, shared by the whole workspace. */
    codeFontSize: Number.isFinite(prefs.codeFontSize) ? prefs.codeFontSize : 12.5,
    treeFontSize: Number.isFinite(prefs.treeFontSize) ? prefs.treeFontSize : 14.5,
    /**
     * Maven repository used for dependency sources. Empty means "ask the Host",
     * which reads Maven's own settings and then `~/.m2/repository`.
     */
    mavenRepo: typeof prefs.mavenRepo === 'string' ? prefs.mavenRepo : '',
    /** What the Host resolved on its own, shown as a hint in settings. */
    mavenRepoDetected: '',
    /** Whether the detected repository actually exists on disk. */
    mavenRepoDetectedExists: false,

    /** Whether opening a file address anywhere in the shell jumps this panel. */
    jumpEnabled: prefs.jumpEnabled !== false,
    /**
     * Keyboard bindings this plugin owns, keyed by registry id. A missing entry
     * uses the shipped default; nothing is registered in DSH's catalog, so DSH's
     * own 「编辑快捷键」 dialog never lists these.
     */
    shortcutBindings: { ...(prefs.shortcutBindings ?? {}) },
    /**
     * Mouse gestures for the two navigation actions: `double` is a double click,
     * `meta` and `alt` are a single click with that modifier held.
     */
    gestures: {
      definition: prefs.gestures?.definition ?? 'double',
      usages: prefs.gestures?.usages ?? 'meta',
      chain: prefs.gestures?.chain ?? 'alt',
    },
    /** Whether the gesture editor inside General settings is expanded. */
    gestureEditorOpen: false,
    /** Why the last gesture change was refused. */
    gestureIssue: '',
    /** The command currently capturing keys, or ''. */
    gestureRecording: '',
    /** Uncommitted files by workspace path: `path → porcelain code`. */
    vcs: {},
    /** Java index progress: `{ status, done, total }`. */
    indexInfo: { status: 'idle', done: 0, total: 0 },
    /**
     * A project root chosen by the user, overriding the Session-derived one.
     * Empty means "follow the Session", which is the default.
     */
    treeVisible: prefs.treeVisible !== false,
    treeWidth: ideClamp(Number(prefs.treeWidth) || 300, 190, 560),
    filter: '',
    /** Whether the Search Everywhere palette is open. */
    paletteOpen: false,
    /** Remembered scroll offset per tab path, so switching tabs keeps the place. */
    scroll: {},
    /** Navigation history, newest last: `{ path, line }` positions. */
    historyBack: [],
    historyForward: [],
    /** Workspace-wide search state for the tree's search box. */
    search: { status: 'idle', query: '', matches: [], truncated: false, error: '' },
    watching: true,
    liveNotice: '',
    /** workspace-relative directory path → one directory node. */
    dirs: {},
    /** Expanded directory paths, in expansion order (they are the watched set). */
    expanded: [],
    /** Open editor tabs, in tab-strip order. */
    tabs: [],
    activePath: null,
  }
  // Mirror the persisted repository so the plain jar request can read it.
  ideMavenRepoPref = typeof state.mavenRepo === 'string' ? state.mavenRepo : ''

  const listeners = new Set()
  /** path → disposer of that directory's watch stream. */
  const watchers = new Map()
  /** Open tab absolute paths, kept for the change handler. */
  const tabByAbsolute = new Map()
  /** Right-Sidebar controller, adopted whenever the service (re)loads. */
  let disposed = false
  /** Debounce before one workspace search starts. */
  const IDE_SEARCH_DEBOUNCE_MS = 180
  let searchTimer
  /** Monotonic token: only the newest search may apply its answer. */
  let searchToken = 0
  /** Pending debounced save of the visible state. */
  let viewTimer

  const getState = () => state

  const subscribe = (listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  // Persist the visible state whenever it changes; the save itself is debounced.
  subscribe(() => { saveView() })
  const patch = (next) => {
    state = { ...state, ...next }
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        void error
      }
    }
  }

  /** The Remote carrier, when it has loaded (`$stream` lives here). */
  const remote = () => refs.remote?.current

  /** The captured `workspaceFiles` namespace; reading it off the proxy would throw. */
  const files = () => refs.files?.current

  /** One directory node, defaulted. */
  const dirOf = (path) => state.dirs[path] ?? { status: 'idle', entries: [], error: '', truncated: false }

  /** Write one directory node back. */
  const putDir = (path, node) => {
    patch({ dirs: { ...state.dirs, [path]: { ...dirOf(path), ...node } } })
  }

  /** Read one directory page from the Host. */
  async function loadDir(path, options = {}) {
    const face = files()
    const sessionId = state.sessionId
    // Before the Remote face arrives there is nothing to answer; the attach
    // handler relists, so a stub is left in place rather than a fake error.
    if (face === undefined || sessionId === null || sessionId === undefined) return
    if (state.rootPath === '') return
    if (dirOf(path).status === 'loading' && options.force !== true) return
    putDir(path, { status: 'loading', error: '' })
    // `list` accepts an absolute path, and the Host refuses an empty one
    // (`gateway/bad-request: path is required`), so the root is addressed by
    // its absolute form. The response's own `path` is workspace-relative.
    const result = await ideCall(face, 'list', [sessionId, ideAbs(state.rootPath, path), new AbortController().signal])
    if (disposed) return
    if (!result.ok) {
      putDir(path, { status: 'error', entries: [], error: result.error })
      return
    }
    const entries = (result.value.entries ?? []).map((entry) => ({
      name: entry.name,
      type: entry.type,
      size: entry.size,
      path: path === '' ? entry.name : `${path}/${entry.name}`,
    }))
    putDir(path, { status: 'ready', entries, truncated: result.value.truncated === true, error: '' })
    // A watched directory reports a change exactly once, so the relisting that
    // follows also refreshes the directories the user already expanded below it.
    if (options.cascade === true) {
      const below = state.expanded.filter((candidate) => candidate.startsWith(path === '' ? '' : `${path}/`) && candidate !== path)
      await Promise.all(below.map((candidate) => loadDir(candidate, { force: true })))
    }
  }

  /** Start observing one absolute directory. */
  function watchDir(path) {
    const face = files()
    const carrier = remote()
    const sessionId = state.sessionId
    if (face === undefined || carrier === undefined || sessionId === null || sessionId === undefined) return
    if (state.rootPath === '') return
    if (state.watching !== true || watchers.has(path)) return
    const absolutePath = ideAbs(state.rootPath, path)
    const dispose = ideWatch(carrier, face, sessionId, absolutePath, (change) => {
      if (disposed) return
      const changed = typeof change?.absolutePath === 'string' ? change.absolutePath : ''
      if (changed === '') return
      scheduleVcs()
      const tab = tabByAbsolute.get(changed)
      if (tab !== undefined) void reloadTab(tab, change?.version)
      // A directory invalidation: relist it (and, from the root, everything below).
      // The Host reports an invalidated *directory target*, not the child that
      // changed, so every open file under it is re-read. Without this the tree
      // refreshed while the open editor stayed stale.
      const directoryPrefix = changed.endsWith('/') ? changed : `${changed}/`
      for (const entry of state.tabs) {
        if (entry.kind === 'jar') continue
        const absolute = ideAbs(state.rootPath, entry.path)
        if (absolute !== changed && !absolute.startsWith(directoryPrefix)) continue
        void loadTabFile(entry)
      }
      const known = Object.values(state.dirs).some((node) => Array.isArray(node.entries)
        && node.entries.some((item) => item.type === 'directory' && ideAbs(state.rootPath, item.path) === changed))
      if (known || changed === absolutePath) {
        const relisted = Object.entries(state.dirs)
          .find(([, node]) => Array.isArray(node.entries)
            && node.entries.some((entry) => entry.type === 'directory' && ideAbs(state.rootPath, entry.path) === changed))
        void loadDir(relisted === undefined ? path : relisted[0], { force: true, cascade: true })
      }
    }, (error) => {
      if (disposed) return
      const code = typeof error === 'object' && error !== null ? error.code ?? '' : ''
      const message = typeof error === 'string' ? error : (error?.message ?? '')
      // A filesystem that cannot watch is a documented limitation: the tree then
      // refreshes only when asked, which the status bar already says.
      if (code === 'workspace-file/watch-unsupported' || /watch[- ]unsupported/i.test(message)) {
        patch({ watching: false })
        return
      }
      patch({ liveNotice: message })
    })
    watchers.set(path, dispose)
  }

  /** Stop observing one absolute directory. */
  function unwatchDir(path) {
    const dispose = watchers.get(path)
    if (dispose === undefined) return
    watchers.delete(path)
    dispose()
  }

  /** Read one file into its tab, following the Host's page size. */
  /** Load git's view of this file into its tab, for the gutter bars. */
  async function loadTabChanges(path, version) {
    const root = state.rootPath
    if (root === '' || typeof path !== 'string') return
    const found = await ideDiffQuery(root, path)
    if (disposed) return
    const tab = state.tabs.find((entry) => entry.path === path)
    if (tab === undefined || tab.version !== version) return
    putTab(path, {
      changes: {
        untracked: found.ok === true && found.untracked === true,
        hunks: found.ok === true ? found.hunks : [],
      },
    })
  }

  async function loadTabFile(tab, options = {}) {
    const face = files()
    const sessionId = state.sessionId
    if (face === undefined || sessionId === null || sessionId === undefined) {
      putTab(tab.path, { status: 'error', error: 'workspace-files-unavailable' })
      return
    }
    if (state.rootPath === '') {
      // `read` addresses the file by absolute path; without a resolved root the
      // tree can still be browsed, but contents cannot be read.
      putTab(tab.path, { status: 'error', error: 'no-workspace-root' })
      return
    }
    const absolutePath = ideAbs(state.rootPath, tab.path)
    const startedAt = ideNow()
    putTab(tab.path, { status: options.silent === true ? 'ready' : 'loading', error: options.silent === true ? tab.error : '' })
    let offset = 1
    let text = ''
    let lines = 0
    let bytes = 0
    let eof = false
    let version
    for (let page = 0; page < 64; page += 1) {
      // No `limit`: the Host fills in its configured maximum, and a larger one
      // would be refused as `gateway/bad-request: limit must be at most …`.
      const result = await ideCall(face, 'read', [sessionId, absolutePath, { offset }, new AbortController().signal])
      if (disposed) return
      if (!result.ok) {
        putTab(tab.path, { status: 'error', error: result.error })
        return
      }
      const value = result.value
      version = value.version
      bytes = typeof value.bytes === 'number' ? value.bytes : bytes
      if (value.lines > 0) {
        text = text === '' ? value.text : `${text}\n${value.text}`
        lines += value.lines
      }
      eof = value.eof === true
      if (eof) break
      if (lines >= IDE_MAX_LINES || text.length >= IDE_MAX_BYTES) break
      // No progress means the page was past EOF: stop instead of looping.
      if (value.lines <= 0) break
      offset += value.lines
    }
    const truncated = eof !== true
    if (truncated) {
      patch({ liveNotice: `文件过大，仅加载前 ${lines} 行` })
    }
    patch({ lastLoadMs: Math.round(ideNow() - startedAt), lastLoadPath: tab.path })
    putTab(tab.path, {
      status: 'ready',
      text,
      lines,
      bytes,
      version: typeof version === 'string' ? version : '',
      truncated,
      error: '',
    })
    // The change bar is decoration: it loads after the text is on screen and is
    // dropped if the file moved on while the diff was in flight.
    void loadTabChanges(tab.path, typeof version === 'string' ? version : '')
  }

  /** Rewrite one tab by workspace path. */
  function putTab(path, next) {
    const index = state.tabs.findIndex((entry) => entry.path === path)
    if (index < 0) return
    const tabs = state.tabs.slice()
    tabs[index] = { ...tabs[index], ...next }
    patch({ tabs })
  }

  /** Re-read one open file after a change frame. */
  async function reloadTab(path) {
    const tab = state.tabs.find((entry) => entry.path === path)
    if (tab === undefined) return
    await loadTabFile(tab, { silent: true })
  }

  /** Drop every derived view of the previous root and start again from the top. */
  /**
   * Drop derived state and reload it.
   *
   * `keepView` keeps the open tabs and the expanded set: a Session change does
   * not change what the workspace contains, so wiping the view there is what
   * made every visit start from an empty editor.
   */
  function restart(options = {}) {
    for (const [path] of watchers) unwatchDir(path)
    tabByAbsolute.clear()
    if (options.keepView === true) {
      patch({ dirs: {}, liveNotice: '' })
    } else {
      patch({ dirs: {}, expanded: [], tabs: [], activePath: null, liveNotice: '' })
    }
    // A listing speaks workspace-relative paths, so it only needs a Session.
    // Watching speaks absolute paths, so it waits for the resolved root.
    if (state.sessionId !== null) void loadDir('', { force: true })
    if (state.sessionId !== null && state.rootPath !== '') watchDir('')
    if (state.rootPath !== '') void refreshVcs()
    if (options.keepView === true) {
      for (const tab of state.tabs) {
        tabByAbsolute.set(ideAbs(state.rootPath, tab.path), tab.path)
        void loadTabFile(tab)
      }
      for (const path of state.expanded) {
        loadDir(path)
        watchDir(path)
      }
      return
    }
    if (options.restore === true) restoreView()
  }

  /** Debounced save of the visible state for the current workspace root. */
  function saveView() {
    if (state.rootPath === '') return
    if (viewTimer !== undefined) clearTimeout(viewTimer)
    viewTimer = setTimeout(() => {
      viewTimer = undefined
      if (disposed || state.rootPath === '') return
      const map = ideReadViewMap()
      map[state.rootPath] = {
        tabs: state.tabs.slice(0, 16).map((tab) => ({
          path: tab.path,
          reveal: typeof tab.reveal === 'number' ? tab.reveal : null,
        })),
        activePath: state.activePath,
        expanded: state.expanded.slice(0, 24),
        treeVisible: state.treeVisible,
        treeWidth: state.treeWidth,
      }
      const roots = Object.keys(map)
      for (const stale of roots.slice(0, Math.max(0, roots.length - 3))) delete map[stale]
      ideWriteViewMap(map)
    }, 400)
  }

  /**
   * Reopen the tabs and directories this workspace had last time.
   *
   * @returns whether anything was restored.
   */
  function restoreView() {
    if (state.rootPath === '' || state.tabs.length > 0) return false
    const saved = ideReadViewMap()[state.rootPath]
    if (saved === null || saved === undefined || typeof saved !== 'object') return false
    const tabs = []
    for (const entry of Array.isArray(saved.tabs) ? saved.tabs.slice(0, 16) : []) {
      if (typeof entry?.path !== 'string' || entry.path === '') continue
      const split = ideSplitPath(entry.path)
      tabs.push({
        path: entry.path,
        name: split.name,
        dir: split.dir,
        status: 'loading',
        text: '',
        lines: 0,
        bytes: 0,
        version: '',
        truncated: false,
        error: '',
        reveal: typeof entry.reveal === 'number' ? entry.reveal : null,
      })
    }
    const expanded = Array.isArray(saved.expanded)
      ? saved.expanded.filter((entry) => typeof entry === 'string' && entry !== '')
      : []
    if (tabs.length === 0 && expanded.length === 0) return false
    const activePath = tabs.some((tab) => tab.path === saved.activePath)
      ? saved.activePath
      : (tabs[0]?.path ?? null)
    patch({
      tabs,
      activePath,
      expanded,
      treeWidth: Number.isFinite(saved.treeWidth) ? ideClamp(saved.treeWidth, 190, 560) : state.treeWidth,
      treeVisible: saved.treeVisible === false ? false : state.treeVisible,
    })
    for (const tab of tabs) {
      tabByAbsolute.set(ideAbs(state.rootPath, tab.path), tab.path)
      void loadTabFile(tab)
    }
    for (const path of expanded) {
      loadDir(path)
      watchDir(path)
    }
    return true
  }

  /** Show or hide the floating assistant card. */
  function setFloatOpen(open) {
    const next = open === true
    if (state.floatOpen === next) return
    patch({ floatOpen: next })
  }

  /** Remember where the user put the card. */
  function setFloatPoint(x, y) {
    const left = Number(x)
    const top = Number(y)
    if (!Number.isFinite(left) || !Number.isFinite(top)) return
    const state = getState()
    if (state.floatX === left && state.floatY === top) return
    patch({ floatX: left, floatY: top })
  }

  /** Set the card's default size (persisted) and apply it to the open card. */
  function setFloatDefaultSize(width, height) {
    const w = Number(width)
    const h = Number(height)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return
    const nextWidth = ideClamp(Math.round(w), IDE_FLOAT_MIN_WIDTH, IDE_FLOAT_MAX_WIDTH)
    const nextHeight = ideClamp(Math.round(h), IDE_FLOAT_MIN_HEIGHT, IDE_FLOAT_MAX_HEIGHT)
    ideWritePrefs({ floatWidth: nextWidth, floatHeight: nextHeight })
    patch({
      floatDefaultWidth: nextWidth,
      floatDefaultHeight: nextHeight,
      floatWidth: nextWidth,
      floatHeight: nextHeight,
    })
  }

  /** Remember the size the user dragged the card to. */
  function setFloatSize(width, height) {
    const w = Number(width)
    const h = Number(height)
    if (!Number.isFinite(w) || !Number.isFinite(h)) return
    const state = getState()
    const nextW = Math.round(w)
    const nextH = Math.round(h)
    if (state.floatWidth === nextW && state.floatHeight === nextH) return
    patch({ floatWidth: nextW, floatHeight: nextH })
  }

  /** Keep the card on screen outside the code workspace (persisted). */
  function setFloatDetached(floatDetached) {
    const next = floatDetached === true
    if (state.floatDetached === next) return
    ideWritePrefs({ floatDetached: next })
    patch({ floatDetached: next })
    // Turning it on while away from the workspace brings it back immediately.
    if (next) patch({ floatOpen: true, floatClosed: false })
  }

  /**
   * 悬浮卡要不要跟着当前会话走（持久化，默认跟）。
   * 关掉的瞬间把当前会话钉住，否则「当前会话」一变它又跟着跑了。
   */
  function setFloatFollow(floatFollow) {
    const next = floatFollow !== false
    if (state.floatFollow === next) return
    ideWritePrefs({ floatFollow: next })
    // 关掉时把当前会话钉住；重新打开跟随就把钉子清掉，避免下次关掉时用旧值。
    patch(next ? { floatFollow: true, floatSessionId: null } : { floatFollow: false, floatSessionId: state.sessionId })
  }

  /** 不跟随时，卡片自己选中的会话（`null` = 还没有手动选过）。 */
  function setFloatSessionId(floatSessionId) {
    const next = typeof floatSessionId === 'string' && floatSessionId !== '' ? floatSessionId : null
    if (state.floatSessionId === next) return
    patch({ floatSessionId: next })
  }

  /** Turn the floating card on or off (persisted). */
  function setFloatEvents(floatEvents) {
    const next = floatEvents === true
    if (state.floatEvents === next) return
    ideWritePrefs({ floatEvents: next })
    patch({ floatEvents: next })
  }

  function setFloatEnabled(floatEnabled) {
    const next = floatEnabled === true
    if (state.floatEnabled === next) return
    ideWritePrefs({ floatEnabled: next })
    patch({ floatEnabled: next, floatClosed: false })
  }

  /**
   * Close the card for the rest of this run.
   *
   * Deliberately not persisted: the request was "hidden until DSH restarts", so
   * a new process shows it again.
   */
  function setFloatClosed(floatClosed) {
    const next = floatClosed === true
    if (state.floatClosed === next) return
    patch({ floatClosed: next })
  }

  /** Hand one reference to the floating card; it appends it to its draft. */
  function setFloatInsert(floatInsert) {
    patch({ floatInsert })
  }

  /** Ask the source view to open its find bar with `query` (one-shot). */
  function setFindRequest(findRequest) {
    patch({ findRequest })
  }

  /** Fold the card into its ball, or unfold it. */
  function setFloatCollapsed(collapsed) {
    const next = collapsed === true
    if (state.floatCollapsed === next) return
    patch({ floatCollapsed: next })
  }

  /**
   * Adopt the Session on screen. The tracker calls this while the Conversation
   * is still the main panel; the value then stays put while a global panel
   * takes the column.
   */
  function rememberSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '' || state.sessionId === sessionId) return
    patch({ sessionId })
    restart({ keepView: state.rootPath !== '' && state.tabs.length > 0 })
  }

  /**
   * Switch to another project in one step.
   *
   * The Session and its root are patched together and restarted once. Patching
   * the Session first reloaded the old tabs against the new Session's scope,
   * which the file Remote refused as `outside-workspace` — a red error that
   * covered the panel for one frame before the new workspace appeared.
   */
  function enterProject(rootPath, sessionId) {
    // The panel speaks POSIX paths everywhere; a Session may report a native
    // one (`C:\work\app`), so it is normalised on the way in.
    const nextRoot = typeof rootPath === 'string' ? idePlatform.toPosix(rootPath).replace(/\/+$/, '') : ''
    if (nextRoot === '') return
    const nextSession = typeof sessionId === 'string' && sessionId !== '' ? sessionId : state.sessionId
    if (nextRoot === state.rootPath && nextSession === state.sessionId) return
    patch({ rootPath: nextRoot, sessionId: nextSession })
    restart({ restore: true })
  }

  /** Adopt the absolute workspace root the Session list reports for that Session. */
  function setRoot(rootPath) {
    const nextRoot = typeof rootPath === 'string' ? idePlatform.toPosix(rootPath).replace(/\/+$/, '') : ''
    if (nextRoot === '' || state.rootPath === nextRoot) return
    patch({ rootPath: nextRoot })
    restart({ restore: true })
  }

  /** Expand or collapse one directory; expansion subscribes it to changes. */
  function toggleDir(path) {
    const open = state.expanded.includes(path)
    if (open) {
      unwatchDir(path)
      patch({ expanded: state.expanded.filter((entry) => entry !== path) })
      return
    }
    patch({ expanded: [...state.expanded, path] })
    loadDir(path)
    watchDir(path)
  }

  /** Relist one directory and everything below it. */
  function refreshDir(path) {
    void loadDir(path, { force: true, cascade: true })
  }

  /** Collapse every directory at once. */
  function collapseAll() {
    for (const path of state.expanded) unwatchDir(path)
    patch({ expanded: [] })
  }

  /** Whether an "expand all" walk is already running. */
  let expandingAll = false

  /**
   * Expand every directory, breadth first, within a budget.
   *
   * The tree is lazy, so a level has to be listed before its children exist;
   * the walk patches after each level so rows appear while it runs, and stops
   * at `IDE_MAX_EXPANDED_DIRS` so a huge workspace cannot lock the panel.
   *
   * @returns whether the budget capped the walk.
   */
  async function expandAll() {
    if (expandingAll) return false
    expandingAll = true
    try {
      const open = new Set(state.expanded)
      let level = ['']
      let capped = false
      while (level.length > 0) {
        const next = []
        const added = []
        for (const dir of level) {
          if (dir !== '' && (dirOf(dir).status !== 'ready')) await loadDir(dir)
          for (const entry of dirOf(dir).entries ?? []) {
            if (entry.type !== 'directory') continue
            if (open.has(entry.path)) {
              next.push(entry.path)
              continue
            }
            if (open.size >= IDE_MAX_EXPANDED_DIRS) {
              capped = true
              break
            }
            open.add(entry.path)
            added.push(entry.path)
            next.push(entry.path)
            watchDir(entry.path)
          }
          if (capped) break
        }
        if (added.length > 0) patch({ expanded: [...state.expanded, ...added] })
        if (capped) break
        level = next
      }
      return capped
    } finally {
      expandingAll = false
    }
  }

  /**
   * Expand the active file's ancestors and ask the tree to scroll to it.
   *
   * @returns false when there is no workspace file to reveal (no tab, or a jar tab).
   */
  function revealActive() {
    const path = state.activePath
    if (path === '' || path.startsWith('#jar#')) return false
    const ancestors = ideAncestorDirs(path)
    const missing = ancestors.filter((dir) => !state.expanded.includes(dir))
    for (const dir of missing) {
      watchDir(dir)
      void loadDir(dir)
    }
    if (missing.length > 0) patch({ expanded: [...state.expanded, ...missing] })
    patch({ revealFile: { path, stamp: Date.now() } })
    return true
  }

  /** Reload the whole tree, keeping which directories are expanded. */
  /**
   * Open a class source that lives inside a Maven jar.
   *
   * These tabs are synthetic: their `path` is not a workspace path, the text is
   * already loaded, and nothing may reload or diff them.
   */
  function openJarSource(entry) {
    const className = typeof entry?.className === 'string' ? entry.className : ''
    if (className === '') return false
    const path = `#jar#${className}`
    const jarName = String(entry.jar ?? '').split('/').pop() ?? ''
    const split = ideSplitPath(className.replace(/\./g, '/'))
    const line = Number.isFinite(entry.line) && entry.line > 0 ? Math.round(entry.line) : null
    const text = String(entry.text ?? '')
    const lines = text === '' ? 0 : text.split('\n').length
    const existing = state.tabs.some((tab) => tab.path === path)
    if (!existing) {
      recordHistory()
      const tabs = [...state.tabs, {
        path,
        name: `${split.name}.java`,
        dir: jarName,
        kind: 'jar',
        status: 'ready',
        text,
        lines,
        bytes: text.length,
        version: '',
        truncated: false,
        error: '',
        reveal: line,
      }]
      patch({ tabs, activePath: path })
    } else {
      patch({ activePath: path })
      if (line !== null) putTab(path, { reveal: line, revealApplied: undefined })
    }
    return true
  }

  /** Remember where a tab was scrolled to. */
  function rememberScroll(path, top) {
    if (typeof path !== 'string' || path === '') return
    if (!Number.isFinite(top) || top < 0) return
    if (state.scroll[path] === top) return
    patch({ scroll: { ...state.scroll, [path]: Math.round(top) } })
  }

  /** Mark a `reveal` line as already applied, so a remount restores the scroll. */
  function setRevealApplied(path, line) {
    const tab = state.tabs.find((entry) => entry.path === path)
    if (tab === undefined || tab.revealApplied === line) return
    putTab(path, { revealApplied: line })
  }

  /**
   * Read one workspace file's lines without attaching them to a tab.
   *
   * The call chain asks for the declarations above a call site; that file may
   * not be open, and nothing here should change the editor.
   */
  async function readLines(path) {
    const face = files()
    const sessionId = state.sessionId
    if (face === undefined || sessionId === null || sessionId === undefined) return []
    if (state.rootPath === '' || typeof path !== 'string' || path === '') return []
    const absolutePath = ideAbs(state.rootPath, path)
    const lines = []
    let offset = 1
    for (let page = 0; page < 64; page += 1) {
      const result = await ideCall(face, 'read', [sessionId, absolutePath, { offset }, new AbortController().signal])
      if (!result.ok) return lines
      const value = result.value
      if (value.lines <= 0) return lines
      for (const line of String(value.text).split('\n')) lines.push(line)
      if (value.eof === true || lines.length >= IDE_MAX_LINES) return lines
      offset += value.lines
    }
    return lines
  }

  /**
   * Re-read the active file (content and its git hunks).
   *
   * Called when the window regains focus: a commit changes git's view of the
   * file without changing its bytes, so no change frame arrives.
   */
  function reloadActive() {
    const tab = state.tabs.find((entry) => entry.path === state.activePath)
    if (tab === undefined || tab.kind === 'jar') return
    void loadTabFile(tab, { silent: true })
  }

  /** Re-read every open tab, whatever its state. */
  function refreshTabs() {
    for (const tab of state.tabs) {
      if (tab.kind === 'jar') continue
      void loadTabFile(tab)
    }
  }

  /**
   * Refresh the file tree's VCS colouring.
   *
   * One `git status` call, throttled: several change frames often arrive in a
   * burst while an agent writes a patch.
   */
  let vcsTimer
  async function refreshVcs() {
    const root = state.rootPath
    if (root === '') return
    const found = await ideStatusQuery(root)
    if (disposed || state.rootPath !== root) return
    const next = {}
    if (found.ok === true) {
      for (const entry of found.files) {
        if (typeof entry?.path !== 'string' || entry.path === '') continue
        next[entry.path] = String(entry.status ?? '')
      }
    }
    patch({ vcs: next })
  }

  /** Debounced `refreshVcs` for change frames. */
  function scheduleVcs() {
    if (vcsTimer !== undefined) return
    vcsTimer = setTimeout(() => {
      vcsTimer = undefined
      void refreshVcs()
    }, 250)
  }

  function refreshAll() {
    patch({ liveNotice: '' })
    for (const path of state.expanded.slice()) void loadDir(path, { force: true })
    void loadDir('', { force: true })
    refreshTabs()
    void refreshVcs()
  }

  /** Open one workspace file in a tab, or focus its existing tab. */
  function openFile(path, options = {}) {
    const reveal = typeof options.line === 'number' && Number.isFinite(options.line) && options.line > 0
      ? Math.floor(options.line)
      : null
    const existing = state.tabs.some((entry) => entry.path === path)
    if (!existing) {
      const split = ideSplitPath(path)
      const tab = {
        path,
        name: split.name,
        dir: split.dir,
        status: 'loading',
        text: '',
        lines: 0,
        bytes: 0,
        version: '',
        truncated: false,
        error: '',
        reveal,
      }
      const tabs = [...state.tabs, tab]
      patch({ tabs, activePath: path })
      tabByAbsolute.set(ideAbs(state.rootPath, path), path)
      void loadTabFile(tab)
    } else {
      patch({ activePath: path })
      // Re-requesting the same line is still a jump: clearing the applied marker
      // is what makes the view scroll to it a second time.
      if (reveal !== null) putTab(path, { reveal, revealApplied: undefined })
    }
  }

  /**
   * Open a file at one line, expanding the directories above it so the tree
   * reveals the file too.
   *
   * @param path - absolute or workspace-relative path.
   * @param line - 1-based line to scroll to and highlight.
   * @returns `true` when the path is inside the workspace and was opened.
   */
  function openAt(path, line, options = {}) {
    const relative = ideRelativeTo(state.rootPath, path)
    if (relative === null || relative === '') return false
    if (options.record !== false) recordHistory()
    // Going back to a place the user had scrolled to: seed the offset first, so
    // the code view mounts straight there instead of at the top of the file.
    if (typeof options.top === 'number' && options.top > 0) {
      patch({
        scroll: { ...state.scroll, [relative]: Math.round(options.top) },
        tabs: state.tabs.map((tab) => (tab.path === relative ? { ...tab, reveal: 0, revealApplied: 0 } : tab)),
      })
      openFile(relative, { line: 0 })
      void Promise.resolve().then(() => revealInTree(relative))
      return true
    }
    // The tab is what the user is waiting for. Revealing the file in the tree
    // costs a remote listing and a change subscription per ancestor level, so it
    // runs after the tab is up instead of gating the jump.
    openFile(relative, { line })
    void Promise.resolve().then(() => revealInTree(relative))
    return true
  }

  /** Expand every ancestor directory of a path, without blocking navigation. */
  function revealInTree(relative) {
    for (const dir of ideAncestorDirs(relative)) {
      if (!state.expanded.includes(dir)) toggleDir(dir)
    }
  }

  /** Close one tab; closing the active tab activates its right neighbour. */
  function closeTab(path) {
    const index = state.tabs.findIndex((entry) => entry.path === path)
    if (index < 0) return
    const tabs = state.tabs.filter((entry) => entry.path !== path)
    tabByAbsolute.delete(ideAbs(state.rootPath, path))
    const activePath = state.activePath === path
      ? (tabs[Math.min(index, tabs.length - 1)]?.path ?? null)
      : state.activePath
    patch({ tabs, activePath })
  }

  /** Close every tab except one. */
  function closeOtherTabs(path) {
    const tabs = state.tabs.filter((entry) => entry.path === path)
    tabByAbsolute.clear()
    if (tabs.length > 0) tabByAbsolute.set(ideAbs(state.rootPath, path), path)
    patch({ tabs, activePath: path })
  }

  /** Close every tab. */
  function closeAllTabs() {
    tabByAbsolute.clear()
    patch({ tabs: [], activePath: null })
  }

  /**
   * Close tabs by predicate, keeping the active one sensible.
   *
   * One implementation serves 「关闭其他 / 关闭右侧 / 关闭未修改 / 关闭只读」: the
   * difference is only which tabs the predicate keeps.
   */
  function closeTabsWhere(keep) {
    const tabs = state.tabs.filter(keep)
    if (tabs.length === state.tabs.length) return
    const kept = new Set(tabs.map((tab) => tab.path))
    for (const tab of state.tabs) {
      if (!kept.has(tab.path)) tabByAbsolute.delete(ideAbs(state.rootPath, tab.path))
    }
    const activePath = tabs.some((tab) => tab.path === state.activePath)
      ? state.activePath
      : (tabs[tabs.length - 1]?.path ?? null)
    patch({ tabs, activePath })
  }

  /** Close every tab except `path`; an unknown path closes nothing. */
  function closeOthers(path) {
    if (!state.tabs.some((tab) => tab.path === path)) return
    closeTabsWhere((tab) => tab.path === path)
  }

  /** Close every tab to the right of `path`. */
  function closeToRight(path) {
    const index = state.tabs.findIndex((tab) => tab.path === path)
    if (index < 0) return
    const kept = new Set(state.tabs.slice(0, index + 1).map((tab) => tab.path))
    closeTabsWhere((tab) => kept.has(tab.path))
  }

  /** Close every tab to the left of `path`. */
  function closeToLeft(path) {
    const index = state.tabs.findIndex((tab) => tab.path === path)
    if (index < 0) return
    const kept = new Set(state.tabs.slice(index).map((tab) => tab.path))
    closeTabsWhere((tab) => kept.has(tab.path))
  }

  /** Close the jar tabs: they are the read-only rows this panel can open. */
  function closeReadOnly() {
    closeTabsWhere((tab) => tab.kind !== 'jar')
  }

  /** Close every tab whose file the editor never modified (all of them: read-only). */
  function closeUnmodified() {
    closeTabsWhere(() => false)
  }

  /**
   * Open one context menu and close the others.
   *
   * `null` only closes the named menu. Opening one used to leave a previously
   * opened menu alive: a stale tab menu stayed on screen (and its backdrop on
   * top), so the next right click landed on the old menu instead of the thing
   * the user aimed at.
   */
  const IDE_MENU_KEYS = ['tabMenu', 'treeMenu', 'codeMenu', 'codeSymbolMenu']
  function patchMenu(key, menu) {
    const next = menu === null || menu === undefined ? null : menu
    const cleared = {}
    if (next !== null) {
      for (const other of IDE_MENU_KEYS) if (other !== key) cleared[other] = null
    }
    patch({ ...cleared, [key]: next })
  }

  /** Close every context menu (Escape, a tab switch, a new selection). */
  function closeMenus() {
    patch({ tabMenu: null, treeMenu: null, codeMenu: null, codeSymbolMenu: null })
  }

  /** Open or close the tab context menu. */
  function setTabMenu(menu) {
    patchMenu('tabMenu', menu)
  }

  /** Open or close the code-gutter context menu. */
  function setCodeMenu(menu) {
    patchMenu('codeMenu', menu)
  }

  /** Remember the symbol just clicked, for shortcuts that act on it later. */
  function setLastSymbol(entry) {
    const next = entry === undefined || entry === null
      ? null
      : { path: String(entry.path ?? ''), line: Number(entry.line) || 0, symbol: String(entry.symbol ?? '') }
    if (next !== null && (next.path === '' || next.symbol === '')) return
    const current = getState().lastSymbol
    const same = current !== null && next !== null
      && current.path === next.path && current.line === next.line && current.symbol === next.symbol
    if (current === next || same) return
    patch({ lastSymbol: next })
  }

  /** Open or close the context menu of one symbol in the source. */
  function setCodeSymbolMenu(menu) {
    patchMenu('codeSymbolMenu', menu)
  }

  /** Open or close the file-tree context menu. */
  function setTreeMenu(menu) {
    patchMenu('treeMenu', menu)
  }

  /** Open or close the file-tree overlay (difference text or a picker). */
  function setTreePopup(popup) {
    patch({ treePopup: popup === null || popup === undefined ? null : popup })
  }

  /** Turn the Git annotate gutter on or off for one file. */
  function toggleAnnotate(path) {
    if (typeof path !== 'string' || path === '') return
    const next = { ...(state.annotate ?? {}) }
    if (next[path] === true) delete next[path]
    else next[path] = true
    patch({ annotate: next })
  }

  /** Activate one tab. */
  function activateTab(path) {
    if (path !== state.activePath) recordHistory()
    patch({ activePath: path })
  }

  /** Show or hide the tree column. */
  function setTreeVisible(visible) {
    ideWritePrefs({ treeVisible: visible })
    patch({ treeVisible: visible })
  }

  /** Resize the tree column. */
  function setTreeWidth(width) {
    const next = ideClamp(Math.round(width), 190, 560)
    patch({ treeWidth: next })
    ideWritePrefs({ treeWidth: next })
  }

  /**
   * Drive the workspace-wide search behind the tree's search box.
   *
   * The Host searches entry names (or `/`-joined paths when the query contains
   * one) through its own file index, so this finds files that were never
   * expanded in the tree. Typing is debounced and only the newest answer is
   * applied, so a slow search can never overwrite a newer one.
   */
  function setFilter(filter) {
    patch({ filter })
    if (searchTimer !== undefined) clearTimeout(searchTimer)
    const query = filter.trim()
    if (query === '') {
      searchToken += 1
      patch({ search: { status: 'idle', query: '', matches: [], truncated: false, error: '' } })
      return
    }
    searchTimer = setTimeout(() => { void runSearch(query) }, IDE_SEARCH_DEBOUNCE_MS)
  }

  /**
   * One workspace-wide file search, as a plain result.
   *
   * Shared by the tree's search box and the palette; callers own their own
   * staleness handling.
   */
  async function searchFiles(query) {
    const face = files()
    const sessionId = state.sessionId
    if (face === undefined || sessionId === null || sessionId === undefined) {
      return { ok: false, error: 'workspace-files-unavailable' }
    }
    const result = await ideCall(face, 'search', [sessionId, {
      query,
      excludedPaths: [],
      includeHidden: false,
      respectGitignore: true,
    }, new AbortController().signal])
    if (!result.ok) return { ok: false, error: result.error }
    const matches = (result.value.matches ?? []).filter((entry) => entry.type === 'file')
    return { ok: true, matches, truncated: result.value.truncated === true }
  }

  /** Run one workspace search and apply it if it is still the newest one. */
  async function runSearch(query) {
    const token = ++searchToken
    patch({ search: { status: 'loading', query, matches: [], truncated: false, error: '' } })
    const found = await searchFiles(query)
    if (token !== searchToken || disposed) return
    if (found.ok !== true) {
      patch({ search: { status: 'error', query, matches: [], truncated: false, error: found.error } })
      return
    }
    patch({
      search: {
        status: 'ready',
        query,
        matches: found.matches,
        truncated: found.truncated === true,
        error: '',
      },
    })
  }

  /**
   * Point the panel at a chosen project root, or back at the Session's own.
   *
   * The Remote file methods address absolute paths, so a switched project needs
   * no other Session; only the relative-path vocabulary follows the new root.
   */


  /**
   * The active tab's position, which is what history entries remember.
   *
   * `line` alone is not the reader's position: it is only the last *jump*
   * target, so a file the user scrolled through by hand remembered line 1 and
   * going back dropped them at the top of the file. The scroll offset is where
   * they actually were, so it travels with the entry.
   */
  function currentPosition() {
    const tab = state.tabs.find((entry) => entry.path === state.activePath)
    if (tab === undefined) return undefined
    const top = state.scroll[tab.path]
    return {
      path: tab.path,
      line: typeof tab.reveal === 'number' && tab.reveal > 0 ? tab.reveal : 1,
      top: typeof top === 'number' && top > 0 ? top : 0,
    }
  }

  /** Push the current position before a navigation step. */
  function recordHistory() {
    const position = currentPosition()
    if (position === undefined) return
    const back = [...state.historyBack, position]
    const trimmed = back.length > IDE_HISTORY_LIMIT ? back.slice(back.length - IDE_HISTORY_LIMIT) : back
    patch({ historyBack: trimmed, historyForward: [] })
  }

  /** Move through the history; `direction` is -1 for back, +1 for forward. */
  function stepHistory(direction) {
    const from = direction < 0 ? state.historyBack : state.historyForward
    if (from.length === 0) return false
    const target = from[from.length - 1]
    const rest = from.slice(0, -1)
    const current = currentPosition()
    const opposite = direction < 0 ? state.historyForward : state.historyBack
    const nextOpposite = current === undefined ? opposite : [...opposite, current].slice(-IDE_HISTORY_LIMIT)
    patch({
      historyBack: direction < 0 ? rest : nextOpposite,
      historyForward: direction < 0 ? nextOpposite : rest,
    })
    // Replaying a history entry is not itself a navigation step.
    openAt(target.path, target.line, { record: false, top: target.top })
    return true
  }

  const goBack = () => stepHistory(-1)
  const goForward = () => stepHistory(1)

  /** Open or close the Search Everywhere palette. */
  function setPaletteOpen(paletteOpen) {
    patch({ paletteOpen })
  }

  /** Turn live refresh on or off (off also drops every stream). */
  function setWatching(watching) {
    if (watching === state.watching) return
    patch({ watching, liveNotice: '' })
    if (!watching) {
      for (const [path] of watchers) unwatchDir(path)
      return
    }
    if (state.rootPath !== '') watchDir('')
    for (const path of state.expanded) watchDir(path)
  }

  /** Release every stream this store owns. */
  function dispose() {
    disposed = true
    for (const [path] of watchers) unwatchDir(path)
    listeners.clear()
  }

  return {
    subscribe,
    getState,
    rememberSession,
    setFloatOpen,
    setFloatCollapsed,
    setFloatPoint,
    setFloatSize,
    setFloatDefaultSize,
    setFloatEnabled,
    setFloatFollow,
    setFloatSessionId,
    setFloatEvents,
    setFloatDetached,
    setFloatClosed,
    setFloatInsert,
    setFindRequest,
    setRoot,
    enterProject,
    layout: () => refs.layout?.current,
    /** List one workspace directory (index support); unwrapped `RemoteResult`. */
    listPath: (sessionId, root, relativePath) => {
      const face = files()
      if (face === undefined) return Promise.resolve({ ok: false, error: 'workspace-files-unavailable' })
      return ideCall(face, 'list', [sessionId, ideAbs(root, relativePath), new AbortController().signal])
    },
    /** Read one workspace file as text, following pages; `{ ok, value: text }`. */
    readText: async (sessionId, root, relativePath) => {
      const face = files()
      if (face === undefined) return { ok: false, error: 'workspace-files-unavailable' }
      const absolutePath = ideAbs(root, relativePath)
      let text = ''
      let offset = 1
      for (let page = 0; page < 4; page += 1) {
        const result = await ideCall(face, 'read', [sessionId, absolutePath, { offset }, new AbortController().signal])
        if (!result.ok) return result
        const value = result.value
        if (value.lines > 0) text = text === '' ? value.text : `${text}\n${value.text}`
        if (value.eof === true || value.lines <= 0) break
        offset += value.lines
      }
      return { ok: true, value: text }
    },
    /** Publish index progress for the status bar. */
    setIndexInfo: (indexInfo) => patch({ indexInfo }),
    markRemoteReady: () => patch({ remoteReady: true }),
    /** Turn reference interception on or off (persisted). */
    /** Open or close the palette popup. */
    setThemeMenu: (themeMenu) => patch({ themeMenu }),
    /** Show, replace or clear the screenshot dialog. */
    setScreenshot: (screenshot) => patch({ screenshot }),
    /** Switch the panel palette; an empty id goes back to the DSH colours. */
    setTheme: (theme) => {
      ideWritePrefs({ theme })
      patch({ theme })
    },
    /** Change the editor font size, clamped to a readable range. */
    setCodeFontSize: (size) => {
      const codeFontSize = Math.min(24, Math.max(10, Math.round(size * 2) / 2))
      ideWritePrefs({ codeFontSize })
      patch({ codeFontSize })
    },
    /** Change the file tree font size, clamped to a readable range. */
    setTreeFontSize: (size) => {
      const treeFontSize = Math.min(24, Math.max(10, Math.round(size * 2) / 2))
      ideWritePrefs({ treeFontSize })
      patch({ treeFontSize })
    },
    setJumpEnabled: (jumpEnabled) => {
      ideWritePrefs({ jumpEnabled })
      patch({ jumpEnabled })
    },
    /** Point dependency-source lookups at another Maven repository. */
    setMavenRepo: (path) => {
      const mavenRepo = typeof path === 'string' ? path.trim() : ''
      ideMavenRepoPref = mavenRepo
      ideWritePrefs({ mavenRepo })
      patch({ mavenRepo })
    },
    /** Remember the repository the Host detected (settings hint only). */
    setMavenRepoDetected: (mavenRepoDetected, mavenRepoDetectedExists = true) => {
      if (typeof mavenRepoDetected !== 'string' || mavenRepoDetected === '') return
      if (mavenRepoDetected === state.mavenRepoDetected && mavenRepoDetectedExists === state.mavenRepoDetectedExists) return
      patch({ mavenRepoDetected, mavenRepoDetectedExists: mavenRepoDetectedExists === true })
    },
    /** Store one keyboard binding, or `null` to fall back to the default. */
    setShortcutBinding: (id, binding) => {
      if (typeof id !== 'string' || id === '') return
      const shortcutBindings = { ...state.shortcutBindings }
      if (binding === null) delete shortcutBindings[id]
      else shortcutBindings[id] = binding
      ideWritePrefs({ shortcutBindings })
      patch({ shortcutBindings })
    },
    /** Open or close the shortcut editor inside General settings. */
    setGestureEditor: (open) => {
      patch({ gestureEditorOpen: open === true, gestureIssue: '' })
    },
    /** Enter or leave key capture for one command. */
    setGestureRecording: (id) => {
      patch({ gestureRecording: typeof id === 'string' ? id : '' })
    },
    /** Explain a refused gesture change. */
    setGestureIssue: (issue) => {
      patch({ gestureIssue: typeof issue === 'string' ? issue : '' })
    },
    /** Change one navigation gesture; the actions must stay distinct. */
    setGesture: (which, value) => {
      if (which !== 'definition' && which !== 'usages' && which !== 'chain') return false
      if (!['double', 'meta', 'ctrl', 'alt'].includes(value)) return false
      const others = ['definition', 'usages', 'chain'].filter((key) => key !== which)
      if (others.some((key) => state.gestures[key] === value)) return false
      const gestures = { ...state.gestures, [which]: value }
      ideWritePrefs({ gestures })
      patch({ gestures })
      return true
    },
    /** Put a line in the panel's notice banner (empty clears it). */
    setNotice: (liveNotice) => {
      // A notice is the only symptom most failures have, so quote it in a report.
      if (typeof liveNotice === 'string' && liveNotice !== '') ideLogRecord('notice', 'ui', liveNotice)
      patch({ liveNotice })
    },
    /** Re-read everything the panel shows; the panel also re-resolves its target. */
    retryResolve: () => restart(),
    toggleDir,
    expandAll,
    collapseAll,
    revealActive,
    refreshDir,
    refreshAll,
    refreshTabs,
    reloadActive,
    refreshVcs,
    readLines,
    rememberScroll,
    setRevealApplied,
    openFile,
    openAt,
    closeTab,
    closeOthers,
    closeToRight,
    closeToLeft,
    closeReadOnly,
    closeUnmodified,
    setTabMenu,
    closeMenus,
    setTreeMenu,
    setTreePopup,
    setCodeMenu,
    setCodeSymbolMenu,
    setLastSymbol,
    toggleAnnotate,
    closeOtherTabs,
    closeAllTabs,
    activateTab,
    setTreeVisible,
    setTreeWidth,
    setFilter,
    searchFiles,
    setPaletteOpen,
    restoreView,
    openJarSource,
    goBack,
    goForward,
    setWatching,
    dispose,
  }
}

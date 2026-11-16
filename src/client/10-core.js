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
function ideWritePrefs(patch) {
  try {
    const next = { ...ideReadPrefs(), ...patch }
    globalThis.localStorage?.setItem(IDE_PREFS_KEY, JSON.stringify(next))
  } catch {
    /* a browser with storage disabled simply forgets geometry */
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

/** Join an absolute directory and a workspace-relative path. */
function ideAbs(root, path) {
  if (path === '' || path === undefined || path === null) return root
  if (root === '') return path
  return `${root.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * Turn an absolute path (what the Host and the resource addresses speak) into a
 * workspace-relative one, so a reference can be matched against tree entries.
 *
 * @returns the relative path, or `null` when the path lies outside the root.
 */
function ideRelativeTo(root, path) {
  if (typeof path !== 'string' || path === '') return null
  const trimmedRoot = String(root ?? '').replace(/\/+$/, '')
  if (trimmedRoot === '') return path.startsWith('/') ? null : path
  if (path === trimmedRoot) return ''
  if (path.startsWith(`${trimmedRoot}/`)) return path.slice(trimmedRoot.length + 1)
  return path.startsWith('/') ? null : path
}

/** Split a path into its dimmed directory and the file name. */
function ideSplitPath(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? { dir: '', name: path } : { dir: path.slice(0, index + 1), name: path.slice(index + 1) }
}

/** Ancestors of a workspace path, shallowest first: `a/b/C.java` → `a`, `a/b`. */
function ideAncestorDirs(path) {
  const parts = String(path ?? '').split('/')
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
function ideParent(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** Basename of an absolute or workspace path. */
function ideBasename(path) {
  const trimmed = String(path ?? '').replace(/\/+$/, '')
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

/** Words the tokenizer paints as keywords — the shapes this plugin realistically shows. */
const IDE_KEYWORDS = new Set((
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
  'final finally float for goto if implements import instanceof int interface long native new package private ' +
  'protected public return short static strictfp super switch synchronized this throw throws transient try void ' +
  'volatile while true false null var let function typeof delete in of export async await yield type namespace ' +
  'declare module readonly string number any unknown never object fun val when is as try catch finally ' +
  'func go defer chan map range select struct fallthrough pub fn mut impl trait match loop ' +
  'where unsafe use mod crate self Self static ref dyn override sealed record permits non-sealed ' +
  'get set constructor undefined extends implements readonly satisfies keyof infer asserts'
).split(/\s+/).filter(Boolean))

/** Languages whose `#` starts a line comment. */
const IDE_HASH_COMMENT = new Set(['py', 'sh', 'bash', 'zsh', 'yaml', 'yml', 'rb', 'toml', 'conf', 'properties', 'dockerfile'])

/** Languages that never carry useful tokens here. */
const IDE_PLAIN_LANGS = new Set(['md', 'txt', 'log', 'csv', 'tsv', 'lock'])

/**
 * Split one code line into coloured runs.
 * @param text - the source line.
 * @param lang - language id from {@link ideLangOf}.
 * @returns `{ text, cls }` runs; a single plain run when nothing matches.
 */
function ideTokenize(text, lang) {
  if (text === '' || IDE_PLAIN_LANGS.has(lang) || text.length > 1200) return [{ text, cls: '' }]
  const hashComments = IDE_HASH_COMMENT.has(lang)
  const trimmed = text.trimStart()
  if (trimmed.startsWith('*') || trimmed.startsWith('*/') || trimmed.startsWith('//') || (hashComments && trimmed.startsWith('#'))) {
    return [{ text, cls: 'iw-com' }]
  }
  if (trimmed.startsWith('/*') && trimmed.indexOf('*/') < 0) return [{ text, cls: 'iw-com' }]

  const runs = []
  const push = (value, cls) => {
    if (value === '') return
    const last = runs[runs.length - 1]
    if (last !== undefined && last.cls === cls) last.text += value
    else runs.push({ text: value, cls })
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
      push(text.slice(index, end), 'iw-str')
      index = end
      continue
    }
    if (quote === '/' && rest[1] === '/') {
      push(rest, 'iw-com')
      break
    }
    if (quote === '@' && /[A-Za-z]/.test(rest[1] ?? '')) {
      const match = /^@[A-Za-z_][\w.]*/.exec(rest)
      push(match[0], 'iw-ann')
      index += match[0].length
      continue
    }
    if (hashComments && quote === '#') {
      push(rest, 'iw-com')
      break
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest)
    if (word !== null) {
      const value = word[0]
      if (IDE_KEYWORDS.has(value)) push(value, 'iw-kw')
      else if (/^[A-Z]/.test(value)) push(value, 'iw-type')
      else if (text[index + value.length] === '(') push(value, 'iw-fn')
      else push(value, '')
      index += value.length
      continue
    }
    const numeric = /^0[xXbB][0-9a-fA-F_]+|^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[fFdDlL]?/.exec(rest)
    if (numeric !== null) {
      push(numeric[0], 'iw-num')
      index += numeric[0].length
      continue
    }
    push(quote, 'iw-punct')
    index += 1
  }
  return runs
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
  let state = {
    sessionId: null,
    rootPath: '',
    /** True once the `workspaceFiles` Remote face is reachable. */
    remoteReady: false,
    /** The tab context menu, or null: `{ path, x, y }` in panel coordinates. */
    tabMenu: null,
    /** The code-gutter context menu, or null: `{ path, x, y }`. */
    codeMenu: null,
    /** A file the tree should scroll to: `{ path, stamp }`, or null. */
    revealFile: null,
    /** Files shown with Git annotate: `path → true`. */
    annotate: {},
    /** Editor and tree font sizes, in px, shared by the whole workspace. */
    codeFontSize: Number.isFinite(prefs.codeFontSize) ? prefs.codeFontSize : 12.5,
    treeFontSize: Number.isFinite(prefs.treeFontSize) ? prefs.treeFontSize : 14.5,
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
    },
    /** Whether the gesture editor inside General settings is expanded. */
    gestureEditorOpen: false,
    /** Why the last gesture change was refused. */
    gestureIssue: '',
    /** The command currently capturing keys, or ''. */
    gestureRecording: '',
    /** Java index progress: `{ status, done, total }`. */
    indexInfo: { status: 'idle', done: 0, total: 0 },
    /**
     * A project root chosen by the user, overriding the Session-derived one.
     * Empty means "follow the Session", which is the default.
     */
    preferredRoot: typeof prefs.preferredRoot === 'string' ? prefs.preferredRoot : '',
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

  /** Adopt the absolute workspace root the Session list reports for that Session. */
  function setRoot(rootPath) {
    const nextRoot = typeof rootPath === 'string' ? rootPath.replace(/\/+$/, '') : ''
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

  /** Re-read every open tab, whatever its state. */
  function refreshTabs() {
    for (const tab of state.tabs) {
      if (tab.kind === 'jar') continue
      void loadTabFile(tab)
    }
  }

  function refreshAll() {
    patch({ liveNotice: '' })
    for (const path of state.expanded.slice()) void loadDir(path, { force: true })
    void loadDir('', { force: true })
    refreshTabs()
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

  /** Open or close the tab context menu. */
  function setTabMenu(menu) {
    patch({ tabMenu: menu === null || menu === undefined ? null : menu })
  }

  /** Open or close the code-gutter context menu. */
  function setCodeMenu(menu) {
    patch({ codeMenu: menu === null || menu === undefined ? null : menu })
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
  function setPreferredRoot(rootPath) {
    const next = typeof rootPath === 'string' ? rootPath.replace(/\/+$/, '') : ''
    if (next === state.preferredRoot) return
    patch({ preferredRoot: next })
    ideWritePrefs({ preferredRoot: next })
    if (next !== '') setRoot(next)
  }

  /** The active tab's position, which is what history entries remember. */
  function currentPosition() {
    const tab = state.tabs.find((entry) => entry.path === state.activePath)
    if (tab === undefined) return undefined
    return {
      path: tab.path,
      line: typeof tab.reveal === 'number' && tab.reveal > 0 ? tab.reveal : 1,
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
    openAt(target.path, target.line, { record: false })
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
    setRoot,
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
    /** Change one navigation gesture; the two actions must stay distinct. */
    setGesture: (which, value) => {
      if (which !== 'definition' && which !== 'usages') return false
      if (!['double', 'meta', 'alt'].includes(value)) return false
      const other = which === 'definition' ? state.gestures.usages : state.gestures.definition
      if (value === other) return false
      const gestures = { ...state.gestures, [which]: value }
      ideWritePrefs({ gestures })
      patch({ gestures })
      return true
    },
    /** Put a line in the panel's notice banner (empty clears it). */
    setNotice: (liveNotice) => patch({ liveNotice }),
    /** Re-read everything the panel shows; the panel also re-resolves its target. */
    retryResolve: () => restart(),
    toggleDir,
    expandAll,
    collapseAll,
    revealActive,
    refreshDir,
    refreshAll,
    refreshTabs,
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
    setCodeMenu,
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
    setPreferredRoot,
    openJarSource,
    goBack,
    goForward,
    setWatching,
    dispose,
  }
}

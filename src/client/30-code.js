/**
 * The editor column: the tab strip, the breadcrumb and the virtualised source
 * view.
 *
 * Only the rows inside the viewport are mounted, so a several-thousand-line
 * file scrolls at the same cost as a short one — which matters here because the
 * agent rewrites files under the user's eyes and the panel must stay responsive
 * while that happens.
 */

/** Row height of the source view, matching `.iw-line` in the stylesheet. */
const IDE_LINE_HEIGHT = 20

/** Tab width used when measuring the widest line. */
const IDE_TAB_COLUMNS = 4

/** The pinned conversation chip at the head of the tab strip. */
/**
 * The modifier class of a pointer event: `meta` (⌘ on macOS, Ctrl elsewhere),
 * `alt`, `shift`, or `plain` when nothing is held.
 */
function ideGestureOf(event) {
  if (event.metaKey === true) return 'meta'
  if (event.ctrlKey === true) return 'ctrl'
  if (event.altKey === true) return 'alt'
  if (event.shiftKey === true) return 'shift'
  return 'plain'
}

/**
 * Whether a pointer gesture is the one a preference names.
 *
 * Windows and Linux use Ctrl as the primary modifier, so a stored `meta` there
 * means the Ctrl click rather than a second, distinct gesture.
 */
function ideGestureMatches(configured, detected, platform) {
  if (configured === detected) return true
  return platform !== 'macos' && configured === 'meta' && detected === 'ctrl'
}

function IdeChatTab({ onOpen, tr }) {
  return h('div', {
    className: 'iw-tab chat',
    title: tr('backToChatHint'),
    role: 'tab',
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onOpen()
      }
    },
  }, [
    h('span', { key: 'ic', style: { display: 'inline-flex', opacity: 0.75 } }, h(IdeChatIcon, { size: 13 })),
    h('span', { key: 'lb', className: 'iw-tab-label' }, tr('backToChat')),
  ])
}

/** One file tab. */
function IdeFileTab({ tab, kind, active, store, tr }) {
  return h('div', {
    className: `iw-tab${active ? ' active' : ''}`,
    title: tab.path,
    role: 'tab',
    tabIndex: 0,
    'aria-selected': active ? 'true' : 'false',
    onClick: () => store.activateTab(tab.path),
    onAuxClick: (event) => {
      if (event.button === 1) store.closeTab(tab.path)
    },
    // Right click opens the same menu IDEA puts on an editor tab.
    onContextMenu: (event) => {
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      store.setTabMenu({ path: tab.path, x: box.left, y: box.bottom + 2 })
    },
  }, [
    h('span', { key: 'ic', style: { display: 'inline-flex' } }, h(IdeEntryIcon, { name: tab.name, kind })),
    h('span', { key: 'lb', className: 'iw-tab-label' }, tab.name),
    h('button', {
      key: 'cl',
      type: 'button',
      className: 'iw-tab-close',
      title: tr('closeTab'),
      'aria-label': `${tr('closeTab')} ${tab.name}`,
      onClick: (event) => {
        event.stopPropagation()
        store.closeTab(tab.path)
      },
    }, h(IdeCloseIcon, { size: 12 })),
  ])
}

/** The tab strip, led by the conversation chip. */
function IdeTabStrip({ store, state, tr, onBackToChat }) {
  // A file opened from the palette never went through the tree, so the tabs ask
  // for its Java kind themselves; the cache is shared, so this stays one request.
  const [, setKindStamp] = useState(0)
  useEffect(() => {
    const root = state.rootPath
    if (root === '') return undefined
    let cancelled = false
    ideRequestJavaKinds(root, state.tabs.map((tab) => tab.path), () => {
      if (!cancelled) setKindStamp((value) => value + 1)
    })
    return () => { cancelled = true }
  }, [state.tabs, state.rootPath])
  const tabs = state.tabs.map((tab) => h(IdeFileTab, {
    key: tab.path,
    tab,
    kind: ideJavaKinds.get(`${state.rootPath}|${tab.path}`) ?? '',
    active: tab.path === state.activePath,
    store,
    tr,
  }))
  return h('div', { className: 'iw-tabs', role: 'tablist' }, [h(IdeChatTab, { key: 'chat', onOpen: onBackToChat, tr }), ...tabs])
}

/** Dimmable path breadcrumb; the file name is the only non-shrinking part. */
function IdeCrumbs({ path }) {
  const split = ideSplitPath(path)
  const parts = split.dir === '' ? [] : split.dir.replace(/\/$/, '').split('/')
  const directories = []
  parts.forEach((part, index) => {
    directories.push(h('span', { key: `d${index}` }, index === 0 ? part : `/${part}`))
  })
  return h('div', { className: 'iw-crumbs' }, [
    h('span', { key: 'dirs', className: 'iw-crumb-dirs' }, directories),
    parts.length === 0 ? null : h('span', { key: 'sep' }, '/'),
    h('span', { key: 'file', className: 'iw-crumb-file' }, split.name),
  ])
}

/** Measure the widest visual line so the horizontal scrollbar is honest. */
function ideColumnsOf(lines) {
  let widest = 0
  for (const line of lines) {
    const width = line.length + (line.split('\t').length - 1) * (IDE_TAB_COLUMNS - 1)
    if (width > widest) widest = width
    if (widest > 400) return 400
  }
  return widest
}

/** Whether one tokenizer run is a plain identifier the user can follow. */
const IDE_SYMBOL_RUN = /^[A-Za-z_$][\w$]{0,63}$/

/**
 * The clickable symbol inside one tokenizer run.
 *
 * Annotations arrive as a single `@Type` (or `@a.b.Type`) run, so the click has to
 * strip the `@` and point at the simple name: the language server wants the
 * identifier's own position, and without this an annotation is not clickable at
 * all — neither ⌘+click nor double click reaches it.
 *
 * @returns `{ name, offset }` — the symbol and its column inside the run — or
 * `undefined` when the run is not a followable identifier.
 */
function ideSymbolOfRun(run) {
  if (run === undefined || typeof run?.text !== 'string') return undefined
  if (run.cls === 'iw-ann') {
    const raw = run.text.replace(/^@/, '')
    const simple = raw.split('.').pop() ?? ''
    if (!IDE_SYMBOL_RUN.test(simple)) return undefined
    return { name: simple, offset: run.text.length - simple.length }
  }
  if (run.cls === '' || run.cls === 'iw-fn' || run.cls === 'iw-type') {
    if (!IDE_SYMBOL_RUN.test(run.text)) return undefined
    return { name: run.text, offset: 0 }
  }
  return undefined
}

/** One rendered source row. */
function IdeCodeLine({ index, text, lang, hit, vcs, vision, annotate }) {
  // Tokenising is the expensive part of a row; it depends on the text alone, so
  // a highlight change or a notice re-render never repeats it.
  const runs = useMemo(() => ideTokenize(text, lang), [text, lang])
  let column = 0
  const rendered = runs.map((run, order) => {
    const at = column
    column += run.text.length
    const symbol = ideSymbolOfRun(run)
    if (symbol !== undefined) {
      // An identifier (or an annotation's type name): the container's click
      // handler resolves it through LSP.
      return h('span', {
        key: order,
        className: `${run.cls} iw-sym`,
        'data-iw-sym': symbol.name,
        'data-iw-col': at + symbol.offset,
        'data-iw-line': String(index + 1),
      }, run.text)
    }
    if (run.cls === '') return run.text
    return h('span', { key: order, className: run.cls }, run.text)
  })
  return h('div', {
    key: index,
    className: `iw-line${hit === true ? ' hit' : ''}`,
    'data-iw-line': index,
  }, [
    h('span', { key: 'vcs', className: `iw-vcs${vcs === undefined ? '' : ` ${vcs}`}` }),
    annotate === undefined
      ? null
      : h('span', { key: 'ann', className: `iw-blame${annotate.band === 1 ? ' b' : ''}` }, annotate.label),
    h('span', { key: 'ln', className: 'iw-ln' }, String(index + 1)),
    h('span', { key: 'src', className: 'iw-src' }, rendered),
    vision === undefined ? null : h('span', { key: 'vision', className: 'iw-vision' }, vision),
  ])
}

/** One row of the usage popup. */
function IdeUsageRow({ item, kind, onPick }) {
  return h('button', {
    type: 'button',
    className: `iw-usage${kind === 'def' ? ' def' : ''}`,
    title: `${item.path}:${item.line}`,
    onClick: () => onPick(item.path, item.line),
  }, [
    h('span', { key: 'f', className: 'iw-usage-file' }, `${ideBasename(item.path)} ${item.line}`),
    h('span', { key: 's', className: 'iw-usage-text' }, item.snippet ?? ''),
  ])
}

/** One titled group inside the popup: implementations, then callers. */
function IdeUsageSection({ section, onPick }) {
  return h('div', { className: 'iw-pop-section' }, [
    h('div', { key: 'h', className: 'iw-pop-section-head' }, section.title),
    ...section.rows.map((item) => h(IdeUsageRow, {
      key: `${section.key}:${item.path}:${item.line}`,
      item,
      kind: section.key === 'callers' ? 'use' : 'def',
      onPick,
    })),
  ])
}

/**
 * The usage popup: definition candidates, then call sites.
 *
 * It is `position: fixed` so it stays where the pointer is instead of scrolling
 * with the source it describes.
 */
function IdeUsagePopup({ popup, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current !== null && typeof ref.current.focus === 'function') ref.current.focus()
  }, [])
  useEffect(() => {
    const onDown = (event) => {
      const element = event.target
      if (element instanceof Element && element.closest('.iw-pop') !== null) return
      onClose()
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    globalThis.addEventListener('pointerdown', onDown, true)
    globalThis.addEventListener('keydown', onKey, true)
    return () => {
      globalThis.removeEventListener('pointerdown', onDown, true)
      globalThis.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const sections = popup.sections ?? []
  const total = sections.reduce((sum, section) => sum + section.rows.length, 0)
  return h('div', {
    ref,
    tabIndex: -1,
    className: 'iw-pop',
    style: { left: `${popup.x}px`, top: `${popup.y}px` },
    role: 'dialog',
    'aria-label': popup.name,
  }, [
    h('div', { key: 'head', className: 'iw-pop-head' }, [
      h('span', { key: 'n', className: 'iw-pop-name' }, popup.name),
      h('span', {
        key: 'c',
        className: 'iw-pop-count',
        title: popup.phases ?? '',
      }, `${total}${typeof popup.ms === 'number' ? ` · ${popup.ms}ms` : ''}${popup.phases === undefined ? '' : ` (${popup.phases})`}`),
    ]),
    h('div', { key: 'body', className: 'iw-pop-body' }, total === 0
      ? h('div', { key: 'none', className: 'iw-hint' }, popup.empty ?? '')
      : sections.map((section) => h(IdeUsageSection, { key: section.key, section, onPick }))),
  ])
}

/**
 * Line index → change kind, for the gutter bars.
 *
 * `untracked` means git does not know the file yet, which an editor shows as a
 * wholly added file. A pure deletion has no lines of its own, so it marks the
 * boundary after the line that preceded it.
 */
function ideChangeKinds(changes, lineCount) {
  const kinds = new Map()
  if (changes === undefined || changes === null) return kinds
  if (changes.untracked === true) {
    for (let index = 0; index < lineCount; index += 1) kinds.set(index, 'a')
    return kinds
  }
  for (const hunk of Array.isArray(changes.hunks) ? changes.hunks : []) {
    if (typeof hunk?.start !== 'number') continue
    if (hunk.kind === 'deleted') {
      const at = hunk.start - 2
      if (at >= 0) kinds.set(at, 'd')
      continue
    }
    const kind = hunk.kind === 'modified' ? 'm' : 'a'
    for (let line = hunk.start; line <= hunk.end; line += 1) {
      const index = line - 1
      if (index >= 0 && index < lineCount) kinds.set(index, kind)
    }
  }
  return kinds
}

// ---- Code Vision ----------------------------------------------------------
//
// IDEA puts a line's facts next to the declaration: how many places use it,
// how many classes implement it, and who last touched the line. The counts come
// from the LSP seam (two queries per declaration), the author from `git blame`;
// both are cached per file version and fetched only for declarations that are
// on screen, so a scroll costs nothing after the first visit.

/**
 * Method declaration lines between two line indexes, as positions the language
 * server understands.
 *
 * Methods only: a call-site count answers "who uses this behaviour", which is
 * the question a reader has about a method; a field's count would only repeat
 * its accessors. The shape is the symbol search's: a type, then the name. That
 * is what keeps `return foo(` a statement, a constructor (`public Foo(`) out of
 * the list, and a comment or an annotation from ever matching. The leading type
 * is case-sensitive on purpose — a case-insensitive one would accept `return`.
 *
 * @returns `{ index, name, column }`; `index` is 0-based.
 */
function ideDeclarations(lines, from, to) {
  const modifiers = '(?:(?:public|private|protected|static|final|abstract|synchronized|native|transient|volatile|default|strictfp)\\s+)*'
  const type = '(?:[A-Z][\\w$]*(?:<[^>]*>)?(?:\\[\\])*|void|int|long|short|byte|char|boolean|float|double)'
  // Methods live at the class-body level; a local variable inside a method body
  // is indented once more and must not earn a hint.
  const memberIndent = '^[ \t]{0,4}'
  const methodShape = new RegExp(`${memberIndent}${modifiers}(?:${type}\\s+)+([A-Za-z_$][\\w$]*)\\s*\\(`)
  const found = []
  const last = Math.min(to, lines.length)
  for (let index = Math.max(0, from); index < last; index += 1) {
    const text = lines[index]
    const trimmed = text.trimStart()
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('@')) continue
    const match = methodShape.exec(text)
    if (match === null) continue
    const name = match[1]
    found.push({
      index,
      name,
      // The name's own column, not the type's: `Foo Foo(` points at the second.
      column: match.index + match[0].lastIndexOf(name),
    })
  }
  return found
}

/** How the counts read next to a declaration. */
function ideVisionLabel(usages, implementations) {
  const parts = [`${usages} 个用法`]
  if (implementations > 0) parts.push(`${implementations} 个实现`)
  return parts.join(' · ')
}

/** Distinct locations of one query, without the declaration itself. */
function ideVisionCount(locations, path, line) {
  const seen = new Set()
  let count = 0
  for (const location of Array.isArray(locations) ? locations : []) {
    if (typeof location?.path !== 'string') continue
    if (location.path === path && location.line === line) continue
    const key = `${location.path}:${location.line}`
    if (seen.has(key)) continue
    seen.add(key)
    count += 1
  }
  return count
}

/** Counts and blame for one file version, keyed by `${root}|${path}|${version}`. */
const ideVisionCounts = new Map()
const ideBlames = new Map()

/** Queries already issued, so scrolling never repeats one. */
const ideVisionPending = new Set()

/** Set when the LSP seam is absent, so the panel stops asking. */
let ideVisionDisabled = false

/** Two declarations enriched at a time: the provider serialises queries anyway. */
let ideVisionSlots = 2
const ideVisionQueue = []

function ideVisionPump() {
  while (ideVisionSlots > 0 && ideVisionQueue.length > 0) {
    ideVisionSlots -= 1
    const task = ideVisionQueue.shift()
    void task().finally(() => {
      ideVisionSlots += 1
      ideVisionPump()
    })
  }
}

/** Run one enrichment task when a slot frees up. */
function ideVisionSchedule(task) {
  return new Promise((resolve) => {
    ideVisionQueue.push(() => task().then(resolve, resolve))
    ideVisionPump()
  })
}

/** The cache key of one file version. */
function ideVisionKey(root, tab) {
  return `${root}|${tab.path}|${tab.version}`
}

/** `line → label` already known for this file, counts and blame merged. */
function ideVisionRows(root, tab, uncommittedLabel) {
  const key = ideVisionKey(root, tab)
  const rows = new Map()
  for (const [line, text] of ideVisionCounts.get(key) ?? []) rows.set(line, text)
  for (const [line, blame] of ideBlames.get(key)?.rows ?? []) {
    const label = blame.uncommitted ? uncommittedLabel : blame.label
    rows.set(line, [rows.get(line), label].filter(Boolean).join('  '))
  }
  return rows
}

/**
 * One Git annotate cell per line, banded by commit.
 *
 * @param blames - `line → { author, date, time, uncommitted }` (1-based).
 * @param lineCount - how many lines the file has.
 * @param uncommittedLabel - what to write for lines git cannot attribute yet.
 * @returns `line → { label, band }` (`band` is 0 or 1, so adjacent commits can
 *   alternate a tint the way an editor's annotate view does).
 */
function ideAnnotateRows(blames, lineCount, uncommittedLabel) {
  const rows = new Map()
  if (blames === undefined) return rows
  let band = 0
  let previous
  for (let line = 1; line <= lineCount; line += 1) {
    const blame = blames.get(line)
    if (blame === undefined) {
      rows.set(line, { label: '', band: 0 })
      previous = undefined
      continue
    }
    const key = blame.uncommitted === true ? 'uncommitted' : `${blame.author}|${blame.time}`
    if (key !== previous) {
      band = band === 0 ? 1 : 0
      previous = key
    }
    const label = blame.uncommitted === true
      ? (uncommittedLabel ?? '')
      : [blame.date, blame.author].filter(Boolean).join(' ')
    rows.set(line, { label, band })
  }
  return rows
}

/** Fetch usage and implementation counts for the given declarations. */
function ideRequestVision(store, tab, declarations, done) {
  const state = store.getState()
  if (ideVisionDisabled || tab.kind === 'jar' || state.sessionId === null || state.rootPath === '') return
  const key = ideVisionKey(state.rootPath, tab)
  if (!ideVisionCounts.has(key)) ideVisionCounts.set(key, new Map())
  const filePath = ideAbs(state.rootPath, tab.path)
  for (const declaration of declarations) {
    const line = declaration.index + 1
    if (ideVisionCounts.get(key).has(line)) continue
    const id = `${key}|${declaration.index}:${declaration.name}`
    if (ideVisionPending.has(id)) continue
    ideVisionPending.add(id)
    const position = { line: declaration.index, character: declaration.column }
    void ideVisionSchedule(async () => {
      let failed = false
      const fail = (error) => {
        failed = true
        if (error?.code === 'lsp-unavailable') ideVisionDisabled = true
        return { locations: [] }
      }
      try {
        const [references, implementations] = await Promise.all([
          ideLspQuery({ operation: 'findReferences', filePath, workspaceRoot: state.rootPath, position }).catch(fail),
          ideLspQuery({ operation: 'goToImplementation', filePath, workspaceRoot: state.rootPath, position }).catch(fail),
        ])
        // A failed query is not a zero: leave the line uncached so it can be
        // answered when the server is available again.
        if (!failed) {
          // A caller that holds the interface never names the implementation;
          // without the contract's references every override looks unused.
          const contract = await ideContractReferences(store, tab.path, tab.text.split('\n'), declaration.name)
          const usages = ideVisionCount([...(references?.locations ?? []), ...contract], tab.path, line)
          const implemented = ideVisionCount(implementations?.locations, tab.path, line)
          ideVisionCounts.get(key).set(line, ideVisionLabel(usages, implemented))
          done()
        }
      } finally {
        ideVisionPending.delete(id)
      }
    })
  }
}

/**
 * How long a blame answer stays fresh.
 *
 * Committing changes no file content, so no workspace change arrives; without a
 * lifetime the annotate column would keep saying "Not Committed" forever.
 */
const IDE_BLAME_TTL_MS = 30000

/** Whether a cached blame answer is still inside its lifetime. */
function ideBlameIsFresh(cached, now) {
  return cached !== undefined && now - cached.at < IDE_BLAME_TTL_MS
}

/**
 * Fetch the last commit that touched each line.
 *
 * @param options.force - refetch even when the cached answer is fresh.
 */
function ideRequestBlame(store, tab, done, options = {}) {
  const state = store.getState()
  if (tab.kind === 'jar' || state.rootPath === '') return
  const key = ideVisionKey(state.rootPath, tab)
  const id = `${key}|blame`
  const cached = ideBlames.get(key)
  if (options.force !== true && ideBlameIsFresh(cached, Date.now())) return
  if (ideVisionPending.has(id)) return
  ideVisionPending.add(id)
  void ideBlameQuery(state.rootPath, tab.path)
    .then((found) => {
      if (found.ok !== true) return
      const rows = new Map()
      for (const row of found.lines) {
        if (!Number.isFinite(row?.line) || typeof row?.author !== 'string' || row.author === '') continue
        const when = Number.isFinite(row.time) && row.time > 0 ? new Date(row.time * 1000) : undefined
        const date = when === undefined ? '' : `${when.getFullYear()}/${when.getMonth() + 1}/${when.getDate()}`
        const uncommitted = row.uncommitted === true
        rows.set(row.line, {
          author: row.author,
          date,
          time: row.time,
          uncommitted,
          label: uncommitted ? '' : [row.author, date].filter(Boolean).join(' · '),
        })
      }
      ideBlames.set(key, { at: Date.now(), rows })
      done()
    })
    .catch(() => undefined)
    .finally(() => ideVisionPending.delete(id))
}

/** The source view. */
function IdeCodeView({ tab, tr, store, navigate }) {
  const scrollRef = useRef(null)
  // While this view is on screen, the page outside it is not selectable, so
  // Cmd+A answers with the file instead of the whole shell.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    document.documentElement.classList.add('iw-select-code')
    return () => document.documentElement.classList.remove('iw-select-code')
  }, [])

  // Cmd+A belongs to the file when the focus is anywhere else in the panel.
  // An input keeps the shortcut for itself — selecting the query you are typing
  // is what that focus means — and so does the command palette.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onSelectAll = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
      if (typeof event.key !== 'string' || event.key.toLowerCase() !== 'a') return
      const editable = (element) => element instanceof Element
        && element.closest('input, textarea, [contenteditable="true"]') !== null
      const target = event.target
      if (editable(target) || editable(document.activeElement)) return
      if (target instanceof Element && target.closest('.iw-palette') !== null) return
      const element = scrollRef.current
      if (element === null) return
      event.preventDefault()
      element.focus({ preventScroll: true })
      const selection = globalThis.getSelection?.()
      if (selection === null || selection === undefined) return
      const range = document.createRange()
      range.selectNodeContents(element)
      selection.removeAllRanges()
      selection.addRange(range)
    }
    document.addEventListener('keydown', onSelectAll, true)
    return () => document.removeEventListener('keydown', onSelectAll, true)
  }, [])

  // Every loaded line is mounted. A windowed renderer was tried here and its
  // first measurement could leave the rest of the file unrendered — the scroll
  // container is the browser's own, and a few thousand rows are cheap enough.
  const lines = useMemo(() => (tab.text === '' ? [] : tab.text.split('\n')), [tab.text])
  const columns = useMemo(() => ideColumnsOf(lines), [lines])
  const changeKinds = useMemo(() => ideChangeKinds(tab.changes, lines.length), [tab.changes, lines.length])
  // Code Vision rows for this file version; a stamp re-renders the view when a
  // background query answers.
  const [visionStamp, setVisionStamp] = useState(0)
  const rootPath = store.getState().rootPath
  // Blame answers for every line; the hint belongs on declarations only.
  const declarationRows = useMemo(
    () => new Set(ideDeclarations(lines, 0, lines.length).map((item) => item.index + 1)),
    [lines],
  )
  const visionRows = useMemo(() => {
    if (tab.status !== 'ready' || tab.kind === 'jar' || rootPath === '') return new Map()
    const rows = ideVisionRows(rootPath, tab, tr('annotateUncommitted'))
    for (const line of [...rows.keys()]) {
      if (!declarationRows.has(line)) rows.delete(line)
    }
    return rows
  }, [rootPath, tab.path, tab.version, tab.status, tab.kind, visionStamp, declarationRows])
  // Git annotate: every line carries its commit, so it is a per-file mode.
  const annotateOn = store.getState().annotate?.[tab.path] === true
  const annotateRows = useMemo(() => {
    if (!annotateOn || tab.status !== 'ready' || tab.kind === 'jar' || rootPath === '') return undefined
    return ideAnnotateRows(ideBlames.get(ideVisionKey(rootPath, tab))?.rows, lines.length, tr('annotateUncommitted'))
  }, [annotateOn, rootPath, tab.path, tab.version, tab.status, tab.kind, lines, visionStamp])

  // ---- symbol navigation --------------------------------------------------
  const [popup, setPopup] = useState(undefined)

  const pick = useCallback((path, line) => {
    setPopup(undefined)
    const opened = store.openAt(path, line)
    store.setNotice(opened ? `→ ${ideBasename(path)}:${line}` : `${tr('jumpFailed')}: ${path}`)
  }, [store, tr])

  const closePopup = useCallback(() => setPopup(undefined), [])

  /** The symbol under the pointer, with its 0-based LSP position. */
  const resolveSymbolAt = (event) => {
    const target = event.target
    if (!(target instanceof Element)) return undefined
    const name = target.getAttribute('data-iw-sym')
    if (name === null) return undefined
    const row = target.closest('.iw-line')
    const line = row === null ? undefined : Number(row.getAttribute('data-iw-line'))
    const column = Number(target.getAttribute('data-iw-col'))
    if (!Number.isFinite(line) || !Number.isFinite(column)) return undefined
    return { name, position: { line, character: column } }
  }

  // The popup is positioned inside the panel, so pointer coordinates become
  // panel-relative and an overlay can never paint over the app shell's composer.
  // Viewport coordinates: the popup is `position: fixed`, so it lands next to the
  // pointer and never scrolls with the source.
  const popupAt = (event, width = 520) => ({
    x: Math.min(Math.max(8, event.clientX), Math.max(8, (globalThis.innerWidth || 1200) - width)),
    y: Math.min(Math.max(8, event.clientY), Math.max(8, (globalThis.innerHeight || 800) - 360)),
  })

  /** Jump to the declaration of `name` (double click). */
  const jumpToDefinition = async (name, position, event) => {
    if (navigate === undefined) {
      store.setNotice(`${tr('lspFailed')}: lsp-unavailable`)
      return
    }
    // A language server's first answer can take seconds while it indexes; the
    // banner is the only signal this read-only view can give without blocking.
    store.setNotice(tr('querying'))
    try {
      let outcome
      try {
        outcome = await navigate.definition(tab.path, position, name)
      } catch (error) {
        // No language server, or it failed: dependency jars are still readable,
        // so fall through instead of stopping at the error.
        void error
        outcome = undefined
      }
      const locations = outcome?.locations ?? []
      // The query time is only a hint in the banner; a missing value is fine.
      const queryMs = typeof outcome?.ms === 'number' ? outcome.ms : undefined
      store.setNotice('')
      const lineText = lines[position.line] ?? ''
      // A click that lands on a declaration asks for the implementation; a click
      // on a call asks for the declaration. The line itself says which one it is.
      const declaresHere = ideIsMethodDeclaration(lineText, name)
      // A field's own line is the definition; jumping to another class's
      // same-named member is never what that click means.
      const declaresFieldHere = !declaresHere && ideIsFieldDeclaration(lineText, name)

      if (locations.length > 1) {
        setPopup({
          name,
          ms: queryMs,
          sections: [{ key: 'impl', title: `${tr('tabDeclaration')} (${locations.length})`, rows: locations.slice(0, 8) }],
          ...popupAt(event),
        })
        return
      }
      if (locations.length === 1) {
        // The server points at the click itself: this is the declaration of a
        // contract method, so the useful destination is its implementation.
        const sameAsClick = locations[0].path === tab.path && locations[0].line === position.line + 1
        if (sameAsClick && declaresHere) {
          if (await openImplementation(name, position, event)) return
          store.setNotice(`${tr('alreadyAtDefinition')}: ${name}`)
          return
        }
        // Say where the jump went: a wrong answer is then one glance away
        // instead of a mystery about whether the gesture did anything.
        if (store.openAt(locations[0].path, locations[0].line)) {
          const loadMs = store.getState().lastLoadMs
          store.setNotice(`\u2192 ${ideBasename(locations[0].path)}:${locations[0].line} \u00b7 \u67e5\u8be2 ${queryMs ?? '?'}ms \u00b7 \u8f7d\u5165 ${loadMs ?? '?'}ms`)
          return
        }
        // The server answered with a location outside the workspace — a
        // dependency jar. The editor cannot open that path, but its sources are
        // readable, so the fallbacks below still apply.
      }

      // An annotation attribute (`@Log(name = "x")`) is a method on the annotation
      // type, so the symbol alone resolves nothing.
      const annotationType = ideAnnotationTypeAt(lines, position)
      if (annotationType !== '' && await openAnnotationAttribute(annotationType, name, position)) return
      // A declaration click without a server answer still means "the code that
      // runs", not "the first same-named method in the workspace".
      if (declaresHere) {
        if (await openImplementation(name, position, event)) return
        store.setNotice(`${tr('alreadyAtDefinition')}: ${name}`)
        return
      }
      if (declaresFieldHere) {
        store.setNotice(`${tr('alreadyAtDefinition')}: ${name}`)
        return
      }
      // Lombok-style property: `getName()` has no method in the sources.
      if (await openAccessorProperty(name, position)) return
      // A type name: the workspace declaration wins over a published jar copy.
      if (await openLocalType(name)) return
      // A type from a dependency: its source is readable when the artifact ships
      // `-sources`, which is true for everything this workspace imports.
      // The server's project model can miss the declaring module; the file is
      // still in the workspace, so the declaration is one search away. This
      // comes before the jar copy: the workspace file is the real source.
      if (await openLocalDeclaration(name, position)) return
      if (await openFromJar(name, position)) return
      // With no licence the engine refused every query, so "not found" is not
      // the reader's problem to chase — the missing sign-in is.
      store.setNotice(ideLspLicenseMissing ? tr('lspLicense') : `${tr('noDefinition')}: ${name}`)
    } catch (error) {
      store.setNotice(`${tr('lspFailed')}: ${error?.code ?? error?.message ?? 'unknown'}`)
    }
  }

  /**
   * The fully qualified name an import binds, for `simpleName`.
   *
   * A class from a dependency is used by its simple name; the import is the only
   * place the package is stated.
   */
  const ideImportedFqn = (simpleName) => {
    const pattern = new RegExp(`^\\s*import\\s+(?:static\\s+)?([\\w.]+\\.${simpleName});`)
    for (const text of lines) {
      const match = pattern.exec(text)
      if (match !== null) return match[1]
    }
    return ''
  }

  /**
   * Whether one line declares `name` as a method.
   *
   * The language server can answer nothing when its project model does not cover
   * the module that declares the method; a text search for the declaration is
   * then the only way to land on it, and it must not mistake a call for one.
   */
  function ideIsMethodDeclaration(text, name) {
    if (typeof text !== 'string' || typeof name !== 'string' || name === '') return false
    const trimmed = text.trim()
    if (/^(?:return|if|for|while|switch|throw|new|else|case|yield|assert)\b/.test(trimmed)) return false
    const at = text.indexOf(name)
    if (at < 0) return false
    // A declaration states a return type right before the name. A bare call
    // (`fillJobOperatorIfAbsent();`) has nothing but indentation there, and an
    // assignment or a receiver ends with `=`/`.` instead of a type token.
    const before = text.slice(0, at).trim()
    if (before === '') return false
    // `service.` / `page =` say a call or an assignment, not a return type.
    if (/[.=(,+\-*/&|!?:]$/.test(before)) return false
    return /(?:^|\s)[A-Za-z_$][\w$.]*(?:<[^()]*>)?(?:\[\])?$/.test(before)
  }

  /**
   * Last resort: find a method declaration by text in the workspace.
   *
   * @returns whether a tab was opened.
   */
  const openLocalDeclaration = async (name, position) => {
    const root = store.getState().rootPath
    if (root === '' || typeof name !== 'string' || name === '') return false
    const lineText = lines[position.line] ?? ''
    // `PurchaseOrderStatusEnum.TO_PURCHASE.matches(...)` names its owner in the
    // leftmost segment; `field.matches(...)` states a variable whose type is
    // declared in this file.
    const chain = ideReceiverChain(lines, position.line, position.character)
    const head = chain.split('.')[0]
    const declared = head === '' ? '' : ideDeclaredType(lines, head)
    const owner = declared !== '' ? declared : (/^[A-Z]/.test(head) ? head : '')
    // A bare name overflows the route's match cap for common names (`detail`,
    // `get`), cutting the declaration itself; a declaration-shaped pattern keeps
    // the answer small and precise.
    const found = await ideGrepQuery(root, ideDeclarationPattern(name), { extensions: ['java'] })
    if (found.ok !== true) return false
    const declarations = found.matches.filter((match) => ideIsMethodDeclaration(match?.text, name))
    const inThisFile = declarations.filter((match) => match.path === tab.path)
    const byOwner = owner === ''
      ? []
      : declarations.filter((match) => String(match?.path ?? '').split('/').pop() === `${owner}.java`)
    // Without an owner the declaration may be in this file; picking the first
    // same-named method in the workspace is how a click on an interface method
    // used to land in an unrelated class.
    const pick = byOwner[0] ?? inThisFile[0] ?? undefined
    if (pick === undefined) return false
    if (!store.openAt(pick.path, pick.line)) return false
    store.setNotice(`\u2192 ${ideBasename(pick.path)}:${pick.line}`)
    return true
  }

  /**
   * The workspace file declaring `name`, with its lines, when there is one.
   *
   * The same module may also be installed in the local Maven repository; its
   * `-sources.jar` copy must never win over the file that is being edited.
   */
  const openWorkspaceTypeDeclaration = async (name) => {
    const root = store.getState().rootPath
    if (root === '' || typeof name !== 'string' || name === '') return undefined
    const found = await ideGrepQuery(root, `\\b(?:class|interface|enum|record|@interface)\\s+${ideRegexEscape(name)}\\b`, {
      extensions: ['java'],
      caseSensitive: true,
    })
    if (found.ok !== true) return undefined
    const match = found.matches.find((row) => ideIsTypeDeclaration(row?.text, name)
      && String(row?.path ?? '').split('/').pop() === `${name}.java`)
    if (match === undefined) return undefined
    const lines = await store.readLines(match.path).catch(() => undefined)
    return Array.isArray(lines) ? { path: match.path, lines } : undefined
  }

  /**
   * Jump from a type name to the file that declares it.
   *
   * A workspace class beats its published `-sources.jar` copy: the module in
   * this workspace is the source of truth, and the jar is only a fallback for
   * dependencies.
   *
   * @returns whether a tab was opened.
   */
  const openLocalType = async (name) => {
    const root = store.getState().rootPath
    if (root === '' || typeof name !== 'string' || name === '') return false
    const found = await ideGrepQuery(root, `\\b(?:class|interface|enum|record|@interface)\\s+${ideRegexEscape(name)}\\b`, {
      extensions: ['java'],
      caseSensitive: true,
    })
    if (found.ok !== true) return false
    const declarations = found.matches.filter((match) => ideIsTypeDeclaration(match?.text, name))
    const pick = declarations.find((match) => String(match?.path ?? '').split('/').pop() === `${name}.java`) ?? declarations[0]
    if (pick === undefined) return false
    if (!store.openAt(pick.path, pick.line)) return false
    store.setNotice(`\u2192 ${ideBasename(pick.path)}:${pick.line}`)
    return true
  }

  /**
   * Jump from an accessor call (`getName()`) to the field it reads.
   *
   * A Lombok class has no accessor in its sources, so the engine answers nothing
   * and text search finds no method either; the property itself is the answer.
   * Only a call with a receiver whose type is declared in this file qualifies —
   * `getDetail()` may be an ordinary method, and it is tried first elsewhere.
   *
   * @returns whether a tab was opened.
   */
  const openAccessorProperty = async (name, position) => {
    const root = store.getState().rootPath
    const property = ideAccessorProperty(name)
    if (root === '' || property === '') return false
    const lineText = lines[position.line] ?? ''
    const head = ideReceiverChain(lines, position.line, position.character).split('.')[0]
    const declared = head === '' ? '' : ideDeclaredType(lines, head)
    if (declared === '') return false
    const found = await ideGrepQuery(root, `\\b${ideRegexEscape(property)}\\s*[;=,]`, { extensions: ['java'], caseSensitive: true })
    if (found.ok !== true) return false
    const target = found.matches.find((match) => String(match?.path ?? '').split('/').pop() === `${declared}.java`
      && ideIsFieldDeclaration(match?.text, property))
    if (target === undefined) return false
    if (!store.openAt(target.path, target.line)) return false
    store.setNotice(`\u2192 ${ideBasename(target.path)}:${target.line} \u00b7 ${tr('propertyLabel')}`)
    return true
  }

  /**
   * The implementation of the method declared at the click.
   *
   * A click on an interface (or abstract) method declaration means "take me to
   * the code that runs"; the engine's implementation query answers it, and the
   * textual `implements`/`extends` scan covers the case where it does not.
   *
   * @returns whether something was opened or offered.
   */
  const openImplementation = async (name, position, event) => {
    const root = store.getState().rootPath
    if (root === '') return false
    const implementations = []
    if (navigate !== undefined) {
      const answer = await ideLspQuery({
        operation: 'goToImplementation',
        filePath: ideAbs(root, tab.path),
        workspaceRoot: root,
        position,
      }).catch(() => undefined)
      for (const location of answer?.locations ?? []) {
        if (location?.path === tab.path && location.line === position.line + 1) continue
        implementations.push(location)
      }
    }
    if (implementations.length === 0) {
      const textual = await ideTextualImplementations(store, tab.path, lines, name, 8)
      for (const row of textual) implementations.push({ path: row.path, line: row.line })
    }
    if (implementations.length === 0) return false
    if (implementations.length > 1) {
      setPopup({
        name,
        sections: [{ key: 'impl', title: `${tr('tabImplements')} (${implementations.length})`, rows: implementations.slice(0, 8) }],
        ...popupAt(event),
      })
      return true
    }
    if (!store.openAt(implementations[0].path, implementations[0].line)) return false
    store.setNotice(`\u2192 ${ideBasename(implementations[0].path)}:${implementations[0].line} \u00b7 ${tr('implementationLabel')}`)
    return true
  }

  /**
   * Open the definition from a dependency jar's sources.
   *
   * @returns whether a read-only tab was opened.
   */
  /**
   * Open the declaration of an annotation attribute (`@Log(name = "x")` → `name()`).
   *
   * The attribute is not a symbol of this file: it is a method on the annotation
   * type, which usually comes from a dependency jar. Without this, a click on such
   * an attribute reports 「未找到定义」 even though the source is readable.
   *
   * @returns `true` when the attribute's declaration was opened.
   */
  const openAnnotationAttribute = async (typeName, attribute, position) => {
    const fqn = ideImportedFqn(typeName)
    if (fqn === '') return false
    // An annotation declared in this workspace is the source of truth; the jar
    // copy of the same module only exists because it was installed locally.
    const workspace = await openWorkspaceTypeDeclaration(typeName)
    if (workspace !== undefined) {
      const index = ideAttributeLineIn(workspace.lines, attribute)
      if (index >= 0 && store.openAt(workspace.path, index + 1)) {
        store.setNotice(`\u2192 ${ideBasename(workspace.path)}:${index + 1}`)
        return true
      }
    }
    const found = await ideJarSourceQuery(fqn)
    if (found.ok !== true || found.found !== true) return false
    const index = ideAttributeLineIn(found.text.split('\n'), attribute)
    store.openJarSource({
      className: fqn,
      jar: found.jar,
      text: found.text,
      line: index >= 0 ? index + 1 : undefined,
    })
    const jarFile = found.jar.split('/').pop() ?? ''
    store.setNotice(`\u2192 ${jarFile} \u203a ${typeName}.java${index >= 0 ? `:${index + 1}` : ''}`)
    return true
  }

  const openFromJar = async (name, position) => {
    // Where the owner comes from, in order of certainty:
    //   1. `Type::getX` states it in the line;
    //   2. `older.getX()` — the receiver's declared type is in the same file;
    //   3. `captor.getValue().getX()` — ask the engine for the receiver's type;
    //   4. a capitalised symbol is the class itself.
    const lineText = lines[position.line] ?? ''
    const before = lineText.slice(0, Math.max(0, position.character))
    const referenceOwner = /([A-Z][\w$]*)\s*::\s*[\w$]*$/.exec(before)?.[1] ?? ''
    let owner = referenceOwner
    const receiver = ideReceiverToken(before)
    if (owner === '' && receiver !== '') {
      const declared = ideDeclaredType(lines, receiver)
      if (declared !== '') owner = declared
    }
    if (owner === '' && receiver !== '') {
      // A generic container: the declaration `ArgumentCaptor<T> captor` answers
      // `captor.getValue()`, so look up the variable, not the method.
      const argument = ideGenericArgument(lines, ideChainBase(before, receiver) || receiver)
      if (argument !== '') owner = argument
    }
    if (owner === '') {
      // A chained receiver: hover the method immediately before the dot.
      const chain = receiver
      if (chain !== '' && before.replace(/\s+$/, '').endsWith(').')) {
        const start = before.lastIndexOf(chain)
        const hovered = await ideLspHoverText(store, tab.path, { line: position.line, character: start + 1 })
        const imported = lines
          .map((text) => /^\s*import\s+(?:static\s+)?[\w.]+\.([A-Z][\w$]*);/.exec(text)?.[1] ?? '')
          .filter((simple) => simple !== '')
        owner = [...hovered.matchAll(/\b([A-Z][\w$]*)\b/g)]
          .map((match) => match[1])
          .filter((simple) => imported.includes(simple))
          .pop() ?? ''
      }
    }
    if (owner === '') owner = name[0] === name[0].toUpperCase() ? name : ''
    if (owner === '') return false
    const fqn = ideImportedFqn(owner)
    if (fqn === '') return false
    const found = await ideJarSourceQuery(fqn)
    if (found.ok !== true || found.found !== true) {
      if (found.ok === true) {
        store.setNotice(found.reason === 'missing-repository'
          ? `${tr('mavenRepoMissing')}: ${found.repository}`
          : `${tr('noSourceInJar')}: ${owner}`)
      }
      return found.ok === true
    }
    const fieldName = ideBeanFieldName(name)
    const jarLines = found.text.split('\n')
    const target = fieldName === undefined ? 0 : jarLines.findIndex((text) => (
      new RegExp(`^\\s*(?:(?:private|protected|public|final|static|transient|volatile)\\s+)*[\\w<>,\\[\\].? ]+\\b${fieldName}\\b\\s*(?:[;=])`).test(text)
    ))
    store.openJarSource({
      className: fqn,
      jar: found.jar,
      text: found.text,
      line: target >= 0 ? target + 1 : undefined,
    })
    const jarFile = found.jar.split('/').pop() ?? ''
    store.setNotice(`→ ${jarFile} › ${owner}.java${target >= 0 ? `:${target + 1}` : ''}`)
    return true
  }

  /** Which navigation action a pointer gesture is bound to, if any. */
  const gestureActionOf = (gesture) => {
    const actions = store.getState().gestures ?? {}
    return ['definition', 'usages', 'chain'].find((key) => ideGestureMatches(actions[key], gesture, ideRuntimeContext.platform)) ?? ''
  }

  /** Run the action a gesture is bound to against the symbol under the pointer. */
  const runGestureAction = (action, hit, event) => {
    if (action === 'definition') void jumpToDefinition(hit.name, hit.position, event)
    else if (action === 'usages') void showUsages(hit.name, hit.position, event)
    else if (action === 'chain') void showChain(hit.name, hit.position, event)
  }

  /**
   * The caller tree of `name` (Alt+click), painted as each level arrives.
   *
   * "From start to end" is the direction LSP can answer: who calls this method,
   * who calls that caller, and so on until an entry point.
   */
  const showChain = async (name, position, event) => {
    if (navigate === undefined) {
      store.setNotice(`${tr('lspFailed')}: lsp-unavailable`)
      return
    }
    const anchor = popupAt(event, 620)
    const started = ideNow()
    const root = { name, path: tab.path, line: position.line + 1, position }
    // A licence refusal is not "this method has no callers"; say what to do.
    const emptyText = (tree) => (typeof tree?.failed === 'string' && tree.failed.startsWith('license:')
      ? tr('lspLicense')
      : tr('chainNone'))
    const paint = (tree, state, ms) => setPopup({
      kind: 'chain',
      name,
      tree,
      state,
      ms,
      empty: emptyText(tree),
      ...anchor,
    })
    paint({ ...root, children: [] }, 'loading', 0)
    const tree = await ideCallChain(store, root, { onPartial: (partial) => paint(partial, 'loading', 0) })
    paint(tree, 'ready', Math.round(ideNow() - started))
  }

  /** Show implementations and callers of `name` (⌘/Ctrl + click). */
  const showUsages = async (name, position, event) => {
    if (navigate === undefined) {
      store.setNotice(`${tr('lspFailed')}: lsp-unavailable`)
      return
    }
    try {
      // An interface, an abstract method and a concrete one all answer here:
      // implementations and callers are separated so a click on the contract
      // shows both, exactly as the editor would.
      //
      // The reference sweep is the slowest of the three queries, so the popup is
      // painted with the implementations first and completed when callers arrive.
      const anchor = popupAt(event)
      const sectionsOf = (grouped) => {
        const sections = []
        if ((grouped.implementations ?? []).length > 0) {
          sections.push({ key: 'impl', title: `${tr('tabImplements')} (${grouped.implementations.length})`, rows: grouped.implementations })
        }
        if ((grouped.implementationsText ?? []).length > 0) {
          sections.push({ key: 'implText', title: `${tr('tabImplementsText')} (${grouped.implementationsText.length})`, rows: grouped.implementationsText })
        }
        if ((grouped.callers ?? []).length > 0) {
          sections.push({ key: 'callers', title: `${tr('tabCallers')} (${grouped.callers.length})`, rows: grouped.callers })
        }
        if ((grouped.declaration ?? []).length > 0) {
          sections.push({ key: 'def', title: tr('tabDeclaration'), rows: grouped.declaration })
        }
        if ((grouped.textual ?? []).length > 0) {
          sections.push({ key: 'text', title: `${tr('tabCallersText')} (${grouped.textual.length})`, rows: grouped.textual })
        }
        return sections
      }

      const grouped = await navigate.browse(tab.path, position, name, (partial) => {
        const partialSections = sectionsOf(partial)
        if (partialSections.length === 0) return
        setPopup({ name, sections: partialSections, ms: partial.ms, phases: partial.phases, ...anchor })
      })
      const sections = sectionsOf(grouped)
      if (sections.length === 0) {
        // A failed server is not an answer: say so instead of implying the
        // symbol has no usages. An operation the server does not implement is
        // not an outage either — it just means this answer is text-only.
        if (typeof grouped.failed === 'string' && grouped.failed.startsWith('license:')) {
          store.setNotice(tr('lspLicense'))
        } else if (typeof grouped.failed === 'string' && grouped.failed.startsWith('lsp-unsupported')) {
          store.setNotice(`${tr('lspUnsupported')}: ${name}`)
        } else {
          store.setNotice(grouped.failed
            ? `${tr('lspFailed')}: ${grouped.failed}`
            : `${tr('noUsages')}: ${name}${tr('maybeIndexing')}`)
        }
        return
      }
      store.setNotice('')
      setPopup({ name, sections, ms: grouped.ms, phases: grouped.phases, ...anchor })
    } catch (error) {
      store.setNotice(`${tr('lspFailed')}: ${error?.code ?? error?.message ?? 'unknown'}`)
    }
  }

  // Scroll placement has two owners: a jump asks for a line, and a remount has
  // to put the reader back where they were. Only a *new* jump line overrides the
  // remembered offset — otherwise returning to a tab would always jump to the top.
  const reveal = tab.reveal
  useEffect(() => {
    const element = scrollRef.current
    if (element === null || tab.status !== 'ready') return
    if (typeof reveal === 'number' && reveal > 0 && tab.revealApplied !== reveal) {
      element.scrollTop = Math.max(0, (reveal - 1) * IDE_LINE_HEIGHT - Math.round(element.clientHeight / 3))
      store.setRevealApplied(tab.path, reveal)
      store.rememberScroll(tab.path, element.scrollTop)
      return
    }
    element.scrollTop = store.getState().scroll[tab.path] ?? 0
  }, [tab.path, reveal, tab.revealApplied, tab.status, store])

  // Persist the offset while reading, throttled so a scroll does not re-render
  // the whole panel on every frame.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return undefined
    let timer
    const onScroll = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        store.rememberScroll(tab.path, element.scrollTop)
      }, 150)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      element.removeEventListener('scroll', onScroll)
    }
  }, [tab.path, store])

  // Enrich the declarations on screen (counts) and the file once (blame). Both
  // are cached per file version, so scrolling back costs nothing.
  useEffect(() => {
    if (tab.status !== 'ready' || tab.kind === 'jar' || tab.text === '') return undefined
    const element = scrollRef.current
    if (element === null) return undefined
    const bump = () => setVisionStamp((value) => value + 1)
    const request = () => {
      const lineHeight = element.querySelector('.iw-line')?.getBoundingClientRect().height || IDE_LINE_HEIGHT
      const start = Math.max(0, Math.floor(element.scrollTop / lineHeight) - 6)
      const end = Math.min(lines.length, Math.ceil((element.scrollTop + element.clientHeight) / lineHeight) + 6)
      ideRequestVision(store, tab, ideDeclarations(lines, start, end), bump)
    }
    request()
    ideRequestBlame(store, tab, bump)
    let timer
    const onScroll = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        request()
      }, 250)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      element.removeEventListener('scroll', onScroll)
    }
  }, [store, tab.path, tab.version, tab.status, tab.kind, tab.text, lines])

  // Annotate is an explicit mode: re-read the blame when it is switched on (a
  // commit changed no file content, so no change event would), and again when
  // the window regains focus. No timer runs while it stays open.
  useEffect(() => {
    if (!annotateOn || tab.status !== 'ready' || tab.kind === 'jar') return undefined
    const bump = () => setVisionStamp((value) => value + 1)
    ideRequestBlame(store, tab, bump, { force: true })
    // Coming back to the window is the user asking "is this still true?".
    const onFocus = () => ideRequestBlame(store, tab, bump, { force: true })
    globalThis.addEventListener('focus', onFocus)
    return () => globalThis.removeEventListener('focus', onFocus)
  }, [annotateOn, store, tab.path, tab.version, tab.status, tab.kind])

  if (lines.length === 0 && tab.text === '') {
    return h('div', { className: 'iw-empty' }, tr(tab.status === 'error' ? 'fileNotText' : 'loading'))
  }

  const lang = ideLangOf(tab.name)
  const hitIndex = typeof reveal === 'number' && reveal > 0 ? reveal - 1 : -1
  const rendered = lines.map((text, index) => h(IdeCodeLine, {
    key: index,
    index,
    text,
    lang,
    hit: index === hitIndex,
    vcs: changeKinds.get(index),
    vision: annotateRows === undefined ? visionRows.get(index + 1) : undefined,
    annotate: annotateRows === undefined ? undefined : (annotateRows.get(index + 1) ?? { label: '', band: 0 }),
  }))

  const code = h('div', {
    className: 'iw-code',
    ref: scrollRef,
    tabIndex: 0,
    onClick: (event) => {
      // A licence page parked after an LSP refusal opens on the next gesture.
      ideFlushLicenseUrl()
      // A plain click deliberately does nothing unless the user assigns it one.
      // Selecting and copying source is a more frequent gesture than navigating,
      // and a drag that ends on an identifier must not be mistaken for a request.
      const gesture = ideGestureOf(event)
      if (gesture === 'plain' || gesture === 'shift') return
      // macOS turns Ctrl+click into a secondary click; the context menu handler
      // runs that gesture, so it is not also acted on here.
      if (gesture === 'ctrl' && ideRuntimeContext.platform === 'macos') return
      const action = gestureActionOf(gesture)
      if (action === '') return
      const hit = resolveSymbolAt(event)
      if (hit === undefined) return
      event.preventDefault()
      runGestureAction(action, hit, event)
    },
    onDoubleClick: (event) => {
      // A double click with a modifier belongs to the single-click gestures above.
      if (ideGestureOf(event) !== 'plain') return
      const action = gestureActionOf('double')
      if (action === '') return
      const hit = resolveSymbolAt(event)
      if (hit === undefined) return
      event.preventDefault()
      runGestureAction(action, hit, event)
    },
    onContextMenu: (event) => {
      // The gutter — change bar, annotate column, line numbers — is where an
      // editor offers Git annotate. On the source itself the platform menu stays.
      const target = event.target
      if (typeof target?.closest !== 'function') return
      const gutter = target.closest('.iw-vcs, .iw-blame, .iw-ln')
      if (gutter === null) {
        // macOS delivers Ctrl+click as a secondary click. When that gesture is
        // configured for navigation it belongs to the source — checked before
        // the symbol menu, otherwise Ctrl+click on a symbol only opens the menu.
        // A real right click has `button === 2` and must keep the menu.
        const ctrlGesture = event.ctrlKey === true
          && event.button === 0
          && ideRuntimeContext.platform === 'macos'
          ? gestureActionOf('ctrl')
          : ''
        if (ctrlGesture !== '') {
          const hit = resolveSymbolAt(event)
          if (hit !== undefined) {
            event.preventDefault()
            runGestureAction(ctrlGesture, hit, event)
            return
          }
        }
        // A symbol under the pointer gets IDEA's editor menu: name, reference,
        // and the reference handed to the conversation.
        const symbol = target.closest('[data-iw-sym]')
        if (symbol !== null) {
          event.preventDefault()
          store.setCodeSymbolMenu({
            path: tab.path,
            symbol: symbol.getAttribute('data-iw-sym') ?? '',
            line: Number(symbol.getAttribute('data-iw-line')) || 0,
            jar: tab.kind === 'jar',
            x: event.clientX,
            y: event.clientY,
          })
          return
        }
        return
      }
      if (tab.kind === 'jar') return
      event.preventDefault()
      store.setCodeMenu({ path: tab.path, x: event.clientX, y: event.clientY })
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape') closePopup()
    },
  }, [
    h('div', {
      key: 'inner',
      className: 'iw-code-inner',
      style: { width: `max(100%, ${Math.max(columns, 24)}ch)` },
    }, rendered),
  ])

  // The popup is a sibling of the scrolling container, not a child: inside it,
  // it would both scroll with the source and position against that container.
  const popupView = popup === undefined
    ? null
    : popup.kind === 'chain'
      ? h(IdeChainPopup, { key: 'popup', popup, tr, onPick: pick, onClose: closePopup })
      : h(IdeUsagePopup, { key: 'popup', popup, onPick: pick, onClose: closePopup })
  return h(React.Fragment, null, [code, popupView])
}

/** The bottom status bar. */
function IdeStatusBar({ store, state, tab, tr }) {
  const lang = tab === undefined ? '' : ideLangOf(tab.name)
  const total = state.tabs.reduce((sum, entry) => sum + (entry.lines ?? 0), 0)
  return h('div', { className: 'iw-status' }, [
    h('span', {
      key: 'path',
      title: tab?.kind === 'jar' ? `${tab.dir}` : (tab?.path ?? ''),
    }, tab === undefined
      ? tr('title')
      : tab.kind === 'jar' ? `${tab.dir} › ${tab.name}` : `${tab.path}`),
    h('span', { key: 'grow', className: 'iw-grow' }),
    tab === undefined || tab.lines === 0
      ? null
      : h('span', { key: 'lines' }, `${tab.lines} ${tr('linesSuffix')}`),
    tab === undefined || lang === ''
      ? null
      : h('span', { key: 'lang' }, ideLangLabel(lang)),
    h('span', { key: 'enc' }, tr('utf8')),
    h('span', {
      key: 'window',
      title: tr('liveOn'),
      style: { display: 'inline-flex', alignItems: 'center', gap: '5px' },
    }, [h(IdeLiveDot, { key: 'dot', on: state.watching }), tr('live')]),
    h('span', { key: 'ro' }, tr('readOnly')),
    h(IdeThemeButton, { key: 'theme', store, themeId: ideIsThemeId(state.theme) ? state.theme : '', open: state.themeMenu === true, tr }),
    total === 0 ? null : h('span', { key: 'total', style: { opacity: 0.7 } }, `${state.tabs.length}`),
  ])
}

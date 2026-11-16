/**
 * Search Everywhere.
 *
 * One dialog over the sources this plugin can answer truthfully:
 *
 * - classes — code files whose name is the class (Java's layout makes the file
 *   name the class name), labelled with the fully qualified name
 * - symbols — declaration-shaped lines whose identifier starts with the typed
 *   text: types, methods, fields and constants, with their declaring class
 * - files   — the Host's workspace file search (names or `/`-joined paths)
 * - text    — content matches in every text file, documentation included
 * - actions — the panel's own commands
 *
 * DSH's LSP seam exposes definition, references, implementation and hover only,
 * so no symbol table reaches a Client half. 「符号」 is therefore a text
 * heuristic over declarations, not an index: it matches the identifier prefix,
 * shows the declaring class derived from the path, and may also list a local
 * variable that looks exactly like a field. 「类」 has no such caveat — one
 * public class per file is a Java convention, not a guess.
 */

/** Palette categories, in tab order. The merged view is the default. */
const IDE_PALETTE_CATEGORIES = ['all', 'class', 'symbol', 'files', 'text', 'actions']

/** Largest number of rows each source contributes. */
const IDE_PALETTE_FILES = 40
const IDE_PALETTE_SYMBOL = 60
const IDE_PALETTE_TEXT = 60

/**
 * Source suffixes the class and symbol views search.
 *
 * Deliberately the languages this plugin highlights, minus data/document
 * formats (md, txt, json, xml, yaml, properties): those stay in 「文本」, which
 * is what keeps a name search free of pom files and README matches. Add a
 * suffix here to widen the view; the Host accepts it as a glob, nothing else.
 */
const IDE_CODE_EXTENSIONS = [
  'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue',
  'py', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'rb', 'swift',
  'sh', 'bash', 'zsh', 'sql', 'proto', 'graphql', 'gql',
]

/** Membership test for the extension list above. */
const IDE_CODE_EXTENSION_SET = new Set(IDE_CODE_EXTENSIONS)

/** Whether one workspace-relative path is a source file these views search. */
function ideIsCodePath(path) {
  const name = String(path ?? '')
  const dot = name.lastIndexOf('.')
  return dot >= 0 && IDE_CODE_EXTENSION_SET.has(name.slice(dot + 1).toLowerCase())
}

/** `src/main/java/com/x/Y.java` → `com.x.Y`; any other path keeps its shape. */
function ideFqnOf(path) {
  const text = String(path ?? '')
  const match = /(?:^|\/)src\/(?:main|test)\/(?:java|kotlin|kts|scala|groovy)\/(.+)$/i.exec(text)
  const tail = match === null ? text : match[1]
  return tail.replace(/\.[^./]+$/, '').replace(/\//g, '.')
}

/** The class name a code file declares: its own name without the suffix. */
function ideClassName(path) {
  return ideBasename(path).replace(/\.[^.]+$/, '')
}

/**
 * A ripgrep pattern for declarations whose identifier *starts with* `query`.
 *
 * Prefix, not substring, is the useful shape of a symbol search: typing
 * `operat` should list `operatorId`, `operateType` and `OperationTypeEnum`, the
 * way an IDE does. Three shapes are declarations in a Java-shaped source:
 *
 *  1. a type (`class`, `interface`, `enum`, `record`, and their `export`ed form);
 *  2. a typed member or method (a leading type, then the name, then `; = ( ,`);
 *  3. an enum constant or untyped constant at the start of its line;
 *  4. a script declaration (`function`, `def`, `const`, …), so a JS or Python
 *     workspace is not silently unsearchable.
 *
 * A query that is not an identifier (a package, a path, `a.b.C`) yields an
 * empty pattern: that is what the file/class search is for, and escaping
 * arbitrary text into ripgrep's dialect would be guessing.
 */
function ideSymbolPattern(query) {
  const name = String(query ?? '').trim()
  if (!/^[A-Za-z_$][\w$]{0,63}$/.test(name)) return ''
  // The identifier is case-insensitive, the surrounding shapes are not: with a
  // global `(?i)` the leading-type rule would treat `return` as a type and call
  // `return bill;` a declaration.
  const typed = `(?i:${name})`
  const modifiers = '(?:(?:public|private|protected|static|final|abstract|synchronized|native|transient|volatile|default|sealed|non-sealed)\\s+)*'
  const type = '(?:[A-Z][\\w$]*(?:<[^>]*>)?(?:\\[\\])*|void|int|long|short|byte|char|boolean|float|double)'
  return [
    `^\\s*${modifiers}(?:class|interface|enum|record)\\s+${typed}[\\w$]*`,
    `^[ \t]{0,4}${modifiers}(?:${type}\\s+)+${typed}[\\w$]*\\s*[;=(]`,
    `^\\s*${typed}[A-Z0-9_]*\\s*[(,;]`,
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|func|fn|class|interface|enum|type|const|let|var|def)\\s+${typed}[\\w$]*`,
  ].join('|')
}

/**
 * The identifier one declaration-shaped line declares, and what kind it is.
 *
 * @returns `{ name, kind }` (`type` | `method` | `field`), or `undefined` when
 *   the line names nothing that starts with the typed text.
 */
function ideSymbolOfLine(line, query) {
  const text = String(line ?? '')
  const typed = String(query ?? '').trim()
  if (text === '' || typed === '') return undefined
  const found = new RegExp(`(?:^|[^\\w$])(${typed}[\\w$]*)`, 'i').exec(text)
  if (found === null) return undefined
  const name = found[1]
  if (new RegExp(`\\b(?:class|interface|enum|record)\\s+${name}\\b`).test(text)) return { name, kind: 'type' }
  if (new RegExp(`${name}\\s*\\(`).test(text)) return { name, kind: 'method' }
  return { name, kind: 'field' }
}

/**
 * Turn one typed expression into the file queries that can actually match.
 *
 * IDEA addresses code as `a.b.C#member`, which matches neither a file name nor
 * file content. Java's own layout is the bridge: `a.b.C` is `a/b/C.java`, so the
 * dots become a path query, and the simple name is kept as a second query for
 * classes that live somewhere else.
 *
 * @returns `{ queries, member }` — queries to run, and the member after `#`.
 */
function idePaletteFileQueries(raw) {
  const text = String(raw ?? '').trim()
  if (text === '') return { queries: [], member: '' }
  const cut = text.indexOf('#')
  const typePart = cut < 0 ? text : text.slice(0, cut)
  const member = cut < 0 ? '' : text.slice(cut + 1).trim()
  const queries = []
  if (typePart.includes('.')) {
    queries.push(typePart.replace(/\./g, '/'))
    const simple = typePart.slice(typePart.lastIndexOf('.') + 1)
    if (simple !== '') queries.push(simple)
  } else if (typePart !== '') {
    queries.push(typePart)
  }
  return { queries: [...new Set(queries)], member }
}

/** Directory part of a workspace-relative path, or `''`. */
function ideDirOf(path) {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '' : path.slice(0, cut)
}

/** Whether `word` sits on identifier boundaries inside `text` at `at`. */
function ideWordEdges(text, at, length) {
  const before = at === 0 ? '' : text[at - 1]
  const after = at + length >= text.length ? '' : text[at + length]
  return { start: !/[\w$]/.test(before), end: !/[\w$]/.test(after) }
}

/**
 * How well one matched line fits the typed text; higher is a closer match.
 *
 * Ordering is the whole point of a search box, and ripgrep's own order is by
 * traversal, not by fit. The tiers are the ones a reader expects:
 *
 *  1. the typed text appears as a whole identifier (`getById`);
 *  2. it appears at the start of an identifier (`getBy` in `getById`);
 *  3. it appears inside a word (`set` in `offset`);
 *  4. it did not appear literally at all — the query is a pattern, e.g. `get\w+`.
 *
 * Inside a tier a declaration-shaped line (`name;`, `name =`, `name(`) outranks
 * a usage, an earlier column outranks a later one, and a shorter line outranks a
 * long one, so the answer is stable enough to trust across keystrokes.
 */
function ideMatchRank(text, needle) {
  if (needle === '') return 0
  const line = String(text ?? '')
  const at = line.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return 0
  const edges = ideWordEdges(line, at, needle.length)
  const tail = line.slice(at + needle.length)
  // `receiver.name` is a usage wherever it appears; `name =` / `name;` / `name(`
  // is how a declaration is written, so the declaration wins the tie.
  const memberAccess = at > 0 && line[at - 1] === '.'
  let rank = edges.start && edges.end ? 100 : edges.start ? 60 : 20
  if (!memberAccess && edges.start && /^\s*[;=(,:]/.test(tail)) rank += 15
  if (memberAccess) rank -= 5
  if (line.includes(needle)) rank += 3
  rank -= Math.min(9, Math.floor(at / 10))
  rank -= Math.min(5, Math.floor(line.length / 60))
  return rank
}

/**
 * How well a file path fits: its own name first, then the directory.
 *
 * The name is compared both whole and without its suffix, so `OrderService`
 * finds `OrderService.java` exactly while `config.yml` still matches its own
 * full name.
 */
function ideFileRank(path, needle) {
  if (needle === '') return 0
  const name = ideBasename(path).toLowerCase()
  const stem = name.replace(/\.[^.]+$/, '')
  const wanted = needle.toLowerCase()
  if (name === wanted || stem === wanted) return 100
  if (name.startsWith(wanted) || stem.startsWith(wanted)) return 80
  const at = name.indexOf(wanted)
  if (at >= 0) return 40
  return String(path).toLowerCase().includes(wanted) ? 10 : 0
}

/** How well a symbol fits: an exact name first, then a prefix; types rank up. */
function ideSymbolRank(symbol, needle) {
  if (needle === '') return 0
  const name = String(symbol?.name ?? '').toLowerCase()
  const wanted = needle.toLowerCase()
  const base = name === wanted ? 100 : name.startsWith(wanted) ? 80 : 40
  return base + (symbol?.kind === 'type' ? 5 : 0)
}

/** How well a command label fits: an exact name beats a contained one. */
function ideActionRank(label, needle) {
  if (needle === '') return 0
  const text = String(label ?? '').toLowerCase()
  const wanted = needle.toLowerCase()
  if (text === wanted) return 100
  if (text.startsWith(wanted)) return 80
  return text.includes(wanted) ? 40 : 0
}

/**
 * Sort rows by `rankOf`, best first.
 *
 * The original index is the tie-breaker, so equal ranks keep the order the Host
 * returned instead of shuffling on every keystroke.
 */
function ideRankRows(rows, rankOf) {
  return rows
    .map((row, index) => ({ row, index, rank: rankOf(row) }))
    .sort((left, right) => right.rank - left.rank || left.index - right.index)
    .map((entry) => entry.row)
}

/**
 * Flatten the enabled sources into one keyboard-navigable, ranked list.
 *
 * In the merged view a source file shows up once, under 「类」: repeating it under
 * 「文件」 would only make the list longer. The dedicated tabs still list
 * everything their own way.
 */
function idePaletteEntries({ category, classes, symbols, files, text, actions, query = '' }) {
  const needle = String(query).trim()
  const merged = category === 'all'
  const entries = []
  if (merged || category === 'class') {
    for (const item of ideRankRows(classes, (row) => ideFileRank(row.path, needle))) {
      entries.push({ key: `k:${item.path}`, kind: 'class', label: item.name, detail: item.fqn, path: item.path })
    }
  }
  if (merged || category === 'symbol') {
    for (const item of ideRankRows(symbols, (row) => ideSymbolRank(row, needle))) {
      entries.push({
        key: `s:${item.path}:${item.line}`,
        kind: 'symbol',
        label: item.name,
        detail: item.fqn,
        path: item.path,
        line: item.line,
      })
    }
  }
  if (merged || category === 'files') {
    const visible = merged ? files.filter((file) => !ideIsCodePath(file.path)) : files
    for (const file of ideRankRows(visible, (row) => ideFileRank(row.path, needle))) {
      entries.push({
        key: `f:${file.path}`,
        kind: 'files',
        label: ideBasename(file.path),
        detail: ideDirOf(file.path),
        path: file.path,
        line: file.line,
      })
    }
  }
  if (merged || category === 'text') {
    const visible = merged ? text.filter((row) => !ideIsCodePath(row.path)) : text
    for (const match of ideRankRows(visible, (row) => ideMatchRank(row.text, needle))) {
      entries.push({
        key: `t:${match.path}:${match.line}`,
        kind: 'text',
        label: `${ideBasename(match.path)}:${match.line}`,
        detail: match.text,
        path: match.path,
        line: match.line,
      })
    }
  }
  if (merged || category === 'actions') {
    for (const action of ideRankRows(actions, (row) => ideActionRank(row.label, needle))) {
      entries.push({ key: `a:${action.id}`, kind: 'actions', label: action.label, detail: '', action })
    }
  }
  return entries
}

/** Whether a matched line is a comment or an annotation rather than a declaration. */
function ideIsDeclarationLine(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return false
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('@')) return false
  return true
}

/** Rank one member match: a real modifier-bearing declaration wins, then any code line. */
function idePickDeclaration(rows) {
  const code = rows.filter((row) => ideIsDeclarationLine(row.text))
  const declaration = code.find((row) => /\b(public|private|protected|static|final|abstract)\b/.test(row.text))
  return declaration ?? code[0]
}

/**
 * Find the line of `member` inside one file.
 *
 * A bare word is not enough: `detail` also appears inside `ReconBillDetailResp`,
 * so the search is case-sensitive, scoped to the file, and shaped like a
 * declaration (`name(` for methods, `name;`/`name =` for fields). Comments and
 * annotations are dropped before ranking.
 *
 * @returns the 1-based line, or `undefined` when nothing matches.
 */
async function ideMemberLine(root, filePath, member, isCancelled) {
  const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [`\\b${escaped}\\s*\\(`, `\\b${escaped}\\s*[;=]`]
  for (const pattern of patterns) {
    const found = await ideGrepQuery(root, pattern, { path: filePath, caseSensitive: true })
    if (isCancelled()) return undefined
    if (found.ok !== true) continue
    const rows = found.matches.filter((match) => match.path === filePath)
    const pick = idePickDeclaration(rows)
    if (pick !== undefined) return pick.line
  }
  return undefined
}

/** The Search Everywhere dialog. */
function IdePalette({ store, tr, actions, onClose }) {
  // 「所有」 first, the way IDEA opens: classes, then symbols, then everything else.
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState([])
  const [classes, setClasses] = useState([])
  const [symbols, setSymbols] = useState([])
  const [text, setText] = useState([])
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape closes the dialog wherever the focus is: after clicking a category
  // tab or a result row the input no longer owns the key.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    globalThis.addEventListener('keydown', onKey, true)
    return () => globalThis.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Each source is asked only when its tab needs it, so a class query never runs
  // the text sweep. Every answer is dropped if the query changed.
  useEffect(() => {
    const needle = query.trim()
    if (needle === '') {
      setFiles([])
      setClasses([])
      setSymbols([])
      setText([])
      setBusy(false)
      return undefined
    }
    let cancelled = false
    setBusy(true)
    // Never keep the previous query's rows on screen: they read as results of
    // the text that is in the box right now.
    setFiles([])
    setClasses([])
    setSymbols([])
    setText([])
    const timer = setTimeout(async () => {
      const root = store.getState().rootPath
      const wantsFiles = category === 'all' || category === 'files'
      const wantsClasses = category === 'all' || category === 'class'
      const wantsSymbols = category === 'all' || category === 'symbol'
      const wantsText = category === 'all' || category === 'text'
      if (wantsFiles || wantsClasses) {
        const { queries, member } = idePaletteFileQueries(needle)
        const seen = new Set()
        const matched = []
        for (const query of queries) {
          const found = await store.searchFiles(query)
          if (cancelled) return
          if (found.ok !== true) continue
          for (const match of found.matches) {
            if (seen.has(match.path)) continue
            seen.add(match.path)
            matched.push({ path: match.path, line: undefined })
            if (matched.length >= IDE_PALETTE_FILES) break
          }
          if (matched.length >= IDE_PALETTE_FILES) break
        }
        // `C#member` should land on the member, not merely on its class. The
        // member is looked for inside each candidate file in turn, because a
        // fully-qualified name can resolve to an interface and its implementation.
        if (member !== '' && root !== '') {
          for (const candidate of matched) {
            const line = await ideMemberLine(root, candidate.path, member, () => cancelled)
            if (cancelled) return
            if (line !== undefined) {
              candidate.line = line
              break
            }
          }
        }
        setFiles(matched)
        setClasses(matched
          .filter((match) => ideIsCodePath(match.path))
          .map((match) => ({ path: match.path, line: match.line, name: ideClassName(match.path), fqn: ideFqnOf(match.path) })))
      }
      if (wantsSymbols && root !== '') {
        const pattern = ideSymbolPattern(needle)
        const found = pattern === '' ? { ok: true, matches: [] } : await ideGrepQuery(root, pattern, { extensions: IDE_CODE_EXTENSIONS, caseSensitive: true })
        if (cancelled) return
        const rows = found.ok === true ? found.matches : []
        const collected = []
        const seen = new Set()
        for (const row of rows) {
          const parsed = ideSymbolOfLine(row.text, needle)
          if (parsed === undefined) continue
          const key = `${row.path}:${row.line}`
          if (seen.has(key)) continue
          seen.add(key)
          collected.push({
            path: row.path,
            line: row.line,
            text: row.text,
            name: parsed.name,
            kind: parsed.kind,
            fqn: ideFqnOf(row.path),
          })
          if (collected.length >= IDE_PALETTE_SYMBOL) break
        }
        setSymbols(collected)
      }
      if (wantsText && root !== '') {
        const found = await ideGrepQuery(root, needle)
        if (cancelled) return
        const rows = found.ok === true ? found.matches : []
        setText(rows.slice(0, IDE_PALETTE_TEXT))
      }
      if (!cancelled) setBusy(false)
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, category, store])

  const needle = query.trim().toLowerCase()
  const visibleActions = useMemo(
    () => actions
      .map((action) => ({ ...action, label: tr(action.labelKey) }))
      .filter((action) => needle === '' || action.label.toLowerCase().includes(needle)),
    [actions, needle, tr],
  )
  const entries = useMemo(
    () => idePaletteEntries({ category, classes, symbols, files, text, actions: visibleActions, query }),
    [category, classes, symbols, files, text, visibleActions, query],
  )
  const active = entries.length === 0 ? 0 : Math.min(cursor, entries.length - 1)

  const runEntry = (entry) => {
    store.setPaletteOpen(false)
    if (entry.kind === 'actions') {
      entry.action.run()
      return
    }
    store.openAt(entry.path, entry.line)
  }

  return h('div', {
    className: 'iw-palette-backdrop',
    onMouseDown: onClose,
  }, [
    h('div', { key: 'box', className: 'iw-palette', onMouseDown: (event) => event.stopPropagation() }, [
      h('input', {
        key: 'input',
        ref: inputRef,
        className: 'iw-palette-input',
        type: 'text',
        value: query,
        placeholder: tr('palettePlaceholder'),
        'aria-label': tr('palettePlaceholder'),
        onChange: (event) => {
          setQuery(event.target.value)
          setCursor(0)
        },
        onKeyDown: (event) => {
          if (event.key === 'Tab') {
            event.preventDefault()
            const index = IDE_PALETTE_CATEGORIES.indexOf(category)
            const next = IDE_PALETTE_CATEGORIES[(index + 1) % IDE_PALETTE_CATEGORIES.length]
            setCategory(next)
            setCursor(0)
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setCursor(entries.length === 0 ? 0 : (active + 1) % entries.length)
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setCursor(entries.length === 0 ? 0 : (active - 1 + entries.length) % entries.length)
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const entry = entries[active]
            if (entry !== undefined) runEntry(entry)
          }
        },
      }),
      h('div', { key: 'tabs', className: 'iw-palette-tabs' },
        IDE_PALETTE_CATEGORIES.map((value) => h('button', {
          key: value,
          type: 'button',
          className: value === category ? 'iw-palette-tab active' : 'iw-palette-tab',
          onClick: () => {
            setCategory(value)
            setCursor(0)
          },
        }, tr(`paletteTab_${value}`)))),
      h('div', { key: 'list', className: 'iw-palette-list' },
        entries.length === 0
          ? h('div', { key: 'empty', className: 'iw-hint' }, busy ? tr('paletteBusy') : tr('paletteEmpty'))
          : entries.map((entry, index) => h('button', {
            key: entry.key,
            type: 'button',
            className: index === active ? 'iw-palette-row active' : 'iw-palette-row',
            onMouseEnter: () => setCursor(index),
            onClick: () => runEntry(entry),
          }, [
            h('span', { key: 'k', className: `iw-palette-kind k-${entry.kind}` }, tr(`paletteKind_${entry.kind}`)),
            h('span', { key: 'l', className: 'iw-palette-label' }, entry.label),
            entry.detail === '' ? null : h('span', { key: 'd', className: 'iw-palette-detail' }, entry.detail),
          ]))),
      h('div', { key: 'hint', className: 'iw-palette-hint' }, tr('paletteHint')),
    ]),
  ])
}

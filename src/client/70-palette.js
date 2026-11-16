/**
 * Search Everywhere.
 *
 * One dialog over three sources that this plugin can answer truthfully:
 *
 * - files   — the Host's workspace file search (names or `/`-joined paths)
 * - text    — content matches from the packaged ripgrep, via the Host route
 * - actions — the panel's own commands
 *
 * A symbol tab is deliberately absent: DSH's LSP seam exposes definition,
 * references, implementation and hover only, and no symbol index reaches a
 * Client half, so a "symbols" list could only ever be a guess.
 */

/** Palette categories, in tab order. */
const IDE_PALETTE_CATEGORIES = ['all', 'files', 'text', 'actions']

/** Largest number of rows each source contributes. */
const IDE_PALETTE_FILES = 40
const IDE_PALETTE_TEXT = 60

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

/** Flatten the enabled sources into one keyboard-navigable list. */
function idePaletteEntries({ category, files, text, actions }) {
  const entries = []
  if (category === 'all' || category === 'files') {
    for (const file of files) {
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
  if (category === 'all' || category === 'text') {
    for (const match of text) {
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
  if (category === 'all' || category === 'actions') {
    for (const action of actions) {
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
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState([])
  const [text, setText] = useState([])
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Each source is asked only when its tab is visible, so the text search never
  // runs for a file-only query. Both answers are dropped if the query changed.
  useEffect(() => {
    const needle = query.trim()
    if (needle === '') {
      setFiles([])
      setText([])
      setBusy(false)
      return undefined
    }
    let cancelled = false
    setBusy(true)
    const timer = setTimeout(async () => {
      const root = store.getState().rootPath
      if (category !== 'text') {
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
      }
      if (category !== 'files' && root !== '') {
        const found = await ideGrepQuery(root, needle)
        if (cancelled) return
        setText(found.ok === true ? found.matches.slice(0, IDE_PALETTE_TEXT) : [])
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
    () => idePaletteEntries({ category, files, text, actions: visibleActions }),
    [category, files, text, visibleActions],
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
          if (event.key === 'Escape') {
            event.preventDefault()
            store.setPaletteOpen(false)
            return
          }
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

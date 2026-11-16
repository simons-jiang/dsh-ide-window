/**
 * The workspace file tree: lazy directories, a name filter over loaded
 * directories, and the column resizer.
 *
 * Only expanded directories are listed, so the first paint costs one Host call.
 * Expansion also subscribes that directory to the change stream (the store owns
 * the subscription), which is what makes a file the agent just wrote appear
 * without a manual refresh.
 */

/** Indentation per depth level, in px. */
const IDE_INDENT = 14

/**
 * Java declaration kinds learned from the Host, keyed by `${root}|${path}`.
 *
 * The tree is file-based, but IDEA's Java badge says what the file declares;
 * the Host reads the first few KB of each file, and this cache keeps a redraw
 * from asking twice. `''` means "asked, no declaration found".
 */
const ideJavaKinds = new Map()

/**
 * Ask the Host for the Java kinds of `paths` that are not cached yet.
 *
 * Both the tree and the tab strip use this: the cache is shared, so a file the
 * tree already identified costs the tabs nothing.
 */
function ideRequestJavaKinds(root, paths, done) {
  const wanted = new Set()
  for (const path of paths) {
    if (typeof path !== 'string' || !path.endsWith('.java')) continue
    if (ideJavaKinds.has(`${root}|${path}`)) continue
    wanted.add(path)
  }
  if (wanted.size === 0) return
  const missing = [...wanted]
  void ideKindsQuery(root, missing).then((found) => {
    if (found.ok !== true) return
    for (const rel of missing) {
      ideJavaKinds.set(`${root}|${rel}`, typeof found.kinds[rel] === 'string' ? found.kinds[rel] : '')
    }
    done()
  })
}

/** One tree row. */
function IdeTreeRow({ entry, depth, node, state, store, tr }) {
  const isDir = entry.type === 'directory'
  const open = isDir && state.expanded.includes(entry.path)
  const active = !isDir && state.activePath === entry.path
  const javaKind = isDir ? '' : ideJavaKinds.get(`${state.rootPath}|${entry.path}`) ?? ''
  const depthPx = 8 + depth * IDE_INDENT
  return h('div', {
    className: `iw-row${active ? ' active' : ''}${isDir && !open ? ' dim' : ''}`,
    style: { paddingLeft: `${depthPx}px` },
    role: 'treeitem',
    'data-iw-path': entry.path,
    'aria-expanded': isDir ? (open ? 'true' : 'false') : undefined,
    'aria-selected': active ? 'true' : 'false',
    title: entry.path,
    onClick: () => {
      if (isDir) store.toggleDir(entry.path)
      else store.openFile(entry.path)
    },
  }, [
    h('span', { key: 'tw', className: 'iw-twisty' }, isDir ? h(IdeChevron, { open, size: 12 }) : null),
    h('span', { key: 'ic', className: 'iw-icon' }, isDir
      ? h(IdeFolderIcon, { open, size: IDE_ENTRY_ICON_SIZE })
      : h(IdeEntryIcon, { name: entry.name, kind: javaKind })),
    h('span', { key: 'nm', className: 'iw-name' }, entry.name),
  ])
}

/** Child rows of one loaded directory. */
function IdeTreeBranch({ path, depth, state, store, tr, rows }) {
  const node = state.dirs[path]
  if (node === undefined) return null
  if (node.status === 'loading' && (node.entries ?? []).length === 0) {
    rows.push(h('div', {
      key: `${path}#loading`,
      className: 'iw-hint',
      style: { paddingLeft: `${8 + depth * IDE_INDENT}px` },
    }, tr('loadingTree')))
    return null
  }
  if (node.status === 'error') {
    rows.push(h('div', {
      key: `${path}#error`,
      className: 'iw-hint error',
      style: { paddingLeft: `${8 + depth * IDE_INDENT}px` },
    }, `${tr('errorPrefix')}${node.error}`))
    return null
  }
  const entries = node.entries ?? []
  if (entries.length === 0 && path === '') {
    rows.push(h('div', { key: 'empty', className: 'iw-hint' }, tr('emptyDir')))
    return null
  }
  for (const entry of entries) {
    if (ideIsHiddenEntry(entry)) continue
    rows.push(h(IdeTreeRow, {
      key: entry.path,
      entry,
      depth,
      node,
      state,
      store,
      tr,
    }))
    if (entry.type === 'directory' && state.expanded.includes(entry.path)) {
      IdeTreeBranch({ path: entry.path, depth: depth + 1, state, store, tr, rows })
    }
  }
  if (node.truncated === true) {
    rows.push(h('div', {
      key: `${path}#truncated`,
      className: 'iw-hint',
      style: { paddingLeft: `${8 + depth * IDE_INDENT}px` },
    }, tr('truncated')))
  }
  return null
}

/**
 * Metadata other tools drop beside the sources.
 *
 * Eclipse's project model forces `.project`, `.classpath`, `.settings` and
 * `.factorypath` next to each imported Maven module — unavoidable for a Java
 * language server, and noise for someone who already lives in an IDE. They stay
 * on disk; the tree simply does not show them.
 */
const IDE_HIDDEN_NAMES = new Set(['.project', '.classpath', '.factorypath', '.settings', '.dsh-tmp'])

/** Whether one directory entry is tool metadata the tree suppresses. */
function ideIsHiddenEntry(entry) {
  return IDE_HIDDEN_NAMES.has(entry.name)
}

/** One workspace-search result: file name with its directory beside it. */
function IdeSearchRow({ match, store, tr }) {
  const split = ideSplitPath(match.path)
  return h('button', {
    type: 'button',
    className: 'iw-result',
    title: match.path,
    onClick: () => {
      store.setFilter('')
      store.openAt(match.path)
    },
  }, [
    h('span', { key: 'n', className: 'iw-result-name' }, split.name),
    h('span', { key: 'd', className: 'iw-result-dir' }, split.dir),
  ])
}

/** The result list shown while the search box has a query. */
function IdeSearchRows({ store, state, tr }) {
  const search = state.search ?? { status: 'idle', matches: [] }
  const total = (search.matches ?? []).length
  const header = search.status === 'loading'
    ? tr('searching')
    : search.status === 'error'
      ? `${tr('searchFailed')}: ${search.error}`
      : `${total} ${tr('searchResults')}${search.truncated === true ? ` ${tr('searchTruncated')}` : ''}`
  const rows = [h('div', { key: 'head', className: 'iw-hint' }, header)]
  if (search.status === 'ready' && total === 0) {
    rows.push(h('div', { key: 'none', className: 'iw-hint' }, tr('noSearchResults')))
  }
  for (const match of search.matches ?? []) {
    rows.push(h(IdeSearchRow, { key: `s:${match.path}`, match, store, tr }))
  }
  return rows
}

/** The tree column. */
function IdeTree({ store, state, tr }) {
  const inputRef = useRef(null)
  const searching = state.filter.trim() !== ''
  // Ask once per loaded directory for the Java kinds it does not know yet; the
  // stamp re-paints the rows when answers arrive.
  const [, setKindStamp] = useState(0)
  useEffect(() => {
    const root = state.rootPath
    if (root === '') return undefined
    const paths = []
    for (const node of Object.values(state.dirs ?? {})) {
      for (const entry of node?.entries ?? []) {
        if (entry?.type === 'file') paths.push(entry.path)
      }
    }
    let cancelled = false
    ideRequestJavaKinds(root, paths, () => {
      if (!cancelled) setKindStamp((value) => value + 1)
    })
    return () => { cancelled = true }
  }, [state.dirs, state.rootPath])

  // Reveal: scroll the row the store asked for. The effect also runs when a
  // directory finishes loading, so it lands after the ancestors are painted.
  const treeRef = useRef(null)
  useEffect(() => {
    const signal = state.revealFile
    const container = treeRef.current
    if (signal === null || signal === undefined || container === null) return undefined
    let row
    for (const candidate of container.querySelectorAll('[data-iw-path]')) {
      if (candidate.getAttribute('data-iw-path') === signal.path) {
        row = candidate
        break
      }
    }
    if (row === undefined) return undefined
    row.scrollIntoView({ block: 'center' })
    row.classList.add('flash')
    const timer = setTimeout(() => row.classList.remove('flash'), 1200)
    return () => {
      clearTimeout(timer)
      row.classList.remove('flash')
    }
  }, [state.revealFile, state.dirs])

  // ⌘P / Ctrl+P focuses the search box the way a file finder does; Escape
  // returns to the tree without touching the open tabs.
  // The binding for the filter box is user-configurable: read it at dispatch time so
  // a rebind takes effect without remounting the tree.
  const filterCommand = IDE_SHORTCUTS.find((entry) => entry.action === 'focus-filter')
  useEffect(() => {
    const onKey = (event) => {
      const stored = store.getState().shortcutBindings?.[filterCommand?.id]
      const binding = stored ?? (filterCommand === undefined
        ? { code: 'KeyP', modifiers: ['primary'] }
        : ideShortcutDefault(filterCommand, ideRuntimeContext.runtime))
      if (!ideBindingMatches(binding, event, ideRuntimeContext.platform)) return
      {
        event.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        return
      }
      if (event.key === 'Escape' && globalThis.document?.activeElement === inputRef.current) {
        store.setFilter('')
      }
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [store])

  const rows = searching ? IdeSearchRows({ store, state, tr }) : []
  if (!searching) {
    IdeTreeBranch({ path: '', depth: 0, state, store, tr, rows })
  }
  return h('div', {
    className: 'iw-tree',
    ref: treeRef,
    style: { width: `${state.treeWidth}px` },
    role: 'tree',
    'aria-label': tr('files'),
  }, [
    h('div', { key: 'tools', className: 'iw-tree-tools' }, [
      h('button', {
        key: 'reveal',
        type: 'button',
        className: 'iw-tree-tool',
        title: tr('treeReveal'),
        'aria-label': tr('treeReveal'),
        onClick: () => {
          if (!store.revealActive()) store.setNotice(tr('treeRevealNone'))
        },
      }, h(IdeLocateIcon, { size: 14 })),
      h('button', {
        key: 'expand',
        type: 'button',
        className: 'iw-tree-tool',
        title: tr('treeExpandAll'),
        'aria-label': tr('treeExpandAll'),
        onClick: () => {
          void store.expandAll().then((capped) => {
            if (capped === true) store.setNotice(tr('treeExpandLimit'))
          })
        },
      }, h(IdeExpandAllIcon, { size: 14 })),
      h('button', {
        key: 'collapse',
        type: 'button',
        className: 'iw-tree-tool',
        title: tr('treeCollapseAll'),
        'aria-label': tr('treeCollapseAll'),
        onClick: () => store.collapseAll(),
      }, h(IdeCollapseAllIcon, { size: 14 })),
    ]),
    h('div', { key: 'search', className: 'iw-search' }, [
      h('input', {
        key: 'input',
        ref: inputRef,
        type: 'search',
        value: state.filter,
        placeholder: tr('searchPlaceholder'),
        'aria-label': tr('searchPlaceholder'),
        onChange: (event) => store.setFilter(event.target.value),
      }),
      state.filter === ''
        ? null
        : h('button', {
          key: 'clear',
          type: 'button',
          className: 'iw-btn',
          style: { height: '18px', minWidth: '18px', padding: '0' },
          title: tr('close'),
          onClick: () => store.setFilter(''),
        }, h(IdeCloseIcon, { size: 9 })),
    ]),
    h('div', { key: 'scroll', className: 'iw-tree-scroll' }, rows),
  ])
}

/** The drag handle between the tree and the editor. */
function IdeResizer({ store, state, tr }) {
  const begin = (event) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = state.treeWidth
    const move = (moveEvent) => store.setTreeWidth(startWidth + (moveEvent.clientX - startX))
    const stop = () => {
      globalThis.removeEventListener('pointermove', move)
      globalThis.removeEventListener('pointerup', stop)
    }
    globalThis.addEventListener('pointermove', move)
    globalThis.addEventListener('pointerup', stop)
  }
  return h('div', {
    className: 'iw-resizer',
    role: 'separator',
    'aria-orientation': 'vertical',
    title: tr('treeWidthHint'),
    onPointerDown: begin,
  })
}

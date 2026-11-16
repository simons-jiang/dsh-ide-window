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

/** One tree row. */
function IdeTreeRow({ entry, depth, node, state, store, tr }) {
  const isDir = entry.type === 'directory'
  const open = isDir && state.expanded.includes(entry.path)
  const active = !isDir && state.activePath === entry.path
  const lang = isDir ? '' : ideLangOf(entry.name)
  const depthPx = 8 + depth * IDE_INDENT
  return h('div', {
    className: `iw-row${active ? ' active' : ''}${isDir && !open ? ' dim' : ''}`,
    style: { paddingLeft: `${depthPx}px` },
    role: 'treeitem',
    'aria-expanded': isDir ? (open ? 'true' : 'false') : undefined,
    'aria-selected': active ? 'true' : 'false',
    title: entry.path,
    onClick: () => {
      if (isDir) store.toggleDir(entry.path)
      else store.openFile(entry.path)
    },
  }, [
    h('span', { key: 'tw', className: 'iw-twisty' }, isDir ? h(IdeChevron, { open, size: 12 }) : null),
    h('span', { key: 'ic', className: 'iw-icon' }, isDir ? h(IdeFolderIcon, { open, size: 16 }) : h(IdeFileIcon, { lang, size: 16 })),
    h('span', { key: 'nm', className: 'iw-name' }, entry.name),
    !isDir && entry.size !== undefined ? h('span', { key: 'sz', className: 'iw-note' }, ideBytes(entry.size)) : null,
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
    style: { width: `${state.treeWidth}px` },
    role: 'tree',
    'aria-label': tr('files'),
  }, [
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

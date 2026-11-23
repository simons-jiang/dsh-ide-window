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
  // One directory can hold hundreds of long package paths; the Host caps the body,
  // so ask in batches instead of losing the whole directory to a 413.
  const batches = []
  for (let index = 0; index < missing.length; index += 120) batches.push(missing.slice(index, index + 120))
  void (async () => {
    let answered = false
    for (const batch of batches) {
      const found = await ideKindsQuery(root, batch)
      if (found.ok !== true) continue
      answered = true
      for (const rel of batch) {
        ideJavaKinds.set(`${root}|${rel}`, typeof found.kinds[rel] === 'string' ? found.kinds[rel] : '')
      }
    }
    if (answered) done()
  })()
}

/**
 * Directory listing order: folders first, then files, each group by name.
 *
 * The Host lists a directory the way the filesystem hands it over; an IDE
 * groups directories ahead of files so the shape of a module stays readable.
 */
function ideTreeOrder(left, right) {
  const leftDir = left?.type === 'directory' ? 0 : 1
  const rightDir = right?.type === 'directory' ? 0 : 1
  if (leftDir !== rightDir) return leftDir - rightDir
  return String(left?.name ?? '').localeCompare(String(right?.name ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

/**
 * The name class for one porcelain status code, the way an IDE paints it:
 * changed files in blue-green, new ones in brown-red.
 */
function ideVcsClass(status) {
  const text = String(status ?? '')
  if (text === '') return ''
  if (text === '??' || text.includes('A')) return 'vcs-added'
  if (text.includes('M') || text.includes('R') || text.includes('C') || text.includes('T')) return 'vcs-modified'
  return ''
}

/** One tree row. */
function IdeTreeRow({ entry, depth, node, state, store, tr }) {
  const isDir = entry.type === 'directory'
  const open = isDir && state.expanded.includes(entry.path)
  const active = !isDir && state.activePath === entry.path
  const javaKind = isDir ? '' : ideJavaKinds.get(`${state.rootPath}|${entry.path}`) ?? ''
  const vcs = isDir ? '' : ideVcsClass(state.vcs?.[entry.path])
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
    onContextMenu: (event) => {
      event.preventDefault()
      store.setTreeMenu({ path: entry.path, isDir, x: event.clientX, y: event.clientY })
    },
  }, [
    h('span', { key: 'tw', className: 'iw-twisty' }, isDir ? h(IdeChevron, { open, size: 12 }) : null),
    h('span', { key: 'ic', className: 'iw-icon' }, isDir
      ? h(IdeFolderIcon, { open, size: IDE_FOLDER_ICON_SIZE })
      : h(IdeEntryIcon, { name: entry.name, kind: javaKind })),
    h('span', { key: 'nm', className: `iw-name${vcs === '' ? '' : ` ${vcs}`}` }, entry.name),
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
  const ordered = entries.filter((entry) => !ideIsHiddenEntry(entry)).sort(ideTreeOrder)
  for (const entry of ordered) {
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
        title: tr('treeLocate'),
        'aria-label': tr('treeLocate'),
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

/* ── the file context menu ───────────────────────────────────────────── */

/** POST one Host route and unwrap its value. */
async function ideTreeRoute(name, body) {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  const url = new URL(`dsh-ide/${name}`, base).href
  const report = (failure, detail) => {
    ideLogRecord('error', 'route', `${name} ${failure}`, detail)
    return failure
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const parsed = await response.json().catch(() => null)
    if (parsed === null) {
      // An unknown route is answered by the carrier, not by this plugin: the
      // running Host predates the route.
      if (response.status === 404 || response.status === 405) {
        return { ok: false, error: 'route-missing' }
      }
      return report(`http-${response.status}`, 'the route answered without JSON')
    }
    if (parsed.ok !== true) {
      return report(parsed.error?.code ?? 'route-failed', parsed.error?.message ?? '')
    }
    return { ok: true, value: parsed.value }
  } catch (error) {
    return report('network', error?.message ?? 'fetch failed')
  }
}

/** Put text on the clipboard, falling back to a selection copy. */
function ideCopyToClipboard(text) {
  const clip = globalThis.navigator?.clipboard
  if (clip !== undefined && typeof clip.writeText === 'function') {
    void clip.writeText(text).catch(() => undefined)
    return true
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    document.execCommand('copy')
    area.remove()
    return true
  } catch {
    return false
  }
}

/** Absolute path of one workspace-relative path, in the platform's own form. */
function ideAbsolutePath(root, path) {
  const base = idePlatform.toPosix(root).replace(/\/+$/, '')
  const joined = path === '' ? base : `${base}/${idePlatform.toPosix(path)}`
  return idePlatform.toNative(joined)
}

/** Copy a value and say so in the banner. */
function ideCopyWithNotice(store, tr, text) {
  if (!ideCopyToClipboard(text)) {
    store.setNotice(tr('treeCopyFailed'))
    return
  }
  const shown = text.length > 90 ? `${text.slice(0, 87)}…` : text
  store.setNotice(`${tr('treeCopied')}: ${shown}`)
}

/** The banner text for one failed route call. */
function ideRouteErrorText(tr, result) {
  if (result.error === 'route-missing') return tr('treeRouteMissing')
  return String(result.message || result.error)
}

/** Fetch one file's patch and show it in the overlay. */
function ideShowPatch(store, tr, root, path, base, target) {
  void ideTreeRoute('patch', { workspaceRoot: root, path, base, target }).then((result) => {
    if (result.ok !== true) {
      store.setNotice(`${tr('treeDiffFailed')}: ${ideRouteErrorText(tr, result)}`)
      return
    }
    const value = result.value ?? {}
    if (value.untracked === true) {
      store.setNotice(tr('treeUntracked'))
      return
    }
    // Comparing a commit shows `<sha>^` as the base; the caret is noise.
    const reference = typeof value.base === 'string' && value.base !== 'HEAD'
      ? value.base.replace(/\^$/, '')
      : ''
    const title = `${ideBasename(path)}${reference === '' ? '' : ` · ${reference}`}`
    store.setTreePopup({
      kind: 'diff',
      title,
      text: typeof value.text === 'string' ? value.text : '',
      truncated: value.truncated === true,
    })
  })
}

/** Commits that touched a file, shown in the picker. */
function ideShowLog(store, tr, root, path, mode) {
  void ideTreeRoute('log', { workspaceRoot: root, path }).then((result) => {
    if (result.ok !== true) {
      store.setNotice(`${tr('treeLogFailed')}: ${ideRouteErrorText(tr, result)}`)
      return
    }
    const rows = Array.isArray(result.value?.rows) ? result.value.rows : []
    if (rows.length === 0) {
      store.setNotice(tr('treeNoHistory'))
      return
    }
    store.setTreePopup({ kind: 'pick', mode, path, title: `${ideBasename(path)} · ${tr('treeHistory')}`, rows })
  })
}

/** Branches and tags of the repository, shown in the picker. */
function ideShowRefs(store, tr, root, path) {
  void ideTreeRoute('refs', { workspaceRoot: root }).then((result) => {
    if (result.ok !== true) {
      store.setNotice(`${tr('treeRefsFailed')}: ${ideRouteErrorText(tr, result)}`)
      return
    }
    const rows = Array.isArray(result.value?.rows) ? result.value.rows : []
    if (rows.length === 0) {
      store.setNotice(tr('treeNoRefs'))
      return
    }
    store.setTreePopup({ kind: 'pick', mode: 'ref', path, title: `${ideBasename(path)} · ${tr('treeCompareRef')}`, rows })
  })
}

/** The file tree's context menu. */
function IdeTreeMenu({ store, state, tr, onReferenceToChat }) {
  const menu = state.treeMenu
  const placement = useMenuPlacement(menu?.x ?? 0, menu?.y ?? 0, 268)
  if (menu === null || menu === undefined) return null
  const path = menu.path
  const isDir = menu.isDir === true
  const root = state.rootPath
  const close = () => store.setTreeMenu(null)
  const then = (action) => () => {
    close()
    action()
  }
  const items = []
  if (!isDir) {
    items.push({ key: 'open', icon: IdeFileIcon, label: tr('treeOpen'), run: then(() => store.openFile(path)) })
  }
  items.push({ key: 'sep1', separator: true })
  if (!isDir) {
    items.push({
      key: 'copy-content',
      icon: IdeCopyIcon,
      label: tr('treeCopyContent'),
      run: then(() => {
        void ideTreeRoute('text', { workspaceRoot: root, path }).then((result) => {
          if (result.ok !== true) {
            store.setNotice(`${tr('treeCopyFailed')}: ${ideRouteErrorText(tr, result)}`)
            return
          }
          const value = result.value ?? {}
          if (value.truncated === true) store.setNotice(tr('treeTruncated'))
          ideCopyWithNotice(store, tr, typeof value.text === 'string' ? value.text : '')
        })
      }),
    })
  }
  items.push({
    key: 'copy-ref-chat',
    icon: IdeAtIcon,
    label: tr('treeReferenceToChat'),
    run: then(() => {
      void (typeof onReferenceToChat === 'function' ? onReferenceToChat(path, isDir) : undefined)
    }),
  })
  items.push({ key: 'copy-absolute', icon: IdeCopyIcon, label: tr('treeCopyPath'), run: then(() => ideCopyWithNotice(store, tr, ideAbsolutePath(root, path))) })
  items.push({ key: 'copy-relative', icon: IdeCopyIcon, label: tr('treeCopyRelative'), run: then(() => ideCopyWithNotice(store, tr, path)) })
  if (!isDir && /\.(java|kt|kts|scala|groovy)$/i.test(path)) {
    items.push({ key: 'copy-fqn', icon: IdeLinkIcon, label: tr('treeCopyFqn'), run: then(() => ideCopyWithNotice(store, tr, ideFqnOf(path))) })
  }
  if (!isDir && /\.(java|kt)$/i.test(path) && ideDataWindowAvailable()) {
    items.push({
      key: 'data-window',
      icon: IdeLinkIcon,
      label: tr('treeOpenInDataWindow'),
      run: then(() => { void ideDataWindowOpenEntity(store, tr, root, path) }),
    })
  }
  if (!isDir) {
    items.push({ key: 'sep2', separator: true })
    items.push({ key: 'git', section: tr('treeGitSection') })
    items.push({
      key: 'annotate',
      icon: IdeDotIcon,
      label: tr('treeAnnotate'),
      run: then(() => {
        store.openFile(path)
        if ((store.getState().annotate ?? {})[path] !== true) store.toggleAnnotate(path)
      }),
    })
    items.push({ key: 'diff', icon: IdeLayersIcon, label: tr('treeDiff'), run: then(() => ideShowPatch(store, tr, root, path, 'HEAD', '')) })
    items.push({ key: 'history', icon: IdeClockIcon, label: tr('treeHistory'), run: then(() => ideShowLog(store, tr, root, path, 'history')) })
    items.push({ key: 'revision', icon: IdeArrowLeftIcon, label: tr('treeCompareRevision'), run: then(() => ideShowLog(store, tr, root, path, 'revision')) })
    items.push({ key: 'ref', icon: IdeStackIcon, label: tr('treeCompareRef'), run: then(() => ideShowRefs(store, tr, root, path)) })
  }
  // A directory now leads the menu with a separator, which would be a stray line.
  const visible = items.filter((item, index) => item.separator !== true || (index > 0 && items[index - 1]?.separator !== true))
  const rows = visible.map((item) => {
    if (item.separator === true) return h('div', { key: item.key, className: 'iw-menu-sep' })
    if (item.section !== undefined) return h('div', { key: item.key, className: 'iw-menu-section' }, item.section)
    return h('button', {
      key: item.key,
      type: 'button',
      role: 'menuitem',
      className: 'iw-menu-item',
      onClick: item.run,
    }, [
      h('span', { key: 'ic', className: 'iw-menu-icon' }, h(item.icon, { size: 13 })),
      h('span', { key: 'lb', className: 'iw-menu-label' }, item.label),
    ])
  })
  return h(React.Fragment, null, [
    h(IdeStyles, { key: 'style' }),
    h('div', {
      key: 'backdrop',
      className: 'iw-menu-backdrop',
      onPointerDown: close,
      onContextMenu: (event) => {
        event.preventDefault()
        close()
      },
    }, h('div', {
      key: 'menu',
      className: 'iw-menu',
      role: 'menu',
      'aria-label': tr('treeMenuLabel'),
      ref: placement.ref,
      style: placement.style,
      onPointerDown: (event) => event.stopPropagation(),
    }, rows)),
  ])
}

/** The difference view and the revision pickers used by the tree menu. */
function IdeTreePopup({ store, state, tr }) {
  const popup = state.treePopup
  if (popup === null || popup === undefined) return null
  const close = () => store.setTreePopup(null)
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    globalThis.addEventListener('keydown', onKey, true)
    return () => globalThis.removeEventListener('keydown', onKey, true)
  }, [store])
  const card = (children) => h('div', {
    key: 'backdrop',
    className: 'iw-overlay',
    onPointerDown: close,
    onContextMenu: (event) => {
      event.preventDefault()
      close()
    },
  }, h('div', {
    key: 'card',
    className: 'iw-pop',
    onPointerDown: (event) => event.stopPropagation(),
  }, children))
  const head = (title) => h('div', { key: 'head', className: 'iw-pop-head' }, [
    h('span', { key: 't', className: 'iw-pop-name' }, title),
    h('button', { key: 'x', type: 'button', className: 'iw-pop-close', title: tr('close'), onClick: close }, '\u00d7'),
  ])
  if (popup.kind === 'diff') {
    const lines = String(popup.text ?? '').split('\n')
    return card([
      head(`${popup.title}${popup.truncated === true ? ` · ${tr('treeTruncated')}` : ''}`),
      h('div', { key: 'body', className: 'iw-diff-body' }, lines.length === 1 && lines[0] === ''
        ? h('div', { key: 'empty', className: 'iw-hint' }, tr('treeNoDiff'))
        : lines.map((line, index) => h('div', {
          key: index,
          className: `iw-diff-line${line.startsWith('+') ? ' add' : line.startsWith('-') ? ' del' : line.startsWith('@@') ? ' hunk' : ''}`,
        }, line === '' ? ' ' : line))),
    ])
  }
  const pick = (row) => {
    close()
    const path = popup.path
    if (popup.mode === 'ref') ideShowPatch(store, tr, state.rootPath, path, row.name, '')
    else if (popup.mode === 'revision') ideShowPatch(store, tr, state.rootPath, path, row.sha, '')
    else ideShowPatch(store, tr, state.rootPath, path, `${row.sha}^`, row.sha)
  }
  return card([
    head(popup.title),
    h('div', { key: 'body', className: 'iw-pick-body' }, popup.rows.map((row) => h('button', {
      key: popup.mode === 'ref' ? row.name : row.sha,
      type: 'button',
      className: 'iw-pick-row',
      onClick: () => pick(row),
    }, popup.mode === 'ref'
      ? [
        h('span', { key: 'main', className: 'iw-pick-main' }, row.name),
        h('span', { key: 'sub', className: 'iw-pick-sub' }, row.kind === 'tag' ? tr('treeTag') : tr('treeBranch')),
      ]
      : [
        h('span', { key: 'main', className: 'iw-pick-main' }, `${row.sha} ${row.subject}`),
        h('span', { key: 'sub', className: 'iw-pick-sub' }, `${row.author} · ${row.date}`),
      ]))),
  ])
}

/**
 * The centre panel: toolbar, tree, tab strip and source view.
 *
 * The panel adopts the Session on screen (and its workspace root) on every
 * render, so switching conversations while the panel is open re-roots the tree
 * instead of showing the previous project.
 */

/** Read the Session currently on screen from the right-Sidebar controller. */
function ideUseMountedSession(sidebarRight) {
  const subscribe = useCallback((listener) => {
    const mounted = sidebarRight?.mounted
    if (mounted === undefined || typeof mounted.subscribe !== 'function') return () => {}
    return mounted.subscribe(listener)
  }, [sidebarRight])
  const getSnapshot = useCallback(() => {
    const mounted = sidebarRight?.mounted
    if (mounted === undefined || typeof mounted.getSnapshot !== 'function') return undefined
    return mounted.getSnapshot()
  }, [sidebarRight])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The sidebar navigation icon for this panel (owner props: `size`, `active`). */
function IdePanelIcon({ size, active }) {
  const box = typeof size === 'number' && size > 0 ? size : 16
  return h('span', {
    style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', opacity: active === false ? 0.78 : 1 },
  }, h(IdeTreeIcon, { size: box }))
}

/** One toolbar button. */
function IdeToolButton({ title, on, onClick, children, disabled }) {
  return h('button', {
    type: 'button',
    className: `iw-btn${on === true ? ' on' : ''}`,
    title,
    'aria-label': title,
    onClick,
    disabled: disabled === true,
    style: disabled === true ? { opacity: 0.4, cursor: 'default' } : undefined,
  }, children)
}

/** The entry in the conversation header: opens the code workspace. */
function IdeHeaderEntry({ store, translate, openPanel }) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const active = state.rootPath !== ''
  return h('button', {
    type: 'button',
    className: `iw-header-entry${active ? ' active' : ''}`,
    title: `${tr('title')}  ⌘2`,
    onClick: () => {
      if (typeof openPanel === 'function') openPanel()
    },
  }, [
    h(IdeFileIcon, { key: 'ic', lang: '', size: 14 }),
    h('span', { key: 't', className: 'iw-header-entry-label' }, tr('title')),
  ])
}

/** The project chip, which opens a workspace switcher. */
function IdeProjectMenu({ store, state, projects, tr, onSelectProject }) {
  const [open, setOpen] = useState(false)
  const current = state.rootPath === '' ? tr('title') : ideBasename(state.rootPath)

  // Same dismissal contract as the usage popup: a pointer down anywhere outside.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      const element = event.target
      if (element instanceof Element && element.closest('.iw-project') !== null) return
      setOpen(false)
    }
    globalThis.addEventListener('pointerdown', onDown, true)
    return () => globalThis.removeEventListener('pointerdown', onDown, true)
  }, [open])

  // No "follow" row: the panel always follows the Session. Choosing another
  // project switches to a Session of it, which is how the binding moves.
  const rows = projects.map((project) => ({
    path: project.path,
    title: project.title,
    detail: project.path,
  }))

  return h('div', { className: 'iw-project' }, [
    h('button', {
      key: 'btn',
      type: 'button',
      className: 'iw-project-btn',
      title: tr('projectSwitch'),
      onClick: () => setOpen(!open),
    }, [
      h(IdeFileIcon, { key: 'ic', lang: '', size: 15 }),
      h('span', { key: 'nm', className: 'iw-project-name' }, current),
      h('span', { key: 'c', className: 'iw-project-caret' }, '\u25be'),
    ]),
    open
      ? h('div', { key: 'menu', className: 'iw-project-menu' }, rows.map((row) => h('button', {
        key: row.path === '' ? '#follow' : row.path,
        type: 'button',
        className: row.path === state.rootPath ? 'iw-project-row active' : 'iw-project-row',
        title: row.detail === '' ? row.title : row.detail,
        onClick: () => {
          setOpen(false)
          if (typeof onSelectProject === 'function') onSelectProject(row.path)
        },
      }, [
        h('span', { key: 't', className: 'iw-project-row-title' }, row.title),
        row.detail === '' ? null : h('span', { key: 'p', className: 'iw-project-row-path' }, row.detail.replace(/^\/Users\/[^/]+/, '~')),
      ])))
      : null,
  ])
}

/** The toolbar. */
function IdeToolbar({ store, state, tr, projects, onSelectProject, onToggleSidebar }) {
  return h('div', { className: 'iw-toolbar' }, [
    h(IdeProjectMenu, { key: 'project', store, state, projects, tr, onSelectProject }),
    h('div', { key: 'history', className: 'iw-history' }, [
      h(IdeToolButton, {
        key: 'back',
        title: tr('navBack'),
        disabled: (state.historyBack ?? []).length === 0,
        onClick: () => store.goBack(),
      }, h(IdeArrowLeftIcon, { size: 15 })),
      h(IdeToolButton, {
        key: 'forward',
        title: tr('navForward'),
        disabled: (state.historyForward ?? []).length === 0,
        onClick: () => store.goForward(),
      }, h(IdeArrowRightIcon, { size: 15 })),
    ]),
    h('div', { key: 'gap', className: 'iw-spacer' }),
    h(IdeToolButton, {
      key: 'tree',
      title: state.treeVisible ? tr('hideFiles') : tr('showFiles'),
      on: state.treeVisible,
      onClick: () => store.setTreeVisible(!state.treeVisible),
    }, h(IdeTreeIcon, { size: 15 })),
    h(IdeToolButton, {
      key: 'live',
      title: state.watching ? tr('liveOn') : tr('liveOff'),
      on: state.watching,
      onClick: () => store.setWatching(!state.watching),
    }, [h(IdeLiveDot, { key: 'd', on: state.watching }), h('span', { key: 'l' }, tr('live'))]),
    h(IdeToolButton, {
      key: 'refresh',
      title: tr('refreshTree'),
      onClick: () => store.refreshAll(),
    }, h(IdeRefreshIcon, { size: 15 })),
    h(IdeToolButton, {
      key: 'search',
      title: tr('paletteHint'),
      onClick: () => store.setPaletteOpen(true),
    }, h(IdeSearchIcon, { size: 15 })),
    h(IdeToolButton, {
      key: 'jump',
      title: state.jumpEnabled === true ? tr('jumpOn') : tr('jumpOff'),
      on: state.jumpEnabled === true,
      onClick: () => store.setJumpEnabled(!state.jumpEnabled),
    }, h(IdeLinkIcon, { size: 15 })),
    h(IdeToolButton, {
      key: 'shell',
      title: tr('toggleNav'),
      onClick: onToggleSidebar,
    }, h(IdeSidebarIcon, { size: 15 })),
  ])
}

/** The empty state shown while no file is open. */
function IdeEmptyEditor({ tr }) {
  return h('div', { className: 'iw-empty' }, [
    h('div', { key: 't', className: 'iw-empty-title' }, tr('title')),
    h('div', { key: 'h' }, tr('openTabHint')),
  ])
}

/** Opens the setup guide once per page load; closing it keeps it closed. */
let ideSetupDismissed = false

/**
 * The guide shown when the LSP seam is not mounted.
 *
 * Browsing works without a language server; navigating does not. The page says
 * what is missing, how to install the pinned LSP packages, where the JetBrains
 * licence lives, and re-checks on demand.
 */
function IdeSetupDialog({ tr, open, busy, still, onCheck, onClose }) {
  if (open !== true) return null
  return h('div', {
    key: 'backdrop',
    className: 'iw-setup-backdrop',
    onPointerDown: onClose,
  }, h('div', {
    key: 'card',
    className: 'iw-setup',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': tr('setupTitle'),
    onPointerDown: (event) => event.stopPropagation(),
  }, [
    h('div', { key: 'title', className: 'iw-setup-title' }, tr('setupTitle')),
    h('div', { key: 'body', className: 'iw-setup-body' }, [
      h('p', { key: 'p' }, tr('setupBody')),
      h('ol', { key: 'steps', className: 'iw-setup-steps' }, [
        h('li', { key: 's1' }, tr('setupStep1')),
        h('li', { key: 's2' }, tr('setupStep2')),
        h('li', { key: 's3' }, tr('setupStep3')),
      ]),
    ]),
    h('pre', { key: 'code', className: 'iw-setup-code' },
      'dsh plugin --profile desktop add \\\n  @deepseek-ai/dsh-lsp@0.2.2-rc.3 \\\n  @deepseek-ai/dsh-lsp-stdio@0.2.2-rc.3'),
    h('div', { key: 'licence', className: 'iw-setup-link' }, [
      `${tr('setupLicence')} `,
      h('a', {
        key: 'a',
        href: 'https://account.jetbrains.com/licenses',
        target: '_blank',
        rel: 'noreferrer',
      }, 'account.jetbrains.com'),
    ]),
    still === true
      ? h('div', { key: 'still', className: 'iw-setup-still' }, tr('setupStill'))
      : null,
    h('div', { key: 'actions', className: 'iw-setup-actions' }, [
      h('button', {
        key: 'check',
        type: 'button',
        className: 'iw-btn',
        disabled: busy === true,
        onClick: onCheck,
      }, busy === true ? tr('setupChecking') : tr('setupRecheck')),
      h('button', {
        key: 'close',
        type: 'button',
        className: 'iw-btn primary',
        onClick: onClose,
      }, tr('setupClose')),
    ]),
  ]))
}

/** The centre panel entry. */
/** How many times the panel body has rendered; a probe can read it. */
let idePanelRenders = 0

function IdePanel({ store, translate, onBackToChat, onToggleSidebar, onEnter, useSessions, useWorkspaces, navigate, paletteActions }) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const actions = paletteActions ?? []

  // IDEA's gesture: two Shift presses in quick succession open Search Everywhere.
  // The key and the window come from the shortcut registry, not from here.
  const sequence = IDE_SHORTCUTS.find((entry) => entry.action === 'palette')?.sequence
    ?? { key: 'Shift', repeat: 2, windowMs: 400 }
  useEffect(() => {
    const DOUBLE_SHIFT_MS = sequence.windowMs
    let lastShift = 0
    const onKey = (event) => {
      if (event.key !== sequence.key || event.repeat === true) return
      const now = Date.now()
      if (lastShift !== 0 && now - lastShift <= DOUBLE_SHIFT_MS) {
        lastShift = 0
        store.setPaletteOpen(true)
        return
      }
      lastShift = now
    }
    globalThis.addEventListener('keyup', onKey)
    return () => globalThis.removeEventListener('keyup', onKey)
  }, [store])
  // Coming back to the window re-reads the active file: a commit changes git's
  // view of it without changing its bytes, so no change frame arrives.
  useEffect(() => {
    const onFocus = () => store.reloadActive?.()
    globalThis.addEventListener('focus', onFocus)
    return () => globalThis.removeEventListener('focus', onFocus)
  }, [store])

  // The setup guide: one check when the workspace is entered, then on demand.
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupStill, setSetupStill] = useState(false)
  useEffect(() => {
    let cancelled = false
    void ideDoctorQuery().then((found) => {
      if (cancelled || found.ok !== true || found.lsp === true) return
      if (!ideSetupDismissed) setSetupOpen(true)
    })
    return () => { cancelled = true }
  }, [])
  const checkSetup = () => {
    setSetupBusy(true)
    setSetupStill(false)
    void ideDoctorQuery().then((found) => {
      setSetupBusy(false)
      if (found.ok === true && found.lsp === true) {
        setSetupOpen(false)
        store.setNotice(tr('setupReady'))
        return
      }
      setSetupOpen(true)
      setSetupStill(true)
    })
  }
  const closeSetup = () => {
    ideSetupDismissed = true
    setSetupOpen(false)
  }

  idePanelRenders += 1
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const tab = state.tabs.find((entry) => entry.path === state.activePath)

  // Second resolver: the panel asks the same two snapshots the tracker uses, so
  // a tracker that missed its pass cannot leave the panel blank. Both writers
  // compute the same values from the same sources, so they cannot disagree.
  const selectSessions = typeof useSessions === 'function' ? useSessions : () => undefined
  const selectWorkspaces = typeof useWorkspaces === 'function' ? useWorkspaces : () => undefined
  const sessions = selectSessions((snapshot) => snapshot)
  const workspaces = selectWorkspaces((snapshot) => snapshot)
  const resolved = ideResolveTarget(undefined, sessions, workspaces)

  // Every workspace the shell knows about, plus the Session-derived root, which
  // may not belong to a registered workspace yet.
  const projects = []
  const seenPaths = new Set()
  for (const item of Array.isArray(workspaces?.items) ? workspaces.items : []) {
    const path = typeof item?.path === 'string' ? item.path.replace(/\/+$/, '') : ''
    if (path === '' || seenPaths.has(path)) continue
    seenPaths.add(path)
    projects.push({ path, title: typeof item?.title === 'string' && item.title !== '' ? item.title : ideBasename(path) })
  }
  const resolvedRoot = typeof resolved.root === 'string' ? resolved.root.replace(/\/+$/, '') : ''
  if (resolvedRoot !== '' && !seenPaths.has(resolvedRoot)) {
    projects.unshift({ path: resolvedRoot, title: ideBasename(resolvedRoot) })
  }

  const workspaceItems = Array.isArray(workspaces?.items) ? workspaces.items : []
  const sessionOfProject = (path) => {
    if (path === '') return undefined
    const item = workspaceItems.find((entry) => typeof entry?.path === 'string'
      && entry.path.replace(/\/+$/, '') === path)
    const ids = Array.isArray(item?.sessionIds) ? item.sessionIds : []
    return typeof ids[0] === 'string' ? ids[0] : undefined
  }

  // The Session decides which workspace the panel shows. Opening the panel from
  // a conversation therefore lands in that conversation's project, every time.
  useEffect(() => {
    if (typeof resolved.sessionId === 'string') store.rememberSession(resolved.sessionId)
    if (resolvedRoot !== '') store.setRoot(resolvedRoot)
  }, [resolved.sessionId, resolvedRoot, store])

  /** Switch projects: adopt a Session of that workspace first, then re-root. */
  const selectProject = (path) => {
    const sessionId = sessionOfProject(path)
    if (sessionId === undefined) {
      store.setNotice(tr('projectNoSession'))
      return
    }
    store.rememberSession(sessionId)
    store.setRoot(path)
  }

  // Mouse side buttons are the usual back/forward gesture; Chromium would take
  // them as history navigation, so both edges are claimed for the code history.
  useEffect(() => {
    // Only `auxclick` performs the step. `mousedown`/`mouseup` merely suppress
    // the browser's own history navigation, otherwise one press would walk the
    // history three times.
    const isSideButton = (event) => event.button === 3 || event.button === 4
    const suppress = (event) => {
      if (!isSideButton(event)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onAuxClick = (event) => {
      if (!isSideButton(event)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.button === 3) store.goBack()
      else store.goForward()
    }
    globalThis.addEventListener('mousedown', suppress, true)
    globalThis.addEventListener('mouseup', suppress, true)
    globalThis.addEventListener('auxclick', onAuxClick, true)
    return () => {
      globalThis.removeEventListener('mousedown', suppress, true)
      globalThis.removeEventListener('mouseup', suppress, true)
      globalThis.removeEventListener('auxclick', onAuxClick, true)
    }
  }, [store])

  // Coming back to the window is a reliable moment to re-read open files: an
  // external editor may have saved while this page was in the background.
  useEffect(() => {
    let timer
    const refreshSoon = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => { timer = undefined; store.refreshTabs() }, 200)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refreshSoon() }
    globalThis.addEventListener('focus', refreshSoon)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      globalThis.removeEventListener('focus', refreshSoon)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [store])

  // Selecting this panel is what starts the mode: the navigation column folds
  // away and the conversation floats over the panel. Unmounting reverses both.
  useEffect(() => {
    if (typeof onEnter !== 'function') return undefined
    return onEnter()
  }, [onEnter])

  const missing = state.sessionId === null
    ? `session=${state.sessionId === null ? 'none' : state.sessionId} root=${state.rootPath === '' ? 'none' : state.rootPath} remote=${state.remoteReady === true ? 'ready' : 'waiting'}`
    : undefined

  let content
  if (state.sessionId === null || state.rootPath === '') {
    content = h('div', { className: 'iw-empty' }, [
      h('div', { key: 't', className: 'iw-empty-title' }, tr('noWorkspace')),
      h('div', { key: 'h' }, tr('noWorkspaceHint')),
      h('button', {
        key: 'retry',
        type: 'button',
        className: 'iw-btn primary',
        onClick: () => store.retryResolve(),
      }, tr('reload')),
      h('div', {
        key: 'diag',
        style: { marginTop: '10px', fontSize: '11px', opacity: 0.65, fontFamily: 'ui-monospace, monospace' },
      }, missing ?? ''),
    ])
  } else if (tab === undefined) {
    content = h(IdeEmptyEditor, { key: 'empty', tr })
  } else if (tab.status === 'error') {
    content = h('div', { className: 'iw-empty' }, [
      h('div', { key: 't', className: 'iw-empty-title' }, tr('fileNotText')),
      h('div', { key: 'e' }, `${tr('errorPrefix')}${tab.error}`),
      h('button', {
        key: 'r',
        type: 'button',
        className: 'iw-btn primary',
        onClick: () => store.openFile(tab.path),
      }, tr('reload')),
    ])
  } else {
    content = h(IdeCodeView, { key: `code:${tab.path}`, tab, tr, store, navigate })
  }

  const banner = state.liveNotice === ''
    ? null
    : h('div', { key: 'banner', className: 'iw-banner' }, state.liveNotice)

  const codeSize = Number.isFinite(state.codeFontSize) ? state.codeFontSize : 12.5
  const treeSize = Number.isFinite(state.treeFontSize) ? state.treeFontSize : 14.5
  return h('div', {
    className: 'iw-root',
    // The editor and the tree share one typographic scale, set in Settings.
    style: {
      '--iw-code-font-size': `${codeSize}px`,
      '--iw-code-line-height': `${Math.round(codeSize * 1.6)}px`,
      '--iw-tree-font-size': `${treeSize}px`,
      '--iw-row-height': `${Math.round(treeSize * 1.86)}px`,
    },
  }, [
    h(IdeStyles, { key: 'style' }),
    h(IdeToolbar, { key: 'toolbar', store, state, tr, projects, onSelectProject: selectProject, onToggleSidebar }),
    banner,
    h(IdeGutterMenu, {
      key: 'guttermenu',
      store,
      state,
      tr,
    }),
    h(IdeTabMenu, {
      key: 'tabmenu',
      store,
      state,
      tr,
      copy: (text) => {
        const clip = globalThis.navigator?.clipboard
        if (clip !== undefined && typeof clip.writeText === 'function') {
          void clip.writeText(text).catch(() => undefined)
        }
        store.setNotice(`${tr('tabMenuCopied')}: ${text}`)
      },
    }),
    h(IdeSetupDialog, {
      key: 'setup',
      tr,
      open: setupOpen,
      busy: setupBusy,
      still: setupStill,
      onCheck: checkSetup,
      onClose: closeSetup,
    }),
    h('div', { key: 'body', className: 'iw-body' }, [
      state.treeVisible ? h(IdeTree, { key: 'tree', store, state, tr }) : null,
      state.treeVisible ? h(IdeResizer, { key: 'resize', store, state, tr }) : null,
      h('div', { key: 'editor', className: 'iw-editor' }, [
        h(IdeTabStrip, { key: 'tabs', store, state, tr, onBackToChat }),
        tab === undefined
          ? null
          : h(IdeCrumbs, {
            key: 'crumbs',
            // A jar tab has no workspace path: show where it really came from.
            path: tab.kind === 'jar' ? `${tab.dir}/${tab.name}` : tab.path,
          }),
        content,
      ]),
    ]),
    h(IdeStatusBar, { key: 'status', store, state, tab, tr }),
    state.paletteOpen
      ? h(IdePalette, {
        key: 'palette',
        store,
        tr,
        actions,
        onClose: () => store.setPaletteOpen(false),
      })
      : null,
  ])
}

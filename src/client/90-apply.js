/**
 * Client activation.
 *
 * The plugin occupies four seats and drives one mode:
 *
 *  - `main` (keyed `dsh-ide-window:code`) — the code workspace itself.
 *  - `conversation.header.leading` — the entry left of the Session title, so the
 *    workspace is reachable from the top of the window rather than the sidebar.
 *  - (was) `sidebar.panellist` — removed: the workspace no longer seats in the
 *    left column.
 *    sidebar owns the button, its label and its selected state.
 *  - `sidebar.footer.action` — one always-visible control beside Settings, since
 *    nav rows can be folded into the sidebar's More menu.
 *  - `shell.overlay` — a headless tracker that remembers the Session on screen
 *    while the Conversation still holds the main column.
 *  - a right-Sidebar page type + body — the conversation, floated over the panel.
 *
 * Entering the mode selects the panel; the panel's own mount effect hides the
 * navigation column and opens the floating conversation, and its unmount effect
 * puts both back. Because the Conversation then holds no editable composer of
 * its own, the floating occurrence is the only one — which is what the
 * Conversation's single-editor rule requires.
 */

/**
 * Whether the shell's navigation column is collapsed.
 *
 * `ctx.layout.toggleSidebar()` is a bare toggle and the layout service exposes
 * no readable state, so the frame's own `data-sidebar-collapsed` marker is the
 * only way to avoid flipping a column the user already had closed. The probe is
 * tolerant: without the marker it reports "expanded", which is the default.
 */
function ideSidebarCollapsed() {
  try {
    const layer = document.querySelector('[data-shell-overlay]')
    const frame = layer === null ? null : layer.parentElement
    return frame === null ? false : frame.hasAttribute('data-sidebar-collapsed')
  } catch (error) {
    void error
    return false
  }
}

/** The always-available sidebar-foot control. */
function IdeFooterAction({ wide, store, translate, openPanel, backToChat }) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  void store
  const onClick = () => {
    const layout = store.layout()
    const active = layout?.panelInfo?.getSnapshot?.()?.activePanelId
    if (active === IDE_PANEL_ID) backToChat()
    else openPanel()
  }
  return h(React.Fragment, null, [
    h(IdeStyles, { key: 'style' }),
    h('button', {
      key: 'button',
      type: 'button',
      className: 'iw-btn',
      title: tr('title'),
      'aria-label': tr('title'),
      onClick,
      style: wide === true ? { padding: '0 8px', gap: '6px' } : { minWidth: '26px', padding: '0 4px' },
    }, [
      h(IdeTreeIcon, { key: 'ic', size: 15 }),
      wide === true ? h('span', { key: 'lb' }, tr('title')) : null,
    ]),
  ])
}

/** Module entry. */
function apply(ctx) {
  const refs = {
    remote: { current: undefined },
    files: { current: undefined },
    layout: { current: undefined },
    // Used by the address-claim body to close the tab it consumed.
    sidebarRight: { current: undefined },
  }
  const store = ideCreateStore(refs)

  let bound
  try {
    if (ctx.locale !== undefined && typeof ctx.locale.register === 'function') {
      ctx.locale.register(IDE_NS, { en: IDE_TEXT_EN, zh: IDE_TEXT_ZH })
      for (const alias of ['zh-CN', 'zh-Hans']) {
        try {
          ctx.locale.register(IDE_NS, alias, IDE_TEXT_ZH)
        } catch (error) {
          void error
        }
      }
      const candidate = ctx.locale.bind(IDE_NS)
      if (typeof candidate === 'function') bound = candidate
    }
  } catch (error) {
    // A host without the locale face still renders: `translate` falls back to
    // the dictionary the bundle carries.
    void error
  }
  const translate = ideMakeTranslator(ctx, bound)

  /**
   * The palette's command list.
   *
   * Only commands this panel actually owns: a searchable list of things that do
   * nothing would be worse than a short one that always works.
   */
  const paletteActions = [
    { id: 'tree', labelKey: 'paletteActionTree', run: () => store.setTreeVisible(!store.getState().treeVisible) },
    { id: 'refresh', labelKey: 'paletteActionRefresh', run: () => store.refreshAll() },
    { id: 'jump', labelKey: 'paletteActionJump', run: () => store.setJumpEnabled(!store.getState().jumpEnabled) },
    { id: 'closeTabs', labelKey: 'paletteActionCloseTabs', run: () => store.closeAllTabs() },
    { id: 'back', labelKey: 'paletteActionBack', run: () => backToChat() },
  ]


  // Services arrive on their own schedule; every one of them is optional here so
  // a partially composed client renders the pieces it can.
  try {
    // The namespace is its own inject key on the Remote face: declaring only
    // `remote` and reading `.workspaceFiles` off the proxy throws at the first
    // call. Declare both and keep the namespace object once it is legally
    // readable here.
    ctx.inject(['remote', 'remote.workspaceFiles'], (scoped) => {
      if (scoped.remote === undefined) return
      refs.remote.current = scoped.remote
      refs.files.current = scoped.remote.workspaceFiles
      store.markRemoteReady()
      // Anything read before the face arrived was never answered, and the tree
      // may still hold a placeholder for it: relist from scratch.
      store.refreshAll()
    })
  } catch (error) {
    void error
  }
  try {
    ctx.inject(['layout'], (scoped) => {
      refs.layout.current = scoped.layout
    })
  } catch (error) {
    void error
  }
  try {
    // The claiming address type closes the tab it forwarded, which needs this.
    ctx.inject(['sidebarRight'], (scoped) => {
      refs.sidebarRight.current = scoped.sidebarRight
    })
  } catch (error) {
    void error
  }

  // A circuit breaker on panel selection: no code path in this plugin may turn
  // into a select/unselect storm, whatever state it finds. Six per second is
  // far above any human interaction and far below a visible flash.
  let navigationStamp = 0
  let navigationCount = 0
  /** Outcome of the last panel selection, for the console probe. */
  let lastSelect = 'none'

  /** Select a main panel, or `null` for the Conversation. */
  function selectPanel(panelId) {
    const now = Date.now()
    if (now - navigationStamp > 1000) {
      navigationStamp = now
      navigationCount = 0
    }
    navigationCount += 1
    if (navigationCount > 6) {
      lastSelect = 'throttled'
      return
    }
    const layout = refs.layout.current
    if (layout === undefined) {
      lastSelect = 'no-layout'
      return
    }
    try {
      layout.selectPanel(panelId)
      lastSelect = 'ok'
    } catch (error) {
      // The main seat registers after this row on a cold load; the button then
      // simply does nothing rather than throwing into the click handler.
      lastSelect = `threw: ${error?.message ?? error}`
    }
  }

  /** Return to the Conversation. */
  function backToChat() {
    selectPanel(null)
  }

  // Debug surface: the panel's own actions, callable from DevTools. Reading and
  // driving the panel from the console is the only way to tell "my code did not
  // run" apart from "the shell ignored the request".
  try {
    globalThis.__dshIdeWindow = {
      selectPanel,
      openPanel,
      store,
      probe: () => ({
        iwRoot: typeof document === 'undefined' ? 0 : document.querySelectorAll('.iw-root').length,
        sessionId: store.getState().sessionId,
        rootPath: store.getState().rootPath,
        tabs: store.getState().tabs.length,
        immersive,
        layoutReady: refs.layout.current !== undefined,
        lastSelect,
        mainRegistered,
        panelRenders: idePanelRenders,
        activePanelId: (() => {
          try {
            const service = refs.layout.current
            if (service?.panelInfo?.getSnapshot === undefined) return 'no-panel-info'
            // `null` is the conversation: report it as null instead of masking it.
            return service.panelInfo.getSnapshot().activePanelId
          } catch (error) {
            return `threw: ${error?.message ?? error}`
          }
        })(),
      }),
      // Re-create the main registration and select it; separates a stale slot
      // table from a selection that the shell refuses.
      revive: () => {
        try {
          if (typeof mainDispose === 'function') mainDispose()
        } catch (error) {
          void error
        }
        mainDispose = registerMainPanel()
        mainRegistered = true
        selectPanel(IDE_PANEL_ID)
      },
    }
  } catch (error) {
    void error
  }

  // ---- semantic navigation ------------------------------------------------
  //
  // Both gestures go to the Host's LSP seam through this plugin's own route;
  // the editor never guesses at a symbol.
  const navigate = {
    /**
     * Resolve one symbol. A single destination is returned as is — its line text
     * is only needed when several candidates must be shown, so the common jump
     * pays one language-server query and one file read at most.
     */
    definition: async (tabPath, position, name) => {
      const timeline = ideTimeline()
      const located = await ideLspDefinition(store, tabPath, position, name, timeline)
      const locations = located.length === 1 ? located : await ideWithSnippets(store, located)
      timeline.report('definition')
      return { locations, ms: timeline.total() }
    },
    /**
     * `onPartial` receives the implementations as soon as they are known, so the
     * popup can appear before the reference sweep finishes.
     */
    browse: async (tabPath, position, name, onPartial) => {
      const timeline = ideTimeline()
      const grouped = await ideLspBrowse(store, tabPath, position, { implementations: 24, callers: 80 }, timeline, (partial) => {
        if (onPartial !== undefined) onPartial({ ...partial, ms: timeline.total(), phases: timeline.phases() })
      }, name)
      timeline.report('browse')
      return { ...grouped, ms: timeline.total(), phases: timeline.phases() }
    },
  }

  // ---- immersive mode -----------------------------------------------------
  //
  // Nothing here may select a panel on its own. The previous revision bounced
  // through the Conversation to create the floating tab from the mount effect;
  // when that failed it re-entered the same path forever and flashed the page.
  // Entering is now purely "fold the column and (from this plugin's own
  // controls) open the float"; the panel never re-selects itself.
  let immersive = false
  let sidebarHidden = false
  /**
   * Whether the workspace panel has been opened in this page. The file-address
   * claim stays off until it has, so a user who never uses this panel keeps the
   * shipped preview for every file.
   */
  // Claim file links from the start. This used to wait for the panel's first
  // mount, so a fresh page (or a reinstalled profile) sent every reference to the
  // shipped viewer instead — the behaviour users read as "the jump is broken".
  // The toolbar's link toggle remains the way to turn claiming off.
  let workspaceUsed = true

  /**
   * Below the layout's own collapse breakpoint, `toggleSidebar` flips the
   * narrow drawer rather than the column — and restoring it later would raise a
   * drawer overlay across the conversation. Folding is therefore limited to the
   * wide layout, where the toggle is a plain column collapse.
   */
  const IDE_WIDE_LAYOUT = 1024

  /** Hide the navigation column, unless the user already had it closed. */
  function hideSidebar() {
    const layout = refs.layout.current
    if (layout === undefined || sidebarHidden) return
    if ((Number(globalThis.innerWidth) || 0) < IDE_WIDE_LAYOUT) return
    if (ideSidebarCollapsed()) return
    layout.toggleSidebar()
    sidebarHidden = true
  }

  /** Put the navigation column back, but only if this mode closed it. */
  function restoreSidebar() {
    if (!sidebarHidden) return
    sidebarHidden = false
    refs.layout.current?.toggleSidebar()
    // Restoring the column changes the shell's geometry; a resize notification
    // is what makes the shell re-measure instead of leaving the composer laid
    // out against the previous width. Non-browser hosts have no events.
    if (typeof Event === 'function' && typeof globalThis.dispatchEvent === 'function') {
      globalThis.dispatchEvent(new Event('resize'))
    }
  }

  /**
   * Open the mode from one of this plugin's own controls.
   *
   * Deliberately does *not* touch the right column: opening a page type there
   * expands the column and floating it leaves state behind, and an early
   * revision that did this on the way in left a residue covering the
   * conversation composer after returning. The floating conversation is opt-in
   * through its own toolbar control.
   */
  function openPanel() {
    workspaceUsed = true
    store.setNotice('')
    selectPanel(IDE_PANEL_ID)
  }
  /**
   * A file address was opened somewhere in the shell; jump the workspace there.
   *
   * The claiming tab is closed before the panel takes the column, because the
   * right column's writes address the Session "on screen" and selecting a global
   * panel clears that.
   *
   * @param tabId - the claiming tab, closed either way.
   * @param address - the `dsh-resource://file/…` address.
   * @param params - the opener's navigation params; `line` is the shipped
   *   convention for "open at this line".
   */
  function jumpFromAddress(tabId, address, params) {
    const parsed = ideParseFileAddress(address)
    const line = typeof params?.line === 'number' && Number.isFinite(params.line) ? params.line : undefined
    const opened = parsed === undefined || parsed.path === ''
      ? false
      : store.openAt(parsed.path, line)
    if (typeof tabId === 'string') {
      try {
        refs.sidebarRight.current?.close(tabId)
      } catch (error) {
        void error
      }
    }
    if (opened) {
      store.setNotice('')
      selectPanel(IDE_PANEL_ID)
      return
    }
    store.setNotice(translate('jumpFailed'))
  }

  /**
   * Rows of DSH's own 「已编辑」 card open this workspace instead of the review.
   *
   * The card is a shipped plugin and stays untouched: the click is swallowed in
   * the capture phase, and the row's own hidden span carries the absolute path.
   * The card's header keeps its meaning (open the review) — only the file rows
   * switch target.
   */
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
    const onChangedFileClick = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest('[data-changed-files="true"] .vdszpW_row')
      if (row === null || row.parentElement === null) return
      const hidden = row.parentElement.querySelector('span[hidden]')
      const display = row.querySelector('.vdszpW_path')?.textContent ?? ''
      const path = ideRelativeWorkspacePath(hidden?.textContent?.trim() ?? '', store.getState().rootPath, display.trim())
      if (path === '') return
      event.preventDefault()
      event.stopPropagation()
      if (store.openAt(path, undefined)) {
        store.setNotice('')
        selectPanel(IDE_PANEL_ID)
      }
    }
    document.addEventListener('click', onChangedFileClick, true)
    return () => document.removeEventListener('click', onChangedFileClick, true)
  }, 'dsh-ide-window: edited-file rows open the workspace')

  /** Mount effect of the panel: fold the navigation column, nothing else. */
  function enter() {
    if (immersive) return () => {}
    immersive = true
    workspaceUsed = true
    hideSidebar()
    return () => {
      if (!immersive) return
      immersive = false
      restoreSidebar()
    }
  }

  /** Toolbar control: the user takes over the column, so this mode stops owning it. */
  function toggleSidebarManually() {
    sidebarHidden = false
    refs.layout.current?.toggleSidebar()
  }

  // ---- registrations ------------------------------------------------------

  // `mainRegistered` is probe-only state: without it a missing body is
  // indistinguishable from a body that is registered but not selected.
  let mainRegistered = false
  let mainDispose
  const registerMainPanel = () => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: IDE_PANEL_ID,
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({
      store,
      translate,
      onBackToChat: backToChat,
      onToggleSidebar: toggleSidebarManually,
      onEnter: enter,
      navigate,
      paletteActions,
    }),
  }, IdePanel))
  ctx.effect(() => {
    const dispose = ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: IDE_PANEL_ID,
      registrant: IDE_NS,
      locale: IDE_NS,
      inject: () => ({
        store,
        translate,
        onBackToChat: backToChat,
        onToggleSidebar: toggleSidebarManually,
          onEnter: enter,
        navigate,
        paletteActions,
      }),
    }, IdePanel))
    mainRegistered = true
    mainDispose = dispose
    return () => {
      mainRegistered = false
      mainDispose = undefined
      if (typeof dispose === 'function') dispose()
    }
  }, 'dsh-ide-window: code panel')


  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: `${IDE_NS}:open`,
    order: 6,
    label: () => translate('title'),
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({ store, translate, openPanel, backToChat }),
  }, IdeFooterAction)), 'dsh-ide-window: footer action')

  /**
   * Keyboard commands and mouse gestures are owned by this plugin.
   *
   * They are deliberately **not** registered in DSH's shortcut catalog: that
   * catalog is what DSH's own 「编辑快捷键」 dialog lists, and this plugin's
   * shortcuts belong in their own General-settings section instead. Bindings live
   * in this plugin's preferences, one capture-phase listener dispatches them, and
   * the section below edits both kinds.
   */
  const shortcutPlatform = ctx.shortcuts?.platform === 'windows' || ctx.shortcuts?.platform === 'linux'
    ? ctx.shortcuts.platform
    : 'macos'
  const shortcutRuntime = ctx.shortcuts?.runtime === 'web' ? 'web' : 'desktop'
  ideRuntimeContext.platform = shortcutPlatform
  ideRuntimeContext.runtime = shortcutRuntime

  /** The binding in force for one registry command. */
  const shortcutBindingOf = (command) => (
    store.getState().shortcutBindings?.[command.id] ?? ideShortcutDefault(command, shortcutRuntime)
  )

  /** The registry entry behind a command id. */
  const shortcutCommandOf = (id) => IDE_SHORTCUTS.find((entry) => entry.id === id)

  /** Explain which DSH command already owns a combination, if any. */
  const shortcutConflictOf = (binding) => {
    if (typeof ctx.shortcuts?.describeBinding !== 'function') return ''
    try {
      const described = ctx.shortcuts.describeBinding(binding)
      if (described.issue !== null) return String(described.issue)
      if (described.conflicts.length > 0) return `${translate('gestureConflict')}: ${described.conflicts.join(', ')}`
    } catch (error) {
      return error?.message ?? 'invalid'
    }
    return ''
  }

  /** The double-press sequence in force for the palette command. */
  const paletteSequence = () => {
    const command = shortcutCommandOf('code-workspace.search-everywhere')
    if (command === undefined) return { key: 'Shift' }
    return store.getState().shortcutBindings?.[command.id] ?? ideSequenceDefault(command, shortcutRuntime)
  }

  /** Stop capturing keys. */
  const stopShortcutRecord = () => {
    store.setGestureRecording('')
    void ctx.shortcuts?.recording?.(false)?.catch?.(() => undefined)
  }

  /** Capture the next combination (or the next key, for a sequence) for one command. */
  const startShortcutRecord = (id) => {
    const command = shortcutCommandOf(id)
    if (command === undefined || (command.kind !== 'key' && command.kind !== 'sequence')) return
    if (store.getState().gestureRecording === id) {
      stopShortcutRecord()
      return
    }
    store.setGestureRecording(id)
    void ctx.shortcuts?.recording?.(true)?.catch?.(() => undefined)
  }

  /** Restore one command's shipped default. */
  const resetShortcut = (id) => {
    const command = shortcutCommandOf(id)
    if (command === undefined) return
    if (command.kind === 'gesture') store.setGesture(command.action, command.action === 'definition' ? 'double' : 'meta')
    else store.setShortcutBinding(id, null)
    store.setGestureIssue('')
  }

  /** Last key of the double-press sequence, with its timestamp. */
  let lastSequenceKey = { key: '', at: 0 }

  // One capture-phase listener owns key capture, the two keyboard commands and
  // the two pointer gestures, so nothing here depends on DSH's own catalog.
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('keydown', (event) => {
      const recording = store.getState().gestureRecording
      if (typeof recording === 'string' && recording !== '') {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'Escape') {
          stopShortcutRecord()
          return
        }
        const recordingCommand = shortcutCommandOf(recording)
        if (recordingCommand?.kind === 'sequence') {
          // A sequence records the key itself, so modifiers (Shift, Control…) work.
          if (typeof event.key !== 'string' || event.key === '') return
          store.setShortcutBinding(recording, { key: event.key })
          store.setGestureIssue('')
          stopShortcutRecord()
          return
        }
        const candidate = ideBindingFromEvent(event, shortcutPlatform)
        if (candidate === undefined) return
        const conflict = shortcutConflictOf(candidate)
        if (conflict !== '') {
          store.setGestureIssue(conflict)
          return
        }
        store.setShortcutBinding(recording, candidate)
        store.setGestureIssue('')
        stopShortcutRecord()
        return
      }
      const tag = event.target?.tagName ?? ''
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable === true

      // Two presses of the same key in quick succession open Search Everywhere.
      // The key and the window both come from the registry/user preference.
      const paletteHit = ideSequenceHit(lastSequenceKey, event, paletteSequence(), 400)
      lastSequenceKey = paletteHit.next
      if (paletteHit.hit) {
        event.preventDefault()
        store.setPaletteOpen(true)
        return
      }

      for (const command of IDE_SHORTCUTS) {
        if (command.kind !== 'key') continue
        if (!ideBindingMatches(shortcutBindingOf(command), event, shortcutPlatform)) continue
        // 组合键（带 ⌘/Ctrl/⌥）在输入框里也生效；纯字母键让输入框先处理，避免抢打字。
        const withModifier = event.metaKey === true || event.ctrlKey === true || event.altKey === true
        if (editable && !withModifier && command.action !== 'back') return
        event.preventDefault()
        if (command.action === 'toggle') openPanel()
        else if (command.action === 'back') selectPanel(null)
        return
      }
    }, true)
  }

  /**
   * The code workspace's mouse gestures.
   *
   * Double click and ⌘+click are pointer gestures: DSH's shortcut catalog binds a
   * physical `code` plus modifiers, so these cannot live there. They get their own
   * General-settings row instead, and the code view dispatches by this preference.
   */
  ctx.effect(() => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: `${IDE_NS}:gestures`,
    order: 17,
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({
      translate,
      store,
      bindings: store.getState().shortcutBindings ?? {},
      platform: shortcutPlatform,
      runtime: shortcutRuntime,
      onPick: (action, choice) => {
        if (!store.setGesture(action, choice)) {
          store.setGestureIssue(translate('gestureConflict'))
          return
        }
        store.setGestureIssue('')
      },
      onRecord: startShortcutRecord,
      onReset: resetShortcut,
    }),
  }, IdeWorkspaceSettingsItem)), 'dsh-ide-window: workspace settings')

  // The Turn's changed files, in the Turn's own tail: clicking one opens this
  // panel at the first changed line. `seq` and `sessionId` come from the slot's
  // owner props, so the card always describes the Turn it sits under.
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: `${IDE_NS}:turn-changes`,
    order: 30,
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({ store, translate, openPanel }),
  }, IdeTurnChanges)), 'dsh-ide-window: turn changes')

  // The conversation header's leading seat: global navigation, left of the title.
  ctx.effect(() => ctx.slots.inject('conversation.header.leading', () => ctx.slots.register({
    name: 'conversation.header.leading',
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({ store, translate, openPanel }),
  }, IdeHeaderEntry)), 'dsh-ide-window: header entry')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: `${IDE_NS}:session`,
    order: 40,
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({ store }),
  }, IdeSessionTracker)), 'dsh-ide-window: session tracker')


  /**
   * The right-Sidebar page type and its body.
   *
   * `sidebar.right.pane.tab` is declared by the right bar's own Session entry,
   * so the body registers through `inject` like every shipped tab does. The type
   * itself is registered once its registry is reachable — a registration issued
   * while the service is still missing would read it as absent and never retry.
   */
  try {
    ctx.inject(['sidebarRightTabs'], (scoped) => {

      // Claim session-scoped file addresses so a reference anywhere in the
      // shell opens here.
      //
      // The band is the highest (`extension`), and ranking inside a band falls
      // to the matched pattern's length — so `…/file/session/**` is both the
      // precise claim and, at 26 characters, the one that beats the generic
      // `dsh-resource://file/**` another viewer may also declare. `canOpen`
      // still vetoes formats the shipped viewers present better, and the
      // toolbar's link toggle is the user-facing switch.
      scoped.effect(() => scoped.sidebarRightTabs.register({
        id: IDE_FILE_TYPE_ID,
        kind: IDE_FILE_KIND,
        patterns: ['dsh-resource://file/session/**'],
        priority: 'extension',
        canOpen: (address) => workspaceUsed && store.getState().jumpEnabled === true && ideIsTextAddress(address),
        title: () => translate('title'),
      }), 'dsh-ide-window: file address type')
    })
  } catch (error) {
    void error
  }

  // The claiming type's body: forwards the address and draws nothing.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: IDE_FILE_TYPE_ID,
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({ translate, jump: jumpFromAddress }),
  }, IdeFileJump)), 'dsh-ide-window: file jump body')

  ctx.effect(() => () => store.dispose(), 'dsh-ide-window: streams')
}

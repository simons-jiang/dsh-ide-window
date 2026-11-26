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
  // 会话模式的标签：内置预设（standard/ptc/minimal/cordis）没有 name，文案在 DSH
  // 自己的 `settings.agentPreset` 命名空间里。借它的文案，和表头显示的一致。
  let presetText
  try {
    presetText = ctx.locale !== undefined && typeof ctx.locale.bind === 'function'
      ? ctx.locale.bind('settings.agentPreset')
      : undefined
  } catch (error) {
    void error
  }

  /**
   * The palette's command list.
   *
   * Only commands this panel actually owns: a searchable list of things that do
   * nothing would be worse than a short one that always works.
   */
  /**
   * Switch the language server's licence account: sign the machine out of the
   * current JetBrains account, then open a fresh sign-in. Only a licence verb
   * can provision the server, which is why a browser sign-in alone does nothing.
   */
  const reloginLicense = async () => {
    store.setNotice(tr('lspReloginRunning'))
    try {
      const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
        ? document.baseURI
        : 'http://dsh.internal/'
      const response = await fetch(new URL('dsh-ide/license', base).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'relogin' }),
      })
      const answer = await response.json()
      store.setNotice(answer?.value?.opened === true
        ? tr('lspReloginOpened')
        : `${tr('lspFailed')}: ${answer?.error?.code ?? 'license-relogin'}`)
    } catch (error) {
      store.setNotice(`${tr('lspFailed')}: ${error?.message ?? 'network'}`)
    }
  }

  // ---- references handed to the conversation -----------------------------

  /** Poll `probe` until it answers, or give up (the UI is not there yet). */
  const waitForProbe = async (probe, timeout = 1500) => {
    const started = Date.now()
    for (;;) {
      const value = probe()
      if (value !== null && value !== undefined && value !== false) return value
      if (Date.now() - started >= timeout) return null
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }

  /** The conversation composer is the only Lexical editor in the shell. */
  const composerEditor = () => (typeof document === 'undefined' ? null : document.querySelector('[data-lexical-editor="true"]'))

  /** Rows of the open mention menu. */
  const composerOptions = () => [...document.querySelectorAll('[role="option"]')].filter((row) => row.offsetParent !== null)

  const composerChips = () => document.querySelectorAll('[data-composer-chip]').length

  const pressKey = (element, key) => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }))
  }

  const textAfterLastAt = (editor) => {
    const text = String(editor?.textContent ?? '')
    const at = text.lastIndexOf('@')
    return at < 0 ? '' : text.slice(at + 1)
  }

  /** Put the caret at the end of the draft: the mention is appended, never merged. */
  const caretToEnd = (editor) => {
    editor.focus()
    const selection = globalThis.getSelection?.()
    if (selection === null || selection === undefined) return
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  /** Replace whatever was typed after the `@` with the canonical mention. */
  const replaceTypedMention = (editor, target) => {
    const typed = textAfterLastAt(editor)
    caretToEnd(editor)
    for (let index = 0; index < typed.length; index += 1) {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        keyCode: 8,
        bubbles: true,
        cancelable: true,
      }))
    }
    caretToEnd(editor)
    document.execCommand('insertText', false, target)
  }

  /** Leave the mention as plain text, spelled exactly the way DSH spells it. */
  const finishPlainMention = async (editor, relative, isDir) => {
    const target = isDir === true ? `${relative.replace(/\/+$/, '')}/` : relative
    caretToEnd(editor)
    if (textAfterLastAt(editor) !== target) {
      replaceTypedMention(editor, target)
      // A trailing slash re-opens the mention menu; let it render, then close it.
      await new Promise((resolve) => setTimeout(resolve, 140))
    }
    caretToEnd(editor)
    pressKey(editor, 'Escape')
  }

  /**
   * Type `@relative/path` into the composer and let DSH turn it into a chip.
   *
   * The composer is a Lexical editor with an `@` trigger: typed text only
   * becomes a reference chip when a candidate of its menu is chosen, so the
   * path is entered segment by segment — Tab drills into a folder, the last
   * segment is confirmed with Enter. That is the sequence a person types, and
   * every step is checked against the menu; when a step does not offer the
   * expected candidate the text is left as a plain mention instead of picking
   * the wrong file.
   *
   * @returns 'chip' when a chip was inserted, 'plain' when it stayed text.
   */
  const typeReferenceMention = async (editor, relative, isDir) => {
    const segments = relative.split('/').filter((part) => part !== '')
    if (segments.length === 0) return 'plain'
    const basename = segments[segments.length - 1]
    const dirHint = segments.slice(0, -1).join('/')
    // DSH offers a file by name; the extension only narrows the search.
    const stem = isDir === true ? basename : basename.replace(/\.[^.]*$/, '')
    const before = composerChips()
    // The `@` trigger only fires at the start of a word: separate it from
    // whatever the draft already ends with, the way a person would.
    const draft = String(editor.textContent ?? '')
    if (draft !== '' && !/\s$/u.test(draft)) {
      caretToEnd(editor)
      document.execCommand('insertText', false, ' ')
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    caretToEnd(editor)
    document.execCommand('insertText', false, '@')
    document.execCommand('insertText', false, stem)
    const rows = await waitForProbe(() => {
      const options = composerOptions()
      return options.length > 0 ? options : null
    }, 1200)
    if (rows === null) {
      ideLogRecord('warn', 'reference', 'mention menu never opened', relative)
      return 'plain'
    }
    const label = (row) => String(row.textContent ?? '').replace(/\s+/gu, '')
    if (isDir === true) {
      // A directory row drills instead of inserting a chip; the typed text is
      // the reference, so the drill row only makes it spell exactly.
      const folder = rows.find((row) => label(row).startsWith(`${basename}/`))
      if (folder === undefined) return 'plain'
      folder.click()
      await waitForProbe(() => (String(editor.textContent ?? '').includes(`${basename}/`) ? true : null), 1200)
      return 'plain'
    }
    // One file only: the label names it and the directory hint (when the menu
    // shows one) must end exactly at the target's directory.
    const candidates = rows.filter((row) => {
      const text = label(row)
      if (!text.startsWith(basename)) return false
      return dirHint === '' ? text === basename : text.endsWith(dirHint)
    })
    if (candidates.length !== 1) {
      ideLogRecord('warn', 'reference', 'mention candidate mismatch', {
        relative,
        dirHint,
        options: rows.map(label).slice(0, 8),
      })
      return 'plain'
    }
    candidates[0].click()
    let chipped = await waitForProbe(() => (composerChips() > before ? true : null), 800)
    if (chipped !== true) {
      // A row can be replaced by a re-render before the click lands; the
      // highlighted row is the same candidate, so Enter finishes the job.
      caretToEnd(editor)
      pressKey(editor, 'Enter')
      chipped = await waitForProbe(() => (composerChips() > before ? true : null), 1200)
    }
    if (chipped !== true) {
      ideLogRecord('warn', 'reference', 'mention candidate did not become a chip', {
        relative,
        options: rows.map(label).slice(0, 8),
      })
    }
    if (chipped === true) {
      const chips = [...document.querySelectorAll('[data-composer-chip]')]
      const got = String(chips[chips.length - 1]?.textContent ?? '').trim()
      // The menu highlights one row; if that was the wrong file the chip says
      // so, and the report keeps the evidence.
      if (got !== basename) ideLogRecord('warn', 'reference', 'a different file was inserted', { relative, got })
    }
    return chipped === true ? 'chip' : 'plain'
  }

  /**
   * Screenshot flow.
   *
   * 1. capture in the Host (OS built-in tool, no permission on Windows, Screen
   *    Recording on macOS);
   * 2. show the preview with the two choices;
   * 3. "截图并跳转会话" returns to the conversation and *pastes* the image, so the
   *    draft's text and attachments are untouched; "只截图" puts it on the system
   *    clipboard and keeps the file.
   */
  /**
   * Capture first, render after.
   *
   * Anything drawn before the Host grabs the screen ends up *inside* the
   * screenshot — an overlay that says "capturing…" would be printed onto the
   * picture. So the panel stays untouched until the image arrives, and a short
   * guard keeps a double press from firing two captures.
   */
  let screenshotBusy = false
  /**
   * Same flow on the desktop window and in a browser tab: the Host (which runs
   * on the machine that owns the screen) grabs the picture, the editor frames
   * it. Nothing here depends on the shell's own screen-capture permission.
   */
  async function startScreenshot() {
    if (screenshotBusy) return
    screenshotBusy = true
    try {
      const result = await ideShotRequest({})
      if (!result.ok) {
        store.setScreenshot({ phase: 'error', code: result.code, message: result.message })
        return
      }
      // The editor owns the capture from here: frame, marks, export.
      store.setScreenshot({ phase: 'editing', ...result.value })
    } finally {
      screenshotBusy = false
    }
  }

  /** The editor's "insert" exit: back to the chat, paste only that image. */
  async function screenshotInsert(dataUrl) {
    store.setScreenshot(null)
    backToChat()
    if (typeof dataUrl !== 'string' || dataUrl === '') return
    const pasted = await idePasteScreenshot(dataUrl)
    store.setNotice(pasted ? translate('shotAttached') : translate('shotNoEditor'))
  }

  /** The editor's "copy" exit: the annotated result goes to the clipboard. */
  async function screenshotCopy(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl === '') return
    const copied = await ideShotRequest({ copyDataUrl: dataUrl })
    store.setScreenshot(null)
    store.setNotice(copied.ok ? translate('shotCopied') : translate('shotFailed'))
  }

  async function screenshotOpenSettings() {
    const result = await ideOpenScreenPermission()
    if (result.opened !== true) store.setNotice(translate('shotOpenFailed'))
  }

  const screenshotClose = () => store.setScreenshot(null)

  /**
   * Back to the conversation with the reference appended to the draft.
   *
   * The existing draft is never replaced: the caret is moved to its end first,
   * so text and attachments the user already had stay untouched.
   */
  /**
   * DSH executes `/goal`-style commands in the Conversation's own front-end, not
   * through `session.command()` (that promise simply never settles for them).
   * So the card fills the Conversation's composer instead: DSH opens its own
   * palette and the user only presses Enter.
   */
  async function composeInChat(text) {
    backToChat()
    const editor = await waitForProbe(() => composerEditor(), 2000)
    if (editor === null) {
      ideLogRecord('warn', 'compose', 'composer not found', text)
      store.setNotice(translate('floatCommandNoEditor'))
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
    caretToEnd(editor)
    document.execCommand('insertText', false, text)
    return true
  }

  async function referenceToChat(path, isDir, suffix = '') {
    const relative = ideRelativeTo(store.getState().rootPath, path)
    const mention = ideReferenceMention(relative, isDir)
    // With the card open, the reference belongs in the card's draft: jumping to
    // the conversation would take the user away from what they were reading.
    const current = store.getState()
    const floatVisible = current.floatOpen === true && current.floatEnabled !== false && current.floatClosed !== true
    if (floatVisible && mention !== '') {
      store.setFloatInsert({ text: `${mention}${suffix}`, at: Date.now() })
      store.setNotice(`${translate('referenceInserted')}: ${mention}`)
      return
    }
    backToChat()
    const editor = await waitForProbe(() => composerEditor(), 2000)
    if (editor === null) {
      ideLogRecord('warn', 'reference', 'composer not found', mention)
      store.setNotice(`${translate('referenceNoEditor')}: ${mention}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 80))
    caretToEnd(editor)
    const outcome = await typeReferenceMention(editor, relative, isDir)
    if (outcome !== 'chip') await finishPlainMention(editor, relative, isDir)
    // `#L120` is typed *after* the chip: the chip must stay a real reference,
    // and the line is the part that says which member is meant.
    if (suffix !== '') {
      caretToEnd(editor)
      document.execCommand('insertText', false, suffix)
    }
    store.setNotice(outcome === 'chip'
      ? `${translate('referenceInserted')}: ${mention}`
      : `${translate('referenceInsertedPlain')}: ${mention}`)
  }

  /**
   * The `#L<line> <symbol>` tail for a reference, when the last clicked symbol is
   * still the file being referenced.
   *
   * Kept pure so the shortcut's one interesting decision is testable: a symbol
   * from another file, or a file nobody clicked in, must produce no tail at all.
   */
  function ideReferenceSuffix(state, path) {
    const last = state?.lastSymbol
    if (last === null || last === undefined) return ''
    if (typeof path !== 'string' || path === '' || last.path !== path) return ''
    const line = Number(last.line) || 0
    const symbol = typeof last.symbol === 'string' ? last.symbol : ''
    if (line <= 0 || symbol === '') return ''
    return `#L${line} ${symbol}`
  }

  /**
   * 「复制引用回对话」 as a shortcut: the active tab, plus the symbol last clicked
   * in it.
   *
   * The context menu knows which symbol it was opened on; a keystroke does not,
   * so `state.lastSymbol` — written by every symbol gesture and symbol menu — is
   * what makes the two paths produce the same reference.
   */
  async function copyReferenceShortcut() {
    const state = store.getState()
    const path = state.activePath ?? ''
    if (path === '') {
      store.setNotice(translate('shortcutNeedsFile'))
      return
    }
    if (String(state.tabs?.find((tab) => tab.path === path)?.kind) === 'jar') {
      store.setNotice(translate('shortcutJarNoReference'))
      return
    }
    await referenceToChat(path, false, ideReferenceSuffix(state, path))
  }

  /**
   * 「在数据窗口打开表」 as a shortcut: parse `@TableName` off the active tab.
   *
   * It runs the same helper the file-tree menu runs, so both entries behave the
   * same way (including every failure notice).
   */
  function openTableShortcut() {
    const state = store.getState()
    const path = state.activePath ?? ''
    if (path === '') {
      store.setNotice(translate('shortcutNeedsFile'))
      return
    }
    if (!ideDataWindowAvailable()) {
      store.setNotice(translate('dataWindowNotInstalled'))
      return
    }
    if (!/\.(java|kt)$/i.test(path)) {
      store.setNotice(translate('dataWindowNoTableName'))
      return
    }
    void ideDataWindowOpenEntity(store, translate, state.rootPath, path)
  }

  /**
   * Collect both sides of the log and put the report on the clipboard.
   *
   * The client entries are sent first so the Host appends them to its file: a
   * report that is only on the clipboard would vanish with the page.
   */
  const exportDiagnostics = async () => {
    const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
      ? document.baseURI
      : 'http://dsh.internal/'
    const post = async (body) => {
      const response = await fetch(new URL('dsh-ide/diagnostics', base).href, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return response.json().catch(() => null)
    }
    const client = ideLogSnapshot()
    let host = null
    try {
      await post({ action: 'report', entries: client.entries })
      host = (await post({ action: 'read' }))?.value ?? null
    } catch (error) {
      ideLogRecord('error', 'diagnostics', 'report failed', error?.message ?? String(error))
    }
    const report = { generatedAt: new Date().toISOString(), client, host }
    const text = JSON.stringify(report, null, 2)
    const file = host?.logFile ?? '~/.dsh/logs/dsh-ide-window.log'
    // A clipboard write can wait on a permission prompt forever (and does in
    // some embeddings), so it never gates the report: the Host already has it.
    const copied = await (async () => {
      const clipboard = globalThis.navigator?.clipboard
      if (typeof clipboard?.writeText !== 'function') return false
      const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 1500))
      const write = clipboard.writeText(text).then(() => true).catch(() => false)
      return (await Promise.race([write, timeout])) === true
    })()
    store.setNotice(copied ? `${translate('diagCopied')}: ${file}` : `${translate('diagReported')}: ${file}`)
  }

  const paletteActions = [
    { id: 'tree', labelKey: 'paletteActionTree', run: () => store.setTreeVisible(!store.getState().treeVisible) },
    { id: 'refresh', labelKey: 'paletteActionRefresh', run: () => store.refreshAll() },
    { id: 'jump', labelKey: 'paletteActionJump', run: () => store.setJumpEnabled(!store.getState().jumpEnabled) },
    { id: 'closeTabs', labelKey: 'paletteActionCloseTabs', run: () => store.closeAllTabs() },
    { id: 'back', labelKey: 'paletteActionBack', run: () => backToChat() },
    // Kept in the list on every runtime: in a browser the entry explains why the
    // feature needs the desktop app instead of silently doing nothing.
    { id: 'screenshot', labelKey: 'paletteActionScreenshot', run: () => { void startScreenshot() } },
    { id: 'licenseRelogin', labelKey: 'paletteActionLicenseRelogin', run: () => { void reloginLicense() } },
    { id: 'diagnostics', labelKey: 'paletteActionDiagnostics', run: () => { void exportDiagnostics() } },
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
      // The whole workspace panel takes the centre column. A card the user
      // detached keeps showing in every other panel too.
      const detached = store.getState().floatDetached === true
      store.setFloatOpen(panelId === IDE_PANEL_ID || detached)
    } catch (error) {
      // The main seat registers after this row on a cold load; the button then
      // simply does nothing rather than throwing into the click handler.
      lastSelect = `threw: ${error?.message ?? error}`
    }
  }

  /**
   * Bind the panel to a Session that was just selected in the app.
   *
   * The navigation above moves the app to the Conversation; this puts the
   * workspace back in front a beat later (giving the navigation one frame to
   * settle) with the new Session already adopted, so the card rebinds at once.
   */
  function adoptSession(rootPath, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (typeof rootPath === 'string' && rootPath !== '') store.enterProject(rootPath, sessionId)
    else store.rememberSession(sessionId)
    globalThis.setTimeout(() => selectPanel(IDE_PANEL_ID), 140)
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
      diagnostics: () => ideLogSnapshot(),
      copyDiagnostics: () => exportDiagnostics(),
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
    definition: async (tabPath, position, name, options = {}) => {
      const timeline = ideTimeline()
      const located = await ideLspDefinition(store, tabPath, position, name, timeline, options)
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
   * File cards in the conversation open this workspace instead of a preview.
   *
   * Three shipped surfaces name a file and open something else — the 「已编辑」
   * card's rows, that same card when it has a single file (the header *is* the
   * file), and the delivered-file card the agent presents:
   *
   *  - `[data-changed-files] .…_row` — the row carries a hidden span with the
   *    absolute path; its siblings' preview still works when it is not claimed.
   *  - `[data-changed-files][data-single]` — one file, so the whole card means
   *    that file; the same hidden span is directly under the card.
   *  - `[data-presented-file]` — the full-card preview button carries the
   *    resolved path in its `title`. The card's own action buttons (a trailing
   *    edit/reveal group) keep their meaning: only the preview surface is taken.
   *
   * The click is swallowed in the capture phase and the panel is selected, so the
   * right pane is never opened on the way.
   */
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
    const openInWorkspace = (path) => {
      if (path === '') return false
      if (!store.openAt(path, undefined)) return false
      store.setNotice('')
      selectPanel(IDE_PANEL_ID)
      return true
    }
    const cardPath = (card) => ideRelativeWorkspacePath(
      card.querySelector('span[hidden]')?.textContent?.trim() ?? '',
      store.getState().rootPath,
      '',
    )
    const onChangedFileClick = (event) => {
      const target = event.target
      if (!(target instanceof Element)) return

      // A delivered file: take the preview surface, leave its action buttons be.
      const presented = target.closest('[data-presented-file]')
      if (presented !== null) {
        const cardButton = presented.querySelector('button')
        const clicked = target.closest('button')
        if (clicked !== null && clicked !== cardButton) return
        const title = cardButton?.getAttribute('title')?.trim() ?? ''
        const path = ideRelativeWorkspacePath(title, store.getState().rootPath, '')
        if (!openInWorkspace(path)) return
        event.preventDefault()
        event.stopPropagation()
        return
      }

      // One changed file: the card header opens the review, but it means the file.
      const single = target.closest('[data-changed-files="true"][data-single]')
      if (single !== null) {
        const path = cardPath(single)
        if (!openInWorkspace(path)) return
        event.preventDefault()
        event.stopPropagation()
        return
      }

      // Several changed files: only the rows switch target; the header keeps the
      // review, which is the useful thing to do with a list.
      const row = target.closest('[data-changed-files="true"] .vdszpW_row')
      if (row === null || row.parentElement === null) return
      const display = row.querySelector('.vdszpW_path')?.textContent ?? ''
      const path = ideRelativeWorkspacePath(
        row.parentElement.querySelector('span[hidden]')?.textContent?.trim() ?? '',
        store.getState().rootPath,
        display.trim(),
      )
      if (!openInWorkspace(path)) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('click', onChangedFileClick, true)
    return () => document.removeEventListener('click', onChangedFileClick, true)
  }, 'dsh-ide-window: file cards open the workspace')

  /** Mount effect of the panel: fold the navigation column, nothing else. */
  function enter() {
    if (immersive) return () => {}
    immersive = true
    workspaceUsed = true
    // Switching to the code workspace brings the assistant card with it.
    store.setFloatOpen(true)
    hideSidebar()
    return () => {
      if (!immersive) return
      immersive = false
      // Back to the conversation: the card leaves with the workspace unless the
      // user asked it to live on its own.
      if (store.getState().floatDetached !== true) store.setFloatOpen(false)
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
      onReferenceToChat: referenceToChat,
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
        onReferenceToChat: referenceToChat,
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
  // Only macOS counts as macOS; anything else takes the Windows behaviour.
  const reportedPlatform = typeof ctx.shortcuts?.platform === 'string' ? ctx.shortcuts.platform : ''
  const shortcutPlatform = reportedPlatform === 'macos' || reportedPlatform === 'mac' || reportedPlatform === 'darwin'
    ? 'macos'
    : 'windows'
  const shortcutRuntime = ctx.shortcuts?.runtime === 'web' ? 'web' : 'desktop'
  ideRuntimeContext.platform = shortcutPlatform
  ideRuntimeContext.runtime = shortcutRuntime
  idePlatform = idePlatformOf(shortcutPlatform)

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
  // Page-level failures have no other trace: record them before they vanish.
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('error', (event) => {
      ideLogRecord('error', 'window', event?.message ?? 'uncaught error', event?.filename ?? '')
    })
    globalThis.addEventListener('unhandledrejection', (event) => {
      const reason = event?.reason
      ideLogRecord('error', 'window', 'unhandled rejection', reason?.message ?? String(reason ?? ''))
    })
  }
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
        else if (command.action === 'float-toggle') toggleFloat()
        else if (command.action === 'back') selectPanel(null)
        else if (command.action === 'screenshot') void startScreenshot()
        else if (command.action === 'copy-reference') void copyReferenceShortcut()
        else if (command.action === 'open-table') openTableShortcut()
        return
      }
    }, true)
  }

  /**
   * ⌥+空格：叫出/收起悬浮助手卡。卡片被设置关掉时说一声，而不是假装切了。
   */
  function toggleFloat() {
    const look = store.getState()
    if (look.floatEnabled !== true) {
      store.setNotice(translate('floatToggleDisabled'))
      return
    }
    // `×` hides the card until DSH restarts, but this shortcut is the one the
    // user presses to call it back: reopening has to clear that flag, otherwise
    // nothing happens and the card looks broken.
    if (look.floatClosed === true) {
      store.setFloatClosed(false)
      store.setFloatOpen(true)
      store.setFloatCollapsed(false)
      return
    }
    const visible = look.floatOpen === true && look.floatClosed !== true
    if (!visible) {
      store.setFloatOpen(true)
      store.setFloatCollapsed(false)
      return
    }
    // Expanded → 收成小球；小球 → 展开。一次按键只走一步。
    store.setFloatCollapsed(look.floatCollapsed !== true)
  }

  /**
   * The code workspace's own settings page.
   *
   * It is a `settings.section`, so it gets its own row in the settings navigation
   * instead of being one more collapsible row inside 通用设置. The code view reads
   * these preferences directly: gestures cannot live in DSH's shortcut catalog
   * (that one binds a physical key plus modifiers).
   */
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: IDE_NS,
    order: 70,
    label: () => translate('settingsNav'),
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
  }, IdeWorkspaceSettingsSection)), 'dsh-ide-window: workspace settings')

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

  // The screenshot editor lives at shell level: it must cover the window (not
  // the centre panel) and must not be clipped by the panel's overflow.
  /**
   * The floating quick-ask card.
   *
   * It lives at shell level (the workspace panel clips its own children), sits
   * above other panes, and talks to the Session the workspace is bound to, so
   * its workspace and model are the ones already in use.
   */
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: `${IDE_NS}:float`,
    order: 60,
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({
      store,
      sessions: ctx.get('sessions'),
      modelDirectories: ctx.get('modelDirectories'),
      translate,
      // The float's `/` and `@` menus read the same catalog and the same file
      // listing the conversation's own composer does: one source of truth.
      commandList: async (sessionId) => {
        try {
          const result = await ctx.remote.commands.list(sessionId)
          if (result?.ok === false) return { error: result.error?.message ?? result.error?.code ?? 'failed' }
          return { value: Array.isArray(result?.value) ? result.value : [] }
        } catch (error) {
          return { error: String(error?.message ?? error) }
        }
      },
      skillList: async (sessionId) => {
        try {
          // The Host takes a request object here, not a bare id.
          const result = await ctx.remote.skills.list({ sessionId })
          if (result?.ok === false) return { error: result.error?.message ?? result.error?.code ?? 'failed' }
          const value = result?.value
          return { value: Array.isArray(value) ? value : (Array.isArray(value?.skills) ? value.skills : []) }
        } catch (error) {
          return { error: String(error?.message ?? error) }
        }
      },
      // 会话的模式 = Agent 预设；卡片只展示，切换仍在 DSH 里做。
      modeList: async () => {
        try {
          const result = await ctx.remote.agentPresets.list()
          if (result?.ok === false) return { error: result.error?.message ?? result.error?.code ?? 'failed' }
          const presets = result?.value?.presets
          return { value: Array.isArray(presets) ? presets : [] }
        } catch (error) {
          return { error: String(error?.message ?? error) }
        }
      },
      /** 内置预设的中文/英文名；返回空串表示「不是内置预设」，交给调用方兜底。 */
      modeLabel: (id) => {
        const builtin = { standard: 'Standard', ptc: 'Ptc', minimal: 'Minimal', cordis: 'Cordis' }[id]
        if (builtin === undefined) return ''
        const key = `preset${builtin}Name`
        try {
          const text = typeof presetText === 'function' ? presetText(key) : undefined
          if (typeof text === 'string' && text.trim() !== '' && text !== key) return text
        } catch (error) {
          void error
        }
        return translate(`floatMode${builtin}`)
      },
      workspaceList: async (sessionId, path) => {
        try {
          const result = await ctx.remote.workspaceFiles.list(sessionId, path)
          if (result?.ok === false) return { error: result.error?.message ?? result.error?.code ?? 'failed' }
          const entries = result?.value?.entries
          return { value: Array.isArray(entries) ? entries : [] }
        } catch (error) {
          return { error: String(error?.message ?? error) }
        }
      },
      // An open question can only be answered in the Conversation; the card's
      // button sends the user there instead of faking an answer.
      goToChat: () => backToChat(),
      composeText: (text) => composeInChat(text),
      // The card's file chips open files exactly like the conversation's file
      // cards do: one workspace tab, one panel selection, no preview pane.
      openInWorkspace: (path) => {
        if (typeof path !== 'string' || path === '') return false
        if (store.openAt(path, undefined) !== true) return false
        store.setNotice('')
        selectPanel(IDE_PANEL_ID)
        return true
      },
      // Switching a Session is a UI navigation, which lands on the Conversation.
      // The workspace is where the card lives, so the panel is re-selected right
      // after: the card then rebinds to the Session the tracker just adopted.
      openSession: (sessionId) => {
        const uiWorkspace = ctx.get('uiWorkspace')
        if (uiWorkspace === undefined) return
        // Selecting a Session is a UI navigation, and it lands on the
        // Conversation. The workspace has to follow it, or the card would keep
        // showing the old conversation: adopting the id here also re-roots the
        // panel when the two Sessions live in different workspaces.
        const snapshot = ctx.get('sessions')?.list?.getSnapshot?.()
        const row = snapshot?.byId?.[sessionId]
        const root = typeof row?.cwd === 'string' && row.cwd !== '' ? row.cwd : store.getState().rootPath
        try {
          uiWorkspace.openSession(sessionId)
        } catch (error) {
          store.setNotice(`${translate('floatSessionFailed')}: ${error?.message ?? error}`)
          return
        }
        adoptSession(root, sessionId)
      },
      startSession: () => {
        const uiWorkspace = ctx.get('uiWorkspace')
        if (uiWorkspace === undefined) return
        const list = ctx.get('sessions')?.list
        try {
          uiWorkspace.startSession()
        } catch (error) {
          store.setNotice(`${translate('floatSessionFailed')}: ${error?.message ?? error}`)
          return
        }
        // `startSession` reports no id, and the Host may reuse an existing blank
        // Session instead of creating one — so the new blank is recognised by
        // the tracker adopting it, not by diffing the list for a new id.
        const previous = store.getState().sessionId
        let tries = 0
        let reopened = 0
        const watch = () => {
          tries += 1
          const current = store.getState().sessionId
          if (typeof current === 'string' && current !== previous) {
            const row = list?.getSnapshot?.()?.byId?.[current]
            const root = typeof row?.cwd === 'string' && row.cwd !== '' ? row.cwd : store.getState().rootPath
            adoptSession(root, current)
            return
          }
          // A reused blank keeps its id, and the navigation still lands on the
          // Conversation: take the column back for the workspace, which is where
          // this card lives. Bounded, because the breaker counts selections.
          if (tries >= 2 && reopened < 3 && globalThis.document?.querySelector('.iw-float') === null) {
            reopened += 1
            selectPanel(IDE_PANEL_ID)
          }
          if (tries < 40) globalThis.setTimeout(watch, 200)
        }
        globalThis.setTimeout(watch, 150)
      },
    }),
  }, IdeFloatingAsk)), 'dsh-ide-window: floating assistant')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: `${IDE_NS}:screenshot`,
    order: 41,
    registrant: IDE_NS,
    locale: IDE_NS,
    inject: () => ({
      store,
      tr: translate,
      onInsert: screenshotInsert,
      onCopy: screenshotCopy,
      onOpenSettings: screenshotOpenSettings,
      onClose: screenshotClose,
    }),
  }, IdeScreenshotEditor)), 'dsh-ide-window: screenshot editor')


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

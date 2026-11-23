/**
 * The settings row that edits every code-workspace shortcut.
 *
 * The rows are **generated** from `IDE_SHORTCUTS`: add a shortcut to that table
 * and it appears here without touching this file. Keyboard commands are edited
 * in DSH's own 「编辑快捷键」 dialog (this row shows their current binding and
 * points there), pointer gestures are edited in place, and fixed sequences are
 * documented read-only — DSH's catalog cannot bind a click sequence.
 */

/**
 * The next gesture in the ring, skipping the one the other action already owns.
 *
 * @returns the gesture to apply, or the current one when nothing is free.
 */
function ideNextGesture(current, taken) {
  const start = IDE_GESTURE_CHOICES.indexOf(current)
  for (let step = 1; step <= IDE_GESTURE_CHOICES.length; step += 1) {
    const candidate = IDE_GESTURE_CHOICES[(start + step) % IDE_GESTURE_CHOICES.length]
    if (candidate !== taken) return candidate
  }
  return current
}

/** Locale label for one gesture choice. */
function ideGestureLabel(choice, platform, tr) {
  if (choice === 'meta' || choice === 'ctrl') return tr(idePlatformOf(platform).gestureLabelKey(choice))
  return tr(IDE_GESTURE_KEYS[choice])
}

/** The gesture actions, in settings order. */
const GESTURE_ACTIONS = ['definition', 'usages', 'chain']

/** One gesture row: a dropdown with the choices this platform can tell apart. */
function IdeGestureSelect(props) {
  const { entry, tr, platform, onPick } = props
  return h('select', {
    className: 'iw-gesture-select',
    value: entry.value,
    title: tr('gesturePickHint'),
    'aria-label': entry.label,
    onChange: (event) => onPick(entry.action, event.target.value),
  }, ideGestureChoices(platform).map((choice) => h('option', {
    key: choice,
    value: choice,
    disabled: entry.taken.includes(choice),
    title: entry.taken.includes(choice) ? tr('gestureTaken') : undefined,
  }, ideGestureLabel(choice, platform, tr))))
}

/** One generated row: label on the left, its control on the right. */
function IdeShortcutRow(props) {
  const { entry, tr, platform, onPick, onRecord, onReset, recording, busy } = props
  const editable = entry.kind === 'key' || entry.kind === 'sequence'
  return h('div', { className: 'iw-gesture-row' }, [
    h('span', { key: 'l', className: 'iw-gesture-label' }, entry.label),
    h('span', { key: 'right', className: 'iw-gesture-right' }, [
      entry.kind === 'gesture'
        ? h(IdeGestureSelect, { key: 'c', entry, tr, platform, onPick })
        : h('span', {
          key: 'k',
          className: `iw-gesture-keys${recording ? ' recording' : ''}`,
        }, recording ? tr('ksRecording') : entry.text),
      editable
        ? h('button', {
          key: 'b',
          type: 'button',
          className: 'iw-gesture-chip',
          disabled: busy === true,
          onClick: () => onRecord(entry.id),
        }, recording ? tr('ksCancel') : tr('ksChange'))
        : null,
      editable
        ? h('button', {
          key: 'r',
          type: 'button',
          className: 'iw-gesture-chip',
          disabled: busy === true || entry.modified !== true,
          onClick: () => onReset(entry.id),
        }, tr('ksReset'))
        : null,
    ]),
  ])
}

/**
 * The General-settings row, expanding into the shortcut list in place.
 *
 * Inline rather than a dialog: `shell.overlay` renders below the settings dialog,
 * so a dialog opened from here would be covered by it.
 */
/**
 * The line under the repository field.
 *
 * A placeholder alone is too faint to confirm a detection, so the row states the
 * path that is really in use, where it came from, and whether it exists.
 */
function mavenRowHint(tr, state) {
  const detected = typeof state.mavenRepoDetected === 'string' ? state.mavenRepoDetected : ''
  const manual = typeof state.mavenRepo === 'string' ? state.mavenRepo : ''
  const inUse = manual !== '' ? manual : detected
  if (inUse === '') {
    return h('div', { key: 'mavenhint', className: 'iw-settings-hint' }, tr('settingsMavenRepoDetecting'))
  }
  const source = manual !== '' ? tr('settingsMavenRepoManual') : tr('settingsMavenRepoAuto')
  const missing = manual === '' && detected !== '' && state.mavenRepoDetectedExists !== true
  return h('div', { key: 'mavenhint', className: `iw-settings-hint${missing ? ' warn' : ''}` }, [
    h('span', { key: 's' }, `${tr('settingsMavenRepoInUse')}（${source}）：`),
    h('span', { key: 'p', className: 'iw-settings-hint-path' }, inUse),
    missing ? h('span', { key: 'm', className: 'iw-settings-hint-warn' }, ` · ${tr('settingsMavenRepoMissingDir')}`) : null,
  ])
}

/**
 * The whole 代码工作区 settings page.
 *
 * It used to be one collapsible row inside 通用设置, which crowded that page and
 * hid everything behind an「查看」button. It is now its own section in the settings
 * navigation (like 归档管理), so the content is always visible.
 */
function IdeWorkspaceSettingsSection(props) {
  const { translate, store, platform, runtime, onPick, onRecord, onReset } = props
  const tr = typeof translate === 'function' ? translate : (key) => key
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [fontsOpen, setFontsOpen] = React.useState(false)
  // The detected repository is only known after the Host answers; ask once if
  // the panel was never mounted, so the row can show what is really in use.
  React.useEffect(() => {
    if (state.mavenRepoDetected !== '') return undefined
    let cancelled = false
    void ideDoctorQuery().then((found) => {
      if (!cancelled && found.ok === true && found.mavenRepo !== '') {
        store.setMavenRepoDetected(found.mavenRepo, found.mavenRepoExists === true)
      }
    })
    return () => { cancelled = true }
  }, [state.mavenRepoDetected, store])
  const gestures = state.gestures ?? { definition: 'double', usages: 'meta', chain: 'alt' }
  const bindings = state.shortcutBindings ?? {}

  // Generated: one row per registry entry, no per-shortcut code here.
  const rows = IDE_SHORTCUTS.map((command) => {
    if (command.kind === 'gesture') {
      return {
        id: command.id,
        kind: 'gesture',
        action: command.action,
        label: tr(command.labelKey),
        value: gestures[command.action],
        // Every other action's gesture is unavailable here: one gesture, one job.
        taken: GESTURE_ACTIONS.filter((key) => key !== command.action).map((key) => gestures[key]),
      }
    }
    if (command.kind === 'sequence') {
      const sequence = bindings[command.id] ?? ideSequenceDefault(command, runtime)
      return {
        id: command.id,
        kind: 'sequence',
        label: tr(command.labelKey),
        text: ideSequenceLabel(sequence, tr),
        modified: bindings[command.id] != null,
      }
    }
    const binding = bindings[command.id] ?? ideShortcutDefault(command, runtime)
    const keys = ideBindingKeys(binding, platform)
    return {
      id: command.id,
      kind: 'key',
      label: tr(command.labelKey),
      text: keys.length === 0 ? tr('ksUnbound') : keys.join(' '),
      modified: bindings[command.id] != null,
    }
  })

  const codeSize = Number.isFinite(state.codeFontSize) ? state.codeFontSize : 12.5
  const treeSize = Number.isFinite(state.treeFontSize) ? state.treeFontSize : 14.5
  const stepper = (key, label, value, set) => h('div', { key, className: 'iw-gesture-row' }, [
    h('span', { key: 'l', className: 'iw-gesture-label' }, label),
    h('span', { key: 's', className: 'iw-gesture-right' }, [
      h('button', {
        key: 'minus',
        type: 'button',
        className: 'iw-gesture-chip',
        onClick: () => set(value - 0.5),
      }, '−'),
      h('span', { key: 'v', className: 'iw-gesture-keys' }, `${value} px`),
      h('button', {
        key: 'plus',
        type: 'button',
        className: 'iw-gesture-chip',
        onClick: () => set(value + 0.5),
      }, '+'),
      h('button', {
        key: 'reset',
        type: 'button',
        className: 'iw-gesture-chip',
        disabled: key === 'code' ? codeSize === 12.5 : treeSize === 14.5,
        onClick: () => set(key === 'code' ? 12.5 : 14.5),
      }, tr('ksReset')),
    ]),
  ])

  return h(React.Fragment, null, [
    h(IdeStyles, { key: 'style' }),
    h('div', { key: 'panel', className: 'iw-settings-section' }, [
        // Shortcuts: a sub-item, so the section keeps room for more settings.
        h('div', { key: 'sc', className: 'iw-settings-item' }, [
          h('span', { key: 'l', className: 'iw-settings-item-label' }, tr('gestureSection')),
          h('button', {
            key: 'b',
            type: 'button',
            className: 'iw-gesture-chip',
            onClick: () => setShortcutsOpen(!shortcutsOpen),
          }, shortcutsOpen ? tr('settingsCollapse') : `${tr('gestureEdit')} (${rows.length})`),
        ]),
        shortcutsOpen
          ? h('div', { key: 'sclist', className: 'iw-settings-body' }, [
            h('div', { key: 'hint', className: 'iw-gesture-hint' }, tr('gestureHint')),
            state.gestureIssue === '' ? null : h('div', { key: 'issue', className: 'iw-gesture-issue' }, state.gestureIssue),
            h('div', { key: 'rows', className: 'iw-gesture-rows' }, rows.map((entry) => h(IdeShortcutRow, {
              key: entry.id,
              entry,
              tr,
              platform,
              onPick,
              onRecord,
              onReset,
              recording: state.gestureRecording === entry.id,
              busy: state.gestureBusy === true,
            }))),
          ])
          : null,
        h('div', { key: 'basic', className: 'iw-settings-group' }, tr('settingsBasic')),
        h('div', { key: 'font', className: 'iw-settings-item' }, [
          h('span', { key: 'l', className: 'iw-settings-item-label' }, tr('settingsFont')),
          h('button', {
            key: 'b',
            type: 'button',
            className: 'iw-gesture-chip',
            onClick: () => setFontsOpen(!fontsOpen),
          }, fontsOpen ? tr('settingsCollapse') : `${codeSize} / ${treeSize} px`),
        ]),
        fontsOpen
          ? h('div', { key: 'fontbody', className: 'iw-settings-body' }, [
            stepper('code', tr('settingsCodeFont'), codeSize, (next) => store.setCodeFontSize(next)),
            stepper('tree', tr('settingsTreeFont'), treeSize, (next) => store.setTreeFontSize(next)),
          ])
          : null,
        // Dependency sources come from a Maven repository; the Host detects the
        // usual places, and this field covers repositories kept anywhere else.
        h('div', { key: 'maven', className: 'iw-settings-maven' }, [
          h('div', { key: 'row', className: 'iw-settings-maven-row' }, [
            h('span', { key: 'l', className: 'iw-settings-item-label' }, tr('settingsMavenRepo')),
            h('input', {
              key: 'i',
              className: 'iw-settings-input',
              type: 'text',
              spellCheck: false,
              defaultValue: state.mavenRepo,
              placeholder: tr('settingsMavenRepoAuto'),
              title: tr('settingsMavenRepoHint'),
              onKeyDown: (event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              },
              onBlur: (event) => store.setMavenRepo(event.target.value),
            }),
          ]),
          mavenRowHint(tr, state),
        ]),
    ]),
  ])
}

/**
 * Place a context menu the way IDEA does: at the pointer, growing upwards.
 *
 * The panel clips its content (`overflow: hidden`) and the shell confines fixed
 * popups to the panel wrapper, so the menu must stay inside `.iw-root`. The
 * height is measured after mount — a menu with sections and separators is
 * taller than any item count suggests, and guessing it left the menu far above
 * the pointer. Opening downwards when it fits and upwards from the pointer
 * otherwise is what makes the menu look attached to the click.
 */
/**
 * The lowest y of the panel that another pane is not covering.
 *
 * The bottom pane of another plugin (the git window) slides over the bottom of
 * the window and paints above this panel, so a popup placed there is hidden
 * behind it. Probing the hit test from the bottom up finds where that pane
 * starts without knowing anything about the other plugin.
 */
function idePanelBottom(root, rect, viewportHeight) {
  const limit = Math.min(viewportHeight - 8, rect.bottom - 8)
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return limit
  const x = Math.round(rect.left + Math.min(60, Math.max(12, rect.width / 2)))
  for (let y = Math.round(limit); y > rect.top + 24; y -= 6) {
    const element = document.elementFromPoint(x, y)
    if (element === null) continue
    if (root.contains(element)) return y
  }
  return limit
}

function useMenuPlacement(x, y, width) {
  const ref = React.useRef(null)
  const [style, setStyle] = React.useState({
    left: `${x}px`,
    top: `${y}px`,
    visibility: 'hidden',
  })
  React.useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const height = node.getBoundingClientRect().height
    const root = typeof document === 'undefined' ? null : document.querySelector('.iw-root')
    const box = root?.getBoundingClientRect() ?? null
    const viewportWidth = globalThis.innerWidth || 1280
    const viewportHeight = globalThis.innerHeight || 800
    const top = box === null ? 8 : Math.max(8, box.top + 8)
    // Stop above the bottom pane: a popup behind it is worse than a shorter one.
    const bottom = box === null || root === null
      ? viewportHeight - 8
      : idePanelBottom(root, box, viewportHeight)
    const left = box === null ? 8 : Math.max(8, box.left + 8)
    const right = box === null ? viewportWidth - 8 : Math.min(viewportWidth - 8, box.right - 8)
    const size = typeof width === 'number' && width > 0 ? width : 240
    // Below the pointer when it fits, otherwise the menu's bottom sits at the
    // pointer and it grows upwards; a menu taller than the panel scrolls.
    const placedTop = Math.min(y + height <= bottom ? y : Math.max(top, y - height), Math.max(top, bottom - height))
    setStyle({
      left: `${Math.min(Math.max(x, left), Math.max(left, right - size))}px`,
      top: `${placedTop}px`,
      // Cap the height to the space that is actually left below the anchor: the
      // usage and call-chain popups grow as results arrive, and without this
      // they grew straight into the pane below (their bodies scroll instead).
      maxHeight: `${Math.max(140, bottom - placedTop)}px`,
      visibility: 'visible',
    })
  }, [x, y, width])
  return { ref, style }
}

/**
 * The tab context menu, mirroring IDEA's.
 *
 * Items that need data this plugin does not own — DSH keeps no draft API for
 * 「添加到智能体上下文」 — copy an `@`-reference instead and say so, rather than
 * pretending to do something.
 */
function IdeTabMenu({ store, state, tr, copy }) {
  const menu = state.tabMenu
  const placement = useMenuPlacement(menu?.x ?? 0, menu?.y ?? 0, 240)
  if (menu === null || menu === undefined) return null
  const path = menu.path
  const tab = state.tabs.find((entry) => entry.path === path)
  if (tab === undefined) return null
  const run = (action) => () => {
    store.setTabMenu(null)
    action()
  }
  // Icons on the left and the label next to them, the way an editor's menu reads.
  const items = [
    { key: 'close', icon: IdeCloseIcon, label: tr('tabMenuClose'), run: () => store.closeTab(path) },
    { key: 'others', icon: IdeLayersIcon, label: tr('tabMenuCloseOthers'), run: () => store.closeOthers(path) },
    { key: 'all', icon: IdeStackIcon, label: tr('tabMenuCloseAll'), run: () => store.closeAllTabs() },
    { key: 'unmodified', icon: IdeDotIcon, label: tr('tabMenuCloseUnmodified'), run: () => store.closeUnmodified() },
    { key: 'left', icon: IdeArrowLeftIcon, label: tr('tabMenuCloseLeft'), run: () => store.closeToLeft(path) },
    { key: 'right', icon: IdeArrowRightIcon, label: tr('tabMenuCloseRight'), run: () => store.closeToRight(path) },
    { key: 'readonly', icon: IdeLockIcon, label: tr('tabMenuCloseReadOnly'), run: () => store.closeReadOnly() },
    { key: 'sep1', separator: true },
    { key: 'context', icon: IdeAtIcon, label: tr('tabMenuAddToContext'), run: () => copy(`@${path}`) },
    { key: 'copy', icon: IdeCopyIcon, label: tr('tabMenuCopyPath'), run: () => copy(path) },
  ]
  return h(React.Fragment, null, [
    h(IdeStyles, { key: 'style' }),
    h('div', {
      key: 'backdrop',
      className: 'iw-menu-backdrop',
      onPointerDown: () => store.setTabMenu(null),
      onContextMenu: (event) => {
        event.preventDefault()
        store.setTabMenu(null)
      },
    }, h('div', {
      key: 'menu',
      className: 'iw-menu',
      role: 'menu',
      'aria-label': tr('tabMenuLabel'),
      ref: placement.ref,
      style: placement.style,
      onPointerDown: (event) => event.stopPropagation(),
    }, items.map((item) => (item.separator === true
      ? h('div', { key: item.key, className: 'iw-menu-sep' })
      : h('button', {
        key: item.key,
        type: 'button',
        role: 'menuitem',
        className: 'iw-menu-item',
        onClick: run(item.run),
      }, [
        h('span', { key: 'ic', className: 'iw-menu-icon' }, h(item.icon, { size: 13 })),
        h('span', { key: 'lb', className: 'iw-menu-label' }, item.label),
      ]))))),
  ])
}

/**
 * The source context menu: a symbol's name, its `@` reference, or that
 * reference handed to the conversation.
 *
 * A jar tab has no workspace path to hand over, so it keeps the copy-name item
 * only rather than offering a reference that would not resolve.
 */
function IdeSymbolMenu({ store, state, tr, copy, onReferenceToChat }) {
  const menu = state.codeSymbolMenu
  const placement = useMenuPlacement(menu?.x ?? 0, menu?.y ?? 0, 240)
  if (menu === null || menu === undefined) return null
  const close = () => store.setCodeSymbolMenu(null)
  const run = (action) => () => {
    close()
    action()
  }
  const name = menu.symbol === '' ? ideBasename(menu.path) : menu.symbol
  const mention = ideReferenceMention(ideRelativeTo(state.rootPath, menu.path), false)
  // A method or field reference without its line is only half the answer: the
  // line says *where*, the name says *what*. Both are needed for the other side
  // to read that member instead of guessing inside the file.
  const anchor = menu.line > 0 ? `#L${menu.line}` : ''
  const symbolName = String(menu.symbol ?? '').trim()
  const lineSuffix = `${anchor}${symbolName === '' ? '' : ` ${symbolName}`}`
  const items = [
    { key: 'name', icon: IdeCopyIcon, label: tr('symbolMenuCopyName'), run: run(() => copy(name)) },
  ]
  if (menu.jar !== true) {
    items.push({ key: 'ref', icon: IdeLinkIcon, label: tr('symbolMenuCopyReference'), run: run(() => copy(`${mention}${lineSuffix}`)) })
    items.push({
      key: 'chat',
      icon: IdeAtIcon,
      label: tr('symbolMenuReferenceToChat'),
      run: run(() => {
        void onReferenceToChat(menu.path, false, lineSuffix)
      }),
    })
  }
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
      'aria-label': tr('symbolMenuLabel'),
      ref: placement.ref,
      style: placement.style,
      onPointerDown: (event) => event.stopPropagation(),
    }, items.map((item) => h('button', {
      key: item.key,
      type: 'button',
      role: 'menuitem',
      className: 'iw-menu-item',
      onClick: item.run,
    }, [
      h('span', { key: 'ic', className: 'iw-menu-icon' }, h(item.icon, { size: 13 })),
      h('span', { key: 'lb', className: 'iw-menu-label' }, item.label),
    ])))),
  ])
}

/** The code gutter's context menu: Git annotate for this file. */
function IdeGutterMenu({ store, state, tr }) {
  const menu = state.codeMenu
  const placement = useMenuPlacement(menu?.x ?? 0, menu?.y ?? 0, 240)
  if (menu === null || menu === undefined) return null
  const path = menu.path
  const on = state.annotate?.[path] === true
  const run = (action) => () => {
    store.setCodeMenu(null)
    action()
  }
  const items = [
    {
      key: 'annotate',
      icon: IdeClockIcon,
      label: on ? tr('gutterMenuUnannotate') : tr('gutterMenuAnnotate'),
      run: () => store.toggleAnnotate(path),
    },
  ]
  return h(React.Fragment, null, [
    h(IdeStyles, { key: 'style' }),
    h('div', {
      key: 'backdrop',
      className: 'iw-menu-backdrop',
      onPointerDown: () => store.setCodeMenu(null),
      onContextMenu: (event) => {
        event.preventDefault()
        store.setCodeMenu(null)
      },
    }, h('div', {
      key: 'menu',
      className: 'iw-menu',
      role: 'menu',
      'aria-label': tr('gutterMenuLabel'),
      ref: placement.ref,
      style: placement.style,
      onPointerDown: (event) => event.stopPropagation(),
    }, items.map((item) => h('button', {
      key: item.key,
      type: 'button',
      role: 'menuitem',
      className: 'iw-menu-item',
      onClick: run(item.run),
    }, [
      h('span', { key: 'ic', className: 'iw-menu-icon' }, h(item.icon, { size: 13 })),
      h('span', { key: 'lb', className: 'iw-menu-label' }, item.label),
    ])))),
  ])
}

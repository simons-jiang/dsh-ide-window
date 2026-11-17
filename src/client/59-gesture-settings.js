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
  if (choice === 'meta') return platform === 'macos' ? tr('gestureMeta') : tr('gestureCtrl')
  return tr(IDE_GESTURE_KEYS[choice])
}

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
    disabled: choice === entry.taken,
    title: choice === entry.taken ? tr('gestureTaken') : undefined,
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
function IdeWorkspaceSettingsItem(props) {
  const { translate, store, platform, runtime, onPick, onRecord, onReset } = props
  const tr = typeof translate === 'function' ? translate : (key) => key
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const open = state.gestureEditorOpen === true
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false)
  const [fontsOpen, setFontsOpen] = React.useState(false)
  const gestures = state.gestures ?? { definition: 'double', usages: 'meta' }
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
        taken: gestures[command.action === 'definition' ? 'usages' : 'definition'],
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
    h('div', { key: 'row', className: 'iw-gesture-item' }, [
      h('div', { key: 'text', className: 'iw-gesture-item-text' }, [
        h('span', { key: 't', className: 'iw-gesture-item-title' }, tr('settingsTitle')),
        h('span', { key: 'h', className: 'iw-gesture-item-hint' }, tr('settingsHint')),
      ]),
      h('button', {
        key: 'b',
        type: 'button',
        className: 'iw-gesture-btn',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => store.setGestureEditor(!open),
      }, open ? tr('gestureClose') : tr('gestureEdit')),
    ]),
    open
      ? h('div', { key: 'panel', className: 'iw-gesture-panel' }, [
        // Shortcuts: a sub-item, so the section keeps room for more settings.
        h('div', { key: 'sc', className: 'iw-settings-item' }, [
          h('span', { key: 'l', className: 'iw-settings-item-label' }, tr('gestureSection')),
          h('button', {
            key: 'b',
            type: 'button',
            className: 'iw-gesture-chip',
            onClick: () => setShortcutsOpen(!shortcutsOpen),
          }, shortcutsOpen ? tr('gestureClose') : `${tr('gestureEdit')} (${rows.length})`),
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
          }, fontsOpen ? tr('gestureClose') : `${codeSize} / ${treeSize} px`),
        ]),
        fontsOpen
          ? h('div', { key: 'fontbody', className: 'iw-settings-body' }, [
            stepper('code', tr('settingsCodeFont'), codeSize, (next) => store.setCodeFontSize(next)),
            stepper('tree', tr('settingsTreeFont'), treeSize, (next) => store.setTreeFontSize(next)),
          ])
          : null,
      ])
      : null,
  ])
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
      // Keep the menu inside the window when the tab sits near an edge.
      style: {
        left: `${Math.min(menu.x, Math.max(8, (globalThis.innerWidth || 1280) - 260))}px`,
        top: `${Math.min(menu.y, Math.max(8, (globalThis.innerHeight || 800) - 340))}px`,
      },
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

/** The code gutter's context menu: Git annotate for this file. */
function IdeGutterMenu({ store, state, tr }) {
  const menu = state.codeMenu
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
      style: {
        left: `${Math.min(menu.x, Math.max(8, (globalThis.innerWidth || 1280) - 260))}px`,
        top: `${Math.min(menu.y, Math.max(8, (globalThis.innerHeight || 800) - 80))}px`,
      },
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

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

/** One gesture row: a label plus one chip per choice. */
function IdeGestureChips(props) {
  const { entry, tr, onPick } = props
  return h('span', { className: 'iw-gesture-chips' }, IDE_GESTURE_CHOICES.map((choice) => {
    const taken = choice === entry.taken
    return h('button', {
      key: choice,
      type: 'button',
      className: `iw-gesture-chip${choice === entry.value ? ' active' : ''}${taken ? ' taken' : ''}`,
      disabled: taken,
      title: taken ? tr('gestureTaken') : tr(IDE_GESTURE_KEYS[choice]),
      onClick: () => onPick(entry.action, choice),
    }, tr(IDE_GESTURE_KEYS[choice]))
  }))
}

/** One generated row: label on the left, its control on the right. */
function IdeShortcutRow(props) {
  const { entry, tr, onPick } = props
  return h('div', { className: 'iw-gesture-row' }, [
    h('span', { key: 'l', className: 'iw-gesture-label' }, entry.label),
    entry.kind === 'gesture'
      ? h(IdeGestureChips, { key: 'c', entry, tr, onPick })
      : h('span', {
        key: 'k',
        className: `iw-gesture-keys${entry.kind === 'fixed' ? ' readonly' : ''}`,
        title: entry.kind === 'key' ? tr('gestureEditInDsh') : undefined,
      }, entry.keys.length === 0 ? tr('ksUnbound') : entry.keys.join(' ')),
  ])
}

/**
 * The General-settings row, expanding into the shortcut list in place.
 *
 * Inline rather than a dialog: `shell.overlay` renders below the settings dialog,
 * so a dialog opened from here would be covered by it.
 */
function IdeShortcutSettingsItem(props) {
  const { translate, store, platform, runtime, catalog, onPick } = props
  const tr = typeof translate === 'function' ? translate : (key) => key
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const subscribeCatalog = useCallback((listener) => catalog.subscribe(listener), [catalog])
  const catalogEntries = useSyncExternalStore(subscribeCatalog, catalog.getSnapshot, catalog.getSnapshot)
  const open = state.gestureEditorOpen === true
  const gestures = state.gestures ?? { definition: 'double', usages: 'meta' }

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
    // Keyboard commands show what DSH actually stored, so a rebind made in
    // DSH's own dialog shows up here too.
    const registered = Array.from(catalogEntries ?? []).find((entry) => entry.id === command.id)
    const keys = command.kind === 'fixed'
      ? (command.keys ?? ideBindingKeys(command.fixedBinding, platform))
      : (Array.isArray(registered?.keys) && registered.keys.length > 0
        ? registered.keys
        : ideBindingKeys(ideShortcutDefault(command, runtime), platform))
    return { id: command.id, kind: command.kind, label: tr(command.labelKey), keys }
  })

  return h(React.Fragment, null, [
    h(IdeStyles, { key: 'style' }),
    h('div', { key: 'row', className: 'iw-gesture-item' }, [
      h('div', { key: 'text', className: 'iw-gesture-item-text' }, [
        h('span', { key: 't', className: 'iw-gesture-item-title' }, tr('gestureSection')),
        h('span', { key: 'h', className: 'iw-gesture-item-hint' }, tr('gestureSectionHint')),
      ]),
      h('button', {
        key: 'b',
        type: 'button',
        className: 'iw-gesture-btn',
        'aria-expanded': open ? 'true' : 'false',
        onClick: () => store.setGestureEditor(!open),
      }, open ? tr('gestureClose') : `${tr('gestureEdit')} (${rows.length})`),
    ]),
    open
      ? h('div', { key: 'panel', className: 'iw-gesture-panel' }, [
        h('div', { key: 'hint', className: 'iw-gesture-hint' }, tr('gestureHint')),
        state.gestureIssue === '' ? null : h('div', { key: 'issue', className: 'iw-gesture-issue' }, state.gestureIssue),
        h('div', { key: 'rows', className: 'iw-gesture-rows' }, rows.map((entry) => h(IdeShortcutRow, {
          key: entry.id,
          entry,
          tr,
          onPick,
        }))),
      ])
      : null,
  ])
}

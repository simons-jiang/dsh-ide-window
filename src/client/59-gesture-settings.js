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
  const { entry, tr, onPick, onRecord, onReset, recording, busy } = props
  const editable = entry.kind === 'key' || entry.kind === 'sequence'
  return h('div', { className: 'iw-gesture-row' }, [
    h('span', { key: 'l', className: 'iw-gesture-label' }, entry.label),
    h('span', { key: 'right', className: 'iw-gesture-right' }, [
      entry.kind === 'gesture'
        ? h(IdeGestureChips, { key: 'c', entry, tr, onPick })
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
function IdeShortcutSettingsItem(props) {
  const { translate, store, platform, runtime, onPick, onRecord, onReset } = props
  const tr = typeof translate === 'function' ? translate : (key) => key
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const open = state.gestureEditorOpen === true
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
          onRecord,
          onReset,
          recording: state.gestureRecording === entry.id,
          busy: state.gestureBusy === true,
        }))),
      ])
      : null,
  ])
}

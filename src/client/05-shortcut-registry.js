/**
 * Every shortcut of the code workspace, in one place.
 *
 * Add a new shortcut here and it shows up in the settings section automatically:
 * `key` entries are registered in DSH's shortcut catalog (and therefore listed in
 * DSH's own 「编辑快捷键」 dialog), `gesture` entries are edited in this plugin's
 * row, and `fixed` entries document a click sequence or a hand-written listener
 * that DSH's catalog cannot express. Nothing else in the plugin may hard-code a
 * key, a modifier or a timing window for its own commands.
 */

/** Modifier order used everywhere, so bindings normalize the same way. */
const IDE_SHORTCUT_MODIFIERS = ['control', 'alt', 'shift', 'meta']

/** Physical codes a bare modifier press must never be saved as. */
const IDE_MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
])

/** Keycap glyphs for the non-letter codes this plugin binds. */
const IDE_KEYCAPS = { Slash: '/', Comma: ',', Period: '.', Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=' }

/** The two click gestures; a third (`shift`) is not a navigation gesture. */
const IDE_GESTURE_CHOICES = ['double', 'meta', 'alt']

/** Locale keys for each gesture choice. */
const IDE_GESTURE_KEYS = { double: 'gestureDouble', meta: 'gestureMeta', alt: 'gestureAlt' }

/**
 * The registry.
 *
 * - `key`: registered through `ctx.shortcuts`, rebindable in DSH's dialog.
 * - `gesture`: a pointer gesture, rebindable in this plugin's settings row.
 * - `fixed`: a sequence or listener DSH cannot bind; shown read-only so the
 *   section still documents every shortcut the workspace owns.
 */
const IDE_SHORTCUTS = [
  {
    id: 'dsh-ide-window.toggle',
    kind: 'key',
    labelKey: 'shortcutToggle',
    aliases: ['code', 'workspace', 'ide', 'panel', '代码', '工作区', '代码工作区'],
    defaults: {
      desktop: { code: 'Digit2', modifiers: ['primary'] },
      web: { code: 'KeyI', modifiers: ['primary', 'alt'] },
    },
    action: 'toggle',
  },
  {
    id: 'dsh-ide-window.back-to-chat',
    kind: 'key',
    labelKey: 'shortcutBackToChat',
    aliases: ['conversation', 'chat', 'back', '对话', '返回', '代码工作区'],
    defaults: {
      desktop: { code: 'Digit1', modifiers: ['primary'] },
      web: { code: 'KeyU', modifiers: ['primary', 'alt'] },
    },
    action: 'back',
  },
  {
    id: 'code-workspace.search-everywhere',
    kind: 'fixed',
    labelKey: 'shortcutSearchEverywhere',
    // Read by the palette listener; the sequence is a click sequence, not a key.
    sequence: { key: 'Shift', repeat: 2, windowMs: 400 },
    keys: ['双击', 'Shift'],
    action: 'palette',
  },
  {
    id: 'code-workspace.file-search',
    kind: 'fixed',
    labelKey: 'shortcutFileSearch',
    // Read by the tree listener: focus the filter box, which is a panel-local
    // behaviour rather than a global command.
    fixedBinding: { code: 'KeyP', modifiers: ['primary'] },
    action: 'focus-filter',
  },
  {
    id: 'code-workspace.gesture-definition',
    kind: 'gesture',
    labelKey: 'gestureDefinition',
    action: 'definition',
  },
  {
    id: 'code-workspace.gesture-usages',
    kind: 'gesture',
    labelKey: 'gestureUsages',
    action: 'usages',
  },
]

/**
 * The binding a keyboard event describes, or `undefined` for a bare modifier.
 *
 * `primary` is resolved against the platform by the caller, so captured bindings
 * stay platform-neutral.
 */
function ideBindingFromEvent(event, platform) {
  const code = typeof event?.code === 'string' ? event.code : ''
  if (code === '' || IDE_MODIFIER_CODES.has(code)) return undefined
  const modifiers = []
  if (platform === 'macos' ? event.metaKey === true : event.ctrlKey === true) modifiers.push('primary')
  if (platform === 'macos' && event.ctrlKey === true) modifiers.push('control')
  if (event.altKey === true) modifiers.push('alt')
  if (event.shiftKey === true) modifiers.push('shift')
  return { code, modifiers }
}

/** One binding's keycaps, in the order the platform prints them. */
function ideBindingKeys(binding, platform) {
  if (binding === null || typeof binding?.code !== 'string') return []
  const glyphs = platform === 'macos'
    ? { control: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
    : { control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' }
  const held = new Set(binding.modifiers.map((modifier) => (
    modifier === 'primary' ? (platform === 'macos' ? 'meta' : 'control') : modifier
  )))
  const keys = []
  for (const modifier of ['control', 'alt', 'shift', 'meta']) {
    if (held.has(modifier)) keys.push(glyphs[modifier])
  }
  const code = binding.code
  const label = code.startsWith('Key') ? code.slice(3)
    : code.startsWith('Digit') ? code.slice(5)
      : IDE_KEYCAPS[code] ?? code
  keys.push(label)
  return keys
}

/** The shipped default for one keyboard command on this runtime. */
function ideShortcutDefault(command, runtime) {
  const table = command?.defaults ?? {}
  return (runtime === 'web' ? table.web : table.desktop) ?? table.desktop ?? null
}

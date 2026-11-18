/**
 * The platform differences the reader can see.
 *
 * Everything the panel does differently on macOS and Windows lives here: the
 * separator rules, the root header, and how a pointer gesture or a key is
 * printed. `apply()` swaps the instance at startup, so a third system is one
 * more factory rather than another branch in every component.
 *
 * Paths inside the panel are POSIX (forward slashes): the Host and every route
 * speak that form, and a path copied out for the user is converted back with
 * `toNative`.
 */
function idePlatformOf(name) {
  // Only macOS is treated as macOS; every other value means Windows.
  const windows = name !== 'macos' && name !== 'mac' && name !== 'darwin'
  const toPosix = (path) => {
    const text = String(path ?? '')
    return windows ? text.replace(/\\/g, '/') : text
  }
  return {
    name: windows ? 'windows' : 'macos',
    /** Native or mixed path → the slash form every helper works in. */
    toPosix,
    /** Slash form → the form the user's own tools accept. */
    toNative: (path) => (windows ? String(path ?? '').replace(/\//g, '\\') : String(path ?? '')),
    isAbsolutePath: (path) => {
      const text = toPosix(path)
      return windows ? /^[A-Za-z]:\//.test(text) || text.startsWith('//') || text.startsWith('/') : text.startsWith('/')
    },
    /** Which pointer gestures the settings dropdown offers here. */
    gestureChoices: () => (windows ? ['double', 'meta', 'alt'] : ['double', 'meta', 'ctrl', 'alt']),
    /** The locale key that prints one gesture for this system. */
    gestureLabelKey: (gesture) => {
      if (gesture === 'double') return 'gestureDouble'
      // Windows has no ⌘: the primary-modifier click is Ctrl there. macОS keeps
      // ⌘ and the distinct control-click, so the two stay separate labels.
      if (gesture === 'ctrl') return 'gestureCtrl'
      if (gesture === 'meta') return windows ? 'gestureCtrl' : 'gestureMeta'
      return windows ? 'gestureAltWin' : 'gestureAlt'
    },
    /** Keycap glyphs for one binding. */
    bindingGlyphs: () => (windows
      ? { control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' }
      : { control: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }),
  }
}

/**
 * Whether the machine running this page is macOS.
 *
 * A desktop profile names its platform. A web profile only says `web`, so the
 * browser's own platform string is the remaining clue — without it a macOS
 * browser would be handed the PowerShell instructions.
 */
function ideHostIsMacos() {
  const runtime = String(ideRuntimeContext.platform ?? '')
  if (runtime === 'macos' || runtime === 'mac' || runtime === 'darwin') return true
  if (runtime !== '' && runtime !== 'web') return false
  const nav = globalThis.navigator
  const probe = `${nav?.userAgentData?.platform ?? ''} ${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`
  return /mac/i.test(probe)
}

/** Replaced in `apply()` with the runtime platform; macOS until then. */
let idePlatform = idePlatformOf('macos')

/**
 * Colour themes for the code workspace.
 *
 * A palette is a file: `themes/<id>.css` overrides the DSH alias tokens, scoped
 * to `[data-dsh-theme="<id>"]`. Every `.iw-*` rule already reads those tokens, so
 * a theme never touches a component style — switching a theme points
 * `<link id="iw-theme-link">` at another file and sets one attribute. A palette
 * can be edited without rebuilding the bundle.
 *
 * The attribute and the storage key are a **shared contract**: a sibling plugin
 * (`dsh-git-window`) sets the same attribute on its own tool window and loads
 * the same stylesheet, so both follow one palette. See `idePublishTheme`.
 *
 * `themes/index.json` lists the same ids; `test/theme.mjs` holds the two in sync
 * and checks that every file defines the same token set.
 */

/** Registry for the switcher: `mode` decides the group, the file name is `id`. */
const IDE_THEMES = [
  { id: 'material-oceanic', mode: 'dark' },
  { id: 'material-palenight', mode: 'dark' },
  { id: 'dracula', mode: 'dark' },
  { id: 'monokai-pro', mode: 'dark' },
  { id: 'night-owl', mode: 'dark' },
  { id: 'material-darker', mode: 'dark' },
  { id: 'material-deep-ocean', mode: 'dark' },
  { id: 'material-forest', mode: 'dark' },
  { id: 'material-volcano', mode: 'dark' },
  { id: 'material-space', mode: 'dark' },
  { id: 'arc-dark', mode: 'dark' },
  { id: 'github-dark', mode: 'dark' },
  { id: 'atom-one-dark', mode: 'dark' },
  { id: 'solarized-dark', mode: 'dark' },
  { id: 'moonlight', mode: 'dark' },
  { id: 'synthwave-84', mode: 'dark' },
  { id: 'horizon-neo', mode: 'dark' },
  { id: 'cobalt2', mode: 'dark' },
  { id: 'shades-of-purple', mode: 'dark' },
  { id: 'winter-is-coming', mode: 'dark' },
  { id: 'noctis', mode: 'dark' },
  { id: 'material-light', mode: 'light' },
  { id: 'github-light', mode: 'light' },
  { id: 'atom-one-light', mode: 'light' },
  { id: 'solarized-light', mode: 'light' },
  { id: 'intellij-light', mode: 'light' },
  { id: 'material-sky-blue', mode: 'light' },
  { id: 'material-sandy-beach', mode: 'light' },
  { id: 'horizon-bright', mode: 'light' },
]

/**
 * Cache-buster for the stylesheet URL. A palette change keeps the same file
 * name, so the browser needs a reason to fetch it again; bump this when the
 * shipped palettes change.
 */
const IDE_THEME_REVISION = 1

const IDE_THEME_LINK_ID = 'iw-theme-link'

/** Ids the panel accepts: keeps an invalid preference from requesting a file. */
function ideIsThemeId(value) {
  return typeof value === 'string' && IDE_THEMES.some((theme) => theme.id === value)
}

/** Localised display name for a theme id; falls back to the id. */
function ideThemeLabel(tr, id) {
  const key = `theme_${id.replace(/-/g, '_')}`
  const text = tr(key)
  return text === key ? id : text
}

/**
 * Point the stylesheet at `id`'s file. An empty id removes it, which is the
 * "follow DSH" default: the panel keeps the host palette.
 */
function ideApplyTheme(id) {
  const existing = document.getElementById(IDE_THEME_LINK_ID)
  if (typeof id !== 'string' || id === '') {
    existing?.remove()
    return
  }
  const href = `/dsh-ide/theme?id=${encodeURIComponent(id)}&rev=${IDE_THEME_REVISION}`
  if (existing === null) {
    const link = document.createElement('link')
    link.id = IDE_THEME_LINK_ID
    link.rel = 'stylesheet'
    link.href = href
    document.head.append(link)
    return
  }
  if (existing.getAttribute('href') !== href) existing.setAttribute('href', href)
}

/**
 * The shared palette contract.
 *
 * `dsh-git-window` draws its own tool window; when both plugins are open they
 * should look like one workspace, so a palette is published, not just applied:
 *
 * - `localStorage['dsh-theme']` — the current id (empty means "follow DSH"),
 *   readable by any plugin at start-up;
 * - `window` event `dsh-theme` with `{ id }` — same document, so a listener
 *   reacts immediately;
 * - the stylesheet attribute `data-dsh-theme` — whatever element carries it
 *   gets the palette, whichever plugin owns that element.
 *
 * Only this plugin writes the key; followers read it.
 */
const IDE_THEME_SHARED_KEY = 'dsh-theme'
const IDE_THEME_SHARED_EVENT = 'dsh-theme'

/** Publish the palette: storage for late loaders, an event for live listeners. */
function idePublishTheme(id) {
  const value = typeof id === 'string' ? id : ''
  try {
    if (value === '') globalThis.localStorage?.removeItem(IDE_THEME_SHARED_KEY)
    else globalThis.localStorage?.setItem(IDE_THEME_SHARED_KEY, value)
  } catch {
    /* a browser with storage disabled simply cannot share the palette */
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(IDE_THEME_SHARED_EVENT, { detail: { id: value } }))
  } catch {
    /* CustomEvent is always available in the panel's browser; ignore if not */
  }
}

/** Apply the saved theme once, and after every change; the panel owns the DOM. */
function ideUseTheme(themeId) {
  useEffect(() => {
    ideApplyTheme(themeId)
    idePublishTheme(themeId)
  }, [themeId])
}

/**
 * The trigger in the status-bar corner. The list itself is rendered by the panel
 * (`.iw-root` level), because `.iw-status` clips its overflow and a popup nested
 * inside it would be cut off at the panel edge.
 */
function IdeThemeButton({ store, themeId, open, tr }) {
  const current = IDE_THEMES.find((theme) => theme.id === themeId)
  return h('span', { className: 'iw-theme-host' }, [
    h('button', {
      key: 'button',
      type: 'button',
      className: 'iw-theme-button',
      title: current === undefined ? tr('themeFollowDsh') : ideThemeLabel(tr, current.id),
      'aria-haspopup': 'listbox',
      'aria-expanded': open ? 'true' : 'false',
      onClick: (event) => {
        event.stopPropagation()
        store.setThemeMenu(!open)
      },
    }, [
      h('span', { key: 'icon', className: 'iw-theme-swatch' }),
      h('span', { key: 'label', className: 'iw-theme-caption' }, tr('theme')),
    ]),
  ])
}

/**
 * The palette list, anchored to the panel's bottom-right corner. Three ways out:
 * picking a theme, clicking anywhere else, and Escape.
 */
function IdeThemePopup({ store, themeId, tr }) {
  useEffect(() => {
    // A capture-phase listener runs before the row's own click, so the popup has
    // to ignore presses inside itself (and on the trigger, which toggles): closing
    // on those would unmount the row under the pointer and swallow the choice.
    const closeOnOutside = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('.iw-theme-pop, .iw-theme-button') !== null) return
      store.setThemeMenu(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') store.setThemeMenu(false)
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [store])

  const pick = (id) => {
    store.setTheme(id)
    store.setThemeMenu(false)
  }
  const row = (theme) => h('button', {
    key: theme.id,
    type: 'button',
    className: `iw-theme-row${themeId === theme.id ? ' iw-theme-row--on' : ''}`,
    onClick: (event) => {
      event.stopPropagation()
      pick(theme.id)
    },
  }, [
    h('span', { key: 'dot', className: `iw-theme-dot iw-theme-dot--${theme.id}` }),
    h('span', { key: 'name', className: 'iw-theme-name' }, ideThemeLabel(tr, theme.id)),
    themeId === theme.id ? h('span', { key: 'check', className: 'iw-theme-check' }, '✓') : null,
  ])

  return h('div', {
    className: 'iw-theme-pop',
    onPointerDown: (event) => event.stopPropagation(),
  }, [
    h('div', { key: 'title', className: 'iw-theme-title' }, tr('themeTitle')),
    h('button', {
      key: 'follow',
      type: 'button',
      className: `iw-theme-row${themeId === '' ? ' iw-theme-row--on' : ''}`,
      onClick: (event) => {
        event.stopPropagation()
        pick('')
      },
    }, [
      h('span', { key: 'dot', className: 'iw-theme-dot iw-theme-dot--follow' }),
      h('span', { key: 'name', className: 'iw-theme-name' }, tr('themeFollowDsh')),
      themeId === '' ? h('span', { key: 'check', className: 'iw-theme-check' }, '✓') : null,
    ]),
    h('div', { key: 'dark', className: 'iw-theme-group' }, tr('themeDark')),
    ...IDE_THEMES.filter((theme) => theme.mode === 'dark').map(row),
    h('div', { key: 'light', className: 'iw-theme-group' }, tr('themeLight')),
    ...IDE_THEMES.filter((theme) => theme.mode === 'light').map(row),
  ])
}

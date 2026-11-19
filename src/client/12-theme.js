/**
 * Colour themes for the code workspace.
 *
 * A palette is a file: `themes/<id>.css` overrides the DSH alias tokens, scoped
 * to `.iw-root[data-iw-theme="<id>"]`. Every `.iw-*` rule already reads those
 * tokens, so a theme never touches a component style — switching a theme points
 * `<link id="iw-theme-link">` at another file and sets one attribute. A palette
 * can be edited without rebuilding the bundle.
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
  { id: 'material-light', mode: 'light' },
  { id: 'github-light', mode: 'light' },
  { id: 'atom-one-light', mode: 'light' },
  { id: 'solarized-light', mode: 'light' },
  { id: 'intellij-light', mode: 'light' },
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

/** Apply the saved theme once, and after every change; the panel owns the DOM. */
function ideUseTheme(themeId) {
  useEffect(() => {
    ideApplyTheme(themeId)
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

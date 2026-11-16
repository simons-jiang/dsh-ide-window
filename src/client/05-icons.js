/**
 * Glyphs. Every icon is a plain inline SVG drawn with `currentColor`, so the
 * host theme's text colour drives it and no stylesheet has to know about them.
 */

/** Shared wrapping element: 16px box, stroke-only body. */
function ideSvg(size, children) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  }, children)
}

/** Chevron used by the tree rows. */
function IdeChevron({ open, size = 12 }) {
  return ideSvg(size, [
    h('path', {
      key: 'p',
      d: open ? 'M4 6.5 8 10.5 12 6.5' : 'M6.5 4 10.5 8 6.5 12',
    }),
  ])
}

/** Folder glyph, filled in the accent tone. */
function IdeFolderIcon({ open, size = 14 }) {
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    'aria-hidden': 'true',
    focusable: 'false',
    style: { display: 'block' },
  }, [
    h('path', {
      key: 'body',
      d: open
        ? 'M1.8 12.4V4.4c0-.6.5-1.1 1.1-1.1h3.1l1.3 1.5h5.8c.6 0 1.1.5 1.1 1.1v1H4.3l-1.4 5.5H1.8Z'
        : 'M1.8 12.4V4.4c0-.6.5-1.1 1.1-1.1h3.1l1.3 1.5h5.8c.6 0 1.1.5 1.1 1.1v6.5c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1Z',
      fill: 'currentColor',
      opacity: open ? 0.95 : 0.8,
    }),
  ])
}

/** Colour families a file's extension maps to, for the tab and tree tint. */
function ideTintOf(lang) {
  if (lang === 'java') return '#e8a33d'
  if (lang === 'kotlin' || lang === 'scala' || lang === 'groovy') return '#b58cf0'
  if (lang === 'js' || lang === 'ts') return '#e5c07b'
  if (lang === 'json' || lang === 'yaml' || lang === 'toml' || lang === 'conf' || lang === 'properties') return '#89c07a'
  if (lang === 'xml' || lang === 'html') return '#e08f6a'
  if (lang === 'css') return '#6fb3e0'
  if (lang === 'md' || lang === 'txt') return '#9aa4b2'
  if (lang === 'py' || lang === 'go' || lang === 'rs' || lang === 'c' || lang === 'cpp' || lang === 'cs' || lang === 'php' || lang === 'rb' || lang === 'swift') return '#63c8b8'
  if (lang === 'sh' || lang === 'sql' || lang === 'dockerfile' || lang === 'proto') return '#8fb8e8'
  return '#8b95a5'
}

/** Document glyph tinted by language, with the extension initials when short. */
function IdeFileIcon({ lang, size = 14 }) {
  const tint = ideTintOf(lang)
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    'aria-hidden': 'true',
    focusable: 'false',
    style: { display: 'block' },
  }, [
    h('path', {
      key: 'page',
      d: 'M3.4 2.2h5.2l3.9 3.8v7.8c0 .4-.3.7-.7.7H3.4a.7.7 0 0 1-.7-.7V2.9c0-.4.3-.7.7-.7Z',
      fill: tint,
      opacity: 0.18,
      stroke: tint,
      strokeWidth: 1.1,
    }),
    h('path', { key: 'fold', d: 'M8.6 2.4v3.6h3.7', stroke: tint, strokeWidth: 1.1, opacity: 0.9 }),
  ])
}

/** Navigation-column toggle: the shell's left panel. */
function IdeSidebarIcon({ size = 15 }) {
  return ideSvg(size, [
    h('rect', { key: 'a', x: 2.2, y: 2.8, width: 11.6, height: 10.4, rx: 1.4 }),
    h('path', { key: 'b', d: 'M6.4 2.8v10.4M9.1 6.2 11 8l-1.9 1.8' }),
  ])
}

/** File-tree visibility toggle. */
function IdeTreeIcon({ size = 15 }) {
  return ideSvg(size, [
    h('rect', { key: 'a', x: 2.2, y: 2.8, width: 11.6, height: 10.4, rx: 1.4 }),
    h('path', { key: 'b', d: 'M6.4 2.8v10.4' }),
  ])
}

/** Refresh / re-read. */
function IdeRefreshIcon({ size = 15 }) {
  return ideSvg(size, [
    h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.7-3.8' }),
    h('path', { key: 'b', d: 'M13.2 2.4v2.9h-2.9' }),
  ])
}

/** Conversation bubble. */
function IdeChatIcon({ size = 15 }) {
  return ideSvg(size, [
    h('path', { key: 'a', d: 'M2.6 4.2c0-.8.6-1.4 1.4-1.4h8c.8 0 1.4.6 1.4 1.4v5.2c0 .8-.6 1.4-1.4 1.4H7.6L4.4 13v-2.2c-1 0-1.8-.6-1.8-1.4V4.2Z' }),
  ])
}


/** Reference jump toggle: a chain link. */
function IdeLinkIcon({ size = 15 }) {
  return ideSvg(size, [
    h('path', { key: 'a', d: 'M6.4 9.6 9.6 6.4' }),
    h('path', { key: 'b', d: 'M7.1 4.6 8.5 3.2a2.6 2.6 0 0 1 3.7 3.7l-1.4 1.4' }),
    h('path', { key: 'c', d: 'M8.9 11.4 7.5 12.8a2.6 2.6 0 0 1-3.7-3.7l1.4-1.4' }),
  ])
}

/** Close a tab. */
function IdeCloseIcon({ size = 10 }) {
  return ideSvg(size, [h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8' })])
}

/** Live-refresh indicator: a small pulsing dot. */
function IdeLiveDot({ on }) {
  return h('span', {
    className: `iw-live${on ? ' on' : ''}`,
    title: on ? 'live' : 'paused',
    'aria-hidden': 'true',
  })
}

/** Live refresh toggle. */
function IdeLiveIcon({ size = 15 }) {
  return ideSvg(size, [
    h('circle', { key: 'a', cx: 8, cy: 8, r: 2.1 }),
    h('path', { key: 'b', d: 'M8 1.8v1.9M8 12.3v1.9M1.8 8h1.9M12.3 8h1.9' }),
    h('path', { key: 'c', d: 'M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3', opacity: 0.6 }),
  ])
}

/** Open the file in the OS editor. */
function IdeExternalIcon({ size = 15 }) {
  return ideSvg(size, [
    h('path', { key: 'a', d: 'M9.6 2.6h3.8v3.8' }),
    h('path', { key: 'b', d: 'M13.2 2.8 7.9 8.1' }),
    h('path', { key: 'c', d: 'M11.6 9.4v3.2c0 .5-.4.9-.9.9H3.3a.9.9 0 0 1-.9-.9V5.2c0-.5.4-.9.9-.9h3.2' }),
  ])
}

/** Navigation back: an arrow pointing left. */
function IdeArrowLeftIcon({ size = 15 }) {
  return ideSvg(size, [
    h('path', { key: 'a', d: 'M10.5 3.5 5.5 8l5 4.5' }),
    h('path', { key: 'b', d: 'M5.5 8h7' }),
  ])
}

/** Navigation forward: an arrow pointing right. */
function IdeArrowRightIcon({ size = 15 }) {
  return ideSvg(size, [
    h('path', { key: 'a', d: 'M5.5 3.5 10.5 8l-5 4.5' }),
    h('path', { key: 'b', d: 'M10.5 8h-7' }),
  ])
}

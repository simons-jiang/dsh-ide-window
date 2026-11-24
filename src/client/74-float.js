/**
 * The floating quick-ask card of the code workspace.
 *
 * Doubao puts a small assistant over whatever you are reading; this card does
 * the same for the workspace: it opens when the code workspace takes the centre
 * column, it talks to **the Session the workspace is bound to** (so the model is
 * whatever that Session already uses), and it carries the composer's own
 * controls — model, permission preset, a reference to the open file, and stop.
 *
 * Data comes from the Client `sessions` service (prompt, cancel, log window) and
 * `modelDirectories` (the same directory the composer's model chip renders from),
 * so nothing here guesses at the conversation's DOM or re-implements selection.
 */

/** How many messages the card keeps on screen. */
const IDE_FLOAT_MESSAGES = 6

/** Permission presets the workspace switch offers, in DSH's own order. */
const IDE_FLOAT_PERMISSIONS = [
  { id: 'read-only', labelKey: 'floatPermissionReadOnly' },
  { id: 'workspace-write', labelKey: 'floatPermissionWorkspace' },
  { id: 'danger-full-access', labelKey: 'floatPermissionFull' },
]

/** Text blocks of one message content array. */
function ideFloatTextOf(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/** Files one `deliverables/presented` event declared, in order and de-duplicated. */
function ideFloatPresentedFilesOf(data) {
  const files = Array.isArray(data?.files) ? data.files : []
  const rows = []
  const seen = new Set()
  for (const file of files) {
    if (file === null || typeof file !== 'object') continue
    const path = typeof file.path === 'string' ? file.path.trim() : ''
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    rows.push({
      path,
      description: typeof file.description === 'string' ? file.description : '',
    })
  }
  return rows
}

/**
 * One log window as the card's transcript.
 *
 * Only the two message kinds the user wrote and the model answered become rows:
 * tool calls, reasoning blocks and injected context are not a conversation. The
 * newest entries win, because the card is a glance, not the transcript view.
 *
 * @param entries - `SessionEventLikeEntry[]` from the retained binding.
 */
/**
 * The image parts of one message content array.
 *
 * The durable log never keeps raw image bytes: the Host promotes them to an
 * attachment reference (`{type:'image', attachment:{attachmentId,…}}`), and the
 * bytes come back through `session.readAttachment(ref)`.
 */
function ideFloatImagesOf(content) {
  if (!Array.isArray(content)) return []
  const images = []
  for (const part of content) {
    if (part === null || typeof part !== 'object' || part.type !== 'image') continue
    const attachment = part.attachment
    if (attachment === null || typeof attachment !== 'object') continue
    if (typeof attachment.attachmentId !== 'string' || attachment.attachmentId === '') continue
    // Keep the reference intact: the wire schema wants the complete reference
    // (`attachmentId` + `mediaType` + `bytes` + `width` + `height`), not a copy
    // with the fields the card happens to use.
    images.push({
      ...attachment,
      mediaType: typeof attachment.mediaType === 'string' ? attachment.mediaType : 'image/png',
    })
  }
  return images
}

function ideFloatTranscript(entries, limit = IDE_FLOAT_MESSAGES) {
  if (!Array.isArray(entries)) return []
  const rows = []
  for (const entry of entries) {
    const event = entry?.event
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'user/message') {
      // Context injections share the event type; only a human prompt is a row.
      if (event.data?.source?.kind !== 'user') continue
      const content = event.data?.content
      const text = ideFloatTextOf(content)
      // A prompt can be images only, so a row exists when either part exists.
      const images = ideFloatImagesOf(content)
      if (text !== '' || images.length > 0) rows.push({ key: `u${event.seq}`, role: 'user', text, images })
      continue
    }
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      const text = ideFloatTextOf(content)
      const images = ideFloatImagesOf(content)
      if (text !== '' || images.length > 0) rows.push({ key: `a${event.seq}`, role: 'assistant', text, images })
      continue
    }
    if (event.type === 'deliverables/presented') {
      const files = ideFloatPresentedFilesOf(event.data)
      if (files.length > 0) rows.push({ key: `p${event.seq}`, role: 'files', text: '', images: [], files })
    }
  }
  return rows.slice(-limit)
}

/**
 * The label of a permission preset id.
 *
 * The session log carries `permission/preset` events; the id is the sandbox mode
 * (`read-only` / `workspace-write` / `danger-full-access`). Unknown ids are shown
 * verbatim rather than guessed.
 */
function ideFloatPermissionLabel(preset, translate) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const known = IDE_FLOAT_PERMISSIONS.find((entry) => entry.id === preset)
  if (known !== undefined) return tr(known.labelKey)
  return typeof preset === 'string' && preset !== '' ? preset : tr('floatPermission')
}

/** The preset named by the newest `permission/preset` event, or ''. */
function ideFloatPermissionOf(entries) {
  if (!Array.isArray(entries)) return ''
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const event = entries[index]?.event
    if (event === null || typeof event !== 'object') continue
    if (event.type !== 'permission/preset') continue
    const preset = event.data?.preset
    if (typeof preset === 'string' && preset !== '') return preset
  }
  return ''
}

/**
 * The prompt parts for one submission: the referenced files first, then the text.
 *
 * References are kept as chips in the composer but a Session takes text, so they
 * travel as `@path` mentions in front of what the user typed — the same shape the
 * conversation's own composer produces.
 */
function ideFloatPromptParts(text, refs, images) {
  const parts = []
  for (const image of Array.isArray(images) ? images : []) {
    if (image === null || typeof image !== 'object') continue
    if (typeof image.mediaType !== 'string' || typeof image.data !== 'string') continue
    parts.push({ type: 'image', mediaType: image.mediaType, data: image.data, ...image.name === undefined ? {} : { name: image.name } })
  }
  const mentions = (Array.isArray(refs) ? refs : []).filter((ref) => typeof ref === 'string' && ref !== '')
  const body = `${mentions.join(' ')}${mentions.length > 0 && text !== '' ? ' ' : ''}${text}`.trim()
  if (body !== '') parts.push({ type: 'text', text: body })
  return parts
}

/**
 * The Sessions the card can switch to, newest first.
 *
 * `sessions.list` is the same directory the sidebar renders, so titles match
 * what the user sees there. Subagent Sessions are skipped: they are not a place
 * a person talks, and switching to one would break the workspace binding.
 */
function ideFloatSessions(snapshot, archivedIds) {
  const byId = snapshot?.byId ?? {}
  const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : []
  // Archived Sessions keep a row in the list but not a place in the switcher.
  const archived = archivedIds instanceof Set ? archivedIds : new Set(Array.isArray(archivedIds) ? archivedIds : [])
  const rows = []
  for (const id of ids) {
    const row = byId[id]
    if (row === null || typeof row !== 'object') continue
    if (row.origin === 'subagent') continue
    if (archived.has(id)) continue
    if (row.archived === true) continue
    const title = typeof row.displayTitle === 'string' && row.displayTitle !== ''
      ? row.displayTitle
      : (typeof row.title === 'string' && row.title !== '' ? row.title : '')
    if (title === '') continue
    rows.push({
      sessionId: id,
      title,
      cwd: typeof row.cwd === 'string' ? row.cwd : '',
      running: row.running === true,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
    })
  }
  rows.sort((left, right) => right.updatedAt - left.updatedAt)
  return rows
}

/**
 * Group the switchable Sessions by workspace.
 *
 * DSH keeps one Workspace per directory, and a Session row reports that
 * directory as `cwd`, so the directory is the grouping key. The group holding
 * the panel's current workspace comes first (`current`), then the rest ordered
 * by their newest Session — the same order a person scans this list in.
 *
 * @returns `[{cwd, title, current, sessions}]`.
 */
function ideFloatSessionGroups(rows, currentCwd) {
  const current = typeof currentCwd === 'string' ? currentCwd.replace(/\/+$/, '') : ''
  const groups = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = typeof row?.cwd === 'string' ? row.cwd.replace(/\/+$/, '') : ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const list = []
  for (const [cwd, sessions] of groups) {
    list.push({
      cwd,
      title: ideBasename(cwd) || cwd.split('/').filter(Boolean).slice(-1)[0] || cwd,
      current: cwd !== '' && cwd === current,
      newest: sessions.reduce((top, row) => Math.max(top, row?.updatedAt ?? 0), 0),
      sessions,
    })
  }
  list.sort((left, right) => {
    if (left.current !== right.current) return left.current ? -1 : 1
    return right.newest - left.newest
  })
  return list
}

/** Every model of a directory snapshot as one flat list of options. */
function ideFloatModelOptions(snapshot) {
  const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : []
  const options = []
  for (const group of groups) {
    const models = Array.isArray(group?.models) ? group.models : []
    for (const model of models) {
      options.push({
        key: `${group.id}:${model.id}`,
        provider: group.id,
        model: model.id,
        label: model.name ?? model.id,
        group: group.name ?? group.id,
        effort: model.reasoning?.defaultEffort,
      })
    }
  }
  return options
}

/**
 * The reasoning efforts the selected model offers.
 *
 * The directory snapshot carries each model's `reasoning` metadata, so the list
 * is the same catalog the conversation's own effort control reads. A model
 * without reasoning metadata yields an empty list — no chip, no guessing.
 */
function ideFloatModelEfforts(snapshot) {
  const current = snapshot?.current
  if (current === null || current === undefined) return []
  const groups = Array.isArray(snapshot?.groups) ? snapshot.groups : []
  for (const group of groups) {
    if (group?.id !== current.provider) continue
    for (const model of Array.isArray(group?.models) ? group.models : []) {
      if (model?.id !== current.model) continue
      const efforts = Array.isArray(model.reasoning?.efforts) ? model.reasoning.efforts : []
      return efforts.map((effort) => ({ id: String(effort.id), label: effort.name ?? String(effort.id) }))
    }
  }
  return []
}

/**
 * The card's size: the stored one clamped to the viewport, or the shipped one.
 *
 * @returns `{width, height}` in CSS pixels.
 */
function ideFloatSize(state, viewportWidth, viewportHeight) {
  const margin = 12
  const minWidth = IDE_FLOAT_MIN_WIDTH
  const minHeight = IDE_FLOAT_MIN_HEIGHT
  const maxWidth = Math.max(minWidth, (Number(viewportWidth) || 0) - margin * 2)
  const maxHeight = Math.max(minHeight, (Number(viewportHeight) || 0) - margin * 2)
  const storedWidth = typeof state?.floatWidth === 'number' && Number.isFinite(state.floatWidth) ? state.floatWidth : IDE_FLOAT_DEFAULT_WIDTH
  const storedHeight = typeof state?.floatHeight === 'number' && Number.isFinite(state.floatHeight) ? state.floatHeight : IDE_FLOAT_DEFAULT_HEIGHT
  return {
    width: ideClamp(Math.round(storedWidth), minWidth, maxWidth),
    height: ideClamp(Math.round(storedHeight), minHeight, maxHeight),
  }
}

/**
 * One resize step from an edge or the corner.
 *
 * `mode` names the grabbed edge (`e`, `w`, `n`, `s`) or the corner (`se`). The
 * opposite edge stays put: dragging the left edge grows the card leftwards and
 * moves it, dragging the right edge only grows it. The result is clamped to the
 * control's minimum and to the viewport, and a clamped left/top edge is pulled
 * back so the card never slides out of bounds.
 *
 * @returns `{left, top, width, height}` in CSS pixels.
 */
function ideFloatResizeStep(start, mode, clientX, clientY, viewportWidth, viewportHeight) {
  const margin = 12
  const minWidth = IDE_FLOAT_MIN_WIDTH
  const minHeight = IDE_FLOAT_MIN_HEIGHT
  const dx = clientX - start.x
  const dy = clientY - start.y
  const grabsWest = mode.includes('w')
  const grabsNorth = mode.includes('n')
  const maxWidth = Math.max(minWidth, (Number(viewportWidth) || 0) - margin * 2)
  const maxHeight = Math.max(minHeight, (Number(viewportHeight) || 0) - margin * 2)
  let width = grabsWest ? start.width - dx : start.width + dx
  let height = grabsNorth ? start.height - dy : start.height + dy
  width = ideClamp(Math.round(width), minWidth, maxWidth)
  height = ideClamp(Math.round(height), minHeight, maxHeight)
  // A west/north grab keeps the opposite edge fixed even after clamping.
  const left = grabsWest ? start.left + start.width - width : start.left
  const top = grabsNorth ? start.top + start.height - height : start.top
  return {
    left: Math.max(margin, Math.min(left, Math.max(margin, (Number(viewportWidth) || 0) - width - margin))),
    top: Math.max(margin, Math.min(top, Math.max(margin, (Number(viewportHeight) || 0) - height - margin))),
    width,
    height,
  }
}

/** Where the card sits: the stored point, clamped into the viewport. */
function ideFloatPoint(state, viewportWidth, viewportHeight, cardWidth, cardHeight) {
  const margin = 12
  const maxLeft = Math.max(margin, viewportWidth - cardWidth - margin)
  const maxTop = Math.max(margin, viewportHeight - cardHeight - margin)
  const width = Number(viewportWidth) || 0
  const height = Number(viewportHeight) || 0
  // `Number(null)` is 0, so an untouched card must be detected by type first.
  const placedX = typeof state?.floatX === 'number' && Number.isFinite(state.floatX) ? state.floatX : maxLeft
  const placedY = typeof state?.floatY === 'number' && Number.isFinite(state.floatY) ? state.floatY : maxTop
  const left = placedX
  const top = placedY
  return {
    left: ideClamp(left, margin, width > 0 ? maxLeft : left),
    top: ideClamp(top, margin, height > 0 ? maxTop : top),
  }
}

/** Safe href for links and images: http(s), mailto, data:image, or a root-relative route. */
function ideFloatSafeUrl(url, image = false) {
  const text = String(url ?? '').trim()
  if (text === '') return ''
  if (/^https?:\/\//i.test(text) || /^mailto:/i.test(text)) return text
  if (image === true && /^data:image\//i.test(text)) return text
  if (text.startsWith('/') || text.startsWith('./') || text.startsWith('../')) return text
  return ''
}

/** One inline markdown run: code, bold, emphasis, strike, links, images, autolinks. */
function ideFloatInline(text, prefix = '') {
  const nodes = []
  const pattern = new RegExp([
    '`+[^`]*`+', // inline code, any number of backticks
    '!\\[[^\\]\\n]*\\]\\([^)\\s]+\\)', // image
    '\\[[^\\]\\n]+\\]\\([^)\\s]+\\)', // link
    '<https?://[^>\\s]+>', // autolink
    '\\*\\*[^*\\n]+?\\*\\*', // strong
    '__[^_\\n]+?__',
    '~~[^~\\n]+?~~', // strike
    '\\*[^*\\n]+?\\*', // emphasis
    '_[^_\\n]+?_',
    'https?://[^\\s<>()\\]]+', // bare url
    '\\\\[\\\\`*_{}\\[\\]()#+\\-.!~|>]', // escaped punctuation
  ].join('|'), 'g')
  let last = 0
  let order = 0
  const pushText = (value) => {
    if (value === '') return
    value.split('\n').forEach((chunk, index) => {
      if (index > 0) nodes.push(h('br', { key: `${prefix}n${order++}` }))
      if (chunk !== '') nodes.push(chunk)
    })
  }
  for (const match of String(text ?? '').matchAll(pattern)) {
    if (match.index > last) pushText(String(text).slice(last, match.index))
    const token = match[0]
    const key = `${prefix}i${order}`
    order += 1
    if (token.startsWith('\\')) {
      nodes.push(token.slice(1))
    } else if (token.startsWith('`')) {
      const ticks = /^`+/.exec(token)[0].length
      nodes.push(h('code', { key, className: 'iw-float-md-code' }, token.slice(ticks, -ticks).replace(/^ | $/g, '')))
    } else if (token.startsWith('![')) {
      const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token)
      const src = image === null ? '' : ideFloatSafeUrl(image[2], true)
      if (src === '') pushText(image === null ? token : image[1])
      else nodes.push(h('img', { key, className: 'iw-float-md-img', src, alt: image[1] }))
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const href = link === null ? '' : ideFloatSafeUrl(link[2])
      if (href === '') pushText(link === null ? token : link[1])
      else nodes.push(h('a', { key, className: 'iw-float-md-link', href, target: '_blank', rel: 'noreferrer' }, link[1]))
    } else if (token.startsWith('<http')) {
      const url = token.slice(1, -1)
      nodes.push(h('a', { key, className: 'iw-float-md-link', href: url, target: '_blank', rel: 'noreferrer' }, url))
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(h('strong', { key }, token.slice(2, -2)))
    } else if (token.startsWith('~~')) {
      nodes.push(h('del', { key }, token.slice(2, -2)))
    } else if (/^https?:\/\//.test(token)) {
      const trimmed = token.replace(/[.,;:!?]+$/, '')
      const href = ideFloatSafeUrl(trimmed)
      if (href === '') pushText(token)
      else {
        nodes.push(h('a', { key, className: 'iw-float-md-link', href, target: '_blank', rel: 'noreferrer' }, trimmed))
        if (trimmed !== token) pushText(token.slice(trimmed.length))
      }
    } else {
      nodes.push(h('em', { key }, token.slice(1, -1)))
    }
    last = match.index + token.length
  }
  if (last < String(text ?? '').length) pushText(String(text ?? '').slice(last))
  return nodes
}

/** One table row split on unescaped pipes; a trailing pipe is optional. */
function ideFloatTableCells(line) {
  const text = String(line ?? '').trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = []
  let current = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\' && text[index + 1] === '|') {
      current += '\\|'
      index += 1
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

/** The alignment row of a GFM table, or null when the line is not one. */
function ideFloatTableAlign(line) {
  if (!String(line ?? '').includes('|')) return null
  const cells = ideFloatTableCells(line)
  if (cells.length === 0) return null
  const align = []
  for (const cell of cells) {
    const match = /^(:?)-+(:?)$/.exec(cell)
    if (match === null) return null
    align.push(match[1] === ':' && match[2] === ':' ? 'center' : match[2] === ':' ? 'right' : match[1] === ':' ? 'left' : '')
  }
  return align
}

/** Block-level markdown: fences, headings, tables, lists, quotes, rules, paragraphs. */
function ideFloatMarkdownBlocks(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const blocks = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3)
      const lang = line.trim().slice(3).trim()
      const body = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith(fence)) {
        body.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }
    if (/^\s*$/.test(line)) {
      index += 1
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '') })
      index += 1
      continue
    }
    if (/^\s*(?:[-*_])\s*(?:[-*_]\s*){2,}$/.test(line)) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const body = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', text: body.join('\n') })
      continue
    }
    // A table needs a header row and an alignment row right under it.
    if (String(line).includes('|') && index + 1 < lines.length) {
      const align = ideFloatTableAlign(lines[index + 1])
      if (align !== null) {
        const head = ideFloatTableCells(line)
        const rows = []
        index += 2
        while (index < lines.length && String(lines[index]).includes('|') && !/^\s*$/.test(lines[index])) {
          rows.push(ideFloatTableCells(lines[index]))
          index += 1
        }
        blocks.push({ type: 'table', align, head, rows })
        continue
      }
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items = []
      while (index < lines.length) {
        const item = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(lines[index])
        if (item === null) {
          // An indented line continues the item above it.
          if (items.length > 0 && /^\s{2,}\S/.test(lines[index])) {
            items[items.length - 1].text += `\n${lines[index].trim()}`
            index += 1
            continue
          }
          break
        }
        const depth = Math.min(6, Math.floor(item[1].replace(/\t/g, '  ').length / 2))
        let body = item[2]
        let task = null
        const checkbox = /^\[([ xX])\]\s+(.*)$/.exec(body)
        if (checkbox !== null) {
          task = checkbox[1].toLowerCase() === 'x'
          body = checkbox[2]
        }
        items.push({ text: body, depth, task })
        index += 1
      }
      blocks.push({ type: ordered ? 'ol' : 'ul', items })
      continue
    }
    // Paragraph: soft breaks join with a space, a two-space/backslash break keeps a newline.
    const body = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index]
      if (/^\s*$/.test(next)) break
      // Setext heading: the line under a single paragraph line underlines it.
      if (body.length === 1 && /^\s*(=+|-+)\s*$/.test(next)) {
        blocks.push({ type: 'heading', level: next.trim().startsWith('=') ? 1 : 2, text: body[0].trim() })
        index += 1
        body.length = 0
        break
      }
      if (/^\s*(```|~~~)/.test(next) || /^\s*#{1,6}\s+/.test(next) || /^\s*>\s?/.test(next)
        || /^\s*(?:[-*+]|\d+[.)])\s+/.test(next)) break
      if (String(next).includes('|') && index + 1 < lines.length && ideFloatTableAlign(lines[index + 1]) !== null) break
      body.push(next)
      index += 1
    }
    if (body.length === 0) continue
    let joined = ''
    let hardAt = false
    for (let position = 0; position < body.length; position += 1) {
      const raw = body[position]
      const hard = position < body.length - 1 && (/\s{2,}$/.test(raw) || /\\$/.test(raw))
      const clean = raw.replace(/\\$/, '').replace(/\s+$/, '')
      if (position === 0) joined = clean
      else if (hardAt !== undefined && hardAt === true) joined += `\n${clean}`
      else joined += ` ${clean}`
      hardAt = hard
    }
    blocks.push({ type: 'paragraph', text: joined })
  }
  return blocks
}

/** One fenced code block: language label, copy, tokenised lines. */
function IdeFloatCodeBlock({ code, lang, tr }) {
  const [copied, setCopied] = useState(false)
  const language = ideLangOf(`x.${String(lang ?? '').trim()}`) || ''
  const lines = useMemo(() => String(code ?? '').split('\n'), [code])
  const copy = () => {
    if (ideCopyToClipboard(String(code ?? '')) !== true) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return h('div', { className: 'iw-float-md-codeblock' }, [
    h('div', { key: 'head', className: 'iw-float-md-codehead' }, [
      h('span', { key: 'lang', className: 'iw-float-md-codelang' }, ideLangLabel(language) || (lang === '' ? tr('floatCode') : lang)),
      h('button', { key: 'copy', type: 'button', className: 'iw-float-md-copy', onClick: copy }, copied ? tr('floatCopied') : tr('floatCopy')),
    ]),
    h('pre', { key: 'pre', className: 'iw-float-md-pre' }, lines.map((line, lineIndex) => h('div', {
      key: lineIndex,
      className: 'iw-float-md-line',
    }, ideTokenize(line, language).map((run, runIndex) => (run.cls === ''
      ? run.text
      : h('span', { key: runIndex, className: run.cls }, run.text)))))),
  ])
}

/** Assistant text rendered like the conversation: code, tables, lists, links and images. */
function IdeFloatMarkdown({ text, tr }) {
  const blocks = useMemo(() => ideFloatMarkdownBlocks(text), [text])
  const cellClass = (align) => (align === '' || align === undefined ? undefined : `iw-float-md-${align}`)
  return h('div', { className: 'iw-float-md' }, blocks.map((block, index) => {
    const key = `b${index}`
    if (block.type === 'code') return h(IdeFloatCodeBlock, { key, code: block.text, lang: block.lang, tr })
    if (block.type === 'heading') return h('div', { key, className: `iw-float-md-h iw-float-md-h${block.level}` }, ideFloatInline(block.text, key))
    if (block.type === 'hr') return h('div', { key, className: 'iw-float-md-hr' })
    if (block.type === 'quote') return h('blockquote', { key, className: 'iw-float-md-quote' }, ideFloatInline(block.text, key))
    if (block.type === 'table') {
      return h('div', { key, className: 'iw-float-md-tablewrap' }, h('table', { key: 't', className: 'iw-float-md-table' }, [
        h('thead', { key: 'head' }, h('tr', { key: 'row' }, block.head.map((cell, column) => h('th', {
          key: `c${column}`,
          className: cellClass(block.align[column]),
        }, ideFloatInline(cell, `${key}h${column}`))))),
        h('tbody', { key: 'body' }, block.rows.map((row, rowIndex) => h('tr', { key: `r${rowIndex}` }, block.head.map((_, column) => h('td', {
          key: `c${column}`,
          className: cellClass(block.align[column]),
        }, ideFloatInline(row[column] ?? '', `${key}r${rowIndex}c${column}`)))))),
      ]))
    }
    if (block.type === 'ul' || block.type === 'ol') {
      return h(block.type, { key, className: 'iw-float-md-list' }, block.items.map((item, itemIndex) => h('li', {
        key: `${key}l${itemIndex}`,
        className: item.task === null || item.task === undefined
          ? undefined
          : `iw-float-md-task${item.task === true ? ' iw-float-md-done' : ''}`,
        style: item.depth > 0 ? { marginLeft: `${Math.min(item.depth, 6) * 14}px` } : undefined,
      }, [
        item.task === null || item.task === undefined
          ? null
          : h('span', { key: 'check', className: 'iw-float-md-check' }, item.task === true ? '☑' : '☐'),
        ...ideFloatInline(item.text.replace(/\n/g, ' '), `${key}l${itemIndex}`),
      ])))
    }
    return h('p', { key, className: 'iw-float-md-p' }, ideFloatInline(block.text, key))
  }))
}

/**
 * The floating card.
 *
 * @param props.sessions - the Client `sessions` service (retention + prompt).
 * @param props.modelDirectories - the model directory service the composer uses.
 */
function IdeFloatingAsk({ store, sessions, modelDirectories, translate, openSession, startSession, useWorkspaces }) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [binding, setBinding] = useState(null)
  const [entries, setEntries] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [models, setModels] = useState(null)
  // The label of a selection the Host accepted but has not projected yet.
  const [picked, setPicked] = useState(null)
  const [menu, setMenu] = useState('')
  // References and pasted images live as chips between the transcript and the text.
  const [refs, setRefs] = useState([])
  const [images, setImages] = useState([])
  const [preset, setPreset] = useState('')
  const [effort, setEffort] = useState(null)
  // Attachment bytes are fetched on demand: the log only carries references.
  const [pictures, setPictures] = useState({})
  const picturesRef = useRef({})
  picturesRef.current = pictures
  const [projectedPreset, setProjectedPreset] = useState('')
  const cardRef = useRef(null)
  const dragRef = useRef(null)
  const menuRef = useRef(null)

  // Resolve every referenced image once; failures stay as a placeholder.
  useEffect(() => {
    if (binding === null) return undefined
    const wanted = []
    for (const row of entries) {
      for (const image of Array.isArray(row?.images) ? row.images : []) {
        const id = image?.attachmentId
        if (typeof id !== 'string' || id === '') continue
        if (picturesRef.current[id] !== undefined) continue
        if (wanted.some((entry) => entry.attachmentId === id)) continue
        wanted.push(image)
      }
    }
    if (wanted.length === 0) return undefined
    let alive = true
    for (const image of wanted) {
      binding.session.readAttachment(image).then((result) => {
        if (alive !== true) return
        if (result?.ok !== true) {
          ideLogRecord('warn', 'float', 'attachment failed', {
            code: result?.error?.code ?? 'unknown',
            message: result?.error?.message ?? '',
          })
          return
        }
        const data = result.value?.data
        const mediaType = result.value?.attachment?.mediaType ?? image.mediaType
        if (data === undefined) return
        const bytes = new Uint8Array(data)
        let url = ''
        if (typeof URL?.createObjectURL === 'function') {
          url = URL.createObjectURL(new Blob([bytes], { type: mediaType }))
        } else {
          let binary = ''
          for (const byte of bytes) binary += String.fromCharCode(byte)
          url = `data:${mediaType};base64,${btoa(binary)}`
        }
        setPictures((current) => (current[image.attachmentId] !== undefined ? current : { ...current, [image.attachmentId]: url }))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [binding, entries])

  const sessionId = state.sessionId ?? ''
  const open = state.floatOpen === true && state.floatEnabled !== false && state.floatClosed !== true
  const collapsed = state.floatCollapsed === true

  // Retain the Session on screen: the face owns the prompt call and the log
  // window, so nothing here needs the composer's DOM.
  useEffect(() => {
    if (sessions === undefined || sessions === null || sessionId === '') return undefined
    let reference
    try {
      reference = sessions.retain(sessionId, { source: 'controllerOperation' })
    } catch (error) {
      ideLogRecord('warn', 'float', 'retain failed', error?.message ?? String(error))
      return undefined
    }
    let cancelled = false
    Promise.resolve(reference.ready)
      .then((next) => { if (!cancelled) setBinding(next ?? null) })
      .catch((error) => {
        ideLogRecord('warn', 'float', 'session not ready', error?.message ?? String(error))
      })
    return () => {
      cancelled = true
      setBinding(null)
      reference.release()
    }
  }, [sessions, sessionId])

  // Committed messages, published by the binding's own event window.
  useEffect(() => {
    if (binding === null) {
      setEntries([])
      return undefined
    }
    const source = binding.eventSource
    const read = () => setEntries(ideFloatTranscript(source.getSnapshot()?.entries))
    read()
    return source.subscribe(read)
  }, [binding])

  // The session directory, for the switcher in the header. The Workspace snapshot
  // carries the archive set, which is what keeps archived conversations out.
  const [sessionRows, setSessionRows] = useState([])
  const selectWorkspaces = typeof useWorkspaces === 'function' ? useWorkspaces : () => undefined
  const workspaceSnapshot = selectWorkspaces((snapshot) => snapshot)
  const archivedIds = workspaceSnapshot?.archivedSessionIds
  useEffect(() => {
    const list = sessions?.list
    if (list === undefined || list === null) return undefined
    const read = () => setSessionRows(ideFloatSessions(list.getSnapshot(), archivedIds))
    read()
    return list.subscribe(read)
  }, [sessions, archivedIds])

  // The model directory of this Session: the same snapshot the composer's model
  // chip renders, so the two can never disagree.
  useEffect(() => {
    if (modelDirectories === undefined || modelDirectories === null || sessionId === '') {
      setModels(null)
      return undefined
    }
    let directory
    try {
      directory = modelDirectories.directoryFor(sessionId)
    } catch (error) {
      ideLogRecord('warn', 'float', 'model directory failed', error?.message ?? String(error))
      return undefined
    }
    const read = () => setModels(directory.store.getSnapshot())
    read()
    const off = directory.store.subscribe(read)
    try {
      void directory.load?.()
    } catch (error) {
      ideLogRecord('warn', 'float', 'model catalog failed', error?.message ?? String(error))
    }
    return off
  }, [modelDirectories, sessionId])

  // The optimistic label lives until the projection actually moves. Comparing
  // ids is not enough: one provider can expose several labels under one id, so
  // the baseline is what the store said *before* the selection.
  useEffect(() => {
    if (picked === null) return
    const current = models?.current
    const key = current === undefined || current === null ? '' : `${current.provider ?? ''}:${current.model ?? ''}`
    if (key !== picked.baseline) setPicked(null)
  }, [models, picked])

  // A reference handed over by "复制引用回对话" becomes a chip in this card: the
  // card is open, so that is where the user is looking.
  useEffect(() => {
    const pending = state.floatInsert
    if (pending === null || typeof pending !== 'object' || typeof pending.text !== 'string' || pending.text === '') return
    setRefs((current) => (current.includes(pending.text) ? current : [...current, pending.text]))
    store.setFloatInsert(null)
    const area = cardRef.current?.querySelector('.iw-float-textarea')
    if (area instanceof HTMLElement) area.focus()
  }, [state.floatInsert, store])

  // The permission chip mirrors the Session. `permissions` is a Host projection
  // (wire view `{currentValue}`), so this is the same value the conversation's own
  // control reads — not a guess from the log.
  useEffect(() => {
    if (binding === null) {
      setProjectedPreset('')
      return undefined
    }
    const projections = binding.session?.projections
    if (projections === undefined || projections === null) return undefined
    const read = () => {
      const value = typeof projections.get === 'function' ? projections.get('permissions') : undefined
      setProjectedPreset(typeof value?.currentValue === 'string' ? value.currentValue : '')
    }
    read()
    const face = typeof projections.faceOf === 'function' ? projections.faceOf('permissions') : undefined
    const off = typeof face?.subscribe === 'function' ? face.subscribe(read) : projections.subscribeAny?.(read)
    return () => {
      if (typeof off === 'function') off()
    }
  }, [binding])

  const permission = projectedPreset !== '' ? projectedPreset : (preset !== '' ? preset : ideFloatPermissionOf(entries))

  // Opening the switcher lands on the current workspace's group: the list can
  // be long, and the conversations a person wants are the ones next to them.
  useEffect(() => {
    if (menu !== 'sessions') return
    const menuEl = menuRef.current
    if (menuEl === null) return
    const marker = menuEl.querySelector('.iw-float-group-current')
    if (marker === null) return
    // `offsetTop` is measured against the card (position: fixed), not the
    // scroll box, so the delta is taken between the two rects instead.
    const delta = marker.getBoundingClientRect().top - menuEl.getBoundingClientRect().top
    const head = menuEl.querySelector('.iw-float-menu-new')
    const reserved = head === null ? 0 : head.getBoundingClientRect().height + 4
    menuEl.scrollTop = Math.max(0, menuEl.scrollTop + delta - reserved)
  }, [menu])

  // A click outside the card closes its little menus.
  useEffect(() => {
    if (menu === '') return undefined
    const onDown = (event) => {
      const node = event.target
      if (node instanceof Element && node.closest('.iw-float') !== null) return
      setMenu('')
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [menu])

  if (!open) return null

  const running = binding !== null && binding.session.getSnapshot()?.running === true
  // The header names the conversation, not the folder: that is what the menu
  // switches. The workspace stays available in the tooltip and the empty state.
  const currentRow = sessionRows.find((row) => row.sessionId === sessionId)
  const sessionGroups = ideFloatSessionGroups(sessionRows, state.rootPath ?? '')
  const sessionTitle = currentRow?.title
    ?? (workspace === '' || workspace === tr('floatNoWorkspace') ? tr('floatNoSession') : workspace)
  const workspace = ideBasename(state.rootPath ?? '') || tr('floatNoWorkspace')
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  const size = ideFloatSize(state, viewportWidth, viewportHeight)
  const point = ideFloatPoint(state, viewportWidth, viewportHeight, size.width, collapsed ? 52 : size.height)

  // Drag the header and resize the card from its corner grip.
  //
  // Both listen on the WINDOW for the duration of the gesture: a fast drag
  // leaves the 20px header between two pointermove events, and a handler bound
  // to the header would follow no further (the card "fell off" the pointer).
  // Pointer capture keeps the same guarantee for browsers that deliver it.
  const beginGesture = (event, mode) => {
    if (event.button !== 0) return
    const card = cardRef.current
    if (card === null) return
    event.preventDefault()
    const box = card.getBoundingClientRect()
    const start = {
      mode,
      pointerId: event.pointerId,
      dx: event.clientX - box.left,
      dy: event.clientY - box.top,
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      x: event.clientX,
      y: event.clientY,
    }
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId)
    } catch (error) {
      void error
    }
    dragRef.current = start
    const move = (next) => {
      const drag = dragRef.current
      if (drag === null || drag.mode !== mode) return
      if (mode === 'move') {
        store.setFloatPoint(next.clientX - drag.dx, next.clientY - drag.dy)
        return
      }
      const moved = ideFloatResizeStep(drag, mode, next.clientX, next.clientY, window.innerWidth, window.innerHeight)
      store.setFloatSize(moved.width, moved.height)
      // Left and top edges move the card as they resize it.
      if (moved.left !== drag.left || moved.top !== drag.top) store.setFloatPoint(moved.left, moved.top)
    }
    const finish = () => {
      dragRef.current = null
      globalThis.removeEventListener('pointermove', move, true)
      globalThis.removeEventListener('pointerup', finish, true)
      globalThis.removeEventListener('pointercancel', finish, true)
    }
    globalThis.addEventListener('pointermove', move, true)
    globalThis.addEventListener('pointerup', finish, true)
    globalThis.addEventListener('pointercancel', finish, true)
  }
  const onHeaderDown = (event) => {
    if (event.target instanceof Element && event.target.closest('.iw-float-icon, .iw-float-chip, .iw-float-resize, .iw-float-title-btn, .iw-float-new-btn') !== null) return
    beginGesture(event, 'move')
  }
  /** Grab one edge or the corner: the mode says which one. */
  const onGripDown = (mode) => (event) => beginGesture(event, mode)

  const submit = async () => {
    const text = draft.trim()
    const parts = ideFloatPromptParts(text, refs, images)
    if (parts.length === 0 || binding === null || sending) return
    setSending(true)
    setDraft('')
    const sentRefs = refs
    const sentImages = images
    setRefs([])
    setImages([])
    try {
      const result = await binding.session.prompt(parts, 'queue')
      if (result?.ok !== true) {
        const reason = result?.error?.message ?? result?.error?.code ?? 'unknown'
        store.setNotice(`${tr('floatFailed')}: ${reason}`)
        setDraft(text)
        setRefs(sentRefs)
        setImages(sentImages)
      }
    } catch (error) {
      store.setNotice(`${tr('floatFailed')}: ${error?.message ?? String(error)}`)
      setDraft(text)
      setRefs(sentRefs)
      setImages(sentImages)
    } finally {
      setSending(false)
    }
  }

  /**
   * Paste an image into the card.
   *
   * A Session takes images as base64 content parts, so the clipboard File is read
   * into a data URL and kept as a pending attachment with a preview; the chips
   * are removable before sending.
   */
  const onPaste = (event) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const pictures = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    if (pictures.length === 0) return
    event.preventDefault()
    if (images.length >= 4) {
      store.setNotice(tr('floatImageLimit'))
      return
    }
    for (const item of pictures.slice(0, 4 - images.length)) {
      const file = item.getAsFile()
      if (file === null) continue
      if (file.size > 8 * 1024 * 1024) {
        store.setNotice(tr('floatImageTooLarge'))
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = typeof reader.result === 'string' ? reader.result : ''
        const comma = url.indexOf(',')
        if (comma < 0) return
        const data = url.slice(comma + 1)
        setImages((current) => (current.length >= 4
          ? current
          : [...current, {
            key: `img${Date.now()}${current.length}`,
            mediaType: file.type === '' ? 'image/png' : file.type,
            data,
            name: file.name === '' ? undefined : file.name,
            preview: url,
          }]))
      }
      reader.readAsDataURL(file)
    }
  }

  /** Switch the reasoning effort of the model already in use. */
  const chooseEffort = async (id) => {
    setMenu('')
    const current = models?.current
    if (modelDirectories === undefined || modelDirectories === null || sessionId === '' || current === undefined) return
    try {
      const directory = modelDirectories.directoryFor(sessionId)
      const result = await directory.select({
        provider: current.provider,
        model: current.model,
        ...id === '' ? { reasoningEffort: undefined } : { reasoningEffort: id },
      })
      if (result?.ok === false) {
        store.setNotice(`${tr('floatModelFailed')}: ${result.error?.message ?? result.error?.code ?? 'unknown'}`)
        return
      }
      setEffort(id === '' ? tr('floatEffortDefault') : (efforts.find((entry) => entry.id === id)?.label ?? id))
    } catch (error) {
      store.setNotice(`${tr('floatModelFailed')}: ${error?.message ?? String(error)}`)
    }
  }

  const stop = async () => {
    if (binding === null) return
    try {
      await binding.session.cancel()
    } catch (error) {
      store.setNotice(`${tr('floatStopFailed')}: ${error?.message ?? String(error)}`)
    }
  }

  /** Add `@path` for the file on screen as a reference chip. */
  const referenceOpenFile = () => {
    const path = state.activePath ?? ''
    setMenu('')
    if (path === '') {
      store.setNotice(tr('floatNeedsFile'))
      return
    }
    const mention = ideReferenceMention(ideRelativeTo(state.rootPath ?? '', path), false)
    if (mention === '') return
    setRefs((current) => (current.includes(mention) ? current : [...current, mention]))
  }

  /** `/permission <preset>` is the documented switch; a refusal says so. */
  const choosePermission = async (preset) => {
    setMenu('')
    if (binding === null) return
    try {
      const result = await binding.session.command(`/permission ${preset}`)
      if (result?.ok !== true || result?.value?.matched !== true) store.setNotice(tr('floatPermissionFailed'))
      else setPreset(preset)
    } catch (error) {
      store.setNotice(`${tr('floatPermissionFailed')}: ${error?.message ?? String(error)}`)
    }
  }

  const chooseModel = async (option) => {
    setMenu('')
    if (modelDirectories === undefined || modelDirectories === null || sessionId === '') return
    try {
      const directory = modelDirectories.directoryFor(sessionId)
      const result = await directory.select({ provider: option.provider, model: option.model, ...option.effort === undefined ? {} : { reasoningEffort: option.effort } })
      if (result?.ok === false) store.setNotice(`${tr('floatModelFailed')}: ${result.error?.message ?? result.error?.code ?? 'unknown'}`)
      else setPicked({
        ...option,
        baseline: models?.current === undefined || models.current === null
          ? ''
          : `${models.current.provider ?? ''}:${models.current.model ?? ''}`,
      })
    } catch (error) {
      store.setNotice(`${tr('floatModelFailed')}: ${error?.message ?? String(error)}`)
    }
  }

  const modelLabel = picked !== null
    ? picked.label
    : models?.current?.model
      ? (models.current.name ?? models.current.model)
      : tr('floatModel')
  const efforts = ideFloatModelEfforts(models)
  const effortLabel = effort !== null
    ? effort
    : efforts.find((entry) => entry.id === String(models?.current?.reasoningEffort ?? ''))?.label ?? tr('floatEffortDefault')
  const options = ideFloatModelOptions(models)
  // The workspace palette drives the card: same attribute, same tokens, same
  // type scale as the panel behind it.
  const font = Number.isFinite(state.treeFontSize) ? state.treeFontSize : 14.5

  // The stylesheet stays a sibling of the card: a `<style>` inside it would put
  // its text into the card's own text content.
  const styled = (node) => h(React.Fragment, null, [h(IdeStyles, { key: 'style' }), node])

  const shell = (children, extra) => styled(h('div', {
    key: 'card',
    ref: cardRef,
    className: extra === undefined ? 'iw-float' : `iw-float ${extra}`,
    'data-dsh-theme': state.theme === '' ? undefined : state.theme,
    style: {
      left: `${point.left}px`,
      top: `${point.top}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${size.width}px`,
      height: `${size.height}px`,
      fontSize: `${font}px`,
    },
  }, children))

  if (collapsed) {
    return shell([h('button', {
      key: 'b',
      type: 'button',
      className: 'iw-float-ball-btn',
      onClick: () => store.setFloatCollapsed(false),
      'aria-label': tr('floatExpand'),
    }, 'AI')], 'iw-float-collapsed')
  }

  return shell([
    h('div', {
      key: 'head',
      className: 'iw-float-head',
      onPointerDown: onHeaderDown,
    }, [
      h('span', { key: 'dot', className: 'iw-float-dot', 'aria-hidden': 'true' }),
      h('button', {
        key: 'name',
        type: 'button',
        className: 'iw-float-title iw-float-title-btn',
        title: `${tr('floatSessions')} · ${state.rootPath ?? ''}`,
        onClick: () => setMenu(menu === 'sessions' ? '' : 'sessions'),
      }, [
        h('span', { key: 'text', className: 'iw-float-title iw-float-title-text' }, sessionTitle),
        h('span', { key: 'caret', className: 'iw-float-title-caret' }, '▾'),
      ]),
      h('button', {
        key: 'new',
        type: 'button',
        className: 'iw-float-new-btn',
        title: tr('floatNewSession'),
        'aria-label': tr('floatNewSession'),
        onClick: () => {
          setMenu('')
          if (typeof startSession === 'function') startSession()
        },
      }, '＋'),
      h('button', {
        key: 'model',
        type: 'button',
        className: 'iw-float-chip',
        title: tr('floatModelHint'),
        onClick: () => setMenu(menu === 'model' ? '' : 'model'),
      }, modelLabel),
      efforts.length === 0 ? null : h('button', {
        key: 'effort',
        type: 'button',
        className: 'iw-float-chip iw-float-effort',
        title: `${tr('floatEffort')}: ${effortLabel}`,
        onClick: () => setMenu(menu === 'effort' ? '' : 'effort'),
      }, effortLabel),
      h('div', { key: 'actions', className: 'iw-float-actions' }, [
        h('button', {
          key: 'shrink',
          type: 'button',
          className: 'iw-float-icon',
          title: tr('floatCollapse'),
          'aria-label': tr('floatCollapse'),
          onClick: () => store.setFloatCollapsed(true),
        }, '–'),
        h('button', {
          key: 'close',
          type: 'button',
          className: 'iw-float-icon',
          title: tr('floatClose'),
          'aria-label': tr('floatClose'),
          onClick: () => store.setFloatClosed(true),
        }, '×'),
      ]),
    ]),
    menu === 'sessions'
      ? h('div', { key: 'sessions', className: 'iw-float-menu iw-float-sessions', ref: menuRef }, [
        h('button', {
          key: 'new',
          type: 'button',
          className: 'iw-float-menu-item iw-float-menu-new',
          onClick: () => {
            setMenu('')
            if (typeof startSession === 'function') startSession()
          },
        }, `＋ ${tr('floatNewSession')}`),
        sessionRows.length === 0
          ? h('div', { key: 'empty', className: 'iw-float-menu-empty' }, tr('floatSessionEmpty'))
          : sessionGroups.map((group) => h('div', {
            key: `g:${group.cwd}`,
            className: group.current ? 'iw-float-group-current' : undefined,
          }, [
            h('div', {
              key: 'head',
              className: 'iw-float-group-head',
              title: group.cwd,
            }, [
              h('span', { key: 'n', className: 'iw-float-group-name' }, group.title),
              group.current ? h('span', { key: 'c', className: 'iw-float-group-badge' }, tr('floatCurrentWorkspace')) : null,
            ]),
            ...group.sessions.slice(0, 30).map((row) => h('button', {
              key: row.sessionId,
              type: 'button',
              className: `iw-float-menu-item${row.sessionId === sessionId ? ' on' : ''}`,
              title: row.cwd === '' ? row.title : row.cwd,
              onClick: () => {
                setMenu('')
                if (typeof openSession === 'function') openSession(row.sessionId)
              },
            }, [
              h('span', { key: 't', className: 'iw-float-menu-label' }, row.title),
              row.running ? h('span', { key: 'r', className: 'iw-float-menu-group' }, tr('floatRunning')) : null,
            ])),
          ])),
      ])
      : null,
    menu === 'model'
      ? h('div', { key: 'models', className: 'iw-float-menu' }, options.length === 0
        ? h('div', { key: 'none', className: 'iw-float-menu-empty' }, tr('floatModelEmpty'))
        : options.map((option) => h('button', {
          key: option.key,
          type: 'button',
          className: `iw-float-menu-item${option.model === models?.current?.model ? ' on' : ''}`,
          onClick: () => { void chooseModel(option) },
        }, [
          h('span', { key: 'l', className: 'iw-float-menu-label' }, option.label),
          h('span', { key: 'g', className: 'iw-float-menu-group' }, option.group),
        ])))
      : null,
    h('div', { key: 'body', className: 'iw-float-body' }, entries.length === 0
      ? h('div', { key: 'empty', className: 'iw-float-empty' }, sessionId === '' ? tr('floatNoSession') : tr('floatEmpty'))
      : entries.map((row) => {
        if (row.role === 'files') {
          return h('div', { key: row.key, className: 'iw-float-row iw-float-files' }, [
            h('span', { key: 'who', className: 'iw-float-who' }, tr('floatFiles')),
            h('div', { key: 'list', className: 'iw-float-filelist' }, (row.files ?? []).map((file) => h('button', {
              key: file.path,
              type: 'button',
              className: 'iw-float-file',
              title: file.path,
              onClick: () => {
                if (typeof store.openFile === 'function') store.openFile(file.path)
              },
            }, [
              h('span', { key: 'n', className: 'iw-float-file-name' }, ideBasename(file.path)),
              file.description === '' ? null : h('span', { key: 'd', className: 'iw-float-file-desc' }, file.description),
            ]))),
          ])
        }
        return h('div', { key: row.key, className: `iw-float-row iw-float-${row.role}` }, [
          h('span', { key: 'who', className: 'iw-float-who' }, row.role === 'user' ? tr('floatYou') : tr('floatAssistant')),
          // Both sides are markdown: a prompt can carry tables and lists too, and
          // rendering it as raw text was exactly what users complained about.
          row.text === '' ? null : h(IdeFloatMarkdown, { key: 'text', text: row.text, tr }),
          row.images === undefined || row.images.length === 0 ? null : h('div', { key: 'pics', className: 'iw-float-pics' }, row.images.map((image, index) => {
            const url = pictures[image.attachmentId] ?? ''
            if (url === '') return h('div', { key: `pic${index}`, className: 'iw-float-pic iw-float-pic-wait' })
            return h('img', { key: `pic${index}`, className: 'iw-float-pic', src: url, alt: image.name ?? '' })
          })),
        ])
      })),
    running ? h('div', { key: 'run', className: 'iw-float-running' }, tr('floatRunning')) : null,
    h('div', { key: 'input', className: 'iw-float-input' }, [
      refs.length === 0 && images.length === 0 ? null : h('div', { key: 'chips', className: 'iw-float-chips' }, [
        ...refs.map((ref, index) => h('span', { key: `ref:${ref}`, className: 'iw-float-chip-ref' }, [
          h('span', { key: 't', className: 'iw-float-chip-ref-text' }, ref.replace(/^@/, '')),
          h('button', {
            key: 'x',
            type: 'button',
            className: 'iw-float-chip-x',
            'aria-label': tr('floatRemove'),
            onClick: () => setRefs((current) => current.filter((_, position) => position !== index)),
          }, '×'),
        ])),
        ...images.map((image) => h('span', { key: image.key, className: 'iw-float-chip-image', title: image.name ?? '' }, [
          h('img', { key: 'i', src: image.preview, alt: '' }),
          h('button', {
            key: 'x',
            type: 'button',
            className: 'iw-float-chip-x',
            'aria-label': tr('floatRemove'),
            onClick: () => setImages((current) => current.filter((entry) => entry.key !== image.key)),
          }, '×'),
        ])),
      ]),
      menu === 'effort'
        ? h('div', { key: 'efforts', className: 'iw-float-menu' }, [
          h('div', { key: 'head', className: 'iw-float-menu-head' }, tr('floatEffort')),
          ...[{ id: '', label: tr('floatEffortDefault') }, ...efforts].map((entry) => h('button', {
            key: `e:${entry.id}`,
            type: 'button',
            className: 'iw-float-menu-item',
            onClick: () => { void chooseEffort(entry.id) },
          }, entry.label)),
        ])
        : null,
      menu === 'attach'
        ? h('div', { key: 'attachmenu', className: 'iw-float-menu' }, [
          h('button', {
            key: 'ref',
            type: 'button',
            className: 'iw-float-menu-item',
            onClick: referenceOpenFile,
          }, tr('floatAttachReference')),
        ])
        : null,
      menu === 'perm'
        ? h('div', { key: 'permmenu', className: 'iw-float-menu' }, IDE_FLOAT_PERMISSIONS.map((entry) => h('button', {
          key: entry.id,
          type: 'button',
          className: `iw-float-menu-item${entry.id === permission ? ' on' : ''}`,
          onClick: () => { void choosePermission(entry.id) },
        }, tr(entry.labelKey))))
        : null,
      h('textarea', {
        key: 't',
        className: 'iw-float-textarea',
        rows: 2,
        value: draft,
        placeholder: binding === null ? tr('floatNoSession') : tr('floatPlaceholder'),
        disabled: binding === null,
        onChange: (event) => setDraft(event.target.value),
        onPaste,
        onKeyDown: (event) => {
          if (event.key === 'Enter' && event.shiftKey !== true) {
            event.preventDefault()
            void submit()
          }
        },
      }),
      h('div', { key: 'foot', className: 'iw-float-foot' }, [
        h('button', {
          key: 'plus',
          type: 'button',
          className: 'iw-float-icon iw-float-plus',
          title: tr('floatAttach'),
          'aria-label': tr('floatAttach'),
          onClick: () => setMenu(menu === 'attach' ? '' : 'attach'),
        }, '+'),
        h('button', {
          key: 'perm',
          type: 'button',
          className: 'iw-float-chip iw-float-perm',
          title: `${tr('floatPermission')}: ${ideFloatPermissionLabel(permission, tr)}`,
          onClick: () => setMenu(menu === 'perm' ? '' : 'perm'),
        }, ideFloatPermissionLabel(permission, tr)),
        h('span', { key: 'gap', className: 'iw-float-gap' }),
        running
          ? h('button', {
            key: 'stop',
            type: 'button',
            className: 'iw-float-send iw-float-stop',
            onClick: () => { void stop() },
          }, tr('floatStop'))
          : h('button', {
            key: 'send',
            type: 'button',
            className: 'iw-float-send',
            // A prompt may be images (or references) only.
            disabled: binding === null || sending || (draft.trim() === '' && refs.length === 0 && images.length === 0),
            onClick: () => { void submit() },
          }, sending ? tr('floatSending') : tr('floatSend')),
      ]),
    ]),
    h('div', { key: 'grip-n', className: 'iw-float-grip iw-float-grip-n', onPointerDown: onGripDown('n') }),
    h('div', { key: 'grip-s', className: 'iw-float-grip iw-float-grip-s', onPointerDown: onGripDown('s') }),
    h('div', { key: 'grip-w', className: 'iw-float-grip iw-float-grip-w', onPointerDown: onGripDown('w') }),
    h('div', { key: 'grip-e', className: 'iw-float-grip iw-float-grip-e', onPointerDown: onGripDown('e') }),
    h('div', {
      key: 'resize',
      className: 'iw-float-resize',
      title: tr('floatResize'),
      onPointerDown: onGripDown('se'),
    }),
  ])
}

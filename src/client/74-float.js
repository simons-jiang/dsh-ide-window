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
/** How long after `compositionend` an Enter still counts as "confirm the IME". */
const IDE_FLOAT_IME_SETTLE_MS = 80
/** Collapsed card: a 44px ball plus the 4px padding the shell adds. */
const IDE_FLOAT_BALL = 52
/** Gap between the collapsed ball and the window corner. */
const IDE_FLOAT_BALL_INSET = 20
/** Re-ask delays after a turn, while its summary is still being recorded. */
// A turn's summary is written after the reply lands, and a long turn can take
// tens of seconds to get there: keep asking instead of showing an older turn.
/** DSH's own body size: the card reads at the same measure as the chat. */
const IDE_FLOAT_FONT_SIZE = 14

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

/** `HH:MM` for a user row, the way the conversation stamps its bubble. */
function ideFloatClock(time) {
  if (!Number.isFinite(time) || time <= 0) return ''
  const date = new Date(time)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * One transcript row: a right-aligned bubble for the user with a clock and a
 * copy button underneath, plain full-width markdown for the assistant.
 */
function ideFloatRow(row, tr, io) {
  const { setViewing, store, pictures } = io
  // A Tool batch: 「执行了命令」, or 「正在运行命令 · <描述>」 while it is the open one.
  if (row.role === 'step') {
    const live = row.open === true && io.running === true
    const last = row.names === undefined || row.names.length === 0 ? '' : row.names[row.names.length - 1]
    const running = last === '' ? '' : `${tr(ideFloatProgressKey(last))}${row.detail === '' ? '' : ` · ${row.detail}`}`
    const text = live && running !== '' ? running : ideFloatStepTitle(row.kinds ?? [], tr)
    return h('div', { key: row.key, className: `iw-float-step${live ? ' live' : ''}` }, [
      h('span', { key: 'i', className: 'iw-float-step-icon' }, h(IdeTerminalIcon, { size: 15 })),
      h('span', { key: 't', className: 'iw-float-step-text', title: text }, text),
    ])
  }
  // Questions cannot be answered here: DSH only accepts the answer in the
  // Conversation, so the card's button navigates there instead.
  const goToChat = typeof io.goToChat === 'function' ? io.goToChat : () => {}
  if (row.role === 'files') {
    return h('div', { key: row.key, className: 'iw-float-row iw-float-files' }, [
      h('span', { key: 'who', className: 'iw-float-who' }, tr('floatFiles')),
      h('div', { key: 'list', className: 'iw-float-filelist' }, (row.files ?? []).map((file) => h('button', {
        key: file.path,
        type: 'button',
        className: 'iw-float-file',
        title: file.path,
        onClick: () => {
          // Same entry point as the conversation's file cards: open the file in
          // the workspace and switch the panel to it.
          const opened = typeof openInWorkspace === 'function'
            ? openInWorkspace(file.path) === true
            : store.openAt(file.path) === true
          if (opened !== true) store.setNotice(`${tr('floatOpenFailed')}: ${file.path}`)
        },
      }, [
        h('span', { key: 'n', className: 'iw-float-file-name' }, ideBasename(file.path)),
        file.description === '' ? null : h('span', { key: 'd', className: 'iw-float-file-desc' }, file.description),
      ]))),
    ])
  }
  // Shaped like the conversation: the user side is a right-aligned bubble with
  // a clock and a copy button under it, the assistant side is plain full-width
  // markdown. No "you"/"assistant" captions.
  const body = row.text === '' ? null : h(IdeFloatMarkdown, { key: 'text', text: row.text, tr })
  const pics = row.images === undefined || row.images.length === 0 ? null : h('div', { key: 'pics', className: 'iw-float-pics' }, row.images.map((image, index) => {
    const url = pictures[image.attachmentId] ?? ''
    if (url === '') return h('div', { key: `pic${index}`, className: 'iw-float-pic iw-float-pic-wait' })
    return h('img', {
      key: `pic${index}`,
      className: 'iw-float-pic',
      src: url,
      alt: image.name ?? '',
      title: tr('floatPreviewImage'),
      draggable: false,
      // Right-clicking here offers the app's own "Copy", which pastes the file
      // name instead of the picture.
      onContextMenu: (event) => event.preventDefault(),
      onClick: () => setViewing({ url, name: image.name ?? '' }),
    })
  }))
  if (row.role === 'question') {
    const picked = Array.isArray(row.answers) ? row.answers : []
    // Answered: the compact bubble the conversation leaves behind. Open: the
    // full card, so the question is readable without leaving the workspace.
    if (picked.length > 0) {
      return h('div', { key: row.key, className: 'iw-float-row iw-float-user' }, [
        h('div', { key: 'bubble', className: 'iw-float-bubble iw-float-question' }, [
          row.header === '' ? null : h('div', { key: 'h', className: 'iw-float-q-head' }, row.header),
          h('div', { key: 'q', className: 'iw-float-q-ask' }, row.question),
          h('div', { key: 'a', className: 'iw-float-q-answer' }, picked.join('、')),
        ]),
      ])
    }
    const options = Array.isArray(row.options) ? row.options : []
    return h('div', { key: row.key, className: 'iw-float-row' }, [
      h('div', { key: 'card', className: 'iw-float-ask' }, [
        h('div', { key: 'head', className: 'iw-float-ask-head' }, [
          row.header === '' ? null : h('div', { key: 'e', className: 'iw-float-ask-eyebrow' }, row.header),
          h('div', { key: 't', className: 'iw-float-ask-title' }, row.question),
        ]),
        options.length === 0 ? null : h('div', { key: 'o', className: 'iw-float-ask-options' },
          options.map((option, index) => h('div', {
            key: `o${index}`,
            className: 'iw-float-ask-option',
          }, [
            h('span', { key: 'n', className: 'iw-float-ask-index' }, String(index + 1)),
            h('span', { key: 'l', className: 'iw-float-ask-label' }, option.label),
            option.description === ''
              ? null
              : h('span', { key: 'd', className: 'iw-float-ask-desc' }, option.description),
          ]))),
        h('div', { key: 'foot', className: 'iw-float-ask-foot' }, [
          h('span', { key: 'hint', className: 'iw-float-ask-hint' }, tr('floatQuestionHint')),
          h('button', {
            key: 'go',
            type: 'button',
            className: 'iw-btn primary iw-float-ask-go',
            onClick: () => { goToChat() },
          }, tr('floatQuestionGo')),
        ]),
      ]),
    ])
  }
  if (row.role === 'user') {
    const clock = ideFloatClock(row.time)
    return h('div', { key: row.key, className: 'iw-float-row iw-float-user' }, [
      h('div', { key: 'bubble', className: 'iw-float-bubble' }, [body, pics].filter((part) => part !== null)),
      h('div', { key: 'meta', className: 'iw-float-meta' }, [
        clock === '' ? null : h('span', { key: 'clock', className: 'iw-float-clock' }, clock),
        row.text === '' ? null : h('button', {
          key: 'copy',
          type: 'button',
          className: 'iw-float-copy',
          title: tr('floatCopyMessage'),
          onClick: () => { ideCopyWithNotice(store, tr, row.text) },
        }, h(IdeCopyIcon, { size: 13 })),
      ].filter((part) => part !== null)),
    ])
  }
  return h('div', { key: row.key, className: 'iw-float-row iw-float-assistant' }, [body, pics].filter((part) => part !== null))
}

/**
 * The questions inside an `ask_user_question` call. `arguments` is a JSON string
 * on the wire; anything unparseable yields no rows rather than a broken card.
 */
function ideFloatQuestionsOf(argumentText) {
  let parsed
  try {
    parsed = typeof argumentText === 'string' ? JSON.parse(argumentText) : argumentText
  } catch (error) {
    ideLogRecord('warn', 'float', 'question arguments unreadable', { error: String(error) })
    return []
  }
  const list = Array.isArray(parsed?.questions) ? parsed.questions : []
  return list.map((entry) => ({
    id: String(entry?.id ?? ''),
    header: String(entry?.header ?? ''),
    question: String(entry?.question ?? ''),
    multiSelect: entry?.multiSelect === true || entry?.multi_select === true,
    options: (Array.isArray(entry?.options) ? entry.options : []).map((option) => ({
      label: String(option?.label ?? ''),
      description: String(option?.description ?? ''),
    })).filter((option) => option.label !== ''),
  })).filter((entry) => entry.question !== '')
}

/** Question id → the labels the user picked, read off the tool results. */
function ideFloatAnswers(entries) {
  const answers = new Map()
  if (!Array.isArray(entries)) return answers
  for (const entry of entries) {
    const event = entry?.event
    if (event?.type !== 'tool/result') continue
    const text = ideFloatTextOf(event.data?.message?.content)
    if (!text.includes('answers')) continue
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      continue
    }
    for (const answer of Array.isArray(parsed?.answers) ? parsed.answers : []) {
      const picked = [
        ...(Array.isArray(answer?.selected) ? answer.selected.map(String) : []),
        ...(typeof answer?.custom === 'string' && answer.custom !== '' ? [answer.custom] : []),
      ]
      if (picked.length > 0) answers.set(String(answer?.id ?? ''), picked)
    }
  }
  return answers
}

function ideFloatTranscript(entries, limit = IDE_FLOAT_MESSAGES) {
  if (!Array.isArray(entries)) return []
  const answers = ideFloatAnswers(entries)
  const rows = []
  // Tool calls collapse into one 「执行了命令」 line per batch, in the order they
  // ran — the same shape the conversation uses. The last batch stays `open`
  // until the Session stops, so the card can word it as 「正在运行命令」.
  let batch = { names: [], detail: '', seq: 0, ids: new Set() }
  const flushBatch = () => {
    if (batch.names.length === 0) return
    const kinds = []
    for (const name of batch.names) {
      const kind = ideFloatStepKind(name)
      if (!kinds.includes(kind)) kinds.push(kind)
    }
    rows.push({ key: `s${batch.seq}`, role: 'step', text: '', images: [], kinds, names: batch.names, detail: batch.detail, open: true })
    batch = { names: [], detail: '', seq: 0, ids: new Set() }
  }
  for (const entry of entries) {
    const event = entry?.event
    if (event === null || typeof event !== 'object') continue
    if (event.type === 'tool/call') {
      const name = String(event.data?.name ?? '')
      // The question card is its own row, so it never joins a Tool batch.
      if (name !== '' && name !== 'ask_user_question') {
        // A replayed call can appear twice in the stream; one row per call.
        const callId = String(event.data?.callId ?? '')
        if (callId !== '' && batch.ids.has(callId)) continue
        if (callId !== '') batch.ids.add(callId)
        if (batch.seq === 0) batch.seq = event.seq
        batch.names.push(name)
        const detail = ideFloatCallDetail(name, event.data?.arguments)
        if (detail !== '') batch.detail = detail
        continue
      }
    }
    // Only a row that actually renders closes the batch: step boundaries emit
    // empty assistant messages, and flushing on those would split one batch
    // into a line per call.
    const renders = event.type === 'user/message'
      ? true
      : event.type === 'assistant/message'
        ? event.data?.message?.content?.some?.((part) => part?.type === 'text' ? String(part.text ?? '') !== '' : part?.type === 'image') === true
        : event.type === 'deliverables/presented' || (event.type === 'tool/call' && event.data?.name === 'ask_user_question')
    if (renders) flushBatch()
    if (event.type === 'user/message') {
      // Context injections share the event type; only a human prompt is a row.
      if (event.data?.source?.kind !== 'user') continue
      const content = event.data?.content
      const text = ideFloatTextOf(content)
      // A prompt can be images only, so a row exists when either part exists.
      const images = ideFloatImagesOf(content)
      if (text !== '' || images.length > 0) {
        rows.push({ key: `u${event.seq}`, role: 'user', text, images, time: Number(event.time ?? 0) })
      }
      continue
    }
    if (event.type === 'assistant/message') {
      const content = event.data?.message?.content
      const text = ideFloatTextOf(content)
      const images = ideFloatImagesOf(content)
      if (text !== '' || images.length > 0) {
        rows.push({ key: `a${event.seq}`, role: 'assistant', text, images, time: Number(event.time ?? 0) })
      }
      continue
    }
    // The conversation's own question card: `ask_user_question` is a tool call,
    // and its answer comes back as the tool result with matching ids.
    if (event.type === 'tool/call' && event.data?.name === 'ask_user_question') {
      const questions = ideFloatQuestionsOf(event.data?.arguments)
      questions.forEach((question, index) => {
        const picked = answers.get(String(question.id)) ?? []
        rows.push({
          key: `q${event.seq}:${index}`,
          role: 'question',
          text: '',
          images: [],
          time: Number(event.time ?? 0),
          header: question.header,
          question: question.question,
          options: question.options,
          multiSelect: question.multiSelect,
          answers: picked,
          pending: picked.length === 0,
        })
      })
      continue
    }
    if (event.type === 'deliverables/presented') {
      const files = ideFloatPresentedFilesOf(event.data)
      if (files.length > 0) rows.push({ key: `p${event.seq}`, role: 'files', text: '', images: [], files })
    }
  }
  flushBatch()
  for (const row of rows) if (row.role === 'step') row.open = row === rows[rows.length - 1]
  return rows.slice(-limit)
}

/**
 * The label of a permission preset id.
 *
 * The session log carries `permission/preset` events; the id is the sandbox mode
 * (`read-only` / `workspace-write` / `danger-full-access`). Unknown ids are shown
 * verbatim rather than guessed.
 */
/** How a Tool call reads in the card's progress line. */
const IDE_FLOAT_ACTIVITY = [
  { pattern: /^(bash|shell|terminal)$/u, key: 'floatActivityCommand', progressKey: 'floatProgressCommand' },
  { pattern: /^grep$/u, key: 'floatActivitySearch', progressKey: 'floatProgressSearch' },
  { pattern: /^read$/u, key: 'floatActivityRead', progressKey: 'floatProgressRead' },
  { pattern: /^(write|edit|patch)$/u, key: 'floatActivityWrite', progressKey: 'floatProgressWrite' },
  { pattern: /^(web_search|web_fetch)$/u, key: 'floatActivityWeb', progressKey: 'floatProgressWeb' },
  { pattern: /^ask_user_question$/u, key: 'floatActivityAsk', progressKey: 'floatProgressAsk' },
  { pattern: /^(todo_write|task|workflow)$/u, key: 'floatActivityTask', progressKey: 'floatProgressTask' },
]

/** The progress wording for a Tool name, falling back to the generic line. */
function ideFloatProgressKey(name) {
  const entry = IDE_FLOAT_ACTIVITY.find((item) => item.pattern.test(String(name ?? '')))
  return entry === undefined ? 'floatProgressTool' : entry.progressKey
}

/**
 * What the current turn has done so far: the Tool calls since the newest human
 * prompt, newest first, plus a one-line detail of the newest one. Pure so the
 * progress line is testable without a Session.
 */
function ideFloatActivityOf(entries) {
  const names = new Set()
  let detail = ''
  let current = ''
  if (!Array.isArray(entries)) return { names: [], detail, current }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const event = entries[index]?.event
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') break
    if (event?.type !== 'tool/call') continue
    const name = String(event.data?.name ?? '')
    if (name === '') continue
    if (detail === '') {
      detail = ideFloatCallDetail(name, event.data?.arguments)
      current = name
    }
    names.add(name)
  }
  return { names: [...names].reverse(), detail, current }
}

/** The one line under the progress label: what the newest call is doing. */
function ideFloatCallDetail(name, argumentText) {
  let args
  try {
    args = typeof argumentText === 'string' ? JSON.parse(argumentText) : argumentText
  } catch (error) {
    return ''
  }
  const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim().replace(/\s+/gu, ' ') : '')
  // bash carries a human `description` ("Push to origin main"); the raw command
  // is the fallback when the model wrote none.
  if (/^(bash|shell|terminal)$/u.test(name)) return text(args?.description) || text(args?.command)
  if (/^(read|write|edit|patch)$/u.test(name)) return text(args?.file_path ?? args?.path)
  if (name === 'grep') return text(args?.pattern ?? args?.query)
  if (name === 'web_search') return Array.isArray(args?.queries) ? text(args.queries[0]) : ''
  return ''
}

/** `用时 2 分 26 秒` / `用时 26 秒`, the way the conversation's footer reads. */
function ideFloatElapsed(ms, translate) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0
    ? tr('floatElapsedMin').replace('{m}', String(minutes)).replace('{s}', String(rest))
    : tr('floatElapsedSec').replace('{s}', String(rest))
}

/**
 * The `/` or `@` token the caret sits in, or null. A token starts after
 * whitespace and runs to the caret without spaces, exactly like the command
 * trigger in the conversation composer.
 */
function ideFloatTrigger(text, caret) {
  const head = String(text ?? '').slice(0, Math.max(0, Number(caret) || 0))
  const match = /(^|\s)([/@][^\s]*)$/u.exec(head)
  if (match === null) return null
  const token = match[2]
  return {
    sign: token[0],
    body: token.slice(1),
    start: head.length - token.length,
    end: Math.max(0, Number(caret) || 0),
  }
}

/** `@a/b/c` → the directory to list and the prefix to match inside it. */
function ideFloatMentionQuery(body) {
  const text = String(body ?? '')
  const slash = text.lastIndexOf('/')
  return slash < 0
    ? { dir: '', query: text }
    : { dir: text.slice(0, slash), query: text.slice(slash + 1) }
}

/**
 * One `workspaceFiles.list` entry. The Host answers with `{name, type}` relative
 * to the directory that was listed, so the caller's directory makes the path.
 */
function ideFloatEntryOf(raw, dir) {
  if (raw === null || typeof raw !== 'object') return null
  const name = String(raw.name ?? raw.path ?? '')
  if (name === '') return null
  const kind = String(raw.kind ?? raw.type ?? '')
  const isDir = raw.isDirectory === true || kind === 'directory' || kind === 'dir' || kind === 'folder'
  const prefix = String(dir ?? '').replace(/\/+$/, '')
  const path = prefix === '' ? name : `${prefix}/${name}`
  return { path, name, isDir }
}

/**
 * The `/` menu, in the conversation's own order. `action` rows are composer
 * features (insert an `@`, open the model picker); the rest are Host commands.
 */
/**
 * Commands whose visible half lives in the Conversation (a goal dialog, a plan
 * banner, the compact divider). Running them from the card and staying put
 * looks like nothing happened, so picking one also navigates back.
 */
const IDE_FLOAT_CHAT_COMMANDS = new Set(['goal', 'plan', 'feedback'])
/** Host commands the card runs itself; the rest belong to the Conversation UI. */
const IDE_FLOAT_HOST_COMMANDS = new Set(['compact', 'export', 'permission'])

const IDE_FLOAT_SLASH = [
  { name: 'file', labelKey: 'floatCmdFile', section: 'add', action: 'mention' },
  { name: 'goal', labelKey: 'floatCmdGoal', descKey: 'floatCmdGoalDesc', section: 'add' },
  { name: 'plan', labelKey: 'floatCmdPlan', descKey: 'floatCmdPlanDesc', section: 'add' },
  { name: 'feedback', labelKey: 'floatCmdFeedback', descKey: 'floatCmdFeedbackDesc', section: 'add' },
  { name: 'compact', labelKey: 'floatCmdCompact', descKey: 'floatCmdCompactDesc', section: 'command' },
  { name: 'permission', labelKey: 'floatCmdPermission', descKey: 'floatCmdPermissionDesc', section: 'command' },
  { name: 'model', labelKey: 'floatCmdModel', descKey: 'floatCmdModelDesc', section: 'command', action: 'model' },
  { name: 'export', labelKey: 'floatCmdExport', descKey: 'floatCmdExportDesc', section: 'command' },
]

/**
 * The `/` menu rows: the fixed builtins (localized the way the conversation
 * shows them), then anything else the Host registered, then the Skills. Pure so
 * ordering and filtering are testable.
 */
function ideFloatSlashItems(catalog, skills, query, translate) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const needle = String(query ?? '').toLowerCase()
  const names = new Set((Array.isArray(catalog) ? catalog : []).map((raw) => String(raw?.name ?? '')))
  const items = []
  for (const entry of IDE_FLOAT_SLASH) {
    if (entry.action === undefined && !names.has(entry.name)) continue
    const label = tr(entry.labelKey)
    const description = entry.descKey === undefined ? '' : tr(entry.descKey)
    if (needle !== '' && !`${entry.name} ${label}`.toLowerCase().includes(needle)) continue
    items.push({
      kind: entry.action === undefined ? 'command' : entry.action,
      id: entry.name,
      label,
      alias: entry.name,
      description,
      section: entry.section,
      icon: entry.name,
    })
  }
  const builtin = new Set(IDE_FLOAT_SLASH.map((entry) => entry.name))
  for (const raw of Array.isArray(catalog) ? catalog : []) {
    const name = String(raw?.name ?? '')
    if (name === '' || builtin.has(name)) continue
    if (needle !== '' && !name.toLowerCase().includes(needle)) continue
    items.push({ kind: 'command', id: name, label: name, alias: '', description: String(raw?.description ?? ''), section: 'command', icon: 'command' })
  }
  for (const raw of Array.isArray(skills) ? skills : []) {
    const name = String(raw?.name ?? '')
    if (name === '' || (needle !== '' && !name.toLowerCase().includes(needle))) continue
    items.push({ kind: 'skill', id: name, label: name, alias: '', description: String(raw?.description ?? ''), section: 'skill', icon: 'skill' })
  }
  return items
}

/** The section title key for a row's section, or '' when it has none. */
function ideFloatSectionKey(section) {
  if (section === 'add') return 'floatMenuAdd'
  if (section === 'command') return 'floatMenuCommands'
  if (section === 'skill') return 'floatMenuSkills'
  if (section === 'file') return 'floatMenuFiles'
  if (section === 'chat') return 'floatMenuChats'
  return ''
}

/** Which step kind a Tool belongs to; drives the 「执行了命令」 wording. */
function ideFloatStepKind(name) {
  const tool = String(name ?? '')
  if (/^(bash|shell|terminal)$/u.test(tool)) return 'commands'
  if (tool === 'read') return 'read'
  if (/^(write|edit|patch)$/u.test(tool)) return 'write'
  if (tool === 'grep') return 'search'
  if (/^(web_search|web_fetch)$/u.test(tool)) return 'web'
  if (tool === 'ask_user_question') return 'questions'
  if (/^(todo_write|task|workflow)$/u.test(tool)) return 'plan'
  return 'tools'
}

/**
 * One finished tool batch, worded the way the conversation words it:
 * 「执行了命令」 / 「执行了命令并搜索了代码」 / 「执行了命令，搜索了代码等」.
 * Labels come from this plugin's locale because the Host's catalogue only
 * carries names and descriptions.
 */
function ideFloatStepTitle(kinds, translate) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const list = Array.isArray(kinds) ? kinds : []
  const labels = list.slice(0, 3).map((kind) => tr(`floatStepDone.${kind}`))
  const first = labels[0]
  if (first === undefined) return tr('floatStepDone.tools')
  const shared = tr('floatStepSharedPrefix')
  const strip = (label) => (shared !== '' && label.startsWith(shared) ? label.slice(shared.length) : label)
  const second = labels[1]
  if (second === undefined) return first
  if (labels.length === 2) return tr('floatStepJoinTwo').replace('{first}', first).replace('{second}', strip(second))
  const title = [first, ...labels.slice(1).map(strip)].join(tr('floatStepComma'))
  return list.length > 3 ? tr('floatStepMore').replace('{title}', title) : title
}

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

/**
 * One fenced code block, shaped like the conversation's: a quiet header with the
 * block name on the left and the wrap/copy controls on the right.
 */
function IdeFloatCodeBlock({ code, lang, tr }) {
  const [copied, setCopied] = useState(false)
  // Long lines are readable in a narrow card only when they wrap, so that is
  // the default and the header offers the switch.
  const [wrap, setWrap] = useState(true)
  const language = ideLangOf(`x.${String(lang ?? '').trim()}`) || ''
  const lines = useMemo(() => String(code ?? '').split('\n'), [code])
  const copy = () => {
    if (ideCopyToClipboard(String(code ?? '')) !== true) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return h('div', { className: 'iw-float-md-codeblock' }, [
    h('div', { key: 'head', className: 'iw-float-md-codehead' }, [
      // An unlabelled or plain-text fence is just "代码块", as DSH calls it.
      h('span', {
        key: 'lang',
        className: 'iw-float-md-codelang',
      }, language === '' || language === 'txt' ? tr('floatCode') : ideLangLabel(language) || tr('floatCode')),
      h('span', { key: 'acts', className: 'iw-float-md-codeacts' }, [
        h('button', {
          key: 'wrap',
          type: 'button',
          className: `iw-float-md-codeact${wrap ? ' on' : ''}`,
          title: tr('floatWrap'),
          onClick: () => setWrap(!wrap),
        }, h(IdeWrapIcon, { size: 14 })),
        h('button', {
          key: 'copy',
          type: 'button',
          className: 'iw-float-md-codeact',
          title: copied ? tr('floatCopied') : tr('floatCopy'),
          onClick: copy,
        }, h(IdeCopyIcon, { size: 14 })),
      ]),
    ]),
    h('pre', {
      key: 'pre',
      className: `iw-float-md-pre${wrap ? ' iw-float-md-wrapped' : ''}`,
    }, lines.map((line, lineIndex) => h('div', {
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
function IdeFloatingAsk({ store, sessions, modelDirectories, translate, openSession, startSession, useWorkspaces, openInWorkspace, goToChat, composeText, commandList, workspaceList, skillList }) {
  const tr = typeof translate === 'function' ? translate : (key) => key
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [binding, setBinding] = useState(null)
  const bodyRef = useRef(null)
  // Whether the transcript should follow the newest line.
  const stickRef = useRef(true)
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
  // The `/` and `@` menus: the same Host catalog and the same directory listing
  // the conversation's composer offers, so the two never disagree.
  const [suggest, setSuggest] = useState(null)
  const rawEntries = useRef([])
  const suggestSeq = useRef(0)
  const commandCache = useRef(null)
  const skillCache = useRef(null)
  const [plusItems, setPlusItems] = useState([])
  const directoryCache = useRef(new Map())
  const [pictures, setPictures] = useState({})
  // The picture the user is looking at.
  const [viewing, setViewing] = useState(null)
  const picturesRef = useRef({})
  picturesRef.current = pictures
  const [projectedPreset, setProjectedPreset] = useState('')
  const cardRef = useRef(null)
  const titleBtnRef = useRef(null)
  const permChipRef = useRef(null)
  const modelChipRef = useRef(null)
  const effortChipRef = useRef(null)
  // Where a popup opens: measured from the trigger, so a menu never lands at the
  // top of the card the way a flex child did.
  const [popup, setPopup] = useState(null)
  // An Enter that confirms an IME candidate must only commit the text, never
  // send: the conversation's composer behaves the same way. Some IMEs fire
  // `compositionend` just before that keydown, so the timestamp covers them.
  const composingRef = useRef(false)
  const composedAtRef = useRef(0)
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

  // Coming back into view (conversation → code workspace) shows the newest line
  // again, even if the user had scrolled up before leaving.
  useEffect(() => {
    if (state.floatOpen !== true) return
    stickRef.current = true
  }, [state.floatOpen])

  // The transcript shows the newest line: on mount, when it comes back into
  // view, and after every new message. `stickRef` follows the user, so reading
  // older content is not yanked back; sending forces the jump.
  useEffect(() => {
    const element = bodyRef.current
    if (element === null || element === undefined || stickRef.current !== true) return undefined
    const toBottom = () => { element.scrollTop = element.scrollHeight }
    toBottom()
    // A picture or a code block grows the transcript after it lays out, which
    // leaves the earlier position short of the real bottom.
    const timers = [60, 200, 600].map((delay) => globalThis.setTimeout(toBottom, delay))
    return () => {
      for (const timer of timers) globalThis.clearTimeout(timer)
    }
  })

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
    const read = () => {
      const raw = source.getSnapshot()?.entries
      // The transcript drops Tool calls; the progress line needs them.
      rawEntries.current = Array.isArray(raw) ? raw : []
      setEntries(ideFloatTranscript(raw))
    }
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

  // Menus are positioned from their trigger every time one opens: the card is
  // resizable and the chips sit at its bottom, so a static offset drifts.
  useLayoutEffect(() => {
    if (menu === '') { setPopup(null); return }
    const card = cardRef.current
    const chip = menu === 'sessions'
      ? titleBtnRef.current
      : (menu === 'model' ? modelChipRef.current : (menu === 'effort' ? effortChipRef.current : null))
    const perm = menu === 'perm' ? permChipRef.current : chip
    const trigger = perm ?? card
    if (card === null || trigger === null) return
    const outer = card.getBoundingClientRect()
    const inner = trigger.getBoundingClientRect()
    setPopup(menu === 'sessions'
      ? { left: Math.round(inner.left - outer.left), top: Math.round(inner.bottom - outer.top + 6) }
      : { right: Math.round(outer.right - inner.right), bottom: Math.round(outer.bottom - inner.top + 6) })
  }, [menu])

  const permission = projectedPreset !== '' ? projectedPreset : (preset !== '' ? preset : ideFloatPermissionOf(entries))

  /**
   * The three popups hang off their own trigger (the title, the permission chip,
   * the model chip). Before, they were flex children of the card, so a menu
   * opened at the top of the card — nowhere near the control that opened it.
   */
  const renderSessionsMenu = () => (menu !== 'sessions' || popup === null
    ? null
    : h('div', {
      key: 'sessions',
      className: 'iw-float-menu iw-float-sessions',
      ref: menuRef,
      style: { left: `${popup.left ?? 0}px`, top: `${popup.top ?? 0}px`, right: 'auto', bottom: 'auto' },
    }, [
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
          h('div', { key: 'head', className: 'iw-float-group-head', title: group.cwd }, [
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
    ]))

  const renderEffortMenu = () => (menu !== 'effort' || popup === null
    ? null
    : h('div', {
      key: 'efforts',
      className: 'iw-float-menu',
      style: { right: `${popup.right ?? 0}px`, bottom: `${popup.bottom ?? 0}px`, left: 'auto', top: 'auto', minWidth: '140px' },
    }, [
      h('div', { key: 'head', className: 'iw-float-menu-head' }, tr('floatEffort')),
      ...[{ id: '', label: tr('floatEffortDefault') }, ...efforts].map((entry) => h('button', {
        key: `e:${entry.id}`,
        type: 'button',
        className: `iw-float-menu-item${entry.id === (effort ?? '') ? ' on' : ''}`,
        onClick: () => { void chooseEffort(entry.id) },
      }, entry.label)),
    ]))

  const renderPermissionMenu = () => (menu !== 'perm' || popup === null
    ? null
    : h('div', {
      key: 'permmenu',
      className: 'iw-float-menu',
      style: { right: `${popup.right ?? 0}px`, bottom: `${popup.bottom ?? 0}px`, left: 'auto', top: 'auto', minWidth: '160px' },
    },
      IDE_FLOAT_PERMISSIONS.map((entry) => h('button', {
        key: entry.id,
        type: 'button',
        className: `iw-float-menu-item${entry.id === permission ? ' on' : ''}`,
        onClick: () => { void choosePermission(entry.id) },
      }, tr(entry.labelKey)))))

  const renderModelMenu = () => (menu !== 'model' || popup === null
    ? null
    : h('div', {
      key: 'models',
      className: 'iw-float-menu',
      style: { right: `${popup.right ?? 0}px`, bottom: `${popup.bottom ?? 0}px`, left: 'auto', top: 'auto', minWidth: '240px' },
    }, options.length === 0
      ? h('div', { key: 'none', className: 'iw-float-menu-empty' }, tr('floatModelEmpty'))
      : options.map((option) => h('button', {
        key: option.key,
        type: 'button',
        className: `iw-float-menu-item${option.model === models?.current?.model ? ' on' : ''}`,
        onClick: () => { void chooseModel(option) },
      }, [
        h('span', { key: 'l', className: 'iw-float-menu-label' }, option.label),
        h('span', { key: 'g', className: 'iw-float-menu-group' }, option.group),
      ]))))

  // `/` and `@` suggestions, recomputed whenever the draft changes. The lists
  // come from the Host (`commands.list` / `workspaceFiles.list`), which is the
  // same pair the conversation composer reads.
  useEffect(() => {
    // The `+` button opens the same catalogue as typing `/`: DSH words its
    // tooltip 「添加文件或调用指令」 for exactly that reason. No cancellation on
    // re-render here — the io callbacks arrive as fresh closures, so cancelling
    // would keep losing the race with the fetch.
    if (menu !== 'attach') return
    // An empty Session has no catalogue yet: the Host waits for one, so fall
    // back to the rows the card can offer on its own instead of hanging.
    if (sessionId === '' || sessionId === undefined) {
      setPlusItems(ideFloatSlashItems([], [], '', tr))
      return
    }
    const load = async () => {
      if (commandCache.current === null) {
        const result = typeof commandList === 'function' ? await commandList(sessionId) : { value: [] }
        if (result?.error !== undefined) {
          store.setNotice(`${tr('floatSuggestFailed')}: ${String(result.error)}`)
          return
        }
        commandCache.current = Array.isArray(result?.value) ? result.value : []
      }
      if (skillCache.current === null) {
        const result = typeof skillList === 'function' ? await skillList(sessionId) : { value: [] }
        skillCache.current = result?.error === undefined && Array.isArray(result?.value) ? result.value : []
      }
      setPlusItems(ideFloatSlashItems(commandCache.current, skillCache.current, '', tr))
    }
    void load().catch((error) => store.setNotice(`${tr('floatSuggestFailed')}: ${error?.message ?? error}`))
  }, [menu, sessionId])

  useEffect(() => {
    if (binding === null || sessionId === '') { setSuggest(null); return }
    const token = ideFloatTrigger(draft, draft.length)
    if (token === null) { setSuggest(null); return }
    const seq = suggestSeq.current + 1
    suggestSeq.current = seq
    const fresh = () => suggestSeq.current === seq
    if (token.sign === '/') {
      const run = async () => {
        let catalog = commandCache.current
        if (catalog === null) {
          const result = typeof commandList === 'function' ? await commandList(sessionId) : { value: [] }
          if (!fresh()) return
          if (result?.error !== undefined) {
            store.setNotice(`${tr('floatSuggestFailed')}: ${String(result.error)}`)
            setSuggest(null)
            return
          }
          catalog = Array.isArray(result?.value) ? result.value : []
          commandCache.current = catalog
        }
        let skills = skillCache.current
        if (skills === null) {
          const result = typeof skillList === 'function' ? await skillList(sessionId) : { value: [] }
          if (!fresh()) return
          skills = result?.error === undefined && Array.isArray(result?.value) ? result.value : []
          skillCache.current = skills
        }
        if (!fresh()) return
        const items = ideFloatSlashItems(catalog, skills, token.body, tr)
        setSuggest({ sign: '/', token, items, index: 0, dir: '' })
      }
      void run()
      return
    }
    const { dir, query } = ideFloatMentionQuery(token.body)
    const run = async () => {
      let entries = directoryCache.current.get(dir)
      if (entries === undefined) {
        // Paths are relative to the Session's workspace root, and `.` is that
        // root: an empty string is refused with "path is required".
        const result = typeof workspaceList === 'function'
          ? await workspaceList(sessionId, dir === '' ? '.' : dir)
          : { value: [] }
        if (!fresh()) return
        if (result?.error !== undefined) {
          store.setNotice(`${tr('floatSuggestFailed')}: ${String(result.error)}`)
          setSuggest(null)
          return
        }
        entries = (Array.isArray(result?.value) ? result.value : [])
          .map((raw) => ideFloatEntryOf(raw, dir))
          .filter((entry) => entry !== null)
        directoryCache.current.set(dir, entries)
      }
      if (!fresh()) return
      const needle = query.toLowerCase()
      const files = entries
        .filter((entry) => needle === '' || entry.name.toLowerCase().includes(needle))
        .sort((left, right) => (left.isDir === right.isDir ? left.name.localeCompare(right.name) : left.isDir ? -1 : 1))
        .slice(0, 40)
        .map((entry) => ({ kind: entry.isDir ? 'dir' : 'file', id: entry.path, label: entry.name, alias: '', description: '', section: 'file', icon: entry.isDir ? 'folder' : 'file' }))
      // The conversation's `@` list also offers other conversations.
      const chats = sessionRows
        .filter((row) => row.sessionId !== sessionId)
        .filter((row) => needle === '' || String(row.title ?? '').toLowerCase().includes(needle))
        .slice(0, 8)
        .map((row) => ({ kind: 'session', id: row.sessionId, label: row.title, alias: '', description: '', section: 'chat', icon: 'chat' }))
      setSuggest({ sign: '@', token, items: [...files, ...chats], index: 0, dir })
    }
    void run()
  }, [draft, binding, sessionId, commandList, workspaceList, skillList, sessionRows])

  // Pick one suggestion: a command runs through the Session's own command line,
  // a file becomes a reference chip — both exactly what the conversation does.
  const pickSuggest = (item) => {
    if (item === undefined) return
    const token = ideFloatTrigger(draft, draft.length)
    const cut = token === null ? draft : `${draft.slice(0, token.start)}${draft.slice(token.end)}`
    setDraft(cut)
    setSuggest(null)
    if (item.kind === 'mention') {
      // The conversation's 「文件」 row opens the `@` list rather than sending.
      setDraft(`${cut}@`)
      return
    }
    if (item.kind === 'model') {
      setMenu('model')
      return
    }
    if (item.kind === 'dir') {
      // Drill in: keep the trigger, append the directory and a slash.
      setDraft(`${cut}@${item.id}/`)
      return
    }
    if (item.kind === 'file') {
      const ref = `@${item.id}`
      setRefs((current) => (current.includes(ref) ? current : [...current, ref]))
      return
    }
    if (item.kind === 'session') {
      // A conversation reference is a navigation, not text: switch this card to
      // that Session the same way the header switcher does.
      if (typeof openSession === 'function') openSession(item.id)
      return
    }
    if (item.kind === 'skill') {
      // A Skill is invoked by name in the prompt; leave the caret after it.
      setDraft(`${cut}/${item.id} `)
      return
    }
    // `/goal`, `/plan` and `/feedback` open DSH's own dialogs: fill the
    // Conversation's composer so its palette takes over.
    if (IDE_FLOAT_CHAT_COMMANDS.has(item.id) && typeof composeText === 'function') {
      Promise.resolve(composeText(`/${item.id}`)).catch((error) => {
        store.setNotice(`${tr('floatCommandFailed')}: ${error?.message ?? error}`)
      })
      return
    }
    const command = binding?.session?.command
    if (typeof command !== 'function') return
    // A dialog-driven command (`/goal`, `/plan`) stays pending until the user
    // closes its UI, so this must not wait on the promise: run it, land on the
    // Conversation where its half lives, and only report an outright rejection.
    Promise.resolve(command(`/${item.id}`)).then((result) => {
      if (result?.ok === false || result?.value?.matched === false) {
        store.setNotice(`${tr('floatCommandFailed')}: ${item.id}`)
      }
    }).catch((error) => {
      store.setNotice(`${tr('floatCommandFailed')}: ${error?.message ?? error}`)
    })
  }

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

  // Esc leaves the picture viewer before anything else.
  useEffect(() => {
    if (viewing === null || typeof globalThis.addEventListener !== 'function') return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setViewing(null)
      }
    }
    globalThis.addEventListener('keydown', onKey, true)
    return () => globalThis.removeEventListener('keydown', onKey, true)
  }, [viewing])

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

  const running = binding !== null && binding.session.getSnapshot()?.running === true
  // The elapsed clock only runs while the Session is working; a fresh turn
  // starts it again, so `用时` always means this turn.
  const [, setClockTick] = useState(0)
  useEffect(() => {
    if (running !== true) return undefined
    // Bumping a counter is what re-renders once a second; setting the same
    // timestamp again would be a no-op React bails out of.
    const timer = globalThis.setInterval(() => setClockTick((tick) => tick + 1), 1000)
    return () => globalThis.clearInterval(timer)
  }, [running])
  // The timer counts this turn, so it starts at the prompt — not at the moment
  // the card happened to notice the Session became busy.
  const turnStart = (() => {
    const raw = rawEntries.current
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const event = raw[index]?.event
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user') return Number(event.time ?? 0)
    }
    return 0
  })()

  if (!open) return null

  // The header names the conversation, not the folder: that is what the menu
  // switches. The workspace stays available in the tooltip and the empty state.
  const currentRow = sessionRows.find((row) => row.sessionId === sessionId)
  const sessionGroups = ideFloatSessionGroups(sessionRows, state.rootPath ?? '')
  const workspace = ideBasename(state.rootPath ?? '') || tr('floatNoWorkspace')
  const sessionTitle = currentRow?.title
    ?? (workspace === '' || workspace === tr('floatNoWorkspace') ? tr('floatNoSession') : workspace)
  // Maximising the window moves both card and ball: nothing else re-renders
  // this component on resize, so the coordinates would stay at the old size.
  const [, setViewportTick] = useState(0)
  useEffect(() => {
    const onResize = () => setViewportTick((tick) => tick + 1)
    globalThis.addEventListener('resize', onResize)
    return () => globalThis.removeEventListener('resize', onResize)
  }, [])

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
    // Sending means the user wants to see their own message, wherever they were.
    stickRef.current = true
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

  /**
   * Copy one picture to the clipboard.
   *
   * The image may be a JPEG/WebP, but `ClipboardItem` is only portable for PNG,
   * so the loaded bitmap is redrawn on a canvas and exported as PNG first.
   */
  const copyPicture = async (source) => {
    try {
      const img = typeof source === 'string'
        ? await new Promise((resolve) => {
          const loader = new Image()
          loader.onload = () => resolve(loader)
          loader.onerror = () => resolve(null)
          loader.src = source
        })
        : source
      if (img === null || img === undefined) return
      const canvas = globalThis.document?.createElement('canvas')
      if (canvas === null || canvas === undefined) return
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const context = canvas.getContext('2d')
      if (context === null) return
      context.drawImage(img, 0, 0)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (blob === null || blob === undefined) return
      if (typeof ClipboardItem !== 'function' || navigator.clipboard?.write === undefined) {
        store.setNotice(tr('floatCopyImageUnsupported'))
        return
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      store.setNotice(tr('floatImageCopied'))
    } catch (error) {
      store.setNotice(`${tr('floatCopyImageFailed')}: ${error?.message ?? String(error)}`)
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
  // The card reads like DSH's own chat: the host's 14px body size and the
  // host font. The workspace's tree size and palette only apply while the card
  // sits inside the workspace.
  const detached = state.floatDetached === true
  const font = `${IDE_FLOAT_FONT_SIZE}px`

  // The stylesheet stays a sibling of the card: a `<style>` inside it would put
  // its text into the card's own text content.
  const styled = (node) => h(React.Fragment, null, [h(IdeStyles, { key: 'style' }), node])

  const shell = (children, extra, box) => styled(h('div', {
    key: 'card',
    ref: cardRef,
    className: extra === undefined ? 'iw-float' : `iw-float ${extra}`,
    'data-dsh-theme': detached || state.theme === '' ? undefined : state.theme,
    style: {
      // A box without coordinates is pinned to the bottom-right corner.
      left: box === undefined ? `${point.left}px` : 'auto',
      top: box === undefined ? `${point.top}px` : 'auto',
      right: box === undefined ? 'auto' : `${IDE_FLOAT_BALL_INSET}px`,
      bottom: box === undefined ? 'auto' : `${IDE_FLOAT_BALL_INSET}px`,
      width: `${box?.width ?? size.width}px`,
      height: `${box?.height ?? size.height}px`,
      fontSize: font,
    },
  }, children))

  if (collapsed) {
    // The ball is anchored to the window's bottom-right corner by CSS, so a
    // window resize can never leave it stranded mid-screen.
    return shell([h('button', {
      key: 'b',
      type: 'button',
      className: 'iw-float-ball-btn',
      onClick: () => store.setFloatCollapsed(false),
      title: tr('floatExpand'),
      'aria-label': tr('floatExpand'),
    }, 'AI')], 'iw-float-collapsed', { width: IDE_FLOAT_BALL, height: IDE_FLOAT_BALL })
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
        ref: titleBtnRef,
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
    renderSessionsMenu(),
    renderEffortMenu(),
    renderModelMenu(),
    renderPermissionMenu(),
    h('div', {
      key: 'body',
      className: 'iw-float-body',
      ref: bodyRef,
      onScroll: (event) => {
        const element = event.currentTarget
        stickRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 40
      },
    }, entries.length === 0
      ? h('div', { key: 'empty', className: 'iw-float-empty' }, sessionId === '' ? tr('floatNoSession') : tr('floatEmpty'))
      : entries.map((row) => {
        // One malformed event must not take the whole card down: a throw inside
        // this map unmounts the overlay, and the user just sees the card vanish.
        try {
          return ideFloatRow(row, tr, { setViewing, store, pictures, goToChat, running })
        } catch (error) {
          ideLogRecord('warn', 'float', 'row render failed', { key: row.key, error: String(error) })
          return h('div', { key: row.key, className: 'iw-float-row iw-float-assistant' }, String(row.text ?? ''))
        }
      })),
    running
      ? h('div', { key: 'think', className: 'iw-float-thinking' }, [
        h('span', { key: 'i', className: 'iw-float-thinking-icon' }, h(IdeSparkleIcon, { size: 15 })),
        h('span', { key: 't', className: 'iw-float-thinking-text' }, `${tr('floatRunning')}，${ideFloatElapsed(turnStart === 0 ? 0 : Date.now() - turnStart, tr)} ···`),
      ])
      : null,
    viewing === null ? null : h('div', { key: 'viewer', className: 'iw-float-viewer' }, [
      h('img', {
        key: 'img',
        className: 'iw-float-viewer-img',
        src: viewing.url,
        alt: viewing.name,
        draggable: false,
        onContextMenu: (event) => event.preventDefault(),
      }),
      h('div', { key: 'bar', className: 'iw-float-viewer-bar' }, [
        h('span', { key: 'name', className: 'iw-float-viewer-name' }, viewing.name),
        h('button', {
          key: 'copy',
          type: 'button',
          className: 'iw-btn',
          onClick: () => { void copyPicture(viewing.url) },
        }, tr('floatCopyImage')),
        h('button', {
          key: 'close',
          type: 'button',
          className: 'iw-btn',
          onClick: () => setViewing(null),
        }, tr('floatCloseViewer')),
      ]),
    ]),
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
      menu === 'attach'
        ? h('div', { key: 'attachmenu', className: 'iw-float-suggest', role: 'listbox' },
          [
            // The card's own extra: the file currently open in the workspace.
            h('button', {
              key: 'plus-current',
              type: 'button',
              role: 'option',
              className: 'iw-float-suggest-item',
              onMouseDown: (event) => { event.preventDefault(); referenceOpenFile() },
            }, [
              h('span', { key: 'i', className: 'iw-float-suggest-icon' }, h(IdeMenuGlyph, { kind: 'file', size: 14 })),
              h('span', { key: 'n', className: 'iw-float-suggest-name' }, tr('floatAttachReference')),
            ]),
          ].concat(plusItems.map((item, index) => {
            const previous = index === 0 ? '' : (plusItems[index - 1]?.section ?? '')
            const titleKey = item.section !== previous ? ideFloatSectionKey(item.section) : ''
            return h(React.Fragment, { key: `plus:${item.kind}:${item.id}` }, [
              titleKey === ''
                ? null
                : h('div', { key: 'section', className: 'iw-float-suggest-section', role: 'presentation' }, tr(titleKey)),
              h('button', {
                key: 'row',
                type: 'button',
                role: 'option',
                className: 'iw-float-suggest-item',
                onMouseDown: (event) => { event.preventDefault(); setMenu(''); pickSuggest(item) },
              }, [
                h('span', { key: 'i', className: 'iw-float-suggest-icon' }, h(IdeMenuGlyph, { kind: item.icon ?? 'file', size: 14 })),
                h('span', { key: 'n', className: 'iw-float-suggest-name' }, item.label),
                item.alias === '' ? null : h('span', { key: 'a', className: 'iw-float-suggest-alias' }, item.alias),
                h('span', { key: 'desc', className: 'iw-float-suggest-desc' }, item.description),
              ]),
            ])
          })))
        : null,
      suggest === null || suggest.items.length === 0
        ? null
        : h('div', { key: 'suggest', className: 'iw-float-suggest', role: 'listbox' },
          suggest.items.map((item, index) => {
            const previous = index === 0 ? '' : (suggest.items[index - 1]?.section ?? '')
            const titleKey = item.section !== previous ? ideFloatSectionKey(item.section) : ''
            return h(React.Fragment, { key: `${item.kind}:${item.id}` }, [
              titleKey === ''
                ? null
                : h('div', { key: 'section', className: 'iw-float-suggest-section', role: 'presentation' }, tr(titleKey)),
              h('button', {
                key: 'row',
                type: 'button',
                role: 'option',
                'aria-selected': index === suggest.index,
                className: `iw-float-suggest-item${index === suggest.index ? ' on' : ''}`,
                onMouseDown: (event) => { event.preventDefault(); pickSuggest(item) },
              }, [
                h('span', { key: 'i', className: 'iw-float-suggest-icon' }, h(IdeMenuGlyph, { kind: item.icon ?? 'file', size: 14 })),
                h('span', { key: 'n', className: 'iw-float-suggest-name' }, item.label),
                item.alias === '' ? null : h('span', { key: 'a', className: 'iw-float-suggest-alias' }, item.alias),
                h('span', { key: 'desc', className: 'iw-float-suggest-desc' }, item.description),
                // Directories advertise the Tab key that drills in, like DSH's keycap.
                item.kind !== 'dir'
                  ? null
                  : h('span', { key: 'd', className: 'iw-float-suggest-trailing' }, h('kbd', { key: 'k', className: 'iw-float-suggest-key' }, 'Tab')),
              ]),
            ])
          })),
      h('textarea', {
        key: 't',
        className: 'iw-float-textarea',
        rows: 2,
        value: draft,
        placeholder: binding === null ? tr('floatNoSession') : tr('floatPlaceholder'),
        disabled: binding === null,
        onChange: (event) => setDraft(event.target.value),
        onPaste,
        onCompositionStart: () => { composingRef.current = true },
        onCompositionEnd: () => {
          composingRef.current = false
          composedAtRef.current = Date.now()
        },
        onKeyDown: (event) => {
          if (suggest !== null && suggest.items.length > 0) {
            const count = suggest.items.length
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setSuggest({ ...suggest, index: (suggest.index + step + count) % count })
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setSuggest(null)
              return
            }
            if ((event.key === 'Enter' && event.shiftKey !== true) || event.key === 'Tab') {
              // Mid-composition the IME owns the key; the menu must not eat it.
              if (composingRef.current === true || event.nativeEvent?.isComposing === true || event.keyCode === 229) return
              event.preventDefault()
              pickSuggest(suggest.items[suggest.index])
              return
            }
          }
          if (event.key !== 'Enter' || event.shiftKey === true) return
          // Mid-composition (or the keydown that ends one) belongs to the IME.
          if (composingRef.current === true) return
          if (event.nativeEvent?.isComposing === true || event.keyCode === 229) return
          if (Date.now() - composedAtRef.current < IDE_FLOAT_IME_SETTLE_MS) return
          event.preventDefault()
          void submit()
        },
      }),
      h('div', { key: 'foot', className: 'iw-float-foot' }, [
        h('button', {
          key: 'plus',
          type: 'button',
          className: 'iw-float-plus',
          title: tr('floatAttach'),
          'aria-label': tr('floatAttach'),
          onClick: () => setMenu(menu === 'attach' ? '' : 'attach'),
        }, h(IdePlusIcon, { size: 14 })),
        h('button', {
          key: 'perm',
          type: 'button',
          ref: permChipRef,
          className: 'iw-float-perm',
          title: `${tr('floatPermission')}: ${ideFloatPermissionLabel(permission, tr)}`,
          onClick: () => setMenu(menu === 'perm' ? '' : 'perm'),
        }, [
          h(IdeLockIcon, { key: 'i', size: 13 }),
          h('span', { key: 't', className: 'iw-float-perm-text' }, ideFloatPermissionLabel(permission, tr)),
          h(IdeChevronDownIcon, { key: 'c', size: 12 }),
        ]),
        h('span', { key: 'gap', className: 'iw-float-gap' }),
        efforts.length === 0 ? null : h('button', {
          key: 'effort',
          type: 'button',
          ref: effortChipRef,
          className: 'iw-float-foot-chip',
          title: `${tr('floatEffort')}: ${effortLabel}`,
          onClick: () => setMenu(menu === 'effort' ? '' : 'effort'),
        }, effortLabel),
        h('button', {
          key: 'model',
          type: 'button',
          ref: modelChipRef,
          className: 'iw-float-foot-chip iw-float-foot-model',
          title: tr('floatModelHint'),
          onClick: () => setMenu(menu === 'model' ? '' : 'model'),
        }, [
          h('span', { key: 't', className: 'iw-float-foot-chip-text' }, modelLabel),
          h(IdeChevronDownIcon, { key: 'c', size: 12 }),
        ]),
        running
          ? h('button', {
            key: 'stop',
            type: 'button',
            className: 'iw-float-send iw-float-stop',
            title: tr('floatStop'),
            'aria-label': tr('floatStop'),
            onClick: () => { void stop() },
          }, h(IdeStopMarkIcon, { size: 12 }))
          : h('button', {
            key: 'send',
            type: 'button',
            className: 'iw-float-send',
            title: tr('floatSend'),
            'aria-label': tr('floatSend'),
            // A prompt may be images (or references) only.
            disabled: binding === null || sending || (draft.trim() === '' && refs.length === 0 && images.length === 0),
            onClick: () => { void submit() },
          }, h(IdeArrowUpIcon, { size: 16 })),
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

/**
 * The Turn's file changes, wired to the code workspace.
 *
 * DSH records what a Turn changed and serves it from two authenticated routes the
 * deliverables card already reads (`/api/changes.summary`, `/api/changes.diff`).
 * This entry joins the same `conversation.chat.turnTail` list, so the list sits
 * with the Turn it describes, and a click opens the file in this plugin's own
 * panel at the first changed line rather than in the shipped review sidebar.
 */

/** Route the Host serves one Turn's changed-file summary from. */
const IDE_CHANGES_SUMMARY = 'api/changes.summary'

/** Route the Host serves one changed file's comparison from. */
const IDE_CHANGES_DIFF = 'api/changes.diff'

/** Rows shown before the list folds, matching the shipped card's height. */
const IDE_TURN_ROWS = 4

/** A browser-relative route, resolved against the page's base so a sub-path mount works. */
function ideApiUrl(path, params) {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  const url = new URL(path, base)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
  return url.href
}

/**
 * One Turn's changed files.
 * @returns `{ ok: true, summary }` or a failure code.
 */
async function ideChangesSummary(sessionId, seq, signal) {
  let response
  try {
    response = await fetch(ideApiUrl(IDE_CHANGES_SUMMARY, { sessionId, seq }), { signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  const summary = parsed.value ?? parsed
  if (summary === null || typeof summary !== 'object' || !Array.isArray(summary.files)) {
    return { ok: false, error: parsed.error?.code ?? 'shape' }
  }
  return { ok: true, summary }
}

/**
 * One changed file's comparison for the Turn.
 * @returns `{ ok: true, diff }` or a failure code.
 */
async function ideChangesDiff(sessionId, seq, index, signal) {
  let response
  try {
    response = await fetch(ideApiUrl(IDE_CHANGES_DIFF, { sessionId, seq, index }), { signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  const diff = parsed.value ?? parsed
  if (diff === null || typeof diff !== 'object') return { ok: false, error: parsed.error?.code ?? 'shape' }
  return { ok: true, diff }
}

/**
 * The first line this file gained, in its turn-end numbering.
 *
 * Hunk bodies carry `+`, `-`, or ` ` prefixes; walking the hunks in order and
 * counting only context and added lines lands on the first added line's number.
 * A deletion-only change answers its hunk's first new line.
 *
 * @returns the 1-based line, or 0 when the comparison has none.
 */
function ideFirstChangedLine(diff) {
  if (diff?.kind !== 'text' || !Array.isArray(diff.hunks)) return 0
  let fallback = 0
  for (const hunk of diff.hunks) {
    let line = Number.isFinite(hunk?.newStart) ? hunk.newStart : 1
    for (const text of hunk?.lines ?? []) {
      if (typeof text !== 'string') continue
      if (text.startsWith('+')) return line
      if (text.startsWith(' ') || text.startsWith('-')) {
        if (fallback === 0) fallback = line
        if (text.startsWith(' ')) line += 1
      }
    }
  }
  return fallback
}

/** Tool names that write to the workspace, matched case-insensitively. */
const IDE_WRITE_TOOLS = /(^|_|\b)(edit|write|multiedit|str_replace|create|apply_patch|notebook_edit)(\b|_)/i

/**
 * Paths a Turn's write-tool calls touched, recovered from the event log.
 *
 * The Host keeps change summaries in memory only, so a restart leaves past Turns
 * with no summary — while their tool calls stay in the Session log. This walks
 * the Trajectory snapshot for calls placed inside the Turn and reads the path out
 * of the call input, which tolerates every tool that names the file differently.
 *
 * @returns unique workspace-relative paths in first-touch order.
 */
function ideTurnEditedPaths(trajectory, turnNumber) {
  if (trajectory === undefined || trajectory === null) return []
  if (!Number.isFinite(turnNumber)) return []
  const mine = new Set()
  for (const [seq, location] of trajectory.eventLocations ?? []) {
    if (location === undefined || location === null) continue
    if (location.kind === 'turn' && location.turn?.turn === turnNumber) mine.add(seq)
    else if (location.kind === 'step' && location.turn?.turn === turnNumber) mine.add(seq)
  }
  const paths = []
  const seen = new Set()
  for (const node of trajectory.eventNodes ?? []) {
    for (const match of node?.matches ?? []) {
      const event = match?.event
      if (event === undefined || event === null) continue
      if (!mine.has(event.seq)) continue
      if (event.type !== 'tool/call') continue
      const name = String(event.data?.name ?? '')
      if (!IDE_WRITE_TOOLS.test(name)) continue
      // The Session log names the field `arguments`; older shapes used `input`.
      const raw = event.data?.arguments ?? event.data?.input
      let payload
      try {
        payload = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {})
      } catch (error) {
        void error
        continue
      }
      for (const key of ['file_path', 'filePath', 'path', 'notebook_path']) {
        const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)+)"`)
        const found = pattern.exec(payload)
        if (found === null) continue
        let value = found[1].replace(/\\\\(.)/g, '$1')
        if (value === '' || seen.has(value)) break
        seen.add(value)
        paths.push(value)
        break
      }
    }
  }
  return paths
}

/**
 * The Turn's changes, with a jump into the code workspace per file.
 *
 * Renders nothing when the Turn changed no files, so Turns that only talked stay
 * as compact as they were.
 */
function IdeTurnChanges(props) {
  const { sessionId, seq, turn, store, translate, openPanel, useTrajectory } = props
  const tr = typeof translate === 'function' ? translate : (key) => key
  const [state, setState] = useState({ files: [], total: 0, added: 0, deleted: 0, failed: false, fromLog: false })
  // Hooks must run during render: read the Trajectory snapshot here and let the
  // async path below close over it, instead of calling the hook in a callback.
  const trajectory = typeof useTrajectory === 'function' ? useTrajectory((snapshot) => snapshot) : undefined
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState('')

  // The summary is served under the `workspace/changes` event's sequence, not the
  // Turn's closing one: the shipped deliverables node records it on the Turn, so
  // read it from there and only fall back to the slot's own sequence.
  const recorded = typeof turn?.data?.get === 'function' ? turn.data.get('deliverables') : undefined
  const changesSeq = Number.isFinite(recorded?.changes?.seq)
    ? recorded.changes.seq
    : (Number.isFinite(seq) ? seq : undefined)

  useEffect(() => {
    if (typeof sessionId !== 'string' || !Number.isFinite(changesSeq)) return undefined
    const controller = new AbortController()
    void ideChangesSummary(sessionId, changesSeq, controller.signal)
      .then(async (result) => {
        if (result.ok !== true) {
          // The Host keeps change summaries in memory only, so a Turn whose Host
          // restarted has none. Its tool calls stay in the Session log, so the
          // list is recovered from the loaded Trajectory window when it reaches
          // back far enough.
          const recovered = ideTurnEditedPaths(trajectory, turn?.turn)
          setState({
            files: recovered.map((path) => ({ path, display: path, added: 0, deleted: 0 })),
            total: recovered.length,
            added: 0,
            deleted: 0,
            failed: recovered.length === 0,
            fromLog: true,
          })
          return
        }
        const { files, total, added, deleted } = result.summary
        setState({
          files: files.filter((file) => typeof file?.path === 'string' && file.path !== ''),
          total: Number.isFinite(total) ? total : files.length,
          added: Number.isFinite(added) ? added : 0,
          deleted: Number.isFinite(deleted) ? deleted : 0,
          failed: false,
          fromLog: false,
        })
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [sessionId, changesSeq, trajectory])

  if (state.failed || state.files.length === 0) return null

  const foldable = state.files.length > IDE_TURN_ROWS
  const rows = foldable && !expanded ? state.files.slice(0, IDE_TURN_ROWS) : state.files

  const jump = async (file, index) => {
    if (busy !== '') return
    setBusy(file.path)
    let line = 0
    if (!state.fromLog) {
      const fetched = await ideChangesDiff(sessionId, changesSeq, index)
      if (fetched.ok === true) line = ideFirstChangedLine(fetched.diff)
    }
    setBusy('')
    const opened = store.openAt(file.path, line === 0 ? undefined : line)
    if (!opened) {
      store.setNotice(`${tr('turnJumpFailed')}: ${file.display ?? file.path}`)
      return
    }
    store.setNotice('')
    if (typeof openPanel === 'function') openPanel()
  }

  return h(React.Fragment, null, [
    h(IdeStyles, { key: 'style' }),
    h('div', { key: 'box', className: 'iw-turn' }, [
      h('button', {
        key: 'head',
        type: 'button',
        className: 'iw-turn-head',
        title: tr('turnChangesHint'),
        onClick: () => {
          const first = state.files[0]
          if (first !== undefined) void jump(first, 0)
        },
      }, [
        h(IdeFileIcon, { key: 'ic', lang: '', size: 14 }),
        h('span', { key: 't', className: 'iw-turn-title' }, tr('turnChanges')),
        h('span', { key: 'c', className: 'iw-turn-count' }, `${state.total}`),
        state.fromLog
          ? null
          : h('span', { key: 'a', className: 'iw-turn-add' }, `+${state.added}`),
        state.fromLog
          ? null
          : h('span', { key: 'd', className: 'iw-turn-del' }, `-${state.deleted}`),
      ]),
      h('div', { key: 'rows', className: 'iw-turn-rows' }, rows.map((file, index) => h('button', {
        key: file.path,
        type: 'button',
        className: `iw-turn-row${busy === file.path ? ' busy' : ''}`,
        title: `${file.display ?? file.path}  ${tr('turnJumpHint')}`,
        onClick: () => void jump(file, index),
      }, [
        h('span', { key: 'n', className: 'iw-turn-name' }, (file.display ?? file.path).split('/').pop()),
        h('span', { key: 'p', className: 'iw-turn-path' }, file.display ?? file.path),
        state.fromLog
          ? null
          : h('span', { key: 'a', className: 'iw-turn-add' }, `+${file.added ?? 0}`),
        state.fromLog
          ? null
          : h('span', { key: 'd', className: 'iw-turn-del' }, `-${file.deleted ?? 0}`),
      ]))),
      foldable
        ? h('button', {
          key: 'fold',
          type: 'button',
          className: 'iw-turn-fold',
          onClick: () => setExpanded(!expanded),
        }, expanded ? tr('turnFoldLess') : `${tr('turnFoldMore')} (${state.files.length - IDE_TURN_ROWS})`)
        : null,
    ]),
  ])
}

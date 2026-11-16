/**
 * The editor column: the tab strip, the breadcrumb and the virtualised source
 * view.
 *
 * Only the rows inside the viewport are mounted, so a several-thousand-line
 * file scrolls at the same cost as a short one — which matters here because the
 * agent rewrites files under the user's eyes and the panel must stay responsive
 * while that happens.
 */

/** Row height of the source view, matching `.iw-line` in the stylesheet. */
const IDE_LINE_HEIGHT = 20

/** Tab width used when measuring the widest line. */
const IDE_TAB_COLUMNS = 4

/** The pinned conversation chip at the head of the tab strip. */
/**
 * The modifier class of a pointer event: `meta` (⌘ on macOS, Ctrl elsewhere),
 * `alt`, `shift`, or `plain` when nothing is held.
 */
function ideGestureOf(event) {
  if (event.metaKey === true || (event.ctrlKey === true && event.metaKey !== true)) return 'meta'
  if (event.altKey === true) return 'alt'
  if (event.shiftKey === true) return 'shift'
  return 'plain'
}

function IdeChatTab({ onOpen, tr }) {
  return h('div', {
    className: 'iw-tab chat',
    title: tr('backToChatHint'),
    role: 'tab',
    tabIndex: 0,
    onClick: onOpen,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onOpen()
      }
    },
  }, [
    h('span', { key: 'ic', style: { display: 'inline-flex', opacity: 0.75 } }, h(IdeChatIcon, { size: 13 })),
    h('span', { key: 'lb', className: 'iw-tab-label' }, tr('backToChat')),
  ])
}

/** One file tab. */
function IdeFileTab({ tab, active, store, tr }) {
  return h('div', {
    className: `iw-tab${active ? ' active' : ''}`,
    title: tab.path,
    role: 'tab',
    tabIndex: 0,
    'aria-selected': active ? 'true' : 'false',
    onClick: () => store.activateTab(tab.path),
    onAuxClick: (event) => {
      if (event.button === 1) store.closeTab(tab.path)
    },
    // Right click opens the same menu IDEA puts on an editor tab.
    onContextMenu: (event) => {
      event.preventDefault()
      const box = event.currentTarget.getBoundingClientRect()
      store.setTabMenu({ path: tab.path, x: box.left, y: box.bottom + 2 })
    },
  }, [
    h('span', { key: 'ic', style: { display: 'inline-flex' } }, h(IdeFileIcon, { lang: ideLangOf(tab.name), size: 13 })),
    h('span', { key: 'lb', className: 'iw-tab-label' }, tab.name),
    h('button', {
      key: 'cl',
      type: 'button',
      className: 'iw-tab-close',
      title: tr('closeTab'),
      'aria-label': `${tr('closeTab')} ${tab.name}`,
      onClick: (event) => {
        event.stopPropagation()
        store.closeTab(tab.path)
      },
    }, h(IdeCloseIcon, { size: 12 })),
  ])
}

/** The tab strip, led by the conversation chip. */
function IdeTabStrip({ store, state, tr, onBackToChat }) {
  const tabs = state.tabs.map((tab) => h(IdeFileTab, {
    key: tab.path,
    tab,
    active: tab.path === state.activePath,
    store,
    tr,
  }))
  return h('div', { className: 'iw-tabs', role: 'tablist' }, [h(IdeChatTab, { key: 'chat', onOpen: onBackToChat, tr }), ...tabs])
}

/** Dimmable path breadcrumb; the file name is the only non-shrinking part. */
function IdeCrumbs({ path }) {
  const split = ideSplitPath(path)
  const parts = split.dir === '' ? [] : split.dir.replace(/\/$/, '').split('/')
  const directories = []
  parts.forEach((part, index) => {
    directories.push(h('span', { key: `d${index}` }, index === 0 ? part : `/${part}`))
  })
  return h('div', { className: 'iw-crumbs' }, [
    h('span', { key: 'dirs', className: 'iw-crumb-dirs' }, directories),
    parts.length === 0 ? null : h('span', { key: 'sep' }, '/'),
    h('span', { key: 'file', className: 'iw-crumb-file' }, split.name),
  ])
}

/** Measure the widest visual line so the horizontal scrollbar is honest. */
function ideColumnsOf(lines) {
  let widest = 0
  for (const line of lines) {
    const width = line.length + (line.split('\t').length - 1) * (IDE_TAB_COLUMNS - 1)
    if (width > widest) widest = width
    if (widest > 400) return 400
  }
  return widest
}

/** Whether one tokenizer run is a plain identifier the user can follow. */
const IDE_SYMBOL_RUN = /^[A-Za-z_$][\w$]{0,63}$/

/**
 * The clickable symbol inside one tokenizer run.
 *
 * Annotations arrive as a single `@Type` (or `@a.b.Type`) run, so the click has to
 * strip the `@` and point at the simple name: the language server wants the
 * identifier's own position, and without this an annotation is not clickable at
 * all — neither ⌘+click nor double click reaches it.
 *
 * @returns `{ name, offset }` — the symbol and its column inside the run — or
 * `undefined` when the run is not a followable identifier.
 */
function ideSymbolOfRun(run) {
  if (run === undefined || typeof run?.text !== 'string') return undefined
  if (run.cls === 'iw-ann') {
    const raw = run.text.replace(/^@/, '')
    const simple = raw.split('.').pop() ?? ''
    if (!IDE_SYMBOL_RUN.test(simple)) return undefined
    return { name: simple, offset: run.text.length - simple.length }
  }
  if (run.cls === '' || run.cls === 'iw-fn' || run.cls === 'iw-type') {
    if (!IDE_SYMBOL_RUN.test(run.text)) return undefined
    return { name: run.text, offset: 0 }
  }
  return undefined
}

/** One rendered source row. */
function IdeCodeLine({ index, text, lang, hit, vcs }) {
  // Tokenising is the expensive part of a row; it depends on the text alone, so
  // a highlight change or a notice re-render never repeats it.
  const runs = useMemo(() => ideTokenize(text, lang), [text, lang])
  let column = 0
  const rendered = runs.map((run, order) => {
    const at = column
    column += run.text.length
    const symbol = ideSymbolOfRun(run)
    if (symbol !== undefined) {
      // An identifier (or an annotation's type name): the container's click
      // handler resolves it through LSP.
      return h('span', {
        key: order,
        className: `${run.cls} iw-sym`,
        'data-iw-sym': symbol.name,
        'data-iw-col': at + symbol.offset,
      }, run.text)
    }
    if (run.cls === '') return run.text
    return h('span', { key: order, className: run.cls }, run.text)
  })
  return h('div', {
    key: index,
    className: `iw-line${hit === true ? ' hit' : ''}`,
    'data-iw-line': index,
  }, [
    h('span', { key: 'vcs', className: `iw-vcs${vcs === undefined ? '' : ` ${vcs}`}` }),
    h('span', { key: 'ln', className: 'iw-ln' }, String(index + 1)),
    h('span', { key: 'src', className: 'iw-src' }, rendered),
  ])
}

/** One row of the usage popup. */
function IdeUsageRow({ item, kind, onPick }) {
  return h('button', {
    type: 'button',
    className: `iw-usage${kind === 'def' ? ' def' : ''}`,
    title: `${item.path}:${item.line}`,
    onClick: () => onPick(item.path, item.line),
  }, [
    h('span', { key: 'f', className: 'iw-usage-file' }, `${ideBasename(item.path)} ${item.line}`),
    h('span', { key: 's', className: 'iw-usage-text' }, item.snippet ?? ''),
  ])
}

/** One titled group inside the popup: implementations, then callers. */
function IdeUsageSection({ section, onPick }) {
  return h('div', { className: 'iw-pop-section' }, [
    h('div', { key: 'h', className: 'iw-pop-section-head' }, section.title),
    ...section.rows.map((item) => h(IdeUsageRow, {
      key: `${section.key}:${item.path}:${item.line}`,
      item,
      kind: section.key === 'callers' ? 'use' : 'def',
      onPick,
    })),
  ])
}

/**
 * The usage popup: definition candidates, then call sites.
 *
 * It is `position: fixed` so it stays where the pointer is instead of scrolling
 * with the source it describes.
 */
function IdeUsagePopup({ popup, onPick, onClose }) {
  useEffect(() => {
    const onDown = (event) => {
      const element = event.target
      if (element instanceof Element && element.closest('.iw-pop') !== null) return
      onClose()
    }
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('pointerdown', onDown, true)
    globalThis.addEventListener('keydown', onKey)
    return () => {
      globalThis.removeEventListener('pointerdown', onDown, true)
      globalThis.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const sections = popup.sections ?? []
  const total = sections.reduce((sum, section) => sum + section.rows.length, 0)
  return h('div', {
    className: 'iw-pop',
    style: { left: `${popup.x}px`, top: `${popup.y}px` },
    role: 'dialog',
    'aria-label': popup.name,
  }, [
    h('div', { key: 'head', className: 'iw-pop-head' }, [
      h('span', { key: 'n', className: 'iw-pop-name' }, popup.name),
      h('span', {
        key: 'c',
        className: 'iw-pop-count',
        title: popup.phases ?? '',
      }, `${total}${typeof popup.ms === 'number' ? ` · ${popup.ms}ms` : ''}${popup.phases === undefined ? '' : ` (${popup.phases})`}`),
    ]),
    h('div', { key: 'body', className: 'iw-pop-body' }, total === 0
      ? h('div', { key: 'none', className: 'iw-hint' }, popup.empty ?? '')
      : sections.map((section) => h(IdeUsageSection, { key: section.key, section, onPick }))),
  ])
}

/**
 * Line index → change kind, for the gutter bars.
 *
 * `untracked` means git does not know the file yet, which an editor shows as a
 * wholly added file. A pure deletion has no lines of its own, so it marks the
 * boundary after the line that preceded it.
 */
function ideChangeKinds(changes, lineCount) {
  const kinds = new Map()
  if (changes === undefined || changes === null) return kinds
  if (changes.untracked === true) {
    for (let index = 0; index < lineCount; index += 1) kinds.set(index, 'a')
    return kinds
  }
  for (const hunk of Array.isArray(changes.hunks) ? changes.hunks : []) {
    if (typeof hunk?.start !== 'number') continue
    if (hunk.kind === 'deleted') {
      const at = hunk.start - 2
      if (at >= 0) kinds.set(at, 'd')
      continue
    }
    const kind = hunk.kind === 'modified' ? 'm' : 'a'
    for (let line = hunk.start; line <= hunk.end; line += 1) {
      const index = line - 1
      if (index >= 0 && index < lineCount) kinds.set(index, kind)
    }
  }
  return kinds
}

/** The source view. */
function IdeCodeView({ tab, tr, store, navigate }) {
  const scrollRef = useRef(null)
  // Every loaded line is mounted. A windowed renderer was tried here and its
  // first measurement could leave the rest of the file unrendered — the scroll
  // container is the browser's own, and a few thousand rows are cheap enough.
  const lines = useMemo(() => (tab.text === '' ? [] : tab.text.split('\n')), [tab.text])
  const columns = useMemo(() => ideColumnsOf(lines), [lines])
  const changeKinds = useMemo(() => ideChangeKinds(tab.changes, lines.length), [tab.changes, lines.length])

  // ---- symbol navigation --------------------------------------------------
  const [popup, setPopup] = useState(undefined)

  const pick = useCallback((path, line) => {
    setPopup(undefined)
    const opened = store.openAt(path, line)
    store.setNotice(opened ? `→ ${ideBasename(path)}:${line}` : `${tr('jumpFailed')}: ${path}`)
  }, [store, tr])

  const closePopup = useCallback(() => setPopup(undefined), [])

  /** The symbol under the pointer, with its 0-based LSP position. */
  const resolveSymbolAt = (event) => {
    const target = event.target
    if (!(target instanceof Element)) return undefined
    const name = target.getAttribute('data-iw-sym')
    if (name === null) return undefined
    const row = target.closest('.iw-line')
    const line = row === null ? undefined : Number(row.getAttribute('data-iw-line'))
    const column = Number(target.getAttribute('data-iw-col'))
    if (!Number.isFinite(line) || !Number.isFinite(column)) return undefined
    return { name, position: { line, character: column } }
  }

  // The popup is positioned inside the panel, so pointer coordinates become
  // panel-relative and an overlay can never paint over the app shell's composer.
  // Viewport coordinates: the popup is `position: fixed`, so it lands next to the
  // pointer and never scrolls with the source.
  const popupAt = (event) => ({
    x: Math.min(Math.max(8, event.clientX), Math.max(8, (globalThis.innerWidth || 1200) - 520)),
    y: Math.min(Math.max(8, event.clientY), Math.max(8, (globalThis.innerHeight || 800) - 360)),
  })

  /** Jump to the declaration of `name` (double click). */
  const jumpToDefinition = async (name, position, event) => {
    if (navigate === undefined) {
      store.setNotice(`${tr('lspFailed')}: lsp-unavailable`)
      return
    }
    // A language server's first answer can take seconds while it indexes; the
    // banner is the only signal this read-only view can give without blocking.
    store.setNotice(tr('querying'))
    try {
      let outcome
      try {
        outcome = await navigate.definition(tab.path, position, name)
      } catch (error) {
        // No language server, or it failed: dependency jars are still readable,
        // so fall through instead of stopping at the error.
        void error
        outcome = undefined
      }
      const locations = outcome?.locations ?? []
      // The query time is only a hint in the banner; a missing value is fine.
      const queryMs = typeof outcome?.ms === 'number' ? outcome.ms : undefined
      store.setNotice('')

      if (locations.length > 1) {
        setPopup({
          name,
          ms: queryMs,
          sections: [{ key: 'impl', title: `${tr('tabDeclaration')} (${locations.length})`, rows: locations.slice(0, 8) }],
          ...popupAt(event),
        })
        return
      }
      if (locations.length === 1) {
        // Say where the jump went: a wrong answer is then one glance away
        // instead of a mystery about whether the gesture did anything.
        if (store.openAt(locations[0].path, locations[0].line)) {
          const loadMs = store.getState().lastLoadMs
          store.setNotice(`\u2192 ${ideBasename(locations[0].path)}:${locations[0].line} \u00b7 \u67e5\u8be2 ${queryMs ?? '?'}ms \u00b7 \u8f7d\u5165 ${loadMs ?? '?'}ms`)
          return
        }
        // The server answered with a location outside the workspace — a
        // dependency jar. The editor cannot open that path, but its sources are
        // readable, so the fallbacks below still apply.
      }

      // An annotation attribute (`@Log(name = "x")`) is a method on the annotation
      // type, so the symbol alone resolves nothing.
      const annotationType = ideAnnotationTypeAt(lines, position)
      if (annotationType !== '' && await openAnnotationAttribute(annotationType, name, position)) return
      // A type from a dependency: its source is readable when the artifact ships
      // `-sources`, which is true for everything this workspace imports.
      if (await openFromJar(name, position)) return
      store.setNotice(`${tr('noDefinition')}: ${name}`)
    } catch (error) {
      store.setNotice(`${tr('lspFailed')}: ${error?.code ?? error?.message ?? 'unknown'}`)
    }
  }

  /**
   * The fully qualified name an import binds, for `simpleName`.
   *
   * A class from a dependency is used by its simple name; the import is the only
   * place the package is stated.
   */
  const ideImportedFqn = (simpleName) => {
    const pattern = new RegExp(`^\\s*import\\s+(?:static\\s+)?([\\w.]+\\.${simpleName});`)
    for (const text of lines) {
      const match = pattern.exec(text)
      if (match !== null) return match[1]
    }
    return ''
  }

  /**
   * Open the definition from a dependency jar's sources.
   *
   * @returns whether a read-only tab was opened.
   */
  /**
   * Open the declaration of an annotation attribute (`@Log(name = "x")` → `name()`).
   *
   * The attribute is not a symbol of this file: it is a method on the annotation
   * type, which usually comes from a dependency jar. Without this, a click on such
   * an attribute reports 「未找到定义」 even though the source is readable.
   *
   * @returns `true` when the attribute's declaration was opened.
   */
  const openAnnotationAttribute = async (typeName, attribute, position) => {
    const fqn = ideImportedFqn(typeName)
    if (fqn === '') return false
    const found = await ideJarSourceQuery(fqn)
    if (found.ok !== true || found.found !== true) return false
    const index = ideAttributeLineIn(found.text.split('\n'), attribute)
    store.openJarSource({
      className: fqn,
      jar: found.jar,
      text: found.text,
      line: index >= 0 ? index + 1 : undefined,
    })
    const jarFile = found.jar.split('/').pop() ?? ''
    store.setNotice(`\u2192 ${jarFile} \u203a ${typeName}.java${index >= 0 ? `:${index + 1}` : ''}`)
    return true
  }

  const openFromJar = async (name, position) => {
    // Where the owner comes from, in order of certainty:
    //   1. `Type::getX` states it in the line;
    //   2. `older.getX()` — the receiver's declared type is in the same file;
    //   3. `captor.getValue().getX()` — ask the engine for the receiver's type;
    //   4. a capitalised symbol is the class itself.
    const lineText = lines[position.line] ?? ''
    const before = lineText.slice(0, Math.max(0, position.character))
    const referenceOwner = /([A-Z][\w$]*)\s*::\s*[\w$]*$/.exec(before)?.[1] ?? ''
    let owner = referenceOwner
    const receiver = ideReceiverToken(before)
    if (owner === '' && receiver !== '') {
      const declared = ideDeclaredType(lines, receiver)
      if (declared !== '') owner = declared
    }
    if (owner === '' && receiver !== '') {
      // A generic container: the declaration `ArgumentCaptor<T> captor` answers
      // `captor.getValue()`, so look up the variable, not the method.
      const argument = ideGenericArgument(lines, ideChainBase(before, receiver) || receiver)
      if (argument !== '') owner = argument
    }
    if (owner === '') {
      // A chained receiver: hover the method immediately before the dot.
      const chain = receiver
      if (chain !== '' && before.replace(/\s+$/, '').endsWith(').')) {
        const start = before.lastIndexOf(chain)
        const hovered = await ideLspHoverText(store, tab.path, { line: position.line, character: start + 1 })
        const imported = lines
          .map((text) => /^\s*import\s+(?:static\s+)?[\w.]+\.([A-Z][\w$]*);/.exec(text)?.[1] ?? '')
          .filter((simple) => simple !== '')
        owner = [...hovered.matchAll(/\b([A-Z][\w$]*)\b/g)]
          .map((match) => match[1])
          .filter((simple) => imported.includes(simple))
          .pop() ?? ''
      }
    }
    if (owner === '') owner = name[0] === name[0].toUpperCase() ? name : ''
    if (owner === '') return false
    const fqn = ideImportedFqn(owner)
    if (fqn === '') return false
    const found = await ideJarSourceQuery(fqn)
    if (found.ok !== true || found.found !== true) {
      if (found.ok === true) store.setNotice(`${tr('noSourceInJar')}: ${owner}`)
      return found.ok === true
    }
    const fieldName = ideBeanFieldName(name)
    const jarLines = found.text.split('\n')
    const target = fieldName === undefined ? 0 : jarLines.findIndex((text) => (
      new RegExp(`^\\s*(?:(?:private|protected|public|final|static|transient|volatile)\\s+)*[\\w<>,\\[\\].? ]+\\b${fieldName}\\b\\s*(?:[;=])`).test(text)
    ))
    store.openJarSource({
      className: fqn,
      jar: found.jar,
      text: found.text,
      line: target >= 0 ? target + 1 : undefined,
    })
    const jarFile = found.jar.split('/').pop() ?? ''
    store.setNotice(`→ ${jarFile} › ${owner}.java${target >= 0 ? `:${target + 1}` : ''}`)
    return true
  }

  /** Show implementations and callers of `name` (⌘/Ctrl + click). */
  const showUsages = async (name, position, event) => {
    if (navigate === undefined) {
      store.setNotice(`${tr('lspFailed')}: lsp-unavailable`)
      return
    }
    try {
      // An interface, an abstract method and a concrete one all answer here:
      // implementations and callers are separated so a click on the contract
      // shows both, exactly as the editor would.
      //
      // The reference sweep is the slowest of the three queries, so the popup is
      // painted with the implementations first and completed when callers arrive.
      const anchor = popupAt(event)
      const sectionsOf = (grouped) => {
        const sections = []
        if ((grouped.implementations ?? []).length > 0) {
          sections.push({ key: 'impl', title: `${tr('tabImplements')} (${grouped.implementations.length})`, rows: grouped.implementations })
        }
        if ((grouped.callers ?? []).length > 0) {
          sections.push({ key: 'callers', title: `${tr('tabCallers')} (${grouped.callers.length})`, rows: grouped.callers })
        }
        if ((grouped.declaration ?? []).length > 0) {
          sections.push({ key: 'def', title: tr('tabDeclaration'), rows: grouped.declaration })
        }
        if ((grouped.textual ?? []).length > 0) {
          sections.push({ key: 'text', title: `${tr('tabCallersText')} (${grouped.textual.length})`, rows: grouped.textual })
        }
        return sections
      }

      const grouped = await navigate.browse(tab.path, position, name, (partial) => {
        const partialSections = sectionsOf(partial)
        if (partialSections.length === 0) return
        setPopup({ name, sections: partialSections, ms: partial.ms, phases: partial.phases, ...anchor })
      })
      const sections = sectionsOf(grouped)
      if (sections.length === 0) {
        store.setNotice(`${tr('noUsages')}: ${name}${tr('maybeIndexing')}`)
        return
      }
      store.setNotice('')
      setPopup({ name, sections, ms: grouped.ms, phases: grouped.phases, ...anchor })
    } catch (error) {
      store.setNotice(`${tr('lspFailed')}: ${error?.code ?? error?.message ?? 'unknown'}`)
    }
  }

  // Scroll placement has two owners: a jump asks for a line, and a remount has
  // to put the reader back where they were. Only a *new* jump line overrides the
  // remembered offset — otherwise returning to a tab would always jump to the top.
  const reveal = tab.reveal
  useEffect(() => {
    const element = scrollRef.current
    if (element === null || tab.status !== 'ready') return
    if (typeof reveal === 'number' && reveal > 0 && tab.revealApplied !== reveal) {
      element.scrollTop = Math.max(0, (reveal - 1) * IDE_LINE_HEIGHT - Math.round(element.clientHeight / 3))
      store.setRevealApplied(tab.path, reveal)
      store.rememberScroll(tab.path, element.scrollTop)
      return
    }
    element.scrollTop = store.getState().scroll[tab.path] ?? 0
  }, [tab.path, reveal, tab.revealApplied, tab.status, store])

  // Persist the offset while reading, throttled so a scroll does not re-render
  // the whole panel on every frame.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return undefined
    let timer
    const onScroll = () => {
      if (timer !== undefined) return
      timer = setTimeout(() => {
        timer = undefined
        store.rememberScroll(tab.path, element.scrollTop)
      }, 150)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      element.removeEventListener('scroll', onScroll)
    }
  }, [tab.path, store])

  if (lines.length === 0 && tab.text === '') {
    return h('div', { className: 'iw-empty' }, tr(tab.status === 'error' ? 'fileNotText' : 'loading'))
  }

  const lang = ideLangOf(tab.name)
  const hitIndex = typeof reveal === 'number' && reveal > 0 ? reveal - 1 : -1
  const rendered = lines.map((text, index) => h(IdeCodeLine, {
    key: index,
    index,
    text,
    lang,
    hit: index === hitIndex,
    vcs: changeKinds.get(index),
  }))

  const code = h('div', {
    className: 'iw-code',
    ref: scrollRef,
    tabIndex: 0,
    onClick: (event) => {
      // A plain click deliberately does nothing unless the user assigns it one.
      // Selecting and copying source is a more frequent gesture than navigating,
      // and a drag that ends on an identifier must not be mistaken for a request.
      const gesture = ideGestureOf(event)
      if (gesture === 'plain' || gesture === 'shift') return
      const actions = store.getState().gestures
      const action = actions.definition === gesture ? 'definition'
        : actions.usages === gesture ? 'usages'
          : ''
      if (action === '') return
      const hit = resolveSymbolAt(event)
      if (hit === undefined) return
      event.preventDefault()
      if (action === 'definition') void jumpToDefinition(hit.name, hit.position, event)
      else void showUsages(hit.name, hit.position, event)
    },
    onDoubleClick: (event) => {
      // A double click with a modifier belongs to the single-click gestures above.
      if (ideGestureOf(event) !== 'plain') return
      const actions = store.getState().gestures
      const hit = resolveSymbolAt(event)
      if (hit === undefined) return
      const action = actions.definition === 'double' ? 'definition'
        : actions.usages === 'double' ? 'usages'
          : ''
      if (action === '') return
      event.preventDefault()
      if (action === 'definition') void jumpToDefinition(hit.name, hit.position, event)
      else void showUsages(hit.name, hit.position, event)
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape') closePopup()
    },
  }, [
    h('div', {
      key: 'inner',
      className: 'iw-code-inner',
      style: { width: `max(100%, ${Math.max(columns, 24)}ch)` },
    }, rendered),
  ])

  // The popup is a sibling of the scrolling container, not a child: inside it,
  // it would both scroll with the source and position against that container.
  return h(React.Fragment, null, [code, popup === undefined ? null : h(IdeUsagePopup, { key: 'popup', popup, onPick: pick, onClose: closePopup })])
}

/** The bottom status bar. */
function IdeStatusBar({ store, state, tab, tr }) {
  const lang = tab === undefined ? '' : ideLangOf(tab.name)
  const total = state.tabs.reduce((sum, entry) => sum + (entry.lines ?? 0), 0)
  return h('div', { className: 'iw-status' }, [
    h('span', {
      key: 'path',
      title: tab?.kind === 'jar' ? `${tab.dir}` : (tab?.path ?? ''),
    }, tab === undefined
      ? tr('title')
      : tab.kind === 'jar' ? `${tab.dir} › ${tab.name}` : `${tab.path}`),
    h('span', { key: 'grow', className: 'iw-grow' }),
    tab === undefined || tab.lines === 0
      ? null
      : h('span', { key: 'lines' }, `${tab.lines} ${tr('linesSuffix')}`),
    tab === undefined || lang === ''
      ? null
      : h('span', { key: 'lang' }, ideLangLabel(lang)),
    h('span', { key: 'enc' }, tr('utf8')),
    h('span', {
      key: 'window',
      title: tr('liveOn'),
      style: { display: 'inline-flex', alignItems: 'center', gap: '5px' },
    }, [h(IdeLiveDot, { key: 'dot', on: state.watching }), tr('live')]),
    h('span', { key: 'ro' }, tr('readOnly')),
    total === 0 ? null : h('span', { key: 'total', style: { opacity: 0.7 } }, `${state.tabs.length}`),
  ])
}

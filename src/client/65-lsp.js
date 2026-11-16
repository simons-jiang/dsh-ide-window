/**
 * Semantic navigation, backed by the Host's LSP seam.
 *
 * DSH exposes exactly four semantic queries on `ctx.lsp` and no protocol escape
 * hatch, so the browser half asks the plugin's own Host route (see `index.js`)
 * for `goToDefinition`, `goToImplementation` and `findReferences`, and gets back
 * workspace-relative paths with 1-based lines.
 *
 * Reference rows carry their source line, which LSP does not send: it is read
 * here, once per distinct file, so the popup can show code instead of a bare
 * coordinate.
 */

/** Resolve the plugin's route against the page base, keeping proxy prefixes. */
function ideLspUrl() {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  return new URL('dsh-ide/lsp', base).href
}

/**
 * Run one query through the Host.
 *
 * @param payload - `{ operation, filePath, workspaceRoot, position }`.
 * @returns the normalized `{ kind, locations | hover }`.
 * @throws an Error whose `code` is the Host's stable failure code.
 */
async function ideLspQuery(payload, signal) {
  let response
  try {
    response = await fetch(ideLspUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    const failure = new Error('network')
    failure.code = 'network'
    throw failure
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) {
    const failure = new Error(`HTTP ${response.status}`)
    failure.code = `http-${response.status}`
    throw failure
  }
  if (parsed.ok !== true) {
    const failure = new Error(parsed.error?.code ?? `http-${response.status}`)
    failure.code = parsed.error?.code ?? `http-${response.status}`
    failure.detail = parsed.error?.message ?? ''
    throw failure
  }
  return parsed.value
}

/** One query addressed to the panel's current workspace. */
function ideLspPayload(store, operation, tabPath, position) {
  const state = store.getState()
  return {
    operation,
    filePath: ideAbs(state.rootPath, tabPath),
    workspaceRoot: state.rootPath,
    position,
  }
}

/**
 * Definition first, implementation as the fallback.
 *
 * Ctrl/Cmd+click on an interface method resolves to the interface declaration;
 * asking for the implementation when that yields nothing is what makes the same
 * gesture land in the class the user actually wanted.
 *
 * @returns locations `{ path, line, character }`, best first.
 */
async function ideLspDefinition(store, tabPath, position, symbolName, timeline) {
  const request = async (operation) => {
    const started = ideNow()
    const result = await ideLspQuery(ideLspPayload(store, operation, tabPath, position))
    timeline?.mark(operation === 'goToDefinition' ? 'lsp' : operation, ideNow() - started)
    return result.locations ?? []
  }

  let located = await request('goToDefinition')
  if (located.length === 0) located = await request('goToImplementation')

  const fieldName = ideBeanFieldName(symbolName)
  // Everything below is bean-accessor work: any other symbol is answered by the
  // one query above, with no file read at all.
  if (fieldName === undefined) return located

  if (located.length === 0) {
    // A Lombok accessor the server cannot resolve has no declaration to follow;
    // the field is still in the open file, so that is the last resort.
    const started = ideNow()
    const lines = await ideFileLines(store, tabPath)
    timeline?.mark('read', ideNow() - started)
    const line = lines === null ? 0 : ideFindFieldLine(lines, fieldName)
    if (line > 0) return [{ path: tabPath, line, character: 0 }]
    // The property may live in another class: `Type::getValue` names it.
    const owned = await ideAccessorOwnerField(store, tabPath, position, fieldName)
    return owned === undefined ? located : [owned]
  }

  if (located.length > 1) return located

  // The server usually resolves a Lombok accessor straight to its field, and
  // reading the destination is cheaper than a second query. Only an accessor
  // that resolved to its own body still needs the field resolved on its behalf.
  const started = ideNow()
  const lines = await ideFileLines(store, located[0].path)
  timeline?.mark('read', ideNow() - started)
  if (lines === null) return located
  // The destination declares the *accessor* (its own name followed by a
  // parameter list) when it did not resolve to the field; a field line carries
  // the property name instead, so the accessor name is what decides this.
  if (!ideLineHasMethodAt(lines[located[0].line - 1], symbolName)) return located
  const field = await ideAccessorField(store, located[0], fieldName, lines, timeline)
  return field === undefined ? located : [field, ...located.slice(1)]
}

/**
 * The class named before `::` on the clicked line, as in `Type::getValue`.
 *
 * A method reference is the one accessor call that states its owner in the
 * source, so a Lombok getter the engine cannot resolve still has somewhere to go.
 */
function ideMethodRefOwner(lineText, column) {
  const before = String(lineText ?? '').slice(0, Math.max(0, column))
  const match = /([A-Z][\w$]*)\s*::\s*[\w$]*$/.exec(before)
  return match === null ? '' : match[1]
}

/**
 * Resolve a Lombok accessor through its owner's source file.
 *
 * Used when the engine returns no declaration and the field is not in the open
 * file: `ExchangeRateInnerResp::getBusinessDate` names the class, so the field is
 * looked up in that class's own file.
 */
async function ideAccessorOwnerField(store, tabPath, position, fieldName) {
  const lines = await ideFileLines(store, tabPath)
  if (lines === null) return undefined
  const owner = ideMethodRefOwner(lines[position.line] ?? '', position.character)
  if (owner === '') return undefined
  const found = await store.searchFiles(`${owner}.java`)
  if (found.ok !== true) return undefined
  const target = found.matches.find((match) => match.path.split('/').pop() === `${owner}.java`)
  if (target === undefined) return undefined
  const ownerLines = await ideFileLines(store, target.path)
  if (ownerLines === null) return undefined
  const line = ideFindFieldLine(ownerLines, fieldName)
  return line > 0 ? { path: target.path, line, character: 0 } : undefined
}

/**
 * The 1-based line of a field declaration for `name`, or `0`.
 *
 * Deliberately strict: the name must be followed by `;` or `=`, so a method
 * returning the same type (`name(`) or a call (`name(arg)`) never matches.
 */
function ideFindFieldLine(lines, name) {
  const pattern = new RegExp(
    '^\\s*(?:(?:private|protected|public|final|static|transient|volatile)\\s+)*'
    + `[\\w$<>\\[\\],.?]+(?:\\s+[\\w$<>\\[\\],.?]+)*\\s+${name}\\s*(?:[;=])`,
  )
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index + 1
  }
  return 0
}

/** Whether `word` is followed by a parameter list on that line (a method, not a field). */
function ideLineHasMethodAt(line, word) {
  if (typeof line !== 'string') return false
  const column = ideFindWordColumn(line, word)
  if (column < 0) return false
  let index = column + word.length
  while (index < line.length && (line[index] === ' ' || line[index] === '\t')) index += 1
  return line[index] === '('
}

/**
 * Resolve a bean accessor to the property it reads or writes.
 *
 * The definition of `setSuspendedCount` is the setter's own body, which is not
 * where a Java developer wants to land when following a property. The field name
 * follows from the method name, so this finds that identifier inside the
 * accessor and asks the language server for *its* definition — the field
 * declaration, resolved semantically rather than guessed from the text.
 *
 * @returns the field's location, or `undefined` when the accessor is abstract,
 *   generated, or already resolves to the field itself.
 */
async function ideAccessorField(store, location, fieldName, lines, timeline) {
  if (fieldName === undefined || typeof location?.path !== 'string') return undefined
  if (lines === null || lines === undefined) return undefined
  const from = Math.max(0, location.line - 1)
  const to = Math.min(lines.length, from + 14)
  // `this.<field>` is the unambiguous spelling a setter uses; a bare occurrence
  // could be the parameter of the same name, so it is only the fallback. Either
  // way a column inside the parameter list is skipped.
  const candidates = []
  for (let index = from; index < to; index += 1) {
    const line = lines[index]
    const column = ideFindWordColumn(line, fieldName)
    if (column < 0 || ideInsideParens(line, column)) continue
    const before = line.slice(Math.max(0, column - 5), column)
    candidates.push({ index, column, qualified: /this\.$/.test(before) })
  }
  candidates.sort((left, right) => Number(right.qualified) - Number(left.qualified))
  for (const candidate of candidates) {
    const { index, column } = candidate
    try {
      const started = ideNow()
      const result = await ideLspQuery({
        operation: 'goToDefinition',
        filePath: ideAbs(store.getState().rootPath, location.path),
        workspaceRoot: store.getState().rootPath,
        position: { line: index, character: column },
      })
      timeline?.mark('field', ideNow() - started)
      const field = (result.locations ?? [])[0]
      if (field !== undefined && field.path === location.path && field.line !== location.line) return field
    } catch (error) {
      void error
      return undefined
    }
  }
  return undefined
}

/** A monotonic timestamp, falling back to the clock when `performance` is absent. */
function ideNow() {
  const performance = globalThis.performance
  return performance !== undefined && typeof performance.now === 'function' ? performance.now() : Date.now()
}

/**
 * One interaction's timings.
 *
 * Navigation latency is dominated by round trips, so the useful thing to ship is
 * a measurement: every interaction reports where its milliseconds went, in the
 * banner and the console. Nothing is kept between interactions.
 */
function ideTimeline() {
  const started = ideNow()
  const marks = []
  return {
    mark(label, milliseconds) {
      marks.push([label, Math.round(milliseconds)])
      return milliseconds
    },
    total() {
      return Math.round(ideNow() - started)
    },
    phases() {
      return marks.map(([name, ms]) => `${name} ${ms}ms`).join(' \u00b7 ')
    },
    report(label) {
      const parts = marks.map(([name, ms]) => `${name} ${ms}ms`).join(' \u00b7 ')
      try {
        globalThis.console?.debug?.(`[dsh-ide-window] ${label}: ${parts} \u00b7 total ${Math.round(ideNow() - started)}ms`)
      } catch (error) {
        void error
      }
    },
  }
}

/** How many accessor call sites may be checked before giving up on an anchor. */
const IDE_MAX_ANCHOR_TRIES = 8

/** The property a Java bean accessor works on: `getX`/`setX`/`isX` \u2192 `x`. */
function ideBeanFieldName(name) {
  const match = /^(?:get|set|is)([A-Z][\w$]*)$/.exec(typeof name === 'string' ? name : '')
  if (match === null) return undefined
  return match[1].charAt(0).toLowerCase() + match[1].slice(1)
}

/** Column of one whole-word occurrence, or `-1`. */
function ideFindWordColumn(line, word) {
  const pattern = new RegExp(`(^|[^\\w$])(${word})(?![\\w$])`)
  const match = pattern.exec(line)
  if (match === null) return -1
  return match.index + match[1].length
}

/** Whether a column sits inside a parameter list on that line. */
function ideInsideParens(line, column) {
  let depth = 0
  for (let index = 0; index < column && index < line.length; index += 1) {
    if (line[index] === '(') depth += 1
    else if (line[index] === ')') depth = Math.max(0, depth - 1)
  }
  return depth > 0
}

/** Every line of one workspace file, or `null` when it cannot be read. */
async function ideFileLines(store, path) {
  const state = store.getState()
  if (typeof state.sessionId !== 'string' || state.rootPath === '') return null
  const result = await store.readText(state.sessionId, state.rootPath, path)
  if (!result.ok) return null
  return String(result.value).split('\n')
}

/** Read one line of one file, memoised per call so a popup costs one read per file. */
async function ideLineText(store, path, line, cache) {
  if (cache.has(path)) {
    const lines = cache.get(path)
    if (lines === null) return ''
    return lines[line - 1] ?? ''
  }
  const state = store.getState()
  if (typeof state.sessionId !== 'string') return ''
  const result = await store.readText(state.sessionId, state.rootPath, path)
  if (!result.ok) {
    cache.set(path, null)
    return ''
  }
  const lines = String(result.value).split('\n')
  cache.set(path, lines)
  return lines[line - 1] ?? ''
}

/**
 * Attach each location's source line.
 *
 * LSP answers with a range, not with code, so every row a popup shows is
 * completed here \u2014 one read per distinct file, never one per row.
 */
async function ideWithSnippets(store, locations) {
  const cache = new Map()
  const rows = []
  for (const location of locations) {
    rows.push({
      path: location.path,
      line: location.line,
      snippet: await ideLineText(store, location.path, location.line, cache),
    })
  }
  return rows
}

/** Java accessor names a property implies: `docId` → `getDocId`, `setDocId`, `isDocId`. */
function ideAccessorNames(name) {
  const base = typeof name === 'string' ? name : ''
  if (base === '') return []
  const capitalized = base.charAt(0).toUpperCase() + base.slice(1)
  return [`get${capitalized}`, `set${capitalized}`, `is${capitalized}`]
}

/**
 * Text fallback for symbols the engine reports no usages for.
 *
 * A Lombok field has no accessor in the sources, and `textDocument/references`
 * on the field itself returns only its declaration — so a property that is used
 * everywhere would look unused. Searching for its accessors' call sites is a
 * grep, not a semantic answer, and the popup labels it as such.
 */
async function ideTextualCallers(store, tabPath, position, symbolName, limit) {
  const names = ideAccessorNames(symbolName)
  if (names.length === 0) return []
  const root = store.getState().rootPath
  if (root === '') return []
  const pattern = `\\b(?:${names.join('|')})\\s*\\(`
  const found = await ideGrepQuery(root, pattern, { caseSensitive: true })
  if (found.ok !== true) return []
  const clicked = `${tabPath}:${position.line + 1}`
  const seen = new Set()
  const rows = []
  for (const match of found.matches) {
    const key = `${match.path}:${match.line}`
    if (key === clicked || seen.has(key)) continue
    seen.add(key)
    rows.push({ path: match.path, line: match.line, snippet: match.text })
    if (rows.length >= limit) break
  }
  return rows
}

/**
 * Semantic references for a property, anchored at one of its accessor call sites.
 *
 * The engine will not attribute accessor usages to the field itself — asking for
 * references *at the field* answers only its declaration. Asking at a call site
 * of `getX`/`setX`/`isX` does return every usage, semantically. So one text
 * search is used only to find that anchor; the result set is the engine's.
 *
 * @returns locations from the engine, empty when no accessor call exists.
 */
async function ideAccessorReferences(store, tabPath, position, symbolName, timeline) {
  const names = ideAccessorNames(symbolName)
  if (names.length === 0) return []
  const root = store.getState().rootPath
  if (root === '') return []
  const pattern = `\\b(?:${names.join('|')})\\s*\\(`
  const found = await ideGrepQuery(root, pattern, { caseSensitive: true })
  if (found.ok !== true) return []
  const clicked = `${tabPath}:${position.line + 1}`

  // A candidate call site only counts as an anchor when the engine resolves it
  // back to the field that was clicked. Without this check the first `getDocId(`
  // in the workspace wins, which may belong to an unrelated class and returns
  // that symbol's references — visibly wrong results.
  let anchor
  let anchorCharacter = 0
  let tried = 0
  for (const match of found.matches) {
    if (`${match.path}:${match.line}` === clicked) continue
    if (tried >= IDE_MAX_ANCHOR_TRIES) break
    tried += 1
    const name = names.find((candidate) => String(match.text).includes(candidate))
    if (name === undefined) continue
    const character = Math.max(0, String(match.text).indexOf(name))
    const started = ideNow()
    const definition = await ideLspQuery({
      operation: 'goToDefinition',
      filePath: ideAbs(root, match.path),
      workspaceRoot: root,
      position: { line: match.line - 1, character },
    }).catch(() => ({ locations: [] }))
    timeline?.mark('bind', ideNow() - started)
    const located = (definition.locations ?? [])[0]
    if (located === undefined) continue
    if (`${located.path}:${located.line}` !== clicked) continue
    anchor = match
    anchorCharacter = character
    break
  }
  if (anchor === undefined) return []

  const started = ideNow()
  const result = await ideLspQuery({
    operation: 'findReferences',
    filePath: ideAbs(root, anchor.path),
    workspaceRoot: root,
    position: { line: anchor.line - 1, character: anchorCharacter },
  }).catch(() => ({ locations: [] }))
  timeline?.mark('refs', ideNow() - started)
  return result.locations ?? []
}

/** One location's identity, for set arithmetic between queries. */
function ideLocationKey(location) {
  return `${location.path}:${location.line}`
}

/**
 * Everything the popup needs for one symbol: its implementations and its callers.
 *
 * `findReferences` always includes declarations, so they are removed here — the
 * rows this returns are the places that *use* the symbol, while implementations
 * are the places that *fulfil* it. Both lists are deduplicated against the
 * declaration itself, which is where Ctrl/Cmd+click goes instead.
 *
 * @returns `{ implementations, callers }`, each a list of `{ path, line, snippet }`.
 */
async function ideLspBrowse(store, tabPath, position, limits, timeline, onPartial, symbolName) {
  const run = async (operation, label) => {
    const started = ideNow()
    const result = await ideLspQuery(ideLspPayload(store, operation, tabPath, position))
      .then((value) => value.locations ?? [])
      .catch(() => [])
    timeline?.mark(label, ideNow() - started)
    return result
  }

  // Serialised by the provider, so each query is measured on its own: the point
  // is to publish the first section as soon as it exists instead of holding the
  // whole answer until the slowest query returns.
  const declarations = await run('goToDefinition', 'def')
  const implementations = await run('goToImplementation', 'impl')

  const declared = new Set(declarations.map(ideLocationKey))
  const implemented = new Set(implementations.map(ideLocationKey))
  const clicked = `${tabPath}:${position.line + 1}`

  const implRows = []
  const seenImpl = new Set()
  for (const location of implementations) {
    const key = ideLocationKey(location)
    if (declared.has(key) || seenImpl.has(key)) continue
    seenImpl.add(key)
    implRows.push(location)
  }

  const partial = {
    implementations: await ideWithSnippets(store, implRows.slice(0, limits.implementations)),
    callers: [],
    declaration: [],
  }
  // First paint: implementations are what a click on a contract is really about.
  if (onPartial !== undefined) onPartial(partial)

  const references = await run('findReferences', 'refs')

  const callerRows = []
  const seenCaller = new Set()
  for (const location of references) {
    const key = ideLocationKey(location)
    if (key === clicked || declared.has(key) || implemented.has(key) || seenCaller.has(key)) continue
    seenCaller.add(key)
    callerRows.push(location)
  }

  // A field or an enum constant is often declared and referenced in one place
  // only; when nothing is left after removing the declaration, the declaration
  // itself is still the useful answer.
  const needsDeclaration = implRows.length === 0 && callerRows.length === 0
  const declarationRows = needsDeclaration
    ? declarations.filter((location) => ideLocationKey(location) !== clicked)
    : []

  const callers = await ideWithSnippets(store, callerRows.slice(0, limits.callers))
  if (implRows.length === 0 && callers.length === 0) {
    // The engine answers for the accessor even though it answers nothing for the
    // field, so this branch still produces semantic callers.
    const anchored = await ideAccessorReferences(store, tabPath, position, symbolName, timeline)
    const anchoredRows = []
    const seenAnchored = new Set()
    for (const location of anchored) {
      const key = ideLocationKey(location)
      if (key === clicked || seenAnchored.has(key)) continue
      seenAnchored.add(key)
      anchoredRows.push(location)
      if (anchoredRows.length >= limits.callers) break
    }
    if (anchoredRows.length > 0) {
      return {
        implementations: partial.implementations,
        callers: await ideWithSnippets(store, anchoredRows),
        declaration: [],
        textual: [],
      }
    }
    const textual = await ideTextualCallers(store, tabPath, position, symbolName, limits.callers)
    if (textual.length > 0) {
      return { implementations: partial.implementations, callers: [], declaration: [], textual }
    }
  }
  return {
    implementations: partial.implementations,
    callers,
    declaration: await ideWithSnippets(store, declarationRows.slice(0, 1)),
    textual: [],
  }
}

/**
 * The identifier the clicked accessor is called on, from the text before it.
 *
 * Handles both `older.` and a chained receiver such as `captor.getValue().`,
 * where the interesting name sits before the closing parenthesis.
 */
function ideReceiverToken(before) {
  const text = String(before ?? '').replace(/\s+$/, '')
  if (!text.endsWith('.')) return ''
  const head = text.slice(0, -1).replace(/\s+$/, '')
  if (head.endsWith(')')) {
    let depth = 0
    for (let index = head.length - 1; index >= 0; index -= 1) {
      if (head[index] === ')') depth += 1
      else if (head[index] === '(') {
        depth -= 1
        if (depth === 0) {
          const name = /([A-Za-z_$][\w$]*)\s*$/.exec(head.slice(0, index))
          return name === null ? '' : name[1]
        }
      }
    }
    return ''
  }
  const name = /([A-Za-z_$][\w$]*)$/.exec(head)
  return name === null ? '' : name[1]
}

/**
 * The declared type of a local variable, from the open file's own source.
 *
 * `ExchangeRateInnerResp older = ...` is enough to know what `older.getX()`
 * returns without asking the engine anything.
 */
function ideDeclaredType(lines, name) {
  const pattern = new RegExp(`^\\s*(?:final\\s+)?([A-Z][\\w$]*(?:<[^;=]*>)?)\\s+${name}\\s*[;=,)]`)
  for (const text of lines) {
    const match = pattern.exec(text)
    if (match !== null) return match[1].replace(/<.*$/, '')
  }
  return ''
}

/**
 * The object a chained call hangs off, e.g. `captor` in `captor.getValue()`.
 *
 * The generic-argument trick needs the *variable*, not the method name: the
 * declaration that states `<ExchangeRateInnerQuery>` declares `captor`.
 */
function ideChainBase(before, methodName) {
  if (methodName === '') return ''
  const pattern = new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\.\\s*${methodName}\\s*\\([^()]*\\)\\s*\\.\\s*$`)
  const match = pattern.exec(String(before ?? ''))
  return match === null ? '' : match[1]
}

/**
 * The first generic type argument of a local declaration, e.g. the `T` in
 * `ArgumentCaptor<T> captor = ...`.
 *
 * A chained receiver such as `captor.getValue().getX()` returns that argument, so
 * this resolves the case without asking the engine.
 */
function ideGenericArgument(lines, name) {
  // The type may be package-qualified (`org.mockito.ArgumentCaptor<T>`), so the
  // leading segments are allowed to be lowercase and the last one must be a type.
  const declaration = new RegExp(`^\\s*(?:final\\s+)?(?:[a-z][\\w$]*\\.)*[A-Z][\\w$]*\\s*<\\s*([A-Z][\\w$]*)\\s*[,>]`)
  const binding = new RegExp(`\\b${name}\\s*[;=,)]`)
  for (const text of lines) {
    if (!binding.test(text)) continue
    const match = declaration.exec(text)
    if (match !== null) return match[1]
  }
  return ''
}

/**
 * Query `hover` and return its text, for resolving a receiver's type.
 *
 * The engine answers a method call with its signature, whose first type name is
 * the value type; a receiver the engine cannot describe yields `''`.
 */
async function ideLspHoverText(store, tabPath, position) {
  let result
  try {
    result = await ideLspQuery(ideLspPayload(store, 'hover', tabPath, position))
  } catch (error) {
    void error
    return ''
  }
  const hover = result?.hover
  if (hover === undefined || hover === null) return ''
  const contents = hover.contents
  if (typeof contents === 'string') return contents
  if (typeof contents?.value === 'string') return contents.value
  if (Array.isArray(contents)) {
    return contents.map((entry) => (typeof entry === 'string' ? entry : entry?.value ?? '')).join('\n')
  }
  return ''
}

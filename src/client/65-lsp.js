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
/**
 * Operations the server answered "not supported" for.
 *
 * A JSON-RPC `-32601` (or a message saying so) will not change within a
 * session; asking again only produces another error banner and another wait
 * before the text fallback.
 */
const ideLspUnsupported = new Set()

/**
 * Whether one error says the machine has no licence for the language server.
 *
 * The JetBrains server refuses every request with `-32802: no active JetBrains
 * license`; the only cure is signing in with a licensed account outside the
 * plugin, so this is not retried on every click.
 */
function ideLspNeedsLicense(error) {
  const text = `${error?.detail ?? ''} ${error?.message ?? ''}`
  return /-32802|no active JetBrains license/i.test(text)
}

/** Set once the server answered that this machine has no licence. */
let ideLspLicenseMissing = false

/** The URL the next real click should open, and whether we asked the host already. */
let ideLicenseUrlPending = ''
let ideLicenseRequested = false

/**
 * Start the JetBrains sign-in through the host.
 *
 * The host runs `intellij-server license login --browser` and returns the URL
 * the account flow opened. A popup without a user gesture is easy to block, so
 * the URL is also parked for the next click (`ideFlushLicenseUrl`). When the
 * machine is already signed in without a licence the tool prints guidance
 * instead of a URL; the account's licence page is the useful destination then.
 */
async function ideRequestLicenseLogin() {
  if (ideLicenseRequested) return
  ideLicenseRequested = true
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  let answer
  try {
    const response = await fetch(new URL('dsh-ide/license', base).href, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'open' }),
    })
    answer = await response.json()
  } catch (error) {
    void error
    answer = undefined
  }
  // The host opens the page with the platform browser (`open`/`xdg-open`),
  // which is the only reliable way out of a webview. `window.open` stays as a
  // fallback when the host could not launch anything.
  if (answer?.value?.opened === true) return
  const url = typeof answer?.value?.url === 'string' && answer.value.url !== ''
    ? answer.value.url
    : 'https://account.jetbrains.com/licenses'
  ideLicenseUrlPending = url
  try {
    const opened = globalThis.open?.(url, '_blank', 'noopener')
    if (opened !== null && opened !== undefined) ideLicenseUrlPending = ''
  } catch (error) {
    void error
  }
}

/** Open the parked licence page while a click's user gesture is still fresh. */
function ideFlushLicenseUrl() {
  if (ideLicenseUrlPending === '') return
  const url = ideLicenseUrlPending
  ideLicenseUrlPending = ''
  try {
    globalThis.open?.(url, '_blank', 'noopener')
  } catch (error) {
    void error
  }
}

/** Whether one error means the server does not implement this operation. */
function ideLspUnsupportedBy(error) {
  const text = `${error?.detail ?? ''} ${error?.message ?? ''}`
  return /-32601|method not found|not supported|unsupported/i.test(text)
}

async function ideLspQuery(payload, signal) {
  if (ideLspLicenseMissing) {
    const refused = new Error('no active JetBrains license')
    refused.code = 'LSP_NO_LICENSE'
    refused.detail = 'the language server has no active licence on this machine'
    throw refused
  }
  if (ideLspUnsupported.has(payload?.operation)) {
    const skipped = new Error('operation not supported by the server')
    skipped.code = 'lsp-unsupported'
    throw skipped
  }
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
    if (ideLspUnsupportedBy(failure) && typeof payload?.operation === 'string') {
      ideLspUnsupported.add(payload.operation)
    }
    if (ideLspNeedsLicense(failure)) {
      // First refusal: start the sign-in so the page is one click away.
      if (!ideLspLicenseMissing) void ideRequestLicenseLogin()
      ideLspLicenseMissing = true
    }
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
/**
 * The line declaring an annotation attribute, ignoring mentions in comments.
 *
 * Annotation sources often document themselves with `{@link #name()}`, so a naive
 * search lands in the javadoc instead of the declaration.
 *
 * @returns the 0-based index, or -1 when no declaration is found.
 */
function ideAttributeLineIn(lines, attribute) {
  if (!Array.isArray(lines) || typeof attribute !== 'string' || attribute === '') return -1
  const call = new RegExp(`\\b${attribute}\\s*\\(`)
  const declaration = new RegExp(`^\\s*(?:(?:public|protected|private|abstract|default|static|final)\\s+)*[\\w<>\\[\\].?, ]+\\b${attribute}\\s*\\(`)
  let fallback = -1
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!call.test(line)) continue
    const trimmed = line.trim()
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('@')) continue
    if (declaration.test(line)) return index
    if (fallback < 0) fallback = index
  }
  return fallback
}

/**
 * The annotation type whose argument list contains `position`, if any.
 *
 * Annotation attributes are written `@Log(name = "x")`, so a click on `name`
 * resolves nothing on its own: the declaration lives in the annotation type, and
 * that type is usually imported from a dependency.
 *
 * @returns the simple type name, or an empty string when the position is not
 * inside an annotation's arguments.
 */
function ideAnnotationTypeAt(lines, position) {
  const line = lines?.[position?.line] ?? ''
  if (line === '') return ''
  // A multi-line annotation puts the type on an earlier line, so look back a
  // little; the stray `)` check below keeps an already-closed annotation out.
  const start = Math.max(0, position.line - 3)
  const text = lines.slice(start, position.line).join('\n') + '\n' + line.slice(0, position.character)
  const matches = [...text.matchAll(/@([A-Z][\w$]*)\s*\(/g)]
  if (matches.length === 0) return ''
  const last = matches[matches.length - 1]
  let depth = 0
  for (const character of text.slice(last.index + last[0].length)) {
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth < 0) return ''
    }
  }
  return last[1]
}

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

/** Files one textual caller search may read while checking receivers. */
const IDE_MAX_TEXTUAL_FILES = 12

/** Escape one identifier for a regular expression. */
function ideRegexEscape(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The property an accessor name implies: `getName` → `name`, `isActive` → `active`. */
function ideAccessorProperty(name) {
  const match = /^(?:get|set|is)([A-Z][\w$]*)$/.exec(String(name ?? ''))
  if (match === null) return ''
  return match[1].charAt(0).toLowerCase() + match[1].slice(1)
}

/** Whether one line declares a type named `name` (`public class Name {`). */
function ideIsTypeDeclaration(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || name === '') return false
  const pattern = new RegExp(`^\\s*(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed)\\s+)*(?:class|interface|enum|record|@interface)\\s+${ideRegexEscape(name)}\\b`)
  return pattern.test(text)
}

/** Whether one line declares a field named `name` (`private String name;`). */
function ideIsFieldDeclaration(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || name === '') return false
  // `return refundNo;` states a type-like token before the name too; only a
  // declaration starts with modifiers/type and nothing else.
  if (/^(?:return|throw|else|if|for|while|switch|case|yield|assert|System)\b/.test(text.trim())) return false
  const pattern = new RegExp(`^\\s*(?:(?:public|protected|private|static|final|transient|volatile)\\s+)*[A-Za-z_$][\\w$<>\\[\\],.?]*\\s+${ideRegexEscape(name)}\\s*[;=]`)
  return pattern.test(text)
}

/**
 * The receiver a call is made on, including a chain broken across lines.
 *
 * `paymentRecordOrderRelationRepository` on the line above and
 * `.listByPaymentTradeNos(...)` on this one is one expression; reading only the
 * current line loses the receiver and the owner of the method with it.
 */
function ideReceiverOfCall(lines, line, character) {
  const text = String((lines ?? [])[line] ?? '')
  const before = text.slice(0, Math.max(0, character))
  if (before.trim() !== '' && !/^\s*\./.test(text)) return ideReceiverToken(before)
  for (let index = line - 1; index >= 0 && index >= line - 16; index -= 1) {
    const previous = String(lines[index] ?? '').trim()
    if (previous === '') continue
    const match = /([A-Za-z_$][\w$]*)\s*$/.exec(previous)
    if (match !== null) return match[1]
    if (!/[.([,]\s*$/.test(previous)) return ''
  }
  return ''
}

/**
 * The dotted expression a call is made on: `PurchaseOrderStatusEnum.TO_PURCHASE`.
 *
 * A single identifier is not enough when the receiver is a static call target or
 * an enum constant — the class that owns the method is the leftmost segment.
 */
function ideReceiverChain(lines, line, character) {
  const text = String((lines ?? [])[line] ?? '')
  const before = text.slice(0, Math.max(0, character)).replace(/\s+$/, '')
  const tail = /[A-Za-z0-9_$.]+$/.exec(before.replace(/\($/, ''))
  const sameLine = tail === null ? '' : tail[0].replace(/\.$/, '')
  if (sameLine !== '' && !/^\s*\./.test(text)) return sameLine
  // A chain broken before the dot: the receiver sits on an earlier line.
  for (let index = line - 1; index >= 0 && index >= line - 16; index -= 1) {
    const previous = String(lines[index] ?? '').trim()
    if (previous === '') continue
    const found = /([A-Za-z0-9_$.]+)\s*$/.exec(previous)
    if (found !== null) return found[1].replace(/\.$/, '')
    if (!/[.([,]\s*$/.test(previous)) return ''
  }
  return ''
}

/** Grep pattern for a declaration of `name`: a type token, then the name. */
function ideDeclarationPattern(name) {
  return `[A-Za-z0-9_$<>\\[\\],.?]+\\s+${ideRegexEscape(name)}\\s*\\(`
}

/** Whether one line declares `name` rather than using it. */
function ideTextualIsDeclaration(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || name === '') return false
  const use = new RegExp(`\\b${ideRegexEscape(name)}\\s*\\(`)
  if (!use.test(text)) return false
  const declaration = new RegExp(
    `^\\s*(?:(?:public|protected|private|static|final|abstract|synchronized|default|native)\\s+)*[\\w$<>\\[\\],.?\\s]+\\s+${ideRegexEscape(name)}\\s*\\(`,
  )
  return declaration.test(text)
}

/**
 * Whether one reference row is the method's own declaration.
 *
 * `findReferences` answers with declarations too — the contract's signature
 * line, an override in another class — and those are not call sites.
 */
function ideReferenceIsDeclaration(lines, line, name) {
  const text = String((lines ?? [])[line - 1] ?? '')
  return ideTextualIsDeclaration(text, name)
}

/** Whether one line is a call of `name`, rather than its declaration. */
function ideTextualIsCall(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || name === '') return false
  const use = new RegExp(`\\b${ideRegexEscape(name)}\\s*\\(`)
  return use.test(text) && !ideTextualIsDeclaration(text, name)
}

/** Whether one call line invokes `name` through a receiver (`obj.name(`). */
function ideTextualIsReceiverCall(text, name) {
  return new RegExp(`\\.\\s*${ideRegexEscape(name)}\\s*\\(`).test(String(text ?? ''))
}

/**
 * Text fallback for symbols the engine reports no usages for.
 *
 * Two shapes matter:
 *  - a **method**: search its own name at call sites, and for a non-static one
 *    keep only receiver calls (`service.detail(...)`) — a bare `detail(...)` is
 *    usually a different local helper;
 *  - a **field** (Lombok-style property): the field has no accessor in the
 *    sources and references on it answer only its declaration, so its
 *    `getX`/`setX`/`isX` call sites are the closest thing to usages.
 *
 * The popup labels these rows as text matches; they are never presented as
 * semantic references.
 */
async function ideTextualCallers(store, tabPath, position, symbolName, limit, options = {}) {
  if (typeof symbolName !== 'string' || symbolName === '') return []
  const root = store.getState().rootPath
  if (root === '') return []
  const clicked = `${tabPath}:${position.line + 1}`
  // Files are read once each while checking receivers: a name match in a class
  // that holds something else is not a call of this method.
  const fileCache = new Map()
  const linesOf = async (path) => {
    if (fileCache.has(path)) return fileCache.get(path)
    if (fileCache.size >= IDE_MAX_TEXTUAL_FILES) return undefined
    const result = await store.readText(store.getState().sessionId, root, path).catch(() => undefined)
    const lines = result?.ok === true && typeof result.value === 'string' ? result.value.split('\n') : undefined
    fileCache.set(path, lines)
    return lines
  }
  const receiverBelongsTo = async (path, urlLineIndex, text, name) => {
    const lines = await linesOf(path)
    if (lines === undefined) return false
    const line = lines[urlLineIndex] ?? text
    // The first substring may be another identifier (`statisticsResp`); only the
    // occurrence that is followed by `(` is the call.
    const call = new RegExp(`\\b${ideRegexEscape(name)}\\s*\\(`).exec(line)
    if (call === null) return false
    const receiver = ideReceiverChain(lines, urlLineIndex, call.index).split('.')[0]
    if (receiver === '') return false
    const owners = Array.isArray(options.ownerNames) && options.ownerNames.length > 0 ? options.ownerNames : ['']
    const declared = ideDeclaredType(lines, receiver)
    if (owners.includes('') || owners.includes(declared)) return true
    // `ReconBillConverter.toDifferenceResp(…)` keeps the class name as the
    // receiver (a static call, or Lombok's @UtilityClass); the class itself is
    // the owner, so the receiver is one.
    return /^[A-Z]/.test(receiver) && owners.includes(receiver)
  }
  const collect = async (pattern, names, requireReceiver) => {
    const found = await ideGrepQuery(root, pattern, { caseSensitive: true, extensions: IDE_CODE_EXTENSIONS })
    if (found.ok !== true) return []
    const rows = []
    const seen = new Set()
    for (const match of found.matches) {
      const key = `${match.path}:${match.line}`
      if (key === clicked || seen.has(key)) continue
      const text = String(match.text ?? '')
      const name = names.find((candidate) => ideTextualIsCall(text, candidate))
      if (name === undefined) continue
      if (requireReceiver && !ideTextualIsReceiverCall(text, name)) continue
      if (requireReceiver && !(await receiverBelongsTo(match.path, match.line - 1, text, name))) continue
      seen.add(key)
      rows.push({ path: match.path, line: match.line, snippet: match.text })
    }
    return rows
  }

  const exact = await collect(`\\b${ideRegexEscape(symbolName)}\\s*\\(`, [symbolName], options.requireReceiver === true)
  if (exact.length > 0) return exact.slice(0, limit)
  // No call of the symbol itself: a property's accessors are the fallback.
  const accessors = ideAccessorNames(symbolName)
  if (accessors.length === 0) return []
  const byAccessor = await collect(`\\b(?:${accessors.map(ideRegexEscape).join('|')})\\s*\\(`, accessors, false)
  return byAccessor.slice(0, limit)
}

/**
 * Textual implementations of an interface method.
 *
 * Used only when the engine answered nothing: find the classes that implement
 * the clicked file's interface, then the declaration of the method inside them.
 */
async function ideTextualImplementations(store, tabPath, sourceLines, symbolName, limit) {
  const root = store.getState().rootPath
  const className = ideClassName(tabPath)
  if (root === '' || className === '' || typeof symbolName !== 'string' || symbolName === '') return []
  // An interface is extended by implementations; an abstract class by
  // subclasses. Either way the override is what a click on the contract wants.
  const isInterface = sourceLines.some((line) => new RegExp(`\\binterface\\s+${ideRegexEscape(className)}\\b`).test(line))
  const isAbstract = !isInterface && sourceLines.some((line) => new RegExp(`\\babstract\\s+class\\s+${ideRegexEscape(className)}\\b`).test(line))
  if (!isInterface && !isAbstract) return []
  const relation = isInterface ? 'implements' : 'extends'
  const typed = await ideGrepQuery(root, `${relation}[^\\n{]*\\b${ideRegexEscape(className)}\\b`, {
    caseSensitive: true,
    extensions: IDE_CODE_EXTENSIONS,
  })
  if (typed.ok !== true) return []
  const rows = []
  const seen = new Set()
  for (const match of typed.matches) {
    const key = match.path
    if (seen.has(key)) continue
    seen.add(key)
    const declared = await ideGrepQuery(root, `\\b${ideRegexEscape(symbolName)}\\s*\\(`, { path: match.path, caseSensitive: true })
    if (declared.ok !== true) continue
    for (const line of declared.matches) {
      if (!ideTextualIsDeclaration(line.text, symbolName)) continue
      rows.push({ path: line.path, line: line.line, snippet: line.text })
      break
    }
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

/** `LSP_SERVER_ERROR — textDocument/references: Method not found (-32601)`. */
function ideLspFailureText(failure) {
  if (failure === undefined || failure === null) return ''
  if (ideLspNeedsLicense(failure) || failure.code === 'LSP_NO_LICENSE') {
    return `license: ${typeof failure.detail === 'string' ? failure.detail : 'no active JetBrains license'}`
  }
  const code = typeof failure.code === 'string' ? failure.code : 'lsp-failed'
  const operation = typeof failure.operation === 'string' ? `${failure.operation}: ` : ''
  const detail = typeof failure.detail === 'string' && failure.detail !== '' ? ` — ${failure.detail}` : ''
  return `${code}${detail === '' ? '' : `${detail}`}${operation === '' ? '' : ` (${operation.replace(/: $/, '')})`}`
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
  const failures = []
  const run = async (operation, label) => {
    const started = ideNow()
    const result = await ideLspQuery(ideLspPayload(store, operation, tabPath, position))
      .then((value) => value.locations ?? [])
      .catch((error) => {
        // The server states why; the banner is the only place that reason can
        // reach the reader, so keep the first one verbatim.
        failures.push({
          operation,
          code: typeof error?.code === 'string' ? error.code : 'lsp-failed',
          detail: String(error?.detail ?? '').slice(0, 160),
        })
        return []
      })
    timeline?.mark(label, ideNow() - started)
    return result
  }

  // Serialised by the provider, so each query is measured on its own: the point
  // is to publish the first section as soon as it exists instead of holding the
  // whole answer until the slowest query returns.
  const declarations = await run('goToDefinition', 'def')
  const implementations = await run('goToImplementation', 'impl')
  // The clicked line says what kind of symbol this is: a method is followed by
  // `(`, and `static` says whether a bare call may reach it.
  const sourceLines = await store.readLines(tabPath)
  const clickedLine = String(sourceLines[position.line] ?? '')
  // The column points at the symbol itself, so what follows the name says
  // whether this is a method (a `(` next) or a field.
  const afterName = clickedLine.slice(position.character + String(symbolName ?? '').length)
  const isMethod = afterName.trimStart().startsWith('(')
  const isStatic = /\bstatic\b/.test(clickedLine)
  // A caller may hold the interface type while this file is the implementation.
  const ownerNames = [ideClassName(tabPath), ...ideContractNames(sourceLines)].filter((name) => name !== '')

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
  // The popup has the same blind spot as the counter: a caller holding the
  // interface never appears among the implementation's references.
  if (typeof symbolName === 'string' && symbolName !== '') {
    const contract = await ideContractReferences(store, tabPath, sourceLines, symbolName)
    const known = new Set(references.map(ideLocationKey))
    for (const location of contract) {
      const key = ideLocationKey(location)
      if (known.has(key)) continue
      known.add(key)
      references.push(location)
    }
  }

  // Reading the files that own the references lets a declaration that came
  // through the contract merge (the interface's own signature) be dropped: it
  // is the method, not a caller of it.
  const referenceLines = new Map()
  const linesOfReference = async (path) => {
    let pending = referenceLines.get(path)
    if (pending === undefined) {
      pending = Promise.resolve(store.readLines(path)).then((lines) => (Array.isArray(lines) ? lines : [])).catch(() => [])
      referenceLines.set(path, pending)
    }
    return pending
  }
  const callerRows = []
  const seenCaller = new Set()
  for (const location of references) {
    const key = ideLocationKey(location)
    if (key === clicked || declared.has(key) || implemented.has(key) || seenCaller.has(key)) continue
    if (typeof symbolName === 'string' && symbolName !== '' && typeof location?.path === 'string' && typeof location?.line === 'number') {
      const lines = await linesOfReference(location.path)
      if (ideReferenceIsDeclaration(lines, location.line, symbolName)) continue
    }
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
    // field, so this branch still produces semantic callers. It only makes sense
    // for a field: `detail` and `getDetail` are different methods.
    const anchored = isMethod ? [] : await ideAccessorReferences(store, tabPath, position, symbolName, timeline)
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
    const textual = await ideTextualCallers(store, tabPath, position, symbolName, limits.callers, {
      // A non-static method is reached through a receiver; a bare same-name call
      // is usually a different local helper, and a receiver of another declared
      // type is a different method with the same name.
      requireReceiver: isMethod && !isStatic,
      ownerNames,
    })
    const implementationsText = await ideTextualImplementations(store, tabPath, sourceLines, symbolName, limits.implementations)
    if (textual.length > 0 || implementationsText.length > 0) {
      return {
        implementations: partial.implementations,
        implementationsText,
        callers: [],
        declaration: [],
        textual,
        failed: '',
      }
    }
  }
  return {
    implementations: partial.implementations,
    implementationsText: [],
    callers,
    declaration: await ideWithSnippets(store, declarationRows.slice(0, 1)),
    textual: [],
    // Every query failing is a server problem, not "no usages": the popup must
    // not tell the reader the symbol is unused when nothing answered.
    failed: failures.length === 3 ? ideLspFailureText(failures[0]) : '',
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
  // `private final Type field;` is how a controller holds its service; the
  // modifiers must not stop the declaration from being recognised.
  const pattern = new RegExp(`^\\s*(?:(?:public|protected|private|static|final|transient|volatile)\\s+)*([A-Z][\\w$]*(?:<[^;=]*>)?)\\s+${name}\\s*[;=,)]`)
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

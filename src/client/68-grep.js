/**
 * Content search, through this plugin's own Host route.
 *
 * DSH exposes no content-search service to Client halves, so the Host half runs
 * the ripgrep binary the app already ships and returns `{ path, line, text }`
 * rows. That keeps "search everything" honest: the text tab shows real matches
 * with their line numbers, not an approximation.
 */

/** The grep route, resolved against the page base so proxy prefixes survive. */
function ideGrepUrl() {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  return new URL('dsh-ide/grep', base).href
}

/**
 * Ask the Host for content matches.
 *
 * @param options - optional `path` (one file or directory inside the
 *   workspace), `caseSensitive`, and `extensions` (source suffixes; the Host
 *   turns them into ripgrep include globs).
 * @returns `{ ok: true, matches, truncated }` or `{ ok: false, error }`.
 */
async function ideGrepQuery(root, query, options = {}) {
  const { path: scope, caseSensitive, extensions, signal } = options
  let response
  try {
    response = await fetch(ideGrepUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        workspaceRoot: root,
        ...scope === undefined || scope === '' ? {} : { path: scope },
        ...caseSensitive === true ? { caseSensitive: true } : {},
        ...Array.isArray(extensions) && extensions.length > 0 ? { extensions } : {},
      }),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  if (parsed.ok !== true) return { ok: false, error: parsed.error?.code ?? 'grep-failed' }
  return {
    ok: true,
    matches: Array.isArray(parsed.value?.matches) ? parsed.value.matches : [],
    truncated: parsed.value?.truncated === true,
  }
}

/** The diff route, resolved against the page base. */
function ideDiffUrl() {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  return new URL('dsh-ide/diff', base).href
}

/**
 * Ask the Host which lines of one file differ from `HEAD`.
 *
 * @returns `{ ok: true, untracked, hunks }` or `{ ok: false, error }`.
 */
async function ideDiffQuery(root, path, signal) {
  let response
  try {
    response = await fetch(ideDiffUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: root, path }),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  if (parsed.ok !== true) return { ok: false, error: parsed.error?.code ?? 'diff-failed' }
  return {
    ok: true,
    untracked: parsed.value?.untracked === true,
    hunks: Array.isArray(parsed.value?.hunks) ? parsed.value.hunks : [],
  }
}

/** The blame route, resolved against the page base. */
function ideBlameUrl() {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  return new URL('dsh-ide/blame', base).href
}

/**
 * Ask the Host for the last commit that touched each line of one file.
 *
 * @returns `{ ok: true, lines }` or `{ ok: false, error }`; `lines` carries
 *   `{ line, author, time }` entries, one per line git knows.
 */
async function ideBlameQuery(root, path, signal) {
  let response
  try {
    response = await fetch(ideBlameUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: root, path }),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  if (parsed.ok !== true) return { ok: false, error: parsed.error?.code ?? 'blame-failed' }
  return { ok: true, lines: Array.isArray(parsed.value?.lines) ? parsed.value.lines : [] }
}

/** The doctor route, resolved against the page base. */
function ideDoctorUrl() {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  return new URL('dsh-ide/doctor', base).href
}

/**
 * Ask the Host whether the LSP seam is mounted in this profile.
 *
 * @returns `{ ok: true, lsp }` or `{ ok: false, error }`.
 */
async function ideDoctorQuery() {
  let response
  try {
    response = await fetch(ideDoctorUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  } catch (error) {
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  if (parsed.ok !== true) return { ok: false, error: parsed.error?.code ?? 'doctor-failed' }
  return { ok: true, lsp: parsed.value?.lsp === true }
}

/** The Java-kind route, resolved against the page base. */
function ideKindsUrl() {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  return new URL('dsh-ide/kinds', base).href
}

/**
 * Ask the Host for the Java declaration kind of a handful of files.
 *
 * @returns `{ ok: true, kinds }` (a `path → kind` map) or `{ ok: false, error }`.
 */
async function ideKindsQuery(root, paths) {
  let response
  try {
    response = await fetch(ideKindsUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: root, paths }),
    })
  } catch (error) {
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  if (parsed.ok !== true) return { ok: false, error: parsed.error?.code ?? 'kinds-failed' }
  return { ok: true, kinds: parsed.value?.kinds ?? {} }
}

/** The jar-source route, resolved against the page base. */
function ideJarUrl() {
  const base = typeof document !== 'undefined' && typeof document.baseURI === 'string'
    ? document.baseURI
    : 'http://dsh.internal/'
  return new URL('dsh-ide/jar', base).href
}

/**
 * Read a class source out of the Maven `-sources.jar` files.
 *
 * A dependency jar is outside the workspace Remote's reach, so the Host reads the
 * ZIP itself. Binary-only jars answer `found: false`; nothing is decompiled.
 *
 * @returns `{ ok: true, found, jar, text }` or a failure.
 */
async function ideJarSourceQuery(className, signal) {
  let response
  try {
    response = await fetch(ideJarUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ className }),
      signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, error: 'network' }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, error: `http-${response.status}` }
  if (parsed.ok !== true) return { ok: false, error: parsed.error?.code ?? 'jar-failed' }
  const value = parsed.value ?? {}
  return {
    ok: true,
    found: value.found === true,
    jar: typeof value.jar === 'string' ? value.jar : '',
    text: typeof value.text === 'string' ? value.text : '',
  }
}

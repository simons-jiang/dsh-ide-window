/**
 * dsh-ide-window — Host half.
 *
 * The code workspace's navigation is semantic: Ctrl/Cmd+click asks for a
 * definition, a plain click asks for references. DSH already owns that
 * capability in the `ctx.lsp` seam (`goToDefinition`, `findReferences`,
 * `goToImplementation`, `hover`), which `@deepseek-ai/dsh-lsp-stdio` backs with
 * a real language server — Eclipse JDT LS for Java.
 *
 * A Client plugin cannot call a Host service, so this half is the one route the
 * browser needs: `POST /dsh-ide/lsp` forwards one query to `ctx.lsp` and returns
 * locations as workspace-relative paths and 1-based lines, which is the shape
 * the editor already understands.
 *
 * The route is fenced the same way the shipped browser surfaces are: the
 * connection service answers whether the request may be served at all.
 */
import { spawn } from 'node:child_process'
import { existsSync, openSync, fstatSync, readSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { inflateRawSync } from 'node:zlib'

export const name = 'dsh-ide-window'

/** The Web carrier is the only hard dependency; `lsp` is read lazily. */
export const inject = ['webServer']

/** The two routes this plugin serves. */
const ROUTE_LSP = '/dsh-ide/lsp'
const ROUTE_GREP = '/dsh-ide/grep'
const ROUTE_DIFF = '/dsh-ide/diff'
const ROUTE_JAR = '/dsh-ide/jar'
const ROUTE_STATUS = '/dsh-ide/status'

/** Largest number of content matches returned by one grep. */
const MAX_GREP_MATCHES = 200

/**
 * Packaged ripgrep, resolved from this Electron app's own resources.
 *
 * DSH ships rg as an unpacked native binary; only that copy is executable, so
 * the asar path alone is useless. Candidates are tried in order and the first
 * existing one wins, which keeps this working across app updates that move the
 * package version inside the path.
 */
function resolveRipgrep() {
  const resources = process.resourcesPath ?? ''
  const bases = [
    `${resources}/app.asar.unpacked/dsh/node_modules`,
    `${resources}/app.asar/dsh/node_modules`,
  ]
  const suffixes = [
    '@vscode/ripgrep-darwin-arm64/bin/rg',
    '@vscode/ripgrep-darwin-x64/bin/rg',
    '@vscode/ripgrep-linux-arm64/bin/rg',
    '@vscode/ripgrep-linux-x64/bin/rg',
  ]
  for (const base of bases) {
    for (const suffix of suffixes) {
      const candidate = `${base}/${suffix}`
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

/** One `--vimgrep` line: `path:line:column:text`. */
function parseGrepLine(line, root) {
  const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(line)
  if (match === null) return undefined
  const [, raw, lineText, , text] = match
  // rg searches `.` from the workspace root, so every hit arrives as `./a/b`.
  // Stripping that prefix is what makes the path usable by the editor, whose
  // addresses are workspace-relative without a leading `./`.
  const trimmed = raw.startsWith('./') ? raw.slice(2) : raw
  return {
    path: relativize(root, trimmed),
    line: Number(lineText),
    text: text.trim().slice(0, 400),
  }
}

/** Read the central directory of a ZIP/JAR and return `name → entry`. */
function readZipIndex(file, wanted) {
  let fd
  try {
    fd = openSync(file, 'r')
    const size = fstatSync(fd).size
    const tailLength = Math.min(size, 66000)
    const tail = Buffer.alloc(tailLength)
    readSync(fd, tail, 0, tailLength, size - tailLength)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) return undefined
    const count = tail.readUInt16LE(eocd + 10)
    const directoryOffset = tail.readUInt32LE(eocd + 16)
    const directoryLength = tail.readUInt32LE(eocd + 12)
    const directory = Buffer.alloc(directoryLength)
    readSync(fd, directory, 0, directoryLength, directoryOffset)
    let at = 0
    for (let i = 0; i < count; i += 1) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50) break
      const method = directory.readUInt16LE(at + 10)
      const compressed = directory.readUInt32LE(at + 20)
      const uncompressed = directory.readUInt32LE(at + 24)
      const nameLength = directory.readUInt16LE(at + 28)
      const extraLength = directory.readUInt16LE(at + 30)
      const commentLength = directory.readUInt16LE(at + 32)
      const localOffset = directory.readUInt32LE(at + 42)
      const name = directory.toString('utf8', at + 46, at + 46 + nameLength)
      if (name === wanted) return { method, compressed, uncompressed, localOffset }
      at += 46 + nameLength + extraLength + commentLength
    }
    return undefined
  } catch (error) {
    void error
    return undefined
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch (error) { void error }
    }
  }
}

/** Extract one already-indexed ZIP entry. */
function readZipEntry(file, entry) {
  let fd
  try {
    fd = openSync(file, 'r')
    const header = Buffer.alloc(30)
    readSync(fd, header, 0, 30, entry.localOffset)
    const nameLength = header.readUInt16LE(26)
    const extraLength = header.readUInt16LE(28)
    const start = entry.localOffset + 30 + nameLength + extraLength
    const data = Buffer.alloc(entry.compressed)
    readSync(fd, data, 0, entry.compressed, start)
    if (entry.method === 0) return data.toString('utf8')
    return inflateRawSync(data).toString('utf8')
  } catch (error) {
    void error
    return undefined
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd) } catch (error) { void error }
    }
  }
}

/** Where a dependency's sources are expected to live. */
const MAVEN_REPOSITORY = `${homedir()}/.m2/repository`

/** Lookup results, keyed by entry path: jars do not change under a snapshot name. */
const jarLookups = new Map()

/** Every `-sources.jar` under the Maven repository, newest first. */
function listSourcesJars() {
  const jars = []
  const walk = (directory, depth) => {
    if (depth > 6) return
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      void error
      return
    }
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) {
        walk(path, depth + 1)
        continue
      }
      if (!entry.name.endsWith('-sources.jar')) continue
      try {
        jars.push({ path, mtime: statSync(path).mtimeMs })
      } catch (error) {
        void error
      }
    }
  }
  walk(MAVEN_REPOSITORY, 0)
  jars.sort((a, b) => b.mtime - a.mtime)
  return jars.map((jar) => jar.path)
}

/**
 * Find and read a class source out of the Maven `-sources.jar` files.
 *
 * A dependency jar exposes no files to the workspace Remote, so this route reads
 * the ZIP index itself. Binary-only jars resolve to `{ found: false }`: nothing
 * is decompiled.
 */
function jarSource(payload) {
  const className = typeof payload?.className === 'string' ? payload.className.trim() : ''
  if (!/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(className)) {
    throw new RouteError(400, 'invalid-arguments', 'className must be a fully qualified name')
  }
  const entryPath = `${className.replace(/\./g, '/')}.java`
  const cached = jarLookups.get(entryPath)
  if (cached !== undefined) {
    const hit = readZipIndex(cached.jar, entryPath)
    const text = hit === undefined ? undefined : readZipEntry(cached.jar, hit)
    if (text !== undefined) return { found: true, jar: cached.jar, entry: entryPath, text }
    jarLookups.delete(entryPath)
  }
  const jars = listSourcesJars()
  const budget = Math.min(jars.length, 600)
  for (let index = 0; index < budget; index += 1) {
    const file = jars[index]
    const entry = readZipIndex(file, entryPath)
    if (entry === undefined) continue
    const text = readZipEntry(file, entry)
    if (text === undefined) continue
    jarLookups.set(entryPath, { jar: file })
    return { found: true, jar: file, entry: entryPath, text }
  }
  return { found: false, scanned: budget }
}

/** Run one command and collect its output; never throws on a non-zero exit. */
function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', () => resolve({ code: -1, stdout: '', stderr: 'spawn-failed' }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

/** Largest number of diff hunks reported for one file. */
const MAX_DIFF_HUNKS = 4000

/**
 * Line ranges this file changed relative to `HEAD`.
 *
 * Uses plain `git diff -U0` against HEAD (so staged and unstaged changes are
 * both covered) and turns the hunk headers into line ranges of the *current*
 * file, which is what a change bar needs to paint. A file git does not track is
 * reported as wholly added, the way an editor shows a new file.
 */
/**
 * Parse `git status --porcelain=v1 -z` output into the files it lists.
 *
 * The NUL-separated form is the one to read: the line form quotes every path
 * git considers unsafe — a space, a quote, a non-ASCII byte — and an escaped
 * path is not a path, it is a C string literal. A Chinese file name arrives
 * there as `"docs/\345\271\270..."` (the octal UTF-8 bytes), which the card
 * would print verbatim and no jump could ever open. Nothing is quoted here.
 *
 * The status codes come straight from git so the card can say「M」/「A」/「?」
 * without inventing anything. In this form a rename or a copy is `XY <new> NUL
 * <old>`, so the old path's field carries no status prefix and is skipped: the
 * new path is the file that exists.
 *
 * @param text - NUL-separated porcelain output.
 * @returns `{ path, status }` entries in git's own order.
 */
export function parseStatus(text) {
  const entries = []
  const fields = String(text ?? '').split('\0')
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]
    if (field.length < 4) continue
    const status = field.slice(0, 2).trim() || '?'
    const path = field.slice(3)
    if (path === '') continue
    entries.push({ path, status })
    // R and C both carry a second field (the original path) that has no status.
    if (status.includes('R') || status.includes('C')) index += 1
  }
  return entries
}

/** List the files a workspace has not committed yet. */
export async function statusWorkspace(payload) {
  const root = typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot : ''
  if (root === '') throw new RouteError(400, 'invalid-arguments', 'workspaceRoot is required')
  const result = await runCommand('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], root)
  if (result.code !== 0) return { files: [], failed: true }
  const files = parseStatus(result.stdout)
  return { files: files.slice(0, 200), total: files.length }
}

async function diffWorkspace(payload) {
  const root = typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot : ''
  const rel = typeof payload?.path === 'string' ? payload.path.trim() : ''
  if (root === '' || rel === '') throw new RouteError(400, 'invalid-arguments', 'workspaceRoot and path are required')
  if (rel.startsWith('/') || rel.split('/').includes('..')) {
    throw new RouteError(400, 'invalid-scope', 'path must stay inside the workspace')
  }
  const tracked = await runCommand('git', ['ls-files', '--error-unmatch', '--', rel], root)
  if (tracked.code !== 0) return { untracked: true, hunks: [] }
  const diff = await runCommand('git', ['diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff', '--', rel], root)
  if (diff.code !== 0) return { untracked: false, hunks: [], failed: true }
  const hunks = []
  for (const line of diff.stdout.split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match === null) continue
    const oldCount = match[2] === undefined ? 1 : Number(match[2])
    const newStart = Number(match[3])
    const newCount = match[4] === undefined ? 1 : Number(match[4])
    if (newCount === 0) {
      // A pure deletion has no lines of its own; it is anchored after the line
      // that preceded it so the bar can mark the boundary.
      hunks.push({ start: Math.max(1, newStart), end: Math.max(1, newStart), kind: 'deleted' })
    } else {
      hunks.push({ start: newStart, end: newStart + newCount - 1, kind: oldCount === 0 ? 'added' : 'modified' })
    }
    if (hunks.length >= MAX_DIFF_HUNKS) break
  }
  return { untracked: false, hunks }
}

/**
 * Run one content search through the packaged ripgrep.
 *
 * Bounded on three axes: the caller's query, a hard match cap that terminates
 * rg as soon as it is reached, and a byte cap on the collected output.
 */
function grepWorkspace(payload) {
  const binary = resolveRipgrep()
  if (binary === undefined) {
    throw new RouteError(503, 'grep-unavailable', 'the bundled ripgrep could not be located')
  }
  const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
  if (query === '') throw new RouteError(400, 'query-required', 'query is required')
  const root = typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot : ''
  if (root === '') throw new RouteError(400, 'invalid-arguments', 'workspaceRoot is required')
  // Optional scope: one workspace-relative file or directory. Anything that
  // escapes the workspace is refused rather than resolved.
  const rawScope = typeof payload?.path === 'string' ? payload.path.trim() : ''
  if (rawScope.startsWith('/') || rawScope.split('/').includes('..')) {
    throw new RouteError(400, 'invalid-scope', 'path must stay inside the workspace')
  }
  const scope = rawScope === '' ? '.' : rawScope
  const caseFlag = payload?.caseSensitive === true ? '--case-sensitive' : '--smart-case'

  return new Promise((resolve, reject) => {
    const argv = [
      '--vimgrep',
      '--no-heading',
      '--line-number',
      '--with-filename',
      caseFlag,
      '--max-filesize', '1M',
      '--glob', '!**/.git/**',
      '--glob', '!**/node_modules/**',
      '--glob', '!**/target/**',
      '--max-count', '20',
      '--', query, scope,
    ]
    const child = spawn(binary, argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const matches = []
    let buffer = ''
    let settled = false
    const finish = (failure) => {
      if (settled) return
      settled = true
      if (failure !== undefined) reject(failure)
      else resolve({ matches, truncated: matches.length >= MAX_GREP_MATCHES })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        const parsed = parseGrepLine(line, root)
        if (parsed !== undefined && parsed.path !== '') matches.push(parsed)
        if (matches.length >= MAX_GREP_MATCHES) {
          child.kill('SIGTERM')
          buffer = ''
          finish()
          return
        }
        index = buffer.indexOf('\n')
      }
    })
    child.on('error', (error) => finish(new RouteError(500, 'grep-failed', error.message)))
    // rg exits 1 when nothing matched; that is an empty result, not a failure.
    child.on('close', (code) => {
      if (code === 0 || code === 1) finish()
      else finish(new RouteError(200, 'grep-failed', `ripgrep exited with ${code}`))
    })
  })
}

/** Largest JSON request body accepted. */
const MAX_BODY_BYTES = 16 * 1024

/** The four queries the seam exposes; anything else is a caller bug. */
const OPERATIONS = new Set(['goToDefinition', 'findReferences', 'goToImplementation', 'hover'])

/** One failure carrying an HTTP status and a stable code. */
class RouteError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Write one JSON response. */
function writeJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(body)
}

/** Read and parse the request body under a byte cap. */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new RouteError(413, 'body-too-large', 'request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    void error
    throw new RouteError(400, 'invalid-json', 'request body is not valid JSON')
  }
}

/** `file:` URI to a platform path, tolerating a non-file URI. */
function uriToPath(uri) {
  try {
    return fileURLToPath(uri)
  } catch (error) {
    void error
    return undefined
  }
}

/** Make an absolute path relative to the resolved workspace root. */
function relativize(root, path) {
  if (root === undefined || path === undefined) return path
  const base = root.replace(/\/+$/, '')
  if (base === '') return path
  if (path === base) return ''
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1)
  return path
}

/** Run one query against the seam and normalize the result for the browser. */
async function query(ctx, payload) {
  const lsp = ctx.get('lsp')
  if (lsp === undefined) {
    throw new RouteError(503, 'lsp-unavailable', 'the LSP seam is not mounted in this profile')
  }
  const operation = typeof payload?.operation === 'string' ? payload.operation : ''
  if (!OPERATIONS.has(operation)) throw new RouteError(400, 'invalid-operation', `unknown LSP operation "${operation}"`)
  const filePath = typeof payload?.filePath === 'string' ? payload.filePath : ''
  const workspaceRoot = typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot : ''
  if (filePath === '' || workspaceRoot === '') {
    throw new RouteError(400, 'invalid-arguments', 'filePath and workspaceRoot are required')
  }
  const line = Number(payload?.position?.line)
  const character = Number(payload?.position?.character)
  const position = {
    line: Number.isFinite(line) && line >= 0 ? Math.floor(line) : 0,
    character: Number.isFinite(character) && character >= 0 ? Math.floor(character) : 0,
  }
  let result
  try {
    result = await lsp.query({ operation, filePath, position, workspaceRoot })
  } catch (error) {
    // The seam reports its own stable codes; hand them to the browser verbatim.
    const code = typeof error?.code === 'string' ? error.code : 'lsp-failed'
    throw new RouteError(200, code, error?.message ?? String(error))
  }
  if (result?.kind === 'hover') return { kind: 'hover', hover: result.hover ?? null }
  // The caller's root is the shape the browser's tree speaks, so strip that
  // first. The provider's canonical root is only the fallback: a language server
  // may answer with a project directory inside the workspace, and stripping that
  // would drop a path segment the tree cannot resolve.
  const resolvedRoot = uriToPath(result?.resolvedWorkspaceUri ?? '')
  const relative = (absolute) => {
    const byRequest = relativize(workspaceRoot, absolute)
    if (typeof byRequest === 'string' && byRequest !== absolute) return byRequest
    return relativize(resolvedRoot, absolute)
  }
  const locations = (result?.locations ?? []).map((location) => ({
    path: relative(uriToPath(location.uri)),
    uri: location.uri,
    line: location.range.start.line + 1,
    character: location.range.start.character,
  })).filter((location) => typeof location.path === 'string' && location.path !== '')
  return { kind: 'locations', locations }
}

/** Serve one request. */
function createHandler(ctx) {
  return async (request, response) => {
    try {
      const connection = ctx.get('connection')
      if (connection !== undefined && connection.requestRejection(request) !== undefined) {
        writeJson(response, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (request.method !== 'POST') {
        writeJson(response, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(request.url ?? '/', 'http://dsh-ide.internal').pathname
      if (pathname !== ROUTE_LSP && pathname !== ROUTE_GREP && pathname !== ROUTE_DIFF && pathname !== ROUTE_JAR && pathname !== ROUTE_STATUS) {
        writeJson(response, 404, { ok: false, error: { code: 'not-found', message: 'unknown route' } })
        return
      }
      const payload = await readJsonBody(request)
      const value = pathname === ROUTE_GREP
        ? await grepWorkspace(payload)
        : pathname === ROUTE_DIFF
          ? await diffWorkspace(payload)
          : pathname === ROUTE_JAR
            ? jarSource(payload)
            : pathname === ROUTE_STATUS
              ? await statusWorkspace(payload)
            : await query(ctx, payload)
      writeJson(response, 200, { ok: true, value })
    } catch (error) {
      const status = error instanceof RouteError ? error.status : 500
      const code = error instanceof RouteError ? error.code : 'internal'
      writeJson(response, status, { ok: false, error: { code, message: error?.message ?? String(error) } })
    }
  }
}

export function apply(ctx) {
  const handler = createHandler(ctx)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_LSP,
    handler,
  }), 'dsh-ide-window: lsp route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_GREP,
    handler,
  }), 'dsh-ide-window: grep route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_DIFF,
    handler,
  }), 'dsh-ide-window: diff route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_JAR,
    handler,
  }), 'dsh-ide-window: jar source route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_STATUS,
    handler,
  }), 'dsh-ide-window: workspace status route')
}

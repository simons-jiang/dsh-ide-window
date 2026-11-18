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
import { appendFileSync, existsSync, mkdirSync, openSync, fstatSync, readSync, closeSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { platform } from './platform/index.js'
import { join } from 'node:path'
import { open as openFile } from 'node:fs/promises'
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
const ROUTE_BLAME = '/dsh-ide/blame'
const ROUTE_DOCTOR = '/dsh-ide/doctor'
const ROUTE_KINDS = '/dsh-ide/kinds'
const ROUTE_LOG = '/dsh-ide/log'
const ROUTE_REFS = '/dsh-ide/refs'
const ROUTE_PATCH = '/dsh-ide/patch'
const ROUTE_TEXT = '/dsh-ide/text'
const ROUTE_LICENSE = '/dsh-ide/license'
const ROUTE_DIAG = '/dsh-ide/diagnostics'

/** Entries kept in memory; the file keeps everything up to its size cap. */
const IDE_LOG_LIMIT = 200
/** One file's size before it rotates to `.1` and starts over. */
const IDE_LOG_MAX_BYTES = 512 * 1024
/** In-memory ring, newest last; the browser reads it through the route. */
const ideLog = []
let ideLogDropped = 0

/** The DSH home this Host writes under (`DSH_HOME` wins for test instances). */
function dshHomeDir() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured !== '' ? configured : join(homedir(), '.dsh')
}

/** One JSONL file per profile home, so a report survives a page reload. */
function diagnosticsFile() {
  return join(dshHomeDir(), 'logs', 'dsh-ide-window.log')
}

function appendDiagnosticsLine(line) {
  const file = diagnosticsFile()
  try {
    mkdirSync(join(dshHomeDir(), 'logs'), { recursive: true })
    if (existsSync(file) && statSync(file).size > IDE_LOG_MAX_BYTES) {
      // Windows refuses to rename onto an existing file, so the backup goes first.
      try {
        rmSync(`${file}.1`, { force: true })
      } catch (error) {
        void error
      }
      renameSync(file, `${file}.1`)
    }
    appendFileSync(file, `${line}\n`)
  } catch (error) {
    void error
  }
}

/**
 * Record one diagnostic event.
 *
 * Every route failure and every client report lands here: the ring answers
 * `POST /dsh-ide/diagnostics` and the file survives a restart, which is what
 * makes a Windows report actionable.
 */
export function logEvent(level, scope, message, detail) {
  const entry = {
    t: new Date().toISOString(),
    level: String(level ?? 'info'),
    scope: String(scope ?? 'host'),
    message: String(message ?? '').slice(0, 1000),
  }
  if (detail !== undefined && detail !== null && String(detail) !== '') {
    entry.detail = String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 2000)
  }
  ideLog.push(entry)
  if (ideLog.length > IDE_LOG_LIMIT) {
    ideLog.shift()
    ideLogDropped += 1
  }
  appendDiagnosticsLine(JSON.stringify(entry))
  return entry
}

/**
 * The diagnostics route: `read` returns this Host's recent events, `report`
 * accepts what the browser buffered (client errors never reach the file
 * otherwise, because the Host cannot see the page).
 */
export function diagnosticsReport(payload, options = {}) {
  const action = payload?.action === 'report' ? 'report' : 'read'
  if (action === 'report') {
    const entries = Array.isArray(payload?.entries) ? payload.entries.slice(0, 100) : []
    for (const entry of entries) {
      logEvent('client', entry?.scope ?? 'client', entry?.message ?? '', entry?.detail ?? '')
    }
    return { accepted: entries.length, logFile: diagnosticsFile() }
  }
  return {
    platform: options.platform ?? platform.name,
    logFile: diagnosticsFile(),
    entries: ideLog.slice(-100),
    dropped: ideLogDropped,
  }
}

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
  // A platform lists the binaries it can execute; macOS keeps the Linux builds
  // as a last resort so a profile that moved still resolves.
  const suffixes = platform.name === 'mac'
    ? [...platform.ripgrepSuffixes, '@vscode/ripgrep-linux-arm64/bin/rg', '@vscode/ripgrep-linux-x64/bin/rg']
    : platform.ripgrepSuffixes
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

/** Where a dependency's sources live when nothing says otherwise. */
const MAVEN_REPOSITORY_DEFAULT = join(homedir(), '.m2', 'repository')

/** `<localRepository>` from Maven's own settings, when the repository moved. */
function mavenSettingsRepository() {
  try {
    // The shipped settings.xml documents `<localRepository>` inside a comment;
    // matching that sample would point every lookup at /path/to/local/repo.
    const xml = readFileSync(join(homedir(), '.m2', 'settings.xml'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
    const match = /<localRepository>\s*([^<]+?)\s*<\/localRepository>/.exec(xml)
    if (match === null) return ''
    return platform.expandUserPath(match[1].trim())
  } catch (error) {
    void error
    return ''
  }
}

/**
 * The Maven repository to read sources from.
 *
 * A path from the plugin's settings wins, then Maven's own `settings.xml` (a
 * repository that was moved keeps working with no configuration), then the
 * default. Nothing assumes another machine keeps the default layout.
 */
function mavenRepository(configured) {
  const explicit = typeof configured === 'string' ? configured.trim() : ''
  if (explicit !== '') return explicit
  const settings = mavenSettingsRepository()
  if (settings !== '' && existsSync(settings)) return settings
  return MAVEN_REPOSITORY_DEFAULT
}

/** Lookup results, keyed by entry path: jars do not change under a snapshot name. */
const jarLookups = new Map()

/** Every `-sources.jar` under one Maven repository, newest first. */
function listSourcesJars(repository) {
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
      const path = platform.toPosix(`${directory}/${entry.name}`)
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
  walk(repository, 0)
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
  const repository = mavenRepository(payload?.mavenRepo)
  if (!existsSync(repository)) {
    return { found: false, repository, scanned: 0, reason: 'missing-repository' }
  }
  const entryPath = `${className.replace(/\./g, '/')}.java`
  // The cache is per repository: two repositories can hold different versions.
  const cacheKey = `${repository}|${entryPath}`
  const cached = jarLookups.get(cacheKey)
  if (cached !== undefined) {
    const hit = readZipIndex(cached.jar, entryPath)
    const text = hit === undefined ? undefined : readZipEntry(cached.jar, hit)
    if (text !== undefined) return { found: true, jar: platform.toPosix(cached.jar), entry: entryPath, text, repository }
    jarLookups.delete(cacheKey)
  }
  const jars = listSourcesJars(repository)
  const budget = Math.min(jars.length, 600)
  for (let index = 0; index < budget; index += 1) {
    const file = jars[index]
    const entry = readZipIndex(file, entryPath)
    if (entry === undefined) continue
    const text = readZipEntry(file, entry)
    if (text === undefined) continue
    jarLookups.set(cacheKey, { jar: file })
    return { found: true, jar: platform.toPosix(file), entry: entryPath, text, repository }
  }
  return { found: false, repository, scanned: budget }
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
    child.on('error', (error) => {
      logEvent('warn', 'spawn', `${command} could not start`, error?.message ?? 'spawn failed')
      resolve({ code: -1, stdout: '', stderr: 'spawn-failed' })
    })
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

/**
 * Parse `git blame --line-porcelain` into one entry per line.
 *
 * A header line (`<sha> <orig> <final> [count]`) opens a block; `author` and
 * `author-time` carry the commit identity, and the block ends at the source
 * line (prefixed with a tab). Only the final line number, the author and the
 * epoch are kept: the editor shows who touched the line, not the hash.
 *
 * @param text - porcelain output.
 * @returns `{ line, author, time }` entries in file order.
 */
export function parseBlame(text) {
  const entries = []
  let current
  for (const raw of String(text ?? '').split('\n')) {
    const header = /^([0-9a-f]{7,64}) \d+ (\d+)(?: \d+)?$/.exec(raw)
    if (header !== null) {
      current = { line: Number(header[2]), author: '', time: 0, sha: header[1] }
      continue
    }
    if (current === undefined) continue
    if (raw.startsWith('author ')) {
      current.author = raw.slice('author '.length).trim()
      continue
    }
    if (raw.startsWith('author-time ')) {
      const value = Number(raw.slice('author-time '.length))
      current.time = Number.isFinite(value) ? value : 0
      continue
    }
    if (raw.startsWith('\t')) {
      // The zero commit marks a line git cannot attribute yet: "Not Committed
      // Yet". It must not be shown as a real author.
      entries.push({
        line: current.line,
        author: current.author,
        time: current.time,
        uncommitted: /^0+$/.test(current.sha),
      })
      current = undefined
    }
  }
  return entries
}

/** Largest number of blame rows returned for one file. */
const MAX_BLAME_LINES = 20000

/** The last commit that touched each line of one workspace file. */
export async function blameWorkspace(payload) {
  const root = typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot : ''
  const rel = safeRelativePath(payload?.path)
  if (root === '' || rel === '') throw new RouteError(400, 'invalid-arguments', 'workspaceRoot and path are required')
  const result = await runCommand('git', ['blame', '--line-porcelain', '--', rel], root)
  // An untracked file has no history yet: no rows, and no failure to report.
  if (result.code !== 0) return { failed: true, lines: [] }
  return { failed: false, lines: parseBlame(result.stdout).slice(0, MAX_BLAME_LINES) }
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
  const rel = safeRelativePath(payload?.path)
  if (root === '' || rel === '') throw new RouteError(400, 'invalid-arguments', 'workspaceRoot and path are required')
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


/** Largest number of commits one log request returns. */
const MAX_LOG_COMMITS = 100

/** Largest patch text one request returns, in characters. */
const MAX_PATCH_CHARS = 400000

/** Largest file text one copy request returns, in characters. */
const MAX_COPY_CHARS = 512000

/**
 * Validate one workspace-relative path, in the POSIX form routes speak.
 *
 * Windows sends `a\b`, macOS `a/b`; both become `a/b`. An absolute path or one
 * that climbs with `..` is refused instead of resolved.
 */
function safeRelativePath(value) {
  const rel = platform.toPosix(typeof value === 'string' ? value.trim() : '')
  if (rel !== '' && (platform.isAbsolutePath(rel) || rel.split('/').includes('..'))) {
    throw new RouteError(400, 'invalid-scope', 'path must stay inside the workspace')
  }
  return rel
}

/**
 * Validate the workspace root and the relative path a route may touch.
 *
 * `rel` may be empty for routes that speak about the repository itself. The
 * root keeps its platform form (a drive letter on Windows); the relative path
 * is always POSIX.
 */
function scopeOf(payload) {
  const root = typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot.trim() : ''
  if (root === '' || !platform.isAbsolutePath(root)) {
    throw new RouteError(400, 'invalid-arguments', 'workspaceRoot must be absolute')
  }
  const rel = safeRelativePath(payload?.path)
  return { root: root.replace(/[\\/]+$/, ''), rel }
}

/** Parse `git log --pretty=format:%h%x09%an%x09%ad%x09%s` output. */
export function parseCommitLog(text) {
  const rows = []
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue
    const [sha, author, date, subject] = line.split('\t')
    if (typeof sha !== 'string' || sha === '') continue
    rows.push({ sha, author: author ?? '', date: date ?? '', subject: subject ?? '' })
  }
  return rows
}

/** Parse `git for-each-ref --format=%(refname:short)%09%(objecttype)` output. */
export function parseGitRefs(text) {
  const rows = []
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue
    const [name, type] = line.split('\t')
    if (typeof name !== 'string' || name === '') continue
    rows.push({ name, kind: type === 'tag' ? 'tag' : 'branch' })
  }
  return rows
}

/** Recent commits that touched one file. */
export async function logWorkspace(payload) {
  const { root, rel } = scopeOf(payload)
  if (rel === '') throw new RouteError(400, 'invalid-arguments', 'path is required')
  const asked = Number.isInteger(payload?.limit) ? payload.limit : 30
  const limit = Math.min(MAX_LOG_COMMITS, Math.max(1, asked))
  const log = await runCommand('git', [
    'log', '--date=short', '--pretty=format:%h%x09%an%x09%ad%x09%s', '-n', String(limit), '--', rel,
  ], root)
  if (log.code !== 0) throw new RouteError(500, 'log-failed', log.stderr.trim() || 'git log failed')
  return { rows: parseCommitLog(log.stdout) }
}

/** Branches and tags a file can be compared against. */
export async function refsWorkspace(payload) {
  const { root } = scopeOf(payload)
  const refs = await runCommand('git', [
    'for-each-ref', '--format=%(refname:short)%09%(objecttype)', 'refs/heads', 'refs/tags',
  ], root)
  if (refs.code !== 0) throw new RouteError(500, 'refs-failed', refs.stderr.trim() || 'git for-each-ref failed')
  return { rows: parseGitRefs(refs.stdout) }
}

/**
 * The patch text of one file against a revision.
 *
 * `base` defaults to `HEAD` (working tree against the last commit); `target`
 * compares two revisions instead. A root commit has no parent, so the fallback
 * asks `git show` for that commit's own patch.
 */
export async function patchWorkspace(payload) {
  const { root, rel } = scopeOf(payload)
  if (rel === '') throw new RouteError(400, 'invalid-arguments', 'path is required')
  const base = typeof payload?.base === 'string' && payload.base.trim() !== '' ? payload.base.trim() : 'HEAD'
  const target = typeof payload?.target === 'string' && payload.target.trim() !== '' ? payload.target.trim() : ''
  const tracked = await runCommand('git', ['ls-files', '--error-unmatch', '--', rel], root)
  if (tracked.code !== 0) return { untracked: true, base, target, text: '', truncated: false }
  let diff = await runCommand('git', [
    'diff', '--no-color', '--no-ext-diff', '-U3', base,
    ...(target === '' ? [] : [target]),
    '--', rel,
  ], root)
  if (diff.code !== 0 && target !== '') {
    diff = await runCommand('git', ['show', '--format=', '--no-color', '--patch', target, '--', rel], root)
  }
  if (diff.code !== 0) throw new RouteError(500, 'diff-failed', diff.stderr.trim() || 'git diff failed')
  const text = diff.stdout
  return {
    untracked: false,
    base,
    target,
    text: text.length > MAX_PATCH_CHARS ? text.slice(0, MAX_PATCH_CHARS) : text,
    truncated: text.length > MAX_PATCH_CHARS,
  }
}

/** The text of one workspace file, for the tree's copy action. */
export function fileText(payload) {
  const { root, rel } = scopeOf(payload)
  if (rel === '') throw new RouteError(400, 'invalid-arguments', 'path is required')
  let text
  try {
    text = readFileSync(join(root, rel), 'utf8')
  } catch {
    throw new RouteError(400, 'read-failed', 'cannot read the file')
  }
  return {
    text: text.length > MAX_COPY_CHARS ? text.slice(0, MAX_COPY_CHARS) : text,
    truncated: text.length > MAX_COPY_CHARS,
  }
}

/** Largest number of extensions one content search may be narrowed to. */
const MAX_GREP_EXTENSIONS = 40

/**
 * `--glob` pairs that restrict a content search to the given extensions.
 *
 * The palette's 「代码」 view is the caller: it names source extensions so a
 * field name cannot be crowded out by documentation or generated config. Each
 * entry is accepted only as a bare extension (`java`, `.ts` → `ts`), never as a
 * free-form glob, so a caller can narrow the search but never widen it.
 *
 * @param extensions - extension names, with or without a leading dot.
 * @returns argv pairs, ready to splice into ripgrep's argument list.
 */
export function grepExtensionGlobs(extensions) {
  if (!Array.isArray(extensions)) return []
  const globs = []
  for (const raw of extensions) {
    if (typeof raw !== 'string') continue
    const value = raw.trim().replace(/^\./, '').toLowerCase()
    if (!/^[a-z0-9_+-]{1,16}$/.test(value)) continue
    globs.push('--glob', `*.${value}`)
    if (globs.length >= MAX_GREP_EXTENSIONS * 2) break
  }
  return globs
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
  const relScope = safeRelativePath(payload?.path)
  const scope = relScope === '' ? '.' : relScope
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
      ...grepExtensionGlobs(payload?.extensions),
      '--max-count', '20',
      '--', query, scope,
    ]
    const child = spawn(binary, argv, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const matches = []
    // `--vimgrep` prints one row per *match*, so two hits on the same line are
    // two rows with the same path and line. The editor shows one row per line.
    const seen = new Set()
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
        if (parsed !== undefined && parsed.path !== '') {
          const key = `${parsed.path}:${parsed.line}`
          if (!seen.has(key)) {
            seen.add(key)
            matches.push(parsed)
          }
        }
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

/**
 * The installed IntelliJ language server launcher, newest first.
 *
 * The licence verbs live in the same binary the language server runs from, so
 * the plugin reads it from the same place the profile config does.
 */
function licenseBinary() {
  const base = join(homedir(), '.dsh', 'lsp-bin')
  try {
    const names = readdirSync(base)
      .filter((name) => name.startsWith('intellij-server-'))
      .sort()
      .reverse()
    for (const name of names) {
      for (const launcher of platform.serverLauncherNames) {
        const candidate = join(base, name, 'bin', launcher)
        if (existsSync(candidate)) return candidate
      }
    }
  } catch (error) {
    void error
  }
  return ''
}

/**
 * Environment for the licence verbs.
 *
 * Their JVM writes a log under ~/Library/Logs by default, which fails outright
 * when the host runs without that permission; a temporary log directory keeps
 * `license status` readable in every environment.
 */
function licenseEnv() {
  // The JVM writes its log under a directory that is read-only in this sandbox
  // on macOS; pointing it at a temporary one keeps `license status` readable.
  // On Windows the location is writable and the temporary path may contain a
  // space (a user name), which `IJ_JAVA_OPTIONS` would split apart — so the
  // override stays on macOS.
  if (platform.name !== 'mac') return { ...process.env }
  const logDir = join(tmpdir(), 'dsh-ide-license-logs')
  const extra = `-Didea.log.path=${logDir}`
  const existing = typeof process.env.IJ_JAVA_OPTIONS === 'string' ? process.env.IJ_JAVA_OPTIONS.trim() : ''
  return { ...process.env, IJ_JAVA_OPTIONS: existing === '' ? extra : `${existing} ${extra}` }
}

/** One licence command's combined output, killed when it overruns. */
function runLicenseCommand(binary, argv, timeoutMs) {
  return new Promise((resolve) => {
    // On Windows the launcher is a `.bat`; spawning it without a shell is
    // refused (EINVAL) since CVE-2024-27980, which used to look like a dead click.
    let child
    try {
      child = spawn(binary, argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: licenseEnv(),
        shell: platform.needsShell(binary),
      })
    } catch (error) {
      logEvent('error', 'license', `${argv.join(' ')} could not start`, error?.message ?? String(error))
      resolve({ code: -1, output: String(error?.message ?? error) })
      return
    }
    let output = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    const collect = (chunk) => {
      output += String(chunk)
      if (output.length > 20000) output = output.slice(-20000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, output })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
  })
}

/** Open one URL in the user's default browser. */
function openInBrowser(url) {
  const target = String(url ?? '')
  if (!/^https?:\/\//.test(target)) return false
  const { command, args } = platform.openUrlCommand(target)
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
    return true
  } catch (error) {
    void error
    return false
  }
}

/** The first https URL in a licence command's output. */
function licenseUrlIn(text) {
  const match = /https:\/\/[^\s"'<>]+/.exec(String(text ?? ''))
  return match === null ? '' : match[0]
}

/**
 * Start the JetBrains sign-in and hand the browser URL back.
 *
 * `license login --browser` opens the account flow and waits for the loopback
 * redirect, so the child is left running; the URL is reported as soon as it is
 * printed. When the machine is already signed in but unlicensed the command
 * prints guidance instead of a URL, and that text is what the caller shows.
 */
async function openLicenseLogin(binary) {
  let child
  try {
    child = spawn(binary, ['license', 'login', '--browser', '--timeout=5m'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: licenseEnv(),
      shell: platform.needsShell(binary),
    })
  } catch (error) {
    logEvent('error', 'license', 'license login could not start', error?.message ?? String(error))
    return { url: '', output: String(error?.message ?? error) }
  }
  child.unref()
  let output = ''
  const collect = (chunk) => {
    output += String(chunk)
    if (output.length > 4000) output = output.slice(-4000)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const url = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(licenseUrlIn(output)), 6000)
    const poll = setInterval(() => {
      const found = licenseUrlIn(output)
      if (found !== '') {
        clearInterval(poll)
        clearTimeout(timer)
        resolve(found)
      }
    }, 200)
    child.on('exit', () => {
      clearInterval(poll)
      clearTimeout(timer)
      resolve(licenseUrlIn(output))
    })
  })
  return { url, output: output.trim() }
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
    // The provider runs on this machine, so it gets the platform's own path
    // form; the browser gets POSIX paths back.
    result = await lsp.query({ operation, filePath: platform.toNative(filePath), position, workspaceRoot })
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
    path: platform.toPosix(relative(uriToPath(location.uri))),
    uri: location.uri,
    line: location.range.start.line + 1,
    character: location.range.start.character,
  })).filter((location) => typeof location.path === 'string' && location.path !== '')
  return { kind: 'locations', locations }
}

/**
 * `status` prints this machine's licensing state; `open` starts the browser
 * sign-in and returns the URL to open.
 */
async function licenseCommand(payload) {
  const requested = payload?.action
  const action = requested === 'status' || requested === 'open' || requested === 'relogin' ? requested : ''
  if (action === '') throw new RouteError(400, 'invalid-action', 'action must be status, open or relogin')
  const binary = licenseBinary()
  if (binary === '') throw new RouteError(503, 'license-tool-missing', 'intellij-server is not installed under ~/.dsh/lsp-bin')
  if (action === 'status') {
    const result = await runLicenseCommand(binary, ['license', 'status'], 8000)
    return { text: result.output.trim(), code: result.code }
  }
  if (action === 'relogin') {
    // The machine holds an account sign-in without an entitlement; the tool
    // will not prompt again until that sign-in is gone. Signing out is the
    // documented way to switch accounts, so this is the user-triggered repair.
    const reset = await runLicenseCommand(binary, ['license', 'reset', '--account'], 15000)
    const login = await openLicenseLogin(binary)
    const target = login.url !== '' ? login.url : 'https://account.jetbrains.com.cn/oauth/login'
    return {
      opened: login.url !== '' ? true : openInBrowser(target),
      url: target,
      output: `${reset.output}\n${login.output}`.trim().slice(-800),
    }
  }
  const started = await openLicenseLogin(binary)
  // With `--browser` the tool opens the default browser itself; opening the
  // same URL again would only add a second tab. When it printed no URL it gave
  // up on the account flow (already signed in, licence missing), so the account
  // page is opened here — from the host, because a webview's `window.open` is
  // routinely refused.
  if (started.url !== '') return { opened: true, url: started.url, via: 'login', output: started.output.slice(-600) }
  const accountPage = 'https://account.jetbrains.com/licenses'
  const opened = openInBrowser(accountPage)
  return { opened, url: accountPage, via: 'account', output: started.output.slice(-600) }
}

/** Largest number of Java files one kind request may cover. */
const MAX_KIND_PATHS = 300

/** How much of a Java file is enough to see its declaration. */
const KIND_HEAD_BYTES = 8192

/**
 * The declaration kind of a Java source head.
 *
 * Comments are stripped first, so a javadoc sentence ("this class does…") can
 * never answer for the file; `@interface` wins over `interface` because both
 * start at the same place and the earliest match is kept.
 *
 * @param text - the first few KB of a `.java` file.
 * @returns `'class' | 'interface' | 'enum' | 'record' | 'annotation' | ''`.
 */
/**
 * Blank out string, char and text-block literals.
 *
 * A URL or a label can hold a declaration word — `@RequestMapping(".../record")`
 * sits above the class it belongs to — and matching it made the tree label a
 * class as a record.
 */
function stripJavaLiterals(text) {
  const source = String(text ?? '')
  let out = ''
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '"' && source.startsWith('\"\"\"', index)) {
      const end = source.indexOf('\"\"\"', index + 3)
      const stop = end < 0 ? source.length : end + 3
      out += ' '.repeat(stop - index)
      index = stop
      continue
    }
    if (char === '"' || char === "'") {
      let cursor = index + 1
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2
          continue
        }
        if (source[cursor] === char) {
          cursor += 1
          break
        }
        cursor += 1
      }
      out += ' '.repeat(cursor - index)
      index = cursor
      continue
    }
    out += char
    index += 1
  }
  return out
}

export function parseJavaKind(text) {
  const source = stripJavaLiterals(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
  const shapes = [
    ['annotation', /@\s*interface\b/],
    // `.class` is a class literal, not a declaration.
    ['class', /(?<!\.)\bclass\b/],
    ['interface', /\binterface\b/],
    ['enum', /\benum\b/],
    ['record', /\brecord\b/],
  ]
  let kind = ''
  let at = Number.POSITIVE_INFINITY
  for (const [candidate, shape] of shapes) {
    const match = shape.exec(source)
    if (match !== null && match.index < at) {
      at = match.index
      kind = candidate
    }
  }
  return kind
}

/** Read one file's head; a missing or unreadable file simply has no kind. */
async function readJavaKind(filePath) {
  let handle
  try {
    handle = await openFile(filePath, 'r')
    const buffer = Buffer.alloc(KIND_HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, KIND_HEAD_BYTES, 0)
    return parseJavaKind(buffer.toString('utf8', 0, bytesRead))
  } catch (error) {
    return ''
  } finally {
    if (handle !== undefined) await handle.close()
  }
}

/**
 * Declaration kinds for the Java files the tree is about to paint.
 *
 * One request per directory expansion: the client asks for the entries it has
 * loaded but not identified yet, and the answer is a `path → kind` map so the
 * letters can appear without another round trip.
 */
export async function kindsWorkspace(payload) {
  const root = typeof payload?.workspaceRoot === 'string' ? payload.workspaceRoot : ''
  if (root === '') throw new RouteError(400, 'invalid-arguments', 'workspaceRoot is required')
  const wanted = []
  for (const value of Array.isArray(payload?.paths) ? payload.paths : []) {
    if (typeof value !== 'string' || !value.endsWith('.java')) continue
    let rel
    try {
      rel = safeRelativePath(value)
    } catch (error) {
      continue
    }
    if (rel === '') continue
    wanted.push(rel)
  }
  const unique = [...new Set(wanted)].slice(0, MAX_KIND_PATHS)
  if (unique.length === 0) return { kinds: {} }
  const kinds = {}
  const queue = [...unique]
  const workerCount = Math.min(8, queue.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
      kinds[rel] = await readJavaKind(join(root, rel))
    }
  }))
  return { kinds }
}

/**
 * Whether the LSP seam is mounted in this profile.
 *
 * The setup guide keys off this: a profile without `@deepseek-ai/dsh-lsp` can
 * still browse files, but nothing can navigate.
 */
export function doctorReport(ctx) {
  // The detected repository is what the reader needs to confirm in settings, so
  // report whether that path is actually there instead of only its name.
  const mavenRepo = mavenRepository('')
  let mavenRepoExists = false
  try {
    mavenRepoExists = existsSync(mavenRepo)
  } catch (error) {
    void error
  }
  try {
    return { lsp: ctx.get('lsp') !== undefined, mavenRepo, mavenRepoExists }
  } catch (error) {
    return { lsp: false, mavenRepo, mavenRepoExists }
  }
}

/** Serve one request. */
function createHandler(ctx) {
  return async (request, response) => {
    // The catch reports the route, so the name must outlive the try block.
    let pathname = ''
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
      pathname = new URL(request.url ?? '/', 'http://dsh-ide.internal').pathname
      if (pathname !== ROUTE_LSP && pathname !== ROUTE_GREP && pathname !== ROUTE_DIFF && pathname !== ROUTE_JAR && pathname !== ROUTE_STATUS && pathname !== ROUTE_BLAME && pathname !== ROUTE_DOCTOR && pathname !== ROUTE_KINDS && pathname !== ROUTE_LOG && pathname !== ROUTE_REFS && pathname !== ROUTE_PATCH && pathname !== ROUTE_TEXT && pathname !== ROUTE_LICENSE && pathname !== ROUTE_DIAG) {
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
              : pathname === ROUTE_BLAME
                ? await blameWorkspace(payload)
              : pathname === ROUTE_DOCTOR
                ? doctorReport(ctx)
              : pathname === ROUTE_KINDS
                ? await kindsWorkspace(payload)
              : pathname === ROUTE_LOG
                ? await logWorkspace(payload)
              : pathname === ROUTE_REFS
                ? await refsWorkspace(payload)
              : pathname === ROUTE_PATCH
                ? await patchWorkspace(payload)
              : pathname === ROUTE_TEXT
                ? fileText(payload)
              : pathname === ROUTE_LICENSE
                ? await licenseCommand(payload)
              : pathname === ROUTE_DIAG
                ? diagnosticsReport(payload)
            : await query(ctx, payload)
      writeJson(response, 200, { ok: true, value })
    } catch (error) {
      const status = error instanceof RouteError ? error.status : 500
      const code = error instanceof RouteError ? error.code : 'internal'
      logEvent(status >= 500 ? 'error' : 'warn', 'route', `${pathname} → ${status} ${code}`, error?.message ?? String(error))
      writeJson(response, status, { ok: false, error: { code, message: error?.message ?? String(error) } })
    }
  }
}

export function apply(ctx) {
  logEvent('info', 'host', 'plugin loaded', { platform: platform.name, node: process.versions.node })
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
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_BLAME,
    handler,
  }), 'dsh-ide-window: blame route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_DOCTOR,
    handler,
  }), 'dsh-ide-window: doctor route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_KINDS,
    handler,
  }), 'dsh-ide-window: kinds route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_LOG,
    handler,
  }), 'dsh-ide-window: log route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_REFS,
    handler,
  }), 'dsh-ide-window: refs route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PATCH,
    handler,
  }), 'dsh-ide-window: patch route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_TEXT,
    handler,
  }), 'dsh-ide-window: file text route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_LICENSE,
    handler,
  }), 'dsh-ide-window: language server licence route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_DIAG,
    handler,
  }), 'dsh-ide-window: diagnostics route')
}

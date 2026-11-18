/**
 * The Host diagnostics log.
 *
 * A bug report quotes this log, so the ring, the file and the "client report"
 * path are checked here rather than discovered in production.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The log path is resolved per call from DSH_HOME, so a throwaway home keeps
// this test away from the real ~/.dsh.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-diag-'))
const { logEvent, diagnosticsReport } = await import('../index.js')

const checks = []
const check = (ok, label, detail) => checks.push({ ok, label, detail })

const first = logEvent('error', 'test', 'boom', { code: 'E_TEST' })
check(typeof first.t === 'string' && first.t.endsWith('Z'), 'an entry carries an ISO timestamp', String(first.t))
check(first.level === 'error' && first.scope === 'test' && first.message === 'boom', 'an entry keeps level, scope and message', JSON.stringify(first))
check(first.detail.includes('E_TEST'), 'the detail is serialised', String(first.detail))

// The ring keeps the newest 200; the report hands back the newest 100.
for (let index = 0; index < 205; index += 1) logEvent('info', 'ring', `line-${index}`)
const read = diagnosticsReport({ action: 'read' })
check(read.entries.length === 100, 'the report is capped at 100 entries', String(read.entries.length))
check(read.entries[read.entries.length - 1].message === 'line-204', 'the report ends with the newest entry', read.entries[read.entries.length - 1].message)
check(read.dropped === 6, 'entries that left the ring are counted', String(read.dropped))
check(read.logFile.endsWith('logs/dsh-ide-window.log'), 'the log file lives under the profile home', read.logFile)
check(existsSync(read.logFile), 'the log file is created on first use', read.logFile)
const lines = readFileSync(read.logFile, 'utf8').trim().split('\n')
check(lines.length === 206, 'every entry is appended to the file', String(lines.length))
check(lines.every((line) => { try { return typeof JSON.parse(line).message === 'string' } catch { return false } }), 'the file is JSONL', 'one object per line')

const accepted = diagnosticsReport({ action: 'report', entries: [{ scope: 'ui', message: 'client says hi' }] })
check(accepted.accepted === 1, 'a client report is accepted', JSON.stringify(accepted))
const afterReport = diagnosticsReport({ action: 'read' })
check(afterReport.entries[afterReport.entries.length - 1].level === 'client', 'a client report lands in the ring', JSON.stringify(afterReport.entries[afterReport.entries.length - 1]))

// Rotation: a file past the cap becomes `.1` before the next append, and an
// existing `.1` is replaced (Windows cannot rename onto an existing file).
writeFileSync(read.logFile, 'x'.repeat(600 * 1024))
logEvent('info', 'rotate', 'after-cap')
const rotated = existsSync(`${read.logFile}.1`)
const rotatedSize = rotated ? readFileSync(`${read.logFile}.1`, 'utf8').length : 0
check(rotated && rotatedSize === 600 * 1024, 'a file past the cap rotates to .1', String(rotatedSize))
logEvent('info', 'rotate', 'again')
writeFileSync(read.logFile, 'y'.repeat(600 * 1024))
logEvent('info', 'rotate', 'second-rotation')
check(readFileSync(`${read.logFile}.1`, 'utf8').startsWith('y'), 'rotation replaces the previous backup', 'second backup written')

// A home that cannot be written must not break the route.
process.env.DSH_HOME = '/dev/null/dsh-diag-unwritable'
let threw = false
try {
  logEvent('error', 'test', 'unwritable')
  diagnosticsReport({ action: 'read' })
} catch (error) {
  void error
  threw = true
}
check(threw === false, 'an unwritable home never throws', 'log write failed safely')

const failed = checks.filter((entry) => entry.ok !== true)
for (const entry of checks) if (entry.ok === true) console.log(`  ✓ ${entry.label}`)
for (const entry of failed) console.log(`  ✗ ${entry.label} — ${entry.detail}`)
console.log(failed.length === 0 ? 'all diagnostics checks passed' : `${failed.length} diagnostics check(s) failed`)
process.exitCode = failed.length === 0 ? 0 : 1

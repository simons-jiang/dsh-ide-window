/**
 * Jar-source resolution against the real Maven repository.
 *
 * Reads the same ZIP data the Host route reads, so a regression in the lookup
 * (index parsing, jar ordering, field matching) shows up without touching the UI.
 * Skips cleanly when this machine has no `~/.m2/repository`, and skips a
 * class that this repository does not carry.
 */
import { readFileSync, openSync, fstatSync, readSync, closeSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { inflateRawSync } from 'node:zlib'

const idx = (file, wanted) => {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const tailLength = Math.min(size, 66000)
    const tail = Buffer.alloc(tailLength)
    readSync(fd, tail, 0, tailLength, size - tailLength)
    let eocd = -1
    for (let i = tail.length - 22; i >= 0; i -= 1) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    if (eocd < 0) return undefined
    const count = tail.readUInt16LE(eocd + 10)
    const dirOffset = tail.readUInt32LE(eocd + 16)
    const dirLength = tail.readUInt32LE(eocd + 12)
    const dir = Buffer.alloc(dirLength)
    readSync(fd, dir, 0, dirLength, dirOffset)
    let at = 0
    for (let i = 0; i < count; i += 1) {
      if (at + 46 > dir.length || dir.readUInt32LE(at) !== 0x02014b50) break
      const method = dir.readUInt16LE(at + 10)
      const compressed = dir.readUInt32LE(at + 20)
      const nameLength = dir.readUInt16LE(at + 28)
      const extraLength = dir.readUInt16LE(at + 30)
      const commentLength = dir.readUInt16LE(at + 32)
      const localOffset = dir.readUInt32LE(at + 42)
      const name = dir.toString('utf8', at + 46, at + 46 + nameLength)
      if (name === wanted) return { method, compressed, localOffset }
      at += 46 + nameLength + extraLength + commentLength
    }
    return undefined
  } finally { closeSync(fd) }
}
const entryText = (file, entry) => {
  const fd = openSync(file, 'r')
  try {
    const header = Buffer.alloc(30)
    readSync(fd, header, 0, 30, entry.localOffset)
    const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    const data = Buffer.alloc(entry.compressed)
    readSync(fd, data, 0, entry.compressed, start)
    return entry.method === 0 ? data.toString('utf8') : inflateRawSync(data).toString('utf8')
  } finally { closeSync(fd) }
}
const jars = []
const walk = (dir, depth) => {
  if (depth > 6) return
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${dirent.name}`
    if (dirent.isDirectory()) walk(path, depth + 1)
    else if (dirent.name.endsWith('-sources.jar')) jars.push({ path, mtime: statSync(path).mtimeMs })
  }
}
try {
  walk(`${homedir()}/.m2/repository`, 0)
} catch (error) {
  console.log('no ~/.m2/repository on this machine — skipping')
  process.exit(0)
}
jars.sort((a, b) => b.mtime - a.mtime)
console.log(`sources jar 总数 ${jars.length}`)

const resolve = (className, fieldName) => {
  const entry = `${className.replace(/\./g, '/')}.java`
  const started = Date.now()
  for (const jar of jars) {
    const found = idx(jar.path, entry)
    if (found === undefined) continue
    const text = entryText(jar.path, found)
    const lines = text.split('\n')
    const line = lines.findIndex((t) => new RegExp(`^\\s*(?:(?:private|protected|public|final|static|transient|volatile)\\s+)*[\\w<>,\\[\\].? ]+\\b${fieldName}\\b\\s*(?:[;=])`).test(t))
    return { jar: jar.path.split('/').pop(), line: line + 1, ms: Date.now() - started }
  }
  return { missing: true, ms: Date.now() - started }
}

let failed = 0
let skipped = 0
const expect = (label, result) => {
  // A public class may be absent from one machine's repository: that is a skip,
  // not a regression.
  if (result.missing === true) {
    skipped += 1
    console.log(`  ⏭ ${label} → not in this ~/.m2 (skipped)`)
    return
  }
  const ok = result.line > 0
  console.log(`${ok ? '  ✓' : '  ✗'} ${label} → ${result.jar}:${result.line} (${result.ms} ms)`)
  if (!ok) failed += 1
}

expect('DateUtils#MILLIS_PER_SECOND', resolve('org.apache.commons.lang3.time.DateUtils', 'MILLIS_PER_SECOND'))
expect('StringUtils#EMPTY', resolve('org.apache.commons.lang3.StringUtils', 'EMPTY'))

// 一个不存在的类必须干净地报告没有源码，而不是抛错或误命中
const absent = resolve('com.example.DoesNotExistAnywhere', 'whatever')
const absentOk = absent.missing === true
console.log(`${absentOk ? '  ✓' : '  ✗'} an unknown class reports no source (${absent.ms} ms)`)
if (!absentOk) failed += 1

console.log(failed === 0 ? `\nall maven checks passed${skipped > 0 ? ` (${skipped} skipped)` : ''}` : `\n${failed} maven check(s) failed`)
process.exit(failed === 0 ? 0 : 1)

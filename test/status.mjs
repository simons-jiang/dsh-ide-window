/**
 * `git status -z` parsing.
 *
 * The card's workspace fallback lists what git says is uncommitted, so the
 * parser is the only thing standing between a file name and the editor. The
 * line form quotes a name git considers unsafe (a space, a quote, a non-ASCII
 * byte), which is how a Chinese document became `docs/\345\271\270...` on
 * screen; the route reads the NUL-separated form instead.
 *
 * These fixtures are the exact shapes `git status --porcelain=v1 -z` prints,
 * including the rename/copy pair whose second field has no status prefix.
 */
import { parseStatus, parseBlame, doctorReport, parseJavaKind } from '../index.js'

let failures = 0
const ok = (name) => console.log(`  ✓ ${name}`)
const bad = (name, detail) => {
  failures += 1
  console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}
const check = (condition, name, detail) => {
  if (condition) ok(name)
  else bad(name, detail)
}

/** The wire form: every field terminated by NUL, exactly what git writes. */
const nul = (fields) => fields.map((field) => `${field}\0`).join('')

// ① 普通条目
{
  const entries = parseStatus(nul(['M  src/A.java', '?? docs/new.md', 'D  gone.java']))
  check(entries.length === 3, 'three entries parsed', JSON.stringify(entries))
  check(entries[0].path === 'src/A.java' && entries[0].status === 'M', 'a modified path keeps its name', JSON.stringify(entries[0]))
  check(entries[1].status === '??', 'an untracked entry keeps `??`', JSON.stringify(entries[1]))
  check(entries[2].status === 'D', 'a deleted entry keeps `D`', JSON.stringify(entries[2]))
}

// ② 中文名与空格：行格式会给它们加引号并转义，-z 不会
{
  const path = 'docs/资产负债表 说明.md'
  const entries = parseStatus(nul([`?? ${path}`]))
  check(entries.length === 1, 'a non-ASCII entry is one entry', JSON.stringify(entries))
  check(entries[0].path === path, 'a Chinese name is read verbatim', JSON.stringify(entries[0]?.path))
  check(!/\\\d{3}/.test(entries[0].path), 'no octal escape survives', entries[0]?.path)
  check(entries[0].path.includes(' '), 'the space stays inside the name', entries[0]?.path)
}

// ③ 重命名：新路径在前，旧路径是下一个字段（没有状态前缀）
{
  const entries = parseStatus(nul(['R  新 名字.txt', 'old name.txt', '?? other.md']))
  check(entries.length === 2, 'a rename is one entry, not two', JSON.stringify(entries))
  check(entries[0].path === '新 名字.txt', 'a rename keeps the new path', JSON.stringify(entries[0]))
  check(entries[1].path === 'other.md', 'the entry after a rename is still parsed', JSON.stringify(entries[1]))
}

// ④ 复制与工作树重命名
{
  const copy = parseStatus(nul(['C  copy.java', 'orig.java']))
  check(copy.length === 1 && copy[0].path === 'copy.java', 'a copy skips its source field', JSON.stringify(copy))
  const worktree = parseStatus(nul([' R moved.java', 'was.java']))
  check(worktree.length === 1 && worktree[0].path === 'moved.java', 'a worktree rename is still one entry', JSON.stringify(worktree))
}

// ⑤ 引号与反斜杠不应被解开或丢掉
{
  const entries = parseStatus(nul(['?? quote"name.txt', 'M  C:\\tmp\\a.java']))
  check(entries[0].path === 'quote"name.txt', 'a quote in the name is kept', JSON.stringify(entries[0]?.path))
  check(entries[1].path === 'C:\\tmp\\a.java', 'a backslash in the name is kept', JSON.stringify(entries[1]?.path))
}

// ⑥ 空输出与尾部空字段
{
  check(parseStatus('').length === 0, 'empty output yields nothing')
  check(parseStatus('\0').length === 0, 'a lone NUL yields nothing')
  check(parseStatus(undefined).length === 0, 'a missing body yields nothing')
}

// ---- git blame -------------------------------------------------------------
{
  const fixture = [
    '77240de99c9d8c2c3dee7fa4e1bf1d68319879ce 1 1 3',
    'author simon',
    'author-mail <simon@example.com>',
    'author-time 1794792855',
    'author-tz +0800',
    'committer simon',
    'summary feat: init',
    'filename index.js',
    '\t/**',
    '77240de99c9d8c2c3dee7fa4e1bf1d68319879ce 2 2',
    'author simon',
    'author-time 1794792855',
    '\t * text',
    'aa11bb22cc33dd44ee55ff6677889900aabbccdd 3 3',
    'author alice',
    'author-time 1794800000',
    '\tpublic class Demo {',
    '0000000000000000000000000000000000000000 4 4',
    'author Not Committed Yet',
    'author-time 1794900000',
    '\t// local change',
  ].join('\n')
  const rows = parseBlame(fixture)
  check(rows.length === 4, 'four blamed lines', JSON.stringify(rows))
  check(rows[0]?.line === 1 && rows[0]?.author === 'simon', 'the first line keeps its author', JSON.stringify(rows[0]))
  check(rows[1]?.line === 2 && rows[1]?.author === 'simon', 'a short header (no count) still parses', JSON.stringify(rows[1]))
  check(rows[2]?.line === 3 && rows[2]?.author === 'alice', 'a second author is read', JSON.stringify(rows[2]))
  check(rows[0]?.time === 1794792855, 'the author timestamp is kept', String(rows[0]?.time))
  check(rows[3]?.uncommitted === true, 'the zero commit is marked uncommitted', JSON.stringify(rows[3]))
  check(rows[0]?.uncommitted === false, 'a real commit is not uncommitted', String(rows[0]?.uncommitted))
  check(parseBlame('').length === 0, 'empty blame yields nothing')
  check(parseBlame('not porcelain').length === 0, 'garbage yields nothing')
}

// ---- profile doctor --------------------------------------------------------
{
  check(doctorReport({ get: () => undefined }).lsp === false, 'no LSP seam means not ready')
  check(doctorReport({ get: () => ({}) }).lsp === true, 'a mounted LSP seam means ready')
  check(doctorReport({ get: () => { throw new Error('no inject') } }).lsp === false, 'a throwing ctx is not ready')
}

// ---- Java declaration kinds ------------------------------------------------
{
  check(parseJavaKind('package a;\npublic class Foo {}') === 'class', 'a class is a class', parseJavaKind('package a;\npublic class Foo {}'))
  check(parseJavaKind('public interface Bar {}') === 'interface', 'an interface is an interface', parseJavaKind('public interface Bar {}'))
  check(parseJavaKind('public enum Baz { A }') === 'enum', 'an enum is an enum', parseJavaKind('public enum Baz { A }'))
  check(parseJavaKind('public @interface Qux {}') === 'annotation', 'an annotation is an annotation', parseJavaKind('public @interface Qux {}'))
  check(parseJavaKind('public record Rec(int a) {}') === 'record', 'a record is a record', parseJavaKind('public record Rec(int a) {}'))
  check(parseJavaKind('/** this class explains things */\npublic interface Real {}') === 'interface', 'javadoc cannot answer for the file', parseJavaKind('/** this class explains things */\npublic interface Real {}'))
  check(parseJavaKind('// class Fake\npublic enum Real { A }') === 'enum', 'a line comment cannot answer for the file', parseJavaKind('// class Fake\npublic enum Real { A }'))
  check(parseJavaKind('package a;\nimport java.util.List;') === '', 'no declaration means no kind', parseJavaKind('package a;\nimport java.util.List;'))
  check(parseJavaKind('') === '', 'an empty head means no kind', parseJavaKind(''))
  check(parseJavaKind('@interface Tight {}') === 'annotation', 'no space still reads as an annotation', parseJavaKind('@interface Tight {}'))
  check(parseJavaKind('@Constraint(validatedBy = X.class)\npublic @interface A {}') === 'annotation', 'a class literal does not answer for the file', parseJavaKind('@Constraint(validatedBy = X.class)\npublic @interface A {}'))
  check(parseJavaKind('Foo.class\npublic class Bar {}') === 'class', 'a class literal before a class still reads as a class', parseJavaKind('Foo.class\npublic class Bar {}'))
}

console.log(failures === 0 ? '\nall status checks passed' : `\n${failures} status check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

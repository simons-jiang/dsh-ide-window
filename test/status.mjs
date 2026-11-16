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
import { parseStatus } from '../index.js'

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

console.log(failures === 0 ? '\nall status checks passed' : `\n${failures} status check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

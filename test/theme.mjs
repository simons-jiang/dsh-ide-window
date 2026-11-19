/**
 * Colour themes: the registry, the files on disk and the reader the route uses.
 *
 * A palette is data, so the checks are cheap and they are the only thing keeping
 * three lists in step — the client registry in `src/client/12-theme.js`, the
 * manifest in `themes/index.json`, and the stylesheets themselves. A theme that
 * forgot a token would silently inherit the DSH colour for that surface, which is
 * exactly the drift this suite refuses.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { themeCss } from '../index.js'

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

const root = fileURLToPath(new URL('..', import.meta.url))
const themeDir = join(root, 'themes')
const manifest = JSON.parse(readFileSync(join(themeDir, 'index.json'), 'utf8'))
const clientSource = readFileSync(join(root, 'src', 'client', '12-theme.js'), 'utf8')
const registry = [...clientSource.matchAll(/\{ id: '([a-z0-9-]+)', mode: '(dark|light)' \}/g)]
  .map((match) => ({ id: match[1], mode: match[2] }))

// ① 清单与客户端注册表一致
check(registry.length === 10, '客户端登记了 10 个主题', String(registry.length))
check(
  JSON.stringify(registry) === JSON.stringify(manifest),
  'themes/index.json 与客户端注册表一致',
  JSON.stringify({ registry: registry.map((theme) => theme.id), manifest: manifest.map((theme) => theme.id) }),
)
check(manifest.filter((theme) => theme.mode === 'dark').length === 5, '深色主题 5 个', String(manifest.filter((theme) => theme.mode === 'dark').length))
check(manifest.filter((theme) => theme.mode === 'light').length === 5, '浅色主题 5 个', String(manifest.filter((theme) => theme.mode === 'light').length))

// ② 每个主题都有文件，且变量集合完全相同
const files = readdirSync(themeDir).filter((name) => name.endsWith('.css')).sort()
check(files.length === manifest.length, '每个主题都有对应的样式文件', `${files.length} / ${manifest.length}`)

const tokensOf = (text) => [...text.matchAll(/^\s{2}(--[a-z0-9-]+):/gm)].map((match) => match[1])
const sets = manifest.map((theme) => ({
  id: theme.id,
  tokens: tokensOf(readFileSync(join(themeDir, `${theme.id}.css`), 'utf8')),
}))
const reference = sets[0]
const mismatched = sets.filter((entry) => JSON.stringify(entry.tokens) !== JSON.stringify(reference.tokens)).map((entry) => entry.id)
check(mismatched.length === 0, '所有主题定义同一组变量', JSON.stringify(mismatched))
check(reference.tokens.length >= 20, 'palette 覆盖了整套 alias token', String(reference.tokens.length))

// 语法高亮的八种颜色也是主题的一部分：深色主题的关键字色放到白底上根本看不清
const SYNTAX = ['keyword', 'string', 'number', 'comment', 'annotation', 'type', 'function', 'punct']
const missingSyntax = sets.filter((entry) => SYNTAX.some((name) => !entry.tokens.includes(`--iw-syn-${name}`))).map((entry) => entry.id)
check(missingSyntax.length === 0, '每套主题都定义了 8 个语法色变量', JSON.stringify(missingSyntax))

// ③ 作用域只落在面板上
const scopes = manifest.every((theme) => {
  const text = readFileSync(join(themeDir, `${theme.id}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // One flat rule per file, and its selector must be the panel scoped to this id.
  const selectors = [...text.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim())
  return selectors.length === 1 && selectors[0] === `[data-dsh-theme="${theme.id}"]`
})
check(scopes, '每个文件都只作用于 [data-dsh-theme=…]')

// ④ 宿主读取器：合法 id 返回 CSS，非法与未知 id 分别 400 / 404
{
  const css = themeCss('material-oceanic')
  check(css.includes('[data-dsh-theme="material-oceanic"]'), 'themeCss 返回该主题的样式', css.slice(0, 40))
  check(css.includes('--dsw-alias-bg-base'), '返回的样式里含 token 覆盖')

  const status = (fn) => {
    try {
      fn()
      return 200
    } catch (error) {
      return error?.status ?? 'throw'
    }
  }
  check(status(() => themeCss('../index')) === 400, '路径穿越被拒绝', String(status(() => themeCss('../index'))))
  check(status(() => themeCss('nope')) === 404, '未知主题返回 404', String(status(() => themeCss('nope'))))
  check(status(() => themeCss('')) === 400, '空 id 被拒绝', String(status(() => themeCss(''))))
}

// ⑤ 共享约定：客户端把主题写进 localStorage['dsh-theme'] 并派发同名事件，
//    dsh-git-window 靠这两样跟随；改动契约要同时改两个仓库。
const clientFiles = (name) => readFileSync(join(root, 'src', 'client', name), 'utf8')
const themeModule = clientFiles('12-theme.js')
check(themeModule.includes("const IDE_THEME_SHARED_KEY = 'dsh-theme'"), '共享键为 dsh-theme')
check(themeModule.includes("const IDE_THEME_SHARED_EVENT = 'dsh-theme'"), '共享事件为 dsh-theme')
check(clientFiles('40-panel.js').includes("'data-dsh-theme'"), '面板根节点设置 data-dsh-theme')

if (failures > 0) {
  console.log(`\n${failures} theme check(s) failed`)
  process.exit(1)
}
console.log('\nall theme checks passed')

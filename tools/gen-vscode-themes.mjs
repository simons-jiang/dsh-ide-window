/**
 * 从 VS Code 主题（Material Theme UI 里那批「移植主题」的上游仓库）生成工作区主题。
 *
 * 输入是 VS Code 的 theme json（可能带注释/尾逗号，这里先清掉再解析）：
 *   `colors.editor.background` 给底色、`tokenColors` 给语法色。
 *
 * 用法：node tools/gen-vscode-themes.mjs <SOURCE_DIR>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { themeCss, toward } from './theme-shared.mjs'

const SOURCE = process.argv[2] ?? '/tmp'

/** id → [源文件, 模式, 中文名, 展示用来源] */
const THEMES = [
  ['horizon-neo', 'vs-horizon.json', 'dark', 'Horizon Neo', 'Horizon (jolaleye/horizon-theme-vscode)'],
  ['horizon-bright', 'vs-horizon-bright.json', 'light', 'Horizon Bright', 'Horizon Bright (jolaleye/horizon-theme-vscode)'],
  ['cobalt2', 'vs-cobalt2.json', 'dark', 'Cobalt2', 'Cobalt2 (wesbos/cobalt2-vscode)'],
  ['shades-of-purple', 'vs-sop.json', 'dark', 'Shades of Purple', 'Shades of Purple (ahmadawais/shades-of-purple-vscode)'],
  ['winter-is-coming', 'vs-wic.json', 'dark', 'Winter is Coming', 'Winter is Coming (johnpapa/vscode-winteriscoming)'],
  ['noctis', 'vs-noctis.json', 'dark', 'Noctis', 'Noctis (liviuschera/noctis)'],
]

/** 去掉 JSONC 的注释与尾逗号。 */
function stripJsonc(text) {
  let out = ''
  let inString = false
  let escape = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (inString) {
      out += char
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      out += '\n'
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    out += char
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** tokenColors → 每个 scope 的颜色（后出现的覆盖先出现的，和 VS Code 的规则一致）。 */
function scopeColors(theme) {
  const map = new Map()
  const entries = theme.tokenColors ?? []
  for (const entry of entries) {
    const settings = entry.settings ?? {}
    if (typeof settings.foreground !== 'string') continue
    const scopes = typeof entry.scope === 'string' ? entry.scope.split(',') : Array.isArray(entry.scope) ? entry.scope : []
    for (const raw of scopes) {
      const scope = raw.trim()
      if (scope !== '') map.set(scope, settings.foreground)
    }
  }
  return map
}

/** 按 scope 前缀取色：先精确命中，再取最长的前缀。 */
function pickColor(map, scopes, fallback) {
  let best
  let bestLength = -1
  for (const [scope, color] of map) {
    for (const wanted of scopes) {
      if (scope === wanted) return color
      if (scope.startsWith(`${wanted}.`)) continue
      // VS Code 的 scope 是点分层级，父级作用到子级
      if ((scope.startsWith(wanted + ' ') || scope === wanted) && wanted.length > bestLength) {
        best = color
        bestLength = wanted.length
      }
    }
  }
  if (best !== undefined) return best
  for (const [scope, color] of map) {
    for (const wanted of scopes) {
      if (scope.startsWith(wanted) && wanted.length > bestLength) {
        best = color
        bestLength = wanted.length
      }
    }
  }
  return best ?? fallback
}

for (const [id, file, mode, label, source] of THEMES) {
  const theme = JSON.parse(stripJsonc(readFileSync(join(SOURCE, file), 'utf8')))
  const colors = theme.colors ?? {}
  const dark = mode === 'dark'
  const bg = colors['editor.background'] ?? (dark ? '#1e1e1e' : '#ffffff')
  const fg = colors['editor.foreground'] ?? colors.foreground ?? (dark ? '#d4d4d4' : '#24292f')
  const tertiary = colors['editorLineNumber.foreground'] ?? toward(fg, bg, 0.45)
  const accent = colors['focusBorder'] ?? colors['button.background'] ?? colors['activityBarBadge.background'] ?? fg
  const map = scopeColors(theme)
  const fn = pickColor(map, ['entity.name.function', 'support.function', 'meta.function-call', 'variable.function'], fg)
  const spec = {
    id,
    mode,
    source: `${source} → ${label}`,
    bg,
    fg,
    tertiary,
    accent,
    keyword: pickColor(map, ['keyword', 'storage.type', 'storage.modifier'], fg),
    string: pickColor(map, ['string', 'constant.other.symbol'], fg),
    number: pickColor(map, ['constant.numeric', 'constant.language'], fg),
    comment: pickColor(map, ['comment'], tertiary),
    type: pickColor(map, ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], fg),
    function: fn,
    punct: pickColor(map, ['punctuation', 'meta.brace', 'keyword.operator'], tertiary),
    success: colors['gitDecoration.addedResourceForeground'] ?? '#7fd88f',
    warning: colors['gitDecoration.modifiedResourceForeground'] ?? '#e5c07b',
    error: colors['gitDecoration.deletedResourceForeground'] ?? '#e06c75',
    business: colors['editorInfo.foreground'] ?? accent,
  }
  writeFileSync(join('themes', `${id}.css`), themeCss(spec))
  console.log(`${id.padEnd(20)} bg=${bg} kw=${spec.keyword} str=${spec.string} fn=${spec.function} type=${spec.type}`)
}

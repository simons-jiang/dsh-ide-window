/**
 * 从 Material Theme UI 的配色源生成工作区主题。
 *
 * 输入：插件仓库里的两类文件（本脚本不联网，先把它们下载到 SOURCE_DIR）：
 *   - `themes/regular/<方案>.theme.json`：界面色板（bg/fg/text/second/tree/selBg/accent…）
 *   - `colors/<方案>.xml`：编辑器语法色（DEFAULT_KEYWORD/STRING/…）
 *
 * 输出：`themes/<id>.css`，token 集合与顺序和手写主题完全一致（`test/theme.mjs` 会比对）。
 *
 * 用法：node tools/gen-material-themes.mjs <SOURCE_DIR>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = process.argv[2] ?? '/tmp/mt'

/** 方案表：id → [Material 方案名, 模式, 中文名, 英文名]。 */
const SCHEMES = [
  ['material-darker', 'Material Darker', 'dark', '极暗 Darker'],
  ['material-deep-ocean', 'Material Deep Ocean', 'dark', '深蓝深海 Deep Ocean'],
  ['material-forest', 'Material Forest', 'dark', '森林 Forest'],
  ['material-volcano', 'Material Volcano', 'dark', '火山 Volcano'],
  ['material-space', 'Material Space', 'dark', '星海 Space'],
  ['arc-dark', 'Arc Dark', 'dark', '弧光 Arc Dark'],
  ['github-dark', 'GitHub Dark', 'dark', 'GitHub 暗色'],
  ['atom-one-dark', 'Atom One Dark', 'dark', 'Atom 暗色'],
  ['solarized-dark', 'Solarized Dark', 'dark', 'Solarized 暗色'],
  ['moonlight', 'Moonlight', 'dark', '月光 Moonlight'],
  ['synthwave-84', "SynthWave '84", 'dark', "合成波 '84"],
  ['material-sky-blue', 'Material Sky Blue', 'light', '天蓝 Sky Blue'],
  ['material-sandy-beach', 'Material Sandy Beach', 'light', '沙丘 Sandy Beach'],
]

const parseHex = (value) => {
  const match = /^#?([0-9a-f]{6})/i.exec(String(value ?? ''))
  if (match === null) throw new Error(`bad colour: ${value}`)
  return [0, 2, 4].map((index) => parseInt(match[1].slice(index, index + 2), 16))
}
const hex = (rgb) => '#' + rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')
const mix = (a, b, weight) => {
  const A = parseHex(a), B = parseHex(b)
  return hex(A.map((value, index) => value * weight + B[index] * (1 - weight)))
}
/** 把 `from` 往 `to` 推 `amount`（0..1）。 */
const toward = (from, to, amount) => mix(to, from, amount)
const hsl = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return hex([r, g, b].map((value) => (value + m) * 255))
}

/** 括号 10 档：色相 36° 一档，深浅按模式（和手写主题同一套公式）。 */
const brackets = (dark) => Array.from({ length: 10 }, (_, index) => hsl(index * 36, dark ? 0.72 : 0.62, dark ? 0.68 : 0.4))

/** 从 .icls 里取一个属性的前景色。 */
function editorColor(xml, name) {
  const block = new RegExp(`<option name="${name}">([\\s\\S]*?)</option>`).exec(xml)
  if (block === null) return undefined
  const foreground = /<option name="FOREGROUND" value="([0-9a-fA-F]{6})"/.exec(block[1])
  return foreground === null ? undefined : `#${foreground[1].toLowerCase()}`
}

const cssBlock = (tokens) => tokens.map(([name, value]) => `  --${name}: ${value};`).join('\n')

for (const [id, scheme, mode, zhName] of SCHEMES) {
  const palette = JSON.parse(readFileSync(join(SOURCE, `theme-${scheme}.json`), 'utf8'))
  const colors = palette.colors
  const xml = readFileSync(join(SOURCE, `colors-${scheme}.xml`), 'utf8')
  const dark = mode === 'dark'
  const bg = colors.bg
  const fg = colors.fg ?? colors.white
  const tertiary = colors.text ?? colors.dis
  // 图层固定「越往上越浅（深色）/越深（浅色）」，不依赖各方案里 tree 的相对亮度
  const up = dark ? '#ffffff' : '#000000'
  const layer1 = toward(bg, up, dark ? 0.05 : 0.04)
  const layer2 = toward(bg, up, dark ? 0.09 : 0.07)
  const layer3 = toward(bg, up, dark ? 0.14 : 0.11)
  const overlay = dark ? toward(bg, '#000000', 0.2) : toward(bg, '#000000', 0.06)
  const keyword = editorColor(xml, 'DEFAULT_KEYWORD')
  const string = editorColor(xml, 'DEFAULT_STRING')
  const number = editorColor(xml, 'DEFAULT_NUMBER')
  const comment = editorColor(xml, 'DEFAULT_LINE_COMMENT')
  const fn = editorColor(xml, 'DEFAULT_FUNCTION_CALL') ?? editorColor(xml, 'DEFAULT_FUNCTION_DECLARATION') ?? editorColor(xml, 'DEFAULT_METADATA')
  const type = editorColor(xml, 'DEFAULT_CLASS_NAME') ?? editorColor(xml, 'DEFAULT_CLASS_REFERENCE') ?? fg
  const punct = editorColor(xml, 'DEFAULT_SEMICOLON') ?? editorColor(xml, 'DEFAULT_COMMA') ?? editorColor(xml, 'DEFAULT_IDENTIFIER') ?? colors.dis
  const blue = colors.blue ?? colors.accent
  const tokens = [
    ['dsw-alias-bg-base', bg],
    ['dsw-alias-bg-layer-1', layer1],
    ['dsw-alias-bg-layer-2', layer2],
    ['dsw-alias-bg-layer-3', layer3],
    ['dsw-alias-bg-overlay', overlay],
    ['dsw-specific-sidebar-fill', layer1],
    ['dsw-specific-menu', layer2],
    ['dsw-alias-card-fill', layer2],
    ['dsw-alias-card-fill-hover', layer3],
    ['dsw-alias-card-tile-fill', layer2],
    ['dsw-alias-label-primary', fg],
    ['dsw-alias-label-secondary', toward(fg, tertiary, 0.45)],
    ['dsw-alias-label-tertiary', tertiary],
    ['dsw-alias-border-l1', layer2],
    ['dsw-alias-markdown-inline-code', 'var(--dsw-alias-bg-layer-3)'],
    ['dsw-alias-border-l2', layer3],
    ['dsw-alias-border-l3', toward(layer3, fg, 0.3)],
    ['dsw-alias-border', layer2],
    ['dsw-alias-brand-primary', colors.accent],
    ['dsw-alias-interactive-bg-hover', colors.selBg ?? layer3],
    ['dsw-alias-state-success-primary', colors.green ?? '#7fd88f'],
    ['dsw-alias-state-warning-primary', colors.yellow ?? '#e5c07b'],
    ['dsw-alias-state-error-primary', colors.red ?? '#e06c75'],
    ['dsw-alias-state-business-primary', blue],
    ['dsw-alias-state-idle-primary', tertiary],
    ['dsw-focus-ring-color', blue],
    ['iw-changes-fill', blue],
    ['iw-changes-hover', toward(blue, '#ffffff', 0.35)],
    ['iw-syn-keyword', keyword],
    ['iw-syn-string', string],
    ['iw-syn-number', number],
    ['iw-syn-comment', comment],
    ['iw-syn-annotation', fn],
    ['iw-syn-type', type],
    ['iw-syn-function', fn],
    ['iw-syn-punct', punct],
    ['iw-syn-param', number],
    ...brackets(dark).map((color, index) => [`iw-br-${index}`, color]),
  ]
  const header = `/**
 * ${id} (${mode}) — a palette for the code workspace.
 *
 * Generated from Material Theme UI's "${scheme}" (themes/regular + colors), see
 * tools/gen-material-themes.mjs. Only DSH alias tokens are overridden, scoped to
 * the panel, so every \`.iw-*\` rule picks the palette up.
 */
[data-dsh-theme="${id}"] {`
  writeFileSync(join('themes', `${id}.css`), `${header}\n${cssBlock(tokens)}\n}\n`)
  console.log(`${id.padEnd(22)} ${zhName}`)
}

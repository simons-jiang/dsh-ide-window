/**
 * 主题生成的公共部分：颜色计算 + 一份 palette 落成 `themes/<id>.css`。
 *
 * token 名称与顺序必须和手写主题一致——`test/theme.mjs` 会逐个比对 23+ 套主题的
 * 变量集合，多一个少一个都会失败。
 */

export const parseHex = (value) => {
  let raw = String(value ?? '').trim().replace(/^#/, '')
  // #abc / #abcd / #aabbcc / #aabbccdd 都要吃：上游主题里四种写法都有
  if (/^[0-9a-f]{3}$/i.test(raw)) raw = raw.split('').map((char) => char + char).join('')
  if (/^[0-9a-f]{4}$/i.test(raw)) raw = raw.slice(0, 3).split('').map((char) => char + char).join('')
  if (/^[0-9a-f]{8}$/i.test(raw)) raw = raw.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(raw)) throw new Error(`bad colour: ${value}`)
  return [0, 2, 4].map((index) => parseInt(raw.slice(index, index + 2), 16))
}
export const hex = (rgb) => '#' + rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')
/** `a` 占 `weight`，`b` 占剩下的。 */
export const mix = (a, b, weight) => {
  const A = parseHex(a), B = parseHex(b)
  return hex(A.map((value, index) => value * weight + B[index] * (1 - weight)))
}
/** 把 `from` 往 `to` 推 `amount`（0..1）。 */
export const toward = (from, to, amount) => mix(to, from, amount)

const hsl = (h, s, l) => {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x]
  return hex([r, g, b].map((value) => (value + m) * 255))
}

/** 括号 10 档：色相 36° 一档，深浅按模式。 */
export const brackets = (dark) => Array.from({ length: 10 }, (_, index) => hsl(index * 36, dark ? 0.72 : 0.62, dark ? 0.68 : 0.4))

/**
 * 一份配色 → 主题文件内容。
 *
 * @param spec - `{ id, mode, source, bg, fg, tertiary, accent, keyword, string, number, comment, annotation, type, function, punct, success, warning, error, business, overlay }`
 */
/** 统一成 6 位小写，避免把 `#B877DBE6` 这种带 alpha 的值写进 CSS。 */
const canon = (value) => hex(parseHex(value))

export function themeCss(spec) {
  for (const key of ['bg', 'fg', 'tertiary', 'accent', 'keyword', 'string', 'number', 'comment', 'annotation', 'type', 'function', 'punct', 'success', 'warning', 'error', 'business', 'overlay']) {
    if (spec[key] !== undefined) spec[key] = canon(spec[key])
  }
  const dark = spec.mode === 'dark'
  const done = (label, value) => (value === undefined || value === '' ? label : value)
  const up = dark ? '#ffffff' : '#000000'
  const layer1 = toward(spec.bg, up, dark ? 0.05 : 0.04)
  const layer2 = toward(spec.bg, up, dark ? 0.09 : 0.07)
  const layer3 = toward(spec.bg, up, dark ? 0.14 : 0.11)
  const overlay = spec.overlay ?? (dark ? toward(spec.bg, '#000000', 0.2) : toward(spec.bg, '#000000', 0.06))
  const fn = done('function', spec.function)
  const tokens = [
    ['dsw-alias-bg-base', spec.bg],
    ['dsw-alias-bg-layer-1', layer1],
    ['dsw-alias-bg-layer-2', layer2],
    ['dsw-alias-bg-layer-3', layer3],
    ['dsw-alias-bg-overlay', overlay],
    ['dsw-specific-sidebar-fill', layer1],
    ['dsw-specific-menu', layer2],
    ['dsw-alias-card-fill', layer2],
    ['dsw-alias-card-fill-hover', layer3],
    ['dsw-alias-card-tile-fill', layer2],
    ['dsw-alias-label-primary', spec.fg],
    ['dsw-alias-label-secondary', toward(spec.fg, spec.tertiary, 0.45)],
    ['dsw-alias-label-tertiary', spec.tertiary],
    ['dsw-alias-border-l1', layer2],
    ['dsw-alias-markdown-inline-code', 'var(--dsw-alias-bg-layer-3)'],
    ['dsw-alias-border-l2', layer3],
    ['dsw-alias-border-l3', toward(layer3, spec.fg, 0.3)],
    ['dsw-alias-border', layer2],
    ['dsw-alias-brand-primary', spec.accent],
    ['dsw-alias-interactive-bg-hover', toward(layer3, spec.accent, 0.2)],
    ['dsw-alias-state-success-primary', spec.success],
    ['dsw-alias-state-warning-primary', spec.warning],
    ['dsw-alias-state-error-primary', spec.error],
    ['dsw-alias-state-business-primary', spec.business],
    ['dsw-alias-state-idle-primary', spec.tertiary],
    ['dsw-focus-ring-color', spec.business],
    ['iw-changes-fill', spec.business],
    ['iw-changes-hover', toward(spec.business, '#ffffff', 0.35)],
    ['iw-syn-keyword', spec.keyword],
    ['iw-syn-string', spec.string],
    ['iw-syn-number', spec.number],
    ['iw-syn-comment', spec.comment],
    ['iw-syn-annotation', fn],
    ['iw-syn-type', spec.type],
    ['iw-syn-function', fn],
    ['iw-syn-punct', spec.punct],
    ['iw-syn-param', spec.number],
    ...brackets(dark).map((color, index) => [`iw-br-${index}`, color]),
  ]
  const header = `/**
 * ${spec.id} (${spec.mode}) — a palette for the code workspace.
 *
 * Generated from ${spec.source}, see tools/gen-*.mjs. Only DSH alias tokens are
 * overridden, scoped to the panel, so every \`.iw-*\` rule picks the palette up.
 */
[data-dsh-theme="${spec.id}"] {`
  return `${header}\n${tokens.map(([name, value]) => `  --${name}: ${value};`).join('\n')}\n}\n`
}

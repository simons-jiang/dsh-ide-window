/**
 * "Open in the data window" — the code workspace is the caller side of the
 * cross-plugin bridge owned by `dsh-data-window`.
 *
 * Contract: `docs/BRIDGE.md` in the data window repository.
 *
 * - capability marker `window.__DSH_DATA_WINDOW_BRIDGE__ = { v: 1 }`, set while
 *   that plugin is active;
 * - request `dsh-data-window:request` with `{ v: 1, id, action, root, ... }`;
 * - response `dsh-data-window:response` with `{ v, id, action, ok, reason }`.
 *
 * This plugin never imports the data window and never runs SQL itself: it only
 * resolves a table name (or a mapper statement) and hands it over.
 */

const IDE_DATA_WINDOW_KEY = '__DSH_DATA_WINDOW_BRIDGE__'
const IDE_DATA_WINDOW_REQUEST = 'dsh-data-window:request'
const IDE_DATA_WINDOW_RESPONSE = 'dsh-data-window:response'
const IDE_DATA_WINDOW_ACK_MS = 2000

/** Whether the data window plugin is installed and active in this page. */
function ideDataWindowAvailable() {
  return Number(globalThis[IDE_DATA_WINDOW_KEY]?.v) === 1
}

/** One request/response round trip; always resolves, never rejects. */
function ideDataWindowRequest(detail) {
  if (!ideDataWindowAvailable()) return Promise.resolve({ ok: false, reason: 'not-installed' })
  const id = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `dw-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return new Promise((resolve) => {
    const onResponse = (event) => {
      const ack = event?.detail
      if (ack === null || typeof ack !== 'object' || ack.id !== id) return
      cleanup()
      resolve(ack)
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve({ ok: false, reason: 'timeout' })
    }, IDE_DATA_WINDOW_ACK_MS)
    const cleanup = () => {
      clearTimeout(timer)
      globalThis.removeEventListener(IDE_DATA_WINDOW_RESPONSE, onResponse)
    }
    globalThis.addEventListener(IDE_DATA_WINDOW_RESPONSE, onResponse)
    globalThis.dispatchEvent(new CustomEvent(IDE_DATA_WINDOW_REQUEST, {
      detail: { v: 1, id, ...detail },
    }))
  })
}

/** Read one workspace file through the plugin's own text route. */
async function ideDataWindowReadFile(root, path) {
  const result = await ideTreeRoute('text', { workspaceRoot: root, path })
  if (result.ok !== true) return ''
  return String(result.value?.text ?? '')
}

/** The table a `@TableName` annotation names; `schema` is empty for a bare name. */
function ideDataWindowTableOf(text) {
  const match = /@TableName\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/.exec(String(text ?? ''))
  if (match === null) return null
  const qualified = match[1].replace(/`/g, '').trim()
  if (qualified === '' || qualified.includes(' ')) return null
  const dot = qualified.lastIndexOf('.')
  return dot > 0
    ? { table: qualified.slice(dot + 1), schema: qualified.slice(0, dot) }
    : { table: qualified, schema: '' }
}

/** One message per kind of failure the bridge can report. */
function ideDataWindowNotice(store, tr, ack, label) {
  if (ack?.ok === true) {
    const where = [ack.env, ack.database].filter((part) => typeof part === 'string' && part !== '').join(' · ')
    store.setNotice(`${tr('dataWindowOpened')} ${label}${where === '' ? '' : ` · ${where}`}`)
    return
  }
  const reasons = {
    'not-installed': 'dataWindowNotInstalled',
    timeout: 'dataWindowTimeout',
    'no-datasource': 'dataWindowNoDatasource',
    'table-not-found': 'dataWindowNoTable',
    'query-failed': 'dataWindowQueryFailed',
  }
  const key = reasons[ack?.reason] ?? 'dataWindowFailed'
  store.setNotice(`${tr(key)}${ack?.reason === undefined ? '' : ` (${ack.reason})`}`)
}

/** Right-click a Java entity: parse `@TableName` and open that table. */
async function ideDataWindowOpenEntity(store, tr, root, path) {
  if (root === '') {
    store.setNotice(tr('dataWindowNoWorkspace'))
    return
  }
  const text = await ideDataWindowReadFile(root, path)
  const parsed = ideDataWindowTableOf(text)
  if (parsed === null) {
    store.setNotice(tr('dataWindowNoTableName'))
    return
  }
  store.setNotice(tr('dataWindowOpening'))
  const ack = await ideDataWindowRequest({
    action: 'openTable',
    root,
    schema: parsed.schema,
    table: parsed.table,
  })
  ideDataWindowNotice(store, tr, ack, `${parsed.schema === '' ? '' : `${parsed.schema}.`}${parsed.table}`)
}

/** Escape a literal for use inside a RegExp. */
function ideDataWindowEscape(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Byte offset of a method declaration named `symbol` closest to `line`. */
function ideDataWindowMethodOffset(text, symbol, line) {
  const pattern = new RegExp(`\\b${ideDataWindowEscape(symbol)}\\s*\\(`, 'g')
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  let match
  while ((match = pattern.exec(text)) !== null) {
    const lineNo = text.slice(0, match.index).split('\n').length
    const distance = Math.abs(lineNo - (Number(line) || 1))
    if (distance < bestDistance) {
      best = match.index
      bestDistance = distance
    }
  }
  return best
}

/** Offset of the closing parenthesis that matches the one at `open`. */
function ideDataWindowCloseParen(text, open) {
  let depth = 0
  let quote = ''
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (quote !== '') {
      if (char === '\\') {
        index += 1
        continue
      }
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === '\'') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/** The SQL of a `@Select`/`@Insert`/... annotation above the method, if any. */
function ideDataWindowAnnotationSql(text, symbol, line) {
  const start = ideDataWindowMethodOffset(text, symbol, line)
  if (start < 0) return ''
  let at = -1
  for (const name of ['Select', 'Insert', 'Update', 'Delete']) {
    const index = text.lastIndexOf(`@${name}`, start)
    if (index > at) at = index
  }
  if (at < 0) return ''
  const open = text.indexOf('(', at)
  if (open < 0) return ''
  const close = ideDataWindowCloseParen(text, open)
  if (close < 0) return ''
  const body = text.slice(open + 1, close)
  // An annotation may concatenate string literals; join them in order.
  const literals = [...body.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((m) => m[0].slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t'))
  return literals.join('').trim()
}

/** Decode the XML entities a mapper statement can contain. */
function ideDataWindowDecodeXml(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
}

/**
 * The SQL of one mapper statement from its XML file.
 *
 * The namespace search is a content grep, so the mapper does not have to sit at a
 * conventional path. A dynamic statement keeps its raw text; the user is told it
 * needs adjusting rather than being handed a silently wrong static SQL.
 */
async function ideDataWindowXmlSql(root, fqcn, symbol) {
  const found = await ideGrepQuery(root, `namespace="${fqcn}"`, { extensions: ['xml'] })
  if (found.ok !== true || found.matches.length === 0) return null
  const paths = found.matches.map((match) => String(match.path ?? ''))
  const path = paths.find((entry) => entry.includes('/src/main/resources/')) ?? paths[0]
  if (path === '') return null
  const text = await ideDataWindowReadFile(root, path)
  if (text === '') return null
  const pattern = new RegExp(
    `<\\s*(select|insert|update|delete)\\b[^>]*\\bid\\s*=\\s*["']${ideDataWindowEscape(symbol)}["'][^>]*>([\\s\\S]*?)<\\s*/\\s*\\1\\s*>`,
    'i',
  )
  const match = pattern.exec(text)
  if (match === null) return null
  const body = match[2]
  if (body.trim() === '') return null
  const dynamic = /<\s*(if|foreach|choose|when|otherwise|include|bind|set|where|trim)\b/i.test(body)
  const decoded = ideDataWindowDecodeXml(body).trim()
  return dynamic
    ? `-- MyBatis 动态 SQL，已按 XML 原文粘贴，请按需调整\n${decoded}`
    : decoded
}

/** Right-click a mapper method: resolve its statement and paste it. */
async function ideDataWindowOpenMapper(store, tr, root, path, symbol, line) {
  if (root === '') {
    store.setNotice(tr('dataWindowNoWorkspace'))
    return
  }
  const name = String(symbol ?? '').trim()
  if (name === '') {
    store.setNotice(tr('dataWindowNoSql'))
    return
  }
  const text = await ideDataWindowReadFile(root, path)
  if (text === '') {
    store.setNotice(tr('dataWindowNoSql'))
    return
  }
  const packageMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(text)
  const typeMatch = /\b(?:interface|class|enum)\s+(\w+)/.exec(text)
  const typeName = typeMatch === null ? ideBasename(path).replace(/\.(java|kt)$/i, '') : typeMatch[1]
  const fqcn = packageMatch === null ? typeName : `${packageMatch[1]}.${typeName}`
  const sql = ideDataWindowAnnotationSql(text, name, line)
    || await ideDataWindowXmlSql(root, fqcn, name)
  if (typeof sql !== 'string' || sql.trim() === '') {
    store.setNotice(tr('dataWindowNoSql'))
    return
  }
  store.setNotice(tr('dataWindowOpening'))
  const ack = await ideDataWindowRequest({
    action: 'openSql',
    root,
    sql,
    title: `${typeName}.${name}`,
  })
  ideDataWindowNotice(store, tr, ack, `${typeName}.${name}`)
}

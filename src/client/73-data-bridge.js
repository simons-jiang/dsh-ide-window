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
  return literals.join(' ').trim()
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

/** 嵌套 `<include>` 最多展开这么多层，超过就按未解析处理，防止递归失控。 */
const IDE_DATA_WINDOW_INCLUDE_DEPTH = 8

/**
 * 一个 mapper 文件里所有 `<sql id="...">` 片段，按 id 建索引。
 *
 * 片段是 mapper 语句的另一半：语句用 `<include refid="..."/>` 复用筛选条件块。
 * 早先这里直接把 include 标签删掉，于是 `WHERE <include .../>` 变成光秃秃的
 * `WHERE`，数据窗口拿到的 SQL 语法都不成立。
 */
function ideDataWindowSqlFragments(text) {
  const fragments = {}
  const pattern = /<sql\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\s*sql\s*>/gi
  let match
  while ((match = pattern.exec(String(text ?? ''))) !== null) {
    fragments[match[1]] = match[2]
  }
  return fragments
}

/** 把 refid 拆成「命名空间 + 片段名」，裸名字没有命名空间。 */
function ideDataWindowRefId(refid) {
  const text = String(refid ?? '').trim()
  const dot = text.lastIndexOf('.')
  return dot > 0 ? { namespace: text.slice(0, dot), id: text.slice(dot + 1) } : { namespace: '', id: text }
}

/** 某个命名空间的片段表；一次调用内只查一次，跨文件 include 靠它加载。 */
async function ideDataWindowMapperFragments(root, files, namespace) {
  if (files.has(namespace)) return files.get(namespace)
  const found = await ideGrepQuery(root, `namespace="${namespace}"`, { extensions: ['xml'] })
  const paths = found.ok === true ? found.matches.map((match) => String(match.path ?? '')) : []
  const path = paths.find((entry) => entry.includes('/src/main/resources/')) ?? paths[0] ?? ''
  const text = path === '' ? '' : await ideDataWindowReadFile(root, path)
  const fragments = text === '' ? null : ideDataWindowSqlFragments(text)
  files.set(namespace, fragments)
  return fragments
}

/** 文本里每个 `<include>` 的位置，成对（带 `<property>` 子标签）和自闭合都认。 */
function ideDataWindowIncludes(body) {
  const text = String(body ?? '')
  const items = []
  const open = /<include\b/gi
  let match
  while ((match = open.exec(text)) !== null) {
    const start = match.index
    const end = text.indexOf('>', start)
    if (end < 0) break
    const raw = text.slice(start + '<include'.length, end)
    const head = raw.replace(/\/\s*$/, '')
    if (/\/\s*$/.test(raw)) {
      items.push({ index: start, length: end + 1 - start, attrs: head, body: '' })
      open.lastIndex = end + 1
      continue
    }
    // 自闭合标签后面紧跟的内容不属于它；只有成对标签才向后找 `</include>`。
    const closing = /<\/\s*include\s*>/i.exec(text.slice(end + 1))
    if (closing === null) {
      items.push({ index: start, length: end + 1 - start, attrs: head, body: '' })
      open.lastIndex = end + 1
      continue
    }
    const bodyEnd = end + 1 + closing.index
    items.push({
      index: start,
      length: bodyEnd + closing[0].length - start,
      attrs: head,
      body: text.slice(end + 1, bodyEnd),
    })
    open.lastIndex = bodyEnd + closing[0].length
  }
  return items
}

/** `<include>` 里 `<property name=... value=.../>` 提供的占位符值。 */
function ideDataWindowIncludeProps(body) {
  const props = {}
  for (const match of String(body ?? '').matchAll(/<property\b[^>]*\/?\s*>/gi)) {
    const attrs = ideDataWindowXmlAttrs(match[0])
    if (attrs.name !== undefined && attrs.value !== undefined) props[attrs.name] = attrs.value
  }
  return props
}

/** 用 include 的 property 值替换片段里的 `${name}`，其余占位符留给参数填充。 */
function ideDataWindowApplyProps(sql, props) {
  const names = Object.keys(props)
  if (names.length === 0) return String(sql ?? '')
  return String(sql ?? '').replace(/\$\{\s*([^}]+?)\s*\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(props, name) ? props[name] : whole
  ))
}

/**
 * 展开 `<include refid="..."/>`：同文件片段、跨命名空间片段、嵌套 include 与
 * include 自带的 property 都解析。
 *
 * 解析不出来的片段换成一条 SQL 注释而不是静默消失——注释能看出缺了谁，空洞
 * 只会让数据窗口执行一段语法错误的 SQL。`missing` 收集这些 refid 交给调用方
 * 写进头部注释。
 */
async function ideDataWindowExpandIncludes(root, files, namespace, body, seen, missing, depth) {
  const text = String(body ?? '')
  const items = ideDataWindowIncludes(text)
  if (items.length === 0 || depth > IDE_DATA_WINDOW_INCLUDE_DEPTH) return text
  let result = ''
  let cursor = 0
  for (const item of items) {
    result += text.slice(cursor, item.index)
    cursor = item.index + item.length
    const refid = String(ideDataWindowXmlAttrs(item.attrs).refid ?? '').trim()
    if (refid === '') {
      result += '/* include without refid */'
      missing.push('(without refid)')
      continue
    }
    const ref = ideDataWindowRefId(refid)
    const owner = ref.namespace === '' ? namespace : ref.namespace
    const key = `${owner}|${ref.id}`
    if (seen.has(key)) {
      result += `/* include cycle: ${refid} */`
      missing.push(refid)
      continue
    }
    const fragments = await ideDataWindowMapperFragments(root, files, owner)
    const fragment = fragments === null ? undefined : fragments[ref.id]
    if (fragment === undefined) {
      result += `/* include not found: ${refid} */`
      missing.push(refid)
      continue
    }
    const provided = ideDataWindowApplyProps(fragment, ideDataWindowIncludeProps(item.body))
    result += await ideDataWindowExpandIncludes(root, files, owner, provided, new Set(seen).add(key), missing, depth + 1)
  }
  result += text.slice(cursor)
  return result
}

/**
 * The SQL of one mapper statement from its XML file, with `<include>` expanded.
 *
 * The namespace search is a content grep, so the mapper does not have to sit at a
 * conventional path. `missing` lists the refids that could not be resolved, so the
 * header can say which filter block is absent instead of pretending the SQL is whole.
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
  const files = new Map([[fqcn, ideDataWindowSqlFragments(text)]])
  const missing = []
  const expanded = await ideDataWindowExpandIncludes(root, files, fqcn, body, new Set(), missing, 0)
  return { sql: ideDataWindowDecodeXml(expanded).trim(), missing }
}

/** Parse the attributes of one XML-ish tag, single or double quoted. */
function ideDataWindowXmlAttrs(text) {
  const attrs = {}
  for (const match of String(text ?? '').matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[match[1]] = match[3] ?? match[4] ?? ''
  }
  return attrs
}

/** Split a parameter list on commas that are not inside generics or parentheses. */
function ideDataWindowSplitParams(body) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of String(body ?? '')) {
    if (char === '<' || char === '(' || char === '[') depth += 1
    if (char === '>' || char === ')' || char === ']') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

/** Method parameters as `name -> declared type`, from the interface source. */
function ideDataWindowMethodParams(text, offset) {
  const params = {}
  if (offset < 0) return params
  const open = text.indexOf('(', offset)
  if (open < 0) return params
  const close = ideDataWindowCloseParen(text, open)
  if (close < 0) return params
  for (const part of ideDataWindowSplitParams(text.slice(open + 1, close))) {
    const named = /@Param\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/.exec(part)
    const cleaned = part.replace(/@[\w.]+(\s*\([^)]*\))?/g, ' ').trim()
    if (cleaned === '') continue
    const tokens = cleaned.split(/\s+/)
    const name = named !== null ? named[1] : tokens[tokens.length - 1]
    const type = tokens.slice(0, -1).join(' ')
    if (name !== undefined && name !== '') params[name] = type
  }
  return params
}

/** A runnable default for one parameter type. */
function ideDataWindowDefaultValue(type, index) {
  const declared = String(type ?? '')
  if (/string|char/i.test(declared)) return "'demo'"
  if (/date|time/i.test(declared)) return "'2026-01-01 00:00:00'"
  if (/bool/i.test(declared)) return '1'
  void index
  return '1'
}

/** Value for one `#{...}` expression; a foreach item takes the iteration index. */
function ideDataWindowValueFor(expr, params, index, item) {
  const name = String(expr ?? '').split(',')[0].trim()
  const key = name.split('.')[0]
  if (item !== '' && (key === item || name.startsWith(`${item}.`))) return String(index)
  return ideDataWindowDefaultValue(params[key] ?? '', index)
}

/** Expand `<foreach>` into three default rows so the SQL can run as-is. */
function ideDataWindowExpandForeach(sql, params) {
  let result = String(sql ?? '')
  const pattern = /<foreach\b([^>]*)>([\s\S]*?)<\/foreach>/i
  let match
  while ((match = pattern.exec(result)) !== null) {
    const attrs = ideDataWindowXmlAttrs(match[1])
    const item = String(attrs.item ?? 'item')
    const separator = attrs.separator ?? ','
    const open = attrs.open ?? ''
    const close = attrs.close ?? ''
    const inner = match[2].replace(/,\s*$/, '')
    const rows = []
    for (let index = 1; index <= 3; index += 1) {
      rows.push(inner.replace(/\$\{([^}]+)\}|#\{([^}]+)\}/g, (whole, dollar, hash) => (
        ideDataWindowValueFor(dollar ?? hash, params, index, item)
      )).trim())
    }
    const delimiter = separator.trim() === '' ? ',' : `${separator.trim()} `
    result = result.slice(0, match.index) + open.trim() + rows.join(delimiter) + close.trim() + result.slice(match.index + match[0].length)
  }
  return result
}

/** Remove the MyBatis dynamic tags, keeping the SQL they contain. */
function ideDataWindowStripTags(sql) {
  let result = String(sql ?? '')
  // CDATA 里是原样 SQL，先去壳，否则会被下面「未知标签」那条清理连内容一起吞掉。
  result = result.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  result = result.replace(/<\s*script\b[^>]*>/gi, '').replace(/<\s*\/\s*script\s*>/gi, '')
  result = result.replace(/<choose\b[^>]*>([\s\S]*?)<\/choose>/gi, (whole, body) => {
    const when = /<when\b[^>]*>([\s\S]*?)<\/when>/i.exec(body)
    const otherwise = /<otherwise\b[^>]*>([\s\S]*?)<\/otherwise>/i.exec(body)
    return when !== null ? when[1] : otherwise !== null ? otherwise[1] : ''
  })
  result = result.replace(/<where\b[^>]*>([\s\S]*?)<\/where>/gi, (whole, body) => (
    ` WHERE ${body.replace(/^\s*(and|or)\b/i, '')} `
  ))
  result = result.replace(/<set\b[^>]*>([\s\S]*?)<\/set>/gi, (whole, body) => (
    ` SET ${body.replace(/,\s*$/, '')} `
  ))
  result = result.replace(/<trim\b([^>]*)>([\s\S]*?)<\/trim>/gi, (whole, attrText, body) => {
    const attrs = ideDataWindowXmlAttrs(attrText)
    let inner = body
    for (const prefix of String(attrs.prefixOverrides ?? '').split('|')) {
      const text = prefix.trim()
      if (text !== '') inner = inner.replace(new RegExp(`^\\s*${ideDataWindowEscape(text)}`, 'i'), '')
    }
    for (const suffix of String(attrs.suffixOverrides ?? '').split('|')) {
      const text = suffix.trim()
      if (text !== '') inner = inner.replace(new RegExp(`${ideDataWindowEscape(text)}\\s*$`, 'i'), '')
    }
    return `${String(attrs.prefix ?? '').trim()} ${inner} ${String(attrs.suffix ?? '').trim()}`
  })
  for (const tag of ['if', 'when', 'otherwise']) {
    const pattern = new RegExp(`<\\s*${tag}\\b[^>]*>([\\s\\S]*?)<\\s*/\\s*${tag}\\s*>`, 'gi')
    result = result.replace(pattern, '$1')
  }
  result = result.replace(/<bind\b[^>]*\/?\s*>/gi, '')
  // Anything left (foreach and include are already expanded) is an unsupported tag: drop it.
  // 只认「XML 形状」的标签（字母或 `!` 开头）：`a &lt; 5` 解出来是比较运算符，
  // 按 `<[^>]+>` 删会把 `<` 到后面某个 `>` 之间的真实 SQL 一起吞掉。
  result = result.replace(/<\/?[A-Za-z!][^>]*>/g, '')
  // `<where>` may have wrapped its leading AND/OR inside a stripped `<if>`.
  result = result.replace(/\bWHERE\s+(AND|OR)\b/gi, 'WHERE')
  // 条件被动态标签或解析失败的 include 吃光后只剩一个 WHERE，留着就是语法错误。
  result = result.replace(/\bWHERE\b(?=(?:\s*\/\*[\s\S]*?\*\/)*\s*(?:ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|UNION|FOR\s+UPDATE|\)|;|$))/gi, '')
  return result
}

/** Fill `#{...}` / `${...}` with runnable defaults. */
function ideDataWindowFillParams(sql, params) {
  return String(sql ?? '').replace(/\$\{([^}]+)\}|#\{([^}]+)\}/g, (whole, dollar, hash) => (
    ideDataWindowValueFor(dollar ?? hash, params, 1, '')
  ))
}

/** One-line summary of the values baked into the SQL, for the header comment. */
function ideDataWindowDefaultSummary(params) {
  return Object.entries(params).map(([name, type]) => {
    const value = /list|collection|\[\]/i.test(type) ? '1, 2, 3' : ideDataWindowDefaultValue(type, 1)
    return `${name}=${value}`
  }).join('; ')
}

/** Turn a MyBatis statement into SQL that runs without the framework. */
function ideDataWindowExecutableSql(raw, params) {
  const expanded = ideDataWindowExpandForeach(raw, params)
  const stripped = ideDataWindowStripTags(expanded)
  const filled = ideDataWindowFillParams(stripped, params)
  return filled
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .replace(/\b(IN|in)\s*\(/g, 'IN (')
    // `WHERE` 独占一行时，看上去和「条件被吃掉了」的空 WHERE 一模一样；把紧跟着
    // 它的第一个条件接上去，一眼就能看出条件在不在。`SET` 同理。
    .replace(/\b(WHERE|SET)[ \t]*\n[ \t]*(?=\S)/gi, (whole, keyword) => `${keyword.toUpperCase()} `)
    .trim()
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
  const methodOffset = ideDataWindowMethodOffset(text, name, line)
  const params = ideDataWindowMethodParams(text, methodOffset)
  const annotation = ideDataWindowAnnotationSql(text, name, line)
  const statement = annotation === '' ? await ideDataWindowXmlSql(root, fqcn, name) : { sql: annotation, missing: [] }
  const raw = statement === null ? '' : String(statement.sql ?? '')
  const sql = raw === '' ? '' : ideDataWindowExecutableSql(raw, params)
  if (sql === '') {
    store.setNotice(tr('dataWindowNoSql'))
    return
  }
  const defaults = ideDataWindowDefaultSummary(params)
  // 解析不出来的 include 必须说出来：否则用户以为拿到了完整条件，实际少了过滤块。
  const unresolved = [...new Set(statement?.missing ?? [])]
  const notes = [
    defaults === '' ? '' : `-- defaults: ${defaults}`,
    unresolved.length === 0 ? '' : `-- unresolved include: ${unresolved.join(', ')}`,
  ].filter((line) => line !== '').join('\n')
  const header = notes === '' ? '' : `${notes}\n`
  store.setNotice(tr('dataWindowOpening'))
  const ack = await ideDataWindowRequest({
    action: 'openSql',
    root,
    sql: `${header}${sql}`,
    title: `${typeName}.${name}`,
  })
  ideDataWindowNotice(store, tr, ack, `${typeName}.${name}`)
}

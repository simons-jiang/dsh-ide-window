/**
 * Offline harness for the generated `client.js`.
 *
 * The browser is the real judge, but iterating there is slow: a plugin only
 * loads after the profile reloads it, and a mistake there costs a page reload.
 * This file executes the same bundle in a `vm` context with a stub React and a
 * stub Cordis context, so activation (all five registrations) and the data
 * layer (listing, reading, watching, tab bookkeeping) can be checked with
 * `node test/harness.mjs`.
 *
 * It is a test double, not a renderer: hooks are inert, so the check is that
 * components exist and that the store behaves — not that pixels are right.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = readFileSync(join(here, '..', 'client.js'), 'utf8')

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

/** A React stub: enough shape for module-level code and class boundaries. */
function stubReact() {
  class Component {
    constructor(props) { this.props = props ?? {}; this.state = {} }
    setState(next) { this.state = { ...this.state, ...next } }
  }
  return {
    Fragment: Symbol('Fragment'),
    Component,
    createElement: (type, props, ...children) => ({
      $$el: true,
      type,
      key: props?.key,
      props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
    }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
}

/** The workspace tree the fake Host answers from. */
const TREE = {
  '': [
    { name: 'src', type: 'directory' },
    { name: 'README.md', type: 'file', size: 42 },
    { name: 'Main.java', type: 'file', size: 128 },
  ],
  src: [{ name: 'App.ts', type: 'file', size: 64 }],
}

const FILE_TEXT = 'package demo;\n\n@RestController\npublic class Main {\n  private int count = 7;\n}\n'

/** A `workspaceFiles` face with the wire shapes the Host declares. */
function stubRemote(log) {
  const namespace = {
    async list(sessionId, path) {
      log.push(['list', sessionId, path])
      // The Host's rule: an empty path is refused, an absolute path is fine.
      if (typeof path !== 'string' || path.length === 0) {
        return { ok: false, error: { code: 'gateway/bad-request', details: {}, message: 'path is required' } }
      }
      const key = path.replace(/^.*\/workspace-only\/?/, '')
      const entries = TREE[key === '' || key === undefined ? '' : key]
      if (entries === undefined) {
        return { ok: false, error: { code: 'workspace-file/not-found', details: { path }, message: 'not found' } }
      }
      return { ok: true, value: { path: key, entries, truncated: false } }
    },
    async search(sessionId, request, signal) {
      log.push(['search', sessionId, request])
      const query = String(request?.query ?? '')
      // The Host refuses an empty query instead of listing the workspace.
      if (query === '') {
        return { ok: false, error: { code: 'gateway/bad-request', details: {}, message: 'query is required' } }
      }
      const needle = query.toLowerCase()
      const matches = []
      for (const [dir, entries] of Object.entries(TREE)) {
        for (const entry of entries) {
          const entryPath = dir === '' ? entry.name : `${dir}/${entry.name}`
          if (entry.type === 'file' && entry.name.toLowerCase().includes(needle)) {
            matches.push({ path: entryPath, type: 'file' })
          }
        }
      }
      return { ok: true, value: { matches, truncated: false } }
    },
    async read(sessionId, absolutePath, range) {
      log.push(['read', sessionId, absolutePath, range])
      // The Host's rule: a page limit above its configured maximum is refused.
      if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
        return { ok: false, error: { code: 'gateway/bad-request', details: {}, message: 'path is required' } }
      }
      if (range?.limit !== undefined && range.limit > 400) {
        return { ok: false, error: { code: 'gateway/bad-request', details: {}, message: 'limit must be at most 400' } }
      }
      // The Host's rule: a final newline terminates the last line rather than
      // starting an empty one.
      const lines = FILE_TEXT.replace(/\n$/, '').split('\n')
      const offset = range?.offset ?? 1
      const text = lines.slice(offset - 1).join('\n')
      return {
        ok: true,
        value: {
          absolutePath,
          version: 'v1',
          bytes: FILE_TEXT.length,
          offset,
          text,
          lines: lines.length - offset + 1,
          eof: true,
        },
      }
    },
    async stat(sessionId, absolutePath) {
      return { ok: true, value: { absolutePath, version: 'v1', bytes: FILE_TEXT.length } }
    },
    async *changes(sessionId, absolutePath) {
      log.push(['changes', sessionId, absolutePath])
      yield { kind: 'ready' }
    },
  }
  return {
    workspaceFiles: namespace,
    $stream(options) {
      const iterator = options.open(new AbortController().signal)
      return {
        async *[Symbol.asyncIterator]() {
          for await (const value of iterator) yield { value, accept: () => {} }
        },
        async dispose() {},
      }
    },
  }
}

/** Build the stub Cordis context and record everything the plugin does to it. */
function stubContext(remote, log) {
  const record = {
    shortcuts: [], registrations: [], effects: [], injections: [], injected: [] }
  const layout = {
    panelInfo: { getSnapshot: () => ({ activePanelId: null }) },
    selectPanel: (id) => record.selected = id,
    toggleSidebar: () => { record.sidebarToggles = (record.sidebarToggles ?? 0) + 1 },
    beginNavigation: () => new AbortController().signal,
    openRightbar: () => {},
    closeRightbar: () => {},
  }
  // The tab strip is stateful so an open is visible to the next read, the way
  // the real adopted layout behaves.
  const tabs = []
  let nextTab = 1
  const sidebarRight = {
    mounted: { getSnapshot: () => 'session-1', subscribe: () => () => {} },
    openTab: (kind, options) => {
      log.push(['openTab', kind, options])
      tabs.push({ id: `tab-${nextTab++}`, kind })
    },
    tabsIn: () => tabs.slice(),
    active: () => tabs[0],
    float: (tabId, rect) => {
      const tab = tabs.find((entry) => entry.id === tabId)
      if (tab === undefined || tab.floating === true) return
      tab.floating = true
      log.push(['float', tabId, rect])
    },
    close: (tabId) => {
      const index = tabs.findIndex((entry) => entry.id === tabId)
      if (index < 0) return
      tabs.splice(index, 1)
      log.push(['close', tabId])
    },
    isExpanded: () => true,
    toggleExpanded: () => log.push(['toggleExpanded']),
  }
  const sidebarRightTabs = {
    register: (definition) => {
      record.chatTypes = [...(record.chatTypes ?? []), definition]
      return () => {}
    },
  }
  const locale = {
    register: () => () => {},
    bind: () => (key) => key,
    getSnapshot: () => ({ active: 'zh' }),
  }
  /**
   * The Remote face is a proxy whose namespaces are themselves inject keys:
   * reading `remote.workspaceFiles` from a context that never declared
   * `remote.workspaceFiles` throws in the real client. Modelling that is what
   * makes this harness able to catch the real failure mode.
   */
  const guarded = (deps) => {
    const allowed = new Set(deps)
    return new Proxy(remote, {
      get(target, prop, receiver) {
        if (prop === 'workspaceFiles' && !allowed.has('remote.workspaceFiles')) {
          throw new Error('cannot get property "remote.workspaceFiles" without inject')
        }
        return Reflect.get(target, prop, receiver)
      },
    })
  }
  const ctx = {
    locale,
    remote,
    layout,
    sidebarRight,
    sidebarRightTabs,
    shortcuts: {
      register(command) {
        record.shortcuts.push(command)
        return () => {}
      },
    },
    effect(fn, label) {
      record.effects.push(label)
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject(deps, callback) {
      record.injections.push(deps)
      const scoped = Object.create(ctx)
      scoped.remote = guarded(deps)
      callback(scoped)
    },
    slots: {
      inject(name, callback) {
        record.injected.push(name)
        return callback()
      },
      register(options, component) {
        record.registrations.push({ ...options, component })
        return () => {}
      },
      registerFactory() { return () => {} },
    },
  }
  return { ctx, record }
}


// ---- activation -----------------------------------------------------------
console.log('activation')
const React = stubReact()
const log = []
const remote = stubRemote(log)
const loaded = []
const window = {
  __ModuleLoader__: {
    load(spec) { loaded.push(spec) },
  },
}
const sandbox = {
  window,
  console,
  React: undefined,
  document: { querySelector: () => null, documentElement: { lang: 'zh-CN' } },
  navigator: { language: 'zh-CN' },
  localStorage: (() => {
    // A real map: persistence checks are meaningless against a no-op store.
    const map = new Map()
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => { map.set(key, String(value)) },
      removeItem: (key) => { map.delete(key) },
    }
  })(),
  // The client half talks to its own Host routes over fetch; answer the two it
  // uses so the wiring is exercised rather than silently failing.
  fetch: async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    if (path.includes('dsh-ide/diff')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, value: { untracked: false, hunks: [{ start: 2, end: 3, kind: 'added' }] } }),
      }
    }
    return { ok: false, status: 404, json: async () => ({ ok: false, error: { code: 'not-found' } }) }
  },
  innerWidth: 1440,
  innerHeight: 900,
  URL,
  Event: class { constructor(type) { this.type = type } },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: (event) => { log.push(['event', event?.type ?? '']); return true },
  setTimeout,
  clearTimeout,
  AbortController,
  queueMicrotask,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(bundle, sandbox, { filename: 'client.js' })

check(loaded.length === 1, 'bundle registers exactly one module', `saw ${loaded.length}`)
const spec = loaded[0]
const moduleExports = spec.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})
check(typeof moduleExports.apply === 'function', 'factory returns apply()')
check(Array.isArray(moduleExports.inject), 'factory declares its inject list', String(moduleExports.inject))

const { ctx, record } = stubContext(remote, log)

// Model self-check: the guard must reject an undeclared namespace access.
let guardRejects = false
try {
  ctx.inject(['remote'], (scoped) => { void scoped.remote.workspaceFiles })
} catch (error) {
  guardRejects = /without inject/.test(String(error?.message ?? error))
}
check(guardRejects, 'the harness models the Remote namespace inject rule')

moduleExports.apply(ctx)

const names = record.registrations.map((entry) => entry.name)
check(names.includes('main'), 'registers the centre panel', names.join(','))
check(names.includes('conversation.header.leading'), 'registers the header entry', names.join(','))
check(names.includes('sidebar.footer.action'), 'registers the footer action', names.join(','))
check(names.includes('shell.overlay'), 'registers the session tracker', names.join(','))
check(names.includes('sidebar.right.pane.tab'), 'registers the floating conversation body', names.join(','))

const main = record.registrations.find((entry) => entry.name === 'main')
check(main?.key === 'dsh-ide-window:code', 'main key matches the sidebar entry id', main?.key)
const headerEntry = record.registrations.find((entry) => entry.name === 'conversation.header.leading')
check(typeof headerEntry?.component === 'function', 'header entry is a component')
check(!names.includes('sidebar.panellist'), 'no left-sidebar entry is registered', names.join(','))
check(typeof main?.component === 'function', 'main panel is a component')
const registeredTypes = record.chatTypes ?? []
const fileType = registeredTypes.find((entry) => entry.id === 'dsh-ide-window:file')
check(fileType?.priority === 'extension', 'file type declares the highest band', String(fileType?.priority))
const claimPattern = (fileType?.patterns ?? [])[0]
check(claimPattern === 'dsh-resource://file/session/**', 'file type claims session-scoped file addresses', JSON.stringify(fileType?.patterns))
// Ranking inside a band is by matched pattern length, so the precise claim must
// be the longer string than the generic one another viewer declares.
check(String(claimPattern).length > 'dsh-resource://file/**'.length, 'the claim outranks the generic file pattern by length', String(claimPattern?.length))
check(typeof fileType?.canOpen === 'function', 'file type can veto an address')

// ---- data layer -----------------------------------------------------------
const store = main.inject().store
check(typeof store?.rememberSession === 'function', 'panel inject exposes the store')

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
store.rememberSession('session-1')
store.setRoot('/tmp/workspace-only')
await tick()
const listed = store.getState()
check(listed.sessionId === 'session-1', 'session adopted')
check(listed.rootPath === '/tmp/workspace-only', 'root adopted', listed.rootPath)
check(listed.dirs['']?.entries?.length === 3, 'root directory listed', JSON.stringify(listed.dirs['']))

store.toggleDir('src')
await tick()
check(store.getState().expanded.includes('src'), 'directory expanded')
check(store.getState().dirs.src?.entries?.length === 1, 'child directory listed')
check(log.some((entry) => entry[0] === 'changes'), 'a watch stream opened for the root')

store.openFile('Main.java')
await tick()
const withTab = store.getState()
check(withTab.tabs.length === 1, 'file tab opened')
check(withTab.activePath === 'Main.java', 'opened tab is active')
check(withTab.tabs[0].status === 'ready', 'file read', withTab.tabs[0].error)
check(withTab.tabs[0].lines === 6, 'line count reported', String(withTab.tabs[0].lines))
// The change ranges arrive after the text, so give the fetch a turn.
await new Promise((resolve) => setTimeout(resolve, 20))
const changedTab = store.getState().tabs[0]
check(changedTab?.changes?.hunks?.length === 1, 'the change bar ranges are loaded for the tab', JSON.stringify(changedTab?.changes))
check(changedTab?.changes?.hunks?.[0]?.kind === 'added', 'the hunk kind is preserved', String(changedTab?.changes?.hunks?.[0]?.kind))
check(log.some((entry) => entry[0] === 'read' && String(entry[2]).endsWith('/Main.java')), 'read used the absolute path')

store.closeTab('Main.java')
check(store.getState().tabs.length === 0 && store.getState().activePath === null, 'tab closed')

// ---- refresh re-reads healthy tabs -----------------------------------------
store.openFile('Main.java')
await tick()
const readCount = () => log.filter((entry) => entry[0] === 'read').length
const beforeRefresh = readCount()
store.refreshAll()
await tick()
check(readCount() > beforeRefresh, 'refresh re-reads an open tab', String(readCount() - beforeRefresh))
const refreshedDiff = log.filter((entry) => entry[0] === 'search' || entry[0] === 'read').length
void refreshedDiff

// The same call is what a directory invalidation uses, so both paths re-read.
const beforeTabsRefresh = readCount()
store.refreshTabs()
await tick()
check(readCount() > beforeTabsRefresh, 'refreshing tabs re-reads every open file', String(readCount() - beforeTabsRefresh))

store.closeTab('Main.java')

store.setFilter('readme')
check(store.getState().filter === 'readme', 'filter applied')
store.setFilter('')

// ---- workspace search ------------------------------------------------------
const searchCalls = () => log.filter((entry) => entry[0] === 'search').length
const settle = () => new Promise((resolve) => setTimeout(resolve, 260))
const before0 = searchCalls()
store.setFilter('main')
check(store.getState().search.status === 'loading' || searchCalls() === before0, 'search is debounced before it runs')
await settle()
const searched = store.getState().search
check(searched.status === 'ready', 'search completed', searched.status)
check(searched.matches.length === 1 && searched.matches[0].path === 'Main.java', 'search finds a file that was never expanded', JSON.stringify(searched.matches))
check(searchCalls() === before0 + 1, 'one search per settled query', String(searchCalls() - before0))
check(log.some((entry) => entry[0] === 'search' && entry[2]?.respectGitignore === true), 'search keeps gitignore rules')

// Two keystrokes inside the debounce window collapse into a single query.
const before1 = searchCalls()
store.setFilter('mai')
store.setFilter('main')
await settle()
check(searchCalls() === before1 + 1, 'typing collapses into one debounced search', String(searchCalls() - before1))

store.setFilter('')
check(store.getState().search.status === 'idle' && store.getState().search.matches.length === 0, 'clearing the box resets search')

// ---- view persistence ------------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
store.openFile('Main.java')
await tick()
store.rememberSession('session-2')
await tick()
check(store.getState().tabs.length === 1, 'a Session change keeps the open tabs', JSON.stringify(store.getState().tabs.map((entry) => entry.path)))
check(store.getState().activePath === 'Main.java', 'the active tab survives a Session change', String(store.getState().activePath))

await sleep(520)
const viewRaw = sandbox.localStorage.getItem('dsh-ide-window:view')
let viewMap
try { viewMap = JSON.parse(viewRaw) } catch { viewMap = undefined }
check(viewMap !== undefined && viewMap !== null, 'the view is persisted', String(viewRaw).slice(0, 80))
const savedView = viewMap?.['/tmp/workspace-only']
check(savedView?.tabs?.[0]?.path === 'Main.java', 'the persisted view names the open file', JSON.stringify(savedView?.tabs))

store.closeTab('Main.java')
const restored = store.restoreView()
await tick()
check(restored === true, 'restoring a saved view reports success')
check(store.getState().tabs.length === 1 && store.getState().tabs[0].path === 'Main.java', 'restoring reopens the saved file')
check(store.getState().tabs[0].status === 'ready', 'a restored file is loaded, not left loading', store.getState().tabs[0].error)
store.closeTab('Main.java')

const before = log.length
store.refreshAll()
await tick()
check(log.length > before, 'refresh re-read directories')

// ---- project switching -----------------------------------------------------
check(store.getState().preferredRoot === '', 'no project is preferred by default', String(store.getState().preferredRoot))
store.setPreferredRoot('/tmp/other-project/')
check(store.getState().preferredRoot === '/tmp/other-project', 'a preferred project drops the trailing slash', String(store.getState().preferredRoot))
check(store.getState().rootPath === '/tmp/other-project', 'switching projects re-roots the panel', String(store.getState().rootPath))
await tick()
const prefsRaw = sandbox.localStorage.getItem('dsh-ide-window:v1')
let prefsDoc
try { prefsDoc = JSON.parse(prefsRaw) } catch { prefsDoc = undefined }
check(prefsDoc?.preferredRoot === '/tmp/other-project', 'the preferred project is persisted', String(prefsRaw).slice(0, 80))
store.setPreferredRoot('')
check(store.getState().preferredRoot === '', 'clearing the choice follows the Session again', String(store.getState().preferredRoot))

// ---- navigation history ----------------------------------------------------
sandbox.localStorage.removeItem('dsh-ide-window:view')
const navStore = main.inject().store
navStore.rememberSession('session-1')
navStore.setRoot('/tmp/workspace-only')
await tick()
check((navStore.getState().historyBack ?? []).length === 0, 'history starts empty')
navStore.openAt('Main.java', 5)
await tick()
navStore.openAt('src/App.ts', 3)
await tick()
check(navStore.getState().activePath === 'src/App.ts', 'a second jump becomes the active tab', String(navStore.getState().activePath))
check((navStore.getState().historyBack ?? []).length === 1, 'the first position is remembered', String((navStore.getState().historyBack ?? []).length))

check(navStore.goBack() === true, 'back reports success')
await tick()
const afterBack = navStore.getState()
check(afterBack.activePath === 'Main.java', 'back returns to the previous file', String(afterBack.activePath))
check(afterBack.tabs.find((entry) => entry.path === 'Main.java')?.reveal === 5, 'back restores the previous line', String(afterBack.tabs.find((entry) => entry.path === 'Main.java')?.reveal))
check((afterBack.historyForward ?? []).length === 1, 'back fills the forward stack')

check(navStore.goForward() === true, 'forward reports success')
await tick()
const afterForward = navStore.getState()
check(afterForward.activePath === 'src/App.ts', 'forward returns to the next file', String(afterForward.activePath))
check((afterForward.historyBack ?? []).length === 1, 'forward fills the back stack again')

// A new navigation drops the forward stack, the way an editor does.
navStore.goBack()
await tick()
navStore.openAt('Main.java', 1)
await tick()
check((navStore.getState().historyForward ?? []).length === 0, 'a fresh jump clears the forward stack')


/** Extract one top-level function's source from a client fragment, for unit checks. */
function grabSource(name, file = '58-turn.js') {
  const source = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
  const constant = source.indexOf(`const ${name} = `)
  if (constant >= 0 && source.indexOf(`function ${name}(`) < 0) {
    // A regex literal has no brackets to balance: take the whole line.
    const afterEquals = source.slice(source.indexOf('=', constant) + 1).trimStart()
    if (afterEquals.startsWith('/')) return source.slice(constant, source.indexOf('\n', constant))
    // Multi-line literals: stop where the brackets opened by the initializer close.
    let depth = 0
    let started = false
    for (let index = source.indexOf('=', constant); index < source.length; index += 1) {
      const char = source[index]
      if (char === '[' || char === '{' || char === '(') {
        depth += 1
        started = true
      } else if (char === ']' || char === '}' || char === ')') {
        depth -= 1
        if (started && depth === 0) return source.slice(constant, index + 1)
      } else if (char === '\n' && !started) {
        return source.slice(constant, index)
      }
    }
    return source.slice(constant)
  }
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`missing ${name}`)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unbalanced ${name}`)
}

// ---- the changes card never asks for a summary the Host cannot serve --------
{
  const source = readFileSync(new URL('../src/client/58-turn.js', import.meta.url), 'utf8')
  // 曾经用 slot 的 seq 兜底；那会让每个历史轮次都发一次必然 404 的请求。
  check(/Number\.isFinite\(recorded\?\.changes\?\.seq\) \? recorded\.changes\.seq : undefined/.test(source),
    'the sequence comes only from the recorded deliverables node')
  check(!/recorded\.changes\.seq\s*\n?\s*:\s*\(Number\.isFinite\(seq\)/.test(source),
    'the slot sequence is no longer used as a fallback')
  check(/if \(!Number\.isFinite\(changesSeq\)\) \{/.test(source),
    'a Turn without a recorded summary skips the request entirely')
  // 只防并发重复，不再缓存 404：把临时故障固化下来不值得
  check(/ideSummaryRequests\.has\(summaryKey\)/.test(source), 'a Turn with a request in flight is not asked twice')
  check(!/localStorage/.test(source), 'no 404 result is cached', 'still has localStorage')

}

// ---- jar sources -----------------------------------------------------------
const jarStore = main.inject().store
jarStore.rememberSession('session-1')
jarStore.setRoot('/tmp/workspace-only')
await tick()
check(jarStore.openJarSource({ className: 'com.x.ExchangeRateInnerResp', jar: '/m2/a/thing-sources.jar', text: 'line1\nline2\nprivate Long businessDate;', line: 3 }) === true, 'a jar source opens a tab')
const jarTab = jarStore.getState().tabs.find((entry) => entry.kind === 'jar')
check(jarTab !== undefined, 'the tab is marked as jar-backed', JSON.stringify(jarStore.getState().tabs.map((entry) => entry.path)))
check(jarTab?.status === 'ready' && jarTab.lines === 3, 'a jar tab is already loaded, never re-read', `${jarTab?.status}/${jarTab?.lines}`)
check(jarTab?.dir === 'thing-sources.jar', 'the tab keeps the jar it came from', String(jarTab?.dir))
check(jarTab?.reveal === 3, 'the field line travels with the tab', String(jarTab?.reveal))
for (const entry of jarStore.getState().tabs.slice()) {
  if (entry.kind !== 'jar') jarStore.closeTab(entry.path)
}
const readCountBefore = log.filter((entry) => entry[0] === 'read').length
jarStore.refreshTabs()
await tick()
check(log.filter((entry) => entry[0] === 'read').length === readCountBefore, 'refreshing never re-reads a jar tab')
jarStore.closeTab(jarTab.path)

// ---- scroll memory ---------------------------------------------------------
store.rememberScroll('Main.java', 120)
check(store.getState().scroll['Main.java'] === 120, 'a scroll offset is remembered', String(store.getState().scroll['Main.java']))
store.rememberScroll('Main.java', -5)
check(store.getState().scroll['Main.java'] === 120, 'an invalid offset is ignored', String(store.getState().scroll['Main.java']))
store.openAt('Main.java', 5)
await tick()
check(store.getState().tabs[0]?.reveal === 5, 'a jump records its line', String(store.getState().tabs[0]?.reveal))
check(store.getState().tabs[0]?.revealApplied === undefined, 'the jump line starts unapplied')
store.setRevealApplied('Main.java', 5)
check(store.getState().tabs[0]?.revealApplied === 5, 'an applied jump line is remembered', String(store.getState().tabs[0]?.revealApplied))

// ---- reference interception ----------------------------------------------
// The claim is live from startup: references must reach this panel on a fresh
// page, not only after the panel was opened once.
const claimAddress = 'dsh-resource://file/session/session-1/src/App.ts'
check(fileType.canOpen(claimAddress) === true, 'the file claim is live at startup')
check(fileType.canOpen('dsh-resource://file/session/session-1/assets/logo.png') === false, 'non-text addresses are vetoed')

// ---- jump to a file and a line -------------------------------------------
// The panel is opened by a reference elsewhere in the UI, which speaks absolute
// paths and carries a 1-based line.
// A fresh scenario starts with no history: the panel now reopens the tabs a
// workspace had last time, which would otherwise mix into this store.
sandbox.localStorage.removeItem('dsh-ide-window:view')
const jumpLog = []
const jumping = stubContext(stubRemote(jumpLog), jumpLog)
moduleExports.apply(jumping.ctx)
const jumpStore = jumping.record.registrations.find((entry) => entry.name === 'main').inject().store
jumpStore.rememberSession('session-1')
jumpStore.setRoot('/tmp/workspace-only')
await tick()
check(jumpStore.openAt('/tmp/workspace-only/src/App.ts', 3) === true, 'an absolute reference inside the workspace opens')
await tick()
const jumped = jumpStore.getState()
check(jumped.activePath === 'src/App.ts', 'the reference opened the workspace-relative path', String(jumped.activePath))
check(jumped.expanded.includes('src'), 'the directories above the file are expanded')
check(jumped.tabs[0]?.reveal === 3, 'the tab carries the line to reveal', String(jumped.tabs[0]?.reveal))
check(jumped.tabs[0]?.status === 'ready', 'the file content is loaded')

// Relative paths are accepted too, and a repeat click moves the highlight.
check(jumpStore.openAt('Main.java', 2) === true, 'a workspace-relative reference opens')
await tick()
check(jumpStore.getState().activePath === 'Main.java', 'the relative reference switched tabs')
check(jumpStore.openAt('Main.java', 5) === true, 're-opening the same file is allowed')
const again = jumpStore.getState().tabs.find((entry) => entry.path === 'Main.java')
check(again?.reveal === 5, 'a second reference moves the highlight', String(again?.reveal))

// A path outside the workspace must be refused rather than guessed at.
check(jumpStore.openAt('/etc/passwd', 1) === false, 'a path outside the workspace is refused')
check(jumpStore.getState().activePath === 'Main.java', 'a refused path leaves the selection alone')
jumpStore.dispose()

// ---- live updates ---------------------------------------------------------
// A change frame for an open file must re-read it; one for a directory must
// relist that directory. The stub fires both from the first watch stream.
const changeLog = []
const liveRemote = stubRemote(changeLog)
liveRemote.workspaceFiles.changes = async function* (sessionId, absolutePath) {
  changeLog.push(['changes', sessionId, absolutePath])
  yield { kind: 'ready' }
  // Real frames arrive after the user opened something, not during activation.
  await new Promise((resolve) => setTimeout(resolve, 25))
  yield { kind: 'change', change: { absolutePath: '/tmp/workspace-only/Main.java', version: 'v2' } }
  yield { kind: 'change', change: { absolutePath: '/tmp/workspace-only/src', version: 'v2' } }
}
const live = stubContext(liveRemote, changeLog)
moduleExports.apply(live.ctx)
const liveStore = live.record.registrations.find((entry) => entry.name === 'main').inject().store
liveStore.rememberSession('session-1')
liveStore.setRoot('/tmp/workspace-only')
await tick()
liveStore.toggleDir('src')
await tick()
liveStore.openFile('Main.java')
await tick()
const readsBefore = changeLog.filter((entry) => entry[0] === 'read').length
await new Promise((resolve) => setTimeout(resolve, 80))
const readsAfter = changeLog.filter((entry) => entry[0] === 'read').length
check(readsAfter > readsBefore, 'a change frame re-reads the open file', `${readsBefore} -> ${readsAfter}`)
check(liveStore.getState().tabs[0]?.status === 'ready', 'tab stays readable after a live update')
check(liveStore.getState().dirs.src !== undefined, 'a directory change keeps the expanded child listed')
liveStore.dispose()

// ---- immersive mode -------------------------------------------------------
const modeLog = []
const modeRemote = stubRemote(modeLog)
const mode = stubContext(modeRemote, modeLog)
moduleExports.apply(mode.ctx)
const footerInject = mode.record.registrations.find((entry) => entry.name === 'sidebar.footer.action').inject()
const mainInject = mode.record.registrations.find((entry) => entry.name === 'main').inject()
const modeStore = mainInject.store
modeStore.rememberSession('session-1')
modeStore.setRoot('/tmp/workspace-only')
await tick()

// Opening the code panel selects the panel and nothing else. A right-column
// conversation was tried twice and both times the shell re-homed the Session
// surface, unmounting the panel and leaving the cover-overlay bug behind.
footerInject.openPanel()
check(mode.record.selected === 'dsh-ide-window:code', 'open selects the code panel in the main column', String(mode.record.selected))

// ---- the single shortcut registry ------------------------------------------
{
  const registry = new Function(`${grabSource('IDE_SHORTCUTS', '05-shortcut-registry.js')}\nreturn IDE_SHORTCUTS`)()
  check(Array.isArray(registry) && registry.length === 6, 'the registry holds every code-workspace shortcut', String(registry?.length))
  const kinds = registry.map((entry) => entry.kind)
  check(kinds.filter((kind) => kind === 'key').length === 3, 'three keyboard commands (toggle, back, ⌘P)', kinds.join(','))
  check(kinds.filter((kind) => kind === 'gesture').length === 2, 'two are pointer gestures', kinds.join(','))
  check(kinds.filter((kind) => kind === 'sequence').length === 1, 'one is a double-press sequence (double Shift)', kinds.join(','))
  check(kinds.every((kind) => kind !== 'fixed'), 'every shortcut is editable', kinds.join(','))

  const ids = registry.map((entry) => entry.id)
  check(new Set(ids).size === ids.length, 'registry ids are unique', ids.join(','))

  // 全部命令都由插件自己持有：DSH 的「编辑快捷键」列表里一条都不出现
  check(mode.record.shortcuts.length === 0, 'nothing is registered in DSH\'s catalog', JSON.stringify(mode.record.shortcuts.map((entry) => entry.id)))

  // 双击 Shift：键与窗口来自注册表，用户可改
  const sequence = registry.find((entry) => entry.action === 'palette')
  check(sequence?.defaults?.desktop?.key === 'Shift' && sequence?.windowMs === 400,
    'double Shift is declared in the registry', JSON.stringify(sequence?.defaults?.desktop))
  check(sequence?.kind === 'sequence', 'double Shift is recordable', String(sequence?.kind))

  const fileSearch = registry.find((entry) => entry.action === 'focus-filter')
  check(fileSearch?.kind === 'key' && fileSearch?.defaults?.desktop?.code === 'KeyP',
    '⌘P is an editable binding', JSON.stringify(fileSearch?.defaults?.desktop))

  const hit = new Function(`${grabSource('ideSequenceHit', '05-shortcut-registry.js')}\nreturn ideSequenceHit`)()
  check(hit({ key: '', at: 0 }, { key: 'Shift' }, { key: 'Shift' }, 400).hit === false, 'one press does not fire the sequence')
  const firstPress = hit({ key: '', at: 0 }, { key: 'Shift' }, { key: 'Shift' }, 400)
  check(hit(firstPress.next, { key: 'Shift' }, { key: 'Shift' }, 400).hit === true, 'the second press fires it')
  check(hit(firstPress.next, { key: 'Control' }, { key: 'Shift' }, 400).hit === false, 'a different key does not fire it')
  check(hit(firstPress.next, { key: 'Shift', repeat: true }, { key: 'Shift' }, 400).hit === false, 'auto-repeat does not fire it')
  check(hit(firstPress.next, { key: 'Shift' }, { key: 'Control' }, 400).hit === false, 'a rebound key no longer fires the old one')

  const sequenceLabel = new Function(`${grabSource('ideSequenceLabel', '05-shortcut-registry.js')}\nreturn ideSequenceLabel`)()
  check(sequenceLabel({ key: 'Shift' }) === '双击 Shift', 'a sequence is labelled 双击 <key>', sequenceLabel({ key: 'Shift' }))
  check(sequenceLabel({ key: 'Control' }) === '双击 Control', 'a rebound sequence is labelled too', sequenceLabel({ key: 'Control' }))
}

// ---- mouse gestures -------------------------------------------------------
{
  const choices = grabSource('IDE_GESTURE_CHOICES', '05-shortcut-registry.js')
  const ring = grabSource('ideNextGesture', '59-gesture-settings.js')
  const next = new Function(`${choices}\n${ring}\nreturn ideNextGesture`)()
  check(next('double', 'meta') === 'alt', 'the gesture ring skips the one already taken', next('double', 'meta'))
  check(next('alt', 'double') === 'meta', 'the ring wraps around', next('alt', 'double'))

  const names = mode.record.registrations.map((entry) => entry.name)
  check(names.includes('settings.general.item'), 'registers the gesture settings row', names.join(','))
  const row = mode.record.registrations
    .filter((entry) => entry.name === 'settings.general.item')
    .find((entry) => String(entry.id ?? '').includes(':gestures'))
  check(row !== undefined, 'the gesture row is namespaced')

  const injected = row?.inject?.() ?? {}
  const registry = new Function(`${grabSource('IDE_SHORTCUTS', '05-shortcut-registry.js')}\nreturn IDE_SHORTCUTS`)()
  check(injected.store?.getState().gestures.definition === 'double', 'double click goes to definition by default', JSON.stringify(injected.store?.getState().gestures))

  // 键盘绑定由插件自己存：默认值来自注册表，改键写入偏好
  const defaults = new Function(`${grabSource('ideShortcutDefault', '05-shortcut-registry.js')}\nreturn ideShortcutDefault`)()
  const toggle = registry.find((entry) => entry.action === 'toggle')
  check(defaults(toggle, 'desktop').code === 'Digit2', 'desktop default opens the workspace on 2', JSON.stringify(defaults(toggle, 'desktop')))
  check(defaults(toggle, 'web').code === 'KeyI', 'web default avoids the browser digit rows', JSON.stringify(defaults(toggle, 'web')))
  injected.store?.setShortcutBinding(toggle.id, { code: 'KeyJ', modifiers: ['primary'] })
  check(injected.store?.getState().shortcutBindings?.[toggle.id]?.code === 'KeyJ', 'a rebound key is stored', JSON.stringify(injected.store?.getState().shortcutBindings))
  injected.store?.setShortcutBinding(toggle.id, null)
  check(injected.store?.getState().shortcutBindings?.[toggle.id] === undefined, 'resetting drops the override')

  const matcher = new Function(`${grabSource('ideBindingMatches', '05-shortcut-registry.js')}\nreturn ideBindingMatches`)()
  const digitTwo = { code: 'Digit2', modifiers: ['primary'] }
  check(matcher(digitTwo, { code: 'Digit2', metaKey: true }, 'macos') === true, 'an exact combination matches')
  check(matcher(digitTwo, { code: 'Digit2', metaKey: true, shiftKey: true }, 'macos') === false, 'an extra modifier does not match')
  check(injected.store?.getState().gestures.usages === 'meta', 'meta click lists usages by default')
  check(injected.store?.setGesture('definition', 'meta') === false, 'a gesture already in use is refused')
  check(injected.store?.setGesture('definition', 'alt') === true, 'a free gesture is accepted')
  check(injected.store?.getState().gestures.definition === 'alt', 'the accepted gesture is stored', injected.store?.getState().gestures.definition)
  check(injected.store?.setGesture('definition', 'double') === true, 'it can be put back')

  const gestureOf = new Function(`${grabSource('ideGestureOf', '30-code.js')}\nreturn ideGestureOf`)()
  check(gestureOf({ metaKey: true }) === 'meta', '⌘ maps to the meta gesture')
  check(gestureOf({ ctrlKey: true }) === 'meta', 'Ctrl maps to the same gesture')
  check(gestureOf({ altKey: true }) === 'alt', '⌥ maps to the alt gesture')
  check(gestureOf({}) === 'plain', 'a bare click is plain')
}

// ---- turn changes ----------------------------------------------------------
{
  const names = mode.record.registrations.map((entry) => entry.name)
  check(names.includes('conversation.chat.turnTail'), 'registers the turn changes entry', names.join(','))

  // 首个改动行：hunk 的 newStart 加上跳过上下文行后的偏移
  const drop = new Function(`${grabSource('ideFirstChangedLine')}\nreturn ideFirstChangedLine`)()
  const diff = { kind: 'text', hunks: [
    { oldStart: 1, oldLines: 2, newStart: 10, newLines: 3, lines: [' keep', '+added', ' keep'] },
  ] }
  check(drop(diff) === 11, 'the first added line is located', String(drop(diff)))
  const deletionOnly = { kind: 'text', hunks: [
    { oldStart: 4, oldLines: 1, newStart: 4, newLines: 0, lines: ['-gone'] },
  ] }
  check(drop(deletionOnly) === 4, 'a deletion-only hunk falls back to its start', String(drop(deletionOnly)))
  check(drop({ kind: 'binary' }) === 0, 'a binary comparison has no line', String(drop({ kind: 'binary' })))

  // 事件日志兜底：摘要丢失时从工具调用还原改动文件
  const edited = new Function(`${grabSource('IDE_WRITE_TOOLS')}\n${grabSource('ideTurnEditedPaths')}\nreturn ideTurnEditedPaths`)()
  const trajectory = {
    eventLocations: new Map([
      [10, { kind: 'turn', turn: { turn: 2 } }],
      [11, { kind: 'step', turn: { turn: 2 }, step: {} }],
      [12, { kind: 'turn', turn: { turn: 1 } }],
    ]),
    eventNodes: [
      { matches: [{ event: { seq: 11, type: 'tool/call', data: { name: 'edit', arguments: '{"file_path":"src/A.java","old_string":"x"}' } } }] },
      { matches: [{ event: { seq: 10, type: 'tool/call', data: { name: 'write', arguments: { path: 'src/B.java' } } } }] },
      { matches: [{ event: { seq: 10, type: 'tool/call', data: { name: 'read', arguments: '{"file_path":"src/Ignored.java"}' } } }] },
      { matches: [{ event: { seq: 12, type: 'tool/call', data: { name: 'edit', arguments: '{"file_path":"src/Other.java"}' } } }] },
      { matches: [{ event: { seq: 11, type: 'tool/call', data: { name: 'edit', arguments: '{"file_path":"src/A.java"}' } } }] },
    ],
  }
  // 真实会话日志里字段名是 arguments（不是 input）
  const recovered = edited(trajectory, 2)
  check(recovered.length === 2, 'read tools and other turns are ignored', JSON.stringify(recovered))
  check(recovered[0] === 'src/A.java' && recovered[1] === 'src/B.java', 'paths keep first-touch order', JSON.stringify(recovered))
  check(edited(trajectory, 9).length === 0, 'an unknown turn recovers nothing', JSON.stringify(edited(trajectory, 9)))
}


// ---- shortcuts are the plugin's own -----------------------------------------
{
  // 一条也不注册进 DSH 的目录：DSH 的「编辑快捷键」弹窗里不应出现本插件
  check(mode.record.shortcuts.length === 0, 'no shortcut reaches DSH\'s catalog', String(mode.record.shortcuts.length))

  const names = mode.record.registrations.map((entry) => entry.name)
  check(names.includes('settings.general.item'), 'the shortcuts live in a General-settings row', names.join(','))
  const row = mode.record.registrations
    .filter((entry) => entry.name === 'settings.general.item')
    .find((entry) => String(entry.id ?? '').includes('dsh-ide-window'))
  check(row !== undefined, 'the row is namespaced', String(row?.id))
  const injected = row?.inject?.() ?? {}
  check(typeof injected.onRecord === 'function' && typeof injected.onReset === 'function',
    'the row can record and reset a binding')
  check(injected.platform === 'macos' || injected.platform === 'windows' || injected.platform === 'linux',
    'the row knows the platform', String(injected.platform))
}

check(!modeLog.some((entry) => entry[0] === 'openTab'), 'open never opens a right-column tab', JSON.stringify(modeLog.filter((entry) => entry[0] === 'openTab')))
check(!modeLog.some((entry) => entry[0] === 'toggleExpanded'), 'open never expands the right column')

// A reference opened elsewhere now routes here: the claiming body forwards the
// address and its line, closes its own tab and selects the panel.
// The claim is per registration, so the one that matters here is this
// context's own definition.
const modeFileType = mode.record.chatTypes.find((entry) => entry.id === 'dsh-ide-window:file')
check(modeFileType.canOpen(claimAddress) === true, 'the file claim turns on once the workspace is used')
check(modeFileType.canOpen('dsh-resource://file/session/session-1/assets/logo.png') === false, 'images still keep their own viewer')
check(modeFileType.canOpen('dsh-resource://file/session/session-1/README.md') === false, 'markdown keeps its rendered preview')
check(modeFileType.canOpen('dsh-resource://file/session/session-1/report.html') === false, 'html keeps its rendered preview')
check(modeFileType.canOpen('dsh-resource://file/session/session-1/data.csv') === false, 'csv keeps its own viewer')
check(modeFileType.canOpen('dsh-resource://file/session/session-1/src/App.ts') === true, 'source files are claimed')
// The toolbar toggle must actually gate the claim, since the band outranks
// other viewers.
modeStore.setJumpEnabled(false)
check(modeFileType.canOpen(claimAddress) === false, 'the toolbar toggle gates the claim')
modeStore.setJumpEnabled(true)
check(modeFileType.canOpen(claimAddress) === true, 'the claim returns when the toggle is on again')
const fileBody = mode.record.registrations.find((entry) => entry.key === 'dsh-ide-window:file')
// The claiming tab exists in the real flow: the type was opened, then its body
// forwards and closes it. Model that by opening one first.
mode.ctx.sidebarRight.openTab('dsh-ide-window-file')
const claimTabId = mode.ctx.sidebarRight.tabsIn().at(-1)?.id
fileBody.inject().jump(claimTabId, claimAddress, { line: 2 })
await tick()
const jumpedByReference = modeStore.getState()
check(jumpedByReference.activePath === 'src/App.ts', 'a reference opened the panel on that file', String(jumpedByReference.activePath))
check(jumpedByReference.tabs.find((entry) => entry.path === 'src/App.ts')?.reveal === 2, 'the reference line travelled with it')
check(mode.record.selected === 'dsh-ide-window:code', 'a reference selects the code panel', String(mode.record.selected))
check(modeLog.some((entry) => entry[0] === 'close' && entry[1] === claimTabId), 'the claiming tab is closed again', String(claimTabId))
fileBody.inject().jump('tab-78', 'dsh-resource://file/absolute/etc/hosts', undefined)
check(modeStore.getState().activePath === 'src/App.ts', 'a path outside the workspace does not steal the editor')

// The mount effect folds the navigation column and never re-selects.
const selectionsBeforeMount = mode.record.selected
const leave = mainInject.onEnter()
check(mode.record.sidebarToggles === 1, 'entering hides the navigation column', String(mode.record.sidebarToggles))
check(mode.record.selected === selectionsBeforeMount, 'entering never re-selects a panel', String(mode.record.selected))
check(typeof mainInject.onEnter() === 'function', 'a repeated mount effect is a no-op cleanup')
mainInject.onEnter()()

leave()
check(mode.record.sidebarToggles === 2, 'leaving restores the navigation column', String(mode.record.sidebarToggles))



// ---- narrow layout --------------------------------------------------------
// Below the shell's collapse breakpoint `toggleSidebar` flips the drawer, so
// folding the column there would later raise a drawer overlay over the
// conversation. The panel must leave the column alone.
sandbox.innerWidth = 900
const narrow = stubContext(stubRemote([]), [])
moduleExports.apply(narrow.ctx)
const narrowInject = narrow.record.registrations.find((entry) => entry.name === 'main').inject()
narrowInject.store.rememberSession('session-1')
narrowInject.store.setRoot('/tmp/workspace-only')
await tick()
const narrowLeave = narrowInject.onEnter()
check(narrow.record.sidebarToggles === undefined, 'a narrow layout never folds the navigation column', String(narrow.record.sidebarToggles))
narrowLeave()
check(narrow.record.sidebarToggles === undefined, 'a narrow layout never restores it either', String(narrow.record.sidebarToggles))
narrowInject.store.dispose()
sandbox.innerWidth = 1440

store.dispose()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

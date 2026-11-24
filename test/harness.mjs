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
import { macPlatform, windowsPlatform } from '../platform/index.js'

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
check(store.getState().annotate?.['Main.java'] !== true, 'Git annotate starts off')
store.toggleAnnotate('Main.java')
check(store.getState().annotate?.['Main.java'] === true, 'Git annotate turns on')
store.toggleAnnotate('Main.java')
check(store.getState().annotate?.['Main.java'] !== true, 'Git annotate turns off again')

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
// The Session owns the project: `setRoot` is what a switched workspace does.
store.setRoot('/tmp/other-project')
check(store.getState().rootPath === '/tmp/other-project', 'switching projects re-roots the panel', String(store.getState().rootPath))
await tick()

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

// The reader's *offset* travels with the history entry: without it, going back
// after scrolling a file dropped the user at line 1 instead of where they were.
navStore.openAt('src/App.ts', 1)
await tick()
navStore.rememberScroll('src/App.ts', 2400)
navStore.openAt('Main.java', 10)
await tick()
check(navStore.getState().historyBack.at(-1)?.top === 2400, 'the scroll offset is remembered with the position', String(navStore.getState().historyBack.at(-1)?.top))
navStore.goBack()
await tick()
const afterScrollBack = navStore.getState()
check(afterScrollBack.activePath === 'src/App.ts', 'back returns to the scrolled file', String(afterScrollBack.activePath))
check(afterScrollBack.scroll['src/App.ts'] === 2400, 'back restores the scroll offset', String(afterScrollBack.scroll['src/App.ts']))
check((afterScrollBack.tabs.find((entry) => entry.path === 'src/App.ts')?.reveal ?? 0) === 0, 'restoring the offset drops the stale reveal line', String(afterScrollBack.tabs.find((entry) => entry.path === 'src/App.ts')?.reveal))


// An untracked file has no blame rows at all; the column must still say so
// instead of rendering empty cells.
const annotateRowsFor = new Function(
  `${grabSource('ideAnnotateRows', '30-code.js')}\nreturn ideAnnotateRows`,
)()
const untrackedRows = annotateRowsFor(new Map(), 3, '未提交', true)
check(untrackedRows.get(1)?.label === '未提交', 'an untracked file annotates every line as uncommitted', String(untrackedRows.get(1)?.label))
const trackedRows = annotateRowsFor(new Map([[1, { author: 'simon', date: '2026/11/16', time: 1, uncommitted: false }]]), 2, '未提交', false)
check(trackedRows.get(1)?.label === '2026/11/16 simon', 'attributed lines keep date and author', String(trackedRows.get(1)?.label))
check((trackedRows.get(2)?.label ?? 'x') === '', 'lines git skipped stay blank when the file is tracked', String(trackedRows.get(2)?.label))

/** Extract one top-level function's source from a client fragment, for unit checks. */
function grabSource(name, file = '10-core.js') {
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
        // Only a body/array/object close ends the literal: returning on the
        // parameter list's `)` would cut an arrow function in half.
        if (started && depth === 0 && (char === '}' || char === ']')) return source.slice(constant, index + 1)
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

// ---- git status parsing ----------------------------------------------------
{
  const hostSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const parseBody = (() => {
    const start = hostSource.indexOf('function parseStatus(')
    let depth = 0
    for (let index = hostSource.indexOf('{', start); index < hostSource.length; index += 1) {
      if (hostSource[index] === '{') depth += 1
      else if (hostSource[index] === '}') {
        depth -= 1
        if (depth === 0) return hostSource.slice(start, index + 1)
      }
    }
    throw new Error('parseStatus not found')
  })()
  const parse = new Function(`${parseBody}\nreturn parseStatus`)()
  // The route reads the NUL-separated form, so the fixture is that wire shape:
  // a rename carries its original path as the field after the new one.
  const entries = parse(' M a/B.java\0A  c/D.java\0R  new/E.java\0old/E.java\0?? notes.md\0')
  check(entries.length === 4, 'every file becomes an entry', String(entries.length))
  check(entries[0].status === 'M' && entries[0].path === 'a/B.java', 'a modification keeps its code', JSON.stringify(entries[0]))
  check(entries[1].status === 'A', 'an addition keeps its code', JSON.stringify(entries[1]))
  check(entries[2].path === 'new/E.java', 'a rename reports the new path', JSON.stringify(entries[2]))
  check(entries[3].status === '??', 'an untracked file is reported as such', JSON.stringify(entries[3]))
  check(parse('').length === 0, 'empty output yields nothing')

}

/**
 * One function out of the Host half or a client fragment, for a direct call here.
 *
 * `grabSource` stops at the first `}`, which is the end of a destructured
 * parameter list rather than of the body; this variant walks the parameter list
 * first so `idePaletteEntries({ category, … })` survives.
 */
function sourceFunction(name, file = undefined) {
  const source = file === undefined
    ? readFileSync(new URL('../index.js', import.meta.url), 'utf8')
    : readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`missing ${name}`)
  let parens = 0
  let index = source.indexOf('(', start)
  for (; index < source.length; index += 1) {
    if (source[index] === '(') parens += 1
    else if (source[index] === ')') {
      parens -= 1
      if (parens === 0) break
    }
  }
  // Braces inside strings and comments are not structure: a function that
  // compares against `'{'` would otherwise look unbalanced.
  const skipQuoted = (from) => {
    const quote = source[from]
    for (let scan = from + 1; scan < source.length; scan += 1) {
      if (source[scan] === '\\') {
        scan += 1
        continue
      }
      if (source[scan] === quote) return scan + 1
    }
    return source.length
  }
  let depth = 0
  for (index = source.indexOf('{', index); index < source.length; index += 1) {
    const char = source[index]
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(index) - 1
      continue
    }
    if (char === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index)
      if (index < 0) break
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      index = source.indexOf('*/', index + 2) + 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unbalanced ${name}`)
}

// The client's path helpers read `idePlatform` from their module; extracted
// functions evaluate in the global scope, so give them the macOS instance once.
{
  const platformOf = new Function(`${sourceFunction('idePlatformOf', '06-platform.js')}\nreturn idePlatformOf`)()
  globalThis.idePlatform = platformOf('macos')
}

// ---- which host the guide page writes commands for -------------------------
{
  const hostIsMac = new Function(`${sourceFunction('ideHostIsMacos', '06-platform.js')}\nreturn ideHostIsMacos`)()
  const previousRuntime = globalThis.ideRuntimeContext
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const cases = [
    [{ platform: 'macos' }, 'MacIntel', true, 'a desktop macOS profile is macOS'],
    [{ platform: 'windows' }, 'MacIntel', false, 'a desktop Windows profile stays Windows'],
    [{ platform: 'web' }, 'MacIntel', true, 'a web profile on macOS reads the browser'],
    [{ platform: 'web' }, 'Win32', false, 'a web profile on Windows reads the browser'],
    [{ platform: 'web' }, 'Linux x86_64', false, 'an unknown web host is not mistaken for macOS'],
  ]
  for (const [runtime, navPlatform, expected, label] of cases) {
    globalThis.ideRuntimeContext = runtime
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: navPlatform, userAgent: navPlatform },
      configurable: true,
      writable: true,
    })
    check(hostIsMac() === expected, label, String(hostIsMac()))
  }
  if (previousRuntime === undefined) delete globalThis.ideRuntimeContext
  else globalThis.ideRuntimeContext = previousRuntime
  if (previousNavigator === undefined) delete globalThis.navigator
  else Object.defineProperty(globalThis, 'navigator', previousNavigator)
}

// ---- content-search extension scoping --------------------------------------
{
  const globs = new Function(`const MAX_GREP_EXTENSIONS = 40\n${sourceFunction('grepExtensionGlobs')}\nreturn grepExtensionGlobs`)()
  check(globs(['java']).join(' ') === '--glob *.java', 'one extension becomes one include glob', globs(['java']).join(' '))
  check(globs(['.TS']).join(' ') === '--glob *.ts', 'a leading dot is dropped and case normalised', globs(['.TS']).join(' '))
  check(globs(['java', 'kt']).length === 4, 'two extensions are two globs', String(globs(['java', 'kt']).length))
  check(globs(['../etc', 'java; rm', 'a b']).length === 0, 'anything that is not a bare extension is refused', JSON.stringify(globs(['../etc', 'java; rm', 'a b'])))
  check(globs(undefined).length === 0, 'an absent list scopes nothing', String(globs(undefined).length))
  check(globs(['java']).every((part) => !part.includes('!')), 'the scoping can only narrow, never negate', JSON.stringify(globs(['java'])))
}

// ---- the palette's 「类」 and 「符号」 sources ----------------------------------
{
  const source = [
    grabSource('IDE_CODE_EXTENSIONS', '70-palette.js'),
    'const IDE_CODE_EXTENSION_SET = new Set(IDE_CODE_EXTENSIONS)',
    sourceFunction('ideIsCodePath', '70-palette.js'),
    sourceFunction('ideFqnOf', '70-palette.js'),
    sourceFunction('ideClassName', '70-palette.js'),
    sourceFunction('ideSymbolPattern', '70-palette.js'),
    sourceFunction('ideSymbolOfLine', '70-palette.js'),
    sourceFunction('ideDirOf', '70-palette.js'),
    sourceFunction('ideWordEdges', '70-palette.js'),
    sourceFunction('ideMatchRank', '70-palette.js'),
    sourceFunction('ideFileRank', '70-palette.js'),
    sourceFunction('ideSymbolRank', '70-palette.js'),
    sourceFunction('ideActionRank', '70-palette.js'),
    sourceFunction('ideRankRows', '70-palette.js'),
    sourceFunction('idePaletteEntries', '70-palette.js'),
    sourceFunction('ideBasename', '10-core.js'),
  ].join('\n')
  const palette = new Function(`${source}\nreturn {
    ideIsCodePath, ideFqnOf, ideClassName, ideSymbolPattern, ideSymbolOfLine,
    ideMatchRank, ideFileRank, ideSymbolRank, ideActionRank, idePaletteEntries,
  }`)()

  check(palette.ideIsCodePath('src/A.java') === true, 'a Java file is code', String(palette.ideIsCodePath('src/A.java')))
  check(palette.ideIsCodePath('src/A.JAVA') === true, 'the check ignores case', String(palette.ideIsCodePath('src/A.JAVA')))
  check(palette.ideIsCodePath('README.md') === false, 'markdown is not code', String(palette.ideIsCodePath('README.md')))
  check(palette.ideIsCodePath('pom.xml') === false, 'build config is not code', String(palette.ideIsCodePath('pom.xml')))
  check(palette.ideIsCodePath('Makefile') === false, 'an extension-less name is not claimed', String(palette.ideIsCodePath('Makefile')))

  // 类：文件即类，展示全限定名
  check(palette.ideFqnOf('order-service-application/src/main/java/com/x/OrderService.java') === 'com.x.OrderService',
    'a source root is stripped into a package name', palette.ideFqnOf('order-service-application/src/main/java/com/x/OrderService.java'))
  check(palette.ideFqnOf('src/test/java/com/x/OrderServiceTest.java') === 'com.x.OrderServiceTest',
    'a test source root is recognised too', palette.ideFqnOf('src/test/java/com/x/OrderServiceTest.java'))
  check(palette.ideFqnOf('pkg/a/B.java') === 'pkg.a.B', 'a path without a source root keeps its shape', palette.ideFqnOf('pkg/a/B.java'))
  check(palette.ideClassName('src/main/java/com/x/OrderService.java') === 'OrderService', 'the class name is the file name', palette.ideClassName('src/main/java/com/x/OrderService.java'))

  // 符号：声明形状的 ripgrep 模式（JS 侧去掉内联 (?i) 后按 'i' 校验）
  const patternFor = (name) => palette.ideSymbolPattern(name).replace(/\(\?i:/g, '(?:')
  const pattern = patternFor('operat')
  // The ripgrep pattern scopes case-insensitivity to the identifier; the JS
  // approximation makes that group plain and applies the flag for the fixtures.
  const asJs = pattern.replace(/\(\?i:/g, '(?:')
  const matches = (line) => new RegExp(asJs, 'i').test(line)
  check(pattern !== '', 'an identifier prefix yields a pattern', pattern.slice(0, 40))
  check(palette.ideSymbolPattern('a.b.C') === '', 'a package name is not a symbol query', palette.ideSymbolPattern('a.b.C'))
  check(matches('    private Long operatorId;'), 'a typed field is a declaration', 'field')
  check(matches('    public enum OperationTypeEnum {'), 'a type declaration is a declaration', 'type')
  check(matches('    OPERATION("desc")'), 'an enum constant is a declaration', 'constant')
  check(matches('    public static final String OPERATOR_REQUIRED = "x";'), 'a constant field is a declaration', 'constant field')
  check(matches('const operatorIndex = 1'), 'a script constant is a declaration', 'script const')
  check(matches('function operatorName() {}'), 'a function is a declaration', 'script function')
  check(matches('    async function operatorLoad() {}'), 'an async function is a declaration', 'script async')
  const billPattern = patternFor('bill')
  const billMatches = (line) => new RegExp(billPattern).test(line)
  check(!billMatches('            return bill;'), 'a lowercase leading word is not a type', 'return')
  check(billMatches('    private Long billId;'), 'a typed field still matches the case-sensitive shape', 'field')
  check(!matches('        Map<String, Foo> operatorIndex = new LinkedHashMap<>();'), 'a local variable inside a method is not a symbol', 'local')
  check(!matches('        return operator.call();'), 'a call is not a declaration', 'call')
  check(!matches('            operator = null;'), 'an assignment is not a declaration', 'assignment')
  check(!matches('    // operator notes'), 'a comment is not a declaration', 'comment')

  check(JSON.stringify(palette.ideSymbolOfLine('    private Long operatorId;', 'operat')) === JSON.stringify({ name: 'operatorId', kind: 'field' }),
    'a field keeps its name and kind', JSON.stringify(palette.ideSymbolOfLine('    private Long operatorId;', 'operat')))
  check(palette.ideSymbolOfLine('    public String getOperator() {', 'getOperat')?.kind === 'method', 'a method is recognised', JSON.stringify(palette.ideSymbolOfLine('    public String getOperator() {', 'getOperat')))
  check(palette.ideSymbolOfLine('    public enum OperationTypeEnum {', 'Operat')?.kind === 'type', 'a type is recognised', JSON.stringify(palette.ideSymbolOfLine('    public enum OperationTypeEnum {', 'Operat')))
  check(palette.ideSymbolOfLine('    // nothing here', 'Operat') === undefined, 'a line without the prefix yields nothing', String(palette.ideSymbolOfLine('    // nothing here', 'Operat')))

  // 相关性
  check(palette.ideSymbolRank({ name: 'operatorId' }, 'operatorId') > palette.ideSymbolRank({ name: 'operatorIdx' }, 'operatorId'),
    'an exact symbol name outranks a longer prefix', `${palette.ideSymbolRank({ name: 'operatorId' }, 'operatorId')} / ${palette.ideSymbolRank({ name: 'operatorIdx' }, 'operatorId')}`)
  check(palette.ideSymbolRank({ name: 'OperationTypeEnum', kind: 'type' }, 'operat') > palette.ideSymbolRank({ name: 'operationTypeEnum', kind: 'field' }, 'operat'),
    'a type outranks a member of the same name', `${palette.ideSymbolRank({ name: 'OperationTypeEnum', kind: 'type' }, 'operat')} / ${palette.ideSymbolRank({ name: 'operationTypeEnum', kind: 'field' }, 'operat')}`)
  const whole = palette.ideMatchRank('return getBy(id);', 'getBy')
  const prefix = palette.ideMatchRank('return getById(id);', 'getBy')
  const inside = palette.ideMatchRank('return forgetBy(id);', 'getBy')
  check(whole > prefix, 'a whole identifier outranks a prefix', `${whole} / ${prefix}`)
  check(prefix > inside, 'a prefix outranks a contained substring', `${prefix} / ${inside}`)
  check(palette.ideMatchRank('int other = 1;', 'getBy') === 0, 'a row rg matched as a pattern ranks last instead of vanishing', String(palette.ideMatchRank('int other = 1;', 'getBy')))
  check(palette.ideFileRank('src/OrderService.java', 'OrderService') > palette.ideFileRank('src/OrderServiceHelper.java', 'OrderService'),
    'a file named exactly the query comes first', `${palette.ideFileRank('src/OrderService.java', 'OrderService')} / ${palette.ideFileRank('src/OrderServiceHelper.java', 'OrderService')}`)
  check(palette.ideActionRank('Refresh', 'refresh') === 100, 'an exact command name wins', String(palette.ideActionRank('Refresh', 'refresh')))

  // 合并视图：类 → 符号 → 文件 → 文本 → 操作；源码文件只在「类」出现一次
  const classes = [{ path: 'src/main/java/com/x/OrderService.java', name: 'OrderService', fqn: 'com.x.OrderService' }]
  const symbols = [{ path: 'src/main/java/com/x/OrderService.java', line: 12, name: 'orderId', kind: 'field', fqn: 'com.x.OrderService' }]
  const files = [{ path: 'src/main/java/com/x/OrderService.java', line: undefined }, { path: 'pom.xml', line: undefined }]
  const text = [
    { path: 'README.md', line: 3, text: 'order id' },
    { path: 'src/main/java/com/x/OrderService.java', line: 40, text: 'this.orderId' },
    { path: 'src/main/java/com/x/OrderService.java', line: 12, text: 'private Long orderId;' },
  ]
  const actions = [{ id: 'tree', label: 'Toggle tree', run: () => {} }]
  const merged = palette.idePaletteEntries({ category: 'all', classes, symbols, files, text, actions, query: 'order' })
  const mergedKinds = [...new Set(merged.map((row) => row.kind))].join(',')
  check(mergedKinds === 'class,symbol,files,text,actions',
    'the merged view runs classes, symbols, files, text, actions', mergedKinds)
  check(merged.filter((row) => row.kind === 'files').length === 1, 'a source file is not repeated under files', String(merged.filter((row) => row.kind === 'files').length))
  check(merged.filter((row) => row.kind === 'text').length === 2, 'a code line still shows under text unless the symbol lists it', String(merged.filter((row) => row.kind === 'text').length))
  check(merged.filter((row) => row.kind === 'text').every((row) => !(row.path.endsWith('OrderService.java') && row.line === 12)), 'the symbol line is not repeated as text', JSON.stringify(merged.filter((row) => row.kind === 'text')))
  check(palette.idePaletteEntries({ category: 'files', classes, symbols, files, text, actions, query: 'order' }).filter((row) => row.kind === 'files').length === 2,
    'the files tab still lists every file', String(palette.idePaletteEntries({ category: 'files', classes, symbols, files, text, actions, query: 'order' }).filter((row) => row.kind === 'files').length))
  check(palette.idePaletteEntries({ category: 'class', classes, symbols, files, text, actions, query: 'order' }).every((row) => row.kind === 'class'),
    'the class tab lists classes only', JSON.stringify(palette.idePaletteEntries({ category: 'class', classes, symbols, files, text, actions, query: 'order' }).map((row) => row.kind)))
  const symbolRow = merged.find((row) => row.kind === 'symbol')
  check(symbolRow?.path === 'src/main/java/com/x/OrderService.java' && symbolRow?.line === 12, 'a symbol row carries its line for the jump', JSON.stringify(symbolRow))
  check(symbolRow?.detail === 'com.x.OrderService', 'a symbol row names its declaring class', String(symbolRow?.detail))
}

// ---- file icons: Java type letters and extension initials ------------------
{
  const source = [
    sourceFunction('ideJavaLetter', '05-icons.js'),
    sourceFunction('ideJavaTint', '05-icons.js'),
    sourceFunction('ideFileLetter', '05-icons.js'),
  ].join('\n')
  const icons = new Function(`${source}\nreturn { ideJavaLetter, ideJavaTint, ideFileLetter }`)()
  check(icons.ideJavaLetter('class') === 'C', 'a class shows C', icons.ideJavaLetter('class'))
  check(icons.ideJavaLetter('interface') === 'I', 'an interface shows I', icons.ideJavaLetter('interface'))
  check(icons.ideJavaLetter('enum') === 'E', 'an enum shows E', icons.ideJavaLetter('enum'))
  check(icons.ideJavaLetter('annotation') === '@', 'an annotation shows @', icons.ideJavaLetter('annotation'))
  check(icons.ideJavaLetter('record') === 'R', 'a record shows R', icons.ideJavaLetter('record'))
  check(icons.ideJavaLetter('') === 'J', 'an unknown Java file falls back to J', icons.ideJavaLetter(''))
  check(icons.ideJavaTint('interface') === '#7fb33f', 'an interface is green', icons.ideJavaTint('interface'))
  check(icons.ideFileLetter('pom.xml') === 'X', 'the initial is the type, not the name', icons.ideFileLetter('pom.xml'))
  check(icons.ideFileLetter('application.yml') === 'Y', 'a yaml file shows Y', icons.ideFileLetter('application.yml'))
  check(icons.ideFileLetter('README') === 'R', 'a file without a dot uses its name', icons.ideFileLetter('README'))
  check(icons.ideFileLetter('Dockerfile') === 'D', 'Dockerfile shows D', icons.ideFileLetter('Dockerfile'))
  check(icons.ideFileLetter('.gitignore') === 'G', 'a dotfile uses the part after the dot', icons.ideFileLetter('.gitignore'))
  check(icons.ideFileLetter('archive.tar.gz') === 'G', 'the last extension wins', icons.ideFileLetter('archive.tar.gz'))
}

// ---- tree tools: ancestor directories ---------------------------------------
{
  const fn = new Function(`${sourceFunction('ideAncestorDirs', '10-core.js')}\nreturn ideAncestorDirs`)()
  check(JSON.stringify(fn('a/b/C.java')) === '["a","a/b"]', 'ancestors are shallowest first', JSON.stringify(fn('a/b/C.java')))
  check(JSON.stringify(fn('C.java')) === '[]', 'a top-level file has no ancestors', JSON.stringify(fn('C.java')))
  check(JSON.stringify(fn('a/b/c/D.java')) === '["a","a/b","a/b/c"]', 'every level is an ancestor', JSON.stringify(fn('a/b/c/D.java')))
}

// ---- reference rows that are declarations ----------------------------------
{
  const isReferenceDeclaration = new Function([
    sourceFunction('ideRegexEscape', '65-lsp.js'),
    sourceFunction('ideTextualIsDeclaration', '65-lsp.js'),
    sourceFunction('ideReferenceIsDeclaration', '65-lsp.js'),
  ].join('\n') + '\nreturn ideReferenceIsDeclaration')()

  const interfaceLines = ['    PageRespVo<PaymentRecordResp> selectPage(PaymentRecordPageQuery query);']
  check(isReferenceDeclaration(interfaceLines, 1, 'selectPage') === true,
    "the contract's signature row is not a caller", 'interface declaration')
  const implLines = ['    public PageRespVo<PaymentRecordResp> selectPage(PaymentRecordPageQuery query) {']
  check(isReferenceDeclaration(implLines, 1, 'selectPage') === true,
    "an override's signature row is not a caller", 'impl declaration')
  const controllerLines = ['        return DataResponse.ok(paymentRecordService.selectPage(query));']
  check(isReferenceDeclaration(controllerLines, 1, 'selectPage') === false,
    'a call row is a caller', 'controller call')
}

// ---- reference mentions ----------------------------------------------------
{
  const mention = new Function([
    'const idePlatform = { toPosix: (value) => String(value ?? "").replace(/\\\\/g, "/") }',
    sourceFunction('ideReferenceMention', '10-core.js'),
    'return ideReferenceMention',
  ].join('\n'))()
  check(mention('src/a/B.java', false) === '@src/a/B.java', 'a file mention is the path with @', mention('src/a/B.java', false))
  check(mention('docs', true) === '@docs/', 'a directory mention keeps its slash', mention('docs', true))
  check(mention('my file.txt', false) === '@"my file.txt"', 'a path with a space is quoted', mention('my file.txt', false))
  check(mention('my dir', true) === '@"my dir/', 'a quoted directory opens the quote and keeps the slash', mention('my dir', true))
  check(mention('/src/a/B.java', false) === '@src/a/B.java', 'a leading slash is dropped', mention('/src/a/B.java', false))
}

// ---- the client diagnostics ring -------------------------------------------
{
  const log = new Function('globalThis', 'ideRuntimeContext', [
    grabSource('IDE_LOG_LIMIT', '07-log.js'),
    'const ideLogEntries = []',
    sourceFunction('ideLogRecord', '07-log.js'),
    sourceFunction('ideLogSnapshot', '07-log.js'),
    'return { record: ideLogRecord, snapshot: ideLogSnapshot }',
  ].join('\n'))(globalThis, { platform: 'windows', runtime: 'desktop' })
  const { record, snapshot } = log

  const one = record('error', 'route', 'jar failed', { code: 'E1' })
  check(one.level === 'error' && one.scope === 'route' && one.message === 'jar failed', 'a client entry keeps level, scope and message', JSON.stringify(one))
  check(typeof one.detail === 'string' && one.detail.includes('E1'), 'a client entry serialises its detail', String(one.detail))
  for (let index = 0; index < 120; index += 1) record('info', 'ring', `c-${index}`)
  const shot = snapshot()
  check(shot.entries.length === 100, 'the client ring is capped at 100 entries', String(shot.entries.length))
  check(shot.entries[shot.entries.length - 1].message === 'c-119', 'the client ring ends with the newest entry', shot.entries[shot.entries.length - 1].message)
  check(shot.platform === 'windows' && shot.runtime === 'desktop', 'a snapshot names the platform it came from', JSON.stringify({ platform: shot.platform, runtime: shot.runtime }))
}

// ---- the client platform layer ---------------------------------------------
{
  const platformOf = new Function(`${sourceFunction('idePlatformOf', '06-platform.js')}\nreturn idePlatformOf`)()
  const windows = platformOf('windows')
  const mac = platformOf('macos')

  check(windows.toPosix('C:\\work\\app\\A.java') === 'C:/work/app/A.java', 'windows paths fold to slashes', windows.toPosix('C:\\work\\app\\A.java'))
  check(windows.toNative('C:/work/app/A.java') === 'C:\\work\\app\\A.java', 'windows paths expand back to native', windows.toNative('C:/work/app/A.java'))
  check(mac.toPosix('/work/app/A.java') === '/work/app/A.java', 'macOS paths are untouched', mac.toPosix('/work/app/A.java'))
  check(windows.isAbsolutePath('C:\\work') === true, 'windows accepts a drive path', windows.isAbsolutePath('C:\\work'))
  check(windows.isAbsolutePath('work\\app') === false, 'windows refuses a relative path', windows.isAbsolutePath('work\\app'))
  check(mac.isAbsolutePath('/work') === true && mac.isAbsolutePath('work') === false, 'macOS distinguishes rooted paths', mac.isAbsolutePath('/work'))
  check(platformOf('linux').name === 'windows', 'anything that is not macOS takes the Windows behaviour', platformOf('linux').name)
  check(JSON.stringify(windows.gestureChoices()) === JSON.stringify(['double', 'meta', 'alt']), 'windows offers no separate Ctrl gesture', JSON.stringify(windows.gestureChoices()))
  check(windows.gestureLabelKey('meta') === 'gestureCtrl', 'windows prints the primary click as Ctrl', windows.gestureLabelKey('meta'))
  check(windows.gestureLabelKey('alt') === 'gestureAltWin', 'windows prints Alt rather than ⌥', windows.gestureLabelKey('alt'))
  check(mac.gestureLabelKey('meta') === 'gestureMeta' && mac.gestureLabelKey('alt') === 'gestureAlt', 'macOS keeps its own glyphs', mac.gestureLabelKey('alt'))
  check(mac.gestureLabelKey('ctrl') === 'gestureCtrl', 'macOS keeps control-click distinct from ⌘-click', mac.gestureLabelKey('ctrl'))
  check(windows.bindingGlyphs().control === 'Ctrl', 'windows keycaps say Ctrl', windows.bindingGlyphs().control)

  // The path helpers take the platform from the closure; injecting the Windows
  // one proves a native path from a Windows Session still resolves.
  // The Client carries its own copy of the path rules (it cannot import the Host
  // one), so both implementations are compared on the same inputs here: drift
  // between them is the failure this table catches.
  const samples = [
    '/Users/a/src/main/java/com/x/Y.java',
    'C:\\work\\app\\A.java',
    'C:/work/app/A.java',
    // The language server reports a lower-case drive on Windows; both sides must
    // canonicalise it the same way or a jump is judged "outside the workspace".
    'c:/work/app/A.java',
    'c:\\work\\app\\A.java',
    '\\\\server\\share\\app',
    'work\\app',
    'a/b',
  ]
  const drifting = samples.filter((sample) => (
    windows.toPosix(sample) !== windowsPlatform.toPosix(sample)
    || windows.isAbsolutePath(sample) !== windowsPlatform.isAbsolutePath(sample)
    || mac.toPosix(sample) !== macPlatform.toPosix(sample)
    || mac.isAbsolutePath(sample) !== macPlatform.isAbsolutePath(sample)
  ))
  check(drifting.length === 0, 'the Client and Host platform rules agree on every sample', JSON.stringify(drifting))

  const withPlatform = (source, name) => new Function('idePlatform', `${source}\nreturn ${name}`)(windows)
  const fqnOf = withPlatform(sourceFunction('ideFqnOf', '70-palette.js'), 'ideFqnOf')
  check(fqnOf('C:\\ws\\src\\main\\java\\com\\x\\Y.java') === 'com.x.Y', 'a Windows source path yields its FQN', fqnOf('C:\\ws\\src\\main\\java\\com\\x\\Y.java'))

  const splitPath = withPlatform(sourceFunction('ideSplitPath', '10-core.js'), 'ideSplitPath')
  check(JSON.stringify(splitPath('C:\\ws\\a\\B.java')) === JSON.stringify({ dir: 'C:/ws/a/', name: 'B.java' }), 'a Windows path splits on its own separator', JSON.stringify(splitPath('C:\\ws\\a\\B.java')))

  const relativeToCase = withPlatform(sourceFunction('ideRelativeTo', '10-core.js'), 'ideRelativeTo')
  check(relativeToCase('C:\\ws', 'c:/ws/src/A.java') === 'src/A.java', 'a lower-case drive still belongs to the workspace', String(relativeToCase('C:\\ws', 'c:/ws/src/A.java')))
  check(relativeToCase('C:\\WS', 'c:/ws/src/A.java') === 'src/A.java', 'the workspace root is compared case-insensitively too', String(relativeToCase('C:\\WS', 'c:/ws/src/A.java')))
  check(relativeToCase('C:\\ws', 'D:/ws/src/A.java') === null, 'another drive is outside the workspace', String(relativeToCase('C:\\ws', 'D:/ws/src/A.java')))

  const abs = withPlatform(sourceFunction('ideAbs', '10-core.js'), 'ideAbs')
  check(abs('C:\\ws', 'src\\main\\A.java') === 'C:/ws/src/main/A.java', 'the absolute join stays POSIX', abs('C:\\ws', 'src\\main\\A.java'))

  const relativeTo = withPlatform(sourceFunction('ideRelativeTo', '10-core.js'), 'ideRelativeTo')
  check(relativeTo('C:\\ws', 'C:\\ws\\a\\B.java') === 'a/B.java', 'a Windows absolute path resolves against the root', String(relativeTo('C:\\ws', 'C:\\ws\\a\\B.java')))
  check(relativeTo('/ws', 'C:\\other\\B.java') === null, 'a path outside the root is refused', String(relativeTo('/ws', 'C:\\other\\B.java')))
}

// ---- LSP licence refusal ---------------------------------------------------
{
  const needsLicense = new Function([
    sourceFunction('ideLspNeedsLicense', '65-lsp.js'),
  ].join('\n') + '\nreturn ideLspNeedsLicense')()
  check(needsLicense({ detail: 'Request refused: no active JetBrains license. Run \'intellij-server license login\'' }) === true,
    'a licence refusal is recognised', 'no active JetBrains license')
  check(needsLicense({ detail: 'server rejected textDocument/references with JSON-RPC error -32603: boom' }) === false,
    'an ordinary server error is not a licence refusal', '-32603')

  const failureText = new Function([
    sourceFunction('ideLspNeedsLicense', '65-lsp.js'),
    sourceFunction('ideLspFailureText', '65-lsp.js'),
  ].join('\n') + '\nreturn ideLspFailureText')()
  const licenceNotice = failureText({ code: 'LSP_SERVER_ERROR', detail: 'Request refused: no active JetBrains license' })
  check(licenceNotice.startsWith('license:'), 'the failure text marks a licence refusal', licenceNotice)
}

// ---- Code Vision: method declarations and counts ---------------------------
{
  const source = [
    sourceFunction('ideDeclarations', '30-code.js'),
    sourceFunction('ideVisionLabel', '30-code.js'),
    sourceFunction('ideVisionCount', '30-code.js'),
    sourceFunction('ideAnnotateRows', '30-code.js'),
  ].join('\n')
  const vision = new Function(`${source}\nreturn { ideDeclarations, ideVisionLabel, ideVisionCount, ideAnnotateRows }`)()
  const lines = [
    'package demo;',
    'public class Demo {',
    '    /** counts */',
    '    private Long operatorId;',
    '    private final List<Foo> fooList = new ArrayList<>();',
    '    public String getOperatorName() {',
    '        return operatorName;',
    '    // public void commented() {',
    '    @Override',
    '    public Demo() {',
    '    public static void main(String[] args) {',
    '}',
  ]
  const found = vision.ideDeclarations(lines, 0, lines.length)
  const byName = new Map(found.map((item) => [item.name, item]))
  check(byName.has('getOperatorName'), 'a method is a hint target', found.map((item) => item.name).join(','))
  check(byName.get('getOperatorName')?.index === 5, 'the declaration keeps its line index', String(byName.get('getOperatorName')?.index))
  check(byName.get('getOperatorName')?.column === lines[5].indexOf('getOperatorName'), 'the column points at the name', String(byName.get('getOperatorName')?.column))
  check(byName.has('main'), 'a static main is a hint target', found.map((item) => item.name).join(','))
  check(!byName.has('operatorId'), 'a field earns no hint', found.map((item) => item.name).join(','))
  check(!byName.has('fooList'), 'a generic field earns no hint', found.map((item) => item.name).join(','))
  check(!byName.has('operatorName'), 'a return statement is not a declaration', found.map((item) => item.name).join(','))
  check(!byName.has('commented'), 'a commented-out declaration is not one', found.map((item) => item.name).join(','))
  check(!byName.has('Demo'), 'a constructor is not a method declaration', found.map((item) => item.name).join(','))
  const shadow = vision.ideDeclarations(['    private Foo Foo() {'], 0, 1)
  check(shadow[0]?.column === 16, 'the column is the name, not the type', String(shadow[0]?.column))
  check(vision.ideDeclarations(['        ReconFundDocDto doc = requireDoc(docId);'], 0, 1).length === 0, 'a local inside a method body earns no hint', JSON.stringify(vision.ideDeclarations(['        ReconFundDocDto doc = requireDoc(docId);'], 0, 1)))
  check(vision.ideDeclarations(lines, 3, 4).length === 0, 'a field-only range yields nothing', String(vision.ideDeclarations(lines, 3, 4).length))
  check(vision.ideDeclarations(lines, 5, 6).length === 1, 'a range only covers its own lines', String(vision.ideDeclarations(lines, 5, 6).length))

  check(vision.ideVisionLabel(1, 1) === '1 个用法 · 1 个实现', 'counts read as a sentence', vision.ideVisionLabel(1, 1))
  check(vision.ideVisionLabel(3, 0) === '3 个用法', 'zero implementations are omitted', vision.ideVisionLabel(3, 0))
  const locations = [
    { path: 'a/B.java', line: 12 },
    { path: 'a/B.java', line: 12 },
    { path: 'a/C.java', line: 3 },
    { path: 'a/C.java', line: 3 },
    { path: 'a/D.java', line: 9 },
    { path: undefined, line: 1 },
  ]
  check(vision.ideVisionCount(locations, 'a/B.java', 12) === 2, 'the declaration is excluded and duplicates collapse', String(vision.ideVisionCount(locations, 'a/B.java', 12)))
  check(vision.ideVisionCount(undefined, 'a/B.java', 12) === 0, 'no locations means no count', String(vision.ideVisionCount(undefined, 'a/B.java', 12)))

  // Git annotate: one cell per line, banded by adjacent commit.
  const blames = new Map([
    [1, { author: 'simon', date: '2026/11/3', time: 1 }],
    [2, { author: 'simon', date: '2026/11/3', time: 1 }],
    [3, { author: 'alice', date: '2026/11/4', time: 2 }],
    [5, { author: 'alice', date: '2026/11/4', time: 2 }],
  ])
  const annotate = vision.ideAnnotateRows(blames, 6)
  check(annotate.get(1)?.label === '2026/11/3 simon', 'an annotate cell names the date and author', JSON.stringify(annotate.get(1)))
  check(annotate.get(1)?.band === annotate.get(2)?.band, 'one commit keeps one band', `${annotate.get(1)?.band}/${annotate.get(2)?.band}`)
  check(annotate.get(1)?.band !== annotate.get(3)?.band, 'the next commit starts a new band', `${annotate.get(1)?.band}/${annotate.get(3)?.band}`)
  check(annotate.get(4)?.label === '', 'a line without blame stays empty', JSON.stringify(annotate.get(4)))
  check(annotate.size === 6, 'every line gets a cell', String(annotate.size))
  check(vision.ideAnnotateRows(undefined, 3).size === 0, 'no blame means no cells', String(vision.ideAnnotateRows(undefined, 3).size))
  const freshFn = new Function([
    grabSource('IDE_BLAME_TTL_MS', '30-code.js'),
    sourceFunction('ideBlameIsFresh', '30-code.js'),
    'return ideBlameIsFresh',
  ].join('\n'))()
  check(freshFn(undefined, 1000) === false, 'no cache is never fresh')
  check(freshFn({ at: 1000, rows: new Map() }, 20000) === true, 'a recent answer is fresh')
  check(freshFn({ at: 1000, rows: new Map() }, 31001) === false, 'an old answer expires')
  const mixed = new Map([
    [1, { author: 'Not Committed Yet', date: '2026/11/16', time: 9, uncommitted: true }],
    [2, { author: 'Not Committed Yet', date: '2026/11/16', time: 9, uncommitted: true }],
  ])
  const marked = vision.ideAnnotateRows(mixed, 2, '未提交')
  check(marked.get(1)?.label === '未提交', 'an uncommitted line says so', JSON.stringify(marked.get(1)))
  check(marked.get(1)?.band === marked.get(2)?.band, 'adjacent uncommitted lines share a band', `${marked.get(1)?.band}/${marked.get(2)?.band}`)
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

// DSH's 「已编辑」 rows carry an absolute path; the panel addresses files relatively.
{
  const relative = new Function(`${sourceFunction('ideRelativeWorkspacePath', '60-jump.js')}\nreturn ideRelativeWorkspacePath`)()
  check(relative('/w/app/A.java', '/w/app', 'A.java') === 'A.java', 'a path under the root turns relative', relative('/w/app/A.java', '/w/app', 'A.java'))
  check(relative('/elsewhere/B.java', '/w/app', 'B.java') === 'B.java', 'a path outside keeps the card text', relative('/elsewhere/B.java', '/w/app', 'B.java'))
  check(relative('', '/w/app', '') === '', 'no path yields nothing', relative('', '/w/app', ''))
  check(relative('/w/app', '/w/app', 'x') === '', 'the root itself is not a file', relative('/w/app', '/w/app', 'x'))
}

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

// Coming back to the window re-reads the active file (commit changes no bytes).
const focusPath = jumpStore.getState().activePath
const focusAbs = `/tmp/workspace-only/${focusPath}`
const focusReadsBefore = jumpLog.filter((entry) => entry[0] === 'read' && entry[2] === focusAbs).length
jumpStore.reloadActive()
await tick()
const focusReadsAfter = jumpLog.filter((entry) => entry[0] === 'read' && entry[2] === focusAbs).length
check(focusReadsAfter > focusReadsBefore, 'reloadActive re-reads the active file', `${focusReadsBefore} -> ${focusReadsAfter}`)

// The tree tools: collapse everything, then reveal the active file again.
jumpStore.openAt('/tmp/workspace-only/src/App.ts', 1)
await tick()
jumpStore.collapseAll()
check(jumpStore.getState().expanded.length === 0, 'collapse all closes every directory')
check(jumpStore.revealActive() === true, 'reveal accepts an open workspace file')
check(jumpStore.getState().expanded.includes('src'), 'reveal expands the ancestors again')
check(jumpStore.getState().revealFile?.path === 'src/App.ts', 'reveal signals the tree to scroll', JSON.stringify(jumpStore.getState().revealFile))
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

  const attrLine = new Function(`${grabSource('ideAttributeLineIn', '65-lsp.js')}\nreturn ideAttributeLineIn`)()
  const jarSource = [
    '/**',
    ' * 通过 {@link #operateType()} 指定操作类型编码。',
    ' */',
    'public @interface OperateLog {',
    '    String operateType() default "";',
    '}',
  ]
  check(attrLine(jarSource, 'operateType') === 4, 'the declaration wins over the javadoc mention', String(attrLine(jarSource, 'operateType')))
  check(attrLine(jarSource, 'missing') === -1, 'an absent attribute reports -1', String(attrLine(jarSource, 'missing')))

// ---- annotation runs are clickable ----------------------------------------
{
  const symbol = new Function(
    `${grabSource('IDE_SYMBOL_RUN', '30-code.js')}\n${grabSource('ideSymbolOfRun', '30-code.js')}\nreturn ideSymbolOfRun`,
  )()
  const anno = symbol({ cls: 'iw-ann', text: '@OperateLog' })
  check(anno?.name === 'OperateLog', 'an annotation run yields its type name', JSON.stringify(anno))
  check(anno?.offset === 1, 'the offset points past the @', String(anno?.offset))

  const qualified = symbol({ cls: 'iw-ann', text: '@com.a.OperateLog' })
  check(qualified?.name === 'OperateLog', 'a fully qualified annotation yields the simple name', JSON.stringify(qualified))
  check(qualified?.offset === 7, 'its offset points at the simple name', String(qualified?.offset))

  check(symbol({ cls: 'iw-type', text: 'ReconBillEntity' })?.name === 'ReconBillEntity', 'a type is still clickable')
  check(symbol({ cls: 'iw-str', text: '@OperateLog' }) === undefined, 'a string is never clickable')
  check(symbol({ cls: 'iw-ann', text: '@' }) === undefined, 'a bare @ is not a symbol')
}

// ---- annotation attributes ------------------------------------------------
{
  const typeAt = new Function(`${grabSource('ideAnnotationTypeAt', '65-lsp.js')}\nreturn ideAnnotationTypeAt`)()
  const lines = [
    '  @OperateLog(operateType = "RECON_BILL_CONFIRM", bizType = "BILL")',
    '  public void confirmByPlatform() {}',
  ]
  check(typeAt(lines, { line: 0, character: 18 }) === 'OperateLog', 'an attribute inside an annotation names its type', String(typeAt(lines, { line: 0, character: 18 })))
  check(typeAt(lines, { line: 1, character: 16 }) === '', 'a symbol outside the arguments is not an annotation attribute', String(typeAt(lines, { line: 1, character: 16 })))
  check(typeAt(['  int gap = f(a, b);'], { line: 0, character: 15 }) === '', 'a plain call is not an annotation')

  // 多行注解：类型在上一行
  const spread = [
    '  @OperateLog(',
    '      operateType = "X",',
    '      bizType = "BILL")',
  ]
  check(typeAt(spread, { line: 1, character: 10 }) === 'OperateLog', 'a multi-line annotation is still found', String(typeAt(spread, { line: 1, character: 10 })))
  check(typeAt(['  @First(a = 1)', '  @Second(b = 2)'], { line: 1, character: 12 }) === 'Second', 'the innermost annotation wins', String(typeAt(['  @First(a = 1)', '  @Second(b = 2)'], { line: 1, character: 12 })))
  check(typeAt(['  @First(a = 1); int x = 2;'], { line: 0, character: 24 }) === '', 'an annotation that already closed is not matched')
}

// ---- jumping to a definition (the suspended path) --------------------------
{
  // 这段逻辑是组件内的闭包，之前没有用例真正跑过它，所以 `outcome is not defined`
  // 这类引用错误只在真实跳转时炸出来。这里把函数体取出来，用桩跑一遍。
  const source = grabSource('jumpToDefinition', '30-code.js')
  const fallback = grabSource('openLocalDeclaration', '30-code.js')
  const mapperJump = grabSource('openMapperStatement', '30-code.js')
  const accessor = grabSource('openAccessorProperty', '30-code.js')
  const typeLookup = grabSource('openLocalType', '30-code.js')
  const implementation = grabSource('openImplementation', '30-code.js')
  const matcher = new Function(`${grabSource('ideIsMethodDeclaration', '30-code.js')}\nreturn ideIsMethodDeclaration`)()
  const receiverOf = new Function(`${sourceFunction('ideReceiverToken', '65-lsp.js')}\nreturn ideReceiverToken`)()
  const declaredTypeOf = new Function(`${sourceFunction('ideDeclaredType', '65-lsp.js')}\nreturn ideDeclaredType`)()
  const accessorProperty = new Function(`${sourceFunction('ideAccessorProperty', '65-lsp.js')}\nreturn ideAccessorProperty`)()
  const receiverOfCall = new Function(`${sourceFunction('ideReceiverToken', '65-lsp.js')}\n${sourceFunction('ideReceiverOfCall', '65-lsp.js')}\nreturn ideReceiverOfCall`)()
  const receiverChain = new Function(`${sourceFunction('ideReceiverChain', '65-lsp.js')}\nreturn ideReceiverChain`)()
  const fieldDeclaration = new Function(`${sourceFunction('ideRegexEscape', '65-lsp.js')}\n${sourceFunction('ideIsFieldDeclaration', '65-lsp.js')}\nreturn ideIsFieldDeclaration`)()
  const typeDeclaration = new Function(`${sourceFunction('ideRegexEscape', '65-lsp.js')}\n${sourceFunction('ideIsTypeDeclaration', '65-lsp.js')}\nreturn ideIsTypeDeclaration`)()
  const build = (navigate, opened, options = {}) => {
    const notices = []
    const popups = []
    const lines = options.lines ?? ['class B {}']
    const greps = options.greps ?? []
    const factory = new Function(
      'store', 'tab', 'tr', 'navigate', 'setPopup', 'openFromJar', 'popupAt', 'ideBasename',
      'ideAnnotationTypeAt', 'openAnnotationAttribute', 'lines',
      'ideIsMethodDeclaration', 'ideReceiverToken', 'ideDeclaredType', 'ideGrepQuery',
      'ideLspQuery', 'ideTextualImplementations', 'ideAccessorProperty', 'ideIsFieldDeclaration', 'ideIsTypeDeclaration', 'ideAbs', 'ideReceiverOfCall', 'ideReceiverChain', 'ideLspLicenseMissing',
      `${sourceFunction('ideRegexEscape', '65-lsp.js')}
      ${sourceFunction('ideDeclarationPattern', '65-lsp.js')}
      ${grabSource('ideMapperLooksLikeMapper', '30-code.js')}
      ${grabSource('ideMapperStatementPattern', '30-code.js')}
      ${grabSource('ideTypePositionAt', '30-code.js')}
      ${fallback}
      ${mapperJump}
      ${accessor}
      ${typeLookup}
      ${implementation}
      ${source}
      return { jump: jumpToDefinition }`,
    )
    const store = {
      setNotice: (text) => notices.push(text),
      openAt: () => opened,
      getState: () => ({ lastLoadMs: 7, rootPath: '/ws' }),
    }
    const api = factory(
      store,
      { path: 'pkg/B.java' },
      (key) => key,
      navigate,
      (popup) => popups.push(popup),
      async () => false,
      () => ({ x: 1, y: 2 }),
      (path) => path.split('/').pop(),
      // 注解属性走另一条分支：这个桩返回空，表示当前行不在注解参数里。
      () => '',
      async () => false,
      lines,
      matcher,
      receiverOf,
      declaredTypeOf,
      async () => ({ ok: true, matches: greps }),
      options.lsp ?? (async () => ({ locations: [] })),
      options.implementations ?? (async () => []),
      accessorProperty,
      fieldDeclaration,
      typeDeclaration,
      (root, path) => `${root}/${path}`,
      receiverOfCall,
      receiverChain,
      false,
    )
    return { api, notices, popups }
  }

  const single = build({ definition: async () => ({ locations: [{ path: 'pkg/B.java', line: 12 }], ms: 5 }) }, true)
  await single.api.jump('periodTime', { line: 3, character: 4 }, { clientX: 10, clientY: 10 })
  check(single.notices.includes(''), 'a successful jump clears the banner', JSON.stringify(single.notices))
  check(single.notices.some((text) => typeof text === 'string' && text.includes('B.java:12')),
    'the banner says where the jump went', JSON.stringify(single.notices.slice(-1)))

  const many = build({ definition: async () => ({ locations: [
    { path: 'pkg/A.java', line: 1 },
    { path: 'pkg/B.java', line: 2 },
  ], ms: 9 }) }, true)
  await many.api.jump('periodTime', { line: 3, character: 4 }, { clientX: 10, clientY: 10 })
  check(many.popups.length === 1, 'several destinations open the popup instead', String(many.popups.length))
  check(many.popups[0]?.ms === 9, 'the popup carries the query time', String(many.popups[0]?.ms))

  const failing = build({ definition: async () => { throw Object.assign(new Error('boom'), { code: 'lsp-error' }) } }, true)
  await failing.api.jump('periodTime', { line: 3, character: 4 }, { clientX: 10, clientY: 10 })
  check(failing.notices.some((text) => typeof text === 'string' && text.includes('noDefinition')),
    'a symbol no server knows reports「未找到定义」', JSON.stringify(failing.notices.slice(-1)))

  // 定义在工作区之外（依赖 jar）时，不能直接报「打开失败」：还要去 jar 里找源码。
  const outside = build({ definition: async () => ({ locations: [{ path: '/Users/x/.m2/a-sources.jar!/pkg/B.java', line: 12 }], ms: 5 }) }, false)
  await outside.api.jump('periodTime', { line: 3, character: 4 }, { clientX: 10, clientY: 10 })
  check(!outside.notices.some((text) => typeof text === 'string' && text.includes('jumpFailed')),
    'a location inside a dependency jar is not reported as a failed jump', JSON.stringify(outside.notices.slice(-1)))
  check(outside.notices.some((text) => typeof text === 'string' && text.includes('noDefinition')),
    'when no source is readable either, the banner says so', JSON.stringify(outside.notices.slice(-1)))

  // 服务器没答出来、但声明就在工作区里：文本回退要落到接口里的方法。
  const fallbackJump = build({ definition: async () => ({ locations: [], ms: 4 }) }, true, {
    lines: [
      'class B {',
      '  private final OrderClearingService orderClearingService;',
      '  void m() { orderClearingService.getDetail(id); }',
    ],
    greps: [
      { path: 'other/CopyService.java', line: 9, text: '    OrderClearingDetailResp getDetail(Long clearingRecordId);' },
      { path: 'order/service/OrderClearingService.java', line: 230, text: '    OrderClearingDetailResp getDetail(Long clearingRecordId);' },
    ],
  })
  const line = '  void m() { orderClearingService.getDetail(id); }'
  await fallbackJump.api.jump('getDetail', { line: 2, character: line.indexOf('getDetail') }, { clientX: 10, clientY: 10 })
  const fallbackNotice = String(fallbackJump.notices.slice(-1)[0] ?? '')
  check(fallbackNotice.includes('OrderClearingService.java:230') && !fallbackNotice.includes('CopyService'),
    'an empty server answer falls back to the owner\'s declaration, not the first name match', fallbackNotice)

  // 双击接口方法声明：要进实现，不能跳到别的类里同名的方法。
  const declarationClick = build({ definition: async () => ({ locations: [], ms: 3 }) }, true, {
    lines: [
      'public interface OrderClearingService {',
      '    PageRespVo<OrderClearingRecordResp> selectPage(OrderClearingPageQuery query);',
      '}',
    ],
    greps: [
      { path: 'repo/PaymentRefundRecordRepository.java', line: 181, text: '    Page<RefundRecordEntity> selectPage(PaymentRefundQuery query);' },
    ],
  })
  await declarationClick.api.jump('selectPage', { line: 1, character: 40 }, { clientX: 10, clientY: 10 })
  const declarationNotice = String(declarationClick.notices.slice(-1)[0] ?? '')
  check(declarationNotice === 'alreadyAtDefinition: selectPage' || declarationNotice.includes('alreadyAtDefinition'),
    'a declaration click without implementations does not jump to an unrelated class', declarationNotice)

  const withImplementation = build({ definition: async () => ({ locations: [], ms: 3 }) }, true, {
    lines: [
      'public interface OrderClearingService {',
      '    PageRespVo<OrderClearingRecordResp> selectPage(OrderClearingPageQuery query);',
      '}',
    ],
    greps: [],
    implementations: async () => [{ path: 'service/impl/OrderClearingServiceImpl.java', line: 332 }],
  })
  await withImplementation.api.jump('selectPage', { line: 1, character: 40 }, { clientX: 10, clientY: 10 })
  const implementationNotice = String(withImplementation.notices.slice(-1)[0] ?? '')
  check(implementationNotice.includes('OrderClearingServiceImpl.java:332') && implementationNotice.includes('implementationLabel'),
    'a declaration click opens its implementation', implementationNotice)

  // A type name must never ask for implementations: on a class the server
  // answers with every subclass, which used to fill a 「声明 (50)」 popup when
  // double clicking `ServiceImpl` inside an `extends` clause.
  const seenOptions = []
  const serviceImplClick = build({
    definition: async (_path, _position, _name, options) => {
      seenOptions.push(options)
      return { locations: [], ms: 2 }
    },
  }, true, {
    lines: [
      'public class FulfillmentOrderRepository',
      '    extends ServiceImpl<FulfillmentOrderMapper, FulfillmentOrderEntity> {',
    ],
    greps: [],
  })
  await serviceImplClick.api.jump('ServiceImpl', { line: 1, character: 12 }, { clientX: 10, clientY: 10 })
  check(seenOptions.at(-1)?.implementationFallback === false,
    'a type click does not fall back to implementations', JSON.stringify(seenOptions[0]))
  check(serviceImplClick.popups.length === 0, 'a type click never opens the declaration popup', String(serviceImplClick.popups.length))

  const methodClick = build({
    definition: async (_path, _position, _name, options) => {
      seenOptions.push(options)
      return { locations: [], ms: 2 }
    },
    implementations: async () => [{ path: 'service/impl/X.java', line: 9 }],
  }, true, {
    lines: ['    PageRespVo<X> selectPage(Query q);'],
    greps: [],
  })
  await methodClick.api.jump('selectPage', { line: 0, character: 20 }, { clientX: 10, clientY: 10 })
  check(seenOptions.at(-1)?.implementationFallback === true,
    'a method declaration still falls back to implementations', JSON.stringify(seenOptions[1]))

  const typePosition = new Function(
    `${sourceFunction('ideRegexEscape', '65-lsp.js')}\n${grabSource('ideTypePositionAt', '30-code.js')}\nreturn ideTypePositionAt`,
  )()
  const extendsLine = '    extends ServiceImpl<FulfillmentOrderMapper, FulfillmentOrderEntity> {'
  check(typePosition(extendsLine, extendsLine.indexOf('ServiceImpl'), 'ServiceImpl') === true,
    'a name after extends is a type')
  const implementsLine = 'public class Demo implements Handler {'
  check(typePosition(implementsLine, implementsLine.indexOf('Handler'), 'Handler') === true,
    'a name after implements is a type')
  check(typePosition('public class Demo {', 13, 'Demo') === true, 'the class name is a type')
  const genericLine = '    List<OrderEntity> rows = find();'
  check(typePosition(genericLine, genericLine.indexOf('OrderEntity'), 'OrderEntity') === true,
    'a generic argument is a type')
  check(typePosition('    public String greet() {', 18, 'greet') === false,
    'a method declaration is not a type')

  // A MyBatis mapper method has no Java body: the click must land on the XML
  // statement, not on the "this is the definition" message.
  const mapperBuild = build(
    { definition: async () => ({ locations: [] }) },
    true,
    {
      lines: [
        'package com.demo.mapper;',
        '',
        '@Mapper',
        'public interface DemoMapper {',
        '  List<String> listCandidates(@Param("id") Long id);',
        '}',
      ],
      greps: [],
      tab: { path: 'src/main/java/com/demo/mapper/DemoMapper.java' },
    },
  )
  {
    const url = 'src/main/resources/mapper/DemoMapper.xml'
    const mapperNavigate = { definition: async () => ({ locations: [] }) }
    const notices = []
    const opened = []
    const factory = new Function(
      'store', 'tab', 'tr', 'navigate', 'setPopup', 'openFromJar', 'popupAt', 'ideBasename',
      'ideAnnotationTypeAt', 'openAnnotationAttribute', 'lines',
      'ideIsMethodDeclaration', 'ideReceiverToken', 'ideDeclaredType', 'ideGrepQuery',
      'ideLspQuery', 'ideTextualImplementations', 'ideAccessorProperty', 'ideIsFieldDeclaration', 'ideIsTypeDeclaration', 'ideAbs', 'ideReceiverOfCall', 'ideReceiverChain', 'ideLspLicenseMissing',
      `${sourceFunction('ideRegexEscape', '65-lsp.js')}
      ${sourceFunction('ideDeclarationPattern', '65-lsp.js')}
      ${grabSource('ideMapperLooksLikeMapper', '30-code.js')}
      ${grabSource('ideMapperStatementPattern', '30-code.js')}
      ${grabSource('ideTypePositionAt', '30-code.js')}
      ${fallback}
      ${mapperJump}
      ${implementation}
      ${source}
      return { jump: jumpToDefinition }`,
    )
    const mapperLines = [
      'package com.demo.mapper;',
      '',
      '@Mapper',
      'public interface DemoMapper {',
      '  List<String> listCandidates(@Param("id") Long id);',
      '}',
    ]
    const grep = async (root, pattern) => {
      if (pattern.includes('namespace')) return { ok: true, matches: [{ path: url, line: 3, text: '<mapper namespace="com.demo.mapper.DemoMapper">' }] }
      if (pattern.includes('listCandidates')) return { ok: true, matches: [{ path: url, line: 6, text: '<select id="listCandidates" resultType="x">' }] }
      return { ok: true, matches: [] }
    }
    const api = factory(
      { setNotice: (text) => notices.push(text), openAt: (path, line) => { opened.push([path, line]); return true }, getState: () => ({ lastLoadMs: 1, rootPath: '/ws' }) },
      { path: 'src/main/java/com/demo/mapper/DemoMapper.java', text: mapperLines.join('\n') },
      (key) => key,
      mapperNavigate,
      () => {},
      async () => false,
      () => ({ x: 1, y: 2 }),
      (path) => path.split('/').pop(),
      () => '',
      async () => false,
      mapperLines,
      (text, name) => matcher(text, name),
      receiverOf,
      declaredTypeOf,
      grep,
      async () => ({ locations: [] }),
      async () => [],
      accessorProperty,
      fieldDeclaration,
      typeDeclaration,
      (root, path) => `${root}/${path}`,
      receiverOfCall,
      receiverChain,
      false,
    )
    await api.jump('listCandidates', { line: 4, character: 20 }, { clientX: 1, clientY: 2 })
    check(opened.length === 1 && opened[0][0] === url, 'a mapper method jumps to its XML statement', JSON.stringify(opened))
    check(opened[0]?.[1] === 6, 'the XML statement line is the one with the id', String(opened[0]?.[1]))
  }
  check(mapperBuild !== undefined, 'the mapper fixture is wired', 'built')

  // 双击 Lombok 属性访问器：跳到字段，而不是某个同名方法。
  const propertyClick = build({ definition: async () => ({ locations: [], ms: 3 }) }, true, {
    lines: [
      'class B {',
      '  private final Entity entity;',
      '  void m() { entity.getName().trim(); }',
    ],
    greps: [
      { path: 'entity/Entity.java', line: 5, text: '    private String name;' },
      { path: 'entity/Entity.java', line: 20, text: '    public String getName() { return name; }' },
    ],
  })
  const propertyLine = '  void m() { entity.getName().trim(); }'
  await propertyClick.api.jump('getName', { line: 2, character: propertyLine.indexOf('getName') }, { clientX: 10, clientY: 10 })
  const propertyNotice = String(propertyClick.notices.slice(-1)[0] ?? '')
  check(propertyNotice.includes('Entity.java:5') && propertyNotice.includes('propertyLabel'),
    'an accessor click jumps to the property', propertyNotice)

  // 服务器把点击位置当答案时，同样按「进实现」处理。
  const samePosition = build({ definition: async () => ({ locations: [{ path: 'pkg/B.java', line: 1 }], ms: 4 }) }, true, {
    lines: [
      '  void selectPage() {}',
      '}',
    ],
    greps: [],
    implementations: async () => [{ path: 'pkg/BImpl.java', line: 9 }],
  })
  await samePosition.api.jump('selectPage', { line: 0, character: 7 }, { clientX: 10, clientY: 10 })
  const sameNotice = String(samePosition.notices.slice(-1)[0] ?? '')
  check(sameNotice.includes('BImpl.java:9'), 'a server answer pointing at the click opens the implementation', sameNotice)

  // 双击字段声明：它本身已经是定义，不能跳去别的类里的同名成员。
  const fieldClick = build({ definition: async () => ({ locations: [], ms: 3 }) }, true, {
    lines: [
      'class B {',
      '  private String refundNo;',
      '}',
    ],
    greps: [
      { path: 'other/Entity.java', line: 9, text: '    private String refundNo;' },
    ],
  })
  const fieldLine = '  private String refundNo;'
  await fieldClick.api.jump('refundNo', { line: 1, character: fieldLine.indexOf('refundNo') }, { clientX: 10, clientY: 10 })
  const fieldNotice = String(fieldClick.notices.slice(-1)[0] ?? '')
  check(fieldNotice.includes('alreadyAtDefinition'), 'a field declaration click stays put', fieldNotice)

  // 链式调用换行：接收者在上一行，双击方法名仍要找到它的声明。
  const chained = build({ definition: async () => ({ locations: [], ms: 3 }) }, true, {
    lines: [
      'class B {',
      '  private final PaymentRecordOrderRelationRepository paymentRecordOrderRelationRepository;',
      '  void m() {',
      '    Map<String, List<String>> map = paymentRecordOrderRelationRepository',
      '        .listByPaymentTradeNos(tradeNoSet).stream()',
      '  }',
      '}',
    ],
    greps: [
      { path: 'repo/Other.java', line: 9, text: '    public List<X> listByPaymentTradeNos(' },
      { path: 'repository/PaymentRecordOrderRelationRepository.java', line: 49, text: '    public List<PaymentRecordOrderRelationEntity> listByPaymentTradeNos(' },
    ],
  })
  const chainedLine = '        .listByPaymentTradeNos(tradeNoSet).stream()'
  await chained.api.jump('listByPaymentTradeNos', { line: 4, character: chainedLine.indexOf('listByPaymentTradeNos') }, { clientX: 10, clientY: 10 })
  const chainedNotice = String(chained.notices.slice(-1)[0] ?? '')
  check(chainedNotice.includes('PaymentRecordOrderRelationRepository.java:49') && !chainedNotice.includes('Other'),
    'a call broken across lines resolves the receiver on the line above', chainedNotice)

  // 枚举常量作接收者：`Type.CONSTANT.matches(...)` 的 owner 是最左边的类型。
  const enumReceiver = build({ definition: async () => ({ locations: [], ms: 3 }) }, true, {
    lines: [
      'class PurchaseOrderServiceImpl {',
      '  void confirm(PurchaseOrderConfirmReq req) {',
      '    Assert.isTrue(PurchaseOrderStatusEnum.TO_PURCHASE.matches(purchaseOrder.getStatus()), "x");',
      '  }',
      '}',
    ],
    greps: [
      { path: 'other/OrderCodeEnum.java', line: 13, text: '    default boolean matches(String code) {' },
      { path: 'enums/PurchaseOrderStatusEnum.java', line: 85, text: '    public boolean matches(Integer code) {' },
    ],
  })
  const enumLine = '    Assert.isTrue(PurchaseOrderStatusEnum.TO_PURCHASE.matches(purchaseOrder.getStatus()), "x");'
  await enumReceiver.api.jump('matches', { line: 2, character: enumLine.indexOf('matches') }, { clientX: 10, clientY: 10 })
  const enumNotice = String(enumReceiver.notices.slice(-1)[0] ?? '')
  check(enumNotice.includes('PurchaseOrderStatusEnum.java:85') && !enumNotice.includes('OrderCodeEnum'),
    'an enum constant receiver names its owning type', enumNotice)

  // 类型名：工作区里的类优先于已发布的 sources jar 副本。
  const typeClick = build({ definition: async () => ({ locations: [], ms: 3 }) }, true, {
    lines: [
      'class B {',
      '  PaymentRecordEntity entity = null;',
      '}',
    ],
    greps: [
      { path: 'entity/PaymentRecordEntity.java', line: 20, text: 'public class PaymentRecordEntity {' },
    ],
  })
  const typeLine = '  PaymentRecordEntity entity = null;'
  await typeClick.api.jump('PaymentRecordEntity', { line: 1, character: typeLine.indexOf('PaymentRecordEntity') }, { clientX: 10, clientY: 10 })
  const typeNotice = String(typeClick.notices.slice(-1)[0] ?? '')
  check(typeNotice.includes('PaymentRecordEntity.java:20'), 'a type name opens its workspace declaration', typeNotice)
}

// ---- tab context menu ------------------------------------------------------
{
  const store = mode.record.registrations.find((entry) => entry.name === 'main').inject().store
  store.setRoot('/tmp/ws')
  // 三个标签：两个工作区文件 + 一个 jar
  store.openAt('a/A.java', 1)
  store.openAt('b/B.java', 1)
  store.openJarSource({ className: 'x.Y', jar: '/tmp/x-sources.jar', text: 'class Y {}', line: 1 })
  const paths = () => store.getState().tabs.map((tab) => tab.path)
  check(paths().length === 3, 'three tabs are open', JSON.stringify(paths()))

  store.setTabMenu({ path: 'b/B.java', x: 10, y: 20 })
  check(store.getState().tabMenu?.path === 'b/B.java', 'the menu records its tab')

  store.closeToRight('b/B.java')
  check(paths().length === 2, 'closing to the right keeps the left ones', JSON.stringify(paths()))
  check(!paths().includes('#jar#x.Y'), 'the jar tab to the right is gone', JSON.stringify(paths()))

  // 重新开一个 jar，验证「关闭左侧」只留下自己
  store.openJarSource({ className: 'x.Y', jar: '/tmp/x-sources.jar', text: 'class Y {}', line: 1 })
  store.closeToLeft('#jar#x.Y')
  check(paths().length === 1 && paths()[0] === '#jar#x.Y', 'closing to the left keeps the tab itself', JSON.stringify(paths()))

  store.openAt('c/C.java', 1)
  store.closeReadOnly()
  check(!paths().some((path) => path.startsWith('#jar#')), 'read-only jar tabs close first', JSON.stringify(paths()))

  store.closeOthers('#jar#none')
  check(paths().length === 1, 'closing others with an absent tab keeps everything', JSON.stringify(paths()))
  store.closeOthers(paths()[0])
  check(paths().length === 1, 'closing others keeps exactly one', JSON.stringify(paths()))

  store.closeAllTabs()
  check(paths().length === 0, 'closing all empties the strip', JSON.stringify(paths()))
  store.setTabMenu(null)
  check(store.getState().tabMenu === null, 'the menu closes')
}

// ---- the single shortcut registry ------------------------------------------
{
  const registry = new Function(`${grabSource('IDE_SHORTCUTS', '05-shortcut-registry.js')}\nreturn IDE_SHORTCUTS`)()
  check(Array.isArray(registry) && registry.length === 10, 'the registry holds every code-workspace shortcut', String(registry?.length))
  const kinds = registry.map((entry) => entry.kind)
  check(kinds.filter((kind) => kind === 'key').length === 6,
    'six keyboard commands (toggle, back, ⌘P, screenshot, copy reference, open table)', kinds.join(','))
  const copyReference = registry.find((entry) => entry.action === 'copy-reference')
  check(copyReference?.kind === 'key' && copyReference?.defaults?.desktop?.code === 'KeyC',
    '复制引用回对话 is a bindable key', JSON.stringify(copyReference?.defaults))
  check(copyReference?.defaults?.web?.modifiers?.includes('alt') === true,
    'the web binding avoids the browser inspector (Ctrl+Shift+C)', JSON.stringify(copyReference?.defaults?.web))
  const openTable = registry.find((entry) => entry.action === 'open-table')
  check(openTable?.kind === 'key' && openTable?.defaults?.desktop?.code === 'KeyT',
    '在数据窗口打开表 is a bindable key', JSON.stringify(openTable?.defaults))
  for (const entry of [copyReference, openTable]) {
    check(typeof entry?.labelKey === 'string' && entry.labelKey !== '', 'the new shortcut carries a label key', String(entry?.labelKey))
  }

  // The shortcut has no pointer, so the tail comes from the last clicked symbol.
  const suffixOf = new Function(`${grabSource('ideReferenceSuffix', '90-apply.js')}\nreturn ideReferenceSuffix`)()
  check(suffixOf({ lastSymbol: { path: 'a/B.java', line: 58, symbol: 'selectPage' } }, 'a/B.java') === '#L58 selectPage',
    'the shortcut reuses the clicked symbol', String(suffixOf({ lastSymbol: { path: 'a/B.java', line: 58, symbol: 'selectPage' } }, 'a/B.java')))
  check(suffixOf({ lastSymbol: { path: 'a/B.java', line: 58, symbol: 'selectPage' } }, 'a/C.java') === '',
    'a symbol from another file is ignored')
  check(suffixOf({ lastSymbol: null }, 'a/B.java') === '', 'no clicked symbol means no tail')
  check(suffixOf({ lastSymbol: { path: 'a/B.java', line: 0, symbol: 'x' } }, 'a/B.java') === '',
    'a symbol without a line produces no tail')
  check(kinds.filter((kind) => kind === 'gesture').length === 3, 'three are pointer gestures', kinds.join(','))
  check(kinds.filter((kind) => kind === 'sequence').length === 1, 'one is a double-press sequence (double Shift)', kinds.join(','))
  check(kinds.every((kind) => kind !== 'fixed'), 'every shortcut is editable', kinds.join(','))
  const screenshot = registry.find((entry) => entry.action === 'screenshot')
  check(screenshot?.kind === 'key' && screenshot?.defaults?.desktop?.code === 'KeyS', 'the screenshot shortcut is bindable', JSON.stringify(screenshot?.defaults))

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

// ---- the floating assistant card -------------------------------------------
{
  const textOf = new Function(`${grabSource('ideFloatTextOf', '74-float.js')}\nreturn ideFloatTextOf`)()
  const transcriptOf = new Function(
    `${grabSource('IDE_FLOAT_MESSAGES', '74-float.js')}\n${grabSource('ideFloatTextOf', '74-float.js')}\n${grabSource('ideFloatImagesOf', '74-float.js')}\n${grabSource('ideFloatTranscript', '74-float.js')}\nreturn ideFloatTranscript`,
  )()

  check(textOf([{ type: 'text', text: 'a' }, { type: 'reasoning', text: 'x' }, { type: 'text', text: 'b' }]) === 'a\nb',
    'only text blocks reach the card')
  const log = [
    { type: 'event', event: { type: 'user/message', seq: 1, data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'ctx' }] } } },
    { type: 'event', event: { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '问题' }] } } },
    { type: 'event', event: { type: 'tool/call', seq: 3, data: {} } },
    { type: 'event', event: { type: 'assistant/message', seq: 4, data: { message: { content: [{ type: 'reasoning', text: '想' }, { type: 'text', text: '答案' }] } } } },
  ]
  const rows = transcriptOf(log)
  check(rows.length === 2, 'context injections and tool calls are not conversation rows', JSON.stringify(rows))
  check(rows[0]?.role === 'user' && rows[0]?.text === '问题', 'the prompt becomes a user row', JSON.stringify(rows[0]))
  check(rows[1]?.role === 'assistant' && rows[1]?.text === '答案', 'the reply becomes an assistant row', JSON.stringify(rows[1]))
  check(transcriptOf(log, 1).length === 1, 'the card keeps only the newest rows', String(transcriptOf(log, 1).length))
  check(transcriptOf(undefined).length === 0, 'an empty log renders no rows')

  // The session switcher lists conversations, newest first, without subagents.
  const sessionsOf = new Function(`${grabSource('ideFloatSessions', '74-float.js')}\nreturn ideFloatSessions`)()
  const listing = sessionsOf({
    ids: ['a', 'b', 'c', 'd'],
    byId: {
      a: { displayTitle: '旧会话', updatedAt: 10, running: false, cwd: '/w' },
      b: { displayTitle: '最新会话', updatedAt: 30, running: true, cwd: '/w' },
      c: { origin: 'subagent', displayTitle: '子代理', updatedAt: 50 },
      d: { title: '只有标题', updatedAt: 20 },
    },
  })
  check(listing.length === 3, 'subagent sessions stay out of the switcher', JSON.stringify(listing.map((row) => row.title)))
  check(listing[0]?.title === '最新会话' && listing[0]?.running === true, 'the newest conversation comes first', JSON.stringify(listing[0]))
  check(listing[1]?.title === '只有标题', 'a bare title is still a switchable row', JSON.stringify(listing[1]))
  check(sessionsOf({}).length === 0, 'an empty session list renders no rows')
  // Archived conversations are still rows in the list, but not in the switcher.
  const withArchived = sessionsOf({
    ids: ['a', 'b', 'c'],
    byId: {
      a: { displayTitle: '活的', updatedAt: 30, cwd: '/w' },
      b: { displayTitle: '已归档', updatedAt: 20, cwd: '/w' },
      c: { displayTitle: '也归档', updatedAt: 10, cwd: '/w' },
    },
  }, new Set(['b', 'c']))
  check(withArchived.length === 1 && withArchived[0].title === '活的',
    'archived sessions stay out of the switcher', JSON.stringify(withArchived.map((row) => row.title)))

  // A prompt with an image carries it into the card.
  const pictureTranscript = new Function(`${grabSource('IDE_FLOAT_MESSAGES', '74-float.js')}\n${grabSource('ideFloatTextOf', '74-float.js')}\n${grabSource('ideFloatImagesOf', '74-float.js')}\n${grabSource('ideFloatTranscript', '74-float.js')}\nreturn ideFloatTranscript`)()
  const pictureLog = [
    { event: { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [
      { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 9, width: 2, height: 2 } },
      { type: 'text', text: '看这张图' },
    ] } } },
    { event: { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [
      { type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/jpeg' } },
    ] } } },
    { event: { type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'text', text: '收到' }] } } } },
  ]
  const pictureRows = pictureTranscript(pictureLog)
  check(pictureRows.length === 3, 'a picture prompt is still a row', String(pictureRows.length))
  check(pictureRows[0].images.length === 1 && pictureRows[0].images[0].attachmentId === 'att-1',
    'an image part keeps its attachment reference', JSON.stringify(pictureRows[0].images))
  check(pictureRows[0].text === '看这张图', 'the text beside an image is kept', pictureRows[0].text)
  check(pictureRows[1].text === '' && pictureRows[1].images.length === 1,
    'an image-only prompt has no text but keeps its picture', JSON.stringify(pictureRows[1]))
  check(pictureRows[2].images.length === 0, 'assistant rows carry no pictures')

  // Markdown: every construct the card claims to render.
  const markdownOf = new Function(`${grabSource('ideFloatSafeUrl', '74-float.js')}\n${grabSource('ideFloatTableCells', '74-float.js')}\n${grabSource('ideFloatTableAlign', '74-float.js')}\n${grabSource('ideFloatMarkdownBlocks', '74-float.js')}\nreturn ideFloatMarkdownBlocks`)()
  const tableSource = ['| 项 | 内容 | 右对齐 |', '| --- | :---: | ---: |', '| 分支 | `feature/v1.1-bill` | 3 |', '| 提交 | 6212b6e5 **feat** | 4 |'].join('\n')
  const tableBlock = markdownOf(tableSource)[0]
  check(tableBlock.type === 'table', 'a pipe table becomes a table', tableBlock.type)
  check(tableBlock.align.join(',') === ',center,right', 'alignment markers are kept', tableBlock.align.join(','))
  check(tableBlock.head.join('|') === '项|内容|右对齐', 'the header row is split', tableBlock.head.join('|'))
  check(tableBlock.rows.length === 2 && tableBlock.rows[1][2] === '4', 'body rows are split', JSON.stringify(tableBlock.rows))
  const escaped = markdownOf('| a | b |\n| --- | --- |\n| x \\| y | z |')[0]
  check(escaped.rows[0][0] === 'x \\| y', 'an escaped pipe stays in its cell', JSON.stringify(escaped.rows[0]))
  const taskBlock = markdownOf('- [ ] 未完成\n- [x] 已完成').at(0)
  check(taskBlock.items[0].task === false && taskBlock.items[1].task === true, 'task list markers are read', JSON.stringify(taskBlock.items))
  const nested = markdownOf('- 一级\n  - 二级\n    - 三级').at(0)
  check(nested.items.map((item) => item.depth).join(',') === '0,1,2', 'nested items keep their depth', JSON.stringify(nested.items.map((item) => item.depth)))
  const ordered = markdownOf('1. 甲\n2. 乙').at(0)
  check(ordered.type === 'ol' && ordered.items.length === 2, 'ordered lists stay ordered', ordered.type)
  const setext = markdownOf('标题\n===').at(0)
  check(setext.type === 'heading' && setext.level === 1, 'a setext underline makes a heading', JSON.stringify(setext))
  const quoteBlock = markdownOf('> 引用\n> 第二行').at(0)
  check(quoteBlock.type === 'quote' && quoteBlock.text === '引用\n第二行', 'a quote keeps its lines', JSON.stringify(quoteBlock))
  const hardBreak = markdownOf('第一行  \n第二行').at(0)
  check(hardBreak.text === '第一行\n第二行', 'two trailing spaces keep a line break', JSON.stringify(hardBreak.text))
  const softBreak = markdownOf('第一行\n第二行').at(0)
  check(softBreak.text === '第一行 第二行', 'a soft break becomes a space', JSON.stringify(softBreak.text))
  const fence = markdownOf('```java\nint a = 1;\n```').at(0)
  check(fence.type === 'code' && fence.lang === 'java' && fence.text === 'int a = 1;', 'a fence keeps its language', JSON.stringify(fence))
  const heading6 = markdownOf('###### 小标题').at(0)
  check(heading6.level === 6, 'a level 6 heading is recognised', JSON.stringify(heading6))
  check(markdownOf('---').at(0).type === 'hr', 'a rule is a rule')
  const paragraphInTable = markdownOf('| **a** | b |\n| --- | --- |')[0]
  check(paragraphInTable.head[0] === '**a**', 'inline markers inside a cell survive parsing', paragraphInTable.head[0])

  // Reasoning efforts come from the model's own catalog entry.
  const effortsOf = new Function(`${grabSource('ideFloatModelEfforts', '74-float.js')}\nreturn ideFloatModelEfforts`)()
  const catalog = {
    current: { provider: 'deepseek', model: 'v4-flash' },
    groups: [{ id: 'deepseek', models: [
      { id: 'v4-flash', name: 'Flash', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
      { id: 'plain', name: 'Plain' },
    ] }],
  }
  const efforts = effortsOf(catalog)
  check(efforts.length === 2 && efforts[1].label === 'High', 'the selected model lists its efforts', JSON.stringify(efforts))
  check(effortsOf({ current: { provider: 'deepseek', model: 'plain' }, groups: catalog.groups }).length === 0,
    'a model without reasoning metadata offers no efforts')
  check(effortsOf({ current: { provider: 'other', model: 'x' }, groups: catalog.groups }).length === 0,
    'a foreign provider offers no efforts')

  // Permission label and prompt parts: the two pieces the card composes itself.
  const permOf = new Function(`${grabSource('IDE_FLOAT_PERMISSIONS', '74-float.js')}\n${grabSource('ideFloatPermissionLabel', '74-float.js')}\nreturn ideFloatPermissionLabel`)()
  const label = (preset) => permOf(preset, (key) => key)
  check(label('read-only') === 'floatPermissionReadOnly', 'a known preset keeps its label key', label('read-only'))
  check(label('danger-full-access') === 'floatPermissionFull', 'the full-access preset is labelled', label('danger-full-access'))
  check(label('weird-mode') === 'weird-mode', 'an unknown preset is shown verbatim', label('weird-mode'))
  check(label('') === 'floatPermission', 'no preset yet falls back to the plain label', label(''))

  const presetOf = new Function(`${grabSource('ideFloatPermissionOf', '74-float.js')}\nreturn ideFloatPermissionOf`)()
  const presetLog = [
    { type: 'event', event: { type: 'permission/preset', seq: 1, data: { preset: 'workspace-write' } } },
    { type: 'event', event: { type: 'turn/start', seq: 2, data: {} } },
    { type: 'event', event: { type: 'permission/preset', seq: 3, data: { preset: 'danger-full-access' } } },
  ]
  check(presetOf(presetLog) === 'danger-full-access', 'the newest preset event wins', presetOf(presetLog))
  check(presetOf([]) === '', 'a log without a switch has no preset', presetOf([]))

  const partsOf = new Function(`${grabSource('ideFloatPromptParts', '74-float.js')}\nreturn ideFloatPromptParts`)()
  const parts = partsOf('看看这个', ['@a.md', '@b/c.java'], [{ mediaType: 'image/png', data: 'AAA', name: 'p.png' }])
  check(parts.length === 2 && parts[0].type === 'image' && parts[0].data === 'AAA', 'a pasted image becomes an image part', JSON.stringify(parts[0]))
  check(parts[1].type === 'text' && parts[1].text === '@a.md @b/c.java 看看这个', 'references lead the text', JSON.stringify(parts[1]))
  const refsOnly = partsOf('', ['@a.md'], [])
  check(refsOnly.length === 1 && refsOnly[0].text === '@a.md', 'references alone are still a prompt', JSON.stringify(refsOnly))
  check(partsOf('', [], []).length === 0, 'an empty composer sends nothing')

  // The switcher groups by workspace and opens on the current one.
  const groupsOf = new Function(`${grabSource('ideBasename', '10-core.js')}\n${grabSource('ideFloatSessionGroups', '74-float.js')}\nreturn ideFloatSessionGroups`)()
  const groups = groupsOf([
    { sessionId: 'a', title: '工作区B-旧', cwd: '/work/b', updatedAt: 10 },
    { sessionId: 'b', title: '工作区A-新', cwd: '/work/a', updatedAt: 40 },
    { sessionId: 'c', title: '工作区A-旧', cwd: '/work/a', updatedAt: 20 },
    { sessionId: 'd', title: '工作区B-新', cwd: '/work/b/', updatedAt: 30 },
  ], '/work/a')
  check(groups.length === 2, 'sessions group per workspace', JSON.stringify(groups.map((group) => group.title)))
  check(groups[0].current === true && groups[0].cwd === '/work/a', 'the current workspace comes first', JSON.stringify(groups[0].title))
  check(groups[0].sessions.length === 2, 'a trailing slash does not split a workspace', String(groups[0].sessions.length))
  check(groups[1].title === 'b' && groups[1].current === false, 'other workspaces follow', JSON.stringify(groups[1]))
  const noCwd = groupsOf([{ sessionId: 'x', title: '无目录', cwd: '', updatedAt: 1 }], '/work/a')
  check(noCwd.length === 1 && noCwd[0].current === false, 'a session without a workspace stays out of the current group')

  // The model menu is the composer's own catalog, flattened for a narrow card.
  const optionsOf = new Function(`${grabSource('ideFloatModelOptions', '74-float.js')}\nreturn ideFloatModelOptions`)()
  const models = optionsOf({ groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'v4-flash', name: 'V4 Flash', reasoning: { defaultEffort: 'max' } }] }] })
  check(models.length === 1 && models[0].provider === 'deepseek' && models[0].model === 'v4-flash',
    'the model menu lists provider models', JSON.stringify(models[0]))
  check(models[0]?.effort === 'max', 'the reasoning default travels with the option', String(models[0]?.effort))
  check(optionsOf({}).length === 0, 'an unloaded catalog renders no options')

  // Dragging: the shipped corner, a remembered point, and the viewport clamp.
  const pointOf = new Function(`${grabSource('ideClamp', '10-core.js')}\n${grabSource('ideFloatPoint', '74-float.js')}\nreturn ideFloatPoint`)()
  const corner = pointOf({ floatX: null, floatY: null }, 1200, 800, 340, 430)
  check(corner.left === 848 && corner.top === 358, 'an untouched card sits in the bottom-right corner', JSON.stringify(corner))
  const dragged = pointOf({ floatX: 40, floatY: 60 }, 1200, 800, 340, 430)
  check(dragged.left === 40 && dragged.top === 60, 'a dragged card keeps its point', JSON.stringify(dragged))
  const offscreen = pointOf({ floatX: -500, floatY: 5000 }, 1200, 800, 340, 430)
  check(offscreen.left === 12 && offscreen.top === 358, 'a point outside the viewport is pulled back in', JSON.stringify(offscreen))

  // The corner grip: shipped size, remembered size, and both directions of the cap.
  const sizeOf = new Function(`const IDE_FLOAT_DEFAULT_WIDTH = 460;\nconst IDE_FLOAT_DEFAULT_HEIGHT = 560;\nconst IDE_FLOAT_MIN_WIDTH = 280;\nconst IDE_FLOAT_MIN_HEIGHT = 220;\nconst IDE_FLOAT_MAX_WIDTH = 900;\nconst IDE_FLOAT_MAX_HEIGHT = 900;\n${grabSource('ideClamp', '10-core.js')}\n${grabSource('ideFloatSize', '74-float.js')}\nreturn ideFloatSize`)()
  const shipped = sizeOf({ floatWidth: null, floatHeight: null }, 1200, 800)
  check(shipped.width === 460 && shipped.height === 560, 'an untouched card has the shipped size', JSON.stringify(shipped))
  const resized = sizeOf({ floatWidth: 520, floatHeight: 360 }, 1200, 800)
  check(resized.width === 520 && resized.height === 360, 'a resized card keeps its size', JSON.stringify(resized))
  const tiny = sizeOf({ floatWidth: 40, floatHeight: 10 }, 1200, 800)
  check(tiny.width === 280 && tiny.height === 220, 'the card cannot shrink under its controls', JSON.stringify(tiny))
  const huge = sizeOf({ floatWidth: 9999, floatHeight: 9999 }, 1200, 800)
  check(huge.width === 1176 && huge.height === 776, 'the card cannot grow past the viewport', JSON.stringify(huge))

  // Each edge drags the side it names, and the opposite side stays put.
  const stepOf = new Function(`const IDE_FLOAT_DEFAULT_WIDTH = 460;\nconst IDE_FLOAT_DEFAULT_HEIGHT = 560;\nconst IDE_FLOAT_MIN_WIDTH = 280;\nconst IDE_FLOAT_MIN_HEIGHT = 220;\nconst IDE_FLOAT_MAX_WIDTH = 900;\nconst IDE_FLOAT_MAX_HEIGHT = 900;\n${grabSource('ideClamp', '10-core.js')}\n${grabSource('ideFloatResizeStep', '74-float.js')}\nreturn ideFloatResizeStep`)()
  const base = { left: 400, top: 300, width: 340, height: 430, x: 500, y: 400 }
  const east = stepOf(base, 'e', 560, 400, 1200, 800)
  check(east.width === 400 && east.left === 400, 'the east edge grows rightwards only', JSON.stringify(east))
  const west = stepOf(base, 'w', 440, 400, 1200, 800)
  check(west.width === 400 && west.left === 340, 'the west edge grows leftwards and moves the card', JSON.stringify(west))
  const south = stepOf(base, 's', 500, 430, 1200, 800)
  check(south.height === 460 && south.top === 300, 'the south edge grows downwards only', JSON.stringify(south))
  const north = stepOf(base, 'n', 500, 320, 1200, 800)
  check(north.height === 510 && north.top === 220, 'the north edge grows upwards and moves the card', JSON.stringify(north))
  const cornerStep = stepOf(base, 'se', 560, 470, 1200, 800)
  check(cornerStep.width === 400 && cornerStep.height === 500, 'the corner grows both ways', JSON.stringify(cornerStep))
  const floored = stepOf(base, 'w', 900, 400, 1200, 800)
  check(floored.width === 280 && floored.left === 460, 'a collapse stops at the minimum and keeps the right edge', JSON.stringify(floored))
}

// ---- conversation file cards open the workspace ----------------------------
{
  // 三种卡片都必须在捕获阶段被拦下，并且交付卡的“操作按钮”不能被顺手劫持。
  const source = readFileSync(new URL('../src/client/90-apply.js', import.meta.url), 'utf8')
  for (const [needle, label] of [
    ['[data-changed-files="true"] .vdszpW_row', 'a row of the multi-file card'],
    ['[data-changed-files="true"][data-single]', 'the single-file card'],
    ['[data-presented-file]', 'a delivered file card'],
  ]) {
    check(source.includes(needle), `${label} is claimed`, needle)
  }
  check(source.includes('clicked !== cardButton'), 'a delivered card\'s own action buttons keep their job')
  check(source.includes("addEventListener('click', onChangedFileClick, true)"), 'the claim runs in the capture phase')
}

// ---- mouse gestures -------------------------------------------------------
{
  const choices = grabSource('IDE_GESTURE_CHOICES', '05-shortcut-registry.js')
  const ring = grabSource('ideNextGesture', '59-gesture-settings.js')
  const next = new Function(`${choices}\n${ring}\nreturn ideNextGesture`)()
  check(next('double', 'meta') === 'alt', 'the gesture ring skips the one already taken', next('double', 'meta'))
  check(next('alt', 'double') === 'meta', 'the ring wraps around', next('alt', 'double'))

  const names = mode.record.registrations.map((entry) => entry.name)
  check(names.includes('settings.section'), 'registers its own settings section', names.join(','))
  const row = mode.record.registrations
    .filter((entry) => entry.name === 'settings.section')
    .find((entry) => String(entry.id ?? '') === 'dsh-ide-window')
  check(row !== undefined, 'the settings section is namespaced')
  check(typeof row?.label === 'function' || typeof row?.label === 'string', 'the section carries a nav label', String(row?.label))

  const injected = row?.inject?.() ?? {}
  const registry = new Function(`${grabSource('IDE_SHORTCUTS', '05-shortcut-registry.js')}\nreturn IDE_SHORTCUTS`)()
  check(injected.store?.getState().gestures.definition === 'double', 'double click goes to definition by default', JSON.stringify(injected.store?.getState().gestures))

  // The dropdown offers Ctrl+click on macOS and keeps gestures distinct.
  const gestureOfRow = new Function(`${sourceFunction('ideGestureOf', '30-code.js')}\nreturn ideGestureOf`)()
  check(gestureOfRow({ metaKey: true }) === 'meta', 'meta is its own gesture', gestureOfRow({ metaKey: true }))
  check(gestureOfRow({ ctrlKey: true }) === 'ctrl', 'ctrl is its own gesture', gestureOfRow({ ctrlKey: true }))
  check(gestureOfRow({ altKey: true }) === 'alt', 'alt is its own gesture', gestureOfRow({ altKey: true }))
  check(gestureOfRow({}) === 'plain', 'a plain click stays plain', gestureOfRow({}))
  const matches = new Function(`${sourceFunction('ideGestureMatches', '30-code.js')}\nreturn ideGestureMatches`)()
  check(matches('ctrl', 'ctrl', 'macos') === true, 'ctrl matches on macOS', String(matches('ctrl', 'ctrl', 'macos')))
  check(matches('meta', 'ctrl', 'macos') === false, 'meta does not swallow ctrl on macOS', String(matches('meta', 'ctrl', 'macos')))
  check(matches('meta', 'ctrl', 'windows') === true, 'meta means Ctrl off macOS', String(matches('meta', 'ctrl', 'windows')))
  check(injected.store?.setGesture('definition', 'ctrl') === true, 'definition can take Ctrl+click', JSON.stringify(injected.store?.getState().gestures))
  check(injected.store?.setGesture('usages', 'ctrl') === false, 'two actions cannot share a gesture', JSON.stringify(injected.store?.getState().gestures))
  injected.store?.setGesture('definition', 'double')

  // The call chain: a third, distinct gesture, and the tree helpers.
  check(new Function(`${grabSource('IDE_SHORTCUTS', '05-shortcut-registry.js')}\nreturn IDE_SHORTCUTS`)()
    .some((entry) => entry.kind === 'gesture' && entry.action === 'chain'), 'the call chain has its own gesture entry')
  check(injected.store?.getState().gestures.chain === 'alt', 'the call chain defaults to Alt+click', String(injected.store?.getState().gestures.chain))
  check(injected.store?.setGesture('definition', 'alt') === false, 'Alt belongs to the call chain', JSON.stringify(injected.store?.getState().gestures))
  check(injected.store?.setGesture('chain', 'ctrl') === true, 'the call chain can take another gesture', JSON.stringify(injected.store?.getState().gestures))
  injected.store?.setGesture('chain', 'alt')

  const chainSrc = [
    sourceFunction('ideDeclarations', '30-code.js'),
    sourceFunction('ideEnclosingDeclaration', '66-callchain.js'),
    sourceFunction('ideChainDeclaresAt', '66-callchain.js'),
    sourceFunction('ideChainCount', '66-callchain.js'),
    'return { ideEnclosingDeclaration, ideChainDeclaresAt, ideChainCount }',
  ].join('\n')
  const chain = new Function(chainSrc)()
  const chainLines = [
    'public class Demo extends Base {',
    '    private int a;',
    '',
    '    public void first() {',
    '        helper();',
    '    }',
    '',
    '    public void second() {',
    '        helper();',
    '    }',
    '}',
  ]
  check(chain.ideEnclosingDeclaration(chainLines, 9)?.name === 'second', 'the enclosing method is the one above the call', JSON.stringify(chain.ideEnclosingDeclaration(chainLines, 9)))
  check(chain.ideEnclosingDeclaration(chainLines, 1) === undefined, 'above every method there is no caller', JSON.stringify(chain.ideEnclosingDeclaration(chainLines, 1)))
  const contractNames = new Function(`${sourceFunction('ideContractNames', '66-callchain.js')}\nreturn ideContractNames`)()
  check(JSON.stringify(contractNames(['public class A implements X, Y {'])) === '["X","Y"]', 'an implements clause lists its contracts', JSON.stringify(contractNames(['public class A implements X, Y {'])))
  check(JSON.stringify(contractNames(['class B extends C implements D<E> {'])) === '["D"]', 'a generic contract keeps its simple name', JSON.stringify(contractNames(['class B extends C implements D<E> {'])))
  check(contractNames(['public interface I {']).length === 0, 'an interface itself implements nothing', JSON.stringify(contractNames(['public interface I {'])))
  check(chain.ideChainDeclaresAt(chainLines, 4) === true, 'a declaration line is recognised as a declaration', String(chain.ideChainDeclaresAt(chainLines, 4)))
  check(chain.ideChainDeclaresAt(chainLines, 5) === false, 'a call line is not a declaration', String(chain.ideChainDeclaresAt(chainLines, 5)))
  const chainTree = { name: 'root', children: [{ name: 'a', children: [] }, { name: 'b', children: [{ name: 'c', children: [] }] }] }
  check(chain.ideChainCount(chainTree) === 4, 'the tree counts every node', String(chain.ideChainCount(chainTree)))
  const invert = new Function(`${sourceFunction('ideChainInverted', '66-callchain.js')}\nreturn ideChainInverted`)()
  const callerTree = {
    name: 'generate',
    focus: true,
    children: [
      { name: 'regenerate', children: [] },
      { name: 'generateOneBill', children: [{ name: 'generateAndPickBill', children: [] }] },
    ],
  }
  const forest = invert(callerTree)
  check(forest.length === 2, 'every entry caller starts a branch', JSON.stringify(forest.map((entry) => entry.name)))
  check(forest[0].name === 'regenerate' && forest[0].children[0]?.name === 'generate', 'a caller sits above the method it calls', JSON.stringify(forest[0].name))
  check(forest[1].children[0]?.children[0]?.name === 'generate', 'the clicked method ends every branch', JSON.stringify(forest[1]))
  check(forest[1].children[0]?.children[0]?.focus === true, 'the clicked method is the highlighted one', JSON.stringify(forest[1].children[0]?.children[0]))
  check(forest[0].children[0]?.children.length === 0, 'the clicked method has no caller below it', JSON.stringify(forest[0].children[0]?.children))

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
  check(injected.store?.setGesture('definition', 'ctrl') === true, 'a free gesture is accepted')
  check(injected.store?.getState().gestures.definition === 'ctrl', 'the accepted gesture is stored', injected.store?.getState().gestures.definition)
  check(injected.store?.setGesture('definition', 'double') === true, 'it can be put back')

  const gestureOf = new Function(`${grabSource('ideGestureOf', '30-code.js')}\nreturn ideGestureOf`)()
  check(gestureOf({ metaKey: true }) === 'meta', '⌘ maps to the meta gesture')
  check(gestureOf({ ctrlKey: true }) === 'ctrl', 'Ctrl is its own physical gesture')
  check(gestureOf({ altKey: true }) === 'alt', '⌥ maps to the alt gesture')
  check(gestureOf({}) === 'plain', 'a bare click is plain')
}



// ---- shortcuts are the plugin's own -----------------------------------------
{
  // 一条也不注册进 DSH 的目录：DSH 的「编辑快捷键」弹窗里不应出现本插件
  check(mode.record.shortcuts.length === 0, 'no shortcut reaches DSH\'s catalog', String(mode.record.shortcuts.length))

  const names = mode.record.registrations.map((entry) => entry.name)
  check(names.includes('settings.section'), 'the shortcuts live in the plugin\'s own settings section', names.join(','))
  const row = mode.record.registrations
    .filter((entry) => entry.name === 'settings.section')
    .find((entry) => String(entry.id ?? '') === 'dsh-ide-window')
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

// ---- textual caller classification -----------------------------------------
{
  const api = new Function([
    sourceFunction('ideRegexEscape', '65-lsp.js'),
    sourceFunction('ideTextualIsDeclaration', '65-lsp.js'),
    sourceFunction('ideTextualIsCall', '65-lsp.js'),
    sourceFunction('ideTextualIsReceiverCall', '65-lsp.js'),
  ].join('\n') + '\nreturn { ideTextualIsDeclaration, ideTextualIsCall, ideTextualIsReceiverCall }')()

  const chainOf = new Function(`${sourceFunction('ideReceiverChain', '65-lsp.js')}\nreturn ideReceiverChain`)()
  const enumCall = '    Assert.isTrue(PurchaseOrderStatusEnum.TO_PURCHASE.matches(status), "x");'
  check(chainOf([enumCall], 0, enumCall.indexOf('matches')) === 'PurchaseOrderStatusEnum.TO_PURCHASE',
    'a dotted receiver keeps every segment', chainOf([enumCall], 0, enumCall.indexOf('matches')))
  const broken = ['    list = paymentRecordOrderRelationRepository', '        .listByPaymentTradeNos(set).stream()']
  check(chainOf(broken, 1, broken[1].indexOf('listByPaymentTradeNos')) === 'paymentRecordOrderRelationRepository',
    'a broken chain takes the receiver from the line above', chainOf(broken, 1, broken[1].indexOf('listByPaymentTradeNos')))

  const declaration = '    ReconFundDocDetailResp detail(Long docId);'
  check(api.ideTextualIsDeclaration(declaration, 'detail') === true, 'an interface method declaration is not a call', declaration)
  check(api.ideTextualIsCall(declaration, 'detail') === false, 'a declaration is excluded from callers', String(api.ideTextualIsCall(declaration, 'detail')))

  const receiverCall = '        ReconFundDocStatisticsResp resp = reconFundDocQueryService.statistics(query);'
  check(api.ideTextualIsCall(receiverCall, 'statistics') === true, 'a receiver call counts as a caller', receiverCall)
  check(api.ideTextualIsReceiverCall(receiverCall, 'statistics') === true, 'a receiver call names its receiver', String(api.ideTextualIsReceiverCall(receiverCall, 'statistics')))

  const bareCall = '        ReconFundDocDetailResp resp = detail(bill(BillTypeEnum.SUPPLIER, "1"),'
  check(api.ideTextualIsCall(bareCall, 'detail') === true && api.ideTextualIsReceiverCall(bareCall, 'detail') === false,
    'a bare helper call has no receiver', String(api.ideTextualIsReceiverCall(bareCall, 'detail')))

  const getDetail = '        return DataResponse.ok(orderClearingService.getDetail(clearingRecordId));'
  check(api.ideTextualIsCall(getDetail, 'detail') === false, 'getDetail is not a call of detail', String(api.ideTextualIsCall(getDetail, 'detail')))
  check(api.ideTextualIsCall(getDetail, 'getDetail') === true && api.ideTextualIsReceiverCall(getDetail, 'getDetail') === true,
    'getDetail is its own call', getDetail)
}

// ---- definition text fallback ----------------------------------------------
{
  const isDeclaration = new Function(`${sourceFunction('ideIsMethodDeclaration', '30-code.js')}\nreturn ideIsMethodDeclaration`)()
  check(isDeclaration('    OrderClearingDetailResp getDetail(Long clearingRecordId);', 'getDetail') === true, 'an interface method reads as a declaration', String(isDeclaration('    OrderClearingDetailResp getDetail(Long clearingRecordId);', 'getDetail')))
  check(isDeclaration('    public DataResponse<OrderClearingDetailResp> getDetail(@PathVariable Long id) {', 'getDetail') === true, 'an annotated public method reads as a declaration', String(isDeclaration('    public DataResponse<OrderClearingDetailResp> getDetail(@PathVariable Long id) {', 'getDetail')))
  check(isDeclaration('        return DataResponse.ok(orderClearingService.getDetail(clearingRecordId));', 'getDetail') === false, 'a call is not a declaration', String(isDeclaration('        return DataResponse.ok(orderClearingService.getDetail(clearingRecordId));', 'getDetail')))
  check(isDeclaration('    private final OrderClearingService orderClearingService;', 'getDetail') === false, 'a field is not a declaration', String(isDeclaration('    private final OrderClearingService orderClearingService;', 'getDetail')))
  // 本类里的裸调用：前面只有缩进，不是声明（否则双击会被当成「当前位置就是定义」）。
  check(isDeclaration('        fillJobOperatorIfAbsent();', 'fillJobOperatorIfAbsent') === false,
    'a bare same-class call is not a declaration', String(isDeclaration('        fillJobOperatorIfAbsent();', 'fillJobOperatorIfAbsent')))
  check(isDeclaration('    private void fillJobOperatorIfAbsent() {', 'fillJobOperatorIfAbsent') === true,
    'its declaration still reads as one', String(isDeclaration('    private void fillJobOperatorIfAbsent() {', 'fillJobOperatorIfAbsent')))
  check(isDeclaration('        Map<String, List<X>> build(Map<String, X> input) {', 'build') === true,
    'a generic return type is still a declaration', String(isDeclaration('        Map<String, List<X>> build(Map<String, X> input) {', 'build')))
  check(isDeclaration('        page = service.detail(id);', 'detail') === false,
    'an assignment is not a declaration', String(isDeclaration('        page = service.detail(id);', 'detail')))
}

// ---- tree VCS colouring ----------------------------------------------------
{
  const vcs = new Function(`${sourceFunction('ideVcsClass', '20-tree.js')}\nreturn ideVcsClass`)()
  check(vcs('??') === 'vcs-added', 'an untracked file reads as new', vcs('??'))
  check(vcs('A ') === 'vcs-added', 'a staged addition reads as new', vcs('A '))
  check(vcs('AM') === 'vcs-added', 'an added-then-modified file still reads as new', vcs('AM'))
  check(vcs(' M') === 'vcs-modified', 'a modified file reads as changed', vcs(' M'))
  check(vcs('R ') === 'vcs-modified', 'a rename reads as changed', vcs('R '))
  check(vcs('') === '', 'a clean file carries no colour', vcs(''))
}

// ---- tree ordering ---------------------------------------------------------
{
  const order = new Function(`${sourceFunction('ideTreeOrder', '20-tree.js')}\nreturn ideTreeOrder`)()
  const entries = [
    { name: 'pom.xml', type: 'file' },
    { name: 'src', type: 'directory' },
    { name: 'AGENTS.md', type: 'file' },
    { name: 'docs', type: 'directory' },
    { name: 'client.js', type: 'file' },
  ]
  const names = entries.slice().sort(order).map((entry) => entry.name)
  check(names.join(',') === 'docs,src,AGENTS.md,client.js,pom.xml', 'folders sort before files, each group by name', names.join(','))
  const caseFold = [{ name: 'b.js', type: 'file' }, { name: 'A.js', type: 'file' }].sort(order).map((entry) => entry.name)
  check(caseFold.join(',') === 'A.js,b.js', 'names sort case-insensitively', caseFold.join(','))
  const numeric = [{ name: 'file10.txt', type: 'file' }, { name: 'file2.txt', type: 'file' }].sort(order).map((entry) => entry.name)
  check(numeric.join(',') === 'file2.txt,file10.txt', 'numbers sort naturally', numeric.join(','))
}

store.dispose()
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

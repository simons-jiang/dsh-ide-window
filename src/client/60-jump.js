/**
 * Reference interception: a file address opened anywhere in the shell becomes a
 * jump in the code workspace.
 *
 * DSH resolves `dsh-resource://file/…` addresses with a ranked type registry
 * (VS Code's editor-resolver model): a whitelist glob narrows the candidates, a
 * veto predicate removes the rest, and survivors rank by priority band. A type
 * shipped outside the product declares the `extension` band, which outranks every
 * viewer shipped here — so claiming the address and forwarding it is a supported
 * mechanism, not a hack.
 *
 * Two deliberate limits keep the blast radius small:
 *
 *  - the type claims nothing until the workspace panel has been opened once in
 *    this page, so a user who never uses it keeps the shipped preview everywhere;
 *  - `canOpen` vetoes anything that is not text, so images, PDFs and Office
 *    files keep their own viewers.
 */

/** Identity of the claiming type, and the `sidebar.right.pane.tab` key of its body. */
const IDE_FILE_TYPE_ID = 'dsh-ide-window:file'

/** The band this type declares; `extension` is the highest. */
const IDE_FILE_KIND = 'dsh-ide-window-file'

/** Extensions that are never text, even though a viewer may exist for them. */
const IDE_BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'pdf', 'zip', 'gz', 'tar', 'tgz',
  'jar', 'war', 'class', 'so', 'dylib', 'dll', 'exe', 'bin', 'mp3', 'mp4', 'mov', 'wav', 'woff',
  'woff2', 'ttf', 'otf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'db', 'sqlite', 'lock',
])

/**
 * Extensions this panel must NOT claim.
 *
 * The shipped viewers render markdown, html, csv and plain text better than a
 * source view can — rendered prose, tables, syntax-highlighted previews — so
 * those stay where they are, as do every binary and Office format. Claiming
 * them would make the app worse, which is the one thing an interceptor must
 * never do.
 */
const IDE_VETO_EXT = new Set([
  'md', 'markdown', 'mdx', 'html', 'htm', 'csv', 'tsv', 'txt', 'log', 'rst', 'adoc',
])

/** Extension-less names worth claiming as text. */
const IDE_TEXT_NAMES = new Set([
  'makefile', 'dockerfile', 'rakefile', 'gemfile', 'procfile', 'license', 'licence', 'notice',
  'readme', 'changelog', 'authors', 'contributors', 'codeowners', 'jenkinsfile', 'vagrantfile',
])

/** Decode one address segment, tolerating an encoding the sender did not apply. */
function ideDecodeSegment(segment) {
  try {
    return decodeURIComponent(segment)
  } catch (error) {
    void error
    return segment
  }
}

/**
 * Read a `dsh-resource://file/…` address into its parts.
 *
 * Grammar (see the shipped `file-address` module): `…/file/session/<sessionId>/<path>`
 * names a file through one Session — the path is workspace-relative or absolute
 * — and `…/file/absolute/<path>` names it by absolute path with the leading `/`
 * dropped.
 *
 * @returns `{ scope, sessionId, path }`, or `undefined` for anything else.
 */
function ideParseFileAddress(address) {
  const prefix = 'dsh-resource://file/'
  if (typeof address !== 'string' || !address.startsWith(prefix)) return undefined
  const end = address.search(/[?#]/)
  const body = address.slice(prefix.length, end === -1 ? undefined : end)
  const segments = body.split('/').map(ideDecodeSegment)
  const scope = segments[0]
  if (scope === 'absolute') {
    const path = segments.slice(1).join('/')
    return path === '' ? undefined : { scope: 'absolute', sessionId: '', path: `/${path}` }
  }
  if (scope === 'session') {
    const sessionId = segments[1]
    if (sessionId === undefined || sessionId === '') return undefined
    return { scope: 'session', sessionId, path: segments.slice(2).join('/') }
  }
  return undefined
}

/** Whether the address names a file this panel can display as source. */
function ideIsTextAddress(address) {
  const parsed = ideParseFileAddress(address)
  if (parsed === undefined || parsed.path === '') return false
  const name = ideBasename(parsed.path)
  if (name === '') return false
  const dot = name.lastIndexOf('.')
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
  if (IDE_BINARY_EXT.has(ext) || IDE_VETO_EXT.has(ext)) return false
  if (ext !== '') return ideLangOf(name) !== ''
  return IDE_TEXT_NAMES.has(name.toLowerCase())
}

/**
 * The claiming tab body.
 *
 * It draws nothing: the tab exists only for the address it was opened with, so
 * the effect forwards that address to the workspace and the tab is closed again.
 */
function IdeFileJump(props) {
  const readInfo = typeof props?.useTabInfo === 'function'
    ? props.useTabInfo
    : (typeof props?.tabInfo === 'function' ? props.tabInfo : () => undefined)
  const info = readInfo()
  const navigation = info?.tab?.navigation
  const address = typeof navigation?.address === 'string' ? navigation.address : undefined
  const revision = typeof navigation?.revision === 'number' ? navigation.revision : 0
  const tabId = info?.tab?.id
  const jump = props?.jump

  useEffect(() => {
    if (address === undefined || typeof jump !== 'function') return
    jump(tabId, address, navigation?.params)
  }, [address, revision, tabId, jump, navigation])

  return null
}

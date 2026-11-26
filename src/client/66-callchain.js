/*
 * The call chain of one method, as a tree.
 *
 * LSP answers "who references this symbol"; walking that answer upward — and
 * resolving each call site to the method that contains it — is what produces the
 * chain from an entry point down to the clicked method. Every node carries the
 * location of its declaration, so a click in the popup is an ordinary jump.
 *
 * The walk has no depth limit: it keeps climbing level by level until a level
 * finds no caller at all. A branch stops early only for recursion — a caller
 * that already sits on the same path — so "the chain ends here" means the
 * entry point really was reached. The two limits below bound rows, not hops.
 */

const IDE_CHAIN_NODES = 160
const IDE_CHAIN_CHILDREN = 6

/** The last declaration strictly above `line` (1-based) in one file. */
function ideEnclosingDeclaration(lines, line) {
  const declarations = ideDeclarations(lines, 0, Math.max(0, line - 1))
  return declarations.length === 0 ? undefined : declarations[declarations.length - 1]
}

/** Interface simple names one class declaration implements. */
function ideContractNames(lines) {
  for (const line of lines) {
    const at = line.indexOf('implements')
    if (at < 0 || !/\b(?:class|enum|record)\b/.test(line)) continue
    const tail = line.slice(at + 'implements'.length)
    const cut = tail.indexOf('{')
    return tail.slice(0, cut < 0 ? tail.length : cut)
      .split(',')
      .map((part) => part.trim().split(/[<.\s]/)[0])
      .filter((part) => part !== '')
  }
  return []
}

/** Interface simple name → the workspace files that declare it. */
const ideInterfacePaths = new Map()

/** Resolve one interface's declaration files (a name is unique in a workspace). */
async function ideInterfacePathsOf(root, name) {
  let pending = ideInterfacePaths.get(name)
  if (pending === undefined) {
    pending = ideGrepQuery(root, `\\binterface\\s+${name}\\b`, { extensions: IDE_CODE_EXTENSIONS, caseSensitive: true })
      .then((answer) => (answer.ok === true ? answer.matches : []))
      .catch(() => [])
    ideInterfacePaths.set(name, pending)
  }
  const matches = await pending
  return matches.filter((match) => typeof match?.path === 'string').map((match) => match.path)
}

/**
 * Call sites that reach a method through its contract.
 *
 * A caller holding the interface type (`ReconBillGenerateService service;`)
 * resolves to the interface declaration; the implementation's own references
 * never mention it. Reading the `implements` clause, finding the same method in
 * the interface and asking *there* is what reunites the two halves.
 *
 * @returns `{ path, line }[]`, empty when the class overrides no such method.
 */
async function ideContractReferences(store, path, lines, name) {
  const root = store.getState().rootPath
  if (root === '' || typeof name !== 'string' || name === '') return []
  const contracts = ideContractNames(lines)
  if (contracts.length === 0) return []
  const found = []
  for (const contractName of contracts) {
    for (const contractPath of await ideInterfacePathsOf(root, contractName)) {
      const contractLines = await store.readLines(contractPath)
      const declaration = ideDeclarations(contractLines, 0, contractLines.length)
        .find((entry) => entry.name === name)
      if (declaration === undefined) continue
      const answer = await ideLspQuery({
        operation: 'findReferences',
        filePath: ideAbs(root, contractPath),
        workspaceRoot: root,
        position: { line: declaration.index, character: declaration.column },
      }).catch(() => undefined)
      if (Array.isArray(answer?.locations)) found.push(...answer.locations)
    }
  }
  return found
}

/** Whether a reference line declares a method instead of calling one. */
function ideChainDeclaresAt(lines, line) {
  return ideDeclarations(lines, line - 1, line).length > 0
}

/**
 * Index of the `(` that opens `name(...)` on one line, or `-1`.
 *
 * `indexOf(name)` alone is not enough: the receiver may contain the name
 * (`generateService.generate(`) and a name that is a prefix of another
 * identifier would point at the wrong place.
 */
function ideChainParenAt(text, name) {
  const line = String(text ?? '')
  let from = 0
  while (from < line.length) {
    const at = line.indexOf(name, from)
    if (at < 0) return -1
    const before = at === 0 ? '' : line[at - 1]
    const rest = line.slice(at + name.length)
    const indent = rest.length - rest.trimStart().length
    if (!/[\w$]/.test(before) && rest[indent] === '(') return at + name.length + indent
    from = at + name.length
  }
  return -1
}

/**
 * How many arguments (or parameters) sit inside the `(...)` that starts at
 * `line`/`column`.
 *
 * `-1` means "could not read it with confidence" — the list never closes inside
 * a 200-line window, or it holds a comma whose nesting is ambiguous (`<>`,
 * `{}`, a comment). Callers must treat that as unknown, never as zero: the
 * count is what tells overloads apart, and a wrong number would drop a real
 * call edge.
 */
function ideChainArity(lines, line, column) {
  let depth = 0
  let commas = 0
  let content = false
  let started = false
  for (let index = Math.max(0, line); index < lines.length && index <= line + 200; index += 1) {
    const text = String(lines[index] ?? '')
    for (let at = index === line ? Math.max(0, column) : 0; at < text.length; at += 1) {
      const char = text[at]
      if (char === '"' || char === "'") {
        const quote = char
        at += 1
        while (at < text.length && text[at] !== quote) {
          if (text[at] === '\\') at += 1
          at += 1
        }
        if (started && depth === 1) content = true
        continue
      }
      if (char === '/' && (text[at + 1] === '/' || text[at + 1] === '*')) return -1
      if (char === '<' || char === '>' || char === '{' || char === '}') {
        if (started) return -1
        continue
      }
      if (char === '(') {
        depth += 1
        started = true
        continue
      }
      if (char === ')') {
        if (depth === 0) return -1
        depth -= 1
        if (depth === 0 && started) return content ? commas + 1 : 0
        continue
      }
      if (!started || depth !== 1) continue
      if (char === ',') {
        commas += 1
        content = true
        continue
      }
      if (char !== ' ' && char !== '\t') content = true
    }
  }
  return -1
}

/**
 * Turn the caller tree into the tree the popup shows.
 *
 * The caller tree points down at callers; people read a chain the other way —
 * the entry on top, the clicked method at the bottom, every arrow going
 * "this one calls the one below it". Each entry-to-target path becomes its own
 * branch, so a method reached from two places is drawn twice instead of once.
 */
function ideChainInverted(tree) {
  const parentOf = new Map()
  const leaves = []
  const walk = (node) => {
    if (node.children.length === 0) leaves.push(node)
    for (const child of node.children) {
      parentOf.set(child, node)
      walk(child)
    }
  }
  walk(tree)
  const build = (node) => ({
    name: node.name,
    path: node.path,
    line: node.line,
    callSite: node.callSite,
    focus: node.focus === true,
    recursive: node.recursive === true,
    children: parentOf.has(node) ? [build(parentOf.get(node))] : [],
  })
  return leaves.map(build)
}

/** How many methods one tree holds. */
function ideChainCount(node) {
  if (node === undefined || node === null) return 0
  return 1 + node.children.reduce((sum, child) => sum + ideChainCount(child), 0)
}

/**
 * Build the caller tree of one method.
 *
 * @param store - the workspace store; it reads the files that are not open.
 * @param root - `{ name, path, line, position }`, the clicked method.
 * @param options.onPartial - called with the tree after each level, so the
 *   popup can paint what is known instead of waiting for the deepest caller.
 * @returns the tree, filled in.
 */
async function ideCallChain(store, root, options = {}) {
  // Which declarations already sit on the path from the clicked method to this
  // node. Recursion is the only natural stop, and it has to be per path: a
  // method reached through two routes is drawn on both.
  const tree = {
    ...root,
    focus: true,
    children: [],
    chainKeys: new Set([`${root.path}:${root.line}`]),
    childKeys: new Set(),
  }
  const files = new Map()
  const linesOf = (path) => {
    let pending = files.get(path)
    if (pending === undefined) {
      pending = Promise.resolve(store.readLines(path)).then((lines) => (Array.isArray(lines) ? lines : []))
      files.set(path, pending)
    }
    return pending
  }
  const declarationsByFile = new Map()
  const declarationsOf = (path) => {
    let pending = declarationsByFile.get(path)
    if (pending === undefined) {
      pending = linesOf(path).then((lines) => ideDeclarations(lines, 0, lines.length))
      declarationsByFile.set(path, pending)
    }
    return pending
  }
  /**
   * Whether a call site belongs to a different declaration of the same name.
   *
   * `findReferences` may answer with the whole overload group, and the text
   * fallback cannot tell two overloads apart at all — both hand a 4-argument
   * call to the 5-parameter method. Arity is the one thing a call site states
   * about itself, so it decides; when either side cannot be read the call is
   * kept, because a missing caller is worse than a doubtful one.
   */
  const belongsToAnotherOverload = async (node, location) => {
    const callerLines = await linesOf(location.path)
    const open = ideChainParenAt(callerLines[location.line - 1], node.name)
    if (open < 0) return false
    const overloads = (await declarationsOf(node.path)).filter((entry) => entry.name === node.name)
    if (overloads.length < 2) return false
    const args = ideChainArity(callerLines, location.line - 1, open)
    const params = ideChainArity(await linesOf(node.path), node.position.line, node.position.character)
    return args >= 0 && params >= 0 && args !== params
  }
  /**
   * The method containing a call site, or nothing when it sits outside one.
   *
   * `findReferences` also answers with the symbol's own declaration (and, for a
   * contract, the declarations of its overrides). Those lines declare a method
   * instead of calling one, so they are not call sites and must not become a
   * caller — reading one as "the previous method calls it" is what made every
   * arrow point at the parent's own signature line.
   */
  const callerAt = async (path, line) => {
    const lines = await linesOf(path)
    if (ideChainDeclaresAt(lines, line)) return 'declaration'
    const declaration = ideEnclosingDeclaration(lines, line)
    if (declaration === undefined) return undefined
    return {
      name: declaration.name,
      line: declaration.index + 1,
      position: { line: declaration.index, character: declaration.column },
    }
  }

  // The engine may be down (or its project model incomplete). A chain that
  // silently answers "no callers" in that state is worse than a text-matched
  // one, so a level with no semantic references falls back to the same
  // receiver-checked text search the usages popup uses.
  let textual = false
  let failure = ''
  const textualCallersOf = async (node) => {
    const lines = await linesOf(node.path)
    const lineText = String(lines[node.position.line] ?? '')
    const afterName = lineText.slice(node.position.character + String(node.name ?? '').length)
    if (!afterName.trimStart().startsWith('(')) return []
    const ownerNames = [ideClassName(node.path), ...ideContractNames(lines)].filter((name) => name !== '')
    const rows = await ideTextualCallers(store, node.path, node.position, node.name, IDE_CHAIN_CHILDREN, {
      requireReceiver: !/\bstatic\b/.test(lineText),
      ownerNames,
    }).catch(() => [])
    if (rows.length === 0) return []
    textual = true
    return rows.map((row) => ({ path: row.path, line: row.line }))
  }

  let level = [tree]
  let count = 1
  let truncated = false
  while (level.length > 0) {
    if (count >= IDE_CHAIN_NODES) {
      truncated = true
      break
    }
    const next = []
    /** Turn caller locations into child nodes; returns how many were added. */
    const attach = async (node, list) => {
      let added = 0
      for (const location of list) {
        if (count >= IDE_CHAIN_NODES) {
          truncated = true
          break
        }
        if (typeof location?.path !== 'string' || typeof location?.line !== 'number') continue
        // The declaration of the method we are walking is not a call to it.
        if (location.path === node.path && location.line === node.line) continue
        const caller = await callerAt(location.path, location.line)
        if (caller === 'declaration') continue
        // A call site outside any method (a field initialiser, a static block):
        // the line itself is the node, so the chain never loses that caller.
        const target = caller ?? {
          name: ideBasename(location.path),
          line: location.line,
          position: { line: location.line - 1, character: 0 },
        }
        const key = `${location.path}:${target.line}`
        if (node.childKeys.has(key)) continue
        // A call site names its method by name alone, so it can land under the
        // wrong overload — the same line then shows up in two branches.
        if (await belongsToAnotherOverload(node, location)) continue
        // Checked after the filters, so the flag means a real caller was left
        // out — a seventh declaration on the line is not "more callers".
        if (added >= IDE_CHAIN_CHILDREN) {
          truncated = true
          break
        }
        node.childKeys.add(key)
        count += 1
        added += 1
        if (node.chainKeys.has(key)) {
          // The caller is already on this path: recursion, the one case where a
          // branch stops while callers still exist.
          node.children.push({
            ...target,
            path: location.path,
            callSite: { path: location.path, line: location.line },
            recursive: true,
            children: [],
          })
          continue
        }
        const child = {
          ...target,
          path: location.path,
          callSite: { path: location.path, line: location.line },
          children: [],
          chainKeys: new Set([...node.chainKeys, key]),
          childKeys: new Set(),
        }
        node.children.push(child)
        next.push(child)
      }
      return added
    }
    for (const node of level) {
      const [answer, contract] = await Promise.all([
        ideLspQuery(ideLspPayload(store, 'findReferences', node.path, node.position)).catch((error) => {
          if (failure === '') {
            failure = ideLspFailureText({
              operation: 'findReferences',
              code: typeof error?.code === 'string' ? error.code : 'lsp-failed',
              detail: String(error?.detail ?? '').slice(0, 160),
            })
          }
          return undefined
        }),
        ideContractReferences(store, node.path, await linesOf(node.path), node.name),
      ])
      const semantic = [...(Array.isArray(answer?.locations) ? answer.locations : []), ...contract]
      let locationList = semantic
      // `textualCallersOf` flags the tree itself when it actually finds rows.
      if (semantic.length === 0) locationList = await textualCallersOf(node)
      let added = await attach(node, locationList)
      // `findReferences` answers with declarations too (the interface's own
      // signature, the override being walked). When nothing but declarations
      // came back, the semantic answer cannot show a single caller — text
      // matching is the honest answer, not "this is the entry point".
      if (added === 0 && semantic.length > 0) {
        const textualRows = await textualCallersOf(node)
        if (textualRows.length > 0) {
          textual = true
          added = await attach(node, textualRows)
        }
      }
    }
    level = next
    options.onPartial?.(tree)
  }
  tree.textual = textual
  tree.failed = textual ? '' : failure
  tree.truncated = truncated
  return tree
}

/** `ReconBillQueryServiceImpl:339` — the file without its directory or extension. */
function ideChainFileOf(path) {
  const name = ideBasename(path)
  return name.endsWith('.java') ? name.slice(0, -'.java'.length) : name
}

/**
 * Branch order for the popup: by the caller's file name, so every branch that
 * starts in one file sits together. A same-name tie falls back to the whole
 * path and then the line, which keeps the list stable while it is being filled
 * in level by level.
 *
 * Plain code-unit comparison, not `localeCompare`: the order must not depend on
 * the machine's locale (and the same list has to be checked by the tests).
 */
function ideChainCompareBranches(a, b) {
  const compare = (left, right) => (left < right ? -1 : (left > right ? 1 : 0))
  const byFile = compare(ideChainFileOf(a?.path ?? '').toLowerCase(), ideChainFileOf(b?.path ?? '').toLowerCase())
  if (byFile !== 0) return byFile
  const byPath = compare(String(a?.path ?? ''), String(b?.path ?? ''))
  if (byPath !== 0) return byPath
  return (Number(a?.line) || 0) - (Number(b?.line) || 0)
}

/** The rows one branch would draw, as a single comparable string. */
function ideChainSignature(node) {
  const site = node.callSite === undefined ? '' : node.callSite.line
  return `${node.path}:${node.line}@${site}/${node.children.map(ideChainSignature).join(',')}`
}

/** One row per distinct chain: two walks that draw the same rows are noise. */
function ideChainDistinct(forest) {
  const seen = new Set()
  const out = []
  for (const entry of forest) {
    const key = ideChainSignature(entry)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/** One node card plus its children, joined by rounded elbows. */
function IdeChainNode({ node, depth, onPick, tr }) {
  const where = `${ideChainFileOf(node.path)}:${node.line}`
  return h('div', { className: 'iw-chain-node' }, [
    h('button', {
      key: 'row',
      type: 'button',
      className: `iw-chain-row${node.focus === true ? ' root' : ''}`,
      title: `${node.path}:${node.line}`,
      onClick: () => onPick(node.path, node.line),
    }, [
      h('span', { key: 'dot', className: 'iw-chain-dot' }),
      h('span', { key: 'n', className: 'iw-chain-name' }, node.name),
      h('span', { key: 'p', className: 'iw-chain-where' }, where),
      node.recursive === true
        ? h('span', { key: 'r', className: 'iw-chain-recursive' }, tr('chainRecursive'))
        : null,
      node.callSite === undefined
        ? null
        : h('span', { key: 's', className: 'iw-chain-site', title: `${node.callSite.path}:${node.callSite.line}` }, `← :${node.callSite.line}`),
    ]),
    node.children.length === 0
      ? null
      : h('div', { key: 'children', className: 'iw-chain-children' }, node.children.map((child) => h(IdeChainNode, {
        key: `${child.path}:${child.line}`,
        node: child,
        depth: depth + 1,
        onPick,
        tr,
      }))),
  ])
}

/** Width of the call-chain popup, matching `.iw-pop-chain` in the stylesheet. */
const IDE_CHAIN_POPUP_WIDTH = 600

/** The popup: one tree, one row per method; clicking a row jumps to it. */
function IdeChainPopup({ popup, tr, onPick, onClose }) {
  // Same clipping trap as the usage popup: `position: fixed` inside the panel is
  // cut by the panel's edges, so the placement helper clamps and flips it.
  const placement = useMenuPlacement(popup.x, popup.y, IDE_CHAIN_POPUP_WIDTH)
  const ref = placement.ref
  // The popup owns the keyboard while it is open: capture-phase, so no other
  // handler has to be focused for Esc to close it.
  useEffect(() => {
    if (ref.current !== null && typeof ref.current.focus === 'function') ref.current.focus()
  }, [])
  useEffect(() => {
    const onDown = (event) => {
      const element = event.target
      if (element instanceof Element && element.closest('.iw-pop') !== null) return
      onClose()
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    globalThis.addEventListener('pointerdown', onDown, true)
    globalThis.addEventListener('keydown', onKey, true)
    return () => {
      globalThis.removeEventListener('pointerdown', onDown, true)
      globalThis.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const root = popup.tree
  const count = ideChainCount(root)
  const status = popup.state === 'loading'
    ? tr('chainLoading')
    : `${count}${typeof popup.ms === 'number' ? ` · ${popup.ms}ms` : ''}`
  const forest = root === undefined ? [] : ideChainDistinct(ideChainInverted(root).sort(ideChainCompareBranches))
  const notes = []
  if (root !== undefined) {
    if (typeof root.failed === 'string' && root.failed.startsWith('license:')) notes.push(tr('lspLicense'))
    else if (root.textual === true || root.failed) notes.push(tr('chainTextual'))
    if (root.truncated === true) notes.push(tr('chainTruncated'))
  }
  const note = notes.join(' · ')
  const body = h(React.Fragment, null, [
    h('div', { key: 'rule', className: 'iw-chain-rule' }, tr('chainRule')),
    note === '' ? null : h('div', { key: 'note', className: 'iw-chain-note' }, note),
    root === undefined || (count <= 1 && popup.state === 'ready')
      ? h('div', { key: 'empty', className: 'iw-hint' }, popup.empty ?? tr('chainNone'))
      : h('div', { key: 'forest', className: 'iw-chain-roots' }, forest.map((entry, index) => h(IdeChainNode, {
        key: `${entry.path}:${entry.line}:${index}`,
        node: entry,
        depth: 0,
        onPick,
        tr,
      }))),
  ])
  return h('div', {
    ref,
    tabIndex: -1,
    className: 'iw-pop iw-pop-chain',
    style: placement.style,
    role: 'dialog',
    'aria-label': popup.name,
  }, [
    h('div', { key: 'head', className: 'iw-pop-head' }, [
      h('span', { key: 'n', className: 'iw-pop-name' }, popup.name),
      h('span', { key: 'c', className: 'iw-pop-count', title: tr('chainHint') }, status),
    ]),
    h('div', { key: 'body', className: 'iw-pop-body' }, body),
  ])
}

/**
 * Headless Session tracker.
 *
 * A global main panel is not a conversation, so the right-Sidebar controller
 * reports no Session "on screen" while this plugin's panel holds the column, and
 * the panel cannot learn which workspace to show from that controller at paint
 * time. This entry stays mounted in the frame's overlay layer (it renders
 * nothing) and remembers the Session that was on screen while the Conversation
 * still was.
 *
 * The workspace root comes from the Workspace list — `items[].path` for the
 * Workspace that accounts for the Session — and only falls back to the Session
 * row's own `cwd`. Both are read through the standard snapshot hooks, so the
 * resolution follows the same data the shipped navigation renders.
 */

/**
 * Resolve the Session and its absolute workspace root.
 *
 * Order of preference:
 *  1. the Session the right column reports as on screen;
 *  2. the Session the layout still retains for the main view;
 *  3. the Workspace that accounts for that Session (`items[].path`);
 *     then the Session row's `cwd`.
 *
 * @returns `{ sessionId, root }`; either may be missing, and the panel says so.
 */
function ideResolveTarget(mounted, sessionsState, workspacesState) {
  const byId = sessionsState?.byId ?? {}
  const ids = Array.isArray(sessionsState?.ids) ? sessionsState.ids : []
  let sessionId = typeof mounted === 'string' && mounted !== '' ? mounted : undefined
  if (sessionId === undefined) {
    sessionId = ids.find((id) => ((byId[id]?.retainedBy?.mainView) ?? 0) > 0)
  }
  if (sessionId === undefined) return { sessionId: undefined, root: '' }
  const items = Array.isArray(workspacesState?.items) ? workspacesState.items : []
  const workspace = items.find((item) => Array.isArray(item?.sessionIds) && item.sessionIds.includes(sessionId))
  const fromWorkspace = typeof workspace?.path === 'string' ? workspace.path : ''
  const fromSession = typeof byId[sessionId]?.cwd === 'string' ? byId[sessionId].cwd : ''
  return { sessionId, root: fromWorkspace !== '' ? fromWorkspace : fromSession }
}

/** The tracker entry. */
function IdeSessionTracker({ store, useSessions, useWorkspaces }) {
  const selectSessions = typeof useSessions === 'function' ? useSessions : () => undefined
  const selectWorkspaces = typeof useWorkspaces === 'function' ? useWorkspaces : () => undefined
  const sessions = selectSessions((snapshot) => snapshot)
  const workspaces = selectWorkspaces((snapshot) => snapshot)
  const target = ideResolveTarget(undefined, sessions, workspaces)

  // `mounted` turns undefined the moment a global panel takes the main column;
  // the remembered Session is what makes the panel survive that switch.
  useEffect(() => {
    if (typeof target.sessionId !== 'string') return
    store.rememberSession(target.sessionId)
  }, [target.sessionId, store])

  useEffect(() => {
    if (typeof target.root !== 'string' || target.root === '') return
    store.setRoot(target.root)
  }, [target.root, store])

  return null
}

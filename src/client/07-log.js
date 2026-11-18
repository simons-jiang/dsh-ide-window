/**
 * The client's own log.
 *
 * The Host cannot see the page, so a failure that only happens in the browser
 * (a route answer the panel rejects, an exception in a handler) leaves no trace
 * anywhere. These entries stay in a small ring; 「复制诊断信息」 sends them to the
 * Host, which appends them to `~/.dsh/logs/dsh-ide-window.log` and answers with
 * its own recent events.
 *
 * `localStorage['dsh-ide:trace'] = '1'` also mirrors every entry to the console.
 */
const IDE_LOG_LIMIT = 100
const ideLogEntries = []

/** Record one client event; never throws, never blocks a handler. */
function ideLogRecord(level, scope, message, extra) {
  const entry = {
    t: new Date().toISOString(),
    level: String(level ?? 'info'),
    scope: String(scope ?? 'client'),
    message: String(message ?? '').slice(0, 500),
  }
  if (extra !== undefined && extra !== null) {
    const detail = typeof extra === 'string' ? extra : (() => { try { return JSON.stringify(extra) } catch (error) { void error; return String(extra) } })()
    entry.detail = String(detail).slice(0, 1000)
  }
  ideLogEntries.push(entry)
  if (ideLogEntries.length > IDE_LOG_LIMIT) ideLogEntries.shift()
  try {
    if (globalThis.localStorage?.getItem('dsh-ide:trace') === '1') {
      const line = `[dsh-ide] ${entry.level} ${entry.scope} ${entry.message}`
      if (entry.level === 'error') console.error(line, entry.detail ?? '')
      else console.info(line, entry.detail ?? '')
    }
  } catch (error) {
    void error
  }
  return entry
}

/** Everything the panel knows about itself, in the shape a report quotes. */
function ideLogSnapshot() {
  return {
    platform: ideRuntimeContext.platform,
    runtime: ideRuntimeContext.runtime,
    path: typeof location === 'undefined' ? '' : String(location.pathname ?? ''),
    entries: [...ideLogEntries],
  }
}

/**
 * Screenshots: the Host captures, the panel decides what to do with it.
 *
 * The Web page cannot read the screen (the shell answers `getDisplayMedia` with
 * a refusal), so the capture happens in the Host with an OS built-in tool and
 * comes back as a data URL. Two outcomes are offered:
 *
 * - **截图并跳转会话** — go back to the conversation and paste the image into the
 *   composer. The paste is a synthetic `ClipboardEvent` carrying a `File`: the
 *   shell treats it as a normal paste, so the draft's text, references and
 *   pending attachments are left exactly as they were.
 * - **只截图** — copy it to the system clipboard and keep the file around; the
 *   notice shows the path.
 *
 * macOS gates screen capture behind Screen Recording permission. A refusal is
 * classified by the Host (`no-screen-permission`) and answered with a guide that
 * opens the right settings pane in one click (Windows needs no such grant).
 */

const IDE_SHOT_ROUTE = '/dsh-ide/screenshot'
const IDE_SHOT_PERMISSION_ROUTE = '/dsh-ide/screen-permission'

/** POST one screenshot request; never throws, returns `{ ok }` shapes. */
async function ideShotRequest(body) {
  let response
  try {
    response = await fetch(IDE_SHOT_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  } catch (error) {
    return { ok: false, code: 'network', message: String(error?.message ?? error) }
  }
  const parsed = await response.json().catch(() => null)
  if (parsed === null) return { ok: false, code: `http-${response.status}`, message: '' }
  if (parsed.ok !== true) {
    return {
      ok: false,
      code: parsed.error?.code ?? 'capture-failed',
      message: parsed.error?.message ?? '',
    }
  }
  return { ok: true, value: parsed.value }
}

/** Ask the OS to open the place where screen recording is granted. */
async function ideOpenScreenPermission() {
  let response
  try {
    response = await fetch(IDE_SHOT_PERMISSION_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
  } catch {
    return { opened: false }
  }
  const parsed = await response.json().catch(() => null)
  return parsed?.ok === true ? parsed.value : { opened: false }
}

/** The image inside a `data:image/png;base64,…` URL as a `File`. */
function ideShotFile(dataUrl, name = 'screenshot.png') {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const type = /^data:(image\/[a-z+]+)/.exec(head)?.[1] ?? 'image/png'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], name, { type })
}

/**
 * Paste the image into the conversation composer.
 *
 * Only a paste is dispatched — no editor mutation, no `@` mention flow — so the
 * draft keeps whatever the user already typed or attached. Returns `false` when
 * no composer is on screen, which the caller degrades to "copy it and paste
 * yourself".
 */
async function idePasteScreenshot(dataUrl) {
  const findEditor = () => (typeof document === 'undefined' ? null : document.querySelector('[data-lexical-editor="true"]'))
  const deadline = Date.now() + 2000
  let editor = findEditor()
  while (editor === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40))
    editor = findEditor()
  }
  if (editor === null) return false
  const file = ideShotFile(dataUrl)
  const transfer = new DataTransfer()
  transfer.items.add(file)
  editor.focus()
  const event = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
  editor.dispatchEvent(event)
  return true
}

/**
 * The screenshot dialog: a preview with the two choices, or the permission guide
 * when the capture was refused. Rendered at panel level so it is not clipped.
 */
function IdeScreenshotPopup({ state, tr, onJump, onKeep, onRetry, onOpenSettings, onClose }) {
  const shot = state.screenshot ?? null
  if (shot === null) return null
  const busy = shot.phase === 'running'
  const failed = shot.phase === 'error'
  const needsPermission = failed && shot.code === 'no-screen-permission'
  // The guide depends on the machine running the Host, which is the same machine
  // as the browser: `ideHostIsMacos()` reads the runtime platform, then the UA.
  const isMac = ideHostIsMacos()

  const actions = []
  if (busy) {
    actions.push(h('span', { key: 'busy', className: 'iw-shot-busy' }, tr('shotBusy')))
  } else if (needsPermission) {
    if (isMac) actions.push(h('button', { key: 'settings', type: 'button', className: 'iw-shot-primary', onClick: onOpenSettings }, tr('shotOpenSettings')))
    actions.push(h('button', { key: 'retry', type: 'button', className: 'iw-shot-button', onClick: onRetry }, tr('shotRetry')))
    actions.push(h('button', { key: 'close', type: 'button', className: 'iw-shot-button', onClick: onClose }, tr('setupClose')))
  } else if (failed) {
    actions.push(h('button', { key: 'retry', type: 'button', className: 'iw-shot-primary', onClick: onRetry }, tr('shotRetry')))
    actions.push(h('button', { key: 'close', type: 'button', className: 'iw-shot-button', onClick: onClose }, tr('setupClose')))
  } else {
    actions.push(h('button', { key: 'jump', type: 'button', className: 'iw-shot-primary', onClick: onJump }, tr('shotJump')))
    actions.push(h('button', { key: 'keep', type: 'button', className: 'iw-shot-button', onClick: onKeep }, tr('shotKeep')))
    actions.push(h('button', { key: 'close', type: 'button', className: 'iw-shot-button', onClick: onClose }, tr('setupClose')))
  }

  const guide = needsPermission
    ? (isMac ? tr('shotNoPermissionMac') : tr('shotNoPermissionWindows'))
    : failed ? (shot.message === '' ? tr('shotFailed') : `${tr('shotFailed')}：${shot.message}`) : ''

  return h('div', {
    className: 'iw-shot',
    onPointerDown: (event) => event.stopPropagation(),
  }, [
    h('div', { key: 'title', className: 'iw-shot-title' }, needsPermission ? tr('shotNoPermissionTitle') : tr('shotTitle')),
    guide === '' ? null : h('div', { key: 'guide', className: 'iw-shot-guide' }, guide),
    shot.dataUrl === undefined || shot.dataUrl === ''
      ? null
      : h('img', { key: 'preview', className: 'iw-shot-preview', src: shot.dataUrl, alt: tr('shotPreview') }),
    h('div', { key: 'actions', className: 'iw-shot-actions' }, actions),
  ])
}

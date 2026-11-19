/**
 * Screenshot editor: the Host captures, the panel decides and annotates.
 *
 * The Web page cannot read the screen (the shell answers `getDisplayMedia` with
 * a refusal), so the Host captures a full screen with an OS built-in tool and
 * hands it back as a data URL. Everything after that is ordinary Canvas work,
 * which is why macOS and Windows share this whole file:
 *
 * - **range**: the user drags a rectangle on the capture (move it, pull its
 *   handles), and only that rectangle is exported;
 * - **marks**: rectangle, ellipse, arrow, pen, text and mosaic, each stored as
 *   an operation instead of pixels, so undo is a `pop()` and the export redraws
 *   from the untouched base image;
 * - **budget**: the export is cropped, scaled to a 1920 long edge and encoded as
 *   JPEG with a quality ladder, so a screenshot stays well under 1 MB.
 *
 * Two exits: paste it into the conversation (only an image is added — the draft's
 * text and attachments are untouched) or copy it to the system clipboard.
 */

const IDE_SHOT_ROUTE = '/dsh-ide/screenshot'
const IDE_SHOT_PERMISSION_ROUTE = '/dsh-ide/screen-permission'

/** Long edge of the export; 1920 keeps a 16:9 crop at 1080p. */
/** The export must not exceed this when it becomes a chat attachment. */
const IDE_SHOT_BUDGET = 1024 * 1024
/** JPEG qualities tried in order until the budget is met. */
const IDE_SHOT_QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4]
/** Extra passes that only run when the JPEG still exceeds the budget. */
const IDE_SHOT_SHRINK_STEPS = [1, 1.25, 1.5, 2]

/**
 * Tools the popup card offers.
 *
 * `select` is the range tool, not a mark. Ellipse, arrow, pen and mosaic still
 * have their drawing code (`ideShotDrawOp`) but are not surfaced: the card stays
 * small, and the two that cover callouts are enough.
 */
const IDE_SHOT_TOOLS = ['select', 'rect', 'text']
/** Stroke colours offered; red first because a screenshot mark is usually red. */
const IDE_SHOT_COLORS = ['#ff4d4f', '#ffd666', '#52c41a', '#4f8cff', '#ffffff']
/** Stroke widths offered, in image pixels. */
const IDE_SHOT_WIDTHS = [2, 4, 8]
/** Smallest selection a drag may produce, in image pixels. */
const IDE_SHOT_MIN_SELECTION = 24

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

/** The image inside a `data:image/…;base64,…` URL as a `File`. */
function ideShotFile(dataUrl, name = 'screenshot.jpg') {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const type = /^data:(image\/[a-z+]+)/.exec(head)?.[1] ?? 'image/jpeg'
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
 * no composer is on screen, which the caller degrades to "copy it and paste".
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
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  return true
}

// ------------------------------------------------------------------ geometry
// Pure helpers: the editor converts pointer positions into image pixels, keeps
// a selection inside the capture and resizes it from one of eight handles.

/** Scale that fits `width × height` into the given box, never upscaling. */
function ideShotFitScale(width, height, boxWidth, boxHeight) {
  if (!(width > 0) || !(height > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return 1
  return Math.min(boxWidth / width, boxHeight / height, 1)
}

/**
 * How big to draw the capture.
 *
 * The whole picture has to stay visible — cropping it would put the screen's
 * edges out of reach, and a selection there would silently lose content. So it
 * is drawn at life size (a Retina capture is 2× the CSS pixels, hence `1/ratio`)
 * and only scaled down when the window cannot hold it. On a window that is
 * nearly the screen this fills it edge to edge.
 */
function ideShotDisplayScale(imageWidth, imageHeight, boxWidth, boxHeight, ratio) {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return 1
  const life = 1 / (ratio > 0 ? ratio : 1)
  return Math.min(life, boxWidth / imageWidth, boxHeight / imageHeight)
}

/** Keep a rectangle inside `bounds` without changing its size (unless it must shrink). */
function ideShotClampSelection(rect, bounds) {
  const width = Math.min(rect.width, bounds.width)
  const height = Math.min(rect.height, bounds.height)
  const x = Math.min(Math.max(rect.x, 0), Math.max(bounds.width - width, 0))
  const y = Math.min(Math.max(rect.y, 0), Math.max(bounds.height - height, 0))
  return { x, y, width, height }
}

/** A rectangle from two dragged corners, normalized and clamped to the image. */
function ideShotRectFromPoints(start, end, bounds) {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return ideShotClampSelection({ x, y, width, height }, bounds)
}

/** The eight resize handles of a rectangle, as `{ id, x, y }` in image pixels. */
function ideShotHandles(rect) {
  const midX = rect.x + rect.width / 2
  const midY = rect.y + rect.height / 2
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  return [
    { id: 'nw', x: rect.x, y: rect.y },
    { id: 'n', x: midX, y: rect.y },
    { id: 'ne', x: right, y: rect.y },
    { id: 'e', x: right, y: midY },
    { id: 'se', x: right, y: bottom },
    { id: 's', x: midX, y: bottom },
    { id: 'sw', x: rect.x, y: bottom },
    { id: 'w', x: rect.x, y: midY },
  ]
}

/** Whether a point is inside `rect`, expanded by `slack` on every side. */
function ideShotHitsRect(point, rect, slack) {
  const pad = Number.isFinite(slack) ? slack : 0
  return point.x >= rect.x - pad && point.x <= rect.x + rect.width + pad
    && point.y >= rect.y - pad && point.y <= rect.y + rect.height + pad
}

/** Resize `rect` by dragging one handle to `point`, keeping it valid and in bounds. */
function ideShotResize(rect, handle, point, bounds) {
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height
  if (handle.includes('w')) left = point.x
  if (handle.includes('e')) right = point.x
  if (handle.includes('n')) top = point.y
  if (handle.includes('s')) bottom = point.y
  const x = Math.min(left, right)
  const y = Math.min(top, bottom)
  const width = Math.max(Math.abs(right - left), IDE_SHOT_MIN_SELECTION / 4)
  const height = Math.max(Math.abs(bottom - top), IDE_SHOT_MIN_SELECTION / 4)
  return ideShotClampSelection({ x, y, width, height }, bounds)
}

/**
 * Pointer position in image pixels.
 *
 * The capture is centred inside the stage, so the offset of the drawn canvas
 * within the stage is half of the leftover space; `bounds` is the image size
 * (the stage element itself has no width/height of its own).
 */
function ideShotPoint(event, canvas, scale, bounds) {
  const box = canvas.getBoundingClientRect()
  const x = (event.clientX - box.left) / scale
  const y = (event.clientY - box.top) / scale
  return {
    x: Math.max(0, Math.min(Number.isFinite(x) ? x : 0, bounds.width)),
    y: Math.max(0, Math.min(Number.isFinite(y) ? y : 0, bounds.height)),
  }
}

// -------------------------------------------------------------------- drawing

/** Draw one stored operation onto a context that already shows the capture. */
function ideShotDrawOp(ctx, op, image) {
  const color = op.color ?? '#ff4d4f'
  // `stroke` is the pen width; `width`/`height` are the rectangle being drawn.
  const stroke = op.stroke ?? 4
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (op.tool === 'rect') {
    ctx.strokeRect(op.x, op.y, op.width, op.height)
  } else if (op.tool === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(op.x + op.width / 2, op.y + op.height / 2, Math.abs(op.width / 2), Math.abs(op.height / 2), 0, 0, Math.PI * 2)
    ctx.stroke()
  } else if (op.tool === 'arrow') {
    const x1 = op.x
    const y1 = op.y
    const x2 = op.x + op.width
    const y2 = op.y + op.height
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = Math.max(10, stroke * 4)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
  } else if (op.tool === 'pen') {
    const points = op.points ?? []
    if (points.length > 1) {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }
  } else if (op.tool === 'text') {
    ctx.font = `${Math.max(12, Math.round(stroke))}px -apple-system, "Segoe UI", "PingFang SC", sans-serif`
    ctx.textBaseline = 'top'
    // A dark halo keeps the label readable on light and dark captures alike.
    ctx.lineWidth = Math.max(2, stroke / 2)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.strokeText(op.text ?? '', op.x, op.y)
    ctx.fillStyle = color
    ctx.fillText(op.text ?? '', op.x, op.y)
  } else if (op.tool === 'mosaic') {
    const x = Math.min(op.x, op.x + op.width)
    const y = Math.min(op.y, op.y + op.height)
    const w = Math.abs(op.width)
    const h = Math.abs(op.height)
    if (w > 2 && h > 2 && image !== undefined) {
      const block = Math.max(6, Math.round(Math.min(w, h) / 12))
      const small = document.createElement('canvas')
      small.width = Math.max(1, Math.round(w / block))
      small.height = Math.max(1, Math.round(h / block))
      const smallCtx = small.getContext('2d')
      smallCtx.imageSmoothingEnabled = true
      smallCtx.drawImage(image, x, y, w, h, 0, 0, small.width, small.height)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h)
    }
  }
  ctx.restore()
}

/** Redraw the whole editor frame: capture, dimmed outside, marks, selection. */
function ideShotPaint(canvas, image, ops, draft, selection, showSelection) {
  const ctx = canvas.getContext('2d')
  if (ctx === null || image === null) return
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  for (const op of ops) ideShotDrawOp(ctx, op, image)
  if (draft !== null) ideShotDrawOp(ctx, draft, image)
  if (selection === null) {
    // Nothing framed yet: dim the whole capture so the hint reads as a mode.
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  } else if (showSelection) {
    const { x, y, width, height } = selection
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.beginPath()
    ctx.rect(0, 0, canvas.width, canvas.height)
    ctx.rect(x, y, width, height)
    ctx.fill('evenodd')
    ctx.strokeStyle = '#4f8cff'
    ctx.lineWidth = Math.max(1, canvas.width / 900)
    ctx.strokeRect(x, y, width, height)
    for (const handle of ideShotHandles(selection)) {
      const size = Math.max(6, canvas.width / 160)
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#4f8cff'
      ctx.lineWidth = Math.max(1, canvas.width / 900)
      ctx.beginPath()
      ctx.rect(handle.x - size / 2, handle.y - size / 2, size, size)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
  }
}

/**
 * Crop the selection, redraw the marks and encode within the budget.
 *
 * The ladder stops at the first size that fits, so a flat capture keeps its
 * quality while a text-heavy one steps down instead of blowing the budget.
 */
function ideShotExport(image, ops, selection) {
  const sourceX = Math.max(0, Math.round(selection.x))
  const sourceY = Math.max(0, Math.round(selection.y))
  const sourceWidth = Math.max(1, Math.round(Math.min(selection.width, image.width - sourceX)))
  const sourceHeight = Math.max(1, Math.round(Math.min(selection.height, image.height - sourceY)))
  const render = (scale) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    const ctx = canvas.getContext('2d')
    if (ctx === null) return null
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(scale, scale)
    ctx.translate(-sourceX, -sourceY)
    for (const op of ops) ideShotDrawOp(ctx, op, image)
    ctx.restore()
    return canvas
  }
  // The crop keeps the screen's own pixels (no forced 1920 edge). Quality is
  // spent first; the picture is only ever shrunk if it still cannot fit the
  // attachment budget.
  let smallest = ''
  for (const step of IDE_SHOT_SHRINK_STEPS) {
    const canvas = render(Math.min(1, 1 / step))
    if (canvas === null) return ''
    for (const quality of IDE_SHOT_QUALITIES) {
      const url = canvas.toDataURL('image/jpeg', quality)
      if (url.length * 0.75 <= IDE_SHOT_BUDGET) return url
      if (smallest === '' || url.length < smallest.length) smallest = url
    }
  }
  return smallest
}

// ------------------------------------------------------------------ component

/** One toolbar button. */
function IdeShotToolButton({ active, label, title, onClick }) {
  return h('button', {
    type: 'button',
    className: `iw-shot-tool${active ? ' on' : ''}`,
    title,
    onClick,
  }, label)
}

/**
 * The editor overlay.
 *
 * Rendered through `shell.overlay`, so it covers the window regardless of which
 * column is showing and is never clipped by the panel's overflow.
 */
function IdeScreenshotEditor({ store, tr, onInsert, onCopy, onOpenSettings, onClose }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const shot = state.screenshot ?? null
  const editing = shot?.phase === 'editing'
  const [image, setImage] = useState(null)
  const [tool, setTool] = useState('select')
  const [color, setColor] = useState(IDE_SHOT_COLORS[0])
  const [width, setWidth] = useState(IDE_SHOT_WIDTHS[1])
  const [ops, setOps] = useState([])
  const [selection, setSelection] = useState(null)
  /** True while the frame is being dragged: the card only shows once released. */
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState(null)
  const [textAt, setTextAt] = useState(null)
  const [textValue, setTextValue] = useState('')
  const [scale, setScale] = useState(1)
  /**
   * On-screen size of a text mark. The operation stores the same size in image
   * pixels (divided by the zoom), so what you type is exactly what gets drawn.
   */
  const textFont = Math.max(12, Math.round(width * 2.4 * scale))
  const [stageRect, setStageRect] = useState(null)
  /** Where image pixel (0,0) goes, in viewport coordinates. */
  const [origin, setOrigin] = useState({ left: 0, top: 0 })
  const canvasRef = useRef(null)
  const frameRef = useRef(null)
  const dragRef = useRef(null)

  // Load the capture into an <img>: the canvas needs natural pixels, and the
  // selection is expressed in those pixels.
  useEffect(() => {
    if (!editing) {
      setImage(null)
      return
    }
    setOps([])
    setDraft(null)
    setTool('select')
    setTextAt(null)
    setSelection(null)
    const element = new Image()
    element.onload = () => setImage(element)
    element.src = shot.dataUrl
  }, [editing, shot?.dataUrl])

  /**
   * Put the frozen picture exactly where the screen was.
   *
   * The capture is the whole screen in device pixels, and the overlay only
   * covers this window — so it is drawn 1:1 (`1 / devicePixelRatio`) and moved
   * up/left by the window's own screen offset. Without that offset the picture
   * is centred inside the window: its menu bar and title bar land *inside* the
   * window too, and you see everything doubled.
   */
  useEffect(() => {
    if (image === null) return
    setScale(1 / (globalThis.devicePixelRatio || 1))
    setOrigin({
      left: -(globalThis.screenX ?? globalThis.screenLeft ?? 0),
      top: -(globalThis.screenY ?? globalThis.screenTop ?? 0),
    })
  }, [image])

  // Repaint whenever anything visible changed.
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || image === null) return
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    ideShotPaint(canvas, image, ops, draft, selection, selection !== null)
  }, [image, ops, draft, selection, tool])

  // Undo from anywhere: the overlay never holds focus, so the key is read at
  // the window instead of relying on a focused element.
  useEffect(() => {
    if (!editing) return undefined
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      setOps((list) => list.slice(0, -1))
    }
    globalThis.addEventListener?.('keydown', onKey, true)
    return () => globalThis.removeEventListener?.('keydown', onKey, true)
  }, [editing])

  // Where the canvas sits on screen: the popup card is anchored to the frame.
  const layoutKey = selection === null ? '' : `${selection.x},${selection.y},${selection.width},${selection.height}`
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || image === null) {
      setStageRect(null)
      return
    }
    const rect = canvas.getBoundingClientRect()
    setStageRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
  }, [image, scale, layoutKey])

  const bounds = image === null
    ? { width: 1, height: 1 }
    : { width: image.naturalWidth, height: image.naturalHeight }

  /** Whether a point may carry a mark (a mark needs a framed area). */
  const canMark = selection !== null && ideShotHitsRect

  const beginSelection = (point) => {
    dragRef.current = { mode: 'create', origin: point }
    setDragging(true)
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  /**
   * Pointer down: dragging on empty space always draws a new frame — that is
   * the first thing the user does after the shortcut. Inside an existing frame
   * the active tool decides (range adjust, rectangle, or text).
   */
  const onPointerDown = (event) => {
    // Pressing the box itself has to place the caret, not cancel it: the event
    // bubbles from the <input> up to this stage handler.
    if (event.target?.closest?.('.iw-shot-text')) return
    if (textAt !== null) {
      setTextAt(null)
      setTextValue('')
      return
    }
    if (image === null) return
    const frame = frameRef.current
    if (frame === null) return
    const point = ideShotPoint(event, canvasRef.current ?? frame, scale, bounds)
    try {
      frame.setPointerCapture?.(event.pointerId)
    } catch {
      /* a synthetic or already-captured pointer: dragging still works */
    }
    const inside = selection !== null && selection.width > 0 && ideShotHitsRect(point, selection, 0)
    if (!inside) {
      beginSelection(point)
      return
    }
    if (tool === 'text') {
      setTextAt(point)
      setTextValue('')
      return
    }
    if (tool === 'rect') {
      setDraft({ tool, color, stroke: width, x: point.x, y: point.y, width: 0, height: 0, points: [point] })
      return
    }
    // Range tool: handles first, then the body.
    const handle = ideShotHandles(selection).find((entry) => (
      Math.abs(entry.x - point.x) <= 12 / scale && Math.abs(entry.y - point.y) <= 12 / scale
    ))
    if (handle !== undefined) {
      dragRef.current = { mode: 'resize', handle: handle.id }
      return
    }
    dragRef.current = { mode: 'move', origin: point, start: selection }
  }

  const onPointerMove = (event) => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (frame === null) return
    const point = ideShotPoint(event, canvasRef.current ?? frame, scale, bounds)
    if (drag !== null) {
      if (drag.mode === 'move') {
        const dx = point.x - drag.origin.x
        const dy = point.y - drag.origin.y
        setSelection(ideShotClampSelection({
          x: drag.start.x + dx,
          y: drag.start.y + dy,
          width: drag.start.width,
          height: drag.start.height,
        }, bounds))
        return
      }
      if (drag.mode === 'resize') {
        setSelection(ideShotResize(selection, drag.handle, point, bounds))
        return
      }
      setSelection(ideShotRectFromPoints(drag.origin, point, bounds))
      return
    }
    if (draft !== null) {
      const next = { ...draft }
      if (draft.tool === 'pen') next.points = [...draft.points, point]
      else {
        next.width = point.x - draft.x
        next.height = point.y - draft.y
      }
      setDraft(next)
    }
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (draft !== null) {
      const op = draft.tool === 'pen'
        ? { ...draft }
        : {
          ...draft,
          x: Math.min(draft.x, draft.x + draft.width),
          y: Math.min(draft.y, draft.y + draft.height),
          width: Math.abs(draft.width),
          height: Math.abs(draft.height),
        }
      setDraft(null)
      if (op.tool === 'pen' ? (op.points?.length ?? 0) > 1 : (op.width > 2 || op.height > 2)) {
        setOps((list) => [...list, op])
      }
      return
    }
    if (drag?.mode === 'create' && selection !== null) {
      // A click (or a stray twitch) is not a frame: drop it and stay unframed.
      if (selection.width < IDE_SHOT_MIN_SELECTION || selection.height < IDE_SHOT_MIN_SELECTION) {
        setSelection(null)
      }
    }
  }

  const commitText = () => {
    if (textAt === null || textValue.trim() === '') {
      setTextAt(null)
      return
    }
    // `stroke` doubles as the font size for text marks, in image pixels; the
    // preview is that number times the zoom, so the two agree.
    setOps((list) => [...list, { tool: 'text', x: textAt.x, y: textAt.y, text: textValue.trim(), color, stroke: Math.max(12, Math.round(textFont / scale)) }])
    setTextAt(null)
    setTextValue('')
  }

  const undo = () => setOps((list) => list.slice(0, -1))
  const exportImage = () => (selection === null || image === null ? '' : ideShotExport(image, ops, selection))

  /**
   * Esc leaves the whole operation — before the first press, and also in the
   * middle of dragging a frame (the pointer capture is dropped so the "up"
   * that follows cannot revive it). A text box open eats the first Esc.
   *
   * The listener is on `window` in the capture phase: the overlay never takes
   * focus, and the shell handles Esc for its own panels.
   */
  useEffect(() => {
    if (!editing) return undefined
    /**
     * Esc leaves the editor — except while a text box is open: then the box
     * owns the key and closes itself (its own `onKeyDown`), so one press never
     * does two things. Nothing here stops propagation for that case.
     */
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented === true) return
      if (textAt !== null) return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = null
      setDragging(false)
      setDraft(null)
      onClose()
    }
    globalThis.addEventListener?.('keydown', onKey, true)
    return () => globalThis.removeEventListener?.('keydown', onKey, true)
  }, [editing, textAt, onClose])

  if (shot === null) return null

  // The editor renders through `shell.overlay`, i.e. outside the panel: the
  // workspace stylesheet is only mounted by the panel components, so without
  // this the card falls back to browser-default buttons (white) and fonts.
  const styled = (node) => h(React.Fragment, null, [h(IdeStyles, { key: 'style' }), node])
  const palette = ideIsThemeId(state.theme) ? { 'data-dsh-theme': state.theme } : {}

  // Typography follows the user's own settings; the variables are set here
  // because `.iw-root` (which normally sets them) is not an ancestor.
  const skin = {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: `${Number.isFinite(state.treeFontSize) ? state.treeFontSize : 14.5}px`,
    '--iw-code-font-size': `${Number.isFinite(state.codeFontSize) ? state.codeFontSize : 12.5}px`,
    '--iw-tree-font-size': `${Number.isFinite(state.treeFontSize) ? state.treeFontSize : 14.5}px`,
  }

  if (shot.phase === 'error') {
    const needsPermission = shot.code === 'no-screen-permission'
    const isMac = ideHostIsMacos()
    const actions = []
    if (needsPermission && isMac) {
      actions.push(h('button', { key: 'settings', type: 'button', className: 'iw-shot-primary', onClick: onOpenSettings }, tr('shotOpenSettings')))
    }
    actions.push(h('button', { key: 'close', type: 'button', className: 'iw-shot-button', onClick: onClose }, tr('setupClose')))
    return styled(h('div', { className: 'iw-shot-veil', style: skin, ...palette }, [
      h('div', { key: 'card', className: 'iw-shot' }, [
        h('div', { key: 'title', className: 'iw-shot-title' }, needsPermission ? tr('shotNoPermissionTitle') : tr('shotFailed')),
        h('div', { key: 'guide', className: 'iw-shot-guide' }, needsPermission
          ? (isMac ? tr('shotNoPermissionMac') : tr('shotNoPermissionWindows'))
          : (shot.message === '' ? tr('shotFailed') : `${tr('shotFailed')}：${shot.message}`)),
        h('div', { key: 'actions', className: 'iw-shot-actions' }, actions),
      ]),
    ]))
  }

  if (image === null) {
    return styled(h('div', { className: 'iw-shot-veil', style: skin, ...palette }, [
      h('div', { key: 'card', className: 'iw-shot' }, [h('div', { key: 'title', className: 'iw-shot-title' }, tr('shotBusy'))]),
    ]))
  }

  // The popup card: below the frame, or above it when the bottom is crowded.
  const card = (() => {
    if (selection === null || dragging || stageRect === null) return null
    const cardWidth = 392
    const frameLeft = stageRect.left + selection.x * scale
    const frameTop = stageRect.top + selection.y * scale
    const frameWidth = selection.width * scale
    const frameHeight = selection.height * scale
    const left = Math.max(8, Math.min(globalThis.innerWidth - cardWidth - 8, frameLeft + frameWidth / 2 - cardWidth / 2))
    const below = frameTop + frameHeight + 10
    const top = below + 44 <= globalThis.innerHeight ? below : Math.max(8, frameTop - 44)
    const pick = (id) => {
      setTool(tool === id ? 'select' : id)
      setTextAt(null)
    }
    return h('div', {
      className: 'iw-shot-card',
      style: { left: `${left}px`, top: `${top}px`, width: `${cardWidth}px` },
      onPointerDown: (event) => event.stopPropagation(),
    }, [
      h('button', {
        key: 'rect',
        type: 'button',
        className: `iw-btn${tool === 'rect' ? ' on' : ''}`,
        title: tr('shotTool_rect'),
        onClick: () => pick('rect'),
      }, tr('shotTool_rect')),
      h('button', {
        key: 'text',
        type: 'button',
        className: `iw-btn${tool === 'text' ? ' on' : ''}`,
        title: tr('shotTool_text'),
        onClick: () => pick('text'),
      }, tr('shotTool_text')),
      h('button', {
        key: 'undo',
        type: 'button',
        className: 'iw-btn',
        disabled: ops.length === 0,
        onClick: undo,
      }, tr('shotUndo')),
      h('span', { key: 'grow', className: 'iw-shot-grow' }),
      h('button', {
        key: 'copy',
        type: 'button',
        className: 'iw-btn',
        onClick: () => { const url = exportImage(); if (url !== '') onCopy(url) },
      }, tr('shotCopy')),
      h('button', {
        key: 'insert',
        type: 'button',
        className: 'iw-btn primary',
        onClick: () => { const url = exportImage(); if (url !== '') onInsert(url) },
      }, tr('shotJump')),
    ])
  })()

  return styled(h('div', {
    className: 'iw-shot-veil iw-shot-veil--editor',
    style: skin,
    ...palette,
    tabIndex: -1,
    onKeyDown: (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undo()
      }
    },
  }, [
    h('div', {
      key: 'stage',
      ref: frameRef,
      className: 'iw-shot-stage',
      onPointerDown: onPointerDown,
      onPointerMove: onPointerMove,
      onPointerUp: onPointerUp,
      onPointerCancel: onPointerUp,
    }, [
      h('div', {
        key: 'frame',
        className: 'iw-shot-frame',
        style: {
          position: 'absolute',
          left: `${origin.left}px`,
          top: `${origin.top}px`,
          width: `${Math.round(image.naturalWidth * scale)}px`,
          height: `${Math.round(image.naturalHeight * scale)}px`,
        },
      }, [
        h('canvas', {
          key: 'canvas',
          ref: canvasRef,
          className: 'iw-shot-canvas',
        }),
        textAt === null ? null : h('input', {
          key: 'text',
          className: 'iw-shot-text',
          autoFocus: true,
          // The stage cancels an open box on pointerdown; a click in the box
          // itself must not bubble up to it.
          onPointerDown: (event) => event.stopPropagation(),
          value: textValue,
          placeholder: tr('shotTextPlaceholder'),
          style: {
            left: `${Math.round(textAt.x * scale)}px`,
            top: `${Math.round(textAt.y * scale) - textFont}px`,
            color,
            fontSize: `${textFont}px`,
            width: `${Math.max(96, Math.round((textValue.length + 1) * textFont * 0.62))}px`,
          },
          onChange: (event) => setTextValue(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              commitText()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setTextAt(null)
              setTextValue('')
              return
            }
            event.stopPropagation()
          },
        }),
      ]),
    ]),
    card,
  ]))
}

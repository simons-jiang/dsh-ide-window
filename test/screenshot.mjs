/**
 * Screenshot plumbing: the platform is an OS tool, so the parts worth pinning
 * are the command lines and the permission classification.
 *
 * No screen is captured here (that needs a GUI session and a permission), but a
 * wrong flag or a wrongly classified error is exactly what breaks the feature
 * for a user, and neither shows up until someone clicks the shortcut.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { macPlatform } from '../platform/macos.js'
import { windowsPlatform } from '../platform/windows.js'
import { screenshotLooksPermissionDenied } from '../index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
let failures = 0

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`)
    return
  }
  failures += 1
  console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

const samplePath = '/tmp/shot.png'

// ---------------------------------------------------------------- macOS commands
{
  const shot = macPlatform.screenshotCommand(samplePath)
  check('macOS captures with screencapture', shot.command === 'screencapture', shot.command)
  check('macOS capture is silent and PNG', shot.args.includes('-x') && shot.args.includes('png'), shot.args.join(' '))
  check('macOS capture writes the given file', shot.args.at(-1) === samplePath, shot.args.at(-1))

  const optimize = macPlatform.imageOptimizeCommand('/tmp/in.png', '/tmp/out.jpg', 80)
  check('macOS optimises with sips', optimize.command === 'sips', optimize.command)
  check('macOS keeps native pixels when no edge is given', !macPlatform.imageOptimizeCommand('/tmp/in.png', '/tmp/out.jpg', 80, null).args.includes('-Z'))
  check('macOS resizes when an edge is asked for', macPlatform.imageOptimizeCommand('/tmp/in.png', '/tmp/out.jpg', 80, 2560).args.join(' ').includes('-Z 2560'))
  check('macOS encodes JPEG at the given quality', /format jpeg/.test(optimize.args.join(' ')) && optimize.args.includes('80'), optimize.args.join(' '))
  check('macOS writes the optimised file', optimize.args.join(' ').includes('--out /tmp/out.jpg'), optimize.args.join(' '))

  const clip = macPlatform.clipboardImageCommand(samplePath)
  check('macOS copies with AppleScript', clip.command === 'osascript', clip.command)
  check('macOS clipboard reads the PNG', /PNGf/.test(clip.args.join(' ')), clip.args.join(' '))
  check('macOS clipboard path survives spaces', macPlatform.clipboardImageCommand('/tmp/a b.png').args.join(' ').includes('/tmp/a b.png'))
}

// -------------------------------------------------------------- Windows commands
{
  const shot = windowsPlatform.screenshotCommand('C:\\Users\\x\\shot.png')
  check('Windows captures with PowerShell', shot.command === 'powershell.exe', shot.command)
  const script = shot.args.join(' ')
  check('Windows grabs the virtual screen (all monitors)', /VirtualScreen/.test(script), script.slice(0, 60))
  check('Windows copies the screen bitmap', /CopyFromScreen/.test(script), script.slice(0, 60))
  check('Windows saves a PNG', /ImageFormat\]::Png/.test(script), script.slice(-40))
  check('Windows path is quoted into the script', script.includes("'C:\\Users\\x\\shot.png'"), script.slice(-60))
  check('Windows single quotes are escaped', windowsPlatform.screenshotCommand("C:\\it's\\a.png").args.join(' ').includes("'C:\\it''s\\a.png'"))

  const optimize = windowsPlatform.imageOptimizeCommand('C:\\in.png', 'C:\\out.jpg', 70)
  const optimizeScript = optimize.args.join(' ')
  check('Windows optimises with PowerShell', optimize.command === 'powershell.exe', optimize.command)
  check('Windows keeps native pixels when no edge is given', windowsPlatform.imageOptimizeCommand('/tmp/in.png', '/tmp/out.jpg', 70, null).args.join(' ').includes('[Math]::Min(1.0, 0 / $long)') === false)
  check('Windows scales when an edge is asked for', windowsPlatform.imageOptimizeCommand('/tmp/in.png', '/tmp/out.jpg', 70, 2560).args.join(' ').includes('[Math]::Min(1.0, 2560 / $long)'))
  check('Windows resamples smoothly', /HighQualityBicubic/.test(optimizeScript), optimizeScript.slice(0, 80))
  check('Windows saves JPEG with the quality', optimizeScript.includes('Encoder]::Quality') && optimizeScript.includes('[long]70'), optimizeScript.slice(-80))

  const clip = windowsPlatform.clipboardImageCommand('C:\\shot.png')
  check('Windows clipboard runs in STA', clip.args.includes('-STA'), clip.args.join(' '))
  check('Windows clipboard sets the image', /::SetImage\(/.test(clip.args.join(' ')), clip.args.join(' ').slice(0, 80))
  check('Windows needs no shell for powershell.exe', windowsPlatform.needsShell('powershell.exe') === false)
  check('macOS needs no shell for screencapture', macPlatform.needsShell('screencapture') === false)
}

// ------------------------------------------------------------ error classification
{
  const denied = [
    'could not create image from display',
    'screencapture: could not create image from display',
    'Screen recording is not permitted',
    'permission denied',
    'requested access was denied',
  ]
  for (const text of denied) {
    check(`classified as missing permission: ${text.slice(0, 32)}`, screenshotLooksPermissionDenied(text) === true)
  }
  const other = ['', 'screencapture: unknown flag -Z', 'zip file is corrupted']
  for (const text of other) {
    check(`not a permission problem: ${text === '' ? '(empty)' : text.slice(0, 28)}`, screenshotLooksPermissionDenied(text) === false)
  }
}

// ------------------------------------------------------------- client wiring
{
  const client = await readFile(join(root, 'client.js'), 'utf8')
  check('client posts to the screenshot route', client.includes('/dsh-ide/screenshot'))
  check('client asks the host to open the settings pane', client.includes('/dsh-ide/screen-permission'))
  check('client pastes a File, not a text placeholder', client.includes("new ClipboardEvent('paste'"))
  check('client leaves the draft alone (no editor mutation)', !/editor\.(innerHTML|textContent)\s*=/.test(client))
  check('permission guide is OS specific', client.includes('shotNoPermissionMac') && client.includes('shotNoPermissionWindows'))

  // The geometry helpers are pure: load them out of the fragment and prove the
  // editor's math (fit, clamp, drag-to-rect, handle resize) without a browser.
  const fragment = await readFile(join(root, 'src', 'client', '72-screenshot.js'), 'utf8')
  const grab = (name) => {
    const start = fragment.indexOf(`function ${name}(`)
    if (start < 0) throw new Error(`missing ${name}`)
    let depth = 0
    let index = fragment.indexOf('{', start)
    const from = index
    for (; index < fragment.length; index += 1) {
      if (fragment[index] === '{') depth += 1
      else if (fragment[index] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    return fragment.slice(start, index + 1)
  }
  const geometry = new Function(`${['IDE_SHOT_MIN_SELECTION', 'IDE_SHOT_EXPORT_EDGE', 'IDE_SHOT_BUDGET', 'IDE_SHOT_QUALITIES'].map((name) => {
    const match = new RegExp(`const ${name} = ([^\\n]+)`).exec(fragment)
    return match === null ? '' : `const ${name} = ${match[1]};`
  }).join('\n')}
${['ideShotFitScale', 'ideShotClampSelection', 'ideShotRectFromPoints', 'ideShotHandles', 'ideShotHitsRect', 'ideShotResize'].map(grab).join('\n')}
return { ideShotFitScale, ideShotClampSelection, ideShotRectFromPoints, ideShotHandles, ideShotHitsRect, ideShotResize, IDE_SHOT_BUDGET }`)()

  check('the capture is fitted, never upscaled', geometry.ideShotFitScale(2560, 1440, 1280, 720) === 0.5 && geometry.ideShotFitScale(100, 100, 1280, 720) === 1)
  check('a selection stays inside the capture', JSON.stringify(geometry.ideShotClampSelection({ x: -20, y: 1300, width: 200, height: 400 }, { width: 300, height: 1440 })) === JSON.stringify({ x: 0, y: 1040, width: 200, height: 400 }))
  check('dragging any direction yields a positive rect', JSON.stringify(geometry.ideShotRectFromPoints({ x: 300, y: 200 }, { x: 100, y: 50 }, { width: 400, height: 300 })) === JSON.stringify({ x: 100, y: 50, width: 200, height: 150 }))
  check('a rect has eight handles', geometry.ideShotHandles({ x: 10, y: 20, width: 100, height: 50 }).map((entry) => entry.id).join(',') === 'nw,n,ne,e,se,s,sw,w')
  check('hits only inside the rect (plus slack)', geometry.ideShotHitsRect({ x: 15, y: 25 }, { x: 10, y: 20, width: 100, height: 50 }, 0) === true && geometry.ideShotHitsRect({ x: 5, y: 25 }, { x: 10, y: 20, width: 100, height: 50 }, 0) === false)
  check('resizing from the nw handle moves the origin', JSON.stringify(geometry.ideShotResize({ x: 100, y: 100, width: 200, height: 100 }, 'nw', { x: 50, y: 60 }, { width: 1000, height: 1000 })) === JSON.stringify({ x: 50, y: 60, width: 250, height: 140 }))
  check('the export budget is 1 MB', geometry.IDE_SHOT_BUDGET === 1024 * 1024)

  check('the card offers the range, box and text tools', ['select', 'rect', 'text'].every((id) => client.includes(`'${id}'`)))
  check('no frame is preset: the first drag draws it', client.includes('setSelection(null)') && client.includes('beginSelection(point)'))
  check('a tiny drag is not a frame', client.includes('IDE_SHOT_MIN_SELECTION || selection.height < IDE_SHOT_MIN_SELECTION'))
  check('the card is anchored to the frame', client.includes('iw-shot-card') && client.includes('frameTop + frameHeight'))
  check('nothing is painted before the capture (or it lands in the picture)', client.includes('let screenshotBusy = false'))
  check('the Host capture request has no runtime-specific flags', client.includes('ideShotRequest({})'))
  check('the same flow runs in a browser tab and on the desktop', !client.includes('shotWebOnly') && !client.includes('ideScreenshotAllowed'))
  check('no running-phase overlay', !client.includes("phase: 'running'"))
  check('marks are operations, not pixels', client.includes('setOps((list) => [...list, op])') && client.includes('ideShotExport'))
  check('the editor has an undo', client.includes('const undo = () => setOps((list) => list.slice(0, -1))'))

  const host = await readFile(join(root, 'index.js'), 'utf8')
  check('captures are shrunk before leaving the host', host.includes('optimizeScreenshot'))
  check('the budget is 1 MB', host.includes('1024 * 1024'))
  check('the quality ladder steps down', host.includes('[80, 70, 60, 50]') || /80, 70, 60, 50/.test(host))
  check('the raw PNG is removed after optimising', host.includes('rmSync(target'))
  check('the capture keeps the screen pixels (no 1080p cap)', host.includes('IDE_SCREENSHOT_EDIT_EDGE = null') && host.includes('optimizeScreenshot(target, null)'))
  check('the export is not capped at 1920 either', !client.includes('IDE_SHOT_EXPORT_EDGE'))
  check('the host can copy an in-page image', host.includes('copyDataUrl'))
}

console.log(failures === 0 ? '\nall screenshot checks passed' : `\n${failures} check(s) failed`)
if (failures > 0) process.exitCode = 1

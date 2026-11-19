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
  check('macOS fits the long edge to 1080p', optimize.args.join(' ').includes('-Z 1920'), optimize.args.join(' '))
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
  check('Windows scales to the 1920 long edge', /1920 \/ \$long/.test(optimizeScript), optimizeScript.slice(0, 80))
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

  const host = await readFile(join(root, 'index.js'), 'utf8')
  check('captures are shrunk before leaving the host', host.includes('optimizeScreenshot'))
  check('the budget is 1 MB', host.includes('1024 * 1024'))
  check('the quality ladder steps down', host.includes('[80, 70, 60, 50]') || /80, 70, 60, 50/.test(host))
  check('the raw PNG is removed after optimising', host.includes('rmSync(target'))
}

console.log(failures === 0 ? '\nall screenshot checks passed' : `\n${failures} check(s) failed`)
if (failures > 0) process.exitCode = 1

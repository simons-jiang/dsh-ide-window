/**
 * Windows: drive-letter paths, `explorer` for the browser, `.bat` launchers.
 */
import { homedir } from 'node:os'

/** @type {import('./contract.js').IdePlatform} */
export const windowsPlatform = {
  name: 'windows',
  // Windows compares paths case-insensitively, and tools disagree on the drive
  // letter's case (`c:/…` from the language server, `C:/…` from the workspace);
  // the drive letter is canonicalised here so the rest of the plugin can keep
  // comparing strings.
  toPosix: (path) => String(path ?? '').replace(/\\/g, '/').replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`),
  toNative: (path) => String(path ?? '').replace(/\//g, '\\'),
  isAbsolutePath: (path) => {
    const text = windowsPlatform.toPosix(path)
    // A drive letter, a UNC share, or a rooted path on the current drive.
    return /^[A-Za-z]:\//.test(text) || text.startsWith('//') || text.startsWith('/')
  },
  expandUserPath: (path) => {
    const home = homedir()
    return String(path ?? '')
      .replace(/\$\{user\.home\}/g, home)
      .replace(/\$\{env\.USERPROFILE\}/g, home)
      .replace(/\$\{env\.HOME\}/g, home)
      .replace(/^~(?=[\\/])/, home)
  },
  ripgrepSuffixes: [
    '@vscode/ripgrep-win32-x64/bin/rg.exe',
    '@vscode/ripgrep-win32-arm64/bin/rg.exe',
    '@vscode/ripgrep/bin/rg.exe',
  ],
  serverLauncherNames: ['intellij-server.bat', 'intellij-server.cmd', 'intellij-server.exe', 'intellij-server'],
  // Node (CVE-2024-27980) refuses to spawn a .bat/.cmd without a shell. The
  // licence verbs take no arguments that contain spaces, so a shell is safe.
  needsShell: (path) => /\.(bat|cmd)$/i.test(String(path ?? '')),
  // `explorer <url>` opens the browser but reports an unreliable exit code and
  // goes through a shell layer; `cmd /c start ""` is the documented form and
  // keeps the empty title argument that `start` needs for a quoted URL.
  openUrlCommand: (url) => ({ command: 'cmd', args: ['/c', 'start', '', url] }),
  // .NET (part of Windows) captures the virtual screen and fills the clipboard,
  // so no third-party tool is needed. The script writes a real PNG file.
  screenshotCommand: (path) => ({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', windowsScreenshotScript(path)],
  }),
  imageOptimizeCommand: (input, output, quality, longEdge) => ({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', windowsOptimizeScript(input, output, quality, longEdge)],
  }),
  clipboardImageCommand: (path) => ({
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', windowsClipboardScript(path)],
  }),
}

/** The PowerShell that grabs every monitor into one PNG. */
function windowsScreenshotScript(path) {
  const target = String(path ?? '').replace(/'/g, "''")
  return [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bitmap.Size)',
    `$bitmap.Save('${target}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$graphics.Dispose()',
    '$bitmap.Dispose()',
  ].join('; ')
}

/** The PowerShell that shrinks a capture to a 1080p-class JPEG. */
function windowsOptimizeScript(input, output, quality, longEdge) {
  const source = String(input ?? '').replace(/'/g, "''")
  const target = String(output ?? '').replace(/'/g, "''")
  const level = Math.min(100, Math.max(10, Number.isFinite(quality) ? quality : 80))
  const edge = Number.isFinite(longEdge) && longEdge > 0 ? Math.round(longEdge) : 1920
  return [
    'Add-Type -AssemblyName System.Drawing',
    `$source = [System.Drawing.Image]::FromFile('${source}')`,
    '$long = [Math]::Max($source.Width, $source.Height)',
    `$scale = [Math]::Min(1.0, ${edge} / $long)`,
    '$width = [int][Math]::Round($source.Width * $scale)',
    '$height = [int][Math]::Round($source.Height * $scale)',
    '$bitmap = New-Object System.Drawing.Bitmap $width, $height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$graphics.DrawImage($source, 0, 0, $width, $height)',
    '$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }',
    '$parameters = New-Object System.Drawing.Imaging.EncoderParameters(1)',
    `$parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${level})`,
    `$bitmap.Save('${target}', $codec, $parameters)`,
    '$graphics.Dispose()',
    '$bitmap.Dispose()',
    '$source.Dispose()',
  ].join('; ')
}

/** The PowerShell that puts an existing PNG on the clipboard. */
function windowsClipboardScript(path) {
  const target = String(path ?? '').replace(/'/g, "''")
  return [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    `$image = [System.Drawing.Image]::FromFile('${target}')`,
    '[System.Windows.Forms.Clipboard]::SetImage($image)',
    '$image.Dispose()',
  ].join('; ')
}

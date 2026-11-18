/**
 * Windows: drive-letter paths, `explorer` for the browser, `.bat` launchers.
 */
import { homedir } from 'node:os'

/** @type {import('./contract.js').IdePlatform} */
export const windowsPlatform = {
  name: 'windows',
  toPosix: (path) => String(path ?? '').replace(/\\/g, '/'),
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
}

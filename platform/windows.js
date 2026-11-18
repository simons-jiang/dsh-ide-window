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
  openUrlCommand: (url) => ({ command: 'explorer', args: [url] }),
}

/**
 * macOS: POSIX paths, `open` for the browser, `.app` bundles for tools.
 */
import { homedir } from 'node:os'

/** @type {import('./contract.js').IdePlatform} */
export const macPlatform = {
  name: 'mac',
  toPosix: (path) => String(path ?? ''),
  toNative: (path) => String(path ?? ''),
  isAbsolutePath: (path) => {
    const text = String(path ?? '')
    return text.startsWith('/')
  },
  expandUserPath: (path) => {
    const text = String(path ?? '')
    const home = homedir()
    return text
      .replace(/\$\{user\.home\}/g, home)
      .replace(/\$\{env\.HOME\}/g, home)
      .replace(/^~(?=\/)/, home)
  },
  ripgrepSuffixes: [
    '@vscode/ripgrep-darwin-arm64/bin/rg',
    '@vscode/ripgrep-darwin-x64/bin/rg',
  ],
  serverLauncherNames: ['intellij-server'],
  openUrlCommand: (url) => ({ command: 'open', args: [url] }),
}

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
  needsShell: () => false,
  openUrlCommand: (url) => ({ command: 'open', args: [url] }),
  // Both tools ship with macOS: `screencapture` writes the PNG and AppleScript
  // puts it on the pasteboard, so nothing has to be installed.
  screenshotCommand: (path) => ({ command: 'screencapture', args: ['-x', '-t', 'png', String(path ?? '')] }),
  // `sips` ships with macOS: `-Z` fits the long edge and `-s formatOptions` is
  // the JPEG quality. A Retina capture is 5120×2880; 1080p is plenty for chat.
  imageOptimizeCommand: (input, output, quality, longEdge) => ({
    command: 'sips',
    args: [
      '-Z', String(longEdge ?? 1920),
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(quality),
      String(input ?? ''),
      '--out', String(output ?? ''),
    ],
  }),
  clipboardImageCommand: (path) => ({
    command: 'osascript',
    args: ['-e', `set the clipboard to (read (POSIX file "${String(path ?? '')}") as «class PNGf»)`],
  }),
}

/**
 * The contract every platform implementation follows.
 *
 * The workspace keeps one place per operation that differs between operating
 * systems. `index.js` asks `platform/index.js` for the current platform instead
 * of branching on `process.platform`, so adding a system means one more file
 * that satisfies this contract — not another `if` scattered through the Host.
 *
 * A filesystem root is not a platform difference: `node:path` already knows it
 * (`parse(path).root`), so the contract does not carry one.
 *
 * Paths inside the plugin are **POSIX**: every path that crosses a route, a
 * preference or the browser is slash separated. A platform converts at its
 * boundary (`toPosix`) and back only when showing it to the user (`toNative`).
 *
 * @typedef {object} IdePlatform
 * @property {string} name                  `mac` or `windows`.
 * @property {(path: string) => string} toPosix   Native or mixed path → slashes.
 * @property {(path: string) => string} toNative  Slash path → platform form.
 * @property {(path: string) => boolean} isAbsolutePath
 * @property {(path: string) => string} expandUserPath  `${user.home}`, `~` → home.
 * @property {string[]} ripgrepSuffixes     Binary paths inside the bundled packages.
 * @property {string[]} serverLauncherNames Launcher file names, in try order.
 * @property {(url: string) => { command: string, args: string[] }} openUrlCommand
 */

/** Every member a platform implementation must carry. */
export const PLATFORM_METHODS = [
  'name',
  'toPosix',
  'toNative',
  'isAbsolutePath',
  'expandUserPath',
  'ripgrepSuffixes',
  'serverLauncherNames',
  'openUrlCommand',
]

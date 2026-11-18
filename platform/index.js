/**
 * Pick the platform implementation for this Host.
 *
 * Only macOS and Windows are supported. Anything else resolves to the POSIX
 * (macOS) implementation, which also keeps Linux working as well as it did
 * before a Windows port existed.
 */
import { macPlatform } from './macos.js'
import { windowsPlatform } from './windows.js'

const IMPLEMENTATIONS = {
  mac: macPlatform,
  windows: windowsPlatform,
}

/**
 * Only macOS is "the mac implementation"; everything else is Windows, which is
 * the rule the plugin follows everywhere (`macos` or not).
 *
 * @param {string} os - `process.platform` value, or a short name.
 */
export function createPlatform(os) {
  const macOs = os === 'darwin' || os === 'macos' || os === 'mac'
  return macOs ? IMPLEMENTATIONS.mac : IMPLEMENTATIONS.windows
}

/** The running Host's platform. */
export const platform = createPlatform(process.platform)
export { macPlatform, windowsPlatform }

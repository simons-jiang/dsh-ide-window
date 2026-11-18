/**
 * The Host platform layer: macOS and Windows implementations of one contract.
 *
 * The plugin keeps every OS difference in `platform/`, so these checks are what
 * proves a new implementation is complete and that the two shipped ones really
 * differ where they should.
 */
import { homedir } from 'node:os'
import { createPlatform, macPlatform, windowsPlatform } from '../platform/index.js'
import { PLATFORM_METHODS } from '../platform/contract.js'

const checks = []
const check = (ok, label, detail) => checks.push({ ok, label, detail })

check(createPlatform('darwin') === macPlatform, 'darwin resolves to the macOS implementation', String(createPlatform('darwin').name))
check(createPlatform('win32') === windowsPlatform, 'win32 resolves to the Windows implementation', String(createPlatform('win32').name))
check(createPlatform('linux') === windowsPlatform, 'anything that is not macOS takes the Windows behaviour', String(createPlatform('linux').name))

for (const implementation of [macPlatform, windowsPlatform]) {
  const missing = PLATFORM_METHODS.filter((member) => implementation[member] === undefined)
  check(missing.length === 0, `${implementation.name} implements the whole contract`, missing.join(', '))
}


check(macPlatform.toPosix('/Users/a/b') === '/Users/a/b', 'macOS paths are already POSIX', macPlatform.toPosix('/Users/a/b'))
check(windowsPlatform.toPosix('C:\\Users\\a\\b') === 'C:/Users/a/b', 'Windows paths become POSIX', windowsPlatform.toPosix('C:\\Users\\a\\b'))
check(windowsPlatform.toNative('C:/Users/a/b') === 'C:\\Users\\a\\b', 'Windows paths go back to native form', windowsPlatform.toNative('C:/Users/a/b'))
check(macPlatform.toNative('/Users/a/b') === '/Users/a/b', 'macOS keeps its native form', macPlatform.toNative('/Users/a/b'))

check(macPlatform.isAbsolutePath('/Users/a') === true, 'macOS accepts a rooted path', macPlatform.isAbsolutePath('/Users/a'))
check(macPlatform.isAbsolutePath('Users/a') === false, 'macOS refuses a relative path', macPlatform.isAbsolutePath('Users/a'))
check(windowsPlatform.isAbsolutePath('C:\\work\\app') === true, 'Windows accepts a drive path', windowsPlatform.isAbsolutePath('C:\\work\\app'))
check(windowsPlatform.isAbsolutePath('C:/work/app') === true, 'Windows accepts a slash drive path', windowsPlatform.isAbsolutePath('C:/work/app'))
check(windowsPlatform.isAbsolutePath('\\\\server\\share\\app') === true, 'Windows accepts a UNC path', windowsPlatform.isAbsolutePath('\\\\server\\share\\app'))
check(windowsPlatform.isAbsolutePath('work\\app') === false, 'Windows refuses a relative path', windowsPlatform.isAbsolutePath('work\\app'))

check(macPlatform.expandUserPath('~/.m2/repository') === `${homedir()}/.m2/repository`, 'macOS expands ~', macPlatform.expandUserPath('~/.m2/repository'))
check(windowsPlatform.expandUserPath('${user.home}\\.m2\\repository') === `${homedir()}\\.m2\\repository`, 'Windows expands ${user.home}', windowsPlatform.expandUserPath('${user.home}\\.m2\\repository'))

check(macPlatform.ripgrepSuffixes.every((suffix) => suffix.includes('darwin') && suffix.endsWith('/rg')), 'macOS lists its own ripgrep builds', macPlatform.ripgrepSuffixes.join(' '))
check(windowsPlatform.ripgrepSuffixes.every((suffix) => suffix.endsWith('rg.exe')), 'Windows lists .exe ripgrep builds', windowsPlatform.ripgrepSuffixes.join(' '))
check(windowsPlatform.ripgrepSuffixes.some((suffix) => suffix.includes('win32')), 'Windows covers its own architecture builds', windowsPlatform.ripgrepSuffixes.join(' '))
check(macPlatform.serverLauncherNames.includes('intellij-server'), 'macOS runs the launcher directly', macPlatform.serverLauncherNames.join(' '))
check(windowsPlatform.serverLauncherNames.includes('intellij-server.bat'), 'Windows runs the .bat launcher', windowsPlatform.serverLauncherNames.join(' '))
check(macPlatform.openUrlCommand('https://x.test').command === 'open', 'macOS opens URLs with open', macPlatform.openUrlCommand('https://x.test').command)
check(windowsPlatform.openUrlCommand('https://x.test').command === 'explorer', 'Windows opens URLs with explorer', windowsPlatform.openUrlCommand('https://x.test').command)

const failed = checks.filter((entry) => entry.ok !== true)
for (const entry of checks) if (entry.ok === true) console.log(`  ✓ ${entry.label}`)
for (const entry of failed) console.log(`  ✗ ${entry.label} — ${entry.detail}`)
console.log(failed.length === 0 ? 'all platform checks passed' : `${failed.length} platform check(s) failed`)
process.exitCode = failed.length === 0 ? 0 : 1

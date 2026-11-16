/**
 * Accessor-ownership inference, checked against fixture source.
 *
 * This is the layer below the UI: it proves which class a click on `getX`/`setX`
 * is attributed to, which is what decides whether the jar lookup can run at all.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../src/client/65-lsp.js'), 'utf8')

const grab = (name) => {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`missing ${name}`)
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unbalanced ${name}`)
}

const helpers = ['ideDeclaredType', 'ideFindFieldLine', 'ideMethodRefOwner', 'ideReceiverToken', 'ideGenericArgument', 'ideChainBase']
const api = new Function(`${helpers.map(grab).join('\n')}\nreturn { ${helpers.join(', ')} }`)()

const lines = readFileSync(join(here, 'fixtures/AccessorCases.java'), 'utf8').split('\n')
const lineOf = (needle) => lines.findIndex((text) => text.includes(needle))

let failed = 0
const check = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!ok) failed += 1
}

// ① 局部变量接收者：older.setBusinessDate(...)
{
  const index = lineOf('older.setBusinessDate')
  const before = lines[index].slice(0, lines[index].indexOf('setBusinessDate'))
  const receiver = api.ideReceiverToken(before)
  check(receiver === 'older', 'receiver of a plain call', receiver)
  check(api.ideDeclaredType(lines, receiver) === 'QuoteInnerResp', 'declared type of a local variable', api.ideDeclaredType(lines, receiver))
}

// ② 链式接收者：captor.getValue().getBusinessDate()
{
  const index = lineOf('captor.getValue().getBusinessDate')
  const before = lines[index].slice(0, lines[index].indexOf('getBusinessDate'))
  const receiver = api.ideReceiverToken(before)
  check(receiver === 'getValue', 'receiver of a chained call', receiver)
  check(api.ideChainBase(before, receiver) === 'captor', 'the chain base variable', api.ideChainBase(before, receiver))
  check(api.ideGenericArgument(lines, api.ideChainBase(before, receiver)) === 'QuoteInnerResp', 'generic argument answers the chain', api.ideGenericArgument(lines, 'captor'))
}

// ②b 带包名的泛型声明：org.mockito.ArgumentCaptor<T> x
{
  const index = lineOf('qualified.getValue().getBusinessDate')
  const before = lines[index].slice(0, lines[index].indexOf('getBusinessDate'))
  const receiver = api.ideReceiverToken(before)
  check(api.ideChainBase(before, receiver) === 'qualified', 'chain base of a qualified generic', api.ideChainBase(before, receiver))
  check(api.ideGenericArgument(lines, 'qualified') === 'QuoteInnerResp', 'fully qualified generic declaration', api.ideGenericArgument(lines, 'qualified'))
}

// ③ 方法引用：QuoteInnerResp::getBusinessDate
{
  const index = lineOf('QuoteInnerResp::getBusinessDate')
  const column = lines[index].indexOf('getBusinessDate')
  check(api.ideMethodRefOwner(lines[index], column) === 'QuoteInnerResp', 'owner of a method reference', api.ideMethodRefOwner(lines[index], column))
}

// ④ 字段行定位（用真实 jar 里的源码）
{
  const text = 'public class X {\n    private Long serialVersionUID = 1L;\n    /** 日期 */\n    private LocalDate businessDate;\n    public LocalDate getBusinessDate() {\n        return businessDate;\n    }\n}'
  const fieldLines = text.split('\n')
  check(api.ideFindFieldLine(fieldLines, 'businessDate') === 4, 'field line found', String(api.ideFindFieldLine(fieldLines, 'businessDate')))
  check(api.ideFindFieldLine(fieldLines, 'serialVersionUID') === 2, 'static field still matches', String(api.ideFindFieldLine(fieldLines, 'serialVersionUID')))
  check(api.ideFindFieldLine(fieldLines, 'getBusinessDate') === 0, 'a method is not a field', String(api.ideFindFieldLine(fieldLines, 'getBusinessDate')))
}

console.log(failed === 0 ? '\nall inference checks passed' : `\n${failed} inference check(s) failed`)
process.exit(failed === 0 ? 0 : 1)

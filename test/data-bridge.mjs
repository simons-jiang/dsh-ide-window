/**
 * Mapper 语句转 SQL（数据窗口「打开 SQL」）的行为，对着真实形状的 mapper XML 跑。
 *
 * 这里是回归锁：`WHERE <include refid="orderFilters"/>` 早先被整段删掉，数据窗口
 * 收到的 SQL 是 `WHERE` 后面直接 `ORDER BY`，一执行就报语法错误。include 的展开、
 * 跨命名空间引用、include property、找不到时的注释，都由这些用例守住。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '../src/client/73-data-bridge.js'), 'utf8')

let failed = 0
const check = (condition, label, detail) => {
  console.log(`${condition ? '  ✓' : '  ✗'} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  if (!condition) failed += 1
}

/** 一个假工作区：路径 → 文件内容，grep 只在里面找 namespace。 */
function workspace(files) {
  const root = '/fake/workspace'
  const grep = async (workspaceRoot, query) => {
    const match = /^namespace="(.*)"$/.exec(String(query))
    if (match === null) return { ok: true, matches: [] }
    const hits = Object.entries(files)
      .filter(([, text]) => text.includes(`namespace="${match[1]}"`))
      .map(([path]) => ({ path, line: 1 }))
    return { ok: true, matches: hits }
  }
  const tree = async (route, body) => {
    const text = files[String(body?.path ?? '')]
    return text === undefined ? { ok: false } : { ok: true, value: { text } }
  }
  return {
    grep,
    tree,
    /** 只取 73-data-bridge.js 里的纯函数与解析函数来跑。 */
    api: new Function('ideTreeRoute', 'ideGrepQuery', 'ideBasename', `${source}
      return {
        ideDataWindowSqlFragments,
        ideDataWindowIncludes,
        ideDataWindowXmlSql,
        ideDataWindowStripTags,
        ideDataWindowExecutableSql,
        ideDataWindowOpenMapper,
      }`)(tree, grep, (path) => String(path).split('/').pop()),
    root,
  }
}

const ORDER_MAPPER = `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="com.yibuyun.bluewhale.order.mapper.PlatformOrderMapper">
  <sql id="orderFilters">
    <if test="req.orderNo != null and req.orderNo != ''">
      AND p.order_no = #{req.orderNo}
    </if>
    AND p.deleted = 0
    <include refid="dateFilters"/>
  </sql>
  <sql id="dateFilters">
    <if test="req.startTime != null">
      AND p.order_time &gt;= #{req.startTime}
    </if>
  </sql>
  <select id="pageByQuery" resultType="com.yibuyun.bluewhale.order.entity.PlatformOrderEntity">
    SELECT p.*
    FROM platform_order p
    WHERE <include refid="orderFilters"/>
    ORDER BY p.order_time DESC, p.order_id DESC
  </select>
</mapper>
`

const PARAMS = { req: 'PlatformOrderQueryReq' }

console.log('\ndata bridge: mapper include 展开')

const orders = workspace({
  'bluewhale-order-service-application/src/main/resources/mapper/PlatformOrderMapper.xml': ORDER_MAPPER,
})
const ordersApi = orders.api
const statement = await ordersApi.ideDataWindowXmlSql(
  orders.root,
  'com.yibuyun.bluewhale.order.mapper.PlatformOrderMapper',
  'pageByQuery',
)

check(statement !== null, '找到 pageByQuery 语句')
check(statement?.missing.length === 0, '所有 include 都解析成功', JSON.stringify(statement?.missing))
check(
  /AND p\.order_no = #\{req\.orderNo\}/.test(statement?.sql ?? ''),
  'include 里的条件进了语句',
  statement?.sql,
)

const executable = ordersApi.ideDataWindowExecutableSql(statement?.sql ?? '', PARAMS)
check(executable.includes('WHERE p.order_no = 1'), '同文件 include 展开成可执行条件', executable)
check(executable.includes('AND p.deleted = 0'), 'include 里的静态条件保留', executable)
check(executable.includes('AND p.order_time >= 1'), '嵌套 include 也展开（并解掉 &gt;=）', executable)
check(!/include/i.test(executable), '不残留 include 标签', executable)
check(!/\bWHERE\s+ORDER\s+BY\b/i.test(executable), 'WHERE 后面不会直接接 ORDER BY', executable)
check(!/WHERE\s+AND\b/i.test(executable), '裸 WHERE 后面跟 AND 时归一位', executable)
check(executable.includes('ORDER BY p.order_time DESC, p.order_id DESC'), 'ORDER BY 原样保留', executable)

console.log('\ndata bridge: 跨命名空间 include 与 property')

const crossApi = workspace({
  'src/main/resources/mapper/OrderMapper.xml': `<mapper namespace="com.x.OrderMapper">
  <select id="pageByQuery">
    SELECT <include refid="com.x.CommonFilters.columns"><property name="alias" value="p"/></include>
    FROM platform_order p
    WHERE <include refid="com.x.CommonFilters.tenantFilter"/>
  </select>
</mapper>
`,
  'src/main/resources/mapper/CommonFilters.xml': `<mapper namespace="com.x.CommonFilters">
  <sql id="columns">\${alias}.id, \${alias}.order_no</sql>
  <sql id="tenantFilter">p.tenant_id = #{req.tenantId}</sql>
</mapper>
`,
})
const cross = await crossApi.api.ideDataWindowXmlSql(crossApi.root, 'com.x.OrderMapper', 'pageByQuery')
const crossSql = crossApi.api.ideDataWindowExecutableSql(cross?.sql ?? '', PARAMS)
check(cross?.missing.length === 0, '跨文件 include 全部解析', JSON.stringify(cross?.missing))
check(crossSql.includes('SELECT p.id, p.order_no'), 'include property 替换了 ${alias}', crossSql)
check(crossSql.includes('WHERE p.tenant_id = 1'), '跨命名空间片段接进了 WHERE', crossSql)

console.log('\ndata bridge: include 解析不出来时不静默吞掉')

const brokenApi = workspace({
  'src/main/resources/mapper/OrderMapper.xml': `<mapper namespace="com.x.OrderMapper">
  <select id="pageByQuery">
    SELECT *
    FROM platform_order p
    WHERE <include refid="nope"/>
    ORDER BY p.order_id DESC
  </select>
</mapper>
`,
})
const broken = await brokenApi.api.ideDataWindowXmlSql(brokenApi.root, 'com.x.OrderMapper', 'pageByQuery')
const brokenSql = brokenApi.api.ideDataWindowExecutableSql(broken?.sql ?? '', PARAMS)
check(broken?.missing.join(',') === 'nope', '缺的 refid 被报出来', JSON.stringify(broken?.missing))
check(brokenSql.includes('/* include not found: nope */'), '缺失位置留一条注释', brokenSql)
check(!/\bWHERE\s+\/\*/.test(brokenSql), '空 WHERE 被去掉，SQL 还能跑', brokenSql)
check(/\bORDER BY p\.order_id DESC/.test(brokenSql), '顺序不受影响', brokenSql)

console.log('\ndata bridge: 循环 include 不递归失控')

const cycleApi = workspace({
  'src/main/resources/mapper/LoopMapper.xml': `<mapper namespace="com.x.LoopMapper">
  <sql id="a">1 = 1 <include refid="a"/></sql>
  <select id="boom">SELECT * FROM t WHERE <include refid="a"/></select>
</mapper>
`,
})
const cycle = await cycleApi.api.ideDataWindowXmlSql(cycleApi.root, 'com.x.LoopMapper', 'boom')
const cycleSql = cycleApi.api.ideDataWindowExecutableSql(cycle?.sql ?? '', PARAMS)
check(cycle?.missing.includes('a') === true, '循环引用被报出来', JSON.stringify(cycle?.missing))
check(cycleSql.includes('/* include cycle: a */'), '循环处留注释而不是死循环', cycleSql)

console.log('\ndata bridge: include 解析器的边界')

const includeApi = workspace({})
const items = includeApi.api.ideDataWindowIncludes(
  'SELECT <include refid="cols"/> FROM t WHERE <include refid="f"><property name="a" value="b"/></include>',
)
check(items.length === 2, '自闭合与成对 include 各算一个', String(items.length))
check(items[0].body === '', '自闭合 include 没有吞掉后面的成对标签', items[0].body)
check(items[1].body.includes('<property'), '成对 include 的子标签收在自己身上', items[1].body)

const fragments = includeApi.api.ideDataWindowSqlFragments(`<mapper>
  <sql id="one">a</sql>
  <sql id="two"><![CDATA[ b < 2 ]]></sql>
</mapper>
`)
check(fragments.one === 'a' && fragments.two.includes('< 2'), '同一文件的多个片段都索引到', JSON.stringify(fragments))

const dangling = includeApi.api.ideDataWindowExecutableSql('SELECT * FROM t WHERE ORDER BY id', {})
check(!/\bWHERE\b/.test(dangling), '本来就没有条件的 WHERE 也去掉', dangling)

console.log('\ndata bridge: 点 pageByQuery 时发出去的 openSql 请求')

/** 假桥：记录请求，立刻回一条 ok 的回执。 */
async function captureOpenSql(api, root, path, line) {
  const handlers = new Set()
  const requests = []
  const saved = {
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
    dispatchEvent: globalThis.dispatchEvent,
    bridge: globalThis.__DSH_DATA_WINDOW_BRIDGE__,
  }
  globalThis.__DSH_DATA_WINDOW_BRIDGE__ = { v: 1 }
  globalThis.addEventListener = (name, handler) => handlers.add(handler)
  globalThis.removeEventListener = (name, handler) => handlers.delete(handler)
  globalThis.dispatchEvent = (event) => {
    requests.push(event.detail)
    setTimeout(() => {
      for (const handler of handlers) handler({ detail: { v: 1, id: event.detail.id, action: event.detail.action, ok: true } })
    }, 0)
    return true
  }
  const store = { notices: [], setNotice(text) { this.notices.push(text) } }
  try {
    await api.ideDataWindowOpenMapper(store, (key) => key, root, path, 'pageByQuery', line)
  } finally {
    globalThis.addEventListener = saved.addEventListener
    globalThis.removeEventListener = saved.removeEventListener
    globalThis.dispatchEvent = saved.dispatchEvent
    globalThis.__DSH_DATA_WINDOW_BRIDGE__ = saved.bridge
  }
  return { request: requests[0], notices: store.notices }
}

const clickApi = workspace({
  'bluewhale-order-service-application/src/main/java/com/yibuyun/bluewhale/order/mapper/PlatformOrderMapper.java': `package com.yibuyun.bluewhale.order.mapper;

@Mapper
public interface PlatformOrderMapper extends BaseMapper<PlatformOrderEntity>
{
    /**
     * 分页查询
     */
    Page<PlatformOrderEntity> pageByQuery(Page<PlatformOrderEntity> page, @Param("req") PlatformOrderQueryReq req);
}
`,
  'bluewhale-order-service-application/src/main/resources/mapper/PlatformOrderMapper.xml': ORDER_MAPPER,
})
const clicked = await captureOpenSql(
  clickApi.api,
  clickApi.root,
  'bluewhale-order-service-application/src/main/java/com/yibuyun/bluewhale/order/mapper/PlatformOrderMapper.java',
  8,
)
const payload = clicked.request ?? {}
check(payload.action === 'openSql', '发出的是 openSql 请求', String(payload.action))
check(payload.title === 'PlatformOrderMapper.pageByQuery', '标题带类名与方法名', payload.title)
check(/-- defaults: page=1; req=1/.test(payload.sql ?? ''), '头部列出默认参数', payload.sql)
check(!/-- unresolved include/.test(payload.sql ?? ''), '没有未解析的 include', payload.sql)
check((payload.sql ?? '').includes('WHERE p.order_no = 1'), 'SQL 带上了 otherFilters 里的条件', payload.sql)
check(!/\bWHERE\s+ORDER\s+BY\b/i.test(payload.sql ?? ''), '不会发出空 WHERE 的 SQL', payload.sql)
check(clicked.notices.includes('dataWindowOpening'), '点击后先提示正在打开', JSON.stringify(clicked.notices))

console.log('\ndata bridge: 真实 SQL 不会被当成标签删掉')

const textApi = includeApi.api
const lessThan = textApi.ideDataWindowExecutableSql('SELECT * FROM t WHERE a < 5 AND b > 3 ORDER BY id', {})
check(lessThan.includes('a < 5 AND b > 3'), '`&lt;`/`&gt;` 解出来的比较运算符保留', lessThan)
const cdata = textApi.ideDataWindowExecutableSql('SELECT * FROM t WHERE <![CDATA[ a < 5 ]]> ORDER BY id', {})
check(cdata.includes('a < 5'), 'CDATA 里的 SQL 保留', cdata)
const unknownTag = textApi.ideDataWindowExecutableSql('SELECT * FROM t <foo x="1">WHERE x = 1</foo>', {})
check(!/foo/.test(unknownTag) && unknownTag.includes('WHERE x = 1'), '未知标签仍然清掉', unknownTag)

console.log('\ndata bridge: 动态标签照旧')

const dynamic = includeApi.api.ideDataWindowExecutableSql(`SELECT * FROM t
  <where>
    <if test="req.a != null">AND a = 1</if>
    <if test="req.b != null">AND b = 2</if>
  </where>
  ORDER BY id`, {})
check(/WHERE a = 1\s+AND b = 2/.test(dynamic), 'where + if 展开成静态条件', dynamic)

if (failed > 0) {
  console.log(`\ndata bridge: ${failed} 项失败`)
  process.exitCode = 1
} else {
  console.log('\ndata bridge: 全部通过')
}

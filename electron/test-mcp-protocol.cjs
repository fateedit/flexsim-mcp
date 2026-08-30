/**
 * MCP 协议全量测试夹具（⑤ 调试与验证）
 * ---------------------------------------------------------------
 * 覆盖：initialize 能力协商 / tools/list / tools/call（成功+失败+isError）
 *       prompts/list / prompts/get / logging 通知 / 错误码 / ping / list_changed
 * 运行：node electron/test-mcp-protocol.cjs
 */
const { spawn } = require('child_process')
const path = require('path')

const SERVER = path.join(__dirname, 'mcp-server.cjs')
let passed = 0
let failed = 0

function check(label, ok, detail) {
  if (ok) {
    passed++
    console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`)
  } else {
    failed++
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
  }
}

/** 连接一个服务器实例，发送一组请求，收集响应/通知 */
function connectWith(reqs, opts = {}) {
  return new Promise((resolve) => {
    const server = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    let buf = ''
    server.stdout.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          out.push(JSON.parse(line))
        } catch {
          /* ignore */
        }
      }
    })
    server.stderr.on('data', () => {})
    server.on('exit', () => resolve(out))
    setTimeout(() => {
      for (const r of reqs) server.stdin.write(JSON.stringify(r) + '\n')
    }, 300)
    // 收尾：关闭输入
    setTimeout(() => {
      try {
        server.stdin.end()
      } catch {
        /* ignore */
      }
    }, opts.closeAfter || 8000)
  })
}

const byId = (out, id) => out.find((m) => m.id === id)
const notifs = (out) => out.filter((m) => m.method && !m.id)

;(async () => {
  console.log('== 场景1：握手 + 工具 + 提示 + 错误码（单连接） ==')
  const out = await connectWith([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'notifications/logging/setLevel', params: { level: 'debug' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'prompts/list' },
    { jsonrpc: '2.0', id: 4, method: 'prompts/get', params: { name: 'build_production_line', arguments: { description: '测试产线' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'webserver_status', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: {} },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
    { jsonrpc: '2.0', id: 8, method: 'bogus_method' },
    { jsonrpc: '2.0', id: 9, method: 'ping' }
  ])

  const init = byId(out, 1)
  check('initialize 返回 capabilities.tools', !!(init?.result?.capabilities?.tools))
  check('initialize 返回 capabilities.prompts', !!(init?.result?.capabilities?.prompts))
  check('initialize 返回 instructions 指南', (init?.result?.instructions || '').length > 100, `len=${(init.result.instructions || '').length}`)

  const tl = byId(out, 2)
  check('tools/list 返回工具', Array.isArray(tl?.result?.tools) && tl.result.tools.length > 0, `${tl?.result?.tools?.length ?? 0} 个`)

  const pl = byId(out, 3)
  check('prompts/list 返回 3 个提示', Array.isArray(pl?.result?.prompts) && pl.result.prompts.length === 3, pl?.result?.prompts?.map((p) => p.name).join(', '))

  const pg = byId(out, 4)
  const pmsgs = pg?.result?.messages || []
  check('prompts/get 返回 messages', pmsgs.length === 2 && pmsgs[0].role === 'system' && pmsgs[1].role === 'user')
  check('prompts/get 注入参数', pmsgs[1]?.content?.includes('测试产线'))

  const callOk = byId(out, 5)
  check('tools/call 成功 isError=false', callOk?.result?.isError === false, String(callOk?.result?.content?.[0]?.text).slice(0, 40))

  const callNoName = byId(out, 6)
  check('tools/call 缺 name → -32602', callNoName?.error?.code === -32602)

  const callUnknown = byId(out, 7)
  check('tools/call 未知工具 → isError=true', callUnknown?.result?.isError === true)

  const bogus = byId(out, 8)
  check('未知方法 → -32601', bogus?.error?.code === -32601)

  const ping = byId(out, 9)
  check('ping 返回 {}', JSON.stringify(ping?.result) === '{}')

  const msgs = notifs(out)
  check('收到 notifications/message（server started）', msgs.some((m) => m.method === 'notifications/message'))

  console.log('\n== 场景2：tools/list_changed 通知接收 ==')
  const wrapper = `
    const m = require(${JSON.stringify(SERVER)});
    m.run();
    setTimeout(() => m.emitToolsChanged(), 1500);
  `
  const changedOut = await new Promise((resolve) => {
    const server = spawn(process.execPath, ['-e', wrapper], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = []
    let buf = ''
    server.stdout.on('data', (d) => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try { out.push(JSON.parse(line)) } catch { /* ignore */ }
      }
    })
    server.on('exit', () => resolve(out))
    setTimeout(() => {
      server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n')
    }, 300)
    setTimeout(() => { try { server.stdin.end() } catch {} }, 5000)
  })
  check('收到 notifications/tools/list_changed', changedOut.some((m) => m.method === 'notifications/tools/list_changed'))

  console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====`)
  process.exit(failed ? 1 : 0)
})()

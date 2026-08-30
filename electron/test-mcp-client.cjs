/**
 * MCP 客户端冒烟测试：连接 mcp-server.cjs，在 ai 模型上完成
 * 读 → 建对象 → 定位 → 验证 → 删除 的完整流程。
 * 运行：node electron/test-mcp-client.cjs
 */
const { spawn } = require('child_process')
const path = require('path')

const server = spawn(process.execPath, [path.join(__dirname, 'mcp-server.cjs')], {
  stdio: ['pipe', 'pipe', 'pipe']
})

let buf = ''
const pending = new Map()
let nextId = 1

server.stdout.on('data', (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
})

server.stderr.on('data', (d) => process.stderr.write('[mcp] ' + d))

function call(method, params) {
  return new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function show(label, msg) {
  const text = msg.result?.content?.[0]?.text
    ?? (msg.error ? 'ERROR: ' + msg.error.message : JSON.stringify(msg.result))
  console.log(`\n=== ${label} ===\n${String(text).slice(0, 400)}`)
}

;(async () => {
  await sleep(400)
  show('initialize（连接握手）', await call('initialize', { protocolVersion: '2024-11-05' }))
  show('list_instances（确认目标实例）', await call('tools/call', { name: 'list_instances', arguments: {} }))
  show('list_tree(MODEL:)（看模型根层）', await call('tools/call', { name: 'list_tree', arguments: { path: 'MODEL:' } }))
  show('list_handlers（已部署功能）', await call('tools/call', { name: 'list_handlers', arguments: {} }))
  show('get_node(Q1)（读现有对象）', await call('tools/call', { name: 'get_node', arguments: { path: 'Q1' } }))

  // ── 写操作测试：建 → 定位 → 验证 → 删 ──
  show('create_object(Queue, TestQ)（通过 MCP 创建对象）', await call('tools/call', { name: 'create_object', arguments: { type: 'Queue', name: 'TestQ' } }))
  show('set_loc(TestQ, 0,5,0)（定位）', await call('tools/call', { name: 'set_loc', arguments: { object: 'TestQ', x: 0, y: 5, z: 0 } }))
  show('get_node(TestQ)（验证对象真实存在）', await call('tools/call', { name: 'get_node', arguments: { path: 'TestQ' } }))
  show('delete_object(TestQ)（发起删除）', await call('tools/call', { name: 'delete_object', arguments: { object: 'TestQ' } }))

  console.log('\n…等待 6 秒（删除为异步 3~8 秒生效）…')
  await sleep(6000)
  show('get_node(TestQ) 删除后（预期按文档：可能仍报存在=残留误报）', await call('tools/call', { name: 'get_node', arguments: { path: 'TestQ' } }))

  server.stdin.end()
  setTimeout(() => process.exit(0), 500)
})()

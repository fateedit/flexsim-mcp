#!/usr/bin/env node
/**
 * End-to-end stdio protocol test for the FlexSim WebServer MCP server.
 *
 * Spawns server/mcp-server.cjs as a child process and speaks real JSON-RPC 2.0
 * over stdin/stdout — the same way an MCP client does. The server is hand-written
 * JSON-RPC (zero dependencies), so protocol correctness is only provable here:
 * framing, id echo, isError vs -32xxx routing, and notification handling.
 *
 * No FlexSim required. Tests that need a live model are skipped with a notice.
 *
 * Usage:
 *   node tests/test-mcp-protocol.cjs
 *
 * Exit code 0 = all assertions passed.
 */
'use strict'

const { spawn } = require('child_process')
const path = require('path')

const SERVER = path.join(__dirname, '..', 'server', 'mcp-server.cjs')
const TIMEOUT_MS = 15000

let passed = 0
let failed = 0
const failures = []

function check(name, ok, detail) {
  if (ok) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    failures.push(name + (detail ? ` — ${detail}` : ''))
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`)
  }
}

/** One JSON-RPC request; resolves with the parsed response. */
function rpc(child, pending, method, params, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`timeout waiting for response id=${id} (${method})`))
    }, TIMEOUT_MS)
    pending.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg) } })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

/** Send a notification (no id, no response expected). */
function notify(child, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

function main() {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const pending = new Map()
  const notifications = []
  let stdoutBuf = ''
  let stderrText = ''

  // stdout must carry JSON-RPC only; anything else is a protocol violation.
  const stdoutNonJson = []

  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8')
    let nl
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl).trim()
      stdoutBuf = stdoutBuf.slice(nl + 1)
      if (!line) continue
      let msg
      try {
        msg = JSON.parse(line)
      } catch (e) {
        stdoutNonJson.push(line.slice(0, 200))
        continue
      }
      if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        p.resolve(msg)
      } else {
        notifications.push(msg)
      }
    }
  })

  child.stderr.on('data', (chunk) => { stderrText += chunk.toString('utf8') })

  let nextId = 1
  const id = () => nextId++

  const run = async () => {
    console.log('FlexSim WebServer MCP — stdio protocol test')
    console.log(`server: ${SERVER}\n`)

    // ── 1. initialize: version negotiation, capabilities, serverInfo ──
    console.log('[1] initialize')
    const init = await rpc(child, pending, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'protocol-test', version: '1.0.0' },
    }, id())
    check('responds with result (no error)', !init.error, JSON.stringify(init.error))
    const res = init.result || {}
    check('protocolVersion present', typeof res.protocolVersion === 'string', res.protocolVersion)
    check('capabilities.tools announced', !!(res.capabilities && res.capabilities.tools))
    check('capabilities.prompts announced', !!(res.capabilities && res.capabilities.prompts))
    check('serverInfo present', !!(res.serverInfo && res.serverInfo.name), JSON.stringify(res.serverInfo))
    const instr = typeof res.instructions === 'string' ? res.instructions : ''
    check('instructions injected (guide)', instr.length > 200, `length=${instr.length}`)

    notify(child, 'notifications/initialized', {})

    // ── 2. tools/list ──
    console.log('\n[2] tools/list')
    const tl = await rpc(child, pending, 'tools/list', {}, id())
    const tools = (tl.result && tl.result.tools) || []
    check('returns a non-empty tool list', tools.length > 0, `count=${tools.length}`)
    check('every tool has name + description + inputSchema',
      tools.every((t) => t.name && t.description && t.inputSchema),
      tools.filter((t) => !(t.name && t.description && t.inputSchema)).map((t) => t.name).join(','))
    const required = ['get_guide', 'list_instances', 'create_object', 'connect_objects', 'delete_object', 'deploy_handler', 'call_handler']
    const names = tools.map((t) => t.name)
    check('key tools present', required.every((r) => names.includes(r)),
      required.filter((r) => !names.includes(r)).join(',') || 'all present')

    // ── 3. tools/call: success path (no FlexSim needed) ──
    console.log('\n[3] tools/call — get_guide')
    const g = await rpc(child, pending, 'tools/call', { name: 'get_guide', arguments: {} }, id())
    const gRes = g.result || {}
    const gText = (gRes.content && gRes.content[0] && gRes.content[0].text) || ''
    check('get_guide returns text content', gText.length > 200, `length=${gText.length}`)
    check('get_guide isError=false', gRes.isError === false, String(gRes.isError))

    // ── 4. errors: unknown tool → result.isError (MCP spec, not JSON-RPC error) ──
    console.log('\n[4] tools/call — unknown tool')
    const u = await rpc(child, pending, 'tools/call', { name: '__no_such_tool__', arguments: {} }, id())
    check('unknown tool does not produce a JSON-RPC error', !u.error, JSON.stringify(u.error))
    check('unknown tool sets result.isError=true', !!(u.result && u.result.isError === true))

    // ── 5. errors: missing tool name → -32602 ──
    console.log('\n[5] tools/call — missing name')
    const m = await rpc(child, pending, 'tools/call', {}, id())
    check('missing name → code -32602', !!(m.error && m.error.code === -32602), JSON.stringify(m.error))

    // ── 6. errors: unknown method → -32601 ──
    console.log('\n[6] unknown method')
    const x = await rpc(child, pending, '__nope__', {}, id())
    check('unknown method → code -32601', !!(x.error && x.error.code === -32601), JSON.stringify(x.error))

    // ── 7. id echo ──
    console.log('\n[7] id echo')
    const id1 = await rpc(child, pending, 'ping', {}, 4242)
    check('response echoes the request id', id1.id === 4242, String(id1.id))

    // ── 8. prompts ──
    console.log('\n[8] prompts')
    const pl = await rpc(child, pending, 'prompts/list', {}, id())
    const prompts = (pl.result && pl.result.prompts) || []
    check('prompts/list returns templates', prompts.length > 0, `count=${prompts.length}`)
    const pg = await rpc(child, pending, 'prompts/get', { name: '__no_such_prompt__' }, id())
    check('unknown prompt → -32602', !!(pg.error && pg.error.code === -32602), JSON.stringify(pg.error))

    // ── 9. notifications/logging ──
    console.log('\n[9] notifications/logging/setLevel')
    notify(child, 'notifications/logging/setLevel', { level: 'debug' })
    await new Promise((r) => setTimeout(r, 300))

    // ── 10. stdout discipline ──
    console.log('\n[10] stdout discipline')
    check('stdout carried JSON-RPC only (no stray output)',
      stdoutNonJson.length === 0,
      stdoutNonJson.join(' | ').slice(0, 200))
    check('server logged to stderr, not stdout', stderrText.length > 0)
  }

  const finish = () => {
    child.kill()
    console.log(`\n${'='.repeat(52)}`)
    console.log(`  ${passed} passed, ${failed} failed`)
    if (failed) {
      console.log('\nFailures:')
      for (const f of failures) console.log('  - ' + f)
    }
    console.log('='.repeat(52))
    process.exit(failed ? 1 : 0)
  }

  run()
    .then(finish)
    .catch((err) => {
      console.log(`\nFATAL: ${err.message}`)
      if (stderrText) console.log('server stderr:\n' + stderrText.slice(0, 2000))
      process.exit(1)
    })

  child.on('exit', (code) => {
    // If the server died early, surface it instead of hanging on a timeout.
    setTimeout(() => {
      if (pending.size > 0) {
        console.log(`\nserver exited early (code ${code}) with ${pending.size} request(s) pending`)
        if (stderrText) console.log('server stderr:\n' + stderrText.slice(0, 2000))
        process.exit(1)
      }
    }, 200)
  })
}

main()

/**
 * FlexSim WebServer MCP Server（stdio）
 * ---------------------------------------------------------------
 * 把 registry.json 里定义的工具（WebServer handler 调用）包装成 MCP 协议，
 * 供 Claude Desktop / Cursor 等 MCP 客户端直接连接操作 FlexSim 模型。
 * 启动：electron . --mcp  或  node electron/mcp-server.cjs
 *
 * 注意：MCP stdio 协议下 stdout 只能输出 JSON-RPC 响应，日志一律走 stderr。
 */
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { spawn } = require('child_process')

const REGISTRY_PATH = process.env.FSW_REGISTRY || path.join(__dirname, '..', 'src', 'shared', 'registry.json')
const BASE = process.env.FLEXSIM_WS_BASE || 'http://localhost/webserver.dll'
const TIMEOUT = 30000

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'))

// WebServer 服务目录与 node（用于 start_webserver；可用环境变量覆盖）
const WS_DIR = process.env.FLEXSIM_WS_DIR || 'C:\\Program Files (x86)\\FlexSim Web Server\\webserver'
const NODE_EXE = process.env.FLEXSIM_NODE || 'C:\\Program Files\\nodejs\\node.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 检测 WebServer（:80）是否在线 */
async function checkWebserver() {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), 4000)
  try {
    const res = await fetch(append(BASE, { instancelist: '' }), { signal: c.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/** 直接启动 WebServer（当前用户权限；端口 80 绑定可能失败） */
function startWebserverDirect() {
  try {
    const proc = spawn(NODE_EXE, ['index.js'], {
      cwd: WS_DIR,
      detached: true,
      stdio: 'ignore'
    })
    proc.on('error', () => {})
    proc.unref()
    return true
  } catch {
    return false
  }
}

/** 提权（UAC）启动 WebServer */
function startWebserverElevated() {
  return new Promise((resolve) => {
    const ps =
      `Start-Process cmd.exe -Verb RunAs -ArgumentList '/c','cd /d "${WS_DIR}" && start "FlexSim WebServer" /MIN node index.js'`
    const proc = spawn('powershell.exe', ['-NoProfile', '-Command', ps], {
      windowsHide: true,
      stdio: 'ignore'
    })
    proc.on('error', () => resolve(false))
    proc.on('exit', () => resolve(true))
  })
}

// ── URL 工具 ──────────────────────────────────────────────
const enc = (s) => encodeURIComponent(String(s))
const encPath = (p) => encodeURIComponent(p).replace(/%2F/g, '/')

function append(url, params = {}, flags = [], raw = {}) {
  let out = url
  const sep = () => (out.includes('?') ? '&' : '?')
  for (const f of flags) out += sep() + f
  for (const [k, v] of Object.entries(raw)) out += sep() + k + '=' + v
  for (const [k, v] of Object.entries(params)) out += sep() + k + '=' + enc(v)
  return out
}

async function get(url, timeout = TIMEOUT) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeout)
  try {
    const res = await fetch(url, { signal: c.signal })
    const text = await res.text()
    // ⚠️ WebServer 怪行为：404/500 有时以「HTTP 200 + 正文 'HTTP/1.1 404 ...'」返回——
    // 归一化为 ok:false + 对应状态码，让各工具能正确识别错误
    const m = text.match(/^HTTP\/1\.1 (\d{3})/)
    if (m && res.ok) return { ok: false, status: Number(m[1]), text }
    return { ok: res.ok, status: res.status, text }
  } catch (e) {
    return { ok: false, status: 0, text: String((e && e.message) || e) }
  } finally {
    clearTimeout(t)
  }
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>'))
  return m ? m[1].trim() : ''
}

function xmlAll(xml, tag) {
  const out = []
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g')
  let m
  while ((m = re.exec(xml))) out.push(m[1].trim())
  return out
}

// ── 目标实例解析（未指定时取第一个在线实例） ─────────────────
async function resolveTarget(args) {
  let model = typeof args.model === 'string' && args.model ? args.model : ''
  let inst = typeof args.instance === 'number' ? args.instance : Number(args.instance) || 1
  if (!model) {
    const r = await get(append(BASE, { instancelist: '' }), 8000)
    const models = xmlAll(r.text, 'modelname')
    const nums = xmlAll(r.text, 'instancenum')
    model = models[0] || 'ai'
    inst = nums[0] ? Number(nums[0]) : 1
  }
  return { modelName: model, instanceNum: inst }
}
const cmdRoot = (t) => append(BASE, { queryinstance: t.modelName, instancenum: t.instanceNum })

// ── 工具执行器 ────────────────────────────────────────────
function summarizeXml(xml) {
  const status = xmlTag(xml, 'status') || 'ok'
  const reason = xmlTag(xml, 'reason')
  return `<status:${status}>${reason ? ' reason=' + reason : ''}`
}

async function listHandlers(cfg) {
  const r = await get(append(cmdRoot(cfg), { treelayer: '' }, [], { path: 'Tools/serverinterface/queryhandlers' }))
  if (!r.ok) return []
  try {
    const node = JSON.parse(r.text)
    return (node.subnodes || []).map((n) => n.name).filter(Boolean)
  } catch {
    return []
  }
}

async function ensureHandler(cfg, id) {
  const hs = await listHandlers(cfg)
  if (hs.includes(id)) return true
  const item = (registry.catalog || []).find((c) => c.id === id)
  if (!item) return false
  const url = append(cmdRoot(cfg), { copy_handler: '', value: 'template', name: id, code: item.code })
  const r = await get(url)
  return xmlTag(r.text, 'status') === 'success'
}

async function writeNode(cfg, path, value) {
  const tpl = await get(append(cmdRoot(cfg), {}, [], { template: '', value: encPath(path), action: encPath(value) }))
  if (tpl.ok) return summarizeXml(tpl.text)
  const res = await get(append(cmdRoot(cfg), {}, [], { setnodedata: encPath(path), value: encPath(value) }))
  return summarizeXml(res.text)
}

async function executeTool(name, args) {
  // 平台级工具不依赖目标实例（WebServer 挂掉时也能执行，用于自愈）
  const BASE_TOOLS = new Set([
    'get_guide', 'webserver_status', 'start_webserver',
    'list_instances', 'list_models', 'open_model'
  ])
  const cfg = BASE_TOOLS.has(name) ? null : await resolveTarget(args)
  let out = ''
  switch (name) {
    case 'get_guide':
      out = registry.guide || '<empty>无指南</empty>'
      break
    case 'webserver_status': {
      out = (await checkWebserver())
        ? '<ok>WebServer 在线（:80 响应正常）</ok>'
        : '<error>WebServer 未运行（:80 无响应）——请先调用 start_webserver 启动</error>'
      break
    }
    case 'start_webserver': {
      if (await checkWebserver()) {
        out = '<ok>WebServer 已在线，无需启动</ok>'
        break
      }
      startWebserverDirect()
      await sleep(4000)
      if (await checkWebserver()) {
        out = '<ok>已启动 WebServer（node index.js）</ok>'
        break
      }
      // 端口 80 绑定通常需要管理员权限 → 提权（可能弹 UAC）
      await startWebserverElevated()
      await sleep(5000)
      out = (await checkWebserver())
        ? '<ok>已通过管理员权限启动 WebServer</ok>'
        : '<error>启动失败：:80 仍无响应。请检查 WebServer 安装目录（' + WS_DIR + '）或手动运行启动脚本（需管理员）</error>'
      break
    }
    case 'list_instances': {
      const r = await get(append(BASE, { instancelist: '' }), 8000)
      const models = xmlAll(r.text, 'modelname')
      const nums = xmlAll(r.text, 'instancenum')
      out = models.length ? models.map((m, i) => `${m}#${nums[i] || '?'}`).join(', ') : '<empty>无运行实例</empty>'
      break
    }
    case 'list_models': {
      const r = await get(append(BASE, { availablemodels: '' }), 8000)
      const models = xmlAll(r.text, 'modelname')
      out = models.length ? models.join(', ') : '<empty>'
      break
    }
    case 'open_model': {
      const model = String(args.model || '')
      emitProgress(0, 1, '正在启动模型实例：' + model)
      const r = await get(append(BASE, { createinstance: model }), 180000)
      emitProgress(1, 1, '模型实例启动请求已完成')
      out = summarizeXml(r.text)
      break
    }
    case 'list_handlers': {
      const r = await get(append(cmdRoot(cfg), { treelayer: '' }, [], { path: 'Tools/serverinterface/queryhandlers' }))
      if (!r.ok) {
        out = `<error>实例不可用或不存在（HTTP ${r.status}）——先用 list_instances 确认目标模型在线</error>`
        break
      }
      try {
        const node = JSON.parse(r.text)
        const hs = (node.subnodes || []).map((n) => n.name).filter(Boolean)
        out = hs.length ? hs.join(', ') : '<empty>未部署任何 handler（可用 deploy_handler 部署）</empty>'
      } catch {
        out = '<error>解析 handler 列表失败</error>'
      }
      break
    }
    case 'get_node': {
      const r = await get(append(cmdRoot(cfg), {}, [], { getnodedata: encPath(String(args.path || '')) }))
      if (!r.ok) {
        out =
          r.status === 404
            ? '<error>节点不存在或实例不可用（HTTP 404）——用 list_tree 确认路径大小写，或用 list_instances 确认实例在线</error>'
            : `<error>HTTP ${r.status}</error>`
        break
      }
      out = r.text
      break
    }
    case 'write_node':
      out = await writeNode(cfg, String(args.path || ''), String(args.value ?? ''))
      break
    case 'create_object': {
      const r = await get(append(cmdRoot(cfg), { create_object: '', value: String(args.type || ''), name: String(args.name || '') }))
      out = summarizeXml(r.text)
      break
    }
    case 'set_loc': {
      const r = await get(append(cmdRoot(cfg), {
        set_loc: '', value: String(args.object || ''), x: Number(args.x || 0), y: Number(args.y || 0), z: Number(args.z || 0)
      }))
      out = summarizeXml(r.text)
      break
    }
    case 'connect_objects': {
      const key = args.key === 'S' ? 'S' : 'A'
      const r = await get(append(cmdRoot(cfg), { connect_objects: '', value: String(args.from || ''), to: String(args.to || ''), key }))
      out = summarizeXml(r.text)
      break
    }
    case 'delete_object': {
      const r = await get(append(cmdRoot(cfg), { delete_object: '', value: String(args.object || '') }))
      out = summarizeXml(r.text)
      break
    }
    case 'list_tree': {
      const raw = typeof args.path === 'string' ? (args.path.trim() || 'MODEL:') : 'MODEL:'
      const r = await get(append(cmdRoot(cfg), { treelayer: '' }, [], { path: raw === 'MODEL:' ? 'MODEL:' : encPath(raw) }))
      if (!r.ok) { out = `<error>HTTP ${r.status}</error>`; break }
      try {
        const node = JSON.parse(r.text)
        const kids = (node.subnodes || []).map((n) => `${n.name}${n.hasSubnodes ? '/' : ''}`)
        out = kids.length ? kids.join(', ') : '<empty>'
      } catch (e) { out = '<error>解析失败</error>' }
      break
    }
    case 'add_node': {
      const r = await get(append(cmdRoot(cfg), { add_node: '', value: String(args.parent || ''), name: String(args.name || '') }))
      out = summarizeXml(r.text)
      break
    }
    case 'rename_node': {
      if (!(await ensureHandler(cfg, 'rename_node'))) { out = '<error>无法部署 rename_node</error>'; break }
      const r = await get(append(cmdRoot(cfg), { name: String(args.name || '') }, [], { rename_node: '', value: encPath(String(args.path || '')) }))
      out = summarizeXml(r.text)
      break
    }
    case 'control': {
      const action = String(args.action || '')
      const r = await get(append(cmdRoot(cfg), {}, [action]))
      out = r.ok ? `<ok>${action} 已发送</ok>` : `<error>HTTP ${r.status}</error>`
      break
    }
    case 'set_datetime': {
      const r = await get(append(cmdRoot(cfg), { set_datetime: '', value: String(args.datetime || '') }))
      out = r.ok ? '<ok>已设置模型时间（需 reset 生效）</ok>' : `<error>HTTP ${r.status}</error>`
      break
    }
    case 'set_stop_time': {
      const r = await get(append(cmdRoot(cfg), { setstoptime: Number(args.seconds || 0) }))
      out = r.ok ? '<ok>已设置停止时间</ok>' : `<error>HTTP ${r.status}</error>`
      break
    }
    case 'set_run_speed': {
      const r = await get(append(cmdRoot(cfg), { setrunspeed: Number(args.speed || 1) }))
      out = r.ok ? '<ok>已设置运行速度</ok>' : `<error>HTTP ${r.status}</error>`
      break
    }
    case 'get_run_state': {
      const s = await get(append(cmdRoot(cfg), { getrunstate: '' }))
      const t = await get(append(cmdRoot(cfg), { getruntime: '' }))
      out = `runstate=${xmlTag(s.text, 'runstate')} runtime=${t.text.replace(/<\?xml[^>]*\?>|<\/?[a-z]+>/gi, '').trim()}`
      break
    }
    case 'deploy_handler': {
      const tpl = typeof args.template === 'string' && args.template ? args.template : 'template'
      const r = await get(append(cmdRoot(cfg), { copy_handler: '', value: tpl, name: String(args.name || ''), code: String(args.code || '') }))
      out = summarizeXml(r.text)
      break
    }
    case 'call_handler': {
      const handler = String(args.handler || '')
      const params = {}
      if (args.value !== undefined) params.value = String(args.value)
      if (args.action !== undefined) params.action = String(args.action)
      if (args.name !== undefined) params.name = String(args.name)
      if (args.msg !== undefined) params.msg = String(args.msg)
      const r = await get(append(cmdRoot(cfg), params, [], { [handler]: '' }))
      if (!r.ok) {
        out =
          r.status === 404
            ? '<error>handler 未部署或实例不可用（HTTP 404）——先 list_handlers 确认，或用 deploy_handler 部署</error>'
            : `<error>HTTP ${r.status}</error>`
        break
      }
      out = r.text
      break
    }
    default:
      // 未知工具：抛错 → tools/call 返回 isError:true（MCP 规范：工具失败走 result.isError）
      throw new Error('未知工具 ' + name)
  }
  if (out.length > 8000) out = out.slice(0, 8000) + '…(截断)'
  return out
}

// ── MCP stdio 协议 ────────────────────────────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

/**
 * 串行队列：tools/call 按到达顺序逐个执行（避免并发竞态与响应乱序）。
 * 代价：长工具（open_model 等）会阻塞后续调用——对本机单客户端场景可接受。
 */
let taskQueue = Promise.resolve()
function enqueue(task) {
  taskQueue = taskQueue.then(task, task)
  return taskQueue
}

/** tools/list_changed 通知：工具集变化时调用，通知客户端重新 tools/list。 */
let toolsChangedNotifier = null
function emitToolsChanged() {
  if (toolsChangedNotifier) toolsChangedNotifier()
  send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' })
}
/** 供宿主（main.cjs / 未来动态工具集）注册钩子 */
function setToolsChangedNotifier(fn) {
  toolsChangedNotifier = fn
}

// ── logging 能力：客户端可设级别，服务端按级别发 notifications/message ──
let logLevel = 'info'
function emitLog(level, data) {
  const order = { debug: 0, info: 1, warning: 2, error: 3 }
  if ((order[level] ?? 1) < (order[logLevel] ?? 1)) return
  send({ jsonrpc: '2.0', method: 'notifications/message', params: { level, data: String(data) } })
}

// ── progress 能力：长工具（open_model）经 notifications/progress 上报进度 ──
let currentProgressToken = null
function emitProgress(progress, total, message) {
  if (currentProgressToken == null) return
  const params = { progress, total, message: String(message) }
  if (currentProgressToken !== '') params.progressToken = currentProgressToken
  send({ jsonrpc: '2.0', method: 'notifications/progress', params })
}

// ── prompts 能力：prompts/list + prompts/get（模板来自 registry.prompts）──
function buildPromptMessages(promptDef, args) {
  const sys = '你是 FlexSim 远程建模助手。规则见 get_guide（先调用它）。'
  const a = args || {}
  const texts = {
    model_overview:
      '请先 webserver_status 确认 WebServer 在线，再 list_instances / list_handlers / list_tree 了解当前模型，给出简洁概览。',
    build_production_line:
      '请按以下描述搭建产线：' + (a.description || '（未提供描述）') +
      '\n步骤：create_object 逐个建对象 → set_loc 排布坐标 → connect_objects 用 A 连接连线 → control(reset) 后 control(run) → get_node 读 variable_nrreleased 验证实体流动。完成后给出总结与 Ctrl+S 提示。',
    add_feature:
      '请为当前模型添加新功能。需求：' + (a.requirement || '（未提供需求）') +
      '\n步骤：用 deploy_handler 生成参数无关代码（只读 GET/value、GET/action、GET/name、GET/msg，签名 replyNode=param(1)/parsedRequestNode=param(2)），部署后立即 call_handler 验证，最后给 Ctrl+S 提示。'
  }
  return [
    { role: 'system', content: sys },
    { role: 'user', content: texts[promptDef.name] || '请执行该提示对应的操作。' }
  ]
}

function run() {
  process.stderr.write('[flexsim-webserver-mcp] started, base=' + BASE + '\n')
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      // 解析失败：JSON-RPC 规范 -32700（无 id 时发通知级别错误亦可，此处直接忽略）
      return
    }
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: 'flexsim-webserver-mcp', version: '0.1.0' },
          // MCP 协议标准：服务端操作指南，随握手交给客户端（Claude 等会展示给模型）
          instructions: registry.guide || ''
        }
      })
      emitLog('info', 'server started, base=' + BASE)
    } else if (msg.method === 'notifications/initialized' || (msg.method || '').startsWith('notifications/')) {
      /* 通知无需响应 */
    } else if (msg.method === 'notifications/logging/setLevel') {
      const level = msg.params && msg.params.level
      if (level) logLevel = level
    } else if (msg.method === 'ping') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} })
    } else if (msg.method === 'tools/list') {
      const tools = (registry.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters || { type: 'object', properties: {} }
      }))
      send({ jsonrpc: '2.0', id: msg.id, result: { tools } })
    } else if (msg.method === 'prompts/list') {
      const prompts = (registry.prompts || []).map((p) => ({
        name: p.name,
        description: p.description,
        arguments: (p.arguments || []).map((a) => ({
          name: a.name,
          description: a.description,
          required: !!a.required
        }))
      }))
      send({ jsonrpc: '2.0', id: msg.id, result: { prompts } })
    } else if (msg.method === 'prompts/get') {
      const params = msg.params || {}
      const name = typeof params.name === 'string' ? params.name : ''
      const promptDef = (registry.prompts || []).find((p) => p.name === name)
      if (!promptDef) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown prompt: ' + name } })
        return
      }
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          description: promptDef.description,
          messages: buildPromptMessages(promptDef, params.arguments || {})
        }
      })
    } else if (msg.method === 'tools/call') {
      const params = msg.params || {}
      const name = typeof params.name === 'string' ? params.name : ''
      if (!name) {
        // JSON-RPC 规范：参数无效
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'missing tool name' } })
        return
      }
      const args = params.arguments || {}
      const meta = params._meta || {}
      currentProgressToken = meta.progressToken != null ? meta.progressToken : null
      // 串行执行，保证响应顺序 = 请求顺序
      enqueue(() =>
        executeTool(name, args)
          .then((text) => {
            send({
              jsonrpc: '2.0',
              id: msg.id,
              result: { content: [{ type: 'text', text }], isError: false }
            })
          })
          .catch((e) => {
            emitLog('error', 'tool ' + name + ' failed: ' + String((e && e.message) || e))
            // 工具执行内部错误：isError:true（MCP 规范：工具失败走 result 而非 error）
            send({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{ type: 'text', text: '<error>' + String((e && e.message) || e) + '</error>' }],
                isError: true
              }
            })
          })
          .finally(() => {
            currentProgressToken = null
          })
      )
    } else if (msg.id !== undefined) {
      // JSON-RPC 规范：方法不存在
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found: ' + msg.method } })
    }
  })
}

module.exports = { run, executeTool, emitToolsChanged, setToolsChangedNotifier }

// 直接以 node electron/mcp-server.cjs 运行时立即启动 MCP server
if (require.main === module) {
  run()
}

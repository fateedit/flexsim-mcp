/**
 * AI Agent store：LLM function calling 循环 + 工具执行器 + 计划确认。
 *
 * 流程：
 *   用户消息 → LLM(系统提示词 + 工具注册表) →
 *     若返回 tool_calls：
 *       · 自动执行模式：逐条执行 → 结果回填 → 继续循环
 *       · 确认模式：挂起等待用户确认（confirm / reject）
 *     若返回文本：作为最终回答，结束。
 *
 * 工具执行全部走 WebServer HTTP（复用 api/webserver.ts），并自动记入请求日志。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as ws from '@/api/webserver'
import { chat, type ChatMessage, type ToolCall } from '@/api/llm'
import { useConnection } from './connection'
import { useSettings } from './settings'
import { useTree } from './tree'
import registry from '../../shared/registry.json'
import type { WsCommandConfig } from '@/types'

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'running-tool'
  | 'awaiting-confirm'
  | 'done'
  | 'error'

interface ToolTrace {
  id: string
  name: string
  args: string
  result: string
  ok: boolean
  time: string
}

const SYSTEM_PROMPT = `你是 FlexSim 远程建模助手。你通过 HTTP 操作 FlexSim WebServer 上的仿真模型（中间层），只能使用提供的工具，不能假设工具之外的能力。

关键规则（违反会导致失败）：
1. 参数无关：调用任意 handler 时，业务参数一律用通用名 value（对象/路径）、action（新值/动作）、name（新名）、msg（消息）。绝不要依赖 handler 自身名字的参数。
2. 目标实例：默认操作当前目标实例（模型名+实例号由平台选择）。除非用户明确要求，不要切换模型。
3. 删除是异步的（3~8 秒生效）：删除对象后不能立即用 get_node 验证（会误报残留）；应稍后重试 delete_object 看是否返回 not found。
4. 远程操作不持久：只改运行实例内存。部署/修改后要提醒用户：在 FlexSim 界面按 Ctrl+S 保存，否则重载/autosave 会恢复旧状态。
5. 路径大小写敏感；中文/空格会被平台自动编码，路径本身要写对。
6. 复合节点（数组）不能直接写，必须写其叶子子节点。
7. 修改时间类节点（set_datetime / set_stop_time）后通常需要 reset 才生效。
8. 判断实体是否流动：读累计值（如 Queue 的 variable_nrreleased 累计释放数），瞬时 stats_content 可能为 0。
9. 部署新 handler（deploy_handler）：代码必须参数无关（只读 GET/value、GET/action、GET/name、GET/msg），函数签名固定：treenode replyNode = param(1); treenode parsedRequestNode = param(2); 结尾 setnodestr(replyNode, "<status>...</status>"); return replyNode;。部署成功后立即用 call_handler 调用一次验证。
10. 常用对象类型：Source/Sink/Queue/Processor/Dispatcher/Rack/Conveyor/AGV/Combiner/Separator/MergeSort/Transporter/Robot/Operator/ProcessFlow。

你是完整的模型编辑器，像操作文件一样操作模型树：
- 浏览结构用 list_tree（根层 MODEL:，子层相对路径）；找路径先探索再动手
- 增删改任意节点：add_node 加节点、rename_node 改名（缺 renamenode 会自动部署）、delete_object 删节点/对象、write_node 改叶子值
- 缺任何 handler（renamenode/copyobject/getstats/listobjects/setcode…）就用 deploy_handler 现场从目录模板部署，再调用
- 改模型时间/停止时间后需 reset 生效；对象坐标用 set_loc；连线用 connect_objects

工作方式：用户提出需求 → 先用 list_instances / list_models 摸清环境 → 一步步执行工具 → 完成时给出简洁的中文总结（含结果与"如需持久化请 Ctrl+S"提示，如适用）。
打开模型：用户要求"打开/启动某模型"时，先 list_models 确认模型名，list_instances 看是否已在线；不在线才 open_model，启动后稍等并 list_instances 确认。`

const MAX_LOOP = 20

const WRITE_TOOLS = new Set([
  'write_node',
  'create_object',
  'set_loc',
  'connect_objects',
  'delete_object',
  'control',
  'set_datetime',
  'set_stop_time',
  'set_run_speed',
  'deploy_handler',
  'call_handler'
])

export const useAgent = defineStore('agent', () => {
  const conn = useConnection()
  const settings = useSettings()
  const tree = useTree()

  const messages = ref<ChatMessage[]>([])
  const status = ref<AgentStatus>('idle')
  const traces = ref<ToolTrace[]>([])
  const pendingCalls = ref<ToolCall[]>([])
  const errorMsg = ref('')

  const busy = computed(() =>
    status.value === 'thinking' || status.value === 'running-tool'
  )

  /** 目标实例是否已就绪（AI 操作的前提） */
  const targetReady = computed(() => conn.connected && !!conn.modelName)

  /** 工具列表（来自 registry.json，OpenAI function calling 格式） */
  const tools = (registry.tools as unknown[]) ?? []

  function nowTime(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }

  /** 解析工具参数 JSON（容错） */
  function parseArgs(tc: ToolCall): Record<string, unknown> {
    try {
      return JSON.parse(tc.function.arguments || '{}')
    } catch {
      return {}
    }
  }

  /** 调用任意 handler 并压缩 XML 响应（用于 add_node/rename_node 等） */
  async function callHandlerXml(cfg: WsCommandConfig, params: Record<string, string>): Promise<string> {
    const raw = await ws.runRaw(cfg, params)
    if (!raw.ok) return `<error>HTTP ${raw.status}</error>`
    const m = raw.text.match(/<status>([^<]*)<\/status>/i)
    if (!m) return raw.text.length > 400 ? raw.text.slice(0, 400) : raw.text
    const reason = raw.text.match(/<reason>([^<]*)<\/reason>/i)
    return `<status:${m[1]}>${reason ? ' reason=' + reason[1] : ''}`
  }

  /** 确保目标模型已部署某目录 handler（缺则用 copyhandler 现场部署） */
  async function ensureHandler(cfg: WsCommandConfig, id: string): Promise<boolean> {
    const hs = await ws.listHandlers(cfg)
    if (hs.includes(id)) return true
    const item = (registry.catalog as { id: string; code: string }[]).find((c) => c.id === id)
    if (!item) return false
    const r = await ws.copyHandler(cfg, 'template', id, item.code)
    return r.status === 'success'
  }

  /** 目标实例配置（工具参数可覆盖模型/实例） */
  function resolveCfg(args: Record<string, unknown>): WsCommandConfig {
    const base = conn.cfg()
    const model = typeof args.model === 'string' && args.model ? args.model : base.modelName
    const instance =
      typeof args.instance === 'number'
        ? args.instance
        : Number(args.instance) || base.instanceNum
    return { base: base.base, modelName: model, instanceNum: instance }
  }

  /** 把 XML/文本结果压缩成给 LLM 的摘要 */
  function summarize(hr: ws.HandlerResult | { status: string; reason?: string }): string {
    if ('fields' in hr && hr.fields) {
      const extra = Object.entries(hr.fields)
        .filter(([k]) => k !== 'reason')
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
      return `<status:${hr.status}> ${hr.reason ? `reason=${hr.reason} ` : ''}${extra}`.trim()
    }
    return `<status:${hr.status}> ${hr.reason || ''}`.trim()
  }

  /** 工具执行器：把工具调用翻译成 WebServer 请求 */
  async function executeTool(tc: ToolCall): Promise<string> {
    const name = tc.function.name
    const args = parseArgs(tc)
    const cfg = resolveCfg(args)

    // 只读模式拦截写操作
    if (settings.readOnly && WRITE_TOOLS.has(name)) {
      return '<error>只读模式已开启，该操作被平台拦截</error>'
    }

    let summary = ''
    switch (name) {
      case 'get_guide': {
        summary = (registry as { guide?: string }).guide || '<empty>无指南</empty>'
        break
      }
      case 'webserver_status': {
        summary = conn.connected
          ? '<ok>WebServer 在线</ok>'
          : '<error>WebServer 未运行——请调用 start_webserver 或到设置→服务器重启</error>'
        break
      }
      case 'start_webserver': {
        if (!settings.wsConfigPath) {
          summary = '<error>未配置 WebServer 配置文件路径，请先在设置→服务器探测 WebServer 安装目录</error>'
          break
        }
        const r = await window.api.wsRestart(settings.wsConfigPath)
        summary = r.ok ? `<ok>${r.msg || '已启动'}</ok>` : `<error>${r.error}</error>`
        setTimeout(() => conn.test(), 4000)
        break
      }
      case 'list_instances': {
        const insts = await ws.getInstances(conn.base)
        summary =
          insts.length === 0
            ? '<empty>没有运行中的实例</empty>'
            : insts.map((i) => `${i.modelName}#${i.instanceNum}`).join(', ')
        break
      }
      case 'list_models': {
        const models = await ws.getModels(conn.base)
        summary = models.length ? models.join(', ') : '<empty>没有可运行模型</empty>'
        break
      }
      case 'open_model': {
        const model = String(args.model ?? '')
        const r = await ws.createInstance(conn.base, model)
        summary =
          r.status === 'success'
            ? `<ok>已发起启动 ${model}（实例号 ${r.instancenum ?? '?'}，加载需要时间，稍后 list_instances 确认）</ok>`
            : `<error>${r.reason || r.status}</error>`
        conn.loadInstances()
        break
      }
      case 'list_handlers': {
        const hs = await ws.listHandlers(cfg)
        summary = hs.length ? hs.join(', ') : '<empty>未部署任何 handler</empty>'
        break
      }
      case 'get_node': {
        const v = await ws.getNodeData(cfg, String(args.path ?? ''))
        summary = typeof v === 'string' ? v : JSON.stringify(v)
        break
      }
      case 'write_node': {
        summary = summarize(await ws.writeNode(cfg, String(args.path ?? ''), String(args.value ?? '')))
        break
      }
      case 'create_object': {
        summary = summarize(
          await ws.createObject(cfg, String(args.type ?? ''), String(args.name ?? ''))
        )
        tree.loadRoot()
        break
      }
      case 'set_loc': {
        summary = summarize(
          await ws.setObjectLoc(
            cfg,
            String(args.object ?? ''),
            Number(args.x ?? 0),
            Number(args.y ?? 0),
            Number(args.z ?? 0)
          )
        )
        break
      }
      case 'connect_objects': {
        const key = args.key === 'S' ? 'S' : 'A'
        summary = summarize(
          await ws.connectObjects(cfg, String(args.from ?? ''), String(args.to ?? ''), key)
        )
        break
      }
      case 'delete_object': {
        summary = summarize(await ws.deleteObject(cfg, String(args.object ?? '')))
        tree.loadRoot()
        break
      }
      case 'list_tree': {
        const raw = typeof args.path === 'string' ? (args.path.trim() || 'MODEL:') : 'MODEL:'
        const node = await ws.getTreeLayer(cfg, raw === 'MODEL:' ? '' : raw)
        const kids = (node.subnodes || []).map((n) => `${n.name}${n.hasSubnodes ? '/' : ''}`)
        summary = kids.length ? kids.join(', ') : '<empty>该路径下没有子节点</empty>'
        break
      }
      case 'add_node': {
        summary = await callHandlerXml(cfg, {
          add_node: '',
          value: String(args.parent ?? ''),
          name: String(args.name ?? '')
        })
        break
      }
      case 'rename_node': {
        const p = String(args.path ?? '')
        const nm = String(args.name ?? '')
        if (!(await ensureHandler(cfg, 'rename_node'))) {
          summary = '<error>无法部署 rename_node handler（源模板缺失）</error>'
        } else {
          summary = await callHandlerXml(cfg, { rename_node: '', value: p, name: nm })
        }
        tree.loadRoot()
        break
      }
      case 'control': {
        const action = String(args.action ?? '')
        const res =
          action === 'run'
            ? await ws.runModel(cfg)
            : action === 'stop'
              ? await ws.stopModel(cfg)
              : await ws.resetModel(cfg)
        summary = res.ok ? `<ok>${action} 已发送</ok>` : `<error>HTTP ${res.status}</error>`
        break
      }
      case 'set_datetime': {
        const res = await ws.setDateTime(cfg, String(args.datetime ?? ''))
        summary = res.ok ? '<ok>已设置模型时间（需 reset 生效）</ok>' : `<error>HTTP ${res.status}</error>`
        break
      }
      case 'set_stop_time': {
        const res = await ws.setStopTime(cfg, Number(args.seconds ?? 0))
        summary = res.ok ? `<ok>已设置停止时间 ${args.seconds}s</ok>` : `<error>HTTP ${res.status}</error>`
        break
      }
      case 'set_run_speed': {
        const res = await ws.setRunSpeed(cfg, Number(args.speed ?? 1))
        summary = res.ok ? `<ok>已设置运行速度 ${args.speed}</ok>` : `<error>HTTP ${res.status}</error>`
        break
      }
      case 'get_run_state': {
        const state = await ws.getRunState(cfg)
        const time = await ws.getRunTime(cfg)
        summary = `runstate=${state || '未知'} runtime=${time || '未知'}`
        break
      }
      case 'deploy_handler': {
        const src = typeof args.template === 'string' && args.template ? args.template : 'template'
        summary = summarize(
          await ws.copyHandler(cfg, src, String(args.name ?? ''), String(args.code ?? ''))
        )
        break
      }
      case 'call_handler': {
        const handler = String(args.handler ?? '')
        const params: Record<string, string | number> = {}
        if (args.value !== undefined) params.value = String(args.value)
        if (args.action !== undefined) params.action = String(args.action)
        if (args.name !== undefined) params.name = String(args.name)
        if (args.msg !== undefined) params.msg = String(args.msg)
        const raw = await ws.runRaw(cfg, params, [], { [handler]: '' })
        summary = raw.ok ? raw.text : `<error>HTTP ${raw.status}</error>`
        break
      }
      default:
        summary = `<error>未知工具 ${name}</error>`
    }
    return summary
  }

  /** 追加 assistant 工具调用消息与工具结果消息 */
  function appendToolRound(toolCalls: ToolCall[], results: string[]) {
    messages.value.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map((t) => ({
        id: t.id,
        type: 'function',
        function: { name: t.function.name, arguments: t.function.arguments }
      }))
    })
    toolCalls.forEach((t, i) => {
      messages.value.push({
        role: 'tool',
        tool_call_id: t.id,
        name: t.function.name,
        content: results[i] ?? '<error>无结果</error>'
      })
      traces.value.push({
        id: t.id,
        name: t.function.name,
        args: t.function.arguments,
        result: results[i] ?? '',
        ok: !(results[i] ?? '').startsWith('<error>'),
        time: nowTime()
      })
    })
  }

  /** 执行一组工具调用（确认模式或自动模式共用） */
  async function runToolCalls(toolCalls: ToolCall[]): Promise<boolean> {
    status.value = 'running-tool'
    const results: string[] = []
    for (const tc of toolCalls) {
      try {
        results.push(await executeTool(tc))
      } catch (e) {
        results.push(`<error>${e instanceof Error ? e.message : String(e)}</error>`)
      }
    }
    appendToolRound(toolCalls, results)
    return true
  }

  /** 主循环：LLM 决定下一步，直到给出最终回答 */
  async function loop(): Promise<void> {
    for (let i = 0; i < MAX_LOOP; i++) {
      status.value = 'thinking'
      let resp
      try {
        resp = await chat(messages.value, tools)
      } catch (e) {
        status.value = 'error'
        errorMsg.value = e instanceof Error ? e.message : String(e)
        return
      }
      if (!resp) return

      if (resp.tool_calls && resp.tool_calls.length > 0) {
        if (settings.aiAutoExecute) {
          await runToolCalls(resp.tool_calls)
        } else {
          // 确认模式：挂起，等用户确认
          pendingCalls.value = resp.tool_calls
          status.value = 'awaiting-confirm'
          return
        }
      } else {
        messages.value.push({ role: 'assistant', content: resp.content ?? '' })
        status.value = 'done'
        return
      }
    }
    status.value = 'error'
    errorMsg.value = 'AI 循环次数过多，已停止（请简化需求）'
  }

  /** 用户发送消息，启动一轮 Agent */
  async function send(text: string): Promise<void> {
    const t = text.trim()
    if (!t || busy.value) return
    if (!targetReady.value) {
      status.value = 'error'
      errorMsg.value = '请先连接 WebServer 并选择目标实例'
      return
    }
    errorMsg.value = ''
    pendingCalls.value = []
    // 首条消息前注入系统提示词（含 WebServer 已知坑）
    if (messages.value.length === 0) {
      messages.value.push({ role: 'system', content: SYSTEM_PROMPT })
    }
    messages.value.push({ role: 'user', content: t })
    await loop()
  }

  /** 确认执行挂起的工具调用 */
  async function confirmPending(): Promise<void> {
    const calls = pendingCalls.value
    if (!calls.length) return
    pendingCalls.value = []
    await runToolCalls(calls)
    await loop()
  }

  /** 拒绝挂起的工具调用（告诉 LLM 用户取消了，让其调整） */
  async function rejectPending(): Promise<void> {
    const calls = pendingCalls.value
    if (!calls.length) return
    pendingCalls.value = []
    const results = calls.map(() => '<error>用户取消了该操作</error>')
    appendToolRound(calls, results)
    await loop()
  }

  function resetConversation() {
    messages.value = []
    traces.value = []
    pendingCalls.value = []
    errorMsg.value = ''
    status.value = 'idle'
  }

  /** 功能目录 → 交给 AI 自动部署（代码直接给出，保证确定性） */
  function deployCatalogItem(item: {
    id: string
    name: string
    desc: string
    code: string
  }): void {
    if (busy.value) return
    if (!targetReady.value) {
      status.value = 'error'
      errorMsg.value = '请先连接 WebServer 并选择目标实例'
      return
    }
    const code = item.code.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    send(
      `请为当前模型部署功能「${item.name}」（${item.desc}）。\n` +
        `使用 deploy_handler：name="${item.id}"，template 用默认 template，code 为以下 FlexScript（参数无关，直接原样使用）：\n` +
        `\`\`\`\n${code}\n\`\`\`\n` +
        `部署成功后用 call_handler 调用一次验证（handler=${item.id}），并给出简洁总结与 Ctrl+S 提示。`
    )
  }

  return {
    messages,
    status,
    traces,
    pendingCalls,
    errorMsg,
    busy,
    targetReady,
    send,
    confirmPending,
    rejectPending,
    resetConversation,
    deployCatalogItem
  }
})

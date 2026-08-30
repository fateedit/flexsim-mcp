import { useSettings } from '@/stores/settings'
import { nowTime } from '@/utils/format'
import type {
  FlexInstance,
  RequestLog,
  TreeNode,
  WsCommandConfig,
  WriteResult
} from '@/types'

/**
 * WebServer 客户端封装
 * ---------------------------------------------------------------
 * 所有对 FlexSim WebServer 的请求都集中在本文件。
 * 关键约定（详见任务书「WebServer API 规范」）：
 *  1. 全部为 GET，参数拼在 query string；中文/空格由 encodeURIComponent 自动编码
 *  2. 实例操作统一前缀： queryinstance={模型名}&instancenum={实例号}
 *  3. 路径大小写敏感（如 dateTime 的 T 大写），错误大小写返回 404
 *  4. 复合节点不能直接写，必须写具体叶子子节点
 *  5. setnodedata 返回 XML（success/mismatch/error）；getnodedata 返回 JSON
 *  6. 渲染进程不直接 fetch，而是经 preload -> 主进程转发（规避 CORS、统一超时）
 */

// ── 日志钩子：每次请求后通知 logs store 记录 ──────────────────────
type LogSink = (entry: Omit<RequestLog, 'id'>) => void
let logSink: LogSink | null = null
export function setLogSink(fn: LogSink): void {
  logSink = fn
}

// 主进程返回的原始结构
interface RawResponse {
  ok: boolean
  status: number
  text: string
  durationMs: number
  error?: boolean
  base64?: string
  contentType?: string
}

/** 统一请求入口：经 window.api 转发，自动记录日志，超时取自 settings */
async function request(
  url: string,
  opts?: { timeout?: number; binary?: boolean; silent?: boolean }
): Promise<RawResponse> {
  const settings = useSettings()
  const res = (await window.api.request(url, {
    timeout: opts?.timeout ?? settings.timeout,
    binary: !!opts?.binary
  })) as RawResponse

  // 后台轮询/探测类请求（silent）不刷请求日志，避免噪音
  if (logSink && !opts?.silent) {
    logSink({
      time: nowTime(),
      method: 'GET',
      url,
      status: res.status,
      durationMs: res.durationMs,
      ok: res.ok && !res.error
    })
  }
  return res
}

// ── URL 拼装工具 ─────────────────────────────────────────────────
/** 实例操作统一前缀 */
function cmdRoot(cfg: WsCommandConfig): string {
  return `${cfg.base}?queryinstance=${encodeURIComponent(cfg.modelName)}&instancenum=${cfg.instanceNum}`
}

/**
 * 路径专用编码：保留 `/`（FlexSim WebServer 的 path 参数使用字面斜杠，
 * 且多数情况下不会对 %2F 解码，若编码成 %2F 会直接 404），
 * 但仍对空格、&、= 等特殊字符做编码，避免破坏 query string。
 */
function encPath(p: string): string {
  return encodeURIComponent(p).replace(/%2F/g, '/')
}

/**
 * 在已有 URL 后追加参数。
 * 第一个参数用 `?` 分隔，后续用 `&`（base 本身不带 query 时，如 instancelist/availablemodels）。
 * params  : 形如 { setnodedata: path, value: v } -> &setnodedata=..&value=..（值经 encodeURIComponent）
 * rawParams: 形如 { path: encPath(p) } -> 值已自行编码，原样拼入（用于路径，保留斜杠）
 * flags  : 形如 ['run'] -> &run （无值的开关型命令，WebServer 规范要求如此）
 */
function append(
  url: string,
  params: Record<string, string | number> = {},
  flags: string[] = [],
  rawParams: Record<string, string> = {}
): string {
  let out = url
  const sep = () => (out.includes('?') ? '&' : '?')
  for (const f of flags) out += `${sep()}${f}`
  for (const [k, v] of Object.entries(rawParams)) {
    out += `${sep()}${k}=${v}`
  }
  for (const [k, v] of Object.entries(params)) {
    out += `${sep()}${k}=${encodeURIComponent(String(v))}`
  }
  return out
}

// ── XML 解析工具 ─────────────────────────────────────────────────
function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, 'application/xml')
}

function parseInstances(xml: string): FlexInstance[] {
  const doc = parseXml(xml)
  const nodes = Array.from(doc.getElementsByTagName('instance'))
  return nodes.map((n) => {
    const modelName =
      n.getElementsByTagName('modelname')[0]?.textContent ?? ''
    const instanceNum = Number(
      n.getElementsByTagName('instancenum')[0]?.textContent ?? '0'
    )
    return { modelName, instanceNum, raw: n.textContent ?? '' }
  })
}

function parseWriteStatus(xml: string): WriteResult {
  const doc = parseXml(xml)
  const status = (doc.getElementsByTagName('status')[0]?.textContent ??
    'error') as WriteResult['status']
  const written = doc.getElementsByTagName('written')[0]?.textContent ?? undefined
  const readback = doc.getElementsByTagName('readback')[0]?.textContent ?? undefined
  const reason = doc.getElementsByTagName('reason')[0]?.textContent ?? undefined
  return { status, written, readback, reason }
}

// ── 公开 API ─────────────────────────────────────────────────────

/** 连接测试：请求实例列表接口，能拿到 200 即视为可用 */
export async function testConnection(base: string): Promise<boolean> {
  const res = await request(append(base, { instancelist: '' }), {
    timeout: 5000,
    silent: true
  })
  return res.ok || res.status === 200
}

/** 获取可运行模型名列表（availablemodels） */
export async function getModels(base: string): Promise<string[]> {
  const res = await request(append(base, { availablemodels: '' }), { silent: true })
  if (!res.ok) return []
  const doc = parseXml(res.text)
  return Array.from(doc.getElementsByTagName('modelname'))
    .map((n) => n.textContent ?? '')
    .filter((s) => s.trim().length > 0)
}

/** 启动模型实例（createinstance）。大模型加载慢，需加大超时；返回状态与实例号 */
export async function createInstance(
  base: string,
  model: string
): Promise<{ status: string; instancenum?: number; reason?: string }> {
  const res = await request(append(base, { createinstance: model }), {
    timeout: 180000
  })
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  const doc = parseXml(res.text)
  const status = doc.getElementsByTagName('status')[0]?.textContent ?? 'success'
  const instancenum = Number(doc.getElementsByTagName('instancenum')[0]?.textContent || 0)
  const reason = doc.getElementsByTagName('reason')[0]?.textContent ?? undefined
  return { status, instancenum: instancenum || undefined, reason }
}

/** 终止（关闭）一个模型实例：terminateinstance=模型名&instancenum=N */
export async function terminateInstance(
  base: string,
  model: string,
  instance: number
): Promise<{ ok: boolean; reason?: string }> {
  const res = await request(
    append(base, { terminateinstance: model, instancenum: instance }),
    { timeout: 30000 }
  )
  if (res.ok) return { ok: true }
  return { ok: false, reason: `HTTP ${res.status}` }
}

/** WebServer 服务端配置（configuration 接口解析结果） */
export interface ServerConfig {
  modelDirectory: string
  programDirectory: string
  flexsimDirectory: string
  port: string
  replyTimeout: string
  maxInstances: string
  uploadEnabled: boolean
  downloadEnabled: boolean
  deleteEnabled: boolean
}

/** 读取 WebServer 服务端配置（模型目录、程序目录、端口、权限等） */
export async function getServerConfig(base: string): Promise<ServerConfig | null> {
  const res = await request(append(base, { configuration: '' }), {
    timeout: 10000,
    silent: true
  })
  if (!res.ok) return null
  const doc = parseXml(res.text)
  const g = doc.getElementsByTagName('general')[0]
  const ro = doc.getElementsByTagName('remoteoperations')[0]
  const txt = (tag: string, parent?: Element) =>
    parent?.getElementsByTagName(tag)[0]?.textContent ?? ''
  return {
    modelDirectory: txt('modeldirectory', g),
    programDirectory: txt('flexsimprogramdirectory', g),
    flexsimDirectory: txt('flexsimdirectory', g),
    port: txt('port', g),
    replyTimeout: txt('replytimeout', g),
    maxInstances: txt('maxinstances', g),
    uploadEnabled: txt('modeluploading', ro) === 'yes',
    downloadEnabled: txt('modeldownloading', ro) === 'yes',
    deleteEnabled: txt('modeldeleting', ro) === 'yes'
  }
}

/** 模型目录里的文件列表（allfiles） */
export async function getModelFiles(base: string): Promise<string[]> {
  const res = await request(append(base, { allfiles: '' }), {
    timeout: 10000,
    silent: true
  })
  if (!res.ok) return []
  const doc = parseXml(res.text)
  return Array.from(doc.getElementsByTagName('filename'))
    .map((n) => n.textContent ?? '')
    .filter((s) => s.trim().length > 0)
}

/** 获取实例列表 */
export async function getInstances(base: string): Promise<FlexInstance[]> {
  const res = await request(append(base, { instancelist: '' }), { silent: true })
  if (!res.ok) return []
  return parseInstances(res.text)
}

/**
 * 获取某路径下的树结构（JSON）。path 为空字符串表示根层。
 * ⚠️ 实测：根层路径必须传 `MODEL:`（带冒号），空字符串会返回 HTML 404 页；
 *    子层路径用相对路径（如 `Tools/ModelUnits`）即可。
 * 大模型（数 GB）树响应慢，使用 30s 超时。
 */
export async function getTreeLayer(
  cfg: WsCommandConfig,
  path: string
): Promise<TreeNode> {
  const raw = path === '' ? 'MODEL:' : encPath(path)
  const res = await request(append(cmdRoot(cfg), { treelayer: '' }, [], { path: raw }), {
    timeout: 30000
  })
  if (!res.ok) {
    const hint =
      res.status === 404
        ? '（实例可能已关闭，或路径不存在）'
        : res.status === 500
          ? '（模型响应异常：可能模型过大或正在运行，建议切换轻量模型如 ai）'
          : res.status === 0
            ? '（请求超时：模型响应慢，可增大设置里的超时时间）'
            : ''
    throw new Error(`树结构请求失败（HTTP ${res.status}）${hint}`)
  }
  return JSON.parse(res.text) as TreeNode
}

/** 读取节点值（JSON：数字 / 带引号字符串 / 复合数组）。大模型响应慢，用 15s 超时 */
export async function getNodeData(
  cfg: WsCommandConfig,
  path: string
): Promise<unknown> {
  const res = await request(append(cmdRoot(cfg), {}, [], { getnodedata: encPath(path) }), {
    timeout: 15000
  })
  if (!res.ok) throw new Error(`读值失败（HTTP ${res.status}）`)
  return JSON.parse(res.text)
}

/**
 * 写入节点值。返回解析后的状态。
 * 只读模式下直接拦截，不发起网络请求。
 */
export async function setNodeData(
  cfg: WsCommandConfig,
  path: string,
  value: string
): Promise<WriteResult> {
  const settings = useSettings()
  if (settings.readOnly) {
    return { status: 'error', reason: '只读模式已开启，禁止写操作' }
  }
  const res = await request(append(cmdRoot(cfg), { value }, [], { setnodedata: encPath(path) }))
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  return parseWriteStatus(res.text)
}

/**
 * 写节点（数字/字符串由 handler 自动判断），智能选择写入通道：
 *   1. 优先「参数无关版」template handler（URL：&template=&value={节点路径}&action={新值}），
 *      这是新模型（如 ai.fsm）的标准写法——setnodedata 已被 template 取代；
 *   2. 若模型未装 template（HTTP 404）→ 回退传统 setnodedata（&setnodedata={路径}&value={值}）。
 * 注意：路径与含 `/` 的值都不能把斜杠编码成 %2F（WebServer 不解码 %2F，会 404/写错），
 *      故统一用 encPath 保留字面斜杠、编码其余特殊字符。
 */
export async function writeNode(
  cfg: WsCommandConfig,
  path: string,
  value: string
): Promise<WriteResult> {
  const settings = useSettings()
  if (settings.readOnly) {
    return { status: 'error', reason: '只读模式已开启，禁止写操作' }
  }

  // 1) template handler：value=路径, action=新值（template 参数只需存在，值可为空）
  const tpl = await request(
    append(cmdRoot(cfg), {}, [], {
      template: '',
      value: encPath(path),
      action: encPath(value)
    })
  )
  if (tpl.ok) return parseWriteStatus(tpl.text)

  // 2) 回退 setnodedata（老模型）
  const res = await request(
    append(cmdRoot(cfg), {}, [], {
      setnodedata: encPath(path),
      value: encPath(value)
    })
  )
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  return parseWriteStatus(res.text)
}

// 控制类命令（run/stop/reset 为开关型，用 flags 追加）
export async function runModel(cfg: WsCommandConfig): Promise<RawResponse> {
  return request(append(cmdRoot(cfg), {}, ['run']))
}
export async function stopModel(cfg: WsCommandConfig): Promise<RawResponse> {
  return request(append(cmdRoot(cfg), {}, ['stop']))
}
export async function resetModel(cfg: WsCommandConfig): Promise<RawResponse> {
  return request(append(cmdRoot(cfg), {}, ['reset']))
}

// 参数型命令
export async function setRunSpeed(
  cfg: WsCommandConfig,
  value: number
): Promise<RawResponse> {
  return request(append(cmdRoot(cfg), { setrunspeed: value }))
}
export async function setStopTime(
  cfg: WsCommandConfig,
  seconds: number
): Promise<RawResponse> {
  return request(append(cmdRoot(cfg), { setstoptime: seconds }))
}
/** dt 格式：YYYY-MM-DD HH:MM:SS（空格已自动编码）——模型 handler：set_datetime=&value={dt} */
export async function setDateTime(
  cfg: WsCommandConfig,
  dt: string
): Promise<RawResponse> {
  return request(append(cmdRoot(cfg), { set_datetime: '', value: dt }))
}

// 状态查询
/** 运行状态：返回 '1'（运行中）/ '0'（已停止）/ ''（未知）。解析自 <runstate>N</runstate> */
export async function getRunState(cfg: WsCommandConfig): Promise<string> {
  const res = await request(append(cmdRoot(cfg), { getrunstate: '' }))
  if (!res.ok) return ''
  const m = res.text.match(/<runstate>\s*(\d+)\s*<\/runstate>/i)
  return m ? m[1] : ''
}

/** 模型时间（去掉 XML 包装后的纯文本，如 "8:30:41  2025/8/25  [123.45]  to  18:00:00  2026/1/15  [39600.00]"） */
export async function getRunTime(cfg: WsCommandConfig): Promise<string> {
  const res = await request(append(cmdRoot(cfg), { getruntime: '' }))
  if (!res.ok) return ''
  return res.text
    .replace(/<\?xml[^>]*\?>/i, '')
    .replace(/<\/?[a-z]+>/gi, '')
    .trim()
}

/** 截图：返回 data URL（base64），供 <img> 直接展示 */
export async function screenshot(cfg: WsCommandConfig): Promise<string> {
  const res = await request(append(cmdRoot(cfg), { screenshot: '' }), {
    binary: true
  })
  if (!res.ok || !res.base64) throw new Error(`截图失败（HTTP ${res.status}）`)
  return `data:${res.contentType || 'image/png'};base64,${res.base64}`
}

// ── 对象工具与功能部署（create_object / set_loc / connect_objects / delete_object / copy_handler）─

export type HandlerStatus = 'success' | 'error' | 'mismatch'

/** 自定义 handler 的 XML 响应解析结果（status + 各字段 + 原始 XML） */
export interface HandlerResult {
  status: HandlerStatus
  reason?: string
  fields: Record<string, string>
  raw: string
}

/** 解析自定义 handler 返回的 XML（status 之外的子标签都收进 fields） */
function parseHandlerXml(xml: string): HandlerResult {
  const doc = parseXml(xml)
  const status = (doc.getElementsByTagName('status')[0]?.textContent ??
    'error') as HandlerStatus
  const fields: Record<string, string> = {}
  const reason = doc.getElementsByTagName('reason')[0]?.textContent ?? undefined
  const root = doc.documentElement
  if (root) {
    for (const el of Array.from(root.children)) {
      const tag = el.tagName.toLowerCase()
      if (tag !== 'status' && !(tag in fields)) fields[tag] = el.textContent ?? ''
    }
  }
  return { status, reason, fields, raw: xml }
}

/** 统一的 handler 调用入口（GET，参数名即 handler 名，值 encodeURIComponent） */
async function execHandler(
  cfg: WsCommandConfig,
  params: Record<string, string | number>,
  flags: string[] = []
): Promise<HandlerResult> {
  const res = await request(append(cmdRoot(cfg), params, flags))
  if (!res.ok) {
    return { status: 'error', reason: `HTTP ${res.status}`, fields: {}, raw: res.text }
  }
  return parseHandlerXml(res.text)
}

/** 创建对象：create_object=&value={类型}&name={名字}（参数无关） */
export function createObject(
  cfg: WsCommandConfig,
  type: string,
  name: string
): Promise<HandlerResult> {
  return execHandler(cfg, { create_object: '', value: type, name })
}

/** 对象定位：set_loc=&value={对象}&x=&y=&z= */
export function setObjectLoc(
  cfg: WsCommandConfig,
  obj: string,
  x: string | number,
  y: string | number,
  z: string | number
): Promise<HandlerResult> {
  return execHandler(cfg, { set_loc: '', value: obj, x, y, z })
}

/** 对象连线：connect_objects=&value={A}&to={B}&key=A/S */
export function connectObjects(
  cfg: WsCommandConfig,
  from: string,
  to: string,
  key: 'A' | 'S' = 'A'
): Promise<HandlerResult> {
  return execHandler(cfg, { connect_objects: '', value: from, to, key })
}

/** 删除对象：delete_object=&value={对象名}（⚠️ 异步，3~8 秒后模型界面才消失） */
export function deleteObject(
  cfg: WsCommandConfig,
  name: string
): Promise<HandlerResult> {
  return execHandler(cfg, { delete_object: '', value: name })
}

/**
 * 复制 handler 部署新功能：copy_handler=&value={源handler}&name={新名}[&code={新代码}]
 * 不传 code = 纯复制（继承源代码）；传 code = 复制 + 改名 + 改码（插件架构核心原语）。
 */
export function copyHandler(
  cfg: WsCommandConfig,
  src: string,
  name: string,
  code?: string
): Promise<HandlerResult> {
  const params: Record<string, string> = { copy_handler: '', value: src, name }
  if (code !== undefined && code.trim().length > 0) params.code = code
  return execHandler(cfg, params)
}

/** 列出 queryhandlers 下已部署的 handler 名（不含匿名节点） */
export async function listHandlers(cfg: WsCommandConfig): Promise<string[]> {
  try {
    const node = await getTreeLayer(cfg, 'Tools/serverinterface/queryhandlers')
    return (node.subnodes || [])
      .map((n) => n.name)
      .filter((n) => n && n.trim().length > 0)
  } catch {
    return []
  }
}

/** 原始命令执行（供「手动命令 / 试调用」面板使用）：params 为任意 参数名=值 */
export async function runRaw(
  cfg: WsCommandConfig,
  params: Record<string, string | number>,
  flags: string[] = [],
  rawParams: Record<string, string> = {}
): Promise<RawResponse> {
  return request(append(cmdRoot(cfg), params, flags, rawParams))
}

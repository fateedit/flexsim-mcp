// 全局类型定义

/** 实例列表中的单个模型实例 */
export interface FlexInstance {
  modelName: string
  instanceNum: number
  /** 原始 XML 文本片段，便于调试 */
  raw: string
}

/**
 * 树节点（来自 WebServer 的 treelayer 接口，JSON 结构）
 * 示例：
 * {
 *   "name": "startTime", "dt": 7, "data": "…",
 *   "subnodes": [
 *     {"name": "dateTime", "dt": 1, "data": 1.34e10, "hasSubnodes": false},
 *     {"name": "dateString", "dt": 2, "data": "8:30:00  2025/8/25", "hasSubnodes": false}
 *   ]
 * }
 */
export interface TreeNode {
  name: string
  /** FlexSim 节点数据类型：1=数字, 2=字符串, 7=目录/复合 等 */
  dt: number
  /** 叶子节点的当前值（数字/字符串） */
  data?: unknown
  /** 是否有子节点，用于懒加载 */
  hasSubnodes?: boolean
  /** 子节点列表（仅在 treelayer 返回里出现） */
  subnodes?: TreeNode[]
}

/** 当前选中的实例命令上下文（所有实例操作的前缀） */
export interface WsCommandConfig {
  base: string
  modelName: string
  instanceNum: number
}

export type WriteStatus = 'success' | 'mismatch' | 'error'

/** setnodedata 的 XML 响应解析结果 */
export interface WriteResult {
  status: WriteStatus
  /** success 时回写的值 */
  written?: string
  /** mismatch 时读回的值 */
  readback?: string
  /** error 时的原因 */
  reason?: string
}

/** 日志面板的一条请求记录 */
export interface RequestLog {
  id: number
  time: string
  method: string
  url: string
  status: number
  durationMs: number
  ok: boolean
}

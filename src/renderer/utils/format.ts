/**
 * 把任意节点值格式化为可读字符串（用于监控/属性面板展示）。
 * 复合节点（数组/对象）会展开显示。
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/**
 * 判断值是否为「复合节点」（数组/对象）。
 * 复合节点不能直接写，必须写其叶子子节点。
 */
export function isComposite(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

export type NodeKind = 'number' | 'string' | 'dir' | 'unknown'

export interface DtMeta {
  kind: NodeKind
  label: string
  icon: string
}

/**
 * 根据 dt 值（及是否含子节点）返回节点的类型元信息，用于显示图标和编辑控件。
 * dt 取值来源于 FlexSim 节点数据类型，常见：1=数字, 2=字符串, 7=目录/复合。
 */
export function dtMeta(dt: number, hasSubnodes?: boolean): DtMeta {
  if (hasSubnodes) return { kind: 'dir', label: '目录', icon: '📁' }
  switch (dt) {
    case 1:
      return { kind: 'number', label: '数字', icon: '🔢' }
    case 2:
      return { kind: 'string', label: '字符串', icon: '🔤' }
    case 7:
      return { kind: 'dir', label: '目录', icon: '📁' }
    default:
      return { kind: 'unknown', label: `类型${dt}`, icon: '❔' }
  }
}

/** 当前时间字符串，用于日志时间戳 */
export function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

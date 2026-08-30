import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as ws from '@/api/webserver'
import { useConnection } from './connection'
import type { TreeNode } from '@/types'

/** 树节点在 UI 层的扩展结构，附带完整路径与展开/加载状态 */
export interface TreeEntry extends TreeNode {
  path: string
  expanded: boolean
  loaded: boolean
  children?: TreeEntry[]
}

function toEntry(n: TreeNode, parentPath: string): TreeEntry {
  const path = parentPath ? `${parentPath}/${n.name}` : n.name
  return {
    ...n,
    path,
    expanded: false,
    loaded: false,
    // 未加载时不带 children，避免渲染空目录
    children: undefined
  }
}

/**
 * 模型树状态：根节点、当前选中、搜索关键字、懒加载展开。
 */
export const useTree = defineStore('tree', () => {
  const root = ref<TreeEntry[]>([])
  const selectedPath = ref('')
  const selectedNode = ref<TreeEntry | null>(null)
  const search = ref('')
  const loadingPath = ref('')
  const error = ref('')

  /** 加载根层（path 为空） */
  async function loadRoot() {
    const conn = useConnection()
    if (!conn.connected) return
    error.value = ''
    try {
      const node = await ws.getTreeLayer(conn.cfg(), '')
      root.value = (node.subnodes || []).map((n) => toEntry(n, ''))
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 展开/收起目录：首次展开时懒加载子层 */
  async function toggleExpand(node: TreeEntry) {
    if (node.expanded) {
      node.expanded = false
      return
    }
    if (!node.loaded) {
      const conn = useConnection()
      loadingPath.value = node.path
      try {
        const resp = await ws.getTreeLayer(conn.cfg(), node.path)
        node.children = (resp.subnodes || []).map((c) => toEntry(c, node.path))
        node.loaded = true
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e)
      } finally {
        loadingPath.value = ''
      }
    }
    node.expanded = true
  }

  /** 选中节点（叶子或目录均可） */
  function select(node: TreeEntry) {
    selectedPath.value = node.path
    selectedNode.value = node
  }

  function clearSelection() {
    selectedPath.value = ''
    selectedNode.value = null
  }

  return {
    root,
    selectedPath,
    selectedNode,
    search,
    loadingPath,
    error,
    loadRoot,
    toggleExpand,
    select,
    clearSelection
  }
})

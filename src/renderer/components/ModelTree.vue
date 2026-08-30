<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import TreeItem from './TreeItem.vue'
import { useTree, type TreeEntry } from '@/stores/tree'

const tree = useTree()

// 搜索：在已加载的节点中按名称过滤（命中自身或任一后代的子节点都会被保留）
function filterNodes(nodes: TreeEntry[], q: string): TreeEntry[] {
  if (!q) return nodes
  const lower = q.toLowerCase()
  const out: TreeEntry[] = []
  for (const n of nodes) {
    const kids = n.children ? filterNodes(n.children, q) : []
    const selfMatch = n.name.toLowerCase().includes(lower)
    if (selfMatch || kids.length) {
      out.push({ ...n, children: kids.length ? kids : n.children, expanded: true })
    }
  }
  return out
}

const visibleRoot = computed(() =>
  filterNodes(tree.root, tree.search.trim())
)
</script>

<template>
  <div class="tree-panel">
    <div class="panel-head">
      <div class="panel-title">
        <Icon name="folder" :size="15" /> 模型树
      </div>
      <button
        class="mini ghost"
        @click="tree.loadRoot()"
        :disabled="!tree.root.length"
        title="重新加载模型树"
      >
        <Icon name="refresh" :size="13" /> 重载
      </button>
    </div>

    <div class="search-row">
      <div class="input-wrap">
        <Icon name="search" :size="13" class="input-icon" />
        <input v-model="tree.search" class="search-input" placeholder="搜索节点名…" />
      </div>
    </div>

    <div class="tree-body">
      <div v-if="!tree.root.length && !tree.error" class="empty muted">
        未连接或无节点
      </div>
      <div v-else-if="tree.error" class="empty err-text">
        <Icon name="alert" :size="14" /> {{ tree.error }}
      </div>
      <template v-else>
        <TreeItem v-for="n in visibleRoot" :key="n.path" :node="n" :depth="0" />
        <div v-if="visibleRoot.length === 0" class="empty muted">无匹配节点</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tree-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--border);
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  background: var(--accent-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.panel-title :deep(.icon-wrap) {
  color: var(--accent);
}
.search-row {
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--border);
}
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.input-wrap .input-icon {
  position: absolute;
  left: 9px;
  color: var(--text-faint);
  pointer-events: none;
}
.search-input {
  padding-left: 28px;
  width: 100%;
  font-size: 12px;
}
.mini {
  padding: 3px 9px;
  font-size: 11px;
}
.tree-body {
  flex: 1;
  overflow: auto;
  padding: 6px 8px 12px;
}
.empty {
  padding: 18px 12px;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.empty :deep(.icon-wrap) {
  animation: floatY 4s ease-in-out infinite;
}
.err-text {
  color: var(--danger);
}
</style>

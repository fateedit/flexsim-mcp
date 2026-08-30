<script setup lang="ts">
import Icon from './Icon.vue'
import TreeItem from './TreeItem.vue'
import { useTree, type TreeEntry } from '@/stores/tree'
import { dtMeta, formatValue } from '@/utils/format'

const props = defineProps<{ node: TreeEntry; depth: number }>()

const tree = useTree()

const meta = () => dtMeta(props.node.dt, props.node.hasSubnodes)
const isDir = () => !!props.node.hasSubnodes
const isSelected = () => tree.selectedPath === props.node.path
const isLoading = () => tree.loadingPath === props.node.path

// 节点类型 → 线性图标名
function iconName(): string {
  const k = meta().kind
  if (k === 'dir') return 'folder'
  if (k === 'number') return 'hash'
  if (k === 'string') return 'text'
  return 'help'
}

// 叶子节点的旁注值（小字）
const annotation = () => {
  if (isDir()) return ''
  if (props.node.data === undefined || props.node.data === null) return ''
  return formatValue(props.node.data)
}
</script>

<template>
  <div class="node">
    <div
      class="row"
      :class="{ selected: isSelected() }"
      :style="{ paddingLeft: 8 + depth * 16 + 'px' }"
      @click="tree.select(node)"
    >
      <!-- 目录展开/收起 -->
      <span
        v-if="isDir()"
        class="caret"
        :class="{ open: node.expanded }"
        @click.stop="tree.toggleExpand(node)"
      >
        <Icon name="chevron" :size="13" />
      </span>
      <span v-else class="caret placeholder"></span>

      <span class="icon" :class="meta().kind"><Icon :name="iconName()" :size="14" /></span>
      <span class="name">{{ node.name }}</span>
      <span v-if="annotation()" class="anno muted">{{ annotation() }}</span>
      <span v-if="isLoading()" class="loading">
        <Icon name="refresh" :size="12" class="spin" />
      </span>
    </div>

    <!-- 递归渲染子节点（带缩进引导线） -->
    <div
      v-if="node.expanded && node.children && node.children.length"
      class="children"
      :style="{ marginLeft: 8 + depth * 16 + 12 + 'px' }"
    >
      <TreeItem
        v-for="c in node.children"
        :key="c.path"
        :node="c"
        :depth="depth + 1"
      />
    </div>
    <div
      v-else-if="node.expanded && node.loaded && (!node.children || !node.children.length)"
      class="leaf-hint"
      :style="{ paddingLeft: 8 + (depth + 1) * 16 + 'px' }"
    >
      <span class="muted">（空目录）</span>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  border-radius: var(--r-xs);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  transition: background var(--t), color var(--t);
}
.row:hover {
  background: var(--surface-hover);
}
.row.selected {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}
.row.selected .name {
  color: var(--accent);
  font-weight: 600;
}
.caret {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  border-radius: 4px;
  transition: transform var(--t), background var(--t), color var(--t);
}
.caret:hover {
  background: var(--surface-3);
  color: var(--text);
}
.caret.open {
  transform: rotate(90deg);
}
.caret.placeholder {
  visibility: hidden;
}
.icon {
  flex-shrink: 0;
  display: inline-flex;
  color: var(--text-dim);
}
.icon.dir {
  color: var(--accent);
}
.icon.number {
  color: var(--accent-2);
}
.icon.string {
  color: #c084fc;
}
.icon.unknown {
  color: var(--text-faint);
}
.name {
  font-size: 12.5px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.anno {
  font-size: 11px;
  margin-left: auto;
  padding-right: 4px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-faint);
  background: var(--surface-3);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}
.loading {
  margin-left: auto;
  padding-right: 8px;
  color: var(--accent);
}
.spin {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.leaf-hint {
  font-size: 11px;
  height: 22px;
  display: flex;
  align-items: center;
}
.children {
  border-left: 1px solid var(--border);
}
</style>

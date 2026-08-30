<script setup lang="ts">
import { ref } from 'vue'
import ModelTree from './ModelTree.vue'
import NodeEditor from './NodeEditor.vue'
import PropertyPanel from './PropertyPanel.vue'
import McpPanel from './McpPanel.vue'

/** 右栏：模型树 / 节点编辑 / 属性 / MCP 四页签（v-show 保持各页状态） */
const tabs = [
  { id: 'tree', label: '模型树' },
  { id: 'node', label: '节点编辑' },
  { id: 'prop', label: '属性' },
  { id: 'mcp', label: 'MCP' }
] as const
type TabId = (typeof tabs)[number]['id']
const cur = ref<TabId>('tree')
</script>

<template>
  <div class="rp">
    <div class="rp-tabs">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="rp-tab"
        :class="{ active: cur === t.id }"
        @click="cur = t.id"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="rp-body">
      <ModelTree v-show="cur === 'tree'" class="rp-cell" />
      <NodeEditor v-show="cur === 'node'" class="rp-cell" />
      <PropertyPanel v-show="cur === 'prop'" class="rp-cell" />
      <McpPanel v-show="cur === 'mcp'" class="rp-cell" />
    </div>
  </div>
</template>

<style scoped>
.rp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--glass);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border-left: 1px solid var(--glass-border);
}
.rp-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
  flex-shrink: 0;
}
.rp-tab {
  flex: 1;
  padding: 5px 0;
  font-size: 12px;
  border-radius: var(--r-sm);
  border: 1px solid transparent;
  color: var(--text-dim);
  background: transparent;
  cursor: pointer;
  transition: all var(--t);
}
.rp-tab:hover {
  color: var(--text);
}
.rp-tab.active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent);
  font-weight: 600;
}
.rp-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
.rp-cell {
  position: absolute;
  inset: 0;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import { useAgent } from '@/stores/agent'
import { useConnection } from '@/stores/connection'
import registry from '../../shared/registry.json'

const agent = useAgent()
const conn = useConnection()

interface CatalogItem {
  id: string
  name: string
  category: string
  desc: string
  params: { key: string; label: string; optional?: boolean }[]
  code: string
}
const catalog = (registry.catalog as CatalogItem[]) ?? []

const groups = computed(() => {
  const map = new Map<string, CatalogItem[]>()
  for (const item of catalog) {
    const g = item.category || '其他'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(item)
  }
  return Array.from(map.entries())
})

const deploying = computed(() => agent.busy)
</script>

<template>
  <div class="cat-panel">
    <div class="panel-head">
      <div class="panel-title">
        <Icon name="list" :size="15" /> 功能目录
      </div>
      <span class="head-hint muted">选择 → AI 自动部署</span>
    </div>

    <div class="cat-body">
      <div v-if="!conn.connected" class="gate muted">
        <Icon name="link" :size="14" />
        请先连接 WebServer 并选择目标实例
      </div>

      <div v-for="[group, items] in groups" :key="group" class="cat-group">
        <div class="group-title">{{ group }}</div>
        <div v-for="item in items" :key="item.id" class="cat-item">
          <div class="cat-info">
            <div class="cat-name">{{ item.name }}</div>
            <div class="cat-desc muted">{{ item.desc }}</div>
          </div>
          <button
            class="mini primary deploy-btn"
            :disabled="deploying || !conn.connected"
            :title="`让 AI 把「${item.name}」部署到当前模型并验证`"
            @click="agent.deployCatalogItem(item)"
          >
            <Icon name="plus" :size="12" /> 部署
          </button>
        </div>
      </div>

      <div class="cat-foot muted">
        部署仅修改运行实例内存；持久化请在 FlexSim 界面 Ctrl+S。
      </div>
    </div>
  </div>
</template>

<style scoped>
.cat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--glass);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border-right: 1px solid var(--glass-border);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
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
.head-hint {
  font-size: 10.5px;
}
.cat-body {
  flex: 1;
  overflow: auto;
  padding: 6px 12px 12px;
}
.gate {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 14px 6px;
  color: var(--warn);
}
.cat-group {
  margin-top: 10px;
}
.group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.5px;
  margin: 0 4px 4px;
}
.cat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  margin-bottom: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r);
  transition: border-color var(--t), box-shadow var(--t);
}
.cat-item:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.cat-info {
  flex: 1;
  min-width: 0;
}
.cat-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
}
.cat-desc {
  font-size: 11px;
  line-height: 1.5;
  margin-top: 2px;
  color: var(--text-dim);
}
.deploy-btn {
  flex-shrink: 0;
}
.cat-foot {
  font-size: 10.5px;
  color: var(--text-faint);
  text-align: center;
  margin-top: 10px;
  padding: 0 8px;
}
</style>

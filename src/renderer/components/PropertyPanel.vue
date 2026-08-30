<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import * as ws from '@/api/webserver'
import { useConnection } from '@/stores/connection'
import { useTree } from '@/stores/tree'
import { useMonitor } from '@/stores/monitor'
import { useUi } from '@/stores/ui'
import { dtMeta, formatValue } from '@/utils/format'

const conn = useConnection()
const tree = useTree()
const monitor = useMonitor()
const ui = useUi()

const liveValue = ref<unknown>(null)
const copied = ref(false)

const node = computed(() => tree.selectedNode)

const meta = computed(() =>
  node.value ? dtMeta(node.value.dt, node.value.hasSubnodes) : null
)
const iconName = computed(() => {
  const k = meta.value?.kind
  if (k === 'dir') return 'folder'
  if (k === 'number') return 'hash'
  if (k === 'string') return 'text'
  return 'help'
})

const subnodeCount = computed(() => {
  if (!node.value) return '-'
  if (node.value.hasSubnodes) return node.value.children ? node.value.children.length : '目录(未展开)'
  return '叶子'
})

const inMonitor = computed(() =>
  node.value ? monitor.items.some((i) => i.path === node.value!.path) : false
)

// 选中变化或加入监控后，刷新一次实时值预览
watch(
  () => tree.selectedPath,
  async (p) => {
    copied.value = false
    if (!p || !node.value) return
    await refreshValue()
  }
)

async function refreshValue() {
  if (!node.value) return
  try {
    liveValue.value = await ws.getNodeData(conn.cfg(), tree.selectedPath)
  } catch {
    liveValue.value = '读取失败'
  }
}

async function copyPath() {
  if (!node.value) return
  try {
    await navigator.clipboard.writeText(node.value.path)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 剪贴板不可用时静默忽略 */
  }
}

function addToMonitor() {
  if (node.value) monitor.add(node.value.path)
}

async function takeScreenshot() {
  if (!conn.connected) return
  try {
    const url = await ws.screenshot(conn.cfg())
    ui.openScreenshot(url)
  } catch (e) {
    alert('截图失败：' + (e instanceof Error ? e.message : String(e)))
  }
}
</script>

<template>
  <div class="prop">
    <div class="panel-head">
      <div class="panel-title">
        <Icon name="list" :size="15" /> 属性面板
      </div>
    </div>

    <div v-if="!node" class="empty muted">未选择节点</div>

    <template v-else>
      <div class="field">
        <label>节点路径</label>
        <div class="path-row">
          <code class="path">{{ node.path }}</code>
          <button class="mini ghost" @click="copyPath">
            <Icon :name="copied ? 'check' : 'copy'" :size="13" />
            {{ copied ? '已复制' : '复制' }}
          </button>
        </div>
      </div>

      <div class="kv">
        <span class="k">类型</span>
        <span class="v">
          <Icon :name="iconName" :size="13" class="kv-icon" />
          {{ meta?.label }} <span class="dim">(dt={{ node.dt }})</span>
        </span>
      </div>
      <div class="kv">
        <span class="k">子节点数</span>
        <span class="v">{{ subnodeCount }}</span>
      </div>
      <div class="kv">
        <span class="k">树缓存值</span>
        <span class="v break">{{ formatValue(node.data) }}</span>
      </div>
      <div class="kv">
        <span class="k">实时值</span>
        <span class="v break">{{ liveValue === null ? '—' : formatValue(liveValue) }}</span>
      </div>

      <div class="actions">
        <button class="primary" @click="addToMonitor" :disabled="inMonitor">
          <Icon :name="inMonitor ? 'check' : 'plus'" :size="14" />
          {{ inMonitor ? '已监控' : '加入监控' }}
        </button>
        <button @click="takeScreenshot">
          <Icon name="camera" :size="14" /> 截图
        </button>
        <button @click="refreshValue">
          <Icon name="refresh" :size="14" /> 刷新值
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.prop {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px 14px;
  overflow: auto;
}
.panel-head {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 12px;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.panel-title :deep(.icon-wrap) {
  color: var(--accent);
}
.empty {
  padding: 30px 0;
  text-align: center;
  color: var(--text-dim);
}
.field {
  margin-bottom: 14px;
}
.field label {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 6px;
  letter-spacing: 0.3px;
}
.path-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.path {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 6px 8px;
  word-break: break-all;
  color: var(--accent);
}
.mini {
  padding: 4px 9px;
  font-size: 11px;
}
.kv {
  display: flex;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  align-items: baseline;
}
.k {
  color: var(--text-dim);
  width: 62px;
  flex-shrink: 0;
}
.v {
  flex: 1;
  min-width: 0;
}
.v.break {
  word-break: break-all;
}
.kv-icon {
  color: var(--accent);
  vertical-align: -2px;
  margin-right: 4px;
}
.dim {
  color: var(--text-faint);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
</style>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from './Icon.vue'
import QuickSettings from './QuickSettings.vue'
import * as ws from '@/api/webserver'
import { useConnection } from '@/stores/connection'
import { useTree } from '@/stores/tree'
import { useSettings } from '@/stores/settings'
import { formatValue, isComposite, dtMeta } from '@/utils/format'

const conn = useConnection()
const tree = useTree()
const settings = useSettings()

const currentValue = ref<unknown>(null)
const inputValue = ref('')
const isCompositeNode = ref(false)
const isNumber = ref(false)
const loading = ref(false)
const statusText = ref('')
const statusType = ref<'ok' | 'err' | 'warn' | ''>('')

const node = computed(() => tree.selectedNode)
const canEdit = computed(() => !!node.value && !isCompositeNode.value)

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

// 选中节点变化时，读取最新值
watch(
  () => tree.selectedPath,
  async (p) => {
    if (!p || !node.value) return
    await loadValue()
  }
)

async function loadValue() {
  if (!node.value) return
  loading.value = true
  statusText.value = ''
  statusType.value = ''
  try {
    const v = await ws.getNodeData(conn.cfg(), tree.selectedPath)
    currentValue.value = v
    isCompositeNode.value = isComposite(v)
    isNumber.value = typeof v === 'number'
    inputValue.value = isComposite(v) ? '' : formatValue(v)
  } catch (e) {
    statusType.value = 'err'
    statusText.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

/** 重置输入框为当前已读取值（放弃本地未保存改动，不发起网络请求） */
function onReset() {
  inputValue.value = formatValue(currentValue.value)
  statusText.value = ''
  statusType.value = ''
}

async function onSave() {
  if (!node.value || !canEdit.value) return
  if (settings.readOnly) {
    statusType.value = 'err'
    statusText.value = '只读模式：保存被禁用'
    return
  }
  loading.value = true
  try {
    const res = await ws.writeNode(conn.cfg(), tree.selectedPath, inputValue.value)
    if (res.status === 'success') {
      statusType.value = 'ok'
      statusText.value = `写入成功（回读验证一致）`
      await loadValue() // 保存后刷新当前值
    } else if (res.status === 'mismatch') {
      statusType.value = 'warn'
      statusText.value = `回读不一致：写入「${res.written}」读回「${res.readback}」`
      await loadValue()
    } else {
      statusType.value = 'err'
      statusText.value = `写入失败：${res.reason || '未知错误'}`
    }
  } catch (e) {
    statusType.value = 'err'
    statusText.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="editor">
    <!-- 顶部：快捷设置卡片 -->
    <QuickSettings />

    <!-- 选中节点的读/写编辑区 -->
    <div class="node-section">
      <div class="section-title">节点值编辑</div>

      <div v-if="!node" class="placeholder muted">
        <Icon name="folder" :size="22" />
        <span>从左侧模型树选择一个节点以查看 / 编辑其值</span>
      </div>

      <template v-else>
        <div class="node-card">
          <div class="node-head">
            <span class="node-icon" :class="meta?.kind">
              <Icon :name="iconName" :size="16" />
            </span>
            <span class="node-name">{{ node.name }}</span>
            <span class="tag">{{ meta?.label }}</span>
          </div>

          <div v-if="isCompositeNode" class="composite-note">
            <div class="composite-title">
              <Icon name="alert" :size="14" /> 复合节点（数组 / 对象）
            </div>
            <p class="muted">不能直接写入，请在左侧展开后编辑其叶子子节点。</p>
            <pre class="composite-val">{{ formatValue(currentValue) }}</pre>
          </div>

          <div v-else class="edit-area">
            <div class="field">
              <label class="field-label">当前值</label>
              <div class="current"><code>{{ formatValue(currentValue) }}</code></div>
            </div>

            <div class="field">
              <label class="field-label">新值</label>
              <input
                v-if="isNumber"
                type="number"
                v-model="inputValue"
                :disabled="settings.readOnly"
                @keyup.enter="onSave"
              />
              <textarea
                v-else
                rows="3"
                v-model="inputValue"
                :disabled="settings.readOnly"
                @keyup.ctrl.enter="onSave"
              ></textarea>
            </div>

            <div class="actions">
              <button class="primary" @click="onSave" :disabled="settings.readOnly || loading">
                <Icon name="check" :size="14" /> 保存
              </button>
              <button @click="onReset" :disabled="loading">
                <Icon name="reset" :size="14" /> 重置
              </button>
              <button @click="loadValue" :disabled="loading">
                <Icon name="refresh" :size="14" /> 刷新
              </button>
            </div>

            <div v-if="statusText" class="status-bar" :class="statusType">
              {{ statusText }}
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
  padding: 14px 18px;
}
.node-section {
  margin-top: 16px;
}
.placeholder {
  padding: 48px 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-dim);
}
.placeholder :deep(.icon-wrap) {
  color: var(--text-faint);
  animation: floatY 4s ease-in-out infinite;
}
.node-card {
  margin-top: 10px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border: 1px solid var(--glass-border);
  border-radius: var(--r-md);
  padding: 16px;
  box-shadow: var(--shadow-sm);
}
.node-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
}
.node-icon {
  display: inline-flex;
  color: var(--accent);
}
.node-icon.number {
  color: var(--accent-2);
}
.node-icon.string {
  color: #c084fc;
}
.node-name {
  font-size: 16px;
  font-weight: 600;
}
.field {
  margin-bottom: 14px;
}
.field-label {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 6px;
  letter-spacing: 0.3px;
}
.current {
  font-size: 13px;
  word-break: break-all;
  padding: 9px 11px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.current code {
  font-family: var(--font-mono);
  color: var(--text);
}
textarea,
input[type='number'] {
  width: 100%;
  font-family: var(--font-mono);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.composite-note {
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 14px;
}
.composite-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--warn);
  font-weight: 600;
}
.composite-note p {
  margin: 8px 0 0;
}
.composite-val {
  margin: 10px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-dim);
  font-family: var(--font-mono);
  background: var(--surface);
  padding: 10px;
  border-radius: var(--r-sm);
}
</style>

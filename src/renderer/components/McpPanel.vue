<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { useConnection } from '@/stores/connection'

const conn = useConnection()

interface McpTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}
const tools = ref<McpTool[]>([])
const loadErr = ref('')
const copied = ref<'cmd' | 'cfg' | ''>('')

// 调用测试
const selTool = ref('')
const argsText = ref('{}')
const callResult = ref('')
const callBusy = ref(false)
const callErr = ref('')

const startCmd = computed(
  () => `node "D:\\Workspace\\CodeBuddy\\Project\\flexsim-ai\\electron-app\\electron\\mcp-server.cjs"`
)
const clientCfg = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        flexsim: {
          command: 'node',
          args: [
            'D:\\Workspace\\CodeBuddy\\Project\\flexsim-ai\\electron-app\\electron\\mcp-server.cjs'
          ]
        }
      }
    },
    null,
    2
  )
)

async function loadTools() {
  const r = await window.api.mcpListTools()
  if (r.ok && r.tools) {
    tools.value = r.tools
  } else {
    loadErr.value = r.error || '加载失败'
  }
}

async function copyText(text: string, which: 'cmd' | 'cfg') {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = which
    setTimeout(() => (copied.value = ''), 1500)
  } catch {
    /* ignore */
  }
}

function selToolParams(): string {
  const t = tools.value.find((x) => x.name === selTool.value)
  if (!t) return '{}'
  const props = (t.parameters.properties || {}) as Record<string, { type?: string; description?: string }>
  const obj: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    obj[k] = v.type === 'number' || v.type === 'integer' ? 0 : v.type === 'boolean' ? false : ''
  }
  return JSON.stringify(obj, null, 2)
}

function onToolSelect() {
  argsText.value = selToolParams()
}

async function runCall() {
  if (!selTool.value) return
  callBusy.value = true
  callErr.value = ''
  callResult.value = ''
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(argsText.value || '{}')
  } catch {
    callErr.value = '参数不是合法 JSON'
    callBusy.value = false
    return
  }
  const r = await window.api.mcpCall(selTool.value, args)
  if (r.ok) {
    callResult.value = r.text || ''
  } else {
    callErr.value = r.error || '调用失败'
  }
  callBusy.value = false
}

onMounted(loadTools)
</script>

<template>
  <div class="mcp-panel">
    <div class="panel-head">
      <div class="panel-title">
        <Icon name="robot" :size="15" /> MCP 连接器
      </div>
      <span class="muted small">FlexSim WebServer MCP Server</span>
    </div>

    <div class="mcp-body">
      <!-- 状态 -->
      <div class="status-card" :class="conn.connected ? 'ok' : 'err'">
        <Icon :name="conn.connected ? 'check' : 'link'" :size="14" />
        <span>
          WebServer {{ conn.connected ? `已连接 · ${conn.modelName} #${conn.instanceNum}` : '未连接' }}
        </span>
        <span class="dim">（MCP 工具执行于 WebServer 之上）</span>
      </div>

      <!-- 启动方式 -->
      <div class="block">
        <div class="block-title">启动（作为 MCP server 供外部客户端接入）</div>
        <div class="cmd-row">
          <code class="cmd">{{ startCmd }}</code>
          <button class="mini" @click="copyText(startCmd, 'cmd')">
            {{ copied === 'cmd' ? '已复制' : '复制' }}
          </button>
        </div>
        <div class="dim">Claude Desktop / Cursor 配置（mcpServers）</div>
        <div class="cmd-row">
          <pre class="cfg">{{ clientCfg }}</pre>
          <button class="mini" @click="copyText(clientCfg, 'cfg')">
            {{ copied === 'cfg' ? '已复制' : '复制' }}
          </button>
        </div>
      </div>

      <!-- 调用测试 -->
      <div class="block">
        <div class="block-title">调用测试（界面内直接调 MCP 工具）</div>
        <select v-model="selTool" @change="onToolSelect">
          <option value="">选择工具…</option>
          <option v-for="t in tools" :key="t.name" :value="t.name">{{ t.name }}</option>
        </select>
        <div v-if="selTool" class="tool-desc dim">
          {{ tools.find((t) => t.name === selTool)?.description }}
        </div>
        <textarea v-model="argsText" rows="3" spellcheck="false" placeholder='{"path":"MODEL:"}'></textarea>
        <button class="primary" @click="runCall" :disabled="!selTool || callBusy">
          <Icon name="bolt" :size="13" /> {{ callBusy ? '调用中…' : '调用' }}
        </button>
        <pre v-if="callResult" class="call-result">{{ callResult }}</pre>
        <div v-if="callErr" class="call-err">{{ callErr }}</div>
      </div>

      <!-- 工具清单 -->
      <div class="block">
        <div class="block-title">工具清单（{{ tools.length }} 个）</div>
        <div v-if="loadErr" class="call-err">{{ loadErr }}</div>
        <div v-for="t in tools" :key="t.name" class="tool-item">
          <div class="tool-item-head">
            <code>{{ t.name }}</code>
            <span class="dim">{{ Object.keys((t.parameters.properties || {})).join(' ') || '无参数' }}</span>
          </div>
          <div class="tool-item-desc dim">{{ t.description }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mcp-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.panel-title :deep(.icon-wrap) {
  color: var(--accent);
}
.small {
  font-size: 10.5px;
}
.mcp-body {
  flex: 1;
  overflow: auto;
  padding: 10px 14px;
}
.status-card {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  margin-bottom: 10px;
}
.status-card.ok {
  color: var(--success);
  background: var(--success-soft);
}
.status-card.err {
  color: var(--warn);
  background: var(--warn-soft);
}
.dim {
  color: var(--text-faint);
  font-size: 11px;
}
.block {
  margin-bottom: 14px;
}
.block-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.cmd-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 6px;
}
.cmd {
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
.cfg {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  font-family: var(--font-mono);
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-dim);
  margin: 0;
}
select,
textarea {
  width: 100%;
  margin-bottom: 6px;
  font-size: 12px;
}
.tool-desc {
  margin-bottom: 6px;
  line-height: 1.5;
}
.call-result {
  margin-top: 6px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  font-size: 11px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
  color: var(--text);
}
.call-err {
  margin-top: 6px;
  font-size: 12px;
  color: var(--danger);
}
.tool-item {
  padding: 7px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  margin-bottom: 6px;
  background: var(--surface-2);
}
.tool-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}
.tool-item-head code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--accent);
}
.tool-item-desc {
  line-height: 1.5;
}
</style>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useAgent } from '@/stores/agent'
import { useConnection } from '@/stores/connection'
import { useSettings } from '@/stores/settings'
import { useUi } from '@/stores/ui'

const agent = useAgent()
const conn = useConnection()
const settings = useSettings()
const ui = useUi()

const input = ref('')
const bodyRef = ref<HTMLElement | null>(null)

interface EventItem {
  type: 'user' | 'ai' | 'tool'
  text?: string
  name?: string
  args?: string
  result?: string
  ok?: boolean
}

/** 把消息序列 + 工具痕迹合成时间线 */
const events = computed<EventItem[]>(() => {
  const out: EventItem[] = []
  for (const m of agent.messages) {
    if (m.role === 'user') {
      out.push({ type: 'user', text: m.content ?? '' })
    } else if (m.role === 'assistant') {
      if (m.content) out.push({ type: 'ai', text: m.content })
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          const tr = agent.traces.find((t) => t.id === tc.id)
          out.push({
            type: 'tool',
            name: tc.function.name,
            args: tc.function.arguments,
            result: tr?.result ?? '（执行中…）',
            ok: tr ? tr.ok : true
          })
        }
      }
    }
  }
  return out
})

function prettyArgs(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

const statusText = computed(() => {
  switch (agent.status) {
    case 'thinking':
      return 'AI 正在思考…'
    case 'running-tool':
      return '正在执行工具…'
    case 'awaiting-confirm':
      return '等待确认'
    case 'done':
      return '完成'
    case 'error':
      return '出错了'
    default:
      return ''
  }
})

// 自动滚到底部
watch(
  () => [agent.messages.length, agent.traces.length, agent.status],
  async () => {
    await nextTick()
    if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  }
)

function send() {
  const t = input.value.trim()
  if (!t || agent.busy) return
  input.value = ''
  agent.send(t)
}
</script>

<template>
  <div class="ai-panel">
    <div class="ai-head">
      <div class="ai-title">
        <Icon name="robot" :size="17" /> AI 助手
        <span v-if="statusText" class="status-chip" :class="agent.status">
          {{ statusText }}
        </span>
      </div>
      <div class="head-actions">
        <button class="mini ghost" @click="agent.resetConversation()" title="清空对话">
          <Icon name="refresh" :size="13" /> 新对话
        </button>
        <button class="mini ghost" @click="ui.openSettings()" title="API 配置在设置中">
          <Icon name="settings" :size="13" /> API 配置
        </button>
      </div>
    </div>

    <!-- 连接门禁 -->
    <div v-if="!conn.connected" class="gate">
      <Icon name="link" :size="16" />
      请先在工具栏「连接测试」并选择目标实例，AI 才能操作模型。
    </div>

    <div v-else class="ai-body" ref="bodyRef">
      <!-- 目标实例提示 -->
      <div class="target-hint muted">
        当前目标实例：{{ conn.modelName }} #{{ conn.instanceNum }}
        <span v-if="settings.readOnly" class="ro-badge">只读模式（写操作会被拦截）</span>
      </div>

      <!-- 空状态 -->
      <div v-if="!events.length && agent.status !== 'awaiting-confirm'" class="placeholder muted">
        <Icon name="robot" :size="34" />
        <span>
          我是你的 FlexSim 建模助手，你可以：<br />
          · 「打开 ai 模型」——我来启动模型实例<br />
          · 「给 ai 模型加一个能列出所有对象名的 handler」<br />
          · 「创建一个 Source→Queue→Sink 产线并运行，看释放了多少实体」<br />
          · 或在左侧「功能目录」点选功能，我来自动部署
        </span>
      </div>

      <!-- 对话时间线 -->
      <template v-for="(ev, i) in events" :key="i">
        <div v-if="ev.type === 'user'" class="bubble user">{{ ev.text }}</div>
        <div v-else-if="ev.type === 'ai'" class="bubble ai">{{ ev.text }}</div>
        <div v-else class="tool-card" :class="{ err: ev.ok === false }">
          <div class="tool-head">
            <span class="tool-name">
              <Icon :name="ev.ok === false ? 'alert' : 'bolt'" :size="13" />
              {{ ev.name }}
            </span>
            <span class="tool-state">{{ ev.ok === false ? '失败' : '已执行' }}</span>
          </div>
          <pre v-if="ev.args && ev.args !== '{}'" class="tool-args">{{ prettyArgs(ev.args) }}</pre>
          <div class="tool-result">{{ ev.result }}</div>
        </div>
      </template>

      <!-- 等待确认的工具调用 -->
      <div v-if="agent.status === 'awaiting-confirm'" class="confirm-box">
        <div class="confirm-title">
          <Icon name="alert" :size="14" /> AI 请求执行以下操作，请确认：
        </div>
        <div v-for="tc in agent.pendingCalls" :key="tc.id" class="pending-call">
          <div class="tool-head">
            <span class="tool-name"><Icon name="bolt" :size="13" /> {{ tc.function.name }}</span>
          </div>
          <pre class="tool-args">{{ prettyArgs(tc.function.arguments) }}</pre>
        </div>
        <div class="confirm-actions">
          <button class="primary" @click="agent.confirmPending()">
            <Icon name="check" :size="13" /> 全部执行
          </button>
          <button @click="agent.rejectPending()">
            <Icon name="x" :size="13" /> 拒绝
          </button>
        </div>
        <div class="hint muted">可在下方「AI 配置」改为自动执行（不推荐对真实模型开启）</div>
      </div>

      <!-- 思考指示 -->
      <div v-if="agent.busy" class="thinking muted">
        <span class="dots"><i></i><i></i><i></i></span>
        {{ statusText }}
      </div>

      <!-- 错误 -->
      <div v-if="agent.status === 'error' && agent.errorMsg" class="bubble ai err-bubble">
        <Icon name="alert" :size="13" /> {{ agent.errorMsg }}
      </div>
    </div>

    <!-- AI 配置 -->
    <div class="ai-config">
      <div class="config-hint">
        <Icon name="settings" :size="13" />
        LLM API（Base URL / Key / 模型）请在
        <button class="link-btn" @click="ui.openSettings()">⚙ 设置</button>
        中配置，此处不再重复
      </div>
    </div>

    <div class="ai-input">
      <textarea
        v-model="input"
        rows="2"
        placeholder="输入指令，Enter 发送 / Shift+Enter 换行…"
        :disabled="!conn.connected || agent.busy"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <button
        class="primary"
        @click="send"
        :disabled="!conn.connected || agent.busy || !input.trim()"
      >
        <Icon name="bolt" :size="14" /> 发送
      </button>
    </div>
  </div>
</template>

<style scoped>
.ai-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--glass);
  -webkit-backdrop-filter: blur(calc(var(--glass-blur) * 0.6)) saturate(130%);
  backdrop-filter: blur(calc(var(--glass-blur) * 0.6)) saturate(130%);
}
.ai-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.ai-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
  background: var(--accent-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.ai-title :deep(.icon-wrap) {
  color: var(--accent);
}
.status-chip {
  font-size: 10.5px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  border: 1px solid var(--border);
  color: var(--text-dim);
  -webkit-background-clip: initial;
  background-clip: initial;
  color: var(--text-dim);
}
.status-chip.thinking,
.status-chip.running-tool {
  color: var(--accent);
  border-color: var(--accent);
  animation: pulseRing 2s ease-out infinite;
}
.status-chip.awaiting-confirm {
  color: var(--warn);
  border-color: var(--warn);
}
.status-chip.error {
  color: var(--danger);
  border-color: var(--danger);
}
.gate {
  padding: 18px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--warn);
  font-size: 12.5px;
  border-bottom: 1px solid var(--border);
}
.ai-body {
  flex: 1;
  overflow: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.target-hint {
  font-size: 11px;
  padding: 6px 10px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
}
.ro-badge {
  color: var(--warn);
  margin-left: 6px;
}
.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;
  padding: 30px 16px;
  line-height: 2;
  color: var(--text-dim);
  font-size: 12.5px;
}
.placeholder :deep(.icon-wrap) {
  color: var(--text-faint);
  animation: floatY 4s ease-in-out infinite;
}
.bubble {
  max-width: 92%;
  padding: 9px 12px;
  border-radius: var(--r);
  font-size: 12.5px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
  box-shadow: var(--shadow-sm);
}
.bubble.user {
  align-self: flex-end;
  background: var(--accent-grad);
  color: #04243d;
  border-bottom-right-radius: 4px;
}
.bubble.ai {
  align-self: flex-start;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-bottom-left-radius: 4px;
}
.err-bubble {
  color: var(--danger);
  display: flex;
  align-items: center;
  gap: 6px;
}
.tool-card {
  align-self: flex-start;
  width: 100%;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--r-sm);
  padding: 8px 10px;
  font-size: 11.5px;
}
.tool-card.err {
  border-left-color: var(--danger);
}
.tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.tool-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  color: var(--text);
  font-family: var(--font-mono);
}
.tool-name :deep(.icon-wrap) {
  color: var(--accent);
}
.tool-card.err .tool-name :deep(.icon-wrap) {
  color: var(--danger);
}
.tool-state {
  font-size: 10px;
  color: var(--text-faint);
}
.tool-args {
  margin: 4px 0;
  padding: 6px 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  font-size: 11px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-dim);
}
.tool-result {
  color: var(--text-dim);
  word-break: break-all;
  font-family: var(--font-mono);
  font-size: 11px;
  max-height: 120px;
  overflow: auto;
}
.thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 2px;
}
.dots i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 3px;
  border-radius: 50%;
  background: var(--accent);
  animation: bounce 1.2s infinite;
}
.dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.dots i:nth-child(3) {
  animation-delay: 0.3s;
}
.confirm-box {
  background: var(--warn-soft);
  border: 1px solid var(--warn);
  border-radius: var(--r);
  padding: 10px;
}
.confirm-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--warn);
  font-weight: 600;
  font-size: 12.5px;
  margin-bottom: 8px;
}
.pending-call {
  margin-bottom: 8px;
}
.confirm-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.ai-config {
  border-top: 1px solid var(--border);
  padding: 8px 12px;
  background: var(--surface-2);
}
.config-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-dim);
}
.config-hint :deep(.icon-wrap) {
  color: var(--text-faint);
}
.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
}
.head-actions {
  display: flex;
  gap: 6px;
}
.ai-input {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
}
.ai-input textarea {
  flex: 1;
  resize: none;
}
.mini {
  padding: 3px 8px;
}
@keyframes bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.6;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
</style>

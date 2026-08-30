<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import { useConnection } from '@/stores/connection'
import { useSettings } from '@/stores/settings'
import { useTree } from '@/stores/tree'
import { useUi } from '@/stores/ui'

const conn = useConnection()
const settings = useSettings()
const tree = useTree()
const ui = useUi()

const openModelName = ref('')
const openMsg = ref('')

const statusText = computed(() =>
  conn.loading
    ? '连接中…'
    : conn.connected
      ? `已连接 · ${conn.modelName || '未选实例'}`
      : '未连接'
)

async function onTest() {
  await conn.test()
}

function onSelectInstance(e: Event) {
  const idx = Number((e.target as HTMLSelectElement).value)
  const inst = conn.instances[idx]
  if (inst) {
    conn.selectInstance(inst)
    tree.loadRoot()
    conn.refreshRunState()
  }
}

async function onOpenModel() {
  const name = openModelName.value.trim()
  if (!name) return
  // 相对路径里的反斜杠转正斜杠，避免 URL 编码后服务器解析失败
  const r = await conn.openModel(name.replace(/\\/g, '/'))
  if (r.ok) {
    openMsg.value = r.msg
    setTimeout(() => (openMsg.value = ''), 6000)
  } else {
    alert('打开模型失败：' + r.msg)
  }
}
</script>

<template>
  <div class="toolbar">
    <!-- 品牌区 -->
    <div class="brand">
      <Icon name="logo" :size="18" class="brand-logo" />
      <span class="brand-name">FlexSim 远程建模工具箱</span>
    </div>

    <!-- 连接状态 -->
    <div class="status-pill" :class="{ ok: conn.connected }">
      <span class="dot" :class="conn.connected ? 'ok' : 'err'"></span>
      <span>{{ statusText }}</span>
    </div>

    <!-- 连接地址 + 测试 -->
    <div class="left">
      <div class="input-wrap">
        <Icon name="link" :size="14" class="input-icon" />
        <input
          class="base-input"
          v-model="conn.base"
          placeholder="WebServer 地址"
          spellcheck="false"
        />
      </div>
      <button class="primary" @click="onTest" :disabled="conn.loading">
        <Icon name="link" :size="14" /> 连接测试
      </button>
    </div>

    <!-- 实例 + 打开模型 -->
    <div class="mid">
      <select
        class="instance-select"
        :disabled="!conn.connected"
        @change="onSelectInstance"
      >
        <option v-if="!conn.connected" value="-1">（请先连接）</option>
        <option
          v-for="(inst, i) in conn.instances"
          :key="inst.modelName + inst.instanceNum"
          :value="i"
          :selected="inst.modelName === conn.modelName && inst.instanceNum === conn.instanceNum"
        >
          {{ inst.modelName }} #{{ inst.instanceNum }}
        </option>
      </select>
      <div class="input-wrap model-open">
        <input
          v-model="openModelName"
          list="model-list"
          :disabled="!conn.connected || conn.opening"
          placeholder="＋ 打开模型 / 路径…"
          spellcheck="false"
          title="可输入模型名或相对路径（如 子目录\\模型）"
        />
        <datalist id="model-list">
          <option v-for="m in conn.models" :key="m" :value="m">
            {{ m }} → {{ conn.modelFilePath(m) }}
          </option>
        </datalist>
        <button
          class="mini"
          @click="onOpenModel"
          :disabled="!conn.connected || !openModelName.trim() || conn.opening"
        >
          {{ conn.opening ? '启动中…' : '打开' }}
        </button>
      </div>
      <span v-if="openMsg" class="open-msg">{{ openMsg }}</span>
    </div>

    <!-- 右侧：只读 / 主题 / 模式切换 -->
    <div class="right">
      <button
        class="ro-toggle"
        :class="{ active: settings.readOnly }"
        @click="settings.readOnly = !settings.readOnly"
        :title="settings.readOnly ? '只读模式：已开启，写操作被禁用' : '只读模式：已关闭'"
      >
        <Icon :name="settings.readOnly ? 'lock' : 'edit'" :size="14" />
        {{ settings.readOnly ? '只读' : '可写' }}
      </button>
      <button @click="settings.toggleTheme()" title="切换深色 / 浅色主题">
        <Icon :name="settings.theme === 'dark' ? 'moon' : 'sun'" :size="14" />
      </button>
      <button @click="ui.openSettings()" title="设置（连接 / AI 模型 / 常规）">
        <Icon name="settings" :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  min-height: 52px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border-bottom: 1px solid var(--glass-border);
  flex-wrap: wrap;
  position: relative;
}
.toolbar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
  background-size: 200% 100%;
  animation: shimmer 4s linear infinite;
  opacity: 0.85;
  pointer-events: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 4px;
}
.brand-logo {
  color: var(--accent);
  filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.55));
  animation: floatY 4s ease-in-out infinite;
}
.brand-name {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.3px;
  white-space: nowrap;
  background: var(--accent-grad);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border-radius: var(--r-pill);
  font-size: 12px;
  white-space: nowrap;
  color: var(--text-dim);
  background: var(--surface-3);
  border: 1px solid var(--border);
}
.status-pill.ok {
  color: var(--success);
  background: var(--success-soft);
  border-color: rgba(52, 211, 153, 0.4);
}
.status-pill.ok .dot {
  animation: pulseRing 2s ease-out infinite;
}
.left,
.mid,
.right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mid {
  flex: 1;
  min-width: 300px;
}
.base-input {
  width: 200px;
}
.instance-select {
  max-width: 180px;
}
.model-open {
  gap: 4px;
}
.model-open input {
  width: 150px;
  font-size: 12px;
}
.open-msg {
  font-size: 11px;
  color: var(--success);
  white-space: nowrap;
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
.input-wrap input {
  padding-left: 30px;
  width: 100%;
}
.ro-toggle.active {
  border-color: var(--warn);
  color: var(--warn);
  background: var(--warn-soft);
}
.ai-btn {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
  position: relative;
  overflow: hidden;
}
.ai-btn:hover:not(:disabled) {
  background: var(--accent-soft);
  box-shadow: var(--glow);
}
</style>

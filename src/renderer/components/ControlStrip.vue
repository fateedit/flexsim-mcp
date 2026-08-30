<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Icon from './Icon.vue'
import * as ws from '@/api/webserver'
import { useConnection } from '@/stores/connection'
import { useSettings } from '@/stores/settings'

const conn = useConnection()
const settings = useSettings()

const runSpeed = ref(1)
const stopSeconds = ref(39600)
const runtime = ref('')
const msg = ref('')
const msgType = ref<'ok' | 'err' | ''>('')
let timer: ReturnType<typeof setInterval> | null = null

function setMessage(text: string, type: 'ok' | 'err') {
  msg.value = text
  msgType.value = type
  setTimeout(() => {
    if (msg.value === text) {
      msg.value = ''
      msgType.value = ''
    }
  }, 4000)
}

/** 解析 getruntime 原始串：可读时间 + 当前/停止秒数 */
const runtimeInfo = computed(() => {
  const raw = runtime.value
  if (!raw) return { head: '', cur: null, stop: null }
  const m = raw.match(/\[([\d.]+)\]\s*to\s*\[([\d.]+)\]/i)
  const head = raw.split('[')[0].trim()
  return {
    head,
    cur: m ? Number(m[1]) : null,
    stop: m ? Number(m[2]) : null
  }
})

const stateText = computed(() =>
  conn.runState === '1' ? '运行中' : conn.runState === '0' ? '已停止' : '未知'
)

function fmtSec(s: number | null): string {
  if (s === null) return '-'
  if (s < 60) return `${s.toFixed(0)}s`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m${Math.floor(s % 60).toString().padStart(2, '0')}s`
}

async function refresh() {
  if (!conn.connected) return
  try {
    conn.refreshRunState()
    runtime.value = await ws.getRunTime(conn.cfg())
  } catch {
    /* 忽略瞬时失败 */
  }
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 3000)
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

async function control(action: 'run' | 'stop' | 'reset') {
  if (settings.readOnly) return setMessage('只读模式：控制按钮已禁用', 'err')
  let res
  if (action === 'run') res = await ws.runModel(conn.cfg())
  else if (action === 'stop') res = await ws.stopModel(conn.cfg())
  else res = await ws.resetModel(conn.cfg())
  if (res.ok) {
    setMessage(`已发送 ${action} 指令`, 'ok')
    await refresh()
  } else {
    setMessage(`${action} 失败（HTTP ${res.status}）`, 'err')
  }
}

async function applySpeed() {
  if (settings.readOnly) return setMessage('只读模式：禁止写操作', 'err')
  const v = Number(runSpeed.value)
  if (!Number.isFinite(v) || v < 0) return setMessage('速度需为非负数字', 'err')
  const res = await ws.setRunSpeed(conn.cfg(), v)
  setMessage(res.ok ? `已设置运行速度 ${v}` : `失败（HTTP ${res.status}）`, res.ok ? 'ok' : 'err')
}

async function applyStopTime() {
  if (settings.readOnly) return setMessage('只读模式：禁止写操作', 'err')
  const v = Number(stopSeconds.value)
  if (!Number.isFinite(v) || v <= 0) return setMessage('停止时间需为正数（秒）', 'err')
  const res = await ws.setStopTime(conn.cfg(), v)
  setMessage(res.ok ? `已设置停止时间 ${v}s（需 reset 生效）` : `失败（HTTP ${res.status}）`, res.ok ? 'ok' : 'err')
}
</script>

<template>
  <div class="strip">
    <!-- 状态 -->
    <div class="state" :title="runtime">
      <span class="dot" :class="conn.runState === '1' ? 'run' : 'stop'"></span>
      <span class="state-text" :class="{ running: conn.runState === '1' }">{{ stateText }}</span>
      <span v-if="runtimeInfo.head" class="runtime muted">
        {{ runtimeInfo.head }}
        <template v-if="runtimeInfo.cur !== null">
          · {{ fmtSec(runtimeInfo.cur) }}/{{ fmtSec(runtimeInfo.stop) }}
        </template>
      </span>
    </div>

    <!-- 控制按钮 -->
    <div class="controls">
      <button class="primary" :disabled="settings.readOnly || !conn.connected" @click="control('run')">
        <Icon name="play" :size="13" /> 运行
      </button>
      <button :disabled="settings.readOnly || !conn.connected" @click="control('stop')">
        <Icon name="pause" :size="13" /> 停止
      </button>
      <button :disabled="settings.readOnly || !conn.connected" @click="control('reset')">
        <Icon name="reset" :size="13" /> 重置
      </button>
    </div>

    <!-- 速度：滑块 + 手动输入 -->
    <div class="speed">
      <Icon name="gauge" :size="13" class="label-icon" />
      <span class="group-label muted">速度</span>
      <input
        type="range"
        min="0"
        max="50"
        step="1"
        v-model.number="runSpeed"
        :disabled="settings.readOnly || !conn.connected"
        class="slider"
        title="拖动调速"
      />
      <input
        type="number"
        v-model.number="runSpeed"
        min="0"
        step="0.5"
        :disabled="settings.readOnly || !conn.connected"
        class="num-input"
        title="手动输入速度"
      />
      <button class="mini" :disabled="settings.readOnly || !conn.connected" @click="applySpeed">
        <Icon name="check" :size="12" />
      </button>
    </div>

    <!-- 停止时间：手动输入 -->
    <div class="stoptime">
      <Icon name="clock" :size="13" class="label-icon" />
      <span class="group-label muted">停止(s)</span>
      <input
        type="number"
        v-model.number="stopSeconds"
        min="1"
        step="60"
        :disabled="settings.readOnly || !conn.connected"
        class="num-input"
        title="停止时间（秒），需 reset 生效"
      />
      <button class="mini" :disabled="settings.readOnly || !conn.connected" @click="applyStopTime">
        <Icon name="check" :size="12" />
      </button>
    </div>

    <div v-if="msg" class="strip-msg" :class="msgType">{{ msg }}</div>
  </div>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 7px 16px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
  min-height: 38px;
}
.state {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  white-space: nowrap;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}
.dot.run {
  background: var(--success);
  animation: pulseRing 2s ease-out infinite;
}
.dot.stop {
  background: var(--text-faint);
}
.state-text {
  font-weight: 600;
  color: var(--text-dim);
}
.state-text.running {
  color: var(--success);
}
.runtime {
  font-size: 11px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.speed,
.stoptime {
  display: flex;
  align-items: center;
  gap: 6px;
}
.speed {
  flex: 1;
  min-width: 220px;
}
.speed .slider {
  flex: 1;
  min-width: 70px;
}
.group-label {
  font-size: 11px;
  white-space: nowrap;
}
.label-icon {
  color: var(--text-faint);
}
.slider {
  -webkit-appearance: none;
  appearance: none;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  outline: none;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.num-input {
  width: 64px;
  padding: 3px 6px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  text-align: right;
}
.strip-msg {
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: var(--r-pill);
}
.strip-msg.ok {
  color: var(--success);
  background: var(--success-soft);
}
.strip-msg.err {
  color: var(--danger);
  background: rgba(248, 113, 113, 0.12);
}
</style>

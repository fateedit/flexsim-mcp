<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'
import * as ws from '@/api/webserver'
import { useConnection } from '@/stores/connection'
import { useSettings } from '@/stores/settings'

const conn = useConnection()
const settings = useSettings()

const shift = ref<'day' | 'night'>('day')
const date = ref(new Date().toISOString().slice(0, 10)) // YYYY-MM-DD
const stopTime = ref(39600)
const runSpeed = ref(1)
const msg = ref('')
const msgType = ref<'ok' | 'err' | ''>('')

const SHIFT_TIME: Record<'day' | 'night', string> = {
  day: '08:30:00',
  night: '19:30:00'
}

function setMessage(text: string, type: 'ok' | 'err') {
  msg.value = text
  msgType.value = type
}

// 切换班次时同步停止时间建议值
function onShiftChange() {
  stopTime.value = shift.value === 'day' ? 39600 : 46800
}

async function applyDateTime() {
  if (settings.readOnly) return setMessage('只读模式：禁止写操作', 'err')
  const dt = `${date.value} ${SHIFT_TIME[shift.value]}`
  const res = await ws.setDateTime(conn.cfg(), dt)
  if (res.ok) {
    setMessage(`已设置模型时间 ${dt}（提示：通常需 reset 后才在模型界面生效）`, 'ok')
    conn.refreshRunState()
  } else {
    setMessage(`设置失败（HTTP ${res.status}）`, 'err')
  }
}

async function applyStopTime() {
  if (settings.readOnly) return setMessage('只读模式：禁止写操作', 'err')
  const res = await ws.setStopTime(conn.cfg(), Number(stopTime.value))
  setMessage(res.ok ? `已设置停止时间 ${stopTime.value}s` : `失败（HTTP ${res.status}）`, res.ok ? 'ok' : 'err')
}

async function applyRunSpeed() {
  if (settings.readOnly) return setMessage('只读模式：禁止写操作', 'err')
  const res = await ws.setRunSpeed(conn.cfg(), Number(runSpeed.value))
  setMessage(res.ok ? `已设置运行速度 ${runSpeed.value}` : `失败（HTTP ${res.status}）`, res.ok ? 'ok' : 'err')
}

async function control(action: 'run' | 'stop' | 'reset') {
  if (settings.readOnly) {
    // 只读模式禁用一切控制（run/stop/reset 均视为写操作）
    return setMessage('只读模式：控制按钮已禁用', 'err')
  }
  let res
  if (action === 'run') res = await ws.runModel(conn.cfg())
  else if (action === 'stop') res = await ws.stopModel(conn.cfg())
  else res = await ws.resetModel(conn.cfg())
  if (res.ok) {
    setMessage(`已发送 ${action} 指令`, 'ok')
    conn.refreshRunState()
  } else {
    setMessage(`${action} 失败（HTTP ${res.status}）`, 'err')
  }
}
</script>

<template>
  <div class="quick">
    <div class="section-title">快捷设置</div>

    <div class="grid">
      <!-- 模型时间 -->
      <div class="card">
        <div class="card-head"><Icon name="clock" :size="14" /> 模型时间</div>
        <div class="row">
          <input type="date" v-model="date" :disabled="settings.readOnly" />
          <select v-model="shift" @change="onShiftChange" :disabled="settings.readOnly">
            <option value="day">白班 08:30</option>
            <option value="night">夜班 19:30</option>
          </select>
          <button class="primary" @click="applyDateTime" :disabled="settings.readOnly">
            <Icon name="check" :size="13" /> 设置
          </button>
        </div>
        <div class="hint muted">写入 startTime/dateTime 节点（YYYY-MM-DD HH:MM:SS）</div>
      </div>

      <!-- 停止时间 -->
      <div class="card">
        <div class="card-head"><Icon name="clock" :size="14" /> 停止时间（秒）</div>
        <div class="row">
          <input type="number" v-model="stopTime" :disabled="settings.readOnly" />
          <button class="primary" @click="applyStopTime" :disabled="settings.readOnly">
            <Icon name="check" :size="13" /> 设置
          </button>
        </div>
        <div class="hint muted">白班建议 39600、夜班 46800</div>
      </div>

      <!-- 运行速度 -->
      <div class="card">
        <div class="card-head"><Icon name="gauge" :size="14" /> 运行速度：{{ runSpeed }}</div>
        <div class="row">
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            v-model.number="runSpeed"
            :disabled="settings.readOnly"
            class="slider"
          />
          <button class="primary" @click="applyRunSpeed" :disabled="settings.readOnly">
            <Icon name="check" :size="13" /> 设置
          </button>
        </div>
      </div>

      <!-- 控制按钮 -->
      <div class="card">
        <div class="card-head"><Icon name="bolt" :size="14" /> 仿真控制</div>
        <div class="row controls">
          <button class="primary" @click="control('run')" :disabled="settings.readOnly">
            <Icon name="play" :size="13" /> 运行
          </button>
          <button @click="control('stop')" :disabled="settings.readOnly">
            <Icon name="pause" :size="13" /> 停止
          </button>
          <button @click="control('reset')" :disabled="settings.readOnly">
            <Icon name="reset" :size="13" /> 重置
          </button>
        </div>
        <div class="hint muted">运行状态：{{ conn.runState === '1' ? '运行中' : conn.runState === '0' ? '已停止' : '未知' }}</div>
      </div>
    </div>

    <div v-if="msg" class="status-bar" :class="msgType === 'ok' ? 'ok' : 'err'">
      {{ msg }}
    </div>
  </div>
</template>

<style scoped>
.quick {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 14px 16px;
  box-shadow: var(--shadow-sm);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 12px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text);
}
.card-head :deep(.icon-wrap) {
  color: var(--accent);
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.controls {
  gap: 8px;
}
.row input[type='date'],
.row input[type='number'],
.row select {
  flex: 1;
  min-width: 0;
}
.hint {
  font-size: 11px;
  margin-top: 8px;
  color: var(--text-dim);
}
.slider {
  flex: 1;
  min-width: 0;
  -webkit-appearance: none;
  appearance: none;
  height: 6px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  outline: none;
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 0 4px var(--accent-soft);
  transition: box-shadow var(--t);
}
.slider::-webkit-slider-thumb:hover {
  box-shadow: 0 0 0 7px var(--accent-soft);
}
.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 0 4px var(--accent-soft);
}
.slider:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

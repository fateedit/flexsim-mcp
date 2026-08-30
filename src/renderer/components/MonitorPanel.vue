<script setup lang="ts">
import Icon from './Icon.vue'
import { useMonitor } from '@/stores/monitor'
import { useSettings } from '@/stores/settings'

const monitor = useMonitor()
const settings = useSettings()
</script>

<template>
  <div class="monitor">
    <div class="head">
      <div class="panel-title">
        <Icon name="monitor" :size="15" /> 值监控
      </div>
      <div class="head-actions">
        <span class="muted">间隔 {{ settings.monitorInterval / 1000 }}s</span>
        <button class="primary" @click="monitor.toggle()" :disabled="!monitor.items.length">
          <Icon :name="monitor.running ? 'pause' : 'play'" :size="13" />
          {{ monitor.running ? '停止' : '开始' }}
        </button>
      </div>
    </div>

    <div class="body">
      <div v-if="!monitor.items.length" class="empty muted">
        <Icon name="monitor" :size="22" />
        <span>暂无监控节点 —— 在属性面板点击「加入监控」</span>
      </div>
      <table v-else class="mon-table">
        <thead>
          <tr>
            <th>节点路径</th>
            <th>当前值</th>
            <th>上次</th>
            <th>时间</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in monitor.items" :key="it.path" :class="{ changed: it.changed }">
            <td class="path" :title="it.path">{{ it.path }}</td>
            <td class="val">{{ it.value }}</td>
            <td class="prev">{{ it.prev }}</td>
            <td class="time">{{ it.time }}</td>
            <td>
              <button class="mini ghost danger" @click="monitor.remove(it.path)" title="移除">
                <Icon name="trash" :size="13" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.monitor {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 10px 14px;
  border-right: 1px solid var(--border);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
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
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.body {
  flex: 1;
  overflow: auto;
  margin-top: 8px;
}
.empty {
  padding: 24px 12px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
}
.empty :deep(.icon-wrap) {
  color: var(--text-faint);
  animation: floatY 4s ease-in-out infinite;
}
.mon-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.mon-table th,
.mon-table td {
  text-align: left;
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
}
.mon-table th {
  color: var(--text-dim);
  font-weight: 500;
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}
.mon-table tbody tr {
  transition: background var(--t);
}
.mon-table tbody tr:hover {
  background: var(--surface-2);
}
.path {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--accent);
}
.val {
  font-family: var(--font-mono);
}
.changed {
  animation: flash 1s ease;
}
.changed .val {
  color: var(--mismatch);
  font-weight: 700;
}
.prev {
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.time {
  color: var(--text-dim);
  white-space: nowrap;
  font-family: var(--font-mono);
}
.mini {
  padding: 3px 8px;
  font-size: 11px;
}
@keyframes flash {
  0% {
    background: var(--mismatch-soft);
  }
  100% {
    background: transparent;
  }
}
</style>

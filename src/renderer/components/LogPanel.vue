<script setup lang="ts">
import Icon from './Icon.vue'
import { useLogs } from '@/stores/logs'

const logs = useLogs()

function copyUrl(url: string) {
  navigator.clipboard?.writeText(url).catch(() => {})
}
</script>

<template>
  <div class="log">
    <div class="head">
      <div class="panel-title">
        <Icon name="list" :size="15" /> 请求日志 / 历史
      </div>
      <button class="mini ghost" @click="logs.clear()">
        <Icon name="trash" :size="13" /> 清空
      </button>
    </div>

    <div class="body">
      <div v-if="!logs.entries.length" class="empty muted">
        <Icon name="list" :size="22" />
        <span>暂无请求记录</span>
      </div>
      <table v-else class="log-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>状态</th>
            <th>耗时</th>
            <th>URL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in logs.entries" :key="e.id">
            <td class="time">{{ e.time }}</td>
            <td>
              <span class="badge" :class="e.ok ? 'ok' : 'err'">
                {{ e.status || 'ERR' }}
              </span>
            </td>
            <td class="dur">{{ e.durationMs }}ms</td>
            <td class="url" :title="e.url">{{ e.url }}</td>
            <td>
              <button class="mini ghost" @click="copyUrl(e.url)" title="复制 URL">
                <Icon name="copy" :size="13" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.log {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 10px 14px;
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
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
}
.log-table th,
.log-table td {
  text-align: left;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.log-table th {
  color: var(--text-dim);
  font-weight: 500;
  position: sticky;
  top: 0;
  background: var(--surface);
  z-index: 1;
}
.log-table tbody tr {
  transition: background var(--t);
}
.log-table tbody tr:hover {
  background: var(--surface-2);
}
.time {
  white-space: nowrap;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.dur {
  white-space: nowrap;
  color: var(--text-dim);
  font-family: var(--font-mono);
}
.url {
  font-family: var(--font-mono);
  word-break: break-all;
  color: var(--text-dim);
  max-width: 360px;
}
.mini {
  padding: 3px 8px;
  font-size: 11px;
}
</style>

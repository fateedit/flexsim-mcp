<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Toolbar from './components/Toolbar.vue'
import AiPanel from './components/AiPanel.vue'
import FeatureCatalog from './components/FeatureCatalog.vue'
import ControlStrip from './components/ControlStrip.vue'
import RightPanel from './components/RightPanel.vue'
import MonitorPanel from './components/MonitorPanel.vue'
import LogPanel from './components/LogPanel.vue'
import SettingsModal from './components/SettingsModal.vue'
import ScreenshotModal from './components/ScreenshotModal.vue'
import { useSettings } from './stores/settings'
import { useConnection } from './stores/connection'
import { useTree } from './stores/tree'

const settings = useSettings()
const connection = useConnection()
const tree = useTree()

// 主题应用到 <html data-theme>
watch(
  () => settings.theme,
  (t) => document.documentElement.setAttribute('data-theme', t),
  { immediate: true }
)

// 连接成功后自动加载模型树与运行状态
watch(
  () => connection.connected,
  (ok) => {
    if (ok) {
      tree.loadRoot()
      connection.refreshRunState()
    }
  }
)

// 兜底：modelName 就绪但树还没加载时补加载（避免竞态导致树停在错误上）
watch(
  () => connection.modelName,
  (name) => {
    if (connection.connected && name && tree.root.length === 0) {
      tree.loadRoot()
    }
  }
)

// ── 布局：响应式列宽（随窗口缩放），功能目录可折叠，右栏可拖拽，底部可收起 ──
const logOpen = ref(true)
const catWidth = ref(240)
const rightWidth = ref(360)
function updateLayout() {
  const w = window.innerWidth
  if (w >= 1600) {
    catWidth.value = 260
    rightWidth.value = 380
  } else if (w >= 1280) {
    catWidth.value = 240
    rightWidth.value = 340
  } else if (w >= 1080) {
    catWidth.value = 210
    rightWidth.value = 300
  } else {
    catWidth.value = 190
    rightWidth.value = 270
  }
}
const mainCols = computed(() => `${catWidth.value}px 6px 1fr ${rightWidth.value}px`)
const appRows = computed(() => (logOpen.value ? 'auto 1fr 220px' : 'auto 1fr'))

let dragging = false
function startResize() {
  dragging = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}
function onResize(e: MouseEvent) {
  if (!dragging) return
  const w = window.innerWidth
  rightWidth.value = Math.min(560, Math.max(260, w - e.clientX))
}
function stopResize() {
  dragging = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
}
onUnmounted(stopResize)
onUnmounted(() => window.removeEventListener('resize', updateLayout))
onUnmounted(() => connection.stopAutoRefresh())

onMounted(() => {
  document.documentElement.setAttribute('data-theme', settings.theme)
  updateLayout()
  window.addEventListener('resize', updateLayout)
  // 启动即自动连接 + 轮询实例列表（下拉框始终可用）
  connection.startAutoRefresh()
  if (!connection.connected) connection.test()
})
</script>

<template>
  <div class="app" :style="{ gridTemplateRows: appRows }">
    <Toolbar />

    <!-- 主区：功能目录 | AI 助手 | 模型树/编辑/属性 -->
    <div class="main-row" :style="{ gridTemplateColumns: mainCols }">
      <div class="col cat-col">
        <FeatureCatalog />
      </div>
      <div class="resizer" @mousedown="startResize" title="拖拽调整右栏宽度"></div>
      <div class="col center-col">
        <ControlStrip />
        <AiPanel />
      </div>
      <div class="col right-col">
        <RightPanel />
      </div>
    </div>

    <!-- 底部：监控 + 日志（可收起） -->
    <div v-if="logOpen" class="bottom-row">
      <MonitorPanel class="bottom-cell" />
      <LogPanel class="bottom-cell" />
      <button class="collapse-btn mini ghost" @click="logOpen = false" title="收起底部面板">
        收起 ▾
      </button>
    </div>
    <button
      v-else
      class="open-log-btn mini ghost"
      @click="logOpen = true"
      title="展开底部面板"
    >
      ▲ 日志/监控
    </button>

    <ScreenshotModal />
    <SettingsModal />
  </div>
</template>

<style scoped>
.app {
  display: grid;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}
.main-row {
  display: grid;
  min-height: 0;
  border-top: 1px solid var(--glass-border);
}
.col {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.cat-col {
  background: var(--glass);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  animation: fadeUp 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
.center-col {
  display: flex;
  flex-direction: column;
  background: var(--glass);
  -webkit-backdrop-filter: blur(calc(var(--glass-blur) * 0.6)) saturate(130%);
  backdrop-filter: blur(calc(var(--glass-blur) * 0.6)) saturate(130%);
  animation: fadeUp 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) 0.08s both;
}
.right-col {
  animation: fadeUp 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) 0.16s both;
}
.resizer {
  position: relative;
  background: transparent;
  cursor: col-resize;
}
.resizer::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--border);
  transition: background var(--t), width var(--t), box-shadow var(--t);
}
.resizer:hover::before,
.resizer:active::before {
  background: var(--accent);
  width: 2px;
  box-shadow: 0 0 8px var(--accent);
}
.bottom-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 0;
  border-top: 1px solid var(--glass-border);
  background: var(--glass);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  position: relative;
}
.bottom-cell {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.collapse-btn {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 5;
  opacity: 0.6;
}
.collapse-btn:hover {
  opacity: 1;
}
.open-log-btn {
  position: fixed;
  bottom: 8px;
  right: 12px;
  z-index: 30;
}
</style>

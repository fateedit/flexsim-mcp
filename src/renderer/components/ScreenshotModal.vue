<script setup lang="ts">
import Icon from './Icon.vue'
import { useUi } from '@/stores/ui'

const ui = useUi()
</script>

<template>
  <div v-if="ui.screenshotOpen" class="screenshot-modal" @click.self="ui.closeScreenshot()">
    <div class="modal-box">
      <div class="modal-head">
        <div class="modal-title">
          <Icon name="camera" :size="15" /> 模型截图
        </div>
        <button class="mini ghost" @click="ui.closeScreenshot()">
          <Icon name="x" :size="14" />
        </button>
      </div>
      <div class="modal-body">
        <img v-if="ui.screenshotUrl" :src="ui.screenshotUrl" alt="FlexSim 截图" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.screenshot-modal {
  position: fixed;
  inset: 0;
  background: rgba(8, 15, 28, 0.55);
  backdrop-filter: blur(3px);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}
.modal-box {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  animation: popIn 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  font-size: 13.5px;
}
.modal-title :deep(.icon-wrap) {
  color: var(--accent);
}
.modal-body {
  padding: 12px;
  overflow: auto;
}
.modal-body img {
  max-width: 80vw;
  max-height: 75vh;
  display: block;
  border-radius: var(--r-sm);
}
.mini {
  padding: 3px 8px;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes popIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>

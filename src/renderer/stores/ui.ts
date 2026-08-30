import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 纯 UI 状态：视图模式（AI 助手为主 / 高级工具）、截图弹窗。
 */
export const useUi = defineStore('ui', () => {
  const aiOpen = ref(false)
  const screenshotUrl = ref('')
  const screenshotOpen = ref(false)
  /** 设置弹窗 */
  const settingsOpen = ref(false)
  /** 主界面模式：assistant = AI 助手为主；advanced = 三栏手动工具 */
  const viewMode = ref<'assistant' | 'advanced'>('assistant')

  function toggleAi() {
    aiOpen.value = !aiOpen.value
  }

  function setViewMode(m: 'assistant' | 'advanced') {
    viewMode.value = m
  }

  function openSettings() {
    settingsOpen.value = true
  }

  function closeSettings() {
    settingsOpen.value = false
  }

  function openScreenshot(url: string) {
    screenshotUrl.value = url
    screenshotOpen.value = true
  }

  function closeScreenshot() {
    screenshotOpen.value = false
    screenshotUrl.value = ''
  }

  return {
    aiOpen,
    screenshotUrl,
    screenshotOpen,
    settingsOpen,
    viewMode,
    toggleAi,
    setViewMode,
    openSettings,
    closeSettings,
    openScreenshot,
    closeScreenshot
  }
})

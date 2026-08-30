import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'fsw-settings'

interface Persisted {
  theme: Theme
  readOnly: boolean
  timeout: number
  monitorInterval: number
  treeWidth: number
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  aiAutoExecute: boolean
  /** 平台模型目录：用户自己的模型库/归档目录（与 WebServer 模型目录做路径对齐） */
  platformModelDir: string
  /** WebServer 安装目录（分发到新机器时用户配置） */
  wsInstallDir: string
  /** WebServer 配置文件路径（由安装目录探测得到） */
  wsConfigPath: string
}

/**
 * 全局设置：主题、只读模式、请求超时、监控轮询间隔、左侧树宽度、LLM 配置。
 * 全部通过 localStorage 持久化（无需额外后端）。
 */
export const useSettings = defineStore('settings', () => {
  const theme = ref<Theme>('dark')
  const readOnly = ref(false)
  const timeout = ref(5000)
  const monitorInterval = ref(2000)
  const treeWidth = ref(280)
  const llmBaseUrl = ref('https://api.deepseek.com')
  const llmApiKey = ref('')
  const llmModel = ref('deepseek-chat')
  /** AI 工具调用是否自动执行；false = 每次工具调用前需用户确认 */
  const aiAutoExecute = ref(false)
  const platformModelDir = ref('')
  const wsInstallDir = ref('')
  const wsConfigPath = ref('')

  // 启动时从 localStorage 恢复
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>
      if (p.theme) theme.value = p.theme
      if (typeof p.readOnly === 'boolean') readOnly.value = p.readOnly
      if (typeof p.timeout === 'number') timeout.value = p.timeout
      if (typeof p.monitorInterval === 'number') monitorInterval.value = p.monitorInterval
      if (typeof p.treeWidth === 'number') treeWidth.value = p.treeWidth
      if (p.llmBaseUrl) llmBaseUrl.value = p.llmBaseUrl
      if (typeof p.llmApiKey === 'string') llmApiKey.value = p.llmApiKey
      if (p.llmModel) llmModel.value = p.llmModel
      if (typeof p.aiAutoExecute === 'boolean') aiAutoExecute.value = p.aiAutoExecute
      if (p.platformModelDir) platformModelDir.value = p.platformModelDir
      if (p.wsInstallDir) wsInstallDir.value = p.wsInstallDir
      if (p.wsConfigPath) wsConfigPath.value = p.wsConfigPath
    }
  } catch {
    /* 忽略损坏的本地配置 */
  }

  watch(
    [
      theme, readOnly, timeout, monitorInterval, treeWidth, llmBaseUrl, llmApiKey, llmModel,
      aiAutoExecute, platformModelDir, wsInstallDir, wsConfigPath
    ],
    () => {
      const data: Persisted = {
        theme: theme.value,
        readOnly: readOnly.value,
        timeout: timeout.value,
        monitorInterval: monitorInterval.value,
        treeWidth: treeWidth.value,
        llmBaseUrl: llmBaseUrl.value,
        llmApiKey: llmApiKey.value,
        llmModel: llmModel.value,
        aiAutoExecute: aiAutoExecute.value,
        platformModelDir: platformModelDir.value,
        wsInstallDir: wsInstallDir.value,
        wsConfigPath: wsConfigPath.value
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    },
    { deep: true }
  )

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  return {
    theme,
    readOnly,
    timeout,
    monitorInterval,
    treeWidth,
    llmBaseUrl,
    llmApiKey,
    llmModel,
    aiAutoExecute,
    platformModelDir,
    wsInstallDir,
    wsConfigPath,
    toggleTheme
  }
})

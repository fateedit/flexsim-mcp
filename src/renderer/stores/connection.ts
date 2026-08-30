import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import * as ws from '@/api/webserver'
import type { FlexInstance, WsCommandConfig } from '@/types'
import type { ServerConfig } from '@/api/webserver'

const BASE_KEY = 'fsw-base'
const POLL_INTERVAL = 5000

/**
 * 连接与实例管理：WebServer 地址、实例列表、当前选中实例、连接状态、运行状态。
 * - 启动后自动连接（startAutoRefresh 在 App 挂载时调用）
 * - 每 5 秒静默轮询 instancelist，模型在 FlexSim 里开/关会自动反映到下拉框
 * - 提供「打开模型」能力（createinstance），手动线也能启动未在跑的模型
 * - 加载服务端配置（模型目录等）与模型文件列表
 */
export const useConnection = defineStore('connection', () => {
  const base = ref('http://localhost/webserver.dll')
  const instances = ref<FlexInstance[]>([])
  const models = ref<string[]>([])
  const modelName = ref('')
  const instanceNum = ref(1)
  const connected = ref(false)
  const runState = ref('')
  const loading = ref(false)
  const opening = ref(false)
  const serverConfig = ref<ServerConfig | null>(null)
  const modelFiles = ref<string[]>([])
  let pollTimer: ReturnType<typeof setInterval> | null = null

  try {
    const saved = localStorage.getItem(BASE_KEY)
    if (saved) base.value = saved
  } catch {
    /* ignore */
  }
  watch(base, (v) => localStorage.setItem(BASE_KEY, v))

  /** 连接测试：成功则拉取实例/模型/服务器信息；全部就绪后才置 connected（避免树请求在 modelName 为空时发出） */
  async function test() {
    loading.value = true
    try {
      const ok = await ws.testConnection(base.value)
      if (ok) {
        await Promise.all([loadInstances(), loadModels(), loadServerInfo()])
      }
      connected.value = ok
    } finally {
      loading.value = false
    }
  }

  /** 拉取实例列表并默认选中第一个 */
  async function loadInstances() {
    instances.value = await ws.getInstances(base.value)
    if (instances.value.length > 0 && !modelName.value) {
      modelName.value = instances.value[0].modelName
      instanceNum.value = instances.value[0].instanceNum
    }
  }

  /** 拉取可运行模型名列表（供「打开模型」使用） */
  async function loadModels() {
    models.value = await ws.getModels(base.value)
  }

  /** 加载服务端配置（模型目录等）与模型文件列表 */
  async function loadServerInfo() {
    serverConfig.value = await ws.getServerConfig(base.value)
    modelFiles.value = await ws.getModelFiles(base.value)
  }

  /** 模型名 → 完整文件路径（如 C:\FlexSim\model\ai.fsm） */
  function modelFilePath(name: string): string {
    const dir = serverConfig.value?.modelDirectory
    return dir ? `${dir}\\${name}.fsm` : name
  }

  /** 打开（启动）一个模型实例；成功后刷新实例列表 */
  async function openModel(model: string): Promise<{ ok: boolean; msg: string }> {
    if (opening.value) return { ok: false, msg: '正在启动中…' }
    opening.value = true
    try {
      const r = await ws.createInstance(base.value, model)
      if (r.status === 'success') {
        await loadInstances()
        // 选中新启动的实例
        const inst = instances.value.find(
          (i) => i.modelName === model && i.instanceNum === (r.instancenum ?? 1)
        )
        if (inst) selectInstance(inst)
        return { ok: true, msg: `已启动 ${model}（实例号 ${r.instancenum ?? '?'}）` }
      }
      return { ok: false, msg: r.reason || `启动失败（${r.status}）` }
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : String(e) }
    } finally {
      opening.value = false
    }
  }

  function selectInstance(i: FlexInstance) {
    modelName.value = i.modelName
    instanceNum.value = i.instanceNum
  }

  /** 终止（关闭）一个实例；成功后刷新实例列表 */
  async function terminate(model: string, instance: number): Promise<{ ok: boolean; reason?: string }> {
    const r = await ws.terminateInstance(base.value, model, instance)
    if (r.ok) {
      await loadInstances()
      // 终止的是当前选中实例 → 切到第一个在线实例
      if (modelName.value === model && instanceNum.value === instance && instances.value.length > 0) {
        selectInstance(instances.value[0])
      }
    }
    return r
  }

  /** 当前实例的命令前缀配置，供所有 WebServer 写/读方法使用 */
  function cfg(): WsCommandConfig {
    return { base: base.value, modelName: modelName.value, instanceNum: instanceNum.value }
  }

  async function refreshRunState() {
    if (!connected.value) return
    runState.value = await ws.getRunState(cfg())
  }

  /**
   * 启动轮询：每 5 秒静默刷新实例列表与模型列表。
   * 只增不删：瞬时为空（WebServer 抖动）不清列表。
   * 当前选中实例消失（被关闭）时自动切到第一个在线实例，避免一直对着死实例发请求。
   */
  function startAutoRefresh() {
    if (pollTimer) return
    pollTimer = setInterval(async () => {
      if (!base.value) return
      const insts = await ws.getInstances(base.value)
      if (insts.length > 0) {
        const cur = { m: modelName.value, n: instanceNum.value }
        instances.value = insts
        if (!connected.value) {
          // 轮询发现实例在线但从未连接成功 → 补上连接状态并加载其余信息
          connected.value = true
          loadModels()
          loadServerInfo()
        }
        if (!cur.m) {
          // 尚未选择 → 自动选中第一个
          selectInstance(insts[0])
        } else if (!insts.some((i) => i.modelName === cur.m && i.instanceNum === cur.n)) {
          // 选中实例已消失 → 自动切到第一个在线实例
          selectInstance(insts[0])
        }
      }
      const ms = await ws.getModels(base.value)
      if (ms.length > 0) models.value = ms
      // 服务端配置/文件列表偶尔刷新（低频，已有值则跳过）
      if (!serverConfig.value) loadServerInfo()
    }, POLL_INTERVAL)
  }

  function stopAutoRefresh() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  return {
    base,
    instances,
    models,
    modelName,
    instanceNum,
    connected,
    runState,
    loading,
    opening,
    serverConfig,
    modelFiles,
    test,
    loadInstances,
    loadModels,
    loadServerInfo,
    openModel,
    terminate,
    selectInstance,
    cfg,
    refreshRunState,
    modelFilePath,
    startAutoRefresh,
    stopAutoRefresh
  }
})

import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as ws from '@/api/webserver'
import { useConnection } from './connection'
import { useSettings } from './settings'
import { formatValue, nowTime } from '@/utils/format'

export interface MonItem {
  path: string
  value: string
  prev: string
  changed: boolean
  time: string
}

const STORAGE_KEY = 'fsw-monitor'

/**
 * 值监控：把节点加入监控列表，按配置间隔轮询 getnodedata。
 * 监控的「节点路径列表」持久化到 localStorage；实时数值不持久化。
 */
export const useMonitor = defineStore('monitor', () => {
  const items = ref<MonItem[]>([])
  const running = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const paths = JSON.parse(raw) as string[]
      items.value = paths.map((p) => ({
        path: p,
        value: '-',
        prev: '-',
        changed: false,
        time: ''
      }))
    }
  } catch {
    /* ignore */
  }

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.value.map((i) => i.path))
    )
  }

  function add(path: string) {
    if (!items.value.find((i) => i.path === path)) {
      items.value.push({ path, value: '-', prev: '-', changed: false, time: '' })
      persist()
    }
  }

  function remove(path: string) {
    items.value = items.value.filter((i) => i.path !== path)
    persist()
  }

  /** 轮询一次：更新每个监控项的值并标记是否发生变化 */
  async function poll() {
    const conn = useConnection()
    if (!conn.connected) return
    for (const it of items.value) {
      try {
        const v = await ws.getNodeData(conn.cfg(), it.path)
        const s = formatValue(v)
        it.changed = it.value !== '-' && it.value !== s
        it.prev = it.value
        it.value = s
        it.time = nowTime()
      } catch {
        it.value = 'ERR'
        it.changed = false
      }
    }
  }

  function start() {
    if (running.value) return
    running.value = true
    poll()
    const iv = useSettings().monitorInterval
    timer = setInterval(poll, iv)
  }

  function stop() {
    running.value = false
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function toggle() {
    if (running.value) stop()
    else start()
  }

  return { items, running, add, remove, poll, start, stop, toggle }
})

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RequestLog } from '@/types'

/** 请求日志：记录每一次 WebServer 请求的 URL、耗时、状态，最多保留 500 条 */
export const useLogs = defineStore('logs', () => {
  const entries = ref<RequestLog[]>([])
  let seq = 0

  function add(e: Omit<RequestLog, 'id'>) {
    entries.value.unshift({ id: ++seq, ...e })
    if (entries.value.length > 500) entries.value.pop()
  }

  function clear() {
    entries.value = []
  }

  return { entries, add, clear }
})

/**
 * LLM 客户端：OpenAI 兼容 /chat/completions（经主进程转发）。
 * base_url / api_key / model 由用户在设置里配置（默认 DeepSeek）。
 */
import { useSettings } from '@/stores/settings'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ChatResponse {
  content?: string | null
  tool_calls?: ToolCall[]
}

/** 一次 /chat/completions 调用（含工具定义时自动启用 function calling） */
export async function chat(
  messages: ChatMessage[],
  tools?: unknown[]
): Promise<ChatResponse> {
  const s = useSettings()
  if (!s.llmApiKey.trim()) {
    throw new Error('未配置 LLM API Key（请在设置中填写，支持 DeepSeek/OpenAI/Ollama 等 OpenAI 兼容接口）')
  }
  const res = await window.api.llmChat({
    baseUrl: s.llmBaseUrl,
    apiKey: s.llmApiKey,
    model: s.llmModel,
    messages: messages as unknown[],
    tools,
    temperature: 0.2,
    maxTokens: 4096,
    timeout: 180000
  })
  if (!res.ok) {
    throw new Error(res.error || `LLM 请求失败（HTTP ${res.status}）`)
  }
  const choice = res.data?.choices?.[0]?.message
  if (!choice) throw new Error('LLM 返回为空')
  return {
    content: choice.content ?? null,
    tool_calls: (choice.tool_calls as ToolCall[] | undefined) ?? undefined
  }
}

// 渲染进程通过 preload 注入的 window.api 类型声明
export {}

declare global {
  interface Window {
    api: {
      request: (
        url: string,
        opts?: { timeout?: number; binary?: boolean }
      ) => Promise<{
        ok: boolean
        status: number
        text: string
        durationMs: number
        error?: boolean
        base64?: string
        contentType?: string
      }>
      llmChat: (opts: {
        baseUrl: string
        apiKey: string
        model: string
        messages: unknown[]
        tools?: unknown[]
        temperature?: number
        maxTokens?: number
        timeout?: number
      }) => Promise<{
        ok: boolean
        status: number
        text: string
        durationMs: number
        error?: string
        data?: { choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] } }> }
      }>
      openPath: (p: string) => Promise<{ ok: boolean; error?: string }>
      importModel: (destDir: string) => Promise<{
        ok: boolean
        canceled?: boolean
        already?: boolean
        file?: string
        dest?: string
        error?: string
      }>
      wsReadConfig: (live: { modelDirectory: string; port: string } | null) => Promise<{
        ok: boolean
        path?: string
        modelDir?: string
        port?: string
        matched?: boolean
        error?: string
      }>
      wsWriteConfig: (opts: { path: string; newModelDir: string }) => Promise<{
        ok: boolean
        needsAdmin?: boolean
        error?: string
      }>
      wsWriteConfigElevated: (opts: { path: string; newModelDir: string }) => Promise<{
        ok: boolean
        error?: string
      }>
      wsRestart: (cfgPath: string) => Promise<{ ok: boolean; msg?: string; error?: string }>
      selectDir: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
      syncModelsToWs: (opts: { srcDir: string; wsDir: string }) => Promise<{
        ok: boolean
        copied?: number
        skipped?: string[]
        msg?: string
        error?: string
      }>
      wsProbeDir: (dir: string) => Promise<{
        ok: boolean
        hasServer?: boolean
        configPath?: string
        modelDir?: string
        port?: string
        error?: string
      }>
      wsAutoDetect: () => Promise<string | null>
      mcpListTools: () => Promise<{
        ok: boolean
        tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>
        error?: string
      }>
      mcpCall: (name: string, args: Record<string, unknown>) => Promise<{
        ok: boolean
        text?: string
        error?: string
      }>
    }
  }
}

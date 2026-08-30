/**
 * Electron 预加载脚本（CommonJS）
 * ---------------------------------------------------------------
 * 通过 contextBridge 向渲染进程注入最小化的 `window.api`，
 * 渲染进程只能调用 request，无法直接访问 Node / Electron 内部能力。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  /**
   * 向主进程发起一次 WebServer 请求（GET，query string 已拼在 url 里）。
   * @param {string} url
   * @param {{timeout?:number, binary?:boolean}} [opts]
   */
  request: (url, opts) => ipcRenderer.invoke('web:request', url, opts || {}),
  /**
   * 调用 OpenAI 兼容 LLM 接口（主进程转发）。
   * @param {{baseUrl:string, apiKey:string, model:string, messages:any[], tools?:any[], temperature?:number, maxTokens?:number, timeout?:number}} opts
   */
  llmChat: (opts) => ipcRenderer.invoke('llm:chat', opts || {}),
  /**
   * 用系统文件管理器打开指定路径（文件夹）。
   * @param {string} p
   */
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  /**
   * 选择 .fsm/.fsx 并复制到模型目录（WebServer 扫描即变可打开模型）。
   * @param {string} destDir 模型目录（来自服务端 configuration）
   */
  importModel: (destDir) => ipcRenderer.invoke('model:import', destDir),
  /**
   * 读取生效中的 WebServer 配置文件（按 configuration 接口的 live 值匹配）。
   * @param {{modelDirectory:string, port:string}|null} live
   */
  wsReadConfig: (live) => ipcRenderer.invoke('server:readConfig', live),
  /**
   * 写 WebServer 配置（改 Model Directory 行，自动备份 .bak）。
   * @param {{path:string, newModelDir:string}} opts
   */
  wsWriteConfig: (opts) => ipcRenderer.invoke('server:writeConfig', opts),
  /**
   * 提权（UAC）写 WebServer 配置。
   * @param {{path:string, newModelDir:string}} opts
   */
  wsWriteConfigElevated: (opts) => ipcRenderer.invoke('server:writeConfigElevated', opts),
  /**
   * 重启 WebServer：终止 :80 进程并以管理员身份重启 node index.js。
   * @param {string} cfgPath 配置文件路径（其上级的 webserver 目录即服务目录）
   */
  wsRestart: (cfgPath) => ipcRenderer.invoke('server:restart', cfgPath),
  /**
   * 选择文件夹（平台模型目录等）。
   */
  selectDir: () => ipcRenderer.invoke('dir:select'),
  /**
   * 把平台模型目录的 .fsm/.fsx 批量复制到 WebServer 模型目录。
   * @param {{srcDir:string, wsDir:string}} opts
   */
  syncModelsToWs: (opts) => ipcRenderer.invoke('model:syncToWs', opts),
  /**
   * 校验目录是否为 WebServer 安装目录，并读出配置（模型路径等）。
   * @param {string} dir
   */
  wsProbeDir: (dir) => ipcRenderer.invoke('ws:probeDir', dir),
  /**
   * 自动探测常见 WebServer 安装位置。
   */
  wsAutoDetect: () => ipcRenderer.invoke('ws:autoDetect'),
  /**
   * MCP 面板：列出可用工具。
   */
  mcpListTools: () => ipcRenderer.invoke('mcp:listTools'),
  /**
   * MCP 面板：直接调用一个工具（进程内执行）。
   * @param {string} name
   * @param {object} args
   */
  mcpCall: (name, args) => ipcRenderer.invoke('mcp:call', name, args || {})
})

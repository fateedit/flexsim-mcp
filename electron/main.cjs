/**
 * Electron 主进程（CommonJS）
 * ---------------------------------------------------------------
 * 职责：
 *  1. 创建 BrowserWindow 并加载渲染进程（开发模式走 Vite dev server，生产模式走 dist/index.html）
 *  2. 通过 IPC 暴露 `web:request` 通道，由主进程用 Node 原生 fetch 转发对 FlexSim WebServer 的 GET 请求。
 *
 * 为什么请求要经主进程转发，而不让渲染进程直接 fetch？
 *  - FlexSim WebServer 一般不返回 CORS 响应头；浏览器渲染进程直接 fetch 会被同源策略拦截。
 *  - Electron 主进程使用 Node 网络栈，不受 CORS 限制，且能统一做超时/错误处理。
 *  - 这仍然满足「无独立后端」：转发逻辑就在这个桌面应用内部，没有额外的服务器进程。
 */
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execFile } = require('child_process')

// ── 诊断日志（开发调试用，可删除）──────────────────────────────
const diagLog = path.join(__dirname, 'diag.log')
function diag(msg) {
  try {
    fs.appendFileSync(diagLog, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* ignore */
  }
}
process.on('uncaughtException', (e) => diag(`uncaughtException: ${e && e.stack ? e.stack : e}`))
process.on('unhandledRejection', (r) => diag(`unhandledRejection: ${String(r)}`))

const DEV_SERVER_URL = 'http://localhost:5174'
const isDev = !app.isPackaged

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0e1e35',
    title: 'FlexSim WebServer 远程建模工具箱',
    webPreferences: {
      // 安全约定：开启上下文隔离、关闭 nodeIntegration，仅通过 preload 暴露最小 API
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  if (isDev) {
    // 开发模式优先连 Vite dev server（npm run dev）；若 dev server 未启动（如直接 electron .），
    // 自动回退加载已构建的 dist/index.html，保证窗口始终能出界面。
    diag('loading dev URL...')
    mainWindow.loadURL(DEV_SERVER_URL).catch(() => {
      diag('dev URL failed, fallback to dist')
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    })
    // 开发调试时取消下一行注释即可弹出 DevTools 分离窗口（默认关闭，避免干扰）
    // mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    diag('loading dist file...')
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('did-finish-load', () => diag('did-finish-load'))
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
    diag(`did-fail-load code=${code} desc=${desc} url=${url}`)
  )
  mainWindow.webContents.on('render-process-gone', (_e, details) =>
    diag(`render-process-gone: ${JSON.stringify(details)}`)
  )
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    diag(`renderer[${level}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.on('closed', () => {
    diag('window closed')
    mainWindow = null
  })
}

/**
 * 统一的网络请求通道
 * @param {string} url  完整请求 URL（已拼好 query string）
 * @param {{timeout?:number, binary?:boolean}} opts
 *        timeout: 超时毫秒（默认 5000）
 *        binary : 为 true 时返回 base64（用于截图）
 * @returns {Promise<{ok:boolean,status:number,text:string,durationMs:number,error?:boolean,base64?:string,contentType?:string}>}
 */
ipcMain.handle('web:request', async (_event, url, opts) => {
  const timeout = opts && opts.timeout ? opts.timeout : 5000
  const wantBinary = !!(opts && opts.binary)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  const startTime = Date.now()

  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    diag(`web:request ${url} -> ${res.status} (${Date.now() - startTime}ms)`)

    if (wantBinary) {
      const buf = Buffer.from(await res.arrayBuffer())
      clearTimeout(timer)
      return {
        ok: res.ok,
        status: res.status,
        text: '',
        durationMs: Date.now() - startTime,
        base64: buf.toString('base64'),
        contentType: res.headers.get('content-type') || 'image/png'
      }
    }

    const text = await res.text()
    clearTimeout(timer)
    return {
      ok: res.ok,
      status: res.status,
      text,
      durationMs: Date.now() - startTime
    }
  } catch (err) {
    clearTimeout(timer)
    diag(`web:request ${url} -> ERROR ${String(err && err.message ? err.message : err)}`)
    return {
      ok: false,
      status: 0,
      text: String(err && err.message ? err.message : err),
      durationMs: Date.now() - startTime,
      error: true
    }
  }
})

/**
 * LLM 通道：把渲染进程的 OpenAI 兼容 /chat/completions 请求转发出去。
 * 由主进程发网络请求（渲染进程 CSP 不放开外部连接），key 由用户在前端配置、随调用传入。
 */
ipcMain.handle('llm:chat', async (_event, opts) => {
  const {
    baseUrl,
    apiKey,
    model,
    messages,
    tools,
    temperature = 0.2,
    maxTokens = 4096,
    timeout = 180000
  } = opts || {}

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout || 180000)
  const start = Date.now()

  try {
    const url = (baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '') + '/chat/completions'
    const body = {
      model: model || 'deepseek-chat',
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    }
    if (Array.isArray(tools) && tools.length > 0) {
      body.tools = tools.map((t) => ({ type: 'function', function: t }))
    }
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey || ''}`
      },
      body: JSON.stringify(body)
    })
    const text = await res.text()
    clearTimeout(timer)
    let data = null
    try { data = JSON.parse(text) } catch { /* 非 JSON 响应原样返回 */ }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        text,
        error: (data && (data.error && (data.error.message || JSON.stringify(data.error)))) || text,
        durationMs: Date.now() - start
      }
    }
    return { ok: true, status: res.status, text, data, durationMs: Date.now() - start }
  } catch (err) {
    clearTimeout(timer)
    return {
      ok: false,
      status: 0,
      error: String((err && err.message) || err),
      durationMs: Date.now() - start
    }
  }
})

// 打开本地文件夹（如模型目录），供「打开模型目录」按钮使用
ipcMain.handle('shell:openPath', async (_event, p) => {
  if (typeof p !== 'string' || !p) return { ok: false, error: 'empty path' }
  try {
    const err = await shell.openPath(p)
    return err ? { ok: false, error: err } : { ok: true }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// 导入模型：选 .fsm/.fsx 文件并复制到模型目录（WebServer 扫描到即变成可打开模型）
ipcMain.handle('model:import', async (_event, destDir) => {
  if (typeof destDir !== 'string' || !destDir) {
    return { ok: false, error: '未提供模型目录' }
  }
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择要导入的模型文件',
      filters: [
        { name: 'FlexSim 模型', extensions: ['fsm', 'fsx'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths || !r.filePaths[0]) {
      return { ok: false, canceled: true }
    }
    const src = r.filePaths[0]
    const dest = path.join(destDir, path.basename(src))
    if (path.resolve(src) === path.resolve(dest)) {
      return { ok: true, file: path.basename(src), already: true }
    }
    await fs.promises.copyFile(src, dest)
    return { ok: true, file: path.basename(src), dest }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// ── WebServer 服务端配置管理（模型目录等）─────────────────────────────
// 运行中的服务启动时读取其 webserver 目录上级的「flexsim webserver configuration.txt」，
// 应用按"当前 configuration 接口返回的值"匹配出真正生效的那份，避免改错副本。
const WS_CONFIG_CANDIDATES = [
  'C:\\Program Files (x86)\\FlexSim Web Server\\flexsim webserver configuration.txt',
  'C:\\Program Files\\FlexSim Web Server\\flexsim webserver configuration.txt'
]

function parseWsConfig(file) {
  const text = fs.readFileSync(file, 'utf8')
  const grab = (re) => {
    const m = text.match(re)
    return m && m[1] ? m[1].trim() : ''
  }
  return {
    path: file,
    modelDir: grab(/^\s*Model Directory:\s*(.*)$/m),
    port: grab(/^\s*Port:\s*(.*)$/m)
  }
}

/** 读取生效中的 WebServer 配置文件（按 live 值匹配） */
ipcMain.handle('server:readConfig', (_event, live) => {
  let fallback = null
  for (const p of WS_CONFIG_CANDIDATES) {
    try {
      if (!fs.existsSync(p)) continue
      const c = parseWsConfig(p)
      if (!fallback) fallback = { ok: true, ...c, matched: false }
      if (c.modelDir === live?.modelDirectory && String(c.port) === String(live?.port)) {
        return { ok: true, ...c, matched: true }
      }
    } catch (e) {
      /* ignore */
    }
  }
  return fallback || { ok: false, error: '未找到 WebServer 配置文件' }
})

/** 只改 Model Directory 一行，其余原样 */
function rewriteModelDirLine(text, newDir) {
  return text.replace(/^(\s*Model Directory:\s*).*$/m, `$1${newDir}`)
}

/** 直接写配置（普通权限）；Program Files 下会 EACCES → 返回 needsAdmin */
ipcMain.handle('server:writeConfig', async (_event, { path: cfgPath, newModelDir }) => {
  try {
    if (!fs.existsSync(cfgPath)) return { ok: false, error: '配置文件不存在' }
    const c = parseWsConfig(cfgPath)
    await fs.promises.copyFile(cfgPath, cfgPath + '.bak')
    await fs.promises.writeFile(cfgPath, rewriteModelDirLine(c.text, newModelDir), 'utf8')
    return { ok: true }
  } catch (e) {
    if (e && (e.code === 'EACCES' || e.code === 'EPERM')) {
      return { ok: false, needsAdmin: true, error: '需要管理员权限（目标目录受保护）' }
    }
    return { ok: false, error: String((e && e.message) || e) }
  }
})

/** 提权写配置：生成临时 ps1，经 UAC 以管理员身份执行（弹窗确认） */
ipcMain.handle('server:writeConfigElevated', async (_event, { path: cfgPath, newModelDir }) => {
  const ps1 = path.join(app.getPath('temp'), 'fsw-write-ws-config.ps1')
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `$p = '${String(cfgPath).replace(/'/g, "''")}'`,
    `$newDir = '${String(newModelDir).replace(/'/g, "''")}'`,
    `$t = Get-Content -LiteralPath $p -Raw`,
    `Copy-Item -LiteralPath $p -Destination ($p + '.bak') -Force`,
    `$t = [regex]::Replace($t, '(?m)^(\\s*Model Directory:\\s*).*$', ('$1' + $newDir))`,
    `Set-Content -LiteralPath $p -Value $t -Encoding UTF8`
  ].join('\n')
  try {
    await fs.promises.writeFile(ps1, script, 'utf8')
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
  return new Promise((resolve) => {
    const args = [
      '-NoProfile',
      '-Command',
      `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1}'`
    ]
    const proc = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' })
    proc.on('error', (err) => resolve({ ok: false, error: String((err && err.message) || err) }))
    proc.on('exit', (code) =>
      resolve(code === 0 ? { ok: true } : { ok: false, error: `提权写入未完成（退出码 ${code}，可能 UAC 被取消）` })
    )
  })
})

/** 找到监听指定端口的 PID（netstat 解析） */
function findListeningPid(port) {
  return new Promise((resolve) => {
    execFile('netstat.exe', ['-ano'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const line = stdout.split('\n').find((l) => l.includes(`:${port} `) && l.includes('LISTENING'))
      if (!line) return resolve(null)
      const parts = line.trim().split(/\s+/)
      resolve(parts[parts.length - 1] || null)
    })
  })
}

function killPid(pid) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/F', '/PID', String(pid)], { windowsHide: true }, () => resolve(true))
  })
}

/** 提权启动命令（UAC） */
function startElevated(cmd, cmdArgs) {
  return new Promise((resolve) => {
    const argList = cmdArgs.map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',')
    const psCmd = `Start-Process '${cmd}' -Verb RunAs -ArgumentList ${argList}`
    const proc = spawn('powershell.exe', ['-NoProfile', '-Command', psCmd], {
      windowsHide: true,
      stdio: 'ignore'
    })
    proc.on('error', () => resolve(false))
    proc.on('exit', () => resolve(true))
  })
}

/** 重启 WebServer：终止 :80 监听进程 → 提权重启 node index.js（配置目录上级的 webserver 目录） */
ipcMain.handle('server:restart', async (_event, cfgPath) => {
  try {
    const pid = await findListeningPid(80)
    if (pid) await killPid(pid)
    // 等端口释放
    await new Promise((r) => setTimeout(r, 1500))
    const wsDir = path.join(path.dirname(cfgPath), 'webserver')
    if (!fs.existsSync(path.join(wsDir, 'index.js'))) {
      return { ok: false, error: `未找到 WebServer 目录：${wsDir}` }
    }
    const ok = await startElevated('cmd.exe', ['/c', `cd /d "${wsDir}" && start "FlexSim WebServer" /MIN node index.js`])
    return ok
      ? { ok: true, msg: '已重启 WebServer（新配置生效），约几秒后可重新连接' }
      : { ok: false, error: '重启指令未完成（可能 UAC 被取消）' }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// 选择文件夹（供「平台模型目录」设置使用）
ipcMain.handle('dir:select', async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true }
    return { ok: true, path: r.filePaths[0] }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

// 把平台模型目录里的 .fsm/.fsx 批量复制到 WebServer 模型目录
ipcMain.handle('model:syncToWs', async (_event, { srcDir, wsDir }) => {
  if (typeof srcDir !== 'string' || typeof wsDir !== 'string' || !srcDir || !wsDir) {
    return { ok: false, error: '目录参数缺失' }
  }
  try {
    const files = await fs.promises.readdir(srcDir)
    const models = files.filter((f) => /\.(fsm|fsx)$/i.test(f))
    if (models.length === 0) return { ok: true, copied: 0, msg: '平台目录里没有 .fsm/.fsx 文件' }
    let copied = 0
    const skipped = []
    for (const f of models) {
      const src = path.join(srcDir, f)
      const dest = path.join(wsDir, f)
      if (path.resolve(src) === path.resolve(dest)) {
        skipped.push(f)
        continue
      }
      await fs.promises.copyFile(src, dest)
      copied += 1
    }
    return {
      ok: true,
      copied,
      skipped,
      msg: `已复制 ${copied} 个模型${skipped.length ? `，跳过 ${skipped.length} 个（已在目标目录）` : ''}`
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

/** 校验一个目录是否为有效的 WebServer 安装目录，并读出其配置（模型路径等） */
ipcMain.handle('ws:probeDir', (_event, dir) => {
  if (typeof dir !== 'string' || !dir) return { ok: false, error: '未提供目录' }
  const indexJs = path.join(dir, 'webserver', 'index.js')
  const cfgPath = path.join(dir, 'flexsim webserver configuration.txt')
  if (!fs.existsSync(indexJs)) {
    return { ok: false, error: '该目录下没有 webserver\\index.js，不是有效的 WebServer 安装目录' }
  }
  if (!fs.existsSync(cfgPath)) {
    return { ok: false, error: '未找到配置文件（flexsim webserver configuration.txt）', hasServer: true }
  }
  try {
    const c = parseWsConfig(cfgPath)
    return { ok: true, hasServer: true, configPath: cfgPath, modelDir: c.modelDir, port: c.port }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), hasServer: true }
  }
})

/** 自动探测常见 WebServer 安装位置 */
ipcMain.handle('ws:autoDetect', () => {
  const candidates = [
    'C:\\Program Files (x86)\\FlexSim Web Server',
    'C:\\Program Files\\FlexSim Web Server'
  ]
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'webserver', 'index.js'))) return dir
    } catch {
      /* ignore */
    }
  }
  return null
})

// ── MCP 模式：以 MCP server 运行（stdio），不创建窗口 ──────────────
// 用法：electron . --mcp 或（推荐）node electron/mcp-server.cjs
// Claude Desktop / Cursor 等 MCP 客户端接入时用 node 入口最稳。
if (process.argv.includes('--mcp')) {
  require('./mcp-server.cjs').run()
  process.stdin.on('end', () => process.exit(0))
} else {
  // ── MCP 面板支持：工具列表 + 直接调用（进程内执行同一执行器，无需另起进程）──
const mcpServerModule = require('./mcp-server.cjs')

ipcMain.handle('mcp:listTools', () => {
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'registry.json'), 'utf8')
    )
    return {
      ok: true,
      tools: (reg.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters || { type: 'object', properties: {} }
      }))
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

ipcMain.handle('mcp:call', async (_event, name, args) => {
  try {
    const text = await mcpServerModule.executeTool(String(name || ''), args || {})
    return { ok: true, text }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
})

app.whenReady().then(createWindow)

  app.on('window-all-closed', () => {
    // 在 macOS 上通常保留应用，这里按 Windows 习惯直接退出
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

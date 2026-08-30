<script setup lang="ts">
import { ref, watch } from 'vue'
import Icon from './Icon.vue'
import { useUi } from '@/stores/ui'
import { useSettings } from '@/stores/settings'
import { useConnection } from '@/stores/connection'

const ui = useUi()
const settings = useSettings()
const conn = useConnection()

// 打开设置时加载 WebServer 配置文件（模型目录编辑）
watch(
  () => ui.settingsOpen,
  (open) => {
    if (open) loadWsConfig()
  }
)

const llmTestMsg = ref('')
const llmTestState = ref<'ok' | 'err' | ''>('')
const serverMsg = ref('')
const serverMsgType = ref<'ok' | 'err' | ''>('')

// ── WebServer 配置文件（模型目录编辑）──
const wsCfg = ref<{ path: string; modelDir: string; port: string; matched: boolean } | null>(null)
const editModelDir = ref('')

function setServerMsg(text: string, type: 'ok' | 'err') {
  serverMsg.value = text
  serverMsgType.value = type
  setTimeout(() => {
    if (serverMsg.value === text) {
      serverMsg.value = ''
      serverMsgType.value = ''
    }
  }, 6000)
}

/** 读取生效中的 WebServer 配置文件 */
async function loadWsConfig() {
  // 优先按用户配置的安装目录探测；否则按运行中服务的值匹配
  if (settings.wsInstallDir.trim()) {
    await probeWsDir(settings.wsInstallDir.trim())
    return
  }
  if (!conn.serverConfig) return
  const live = {
    modelDirectory: conn.serverConfig.modelDirectory,
    port: conn.serverConfig.port
  }
  const r = await window.api.wsReadConfig(live)
  if (r.ok && r.path) {
    wsCfg.value = {
      path: r.path,
      modelDir: r.modelDir || '',
      port: r.port || '',
      matched: !!r.matched
    }
    editModelDir.value = r.modelDir || ''
    // 首次使用：平台模型目录默认取 WebServer 当前模型目录
    if (!settings.platformModelDir && r.modelDir) {
      settings.platformModelDir = r.modelDir
    }
  }
}

/** 保存模型目录到配置文件（自动备份；Program Files 下自动提权） */
async function saveModelDir() {
  if (!wsCfg.value) return
  const newDir = editModelDir.value.trim()
  if (!newDir) return setServerMsg('模型目录不能为空', 'err')
  if (!/^[a-zA-Z]:[\\/]/.test(newDir)) {
    return setServerMsg('请输入 Windows 绝对路径（如 D:\\Common\\flexsim\\model）', 'err')
  }
  const opts = { path: wsCfg.value.path, newModelDir: newDir }
  let r = await window.api.wsWriteConfig(opts)
  if (!r.ok && r.needsAdmin) {
    const go = confirm('配置文件位于受保护目录，需要管理员权限写入。\n将弹出 UAC 授权窗口，是否继续？')
    if (!go) return
    r = await window.api.wsWriteConfigElevated(opts)
  }
  if (r.ok) {
    setServerMsg('已写入配置文件（已备份 .bak）。重启 WebServer 后生效', 'ok')
  } else {
    setServerMsg(`保存失败：${r.error}`, 'err')
  }
}

/** 重启 WebServer 使新配置生效 */
async function restartServer() {
  if (!wsCfg.value) return
  const go = confirm(
    '将终止当前 WebServer（:80）进程并以管理员身份重启。\n重启后应用会自动重连。是否继续？'
  )
  if (!go) return
  const r = await window.api.wsRestart(wsCfg.value.path)
  if (r.ok) {
    setServerMsg(r.msg || '已重启', 'ok')
    setTimeout(() => conn.test(), 4000)
  } else {
    setServerMsg(`重启失败：${r.error}`, 'err')
  }
}

// ── WebServer 路径配置（分发到新机器时用户配置）──
async function probeWsDir(dir: string) {
  const r = await window.api.wsProbeDir(dir)
  if (r.ok && r.configPath) {
    settings.wsConfigPath = r.configPath
    wsCfg.value = {
      path: r.configPath,
      modelDir: r.modelDir || '',
      port: r.port || '',
      matched: false
    }
    editModelDir.value = r.modelDir || ''
    if (!settings.platformModelDir && r.modelDir) settings.platformModelDir = r.modelDir
    setServerMsg(`已识别 WebServer：${r.configPath}`, 'ok')
  } else {
    setServerMsg(r.error || '目录无效', 'err')
  }
}

async function onWsDirInput() {
  const dir = settings.wsInstallDir.trim()
  if (dir) await probeWsDir(dir)
}

async function browseWsDir() {
  const r = await window.api.selectDir()
  if (r.ok && r.path) {
    settings.wsInstallDir = r.path
    await probeWsDir(r.path)
  }
}

async function autoDetectWsDir() {
  const dir = await window.api.wsAutoDetect()
  if (dir) {
    settings.wsInstallDir = dir
    await probeWsDir(dir)
  } else {
    setServerMsg('未找到常见安装位置，请手动选择目录', 'err')
  }
}

async function testConn() {
  await conn.test()
}

/** 打开模型目录（系统文件管理器） */
async function openModelDir() {
  const dir = conn.serverConfig?.modelDirectory
  if (!dir) return
  const r = await window.api.openPath(dir)
  serverMsg.value = r.ok ? `已打开：${dir}` : `打开失败：${r.error}`
  serverMsgType.value = r.ok ? 'ok' : 'err'
}

/** 导入模型文件：选择 .fsm 并复制到模型目录 → 刷新模型列表 */
async function importModel() {
  const dir = conn.serverConfig?.modelDirectory
  if (!dir) return
  const r = await window.api.importModel(dir)
  if (r.canceled) return
  if (r.ok) {
    await conn.loadModels()
    await conn.loadServerInfo()
    serverMsg.value = r.already
      ? `该文件已在模型目录中：${r.file}`
      : `已导入：${r.file} → 模型目录，现在可以打开了`
    serverMsgType.value = 'ok'
  } else {
    serverMsg.value = `导入失败：${r.error}`
    serverMsgType.value = 'err'
  }
  setTimeout(() => (serverMsg.value = ''), 5000)
}

/** 刷新服务器信息 */
async function refreshServer() {
  await conn.loadServerInfo()
  serverMsg.value = '已刷新'
  serverMsgType.value = 'ok'
  setTimeout(() => (serverMsg.value = ''), 2000)
}

/** 终止实例 */
async function onTerminate(model: string, instance: number) {
  if (!confirm(`确定终止实例 ${model} #${instance}？（模型进程会被关闭）`)) return
  const r = await conn.terminate(model, instance)
  serverMsg.value = r.ok ? `已终止 ${model} #${instance}` : `终止失败：${r.reason}`
  serverMsgType.value = r.ok ? 'ok' : 'err'
  await refreshServer()
}

/** 用当前配置发一条最小请求验证 LLM 连通性 */
async function testLlm() {
  llmTestMsg.value = ''
  llmTestState.value = ''
  if (!settings.llmApiKey.trim()) {
    llmTestMsg.value = '请先填写 API Key'
    llmTestState.value = 'err'
    return
  }
  try {
    const res = await window.api.llmChat({
      baseUrl: settings.llmBaseUrl,
      apiKey: settings.llmApiKey,
      model: settings.llmModel,
      messages: [{ role: 'user', content: 'ping' }],
      temperature: 0,
      maxTokens: 16,
      timeout: 30000
    })
    if (res.ok) {
      llmTestMsg.value = `✓ 连接成功（${res.durationMs}ms）`
      llmTestState.value = 'ok'
    } else {
      llmTestMsg.value = `✗ ${res.error || `HTTP ${res.status}`}`
      llmTestState.value = 'err'
    }
  } catch (e) {
    llmTestMsg.value = `✗ ${e instanceof Error ? e.message : String(e)}`
    llmTestState.value = 'err'
  }
}
</script>

<template>
  <div v-if="ui.settingsOpen" class="set-backdrop" @click="ui.closeSettings()"></div>
  <div v-if="ui.settingsOpen" class="set-modal">
    <div class="set-head">
      <div class="set-title">
        <Icon name="settings" :size="16" /> 设置
      </div>
      <button class="mini ghost" @click="ui.closeSettings()">
        <Icon name="x" :size="14" />
      </button>
    </div>

    <div class="set-body">
      <!-- 连接 -->
      <div class="sec">
        <div class="sec-title">连接</div>
        <div class="row">
          <label>WebServer 地址</label>
          <div class="row-input">
            <input v-model="conn.base" spellcheck="false" placeholder="http://localhost/webserver.dll" />
            <button class="mini" @click="testConn" :disabled="conn.loading">
              {{ conn.loading ? '测试中…' : '连接测试' }}
            </button>
          </div>
        </div>
        <div class="row">
          <label>状态</label>
          <span :class="conn.connected ? 'ok-text' : 'dim-text'">
            {{ conn.connected ? `已连接 · ${conn.modelName} #${conn.instanceNum}` : '未连接' }}
          </span>
        </div>
      </div>

      <!-- AI 模型 -->
      <div class="sec">
        <div class="sec-title">AI 模型（OpenAI 兼容接口）</div>
        <div class="row">
          <label>Base URL</label>
          <input v-model="settings.llmBaseUrl" spellcheck="false" placeholder="https://api.deepseek.com" />
        </div>
        <div class="row">
          <label>API Key</label>
          <input
            v-model="settings.llmApiKey"
            type="password"
            spellcheck="false"
            placeholder="你的 API Key（仅存本机）"
          />
        </div>
        <div class="row">
          <label>模型名</label>
          <div class="row-input">
            <input v-model="settings.llmModel" spellcheck="false" placeholder="deepseek-chat / gpt-4o / llama3" />
            <button class="mini" @click="testLlm">测试连接</button>
          </div>
        </div>
        <div v-if="llmTestMsg" class="llm-test" :class="llmTestState">{{ llmTestMsg }}</div>
        <div class="row check">
          <label>
            <input type="checkbox" v-model="settings.aiAutoExecute" />
            自动执行 AI 工具调用（不逐条确认）
          </label>
          <span class="dim-text">关闭时每次工具调用前需确认，推荐对真实模型保持关闭</span>
        </div>
      </div>

      <!-- 服务器 -->
      <div class="sec">
        <div class="sec-title">
          服务器（WebServer 服务端）
          <button class="mini" style="margin-left: 8px" @click="refreshServer">刷新</button>
        </div>
        <!-- 路径配置：WebServer 安装目录 + 随其模型路径 -->
        <div class="row">
          <label>WebServer 安装目录</label>
          <div class="row-input">
            <input
              v-model="settings.wsInstallDir"
              spellcheck="false"
              placeholder="如 C:\Program Files (x86)\FlexSim Web Server"
              @change="onWsDirInput"
            />
            <button class="mini" @click="browseWsDir">浏览</button>
            <button class="mini" @click="autoDetectWsDir">自动探测</button>
          </div>
        </div>
        <template v-if="conn.serverConfig">
          <div class="row">
            <label>模型目录</label>
            <div class="row-input">
              <input v-model="editModelDir" spellcheck="false" placeholder="如 C:\FlexSim\model" />
              <button class="mini" @click="saveModelDir" title="写入 WebServer 配置文件（自动备份）">保存</button>
              <button class="mini" @click="openModelDir" title="在资源管理器中打开模型目录">打开</button>
              <button class="mini" @click="importModel" title="选择任意位置的 .fsm 复制进模型目录">导入</button>
            </div>
          </div>
          <div v-if="wsCfg" class="row">
            <label>配置文件</label>
            <span class="dim-text file-path" :title="wsCfg.path">
              {{ wsCfg.path }}
              <template v-if="!wsCfg.matched">（未精确匹配运行中服务，修改可能不生效）</template>
            </span>
          </div>
          <div class="row">
            <label>程序目录</label>
            <input :value="conn.serverConfig.programDirectory" readonly spellcheck="false" />
          </div>
          <div class="row">
            <label>端口 / 实例数</label>
            <span class="dim-text">
              端口 {{ conn.serverConfig.port }} · 最大实例 {{ conn.serverConfig.maxInstances }}
            </span>
          </div>
          <div class="row">
            <label>远程操作</label>
            <span class="dim-text">
              上传 {{ conn.serverConfig.uploadEnabled ? '允许' : '关闭' }} ·
              下载 {{ conn.serverConfig.downloadEnabled ? '允许' : '关闭' }} ·
              删除 {{ conn.serverConfig.deleteEnabled ? '允许' : '关闭' }}
            </span>
          </div>
          <div class="row">
            <label>重启服务</label>
            <div class="row-input">
              <span class="dim-text">修改配置后需重启生效（自动终止 :80 并提权重启）</span>
              <button class="mini danger" @click="restartServer">重启 WebServer</button>
            </div>
          </div>
          <div class="row">
            <label>模型文件</label>
            <div class="file-list">
              <div v-for="f in conn.modelFiles" :key="f" class="file-item">
                <Icon name="folder" :size="12" /> {{ f }}
              </div>
              <div v-if="!conn.modelFiles.length" class="dim-text">（无）</div>
            </div>
          </div>
          <div class="row">
            <label>运行中实例</label>
            <div class="inst-list">
              <div
                v-for="inst in conn.instances"
                :key="inst.modelName + inst.instanceNum"
                class="inst-item"
              >
                <span class="inst-name">{{ inst.modelName }} #{{ inst.instanceNum }}</span>
                <button class="mini danger" @click="onTerminate(inst.modelName, inst.instanceNum)">
                  终止
                </button>
              </div>
              <div v-if="!conn.instances.length" class="dim-text">（无）</div>
            </div>
          </div>
        </template>
        <div v-else class="dim-text">未连接或服务器未返回配置（连接后自动加载）</div>
        <div v-if="serverMsg" class="llm-test" :class="serverMsgType">{{ serverMsg }}</div>
      </div>

      <!-- 常规 -->
      <div class="sec">
        <div class="sec-title">常规</div>
        <div class="row">
          <label>请求超时（ms）</label>
          <input v-model.number="settings.timeout" type="number" min="1000" />
        </div>
        <div class="row">
          <label>监控轮询间隔（ms）</label>
          <input v-model.number="settings.monitorInterval" type="number" min="500" />
        </div>
        <div class="row check">
          <label>
            <input type="checkbox" v-model="settings.readOnly" />
            只读模式（拦截所有写操作）
          </label>
        </div>
        <div class="row check">
          <label>
            <input type="checkbox" :checked="settings.theme === 'light'" @change="settings.toggleTheme()" />
            浅色主题
          </label>
        </div>
      </div>
    </div>

    <div class="set-foot">
      <span class="dim-text">配置自动保存在本机</span>
      <button class="primary" @click="ui.closeSettings()">完成</button>
    </div>
  </div>
</template>

<style scoped>
.set-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(8, 15, 28, 0.5);
  backdrop-filter: blur(2px);
  z-index: 60;
  animation: fadeIn 0.2s ease;
}
.set-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 460px;
  max-width: 92vw;
  max-height: 82vh;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  z-index: 61;
  display: flex;
  flex-direction: column;
  animation: popIn 0.22s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.set-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.set-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 14px;
}
.set-title :deep(.icon-wrap) {
  color: var(--accent);
}
.set-body {
  flex: 1;
  overflow: auto;
  padding: 6px 16px 14px;
}
.sec {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
.sec:last-child {
  border-bottom: none;
}
.sec-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
  color: var(--accent);
  margin-bottom: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 9px;
  font-size: 12.5px;
}
.row label {
  width: 130px;
  flex-shrink: 0;
  color: var(--text-dim);
}
.row input[type='text'],
.row input:not([type]),
.row input[type='password'],
.row input[type='number'] {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
}
.row-input {
  flex: 1;
  display: flex;
  gap: 6px;
  min-width: 0;
}
.row-input input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
}
.row.check {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.row.check label {
  width: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  cursor: pointer;
}
.dim-text {
  color: var(--text-faint);
  font-size: 11.5px;
}
.file-path {
  word-break: break-all;
  font-family: var(--font-mono);
  font-size: 10.5px;
}
.align-status {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  margin: 2px 0 8px;
}
.align-status.ok {
  color: var(--success);
  background: var(--success-soft);
}
.align-status.warn {
  color: var(--warn);
  background: var(--warn-soft);
}
.align-status.none {
  color: var(--text-faint);
  background: var(--surface-3);
}
.align-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.hint {
  font-size: 11px;
  color: var(--text-faint);
}
.ok-text {
  color: var(--success);
}
.llm-test {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--r-sm);
  margin: 4px 0 10px;
}
.llm-test.ok {
  color: var(--success);
  background: var(--success-soft);
}
.llm-test.err {
  color: var(--danger);
  background: rgba(248, 113, 113, 0.12);
}
.file-list {
  flex: 1;
  max-height: 120px;
  overflow: auto;
  font-size: 11.5px;
  font-family: var(--font-mono);
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 6px 8px;
}
.file-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 0;
  color: var(--text-dim);
}
.file-item :deep(.icon-wrap) {
  color: var(--text-faint);
}
.inst-list {
  flex: 1;
  max-height: 120px;
  overflow: auto;
  font-size: 11.5px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 6px 8px;
}
.inst-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
}
.inst-name {
  font-family: var(--font-mono);
  color: var(--text-dim);
}
.danger {
  color: var(--danger);
  border-color: var(--danger);
}
.danger:hover {
  background: rgba(248, 113, 113, 0.12);
}
.set-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
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
    transform: translate(-50%, -46%) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}
</style>

# AGENTS.md — flexsim-mcp 仓库指南

给 AI 编码助手的说明：改这个仓库前先读本文件，可省去重复交代上下文。

## 这是什么

FlexSim WebServer 的 **MCP（Model Context Protocol）服务器**。让任何 MCP 客户端（DeepSeek Harness / Claude Desktop / Cursor）通过自然语言操控 FlexSim 仿真模型：建对象、连线、读写模型树、运行控制、给模型热部署新 handler。

```
AI 客户端  ←(stdio, JSON-RPC 2.0)→  mcp-server.cjs  ←(HTTP :80)→  FlexSim WebServer  ←→  模型内 handler
```

**零第三方依赖**（仅需 Node.js ≥ 18）——这是核心卖点，别引入 npm 依赖。

## 目录结构

```
flexsim-mcp/
├── server/
│   ├── mcp-server.cjs      ★ 唯一运行入口：stdio JSON-RPC + 工具执行器 + WebServer 自愈
│   └── registry.json       ★ 单一事实源：23 工具定义 + guide + 3 prompts + catalog
├── handlers/
│   └── queryhandlers.t     ★ 4 个基础 handler（FlexSim 模型导入用，二进制树文件）
├── tests/
│   └── test-mcp-protocol.cjs  端到端 stdio 协议测试（不需要 FlexSim）
├── docs/
│   └── HANDLERS.md         handler 详解、执行模型、FlexScript 函数存在性实测
├── README.md               中文（默认）
└── README.en.md            English
```

**改工具 / 改指南 / 改 prompts，一律改 `server/registry.json`**——不要往 `mcp-server.cjs` 里加常量。

## 构建与测试

无需 `npm install`。

```bash
# 运行服务器
node server/mcp-server.cjs

# 协议测试（起真实 stdio 客户端，走完整 JSON-RPC 流程）
node tests/test-mcp-protocol.cjs

# 语法检查
node --check server/mcp-server.cjs
node -e "require('./server/registry.json'); console.log('registry ok')"
```

> ⚠️ **端到端测试必须在允许 `child_process.spawn` + 管道的环境里跑。** 受限沙箱会 `spawn EPERM`，那不是测试失败。

## 编码约定

- **stdout 纪律（硬性）**：stdio MCP 里 **stdout 只能有 JSON-RPC**。`console.log` 会污染协议流。
  - 协议输出：`process.stdout.write(JSON.stringify(msg) + '\n')`（`send()`）
  - 日志：**一律 `process.stderr.write`**
  - **禁止 `console.log`**。违反的后果不是立即报错，而是"客户端偶尔解析失败"这类玄学问题。
- CommonJS（`.cjs`），2 空格缩进，单引号，无分号风格已在文件内保持一致——跟随现有代码。
- 工具名 snake_case；handler 名 snake_case；与 registry 中工具名对齐。
- 工具失败走 `result.isError: true`（MCP 规范），**不要**用 JSON-RPC error。
  协议层错误才用 `error`：`-32700` 解析失败 / `-32601` 方法不存在 / `-32602` 参数无效。
- `tools/call` 走**串行队列**（`enqueue`）保证响应顺序，别改成并发。

## 测试要求

- 新增工具后，在 `tests/test-mcp-protocol.cjs` 里补断言（至少覆盖：工具出现在 `tools/list`、schema 合法、非法参数的错误路径）。
- 需要真实 FlexSim 的端到端用例**不要**写进 `test-mcp-protocol.cjs`（它必须能在无 FlexSim 环境跑通）。放 `tests/integration/` 并让它优雅跳过。
- 提交前必跑：`node tests/test-mcp-protocol.cjs`（应全绿）。

## handler 相关的硬约束（改代码前必读）

这些是实测结论，违反会静默失效（见 `docs/HANDLERS.md` 详述）：

1. **handler 的执行体是已编译代码。** 改节点里的文本（`data`）**不会重编译**——调用时跑的还是旧代码。
2. **重编译三步只能由 handler 内部调用**：`setnodestr` → `switch_flexscript` → `buildnodeflexscript`。
   因此**新增 handler 只能靠 `copy_handler`**，4 个基础 handler 无法自增长出第 5 个。
3. **WebServer 的命令入口很窄**：只放行「内置命令（`treelayer`/`getnodedata`/`run`/`stop`/`reset`/`getruntime`…）+ 已注册 handler 名 + 实例管理」。其余一律 404。**没有 `evaluate` 那种万能口子**（14 个候选实测全 404）。
4. **参数无关设计**：handler 只读通用参数（`GET/value`、`GET/action`、`GET/name`、`GET/msg`），**绝不读 handler 自己名字的参数**——否则复制改名后失效。
5. **删除 handler 要给全路径**：`delete_object` 是 `node(objName, model())`，裸名只在模型层找。`copy_handler` / `set_code` 则接受裸名（内部拼前缀）——三个操作口径不一致。
6. **FlexScript 里没有 `savemodel` / `getmodeltime` / `savemodelprepare` / `numtostr`。**
   判断函数是否存在，用**编译探针**（`if (1 == 2) { 待测函数(); }`）——handler 编译失败时 WebServer 不报错，只回空 `HTTP 200`。

## 提交规范

- 提交信息用**祈使句、现在时**，标题 ≤ 72 字符（英文）。
  例：`Fix: registry ping used an undefined FlexScript function`
- 正文说明**为什么**改、以及验证方式（跑了哪条命令）。
- **不要提交**：模型文件、日志、`.pyd`/`.dll`、本机绝对路径。
- FlexSim 安装路径必须走环境变量（`FLEXSIM_WS_DIR` / `FLEXSIM_NODE` / `FLEXSIM_WS_BASE`），**不写死进代码**。

## 安全

- 不提交真实模型（`.fsm`）与含内网信息的配置；`FlexSimInstall` / 私网路径一律排除。
- 提交前检查 `README` / `docs` 里有没有残留的本机绝对路径与用户名。
- WebServer 的 `Model Uploading / Downloading / Deleting` 默认关闭——文档里别假设它们可用。

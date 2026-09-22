# FlexSim MCP Server — AI 远程建模工具箱

> **中文** | [English](README.en.md)

基于 **FlexSim WebServer** 的 **MCP（Model Context Protocol）** 服务器。让 AI 助手（DeepSeek Harness / Claude / Cursor 等任何支持 MCP 的客户端）通过自然语言直接操控 FlexSim 仿真模型：创建对象、读写模型树节点、连接 / 删除对象、运行控制、甚至给模型热部署新功能。

```
AI 客户端  ←(stdio, JSON-RPC 2.0)→  mcp-server.cjs  ←(HTTP :80)→  FlexSim WebServer  ←→  模型内的自定义 handler
```

## 特性

- **纯 stdio MCP 服务器**，零第三方依赖（仅需 Node.js）
- **23 个内置工具**：实例管理、模型树浏览、节点读写、创建 / 连接 / 删除对象、运行控制、部署自定义 handler 等
- **插件架构**：`deploy_handler` 可给运行中的模型热部署任意新功能（copyhandler 增殖原语）
- **自带 4 个基础 handler 节点文件**（`handlers/queryhandlers.t`），导入模型即可用

## 快速开始

### 1. 环境要求

- Node.js ≥ 18
- FlexSim 且 **WebServer** 已启动（默认 `http://localhost/webserver.dll`，端口 80）

### 2. 给模型安装 4 个基础 handler（手动安装）

handler 是模型树 `Tools/serverinterface/queryhandlers/` 下的功能节点。**WebServer 只认这个固定路径，且只在实例启动时加载 handler**，所以必须完整执行：

1. 用 **FlexSim** 打开你的模型（.fsm）。
2. 在模型树 `Tools` 节点下**新建子节点 `serverinterface`**（已存在则跳过）；再在 `serverinterface` 下**新建子节点 `queryhandlers`**（已存在则跳过）。最终路径为：
   ```
   Tools/serverinterface/queryhandlers
   ```
3. 导入 `handlers/queryhandlers.t`，**两种方式任选**：
   - **方式一（子节点导入）**：选中 `queryhandlers` 节点 → 右键 → **Paste / Import** → 选择 `handlers/queryhandlers.t`，把 4 个 handler 作为子节点粘贴进去。
   - **方式二（整节点覆盖）**：在 `Tools` 下新建一个子节点 → 右键 → **Paste / Import** 选择 `handlers/queryhandlers.t` **粘贴覆盖**该节点（文件是完整的 queryhandlers 节点，覆盖后即为 `queryhandlers`，内含 4 个 handler）；必要时把节点改名为 `queryhandlers` 并移到 `Tools/serverinterface/` 下。

> 💡 **推荐用文件导入 / 覆盖**（新手友好，避免踩类型坑）：`queryhandlers.t` 已包含正确的节点类型与参数结构，导入即用。若你选择手工新建节点填代码，**必须把节点类型设置为 flexscript**，否则 handler 代码无法编译执行。

4. 确认 `Tools/serverinterface/queryhandlers/` 下出现 4 个节点：`template`、`create_object`、`connect_objects`、`delete_object`。
5. **Ctrl+S 保存模型**（必须保存，否则重启后丢失）。
6. **重新通过 WebServer 打开模型实例**：先停止 / 关闭当前实例，再重新打开（或重启 WebServer 服务）。**不重启实例，新 handler 不会被识别，调用会 404。**

### 2.5 想用「插件架构 / AI 现场长功能」，还要再装一个 `copy_handler`

上面 4 个 handler 是**最小建模集**：有了它们，`create_object` / `connect_objects` / `delete_object` / `write_node` / `set_loc` / 运行控制等工具都能用。

但 **`deploy_handler`（让 AI 给模型热部署新功能）不在这 4 个里面**——它底层依赖模型侧存在一个名为 **`copy_handler`** 的 handler。原因：

- handler 的执行体是**已编译的代码**，节点里的文本（`data`）**改了不会自动重编译**
- 重编译必须由 handler 内部调用 `switch_flexscript` + `buildnodeflexscript`
- 所以**只有 `copy_handler`（复制节点 + 写代码 + 编译）能造出新 handler**

**不装 `copy_handler` 的后果**：`deploy_handler` 会返回 404，它的「自增长」能力用不了。

装法与 4 个基础 handler 相同（节点类型必须是 **flexscript**，装完 **Ctrl+S** 再**重启实例**）：

```flexscript
/** copy_handler — 复制 handler 并写入新代码（参数无关：value=源模板, name=新名, code=代码） */
treenode replyNode = param(1);
treenode parsedRequestNode = param(2);
treenode vn = node("GET/value", parsedRequestNode);
treenode nn = node("GET/name", parsedRequestNode);
treenode cn = node("GET/code", parsedRequestNode);
if (!vn || !nn || !cn) { setnodestr(replyNode, "<status>error</status><reason>missing value/name/code</reason>"); return replyNode; }
string tplName = gets(vn);
string newName = gets(nn);
string newCode = gets(cn);
treenode src = node("Tools/serverinterface/queryhandlers/" + tplName, model());
if (!objectexists(src)) { setnodestr(replyNode, "<status>error</status><reason>template not found: " + tplName + "</reason>"); return replyNode; }
treenode parent = node("Tools/serverinterface/queryhandlers", model());
treenode copy = createcopy(src, parent);
if (!objectexists(copy)) { setnodestr(replyNode, "<status>error</status><reason>copy failed</reason>"); return replyNode; }
setnodename(copy, newName);
setnodestr(copy, newCode);
switch_flexscript(copy, 1);
buildnodeflexscript(copy);
setnodestr(replyNode, "<status>success</status><handler>" + newName + "</handler><from>" + tplName + "</from>");
return replyNode;
```

> 💡 装好后建议先自检：让 AI 调 `deploy_handler` 造一个最简单的 `ping`（`<pong>1</pong>`），能成功就说明这套自增长链路通了。
>
> ⚠️ 只装 4 个也能正常建模——`copy_handler` 只影响「现场部署新功能」这一类工具。

### 3. 启动 MCP 服务器

```bash
node server/mcp-server.cjs
```

不需要 `npm install`。可选环境变量：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `FSW_REGISTRY` | `./registry.json`（相对脚本） | 工具注册表路径 |
| `FLEXSIM_WS_BASE` | `http://localhost/webserver.dll` | WebServer 地址 |
| `FLEXSIM_WS_DIR` | `C:\Program Files (x86)\FlexSim Web Server\webserver` | `start_webserver` 使用的服务目录 |
| `FLEXSIM_NODE` | `C:\Program Files\nodejs\node.exe` | `start_webserver` 使用的 node 路径 |

### 4. 接入 AI 客户端

以 DeepSeek Harness（DSH）为例，在 `cordis.patch.yml` 增加一个 MCP 客户端插件条目：

```yaml
- insert:
    - id: mcp-flexsim
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: flexsim
        transport: stdio
        command: C:\Program Files\nodejs\node.exe
        args:
          - D:\path\to\flexsim-mcp\server\mcp-server.cjs
        toolCallTimeoutMs: 120000
```

Claude Desktop / Cursor 等其他客户端的 `mcpServers` 配置同理：

```json
{
  "mcpServers": {
    "flexsim": {
      "command": "node",
      "args": ["D:/path/to/flexsim-mcp/server/mcp-server.cjs"]
    }
  }
}
```

然后你就可以对 AI 说：“打开 ai 模型，创建一个 Source 叫 S1，一个 Queue 叫 Q1，把 S1 连到 Q1，跑 10 秒，告诉我 Q1 释放了多少个。”

## MCP 工具一览（23 个）

| 分类 | 工具 |
|---|---|
| 环境 | `webserver_status` `start_webserver` `get_guide` |
| 实例 / 模型 | `list_instances` `list_models` `open_model` `list_handlers` |
| 树与节点 | `list_tree` `get_node` `write_node` `add_node` `rename_node` |
| 对象操作 | `create_object` `connect_objects` `delete_object` `set_loc` |
| 运行控制 | `control`（run/stop/reset） `set_run_speed` `set_stop_time` `set_datetime` `get_run_state` |
| 插件 | `deploy_handler` `call_handler` |

## 文档

- [4 个基础 handler 详解（完整代码 + HTTP 调用示例 + 硬性规则）](docs/HANDLERS.md)

## 目录结构

```
flexsim-mcp/
├── server/
│   ├── mcp-server.cjs         # ★ MCP 服务器（stdio）— 唯一运行入口
│   └── registry.json          # ★ 工具注册表：工具定义 / guide / prompts / 部署模板
├── handlers/
│   └── queryhandlers.t        # ★ 4 个基础 handler 节点文件（FlexSim 模型导入用）
├── tests/
│   └── test-mcp-protocol.cjs  # 端到端 stdio 协议测试（不需要 FlexSim）
├── docs/
│   └── HANDLERS.md            # handler 详解、执行模型、FlexScript 函数存在性
├── AGENTS.md                  # 给 AI 编码助手的仓库指南
├── README.md                  # 中文文档（默认）
├── README.en.md               # English
├── LICENSE
└── .gitignore
```

## JSON-RPC 调用示例

服务器是标准 **JSON-RPC 2.0 over stdio**（每行一条消息，换行分隔）。下面每条都可以直接粘进 `stdin`。

**① 握手**（必须先做，之后才能调工具）
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0.0"}}}
```
响应里带 `capabilities`（tools / prompts）、`serverInfo`，以及 **`instructions`**（操作指南全文，建议读）。

**② 握手完成通知**（无 `id`，不需要响应）
```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

**③ 列工具**
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

**④ 调工具** —— 参数一律放在 `arguments` 里；`get_guide` 无参数：
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_guide","arguments":{}}}
```

**⑤ 建对象 → 摆位置 → 连线**
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_object","arguments":{"type":"Queue","name":"Q1"}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"set_loc","arguments":{"object":"Q1","x":5,"y":0,"z":0}}}
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"connect_objects","arguments":{"from":"Source1","to":"Q1","key":"A"}}}
```

**⑥ 读节点 / 写节点**
```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_node","arguments":{"path":"Q1"}}}
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"write_node","arguments":{"path":"Q1>variables/maxcontent","value":"10"}}}
```

**⑦ 运行控制**
```json
{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"control","arguments":{"action":"reset"}}}
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"control","arguments":{"action":"run"}}}
```

**⑧ 提示模板**（prompts 能力）
```json
{"jsonrpc":"2.0","id":11,"method":"prompts/list"}
{"jsonrpc":"2.0","id":12,"method":"prompts/get","params":{"name":"build_production_line","arguments":{"description":"一条 Source→Queue→Processor→Sink 的产线"}}}
```

> **错误约定**：工具执行失败走 `result.isError: true`（MCP 规范），**不是** JSON-RPC `error`。
> 只有协议层错误才用 `error`：`-32700` 解析失败 / `-32601` 方法不存在 / `-32602` 参数无效。

## 测试

```bash
# 协议端到端测试（起真实 stdio 客户端，不需要 FlexSim）
node tests/test-mcp-protocol.cjs

# 语法自检
node --check server/mcp-server.cjs
```

`test-mcp-protocol.cjs` 覆盖 10 组断言：握手与能力协商、`tools/list` 完整性、`tools/call` 成功与失败路径、错误码（`-32601`/`-32602`/`isError`）、`id` 回填、`prompts`、以及 **stdout 纪律**（确认 stdout 只有 JSON-RPC、日志全走 stderr）。

> ⚠️ 这个测试要 `child_process.spawn` + 管道。**受限沙箱会报 `spawn EPERM`，那不是测试失败。**

## 故障排查

**`list_handlers` 返回空 / 调用 handler 一律 404**
1. 模型里**没有装 handler** → 按「快速开始」第 2 步导入，注意节点类型必须是 **flexscript**
2. 装了但**没重启实例** → handler 只在实例启动时加载，WebServer 里关掉再重开
3. 装了但**没 Ctrl+S** → 重启后丢失
4. 路径写错 → handler 必须在 `Tools/serverinterface/queryhandlers/` 下

**`deploy_handler` 返回 404**
模型里缺 **`copy_handler`**（它不在 4 个基础 handler 里）。见「快速开始」第 2.5 节。

**`call_handler` 报 `object not found` / `node not found`**
- 传了裸对象名，但目标是模型树里的**深层节点** → 改用完整路径
- **删除 handler 必须给全路径**：`delete_object` 的 `value` 要写 `Tools/serverinterface/queryhandlers/<名字>`（裸名只在模型层找）

**handler 改完不生效**
handler 的执行体是**已编译代码**，改节点文本（`data`）**不会自动重编译**。新增/修改 handler 请用 `copy_handler`，它内部会调 `switch_flexscript` + `buildnodeflexscript`；改完记得 **Ctrl+S + 重启实例**。详见 [docs/HANDLERS.md](docs/HANDLERS.md)。

**取不到仿真时间 / handler 编译报错**
FlexScript 里**没有 `getmodeltime()`**（也没有 `savemodel` / `numtostr`）。取时间用 WebServer 内置 `getruntime`，或读节点 `Tools/ModelUnits/ModelDateTimes/currentTime/modelTime`。

**HTTP 200 但正文是 `HTTP/1.1 404 Not Found`**
WebServer 的已知怪行为：404/500 有时以「HTTP 200 + 正文状态行」返回。本服务器的 `get()` 已统一归一化，看到这种正文即表示真 404。

**端口 80 起不来**
`start_webserver` 需要管理员权限，会尝试提权（弹 UAC）。若仍失败，手动用管理员身份运行 WebServer 的 `flexsimserver.bat`。

**想跑任意 FlexScript（像 `evaluate` 那样）**
本架构**做不到**——WebServer 只放行「内置命令 + 已注册 handler + 实例管理」，实测 14 个 `evaluate` 类候选全部 404。需要该能力请用 FlexSimPy 通道（进程内加载 `flexsim.dll`，见同项目 `mcp_server/flexsim_mcp.py`）。

## License

[MIT](LICENSE)

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
3. 选中 `queryhandlers` 节点 → 右键 → **Paste / Import** → 选择 `handlers/queryhandlers.t`，把内容粘贴进去。
4. 确认该目录下出现 4 个节点：`template`、`create_object`、`connect_objects`、`delete_object`。
5. **Ctrl+S 保存模型**（必须保存，否则重启后丢失）。
6. **重新通过 WebServer 打开模型实例**：先停止 / 关闭当前实例，再重新打开（或重启 WebServer 服务）。**不重启实例，新 handler 不会被识别，调用会 404。**

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
├── docs/
│   └── HANDLERS.md            # handler 详解与硬性规则
├── README.md                  # 中文文档（默认）
├── README.en.md               # English
├── LICENSE
└── .gitignore
```

## License

[MIT](LICENSE)

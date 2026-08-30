# FlexSim MCP Server

> **English** | [中文](README.md)

An **MCP (Model Context Protocol)** server that lets AI assistants (DeepSeek Harness, Claude Desktop, Cursor, or any MCP client) control **FlexSim** simulation models through natural language: create objects, read/write model tree nodes, connect/delete objects, control the run, and even hot-deploy new model-side handlers.

```
AI Client  ←(stdio, JSON-RPC 2.0)→  mcp-server.cjs  ←(HTTP :80)→  FlexSim WebServer  ←→  model handlers
```

## Features

- **Pure stdio MCP server** — zero third-party dependencies, Node.js only
- **23 built-in tools** — instance management, model tree browsing, node read/write, object create/connect/delete, run control, handler deployment
- **Plugin architecture** — `deploy_handler` hot-deploys new capabilities into a running model (copyhandler primitive)
- **Ships with the 4 base handler nodes** (`handlers/queryhandlers.t`) — import into your model and start

## Quick Start

### 1. Prerequisites

- Node.js ≥ 18
- FlexSim with WebServer running (default `http://localhost/webserver.dll`, port 80)

### 2. Install the 4 base handlers into your model

Handlers live under `Tools/serverinterface/queryhandlers/` in the model tree. **WebServer only recognizes this fixed path, and only loads handlers when an instance starts**, so follow all steps:

1. Open your model (`.fsm`) in **FlexSim**.
2. In the model tree, create a child node `serverinterface` under `Tools` (skip if it exists); then create a child node `queryhandlers` under `serverinterface` (skip if it exists). Final path:
   ```
   Tools/serverinterface/queryhandlers
   ```
3. Select the `queryhandlers` node → right-click → **Paste / Import** → choose `handlers/queryhandlers.t`.
4. Verify the 4 nodes appear under `Tools/serverinterface/queryhandlers/`: `template`, `create_object`, `connect_objects`, `delete_object`.
5. **Ctrl+S to save the model** (mandatory — otherwise handlers are lost on reload).
6. **Re-open the model instance through WebServer**: stop/close the current instance and open it again (or restart the WebServer service). **Without restarting the instance, new handlers are not recognized and calls return 404.**

### 3. Start the MCP server

```bash
node server/mcp-server.cjs
```

No `npm install` needed. Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `FSW_REGISTRY` | `./registry.json` (relative to the script) | Tool registry path |
| `FLEXSIM_WS_BASE` | `http://localhost/webserver.dll` | WebServer base URL |
| `FLEXSIM_WS_DIR` | `C:\Program Files (x86)\FlexSim Web Server\webserver` | WebServer dir used by `start_webserver` |
| `FLEXSIM_NODE` | `C:\Program Files\nodejs\node.exe` | Node executable used by `start_webserver` |

### 4. Connect an AI client

Example for DeepSeek Harness (`cordis.patch.yml`):

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

For Claude Desktop / Cursor (`mcpServers`):

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

Then just tell the AI: *"Open model ai, create a Source named S1 and a Queue named Q1, connect S1 to Q1, run for 10 seconds, and tell me how many items Q1 released."*

## Tools (23)

| Category | Tools |
|---|---|
| Environment | `webserver_status` `start_webserver` `get_guide` |
| Instance / Model | `list_instances` `list_models` `open_model` `list_handlers` |
| Tree & Node | `list_tree` `get_node` `write_node` `add_node` `rename_node` |
| Object ops | `create_object` `connect_objects` `delete_object` `set_loc` |
| Run control | `control` (run/stop/reset) `set_run_speed` `set_stop_time` `set_datetime` `get_run_state` |
| Plugin | `deploy_handler` `call_handler` |

## Documentation

- [Handlers deep dive (Chinese) — code & HTTP examples for the 4 base handlers, plus hard rules](docs/HANDLERS.md)

## Project Layout

```
flexsim-mcp/
├── server/
│   ├── mcp-server.cjs         # ★ MCP server (stdio) — single entry point
│   └── registry.json          # ★ Tool registry: tool defs / guide / prompts / deploy templates
├── handlers/
│   └── queryhandlers.t        # ★ 4 base handler nodes (import into FlexSim model)
├── docs/
│   └── HANDLERS.md            # Handler deep dive & hard rules
├── README.md                  # 中文文档（默认）
├── README.en.md               # English
├── LICENSE
└── .gitignore
```

## License

[MIT](LICENSE)

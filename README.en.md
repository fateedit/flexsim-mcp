# FlexSim MCP Server

> **English** | [中文](README.md)

An **MCP (Model Context Protocol)** server that lets AI assistants (DeepSeek Harness, Claude Desktop, Cursor, or any MCP client) control **FlexSim** simulation models through natural language: create objects, read/write model tree nodes, connect/delete objects, control the run, and even hot-deploy new model-side handlers.

```
AI Client  ←(stdio, JSON-RPC 2.0)→  mcp-server.cjs  ←(HTTP :80)→  FlexSim WebServer  ←→  model handlers
```

## Features

- **Pure stdio MCP server** — zero third-party dependencies, Node.js only
- **25 built-in tools** — instance management, target locking, model tree browsing, node read/write, object create/connect/delete, run control, handler deployment
- **Plugin architecture** — `deploy_handler` hot-deploys new capabilities into a running model (copyhandler primitive)
- **Ships with 4 self-growing handler nodes** (`template`, `copy_handler`, `set_code`, and `delete_object`) so the AI can create, modify, and remove capabilities dynamically

## Quick Start

### 1. Prerequisites

- Node.js ≥ 18
- FlexSim with WebServer running (default `http://localhost/webserver.dll`, port 80)

### 2. Install the 4 self-growing handlers into your model

Handlers live under `Tools/serverinterface/queryhandlers/` in the model tree. **WebServer only recognizes this fixed path, and only loads handlers when an instance starts**, so follow all steps:

1. Open your model (`.fsm`) in **FlexSim**.
2. In the model tree, create a child node `serverinterface` under `Tools` (skip if it exists); then create a child node `queryhandlers` under `serverinterface` (skip if it exists). Final path:
   ```
   Tools/serverinterface/queryhandlers
   ```
3. Import `handlers/queryhandlers.t`, **either way**:
   - **Option 1 (import as children)**: select the `queryhandlers` node → right-click → **Paste / Import** → choose `handlers/queryhandlers.t` to paste the 4 handlers in as child nodes.
   - **Option 2 (overwrite whole node)**: create a new child node under `Tools` → right-click → **Paste / Import** → choose `handlers/queryhandlers.t` to **overwrite** that node (the file is the complete `queryhandlers` node; after overwrite it becomes `queryhandlers` containing the 4 handlers). If needed, rename the node to `queryhandlers` and move it under `Tools/serverinterface/`.

> 💡 **Recommended: import/overwrite with the file** (beginner-friendly, avoids type pitfalls): `queryhandlers.t` already carries the correct node types and structure. If you hand-create nodes instead, **you must set the node type to flexscript**, otherwise the handler code won't compile.

4. Verify the 4 nodes appear under `Tools/serverinterface/queryhandlers/`: `template`, `copy_handler`, `set_code`, `delete_object`.
5. **Ctrl+S to save the model** (mandatory — otherwise handlers are lost on reload).
6. **Re-open the model instance through WebServer**: stop/close the current instance and open it again (or restart the WebServer service). **Without restarting the instance, new handlers are not recognized and calls return 404.**

### 2.5 Verify the self-growing chain

The new `queryhandlers.t` includes both `copy_handler` and `set_code`; no extra manual handler installation is required:

- `template`: writes existing model-tree nodes
- `copy_handler`: copies a template, writes source, and compiles a new handler
- `set_code`: modifies and recompiles an existing handler in place
- `delete_object`: removes objects, nodes, or obsolete handlers

As a smoke test, ask the AI to `deploy_handler` a trivial `ping` returning `<pong>1</pong>`, then modify and delete it. If all three operations work, the self-growing chain is ready.

### 3. Start the MCP server

```bash
node server/mcp-server.cjs
```

No `npm install` needed (zero dependencies). You can also run `npm i -g .` and start it with the `flexsim-mcp` command. Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `FSW_REGISTRY` | `./registry.json` (relative to the script) | Tool registry path |
| `FLEXSIM_WS_BASE` | `http://localhost/webserver.dll` | WebServer base URL |
| `FLEXSIM_MODEL` | unset | Model to lock at startup (for example `MyModel`) |
| `FLEXSIM_INSTANCE` | `1` | Instance number paired with `FLEXSIM_MODEL` |
| `FLEXSIM_WS_DIR` | unset (required by `start_webserver`) | WebServer service dir (contains `index.js`) |
| `FLEXSIM_NODE` | current node process | Node executable used by `start_webserver` |

When multiple model instances are online, the server no longer picks the first one implicitly. Call `select_target` first, or set `FLEXSIM_MODEL=MyModel` and `FLEXSIM_INSTANCE=1` in the MCP client environment.

### 4. Connect an AI client

Example for DeepSeek Harness (`cordis.patch.yml`):

```yaml
- insert:
    - id: mcp-flexsim
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: flexsim
        transport: stdio
        command: node
        args:
          - <repo>/server/mcp-server.cjs
        toolCallTimeoutMs: 120000
```

For Claude Desktop / Cursor (`mcpServers`):

```json
{
  "mcpServers": {
    "flexsim": {
      "command": "node",
      "args": ["<repo>/server/mcp-server.cjs"]
    }
  }
}
```

Then just tell the AI: *"Open model ai, create a Source named S1 and a Queue named Q1, connect S1 to Q1, run for 10 seconds, and tell me how many items Q1 released."*

## Tools (25)

| Category | Tools |
|---|---|
| Environment | `webserver_status` `start_webserver` `get_guide` |
| Instance / Model | `list_instances` `get_target` `select_target` `list_models` `open_model` `list_handlers` |
| Tree & Node | `list_tree` `get_node` `write_node` `add_node` `rename_node` |
| Object ops | `create_object` `connect_objects` `delete_object` `set_loc` |
| Run control | `control` (run/stop/reset) `set_run_speed` `set_stop_time` `set_datetime` `get_run_state` |
| Plugin | `deploy_handler` `call_handler` |

## Documentation

- [Self-growing handlers deep dive (Chinese) — responsibilities, HTTP examples, and hard rules](docs/HANDLERS.md)

## Project Layout

```
flexsim-mcp/
├── server/
│   ├── mcp-server.cjs         # ★ MCP server (stdio) — single entry point
│   └── registry.json          # ★ Tool registry: tool defs / guide / prompts / deploy templates
├── handlers/
│   └── queryhandlers.t        # ★ 4 self-growing handler nodes (import into FlexSim model)
├── tests/
│   └── test-mcp-protocol.cjs  # End-to-end stdio protocol test (no FlexSim needed)
├── docs/
│   └── HANDLERS.md            # Handler deep dive, execution model, FlexScript findings
├── AGENTS.md                  # Repository guide for AI coding agents
├── README.md                  # 中文文档（默认）
├── README.en.md               # English
├── LICENSE
└── .gitignore
```

## JSON-RPC examples

The server speaks standard **JSON-RPC 2.0 over stdio** (one message per line). Every line below can be pasted into `stdin`.

**① Handshake** (required before any tool call)
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-client","version":"1.0.0"}}}
```
The response carries `capabilities` (tools / prompts), `serverInfo`, and **`instructions`** (the full operating guide — worth reading).

**② Initialized notification** (no `id`, no response expected)
```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

**③ List tools**
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

**④ Call a tool** — arguments always go inside `arguments`; `get_guide` takes none:
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_guide","arguments":{}}}
```

**⑤ Create → place → connect**
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"create_object","arguments":{"type":"Queue","name":"Q1"}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"set_loc","arguments":{"object":"Q1","x":5,"y":0,"z":0}}}
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"connect_objects","arguments":{"from":"Source1","to":"Q1","key":"A"}}}
```

**⑥ Read / write a node**
```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_node","arguments":{"path":"Q1"}}}
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"write_node","arguments":{"path":"Q1>variables/maxcontent","value":"10"}}}
```

**⑦ Run control**
```json
{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"control","arguments":{"action":"reset"}}}
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"control","arguments":{"action":"run"}}}
```

**⑧ Prompt templates**
```json
{"jsonrpc":"2.0","id":11,"method":"prompts/list"}
{"jsonrpc":"2.0","id":12,"method":"prompts/get","params":{"name":"build_production_line","arguments":{"description":"a Source→Queue→Processor→Sink line"}}}
```

> **Error convention**: tool failures use `result.isError: true` (MCP spec), **not** a JSON-RPC `error`.
> Only protocol-level failures use `error`: `-32700` parse error / `-32601` method not found / `-32602` invalid params.

## Tests

```bash
# End-to-end protocol test (spawns a real stdio client; no FlexSim required)
node tests/test-mcp-protocol.cjs

# Syntax self-check
node --check server/mcp-server.cjs
```

`test-mcp-protocol.cjs` covers 10 groups: handshake and capability negotiation, `tools/list` completeness, `tools/call` success and failure paths, error codes (`-32601` / `-32602` / `isError`), `id` echo, `prompts`, and **stdout discipline** (asserts stdout carries JSON-RPC only while logs go to stderr).

> ⚠️ This test needs `child_process.spawn` with pipes. **A restricted sandbox will report `spawn EPERM` — that is not a test failure.**

## Troubleshooting

**`list_handlers` returns nothing / every handler call is 404**
1. No handlers installed in the model → import per Quickstart step 2; node type **must be flexscript**
2. Installed but the instance was **not restarted** → handlers load only at instance start; close and reopen it from WebServer
3. Installed but **not Ctrl+S'd** → lost on restart
4. Wrong location → handlers must sit under `Tools/serverinterface/queryhandlers/`

**`deploy_handler` returns 404**
The model did not load the new **`copy_handler`** correctly. Re-import `handlers/queryhandlers.t`, save the model, and restart the WebServer instance; see Quick Start step 2.

**`call_handler` reports `object not found` / `node not found`**
- You passed a bare object name but the target is a deep tree node → use the full path
- **Deleting a handler requires the full path**: `delete_object`'s `value` must be `Tools/serverinterface/queryhandlers/<name>` (a bare name is only resolved at model level)

**Handler edits don't take effect**
A handler's executing body is **compiled code**; editing the node text (`data`) does **not** recompile it. Use `copy_handler` to create handlers and `set_code` to modify them; both invoke `switch_flexscript` + `buildnodeflexscript`. Then **Ctrl+S + restart the instance**. See [docs/HANDLERS.md](docs/HANDLERS.md).

**Cannot read simulation time / handler fails to compile**
FlexScript has **no `getmodeltime()`** (nor `savemodel` / `numtostr`). Use the built-in `getruntime`, or read the node `Tools/ModelUnits/ModelDateTimes/currentTime/modelTime`.

**HTTP 200 with body `HTTP/1.1 404 Not Found`**
A known WebServer quirk: 404/500 sometimes come back as "HTTP 200 + status line in the body". This server's `get()` normalizes it — such a body means a genuine 404.

**Port 80 won't start**
`start_webserver` needs administrator rights and will try to elevate (UAC prompt). If it still fails, run the WebServer's `flexsimserver.bat` as administrator.

**I want to run arbitrary FlexScript (like `evaluate`)**
Not possible in this architecture — WebServer only admits built-in commands, registered handler names, and instance management; 14 evaluate-style candidates all returned 404 in testing. For that capability use the FlexSimPy channel instead (loads `flexsim.dll` in-process; see `mcp_server/flexsim_mcp.py` in the same project).

## License

[MIT](LICENSE)

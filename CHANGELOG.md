# Changelog

本项目的重要变更记录。日期格式 `YYYY-MM-DD`。

## 1.0.1 — 2026-10-24

### 变更

- **源码与文档不再写死任何具体安装路径**：`FLEXSIM_WS_DIR` 默认改为空、`FLEXSIM_NODE` 默认使用当前 node 进程（`process.execPath`），README / 文档示例统一用 `<repo>` 占位符
- `start_webserver` 在未设置 `FLEXSIM_WS_DIR` 时返回明确的可执行提示，不再猜测安装位置

### 迁移

- 原先依赖默认安装目录直接调 `start_webserver` 的使用者，需要显式设置 `FLEXSIM_WS_DIR`（指向含 `index.js` 的 WebServer 目录）

## 1.0.0 — 2026-10-24

首个公开发布版本。为公开发布做过一次整理：压缩开发历史为单次发布提交，移除开发期的本机绝对路径、个人信息与内部模型名示例。

### 新增

- `server/mcp-server.cjs`：stdio MCP 服务器，**零第三方依赖**，Node.js ≥ 18
- `server/registry.json`：单一事实源，25 个工具定义 + 操作指南（guide）+ 3 个 prompt 模板 + 功能目录（catalog）
- 25 个工具：环境自检与自愈（`webserver_status` / `start_webserver`）、实例与目标锁定（`list_instances` / `get_target` / `select_target`）、模型树读写（`get_node` / `write_node` / `list_tree` / `add_node` / `rename_node`）、对象操作（`create_object` / `connect_objects` / `delete_object` / `set_loc`）、运行控制（`control` / `set_run_speed` / `set_stop_time` / `set_datetime` / `get_run_state`）、插件部署（`deploy_handler` / `call_handler`）
- `handlers/queryhandlers.t`：4 个可自增长的基础 handler（`template` / `copy_handler` / `set_code` / `delete_object`）
- `tests/test-mcp-protocol.cjs`：端到端 stdio 协议测试，不需要 FlexSim 即可运行
- `docs/HANDLERS.md`：handler 执行模型、调用格式与 FlexScript 函数存在性实测

### 行为约定

- 工具执行失败走 `result.isError: true`，只有协议层错误才用 JSON-RPC `error`
- `stdout` 只输出 JSON-RPC，日志一律走 `stderr`
- `tools/call` 串行执行，保证响应顺序
- 多个模型实例在线时**不再隐式选择第一个**，必须先 `select_target` 或设置 `FLEXSIM_MODEL` / `FLEXSIM_INSTANCE`

### 已知限制

- 仅支持 stdio 传输；streamable HTTP 尚未实现
- WebServer 只放行「内置命令 + 已注册 handler + 实例管理」，**不能执行任意 FlexScript**；需要该能力请改用 FlexSimPy 进程内通道
- 新增 handler 只能通过 `copy_handler` 复制生成，4 个基础 handler 无法自增长出第 5 个

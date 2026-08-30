# FlexSim MCP Server — AI 远程建模工具箱

基于 **FlexSim WebServer** 的 **MCP（Model Context Protocol）** 服务器。让 AI 助手（DeepSeek Harness / Claude / Cursor 等任何支持 MCP 的客户端）通过自然语言直接操控 FlexSim 仿真模型：创建对象、读写模型树节点、连接 / 删除对象、运行控制、甚至给模型热部署新功能。

```
AI 客户端  ←(stdio, JSON-RPC 2.0)→  mcp-server.cjs  ←(HTTP :80)→  FlexSim WebServer  ←→  模型内的自定义 handler
```

## 特性

- **纯 stdio MCP 服务器**，无需额外网络端口，本地即用
- **23 个内置工具**：实例管理、模型树浏览、节点读写、创建 / 连接 / 删除对象、运行控制、部署自定义 handler 等
- **插件架构**：`deploy_handler` 可给运行中的模型热部署任意新功能（copyhandler 增殖原语）
- **自带 4 个最基础 handler 节点文件**（`handlers/queryhandlers.t`），导入模型即可用

## 快速开始

### 1. 准备 FlexSim WebServer

FlexSim 自带 WebServer（`webserver.dll`，端口 80）。确保它已启动且可访问：

```
http://localhost/webserver.dll
```

> 若未启动：FlexSim 安装目录下找到 WebServer 服务启动方式（或通过 `start_webserver` 工具自动拉起，失败时需管理员权限）。

### 2. 给模型安装 4 个基础 handler（手动安装）

handler 是模型树 `Tools/serverinterface/queryhandlers/` 下的功能节点，WebServer 通过它们向模型下达命令。**WebServer 只认这个固定路径**，且只在启动实例时加载 handler，因此安装步骤必须完整执行：

1. 用 **FlexSim** 打开你的模型（.fsm）。
2. 在模型树 `Tools` 节点下**新建子节点 `serverinterface`**（若已存在则跳过）；再在 `serverinterface` 下**新建子节点 `queryhandlers`**（若已存在则跳过）。最终路径为：
   ```
   Tools/serverinterface/queryhandlers
   ```
3. 选中 `queryhandlers` 节点，右键 → **Paste / Import**，选择本仓库的 `handlers/queryhandlers.t`，把内容粘贴进去。
4. 确认 `Tools/serverinterface/queryhandlers/` 下出现 4 个节点：`template`、`create_object`、`connect_objects`、`delete_object`。
5. **Ctrl+S 保存模型**（必须保存，否则重启后丢失）。
6. **重新通过 WebServer 打开模型实例**：先停止 / 关闭当前实例，再重新打开（或重启 WebServer 服务）。WebServer 在实例启动时才扫描加载 `queryhandlers`，**不重启实例，新 handler 不会被识别**，调用会 404。

安装后的 4 个 handler：

| handler | 作用 | 参数 |
|---|---|---|
| `template` | 读写模型树节点值 | `value`=节点路径，`action`=新值 |
| `create_object` | 从库创建对象 | `value`=库类名，`name`=对象名 |
| `connect_objects` | 连接两个对象 | `value`=源对象，`to`=目标对象，`key`=A/S |
| `delete_object` | 删除对象 / 节点 | `value`=对象名或路径 |

> 改完模型记得在 FlexSim 界面 **Ctrl+S** 保存，否则重载后 handler 会丢失。

### 3. 启动 MCP 服务器

```bash
npm install        # 或直接运行，本服务器无第三方运行时依赖
node electron/mcp-server.cjs
```

服务器在 stdio 上按 MCP 协议与客户端通信（newline-delimited JSON-RPC 2.0）。

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
          - D:\path\to\electron-app\electron\mcp-server.cjs
        toolCallTimeoutMs: 120000
```

其他客户端（Claude Desktop、Cursor 等）的 `mcpServers` 配置同理：

```json
{
  "mcpServers": {
    "flexsim": {
      "command": "node",
      "args": ["D:/path/to/electron-app/electron/mcp-server.cjs"]
    }
  }
}
```

然后你就可以对 AI 说：“打开 ai 模型，创建一个 Source 叫 S1，一个 Queue 叫 Q1，把 S1 连到 Q1，跑 10 秒，告诉我 Q1 释放了多少个。”

## 4 个基础 handler 详解

所有 handler 均为**参数无关**设计：业务参数统一走通用名（`GET/value`、`GET/action`、`GET/name`、`GET/key`、`GET/to`、`GET/msg`），**不读取 handler 自身名字的参数**——所以可以复制改名复用而不用改代码。调用格式（HTTP GET）：

```
http://localhost/webserver.dll?queryinstance={模型名}&instancenum={实例号}&{handler名}=&value=...&action=...
```

### 1. template — 读写节点值

```
/webserver.dll?queryinstance=ai&instancenum=1&template=&value=Q1>variables/cycletime&action=5
```

```flexscript
/** 参数无关版：GET/value=节点路径 & GET/action=新值 */
treenode replyNode = param(1);
treenode parsedRequestNode = param(2);

treenode pn = node("GET/value", parsedRequestNode);
treenode an = node("GET/action", parsedRequestNode);
if (!pn || !an)
{
	setnodestr(replyNode, "<status>error</status><reason>missing value or action</reason>");
	return replyNode;
}

string nodePath = gets(pn);
string newValue = gets(an);
treenode datanode = node(nodePath, model());
if (!objectexists(datanode))
{
	setnodestr(replyNode, "<status>error</status><reason>node not found</reason>");
	return replyNode;
}

if (getdatatype(datanode) == DATATYPE_NUMBER)
	setnodenum(datanode, stringtonum(newValue));
else
	setnodestr(datanode, newValue);

setnodestr(replyNode, "<status>success</status><value>" + newValue + "</value>");
return replyNode;
```

### 2. create_object — 从库创建对象

```
/webserver.dll?queryinstance=ai&instancenum=1&create_object=&value=Queue&name=Q1
```

```flexscript
/** create_object - 创建对象（参数无关：value=类型, name=对象名） */
treenode replyNode = param(1);
treenode parsedRequestNode = param(2);
treenode vn = node("GET/value", parsedRequestNode);
treenode nn = node("GET/name", parsedRequestNode);
if (!vn || !nn) { setnodestr(replyNode, "<status>error</status><reason>missing value or name</reason>"); return replyNode; }
string objType = gets(vn);
string objName = gets(nn);
treenode libObj = library().find("?" + objType);
if (!objectexists(libObj)) { setnodestr(replyNode, "<status>error</status><reason>type not found in library: " + objType + "</reason>"); return replyNode; }
treenode newObj = createinstance(libObj, model());
if (!objectexists(newObj)) { setnodestr(replyNode, "<status>error</status><reason>create failed</reason>"); return replyNode; }
setnodename(newObj, objName);
setnodestr(replyNode, "<status>success</status><object>" + objName + "</object><type>" + objType + "</type>");
return replyNode;
```

### 3. connect_objects — 连接对象

```
/webserver.dll?queryinstance=ai&instancenum=1&connect_objects=&value=Source1&to=Q1&key=A
```

```flexscript
/** connect_objects - 连接对象（参数无关：value=源, to=目标, key=A/S） */
treenode replyNode = param(1);
treenode parsedRequestNode = param(2);
treenode vn = node("GET/value", parsedRequestNode);
treenode tn = node("GET/to", parsedRequestNode);
if (!vn || !tn) { setnodestr(replyNode, "<status>error</status><reason>missing value or to</reason>"); return replyNode; }
string srcName = gets(vn);
string dstName = gets(tn);
treenode srcObj = node(srcName, model());
treenode dstObj = node(dstName, model());
if (!objectexists(srcObj) || !objectexists(dstObj)) { setnodestr(replyNode, "<status>error</status><reason>object not found</reason>"); return replyNode; }
string keyChar = "A";
treenode kn = node("GET/key", parsedRequestNode);
if (kn && stringlen(gets(kn)) > 0) keyChar = gets(kn);
contextdragconnection(srcObj, dstObj, keyChar);
setnodestr(replyNode, "<status>success</status><from>" + srcName + "</from><to>" + dstName + "</to><key>" + keyChar + "</key>");
return replyNode;
```

### 4. delete_object — 删除对象 / 节点

```
/webserver.dll?queryinstance=ai&instancenum=1&delete_object=&value=Q1
```

```flexscript
/** delete_object - 删除对象/节点（参数无关：value=对象名；异步 3~8 秒生效） */
treenode replyNode = param(1);
treenode parsedRequestNode = param(2);
treenode vn = node("GET/value", parsedRequestNode);
if (!vn) { setnodestr(replyNode, "<status>error</status><reason>missing value</reason>"); return replyNode; }
string objName = gets(vn);
treenode obj = node(objName, model());
if (!objectexists(obj)) { setnodestr(replyNode, "<status>error</status><reason>object not found: " + objName + "</reason>"); return replyNode; }
destroyobject(obj);
if (objectexists(obj)) obj.destroy();
if (objectexists(obj)) setnodestr(replyNode, "<status>error</status><reason>delete failed: " + objName + "</reason>");
else setnodestr(replyNode, "<status>success</status><deleted>" + objName + "</deleted>");
return replyNode;
```

## MCP 工具一览（23 个）

| 分类 | 工具 |
|---|---|
| 环境 | `webserver_status` `start_webserver` `get_guide` |
| 实例 / 模型 | `list_instances` `list_models` `open_model` `list_handlers` |
| 树与节点 | `list_tree` `get_node` `write_node` `add_node` `rename_node` |
| 对象操作 | `create_object` `connect_objects` `delete_object` `set_loc` |
| 运行控制 | `control`（run/stop/reset） `set_run_speed` `set_stop_time` `set_datetime` `get_run_state` |
| 插件 | `deploy_handler` `call_handler` |

## 硬性规则（踩坑总结）

1. **参数无关**：调 handler 时业务参数一律用通用名 `value` / `action` / `name` / `msg`，绝不依赖 handler 自身名字的参数。
2. **删除是异步的**（3~8 秒生效）：`delete_object` 后不能立即验证，应稍后重试看是否返回 not found。
3. **远程操作不持久**：只改运行实例内存；部署 / 修改后要提醒用户在 FlexSim 界面 Ctrl+S 保存。
4. **路径大小写敏感**；中文 / 空格由执行器自动编码，路径本身要写对。
5. **复合节点（数组）不能直接写**，必须写其叶子子节点。
6. **修改时间类节点后通常需要 reset** 才生效。
7. **模型树根路径用 `MODEL:`**（带冒号），空字符串会 404。
8. **handler 代码里不能用 `getmodeltime()`**（实测未定义，编译报错）；取仿真时间用 WebServer 内置 `getruntime` 或读 `Tools/ModelUnits/ModelDateTimes/currentTime/modelTime`。

## 目录结构

```
electron-app/
├── electron/
│   ├── mcp-server.cjs     # ★ MCP 服务器（stdio）：23 个工具执行器
│   ├── main.cjs           # Electron 主进程（可选：桌面壳）
│   └── test-mcp-protocol.cjs  # 协议自测
├── src/shared/registry.json   # ★ 单一事实来源：工具定义 / guide / prompts / 目录模板
├── handlers/queryhandlers.t   # ★ 4 个基础 handler 节点文件（FlexSim 导入用）
├── docs/                  # 部署日志等文档
└── package.json
```

## License

[MIT](LICENSE)

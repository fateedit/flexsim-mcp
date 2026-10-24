# 4 个自增 handler 详解

`handlers/queryhandlers.t` 是可直接导入 FlexSim 模型的完整 `queryhandlers` 节点，包含四个最小自增原语：

| handler | 作用 | 核心参数 |
|---|---|---|
| `template` | 写现有模型树节点 | `value=节点路径`，`action=新值` |
| `copy_handler` | 复制模板、写入源码并编译新 handler | `value=源模板名`，`name=新名`，`code=源码` |
| `set_code` | 原地修改并重新编译已有 handler | `value=handler名`，`action=源码` |
| `delete_object` | 删除对象、节点或 handler | `value=模型树路径` |

四个节点位于固定路径 `Tools/serverinterface/queryhandlers/`。WebServer 只在实例启动时注册 handler，因此导入后必须 **Ctrl+S 保存模型并重启实例**。

## 为什么是这四个

这不是四个固定业务功能，而是一套可扩展的“元操作”：

1. `template` 修改已有配置。
2. `copy_handler` 生成并编译新能力。
3. `set_code` 迭代已有能力。
4. `delete_object` 清理错误或过期能力。

创建对象、连接对象、实验参数设置和结果提取等功能，应由 MCP 根据任务需要部署为专用 handler，而不再固化在基础包里。

## 调用格式

```text
http://localhost/webserver.dll?queryinstance={模型名}&instancenum={实例号}&{handler名}=&value=...&action=...
```

### 1. template — 写节点

```text
/webserver.dll?queryinstance=MyModel&instancenum=1&template=&value=Q1>variables/cycletime&action=5
```

数字节点使用 `setnodenum`，其他节点使用 `setnodestr`。目标必须已经存在，复合节点应写具体叶子节点。

### 2. copy_handler — 创建 handler

```text
/webserver.dll?queryinstance=MyModel&instancenum=1&copy_handler=&value=template&name=ping&code={URL编码后的FlexScript}
```

它依次执行 `createcopy`、`setnodename`、`setnodestr`、`switch_flexscript` 和 `buildnodeflexscript`。MCP 工具 `deploy_handler` 封装了这次调用。

### 3. set_code — 修改 handler

```text
/webserver.dll?queryinstance=MyModel&instancenum=1&set_code=&value=ping&action={URL编码后的新FlexScript}
```

它修改目标 handler 的源码并立即重新编译，适合自动测试后的迭代修复。参数 `value` 使用 handler 裸名，不要传完整路径。

### 4. delete_object — 删除节点

```text
/webserver.dll?queryinstance=MyModel&instancenum=1&delete_object=&value=Tools/serverinterface/queryhandlers/ping
```

删除 handler 时必须传相对模型根的完整路径。删除可能异步生效，建议等待数秒后再验证。

## 推荐的自动实验闭环

```text
实验假设 → 设计实验 → deploy_handler 创建专用能力 → 执行仿真
    ↑                                                   ↓
删除废案 ← delete_object ← set_code 修正代码 ← 读取结果并判断
```

一个稳妥的首次自检流程是：

1. 用 `deploy_handler` 从 `template` 复制出 `ping`，返回 `<pong>1</pong>`。
2. 调用 `ping`，确认 WebServer 能执行它。
3. 用 `set_code` 把返回值改为 `<pong>2</pong>`，再次调用验证。
4. 用 `delete_object` 删除 `Tools/serverinterface/queryhandlers/ping`。

## handler 执行模型

handler 真正执行的是已编译代码；节点中的 `data` 只是源码副本。只调用 `setnodestr` 不会更新执行体，新增或修改后必须执行：

```flexscript
switch_flexscript(handler, 1);
buildnodeflexscript(handler);
```

新版基础包中的 `copy_handler` 和 `set_code` 都已完成这一步。

## 硬性规则

1. 业务参数使用通用名 `value`、`action`、`name`、`code`、`key`、`to`、`msg`，不要依赖 handler 自身名字作为参数名。
2. 远程修改首先作用于运行实例内存；需要保留时在 FlexSim 中 **Ctrl+S**。
3. 新 handler 的注册通常需要重启 WebServer 实例；已注册 handler 经 `set_code` 重编译后可直接复测。
4. 路径大小写敏感，复合节点不能直接写，必须定位到叶子节点。
5. 删除 handler 使用完整路径；`copy_handler` 和 `set_code` 使用 handler 裸名。
6. handler 编译失败时 WebServer 可能只返回空的 `200 OK`，自动化流程应把“空响应”视为编译或运行失败并保留源码用于诊断。
7. 不要在 handler 中使用实测不存在的 `getmodeltime()`；仿真时间通过 WebServer 的 `getruntime` 或模型树时间节点获取。

# 4 个基础 handler 详解

handler 是模型树 `Tools/serverinterface/queryhandlers/` 下的功能节点，WebServer 通过它们向模型下达命令。**这个路径是固定的，且只在实例启动时加载 handler** —— 新增 / 修改 handler 后必须重启实例（或重新打开模型）才生效。

所有 handler 均为**参数无关**设计：业务参数统一走通用名（`GET/value`、`GET/action`、`GET/name`、`GET/key`、`GET/to`、`GET/msg`），**不读取 handler 自身名字的参数**——所以可以复制改名复用而不用改代码。

调用格式（HTTP GET）：

```
http://localhost/webserver.dll?queryinstance={模型名}&instancenum={实例号}&{handler名}=&value=...&action=...
```

---

## 1. template — 读写节点值

读 / 写任意模型树叶子节点的值（数字自动转 `setnodenum`，其余走 `setnodestr`）。

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

---

## 2. create_object — 从库创建对象

从 FlexSim 对象库创建对象到模型，自动命名。

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

---

## 3. connect_objects — 连接对象

`contextdragconnection` 语义：`key=A` 建输入输出连接（输出→输入），`key=S` 建共享连接。

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

---

## 4. delete_object — 删除对象 / 节点

按对象名或树路径删除。**注意：删除是异步的（3~8 秒生效）**，删除后不能立即验证，应稍后重试看是否返回 not found。

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

---

## 设置对象位置（重要）

`create_object` 创建的对象**默认堆叠在原点 (0,0,0)**，多个对象会完全重叠、无法观看。创建后必须设置坐标排布，例如产线对象按 x=0,5,10,15 一字排开（y/z 保持 0）。

MCP 工具 `set_loc` 已内置此能力（通过 template 写 `对象名>spatial/1`、`spatial/2`、`spatial/3`，即 x/y/z），**不依赖模型侧额外 handler**，只装 4 个基础 handler 即可用。手动调用等价于：

```
/webserver.dll?queryinstance=ai&instancenum=1&template=&value=Queue1>spatial/1&action=5
```

`spatial/1` = X 坐标，`spatial/2` = Y 坐标，`spatial/3` = Z 坐标（叶子节点，可写）。

---

## handler 的执行模型（理解这点才能加新 handler）

**handler 的执行体是「已编译的代码」，节点里的文本（`data`）只是源码副本。**

由此推出两条硬约束：

1. **改 `data` 不会重编译。** 往 handler 节点写文本（例如用 `template` 写）之后调用它，跑的还是**旧代码**。
2. **重编译必须由 handler 内部发起**，三步：

```flexscript
setnodestr(节点, 新代码);      // 写源码
switch_flexscript(节点, 1);    // 设为 flexscript 类型
buildnodeflexscript(节点);     // 编译
```

**结论：新增 handler 只能通过 `copy_handler`（复制节点 + 写代码 + 编译）。** 4 个基础 handler 里没有任何一个能调 `buildnodeflexscript`，所以**它们无法自增长出第 5 个** —— 想用 `deploy_handler`，必须先手工把 `copy_handler` 装一次（装法见 README「2.5」）。

### 命令执行入口很窄

调用一个 handler 时，WebServer 只放行三类参数：

| 类别 | 例子 |
|---|---|
| WebServer 内置命令 | `treelayer` `getnodedata` `getrunstate` `getruntime` `run` `stop` `reset` `step` `setstoptime` `setrunspeed` `screenshot` |
| 已注册的 handler 名 | `template` `create_object` `connect_objects` `delete_object` |
| 实例管理 | `instancelist` `createinstance` `terminateinstance` `availablemodels` |

其余一律 **404**。所以 `buildnodeflexscript` / `switch_flexscript` / `currentfile` / `cmdsaveas` 这类命令**不能直接从 HTTP query 调用**，只能在 handler 代码内部使用。

---

## FlexScript 函数存在性（实测，2026-09）

handler 编译失败时 WebServer **不报错**，只回一个空的 `HTTP/1.1 200 OK`。所以"函数是否存在"要用**编译探针**判断——写一个编译得通但永不执行的调用：

```flexscript
treenode replyNode = param(1);
if (1 == 2) { 待测函数(); }        // 永不执行，但必须编译通过
setnodestr(replyNode, "<status>success</status><sym>待测函数</sym>");
return replyNode;
```

- 返回 `<sym>...</sym>` → 函数**存在**
- 返回空 → 函数**不存在**（未定义命令）

实测结果：

| 函数 | 存在 | 说明 |
|---|---|---|
| `savebyname(node, str)` | ✅ | 保存任意子树到文件 |
| `cmdsavetree(node, str)` | ✅ | 同上，按名字 |
| `cmdsaveas()` | ✅ | **会弹 SaveAs 对话框**，远程/无头场景不要用 |
| `currentfile()` | ✅ | 返回当前模型路径 |
| `numtostring(num, int, int)` | ✅ | 三参数形式 |
| `fileexists(str)` · `backupfile(str)` | ✅ | |
| `savemodel` | ❌ | **不存在**（FlexScript / Module SDK / FlexSimPy 三层均无） |
| `savemodelprepare` | ❌ | 命令手册里有，**运行时没有** |
| `getmodeltime` | ❌ | **不存在**（见硬性规则第 8 条） |
| `numtostr` | ❌ | 少一个字母，正确的是 `numtostring` |

> ⚠️ **命令手册（`help/CommandReference/Commands.xml`）比运行时多**，不能只信手册；DLL 里的字符串也比运行时多。**只有编译探针是准的。**

**关于"保存模型"**：FlexSim 未开放程序化整模型保存的 API。可行替代是把整棵模型树当节点存出去——`savebyname(model(), "路径.t")`，回灌用 `cmdloadtree(model(), "路径.t", 0)`。产物是 `.t` 树文件（模型内容），不含视图/工程外壳，**无法替代 Ctrl+S**。

---

## 硬性规则（踩坑总结）

1. **参数无关**：调 handler 时业务参数一律用通用名 `value` / `action` / `name` / `msg`，绝不依赖 handler 自身名字的参数。
2. **删除是异步的**（3~8 秒生效）：`delete_object` 后不能立即验证，应稍后重试看是否返回 not found。
3. **远程操作不持久**：只改运行实例内存；部署 / 修改后要提醒用户在 FlexSim 界面 Ctrl+S 保存。
4. **路径大小写敏感**；中文 / 空格由执行器自动编码，路径本身要写对。
5. **复合节点（数组）不能直接写**，必须写其叶子子节点。
6. **修改时间类节点后通常需要 reset** 才生效。
7. **模型树根路径用 `MODEL:`**（带冒号），空字符串会 404。
8. **handler 代码里不能用 `getmodeltime()`**（实测未定义，编译报错）；取仿真时间用 WebServer 内置 `getruntime` 或读 `Tools/ModelUnits/ModelDateTimes/currentTime/modelTime`。
9. **对象位置**：创建的对象默认堆叠在原点，必须用 `set_loc` 排布坐标（如产线按 x=0,5,10,15 一字排开），这是建模的默认步骤。
10. **删除 handler 必须给全路径**：`delete_object` 内部是 `node(objName, model())`，裸名只在**模型层**找，而 handler 在 `Tools/...` 下。所以删 handler 要写 `delete_object=&value=Tools/serverinterface/queryhandlers/<名字>`。
    > ⚠️ 三个操作的名字口径**不一致**：`copy_handler`（复制）和 `set_code`（改代码）接受**裸名**（内部自动拼前缀），只有 `delete_object` 要求**全路径**。
11. **新增 handler 别指望「写文本就生效」**：见上文「handler 的执行模型」——`data` 改了不会重编译，必须走 `copy_handler`。

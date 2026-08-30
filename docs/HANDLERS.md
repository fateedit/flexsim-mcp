# 4 个基础 handler 详解

handler 是模型树 `Tools/serverinterface/queryhandlers/` 下的功能节点，WebServer 通过它们向模型下达命令。**WebServer 只认这个固定路径，且只在实例启动时加载 handler**。

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

## 硬性规则（踩坑总结）

1. **参数无关**：调 handler 时业务参数一律用通用名 `value` / `action` / `name` / `msg`，绝不依赖 handler 自身名字的参数。
2. **删除是异步的**（3~8 秒生效）：`delete_object` 后不能立即验证，应稍后重试看是否返回 not found。
3. **远程操作不持久**：只改运行实例内存；部署 / 修改后要提醒用户在 FlexSim 界面 Ctrl+S 保存。
4. **路径大小写敏感**；中文 / 空格由执行器自动编码，路径本身要写对。
5. **复合节点（数组）不能直接写**，必须写其叶子子节点。
6. **修改时间类节点后通常需要 reset** 才生效。
7. **模型树根路径用 `MODEL:`**（带冒号），空字符串会 404。
8. **handler 代码里不能用 `getmodeltime()`**（实测未定义，编译报错）；取仿真时间用 WebServer 内置 `getruntime` 或读 `Tools/ModelUnits/ModelDateTimes/currentTime/modelTime`。

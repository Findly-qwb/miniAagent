# AI Agent 开发岗位 — Todo 清单

> 项目仓库名：`ts-minimal-agent`
> 技术栈：TypeScript + Node.js（全程不切 Python，贴合 JD 前端/全栈要求）
> 已有资产：手写原生 ReAct Agent（Function Calling 最小版本，含「获取时间」「加法」两个工具）
> 执行规则：
> 1. 一次只做一个 Todo，做完一个再做下一个；
> 2. 每完成一个 Todo，保证代码可运行，再 `git commit` 提交；
> 3. 遇到卡住，直接贴代码，当场解决；
> 4. 每一步都对应 JD 里的能力点，可写入简历与面试讲解。

---

## 📋 阶段 0：代码加固 + 工程化（1 天｜前置准备，必做）
**目标**：把现有 Demo 稳定化、规范代码、上传 GitHub，打好项目地基。

- [x] Todo0-1：完善 TS 类型，消除 `any`，抽离独立类型定义（Tool、Message、ToolCallResult）—— ✅ 已完成：新建 `types.ts`（`ToolArgs`/`ToolParameter`/`ToolSchema`/`ToolDefinition`/`ToolCallResult`/`ChatMessage`/`TokenUsage`），`executeTool` 统一返回 `ToolCallResult`，`tsc --noEmit` 通过且运行验证成功
- [x] Todo0-2：给 Agent 循环增加**全局 try/catch 异常捕获**：API 报错、网络超时、JSON 解析失败、工具执行异常兜底—— ✅ 已完成：`agentLoop` 外层 try/catch 包裹整个循环作最终兜底，内层区分「可重试(429/超时)→ continue」「致命错误 → 全局终止」；运行中 429/Connection error 均正确捕获不崩溃
- [x] Todo0-3：增加 Token 统计逻辑，读取返回 `usage`，打印 prompt/completion/total token，简单记录消耗—— ✅ 已完成：每轮累加 `usageTotal`，打印本轮+累计，追加写入 `logs/token-usage.log`
- [x] Todo0-4：抽离配置（apiKey、baseURL、modelName、maxRound）放到 `.env`，用 `dotenv` 管理，**禁止密钥硬编码**—— ✅ 已完成：密钥已从 `agent.ts` 移除（仅存 `.env`，gitignore 覆盖），配置缺失时启动即报错退出；⚠️ 建议轮换曾出现在源码中的 Key
- [x] Todo0-5：优化日志：区分 INFO / WARN / ERROR，清晰打印：轮次、模型思考、工具名称、工具入参、工具返回—— ✅ 已完成：新增分级 `logger`（时间戳+级别+tag），接通 AGENT/API/THINK/TOOL/TOKEN/FATAL 六类场景，含模型思考与工具入参输出
- [x] Todo0-6：初始化 git 仓库，配置 `.gitignore`（node_modules、.env、日志文件）—— ✅ 已完成：git 已 init、`.gitignore` 合规（node_modules/dist/*.log/.DS_Store/.env）
- [x] Todo0-7：编写基础 README.md：项目介绍、运行方式、原理说明（手写 ReAct Agent，Function Calling）—— ✅ 已完成：`README.md` 含亮点、快速开始、ReAct+Function Calling 原理、内置工具、目录结构、命令与路线图
- [x] Todo0-8：本地运行全流程测试：测试「查时间」「加法计算」两种 case，确认异常场景可正常兜底—— ✅ 已完成：查时间（`[成功] 10/13/2026, 5:08:14 PM`）与加法（`[成功] 123 + 456 = 579`）均跑通；429 限流多轮自动重试后正常收尾，异常兜底/Token 落盘/分级日志全部实测验证
- [x] Todo0-9：提交代码，推送到 GitHub—— ✅ 已完成：remote 已配置（`git@github.com:Findly-qwb/miniAagent.git`），全部改动（分级日志、README、AGENTS.md、清单更新）已 commit 并 push 至 origin/main

✅ **阶段 0 交付物**：可稳定运行、规范类型、带 token 统计、密钥环境隔离的原生手写 Agent 仓库，GitHub 仓库就绪。

---

## 📋 阶段 1：上下文管理 + 记忆模块（2~3 天｜JD 核心：上下文与记忆管理）
**目标**：解决消息无限膨胀，增加会话隔离、短期窗口裁剪、长期向量记忆。

- [x] Todo1-1：引入会话 ID，不同用户对话独立存储，消息按 sessionId 隔离—— ✅ 已完成：新增 `AgentSession` 类型与内存 `sessions` Map；`agentLoop(sessionId, prompt)` 按会话取历史，导出 `getOrCreateSession/getSession/listSessions/clearSession`；实测 session-A 记住「小明」，session-B 独立问名不可见，隔离生效，`tsc` 通过
- [x] Todo1-2：实现**上下文窗口管理**：估算消息 token，接近上限时自动摘要压缩旧消息，防止上下文溢出—— ✅ 已完成：`compactContextIfNeeded` 启发式估算 token（字符/2+每条开销 4），超 `MAX_CONTEXT_TOKENS` 时旧消息调模型摘要为 system 消息、保留最近消息（最后一条必保、tool_calls 配对不拆散、摘要失败降级截断）；实测 session-C 投喂 ~1152 tokens 长资料触发压缩 `1271 → 135 tokens`，压缩后仍正确答出「启明科技/华东银行/东方航空」，实际 prompt 2091 → 362，`tsc` 通过
- [x] Todo1-3：本地启动 PostgreSQL + pgvector（Docker 一键拉起）—— ✅ 已完成（改用免 Docker 方案）：原生安装 PostgreSQL 17（`E:\pgsql17`，服务 `postgresql-x64-17` 运行中）+ 预编译 pgvector 0.8.6（手动分发 dll/control/sql 到 lib、share\extension）；已建库 `miniagent` 并 `CREATE EXTENSION vector`，实测 `[1,2,3] <-> [3,2,1] = 2.828` 向量距离运算正常；连接密码仅存本地，不入库
- [x] Todo1-4：封装向量库工具：写入记忆、相似度检索记忆—— ✅ 已完成：`src/infra/db.ts`（pg 连接池 + 幂等建 `memories` 表/HNSW 余弦索引）、`src/infra/embedding.ts`（LM Studio nomic-embed 768 维，document/query 前缀；⚠️ 踩坑：SDK 默认 `encoding_format:"base64"` 会让 LM Studio 返回 192 维截断向量，显式 `"float"` 解决）、`src/tools/memory.ts`（`saveMemory`/`searchMemory` 统一 `ToolCallResult`）；实测「银行客户买了什么」Top1=华东银行记忆 0.7585、「航空项目效果」Top1=东方航空 0.6629，语义排序正确
- [x] Todo1-5：新增 2 个工具函数：`save_memory`（保存对话摘要到向量库）、`search_memory`（检索历史相关记忆）—— ✅ 已完成：`tools/index.ts` 注册 2 个工具 schema（描述引导模型何时存/查），`executeTool` 增加 `sessionId` 参数分发到 `saveMemory`/`searchMemory`；实测 session-A 说名字→模型自主 `save_memory` 落库，**全新 session-B 无任何历史**→自主 `search_memory` 召回「小明」；session-D 存猫信息后 `clearSession`，session-E 仅靠 pgvector 答出「秋秋/2023-03-03」；已知短板：nomic 小模型短文本排序偶有 Top1 偏差（猫查询 Top1 是名字记忆，靠 top_k=5 兜住），后续可加相似度阈值或 rerank
- [x] Todo1-6：修改 Agent 逻辑：每轮用户提问前，自动检索相关历史记忆，追加到系统 prompt—— ✅ 已完成：`retrieveRelevantMemory`（top_k=3 + 相似度阈值 0.55 过滤噪声，失败降级为不注入不阻塞主循环）；`agentLoop` 发送前生成临时 system 前缀 `[长期记忆]…`，**只注入请求、不落会话历史**（防逐轮堆积）；实测 session-B 零历史问名字，**模型未调任何工具**直接凭注入记忆答出「小明」（prompt 469→564 可见注入开销）；顺手加精确去重（同内容不再重复入库，实测 id=4/6 命中跳过）。已知边界：① 本地 nomic 短查询排序不稳，猫问题 top3 被名字/公司记忆挤占导致一次漏答（待换强 embedding 或 rerank）；② 注入的记忆会诱导模型把「回忆」当「新事实」再次 save（产生改写入库如 id=8/9），可在注入文案里加「勿重复保存」约束
- [x] Todo1-7：测试长对话：多轮对话，验证 Agent 能记住很早之前的内容—— ✅ 已完成：9 轮长对话实测（session-long）：第 1 轮埋入「外婆王姓/78 岁/住杭州西湖区」事实 → 中间穿插工具轮、新事实、两次长文本；全程触发两次压缩（1018→730、1537→739 tokens，旧消息 11/9 条摘要），第 1 轮消息早已被挤出最近窗口；第 9 轮回问时模型凭「压缩摘要 + 记忆注入 + search_memory」完整答出「外婆姓王、78 岁、杭州西湖区」，早期事实经过压缩+填充后仍完整保留
- [x] Todo1-8：补充 README，新增记忆模块原理说明，提交代码到 GitHub—— ✅ 已完成：README 新增「记忆模块原理」章节（两级记忆架构图、四道记忆通道、向量化/相似度检索/压缩协同原理），更新技术栈、.env 配置表、目录结构、路线图；代码已 commit 并 push 至 origin/main

✅ **阶段 1 交付物（已完成）**：带会话隔离、窗口压缩、长期向量记忆的 Agent；可以跨会话记住历史信息（9 轮长对话实测通过）。

---

## 📋 阶段 2：RAG 知识库（3~4 天｜JD 核心：RAG 检索、业务知识库）
**目标**：让 Agent 自主判断是否查询外部文档知识库，而不是只依赖模型内置知识。

- [x] Todo2-1：新增工具 `search_knowledge_base(query)`，交给 Agent 自主调用—— ✅ 已完成：注册进 `tools/index.ts`（schema 描述「产品/价格/业务流程等业务知识时调用」），`executeTool` 分发到 `searchKnowledgeBase`；实测 Agent 连调两次（价格、坐席分开检索）后基于文档片段答出「专业版 39,800 元/年、20 坐席、20,000 次/月 AI 会话」，数字全部来自文档无幻觉
- [x] Todo2-2：实现文档加载：支持 Markdown / TXT 文档读取—— ✅ 已完成：`src/rag/loader.ts`（`loadFile`/`loadDirectory`，递归读目录，支持 .md/.txt，docId=文件名去扩展）
- [x] Todo2-3：实现文本分块 Chunk + 重叠分片逻辑—— ✅ 已完成：`src/rag/chunker.ts`（`chunkText`，300 字符窗口 + 50 字符重叠，尾部保留；实测手册 3 个分块）
- [x] Todo2-4：调用 Embedding 接口，生成向量存入 pgvector—— ✅ 已完成：`knowledge_chunks` 表（复用 `embedText` document 前缀 + HNSW 余弦索引），`ingestDocument`/`ingestDirectory` 幂等重灌
- [x] Todo2-5：实现检索逻辑：相似度查询，返回相关文档片段—— ✅ 已完成：`searchKnowledgeBase`（`1 - (embedding <=> $1)` 余弦相似度 Top-K，返回 docId/docName/chunkIndex/content/similarity）
- [x] Todo2-6：测试：上传一份业务文档，提问文档内信息，验证 Agent 会主动调用知识库—— ✅ 已完成：`docs/qi-ming-product-manual.md` 产品手册入库（启动幂等重灌），`npm run dev` 实测 Agent 主动调 `search_knowledge_base` 并正确作答
- [x] Todo2-7：增加简单评测脚本：统计召回片段、回答幻觉情况—— ✅ 已完成：`scripts/eval-rag.ts` + `npm run eval`；7 个预置用例（gold 关键词标注），每例统计「Top1 相似度 / gold 片段是否在 Top3 / 回答是否含 gold 关键词」；实测召回 Top1 命中 6/7、Top3 包含 7/7、回答准确率 5/7。两个失败案例暴露边界：①「核心功能」问题模型自信未调工具按常识编造通用功能（RAG 的"以为知道就不查"问题）；②「版本号」问题模型未调工具且自动记忆注入不覆盖知识库 → 漏答（可后续把 RAG 也纳入每轮强制注入，或调低工具触发门槛）
- [x] Todo2-8：更新 README，记录 RAG 流程，提交代码—— ✅ 已完成：README 新增「RAG 知识库原理」章节（两段式管道图、分块/幂等/评测闭环关键设计），更新工具表、目录结构（rag/ 层 + scripts + docs/）、命令（npm run eval）、路线图；代码已 commit 并 push，阶段 2 收尾时同步更新 `docs/mvp-vs-production.md`（AGENTS.md 规则 7）

✅ **阶段 2 交付物（已完成）**：Agent 具备自主检索知识库能力，RAG 作为工具被 Agent 按需调用（召回 Top3 7/7 实测）。

---

## 📋 阶段 3：任务规划 + 多 Agent 编排（4~6 天｜JD 重点：任务规划、多 Agent 协同）
**目标**：先手写简易状态机理解原理；之后迁移 LangGraph TS，不直接跳框架。

- [x] Todo3-1：新增 `plan_task` 工具，复杂任务自动拆分为子任务列表—— ✅ 已完成：`src/planning/planner.ts`（LLM 拆解为 `{id,title,description,dependsOn}` 有序子任务，JSON 容错提取+规整），注册为 `plan_task` 工具；实测 session-PLAN 模型自主调用并输出 6 步执行计划。⚠️ 踩坑：qwen3-4b 自由输出长 JSON 随机停笔致解析失败（非截断，completion 855<1500），LM Studio 不支持 `json_object` 但支持 **`json_schema` 约束解码**，改用 response_format json_schema strict 后连测稳定；顺带修复知识库误吞项目文档（业务文档隔离到 `docs/knowledge/`）
- [x] Todo3-2：手写简易状态机，实现：规划 → 执行 → 校验 的流转—— ✅ 已完成：`src/planning/state-machine.ts`（`runTask`：planning→executing→reviewing→done/failed 四态；按 `dependsOn` 波次推进+环检测兜底；子任务各跑独立 agentLoop 会话、前置结果注入下游 prompt；Reviewer 用 json_schema 校验覆盖度，不达标带 feedback 重跑点名子任务，最多 1 轮）；实测「产品一页纸」任务 6 子任务全部执行、子任务自主查知识库拿到真实价格（39,800/20 席）；校验真实拦截了缺项并触发重试。⚠️ 踩坑：① 子任务不查库编造数据→执行 prompt 加「业务事实必须 search_knowledge_base，严禁编造」修复；② 校验器长 markdown 输入触发约束解码空转（finish=length 空输出）→摘要压缩 200 字+max_tokens 提额+无 schema 兜底；③ 首轮幻觉记忆（"15项功能"）污染后续校验标准——**幻觉入库会长期毒化下游**，生产需加记忆审核/淘汰
- [x] Todo3-3：拆分多角色 Agent：Planner（任务拆解）、Executor（工具+RAG 执行）、Reviewer（结果校验与重试判断）—— ✅ 已完成：`src/planning/roles.ts` 四角色（Planner=拆解；Executor=`agentLoop`+独立 system prompt+工具白名单 `[time,add,search_knowledge_base,search_memory]`（**不给 plan_task 防递归规划、不给 save_memory 防幻觉入库**）；Reviewer=无工具纯判断，json_schema 输出 `{passed,incompleteIds,feedback}`+三级降级；Synthesizer=只读 RAG 整合交付）；`core/agent.ts` 扩展 `AgentRunOptions{systemPrompt,toolNames}` 向后兼容（默认全量工具无角色），`tools/index.ts` 加 `getToolsByNames`；状态机改为纯编排角色。实测四角色日志轨迹清晰、Executor 全程查库拿真实价格、Reviewer 点名 #3/#5 触发定向返工。⚠️ 新发现：Reviewer digest 每条截 200 字导致「旗舰版价格」被截掉→假阴性判不过（交付其实完整），截断防空转 vs 信息保全是矛盾，Todo3-7 优化（改按要素抽取而非定长截断）
- [x] Todo3-4：跑通多 Agent 协同案例（例如文档分析任务）—— ✅ 已完成：注册 `run_task` 工具（描述区分：只要计划→plan_task，要成品→run_task），`executeTool` 动态 `import(state-machine.js)` 打破 tools→SM→roles→agent→tools 循环依赖；实测聊天入口「写产品一页纸，直接给我成品」→ 模型自主调 `run_task` → 四角色流水线（Planner 拆 6 步 → 6 个独立子会话 Executor 执行 → Reviewer → Synthesizer 交付 707 字）→ 成品回喂聊天模型输出给用户，**对话→编排全链路贯通**。⚠️ 实测暴露两问题（3-7 优化）：① 任务改写幻觉——外层模型把任务参数改写成「15项核心功能」（手册实际只有 4 项），Executor 顺从编出 15 项通用功能，garbage-in-garbage-out；② Reviewer 本轮两次 finish=length 降级放行（rounds=0 直接 done），幻觉内容未被拦截；③ 子会话（sub-1..6/final）留在内存 Map 不清理，长任务会堆积
- [x] Todo3-5：学习 LangGraph TS 官方示例，用 LangGraph **重写**这套多 Agent 流程—— ✅ 已完成：`src/planning/langgraph-pipeline.ts`（`runTaskLangGraph`，与手写版同名同返回结构可无缝替换）：`Annotation.Root` 声明图状态（results/done/redoIds/verdict 各带 reducer），4 节点（planning/executing/reviewing/synthesizing）复用 roles.ts 四角色，`addConditionalEdges` 实现 executing↔reviewing 返工环，`recursionLimit` 防死循环；实测端到端跑通（6 子任务+1 轮校验返工+交付 608 字），与手写版行为等价。⚠️ 对比发现：① LangGraph 的状态是"每节点返回增量合并"，手写版是"Map/Set 原地改"——前者可回放/持久化（checkpoint 免费获得），后者直观但要自己实现落盘；② 重试环手写版 20 行 while 就够，LangGraph 要 redoIds 状态字段+条件边两处配合，简单场景反而更啰嗦；③ 本轮实测再次复现"15项功能"任务改写幻觉（来自记忆 id=20/21 污染残留，已删）——与编排层无关，是 Planner 输入被历史污染的例证
- [x] Todo3-6：对比手写状态机 vs LangGraph，记录两者差异，写进 README—— ✅ 已完成：README 新增「多 Agent 编排：手写状态机 vs LangGraph」章节（双实现代码结构对照 + 6 维度对比表：可读性/持久化/循环安全/流式/依赖/调试 + 结论"≤4 节点手写更透明，要 checkpoint/流式/人审时框架反超"）；工具表补 plan_task/run_task、目录结构补 planning 四文件、路线图勾选阶段 3
- [x] Todo3-7：测试多轮复杂任务，验证任务重试、分支跳转逻辑—— ✅ 已完成：双任务实测——任务 A（6 子任务复杂）触发**重试环**：Reviewer 点名 #1 返工带 feedback → 二轮校验 → 轮次耗尽转 failed 但照常交付 862 字；任务 B（2 子任务简单）**直通分支**：一次通过 rounds=0 → done，成品含真实价格+文档来源。顺带修复两笔挂账：① 子会话泄漏——runTask/runTaskLangGraph 返回前 clearSession 回收 sub-*/final，实测残留=0 ✅；② Reviewer 截断假阴性——digest 改"头 200+尾 100"保留，尾部要素不再被切
- [x] Todo3-8：提交代码，更新文档—— ✅ 已完成：README 编排对比章节 + docs/mvp-vs-production.md 阶段 3 对照表（规划/编排/执行/校验/记忆协同/资源 6 维度 + 4 坑速查），代码已提交推送

✅ **阶段 3 交付物（已完成）**：多角色协同 Agent；同时拥有手写状态机版本 + LangGraph TS 版本（重试环/直通分支实测通过）。

---

## 📋 阶段 4：全栈 Web 服务 + 前端控制台（3~5 天｜JD：需求 → 原型 → 上线 → 迭代闭环）
**目标**：做成完整 0-1 全栈 Web 应用，前后端打通，可浏览器交互。

- [x] Todo4-1：基于 Nest.js / Express，封装 Agent 能力，暴露 HTTP 接口—— ✅ 已完成：`src/server/`（app 装配 + routes）；`logger.ts` 改造为「console + 事件总线」双通道并接入 `AsyncLocalStorage` 请求上下文（跨 await 链给每条日志打 reqId）；接口：`GET /api/health`、`GET /api/sessions`、`DELETE /api/sessions/:id`、`POST /api/chat`（**SSE 流式**：思考链路 log 事件按 reqId 过滤推送，长任务不阻塞 HTTP）、`POST /api/knowledge/upload`（落盘+分块入库，防路径穿越）、`GET /api/knowledge/docs`；实测 SSE 三类事件（log/result/done）齐全、多请求 reqId 隔离；**意外验证降级链**：embedding 模型未加载时 chat 仍成功（retrieveRelevantMemory catch→null 静默降级）
- [x] Todo4-2：React 前端页面开发：对话输入框、展示 Agent 思考链路与工具调用日志、知识库文档上传入口、会话切换—— ✅ 已完成：`web/`（Vite+React18+TS，四组件 SessionSidebar/ChatPanel/LogStream/KnowledgePanel）；`streamChat` 手写 SSE 解析（fetch+ReadableStream，因 EventSource 不支持 POST）；对话输入/思考链路实时渲染（按级别着色，MEMORY 降级显红）/文档上传/会话切换+localStorage 记忆当前会话；**修复重大 bug**：SSE 只推前 2 条日志——根因是误用 `req.on("close")`（POST body 读完即触发，在 agentLoop 起步时就移除 listener），改 `res.on("close")`；用 ALS 隔离诊断脚本排除了"AsyncLocalStorage 丢失"的错误假设，靠服务端 SSE-DIAG 探针锁定真凶；浏览器实测 11 条链路日志完整渲染
- [x] Todo4-3：前后端联调，浏览器端完整跑通对话、知识库上传—— ✅ 已完成：浏览器端到端实测全通——① 对话：SSE 思考链路 14 条日志实时渲染（含 MEMORY 注入成功、TOOL 调用链、RAG 命中、TOKEN）；② 上传：`tmp-upload-doc.md` 经 UI 选择→读取→POST→入库（右栏列表 + 状态双确认）；③ **检索闭环**：提问刚上传文档的暗号/工号，模型自主连调 `search_knowledge_base`×2 + `search_memory`×1，答「紫罗兰-7788 / A1024」全部来自新文档零幻觉；测试数据已清理
- [x] Todo4-4：Docker 打包整个项目（后端 + 数据库），编写 Dockerfile、docker-compose.yml—— ✅ 已完成：`Dockerfile`（多阶段：node:20-alpine 构建后端 tsc + 前端 vite → 运行阶段仅 `npm ci --omit=dev` 生产依赖，拷贝 dist/web/dist/docs）；`docker-compose.yml`（app + postgres 双服务，`pgvector/pgvector:pg17` 镜像带向量扩展、`pg_isready` 健康检查、`depends_on: service_healthy` 保证 PG 就绪再起 app、pgdata 持久卷、`host.docker.internal` 让容器访问宿主机 LM Studio 做 embedding、docs/knowledge 挂载卷）；`app.ts` 增加 `web/dist` 存在时同端口静态托管 + SPA 回退（Express 5 `{*path}` 语法）实现单容器部署；`.dockerignore` 排除依赖/产物/.env；**本地等价验证**（无 Docker 环境下跑生产模式 `node dist/server/index.js`）：GET / 返回前端、/api/health 正常、SPA 回退 200、静态资源 200、浏览器在 3000 端口对话成功
- [~] Todo4-5：本地容器化部署，验证一键启动—— ⏸ **环境受限跳过**（本机 BIOS 未开虚拟化 SVM，用户决定不启用 Docker）：Dockerfile/compose 交付物已在 4-4 完成并提交，且已用「本地生产模式」（`node dist/server/index.js` 单端口托管前端+API）做了等价验证：GET / 前端、/api/health、SPA 回退、静态资源、浏览器对话全通过；将来任何有 Docker 环境的机器可直接 `docker compose up -d --build` 一键启动
- [x] Todo4-6：增加基础监控：记录每次请求耗时、任务成功率—— ✅ 已完成：`src/infra/metrics.ts`（内存计数器：路由级 count/errors/avgMs/maxMs + 任务三分类 success/stopped/failed + 成功率 + 5 分钟周期快照日志）；`app.ts` 中间件 `res.on("finish")` 记耗时、`GET /api/metrics` 暴露快照；`chat.ts` 按 agentLoop 哨兵返回值打点。实测：`/api/chat` avgMs=8931（对话真实耗时）、`/api/sessions` 归并正确。**修两个实测暴露的 bug**：① 启发式 `:id` 归并把 "sessions" 误判成动态段 → 改用 Express 路由模板 `req.route.path`；② SPA 回退把 `/api/no-such-route` 吞成 200 HTML → API 前缀未知路由改回 404 JSON
- [x] Todo4-7：完善 README 部署文档，提交代码—— ✅ 已完成：README 新增「部署」章节（Docker 一键启动步骤 + compose 要点：pgvector 镜像/健康检查/卷挂载/host.docker.internal；本地生产模式无 Docker 跑法；监控端点说明），目录结构补 server/web/metrics/Dockerfile，技术栈补 Express5/React18/Vite/LangGraph/Docker，开发命令补 server/web，路线图勾选 Web 控制台；阶段 4 收尾同步更新 `docs/mvp-vs-production.md`（会话持久化/SSE 断线重连/长任务异步/鉴权/监控指标化 6 维对照 + 4 坑速查）；代码已提交

✅ **阶段 4 交付物（已完成）**：可浏览器访问的 Web Agent 应用，支持文档上传、对话、查看 Agent 思考链路；本地生产模式单端口托管已实测，Docker 编排文件就绪（本机未启用 Docker，标注环境受限）。

---

## 📋 阶段 5：加分项（选做，挑 1~2 个即可，面试加分，不用全部做完）
**目标**：按需挑选，优先选 MCP / Ollama 本地 LLM，贴合 JD 加分项。

- [ ] Todo5-1：MCP：改造工具调用，对接 MCP 服务，理解 Model Context Protocol
- [ ] Todo5-2：Ollama 本地部署 LLM，Agent 对接本地模型
- [ ] Todo5-3：Graph RAG 改造知识库，构建知识图谱增强检索
- [x] Todo5-4：Agent 评测脚本：批量评测任务，统计成功率、幻觉率、token 成本—— ✅ 已完成：`scripts/eval-agent.ts`（`npm run eval:agent`）：8 用例覆盖 5 类能力（tool/memory/rag/plan/anti-hallucination），gold 关键词判分 + forbidden 关键词判幻觉 + `onUsage` 回调精确统计每用例 token；**评测当场抓出真 bug**：① 无关文档混入 docs/knowledge 污染检索（移出+清库）② 云端 429 限流下固定 3s 退避不足、重试烧光轮次预算 → 修 `agentLoop` 指数退避（8s 起、×2、上限 30s、最多 3 次、**退避重试不占轮次**）；修复后成功率 37.5% → **100%、幻觉率 0%**（含"月球基地收费"诱骗题正确拒答）
- [ ] Todo5-5：CI/CD 配置，代码提交自动运行简单测试

---

## 📋 阶段 6：简历包装 + 面试准备（项目收尾）
**目标**：整理项目亮点，对标 JD 包装简历，准备面试问答。

- [ ] Todo6-1：整理项目亮点，提炼简历项目描述（对标 JD）
- [ ] Todo6-2：准备面试问答：梳理项目踩坑、优化思路
- [ ] Todo6-3：录制简短演示视频（可选，面试加分）
- [ ] Todo6-4：整理 GitHub 项目首页 README，放演示截图、架构图

---

## ✅ 当前进度
- ✅ **阶段 0 全部完成（9/9）**：Todo0-1~0-9 均已完成——types.ts 类型抽离、全局异常兜底、Token 落盘、.env 配置抽离、分级日志、git 初始化、README、全流程实测、代码推送 GitHub
- ✅ **Todo1-1 已完成**：sessionId 会话隔离（内存 Map + AgentSession），跨轮共享历史、跨会话互不可见，已实测
- ✅ **Todo1-2 已完成**：上下文窗口管理——token 估算 + 超限自动摘要压缩，实测压缩 1271→135 tokens 且关键信息可召回
- ✅ **Todo1-3 已完成**：免 Docker 方案——原生安装 PostgreSQL 17 + pgvector 0.8.6，建库 `miniagent`，`CREATE EXTENSION vector` 与距离运算实测通过
- ✅ **Todo1-4 已完成**：pg 连接池 + memories 表（HNSW 索引）+ embedding 封装 + `saveMemory`/`searchMemory`，语义检索实测排序正确
- ✅ **Todo1-5 已完成**：`save_memory`/`search_memory` 注册为 Function Calling 工具，模型自主调用，跨会话召回实测通过（session-E 靠 pgvector 答出猫名）
- ✅ **Todo1-6 已完成**：每轮自动检索注入系统 prompt（阈值过滤+失败降级），实测模型不调工具也能凭注入记忆答对；记忆精确去重
- ✅ **Todo1-7 已完成**：9 轮长对话实测，经历两次上下文压缩后仍完整召回第 1 轮的外婆事实（压缩摘要+记忆注入+工具检索三机制协同）
- ✅ **Todo1-8 已完成**：README 记忆模块原理章节 + 配置表/目录/路线图更新，代码已推送 GitHub
- ✅ **阶段 1 全部完成（8/8）**：会话隔离 → 上下文压缩 → pgvector 环境 → 向量库封装 → 记忆工具化 → 自动注入 → 长对话验证 → 文档收尾
- ✅ **Todo2-1~2-6 已完成**：RAG 基础全通——loader/chunker/knowledge（分块重叠+入库+余弦检索）+ `search_knowledge_base` 工具化，实测 Agent 主动检索产品手册并答出准确价格
- ✅ **Todo2-7 已完成**：评测脚本 `npm run eval`（7 用例），召回 Top3 包含 7/7、回答准确率 5/7，暴露「模型过度自信不查库」边界
- ✅ **Todo2-8 已完成**：README RAG 原理章节 + 结构/命令/路线图更新，代码已推送 GitHub；mvp-vs-production 已补阶段 2 对照
- ✅ **阶段 2 全部完成（8/8）**：知识库工具 → 文档加载 → 分块重叠 → 向量入库 → 相似度检索 → 上传实测 → 评测脚本 → 文档收尾
- ✅ **Todo3-1 已完成**：`plan_task` 工具（json_schema 约束解码根治小模型 JSON 随机停笔），模型自主拆解 6 步计划实测通过
- ✅ **Todo3-2 已完成**：手写状态机 规划→执行→校验→交付，dependsOn 波次调度+校验重试，子任务查库防幻觉；发现幻觉记忆污染问题
- ✅ **Todo3-3 已完成**：Planner/Executor/Reviewer/Synthesizer 四角色拆分（各自 system prompt + 工具白名单），状态机变纯编排层；发现 Reviewer 截断假阴性
- ✅ **Todo3-4 已完成**：`run_task` 工具接入对话链路（动态 import 破循环依赖），聊天一句话触发四角色流水线拿成品；暴露任务改写幻觉+Reviewer 降级放行两问题
- ✅ **Todo3-5 已完成**：LangGraph 重写流水线（Annotation 状态+4 节点+条件边返工环），端到端与手写版等价；积累"手写 vs 框架"对比素材
- ✅ **Todo3-6 已完成**：手写 vs LangGraph 六维对比写进 README（结论：≤4 节点手写更透明，checkpoint/流式场景框架反超）
- ✅ **Todo3-7 已完成**：重试环（点名返工+轮次耗尽转 failed）与直通分支（rounds=0 done）双任务实测通过；修复子会话泄漏+Reviewer 截断假阴性两笔挂账
- ✅ **Todo3-8 已完成**：README 编排章节 + mvp-vs-production 阶段 3 对照，代码已提交
- ✅ **阶段 3 全部完成（8/8）**：plan_task → 状态机 → 四角色 → run_task 接入对话 → LangGraph 重写 → 对比 → 重试/分支测试 → 文档收尾
- ✅ **Todo4-1 已完成**：Express + SSE 流式接口（/api/chat 思考链路按 reqId 隔离推送）、知识库上传/列表、会话管理；logger 双通道改造 + AsyncLocalStorage
- ✅ **Todo4-2 已完成**：React 控制台（web/，Vite+TS）四组件 + SSE 手写解析；修复 req.on("close") 误用导致的日志丢失 bug；浏览器实测链路日志完整渲染
- ✅ **Todo4-3 已完成**：浏览器端到端全通——对话 SSE 14 条日志渲染、文档上传入库、提问检索刚上传内容零幻觉（紫罗兰-7788/A1024）
- ✅ **Todo4-4 已完成**：Docker 多阶段构建 + compose（app+pgvector 双服务健康检查编排）+ 单端口静态托管；无 Docker 环境以生产模式本地等价验证通过
- ✅ **Todo4-6 已完成**：请求耗时/任务成功率监控（路由模板归并 + API 404 修复，实测 /api/chat avg 8.9s）
- ✅ **Todo4-7 已完成**：README 部署章节（Docker + 本地生产模式双路径）+ 目录/技术栈/命令/路线图更新，mvp-vs-production 阶段 4 对照
- ⏸ **Todo4-5 环境受限跳过**：本机未开 BIOS 虚拟化，用户决定不用 Docker 部署；compose 交付物已就绪，本地生产模式已做等价验证
- ✅ **阶段 4 完成（6/7，4-5 环境受限）**：HTTP 接口 → React 控制台 → 端到端联调 → Docker 打包 → 监控 → 部署文档
- ✅ **Todo5-4 已完成**：Agent 批量评测（8 用例 5 类能力，成功率 100%/幻觉 0%/平均 3414 tok）；评测抓出 429 退避不足与知识库污染两个真 bug 并修复
- **进行中 / 下一步**：Todo5-5（CI/CD：GitHub Actions 自动跑 typecheck + 评测回归）
- ⚠️ 风险项：密钥曾明文出现在 `agent.ts` 源码（历史提交无泄漏，已移至 `.env`），建议尽快轮换曾暴露的 Key
- 总进度：阶段 0~4 全部完成（9+8+8+8+6），阶段 5 进行 1/5

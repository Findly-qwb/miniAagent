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
- [ ] Todo1-7：测试长对话：多轮对话，验证 Agent 能记住很早之前的内容
- [ ] Todo1-8：补充 README，新增记忆模块原理说明，提交代码到 GitHub

✅ **阶段 1 交付物**：带会话隔离、窗口压缩、长期向量记忆的 Agent；可以跨会话记住历史信息。

---

## 📋 阶段 2：RAG 知识库（3~4 天｜JD 核心：RAG 检索、业务知识库）
**目标**：让 Agent 自主判断是否查询外部文档知识库，而不是只依赖模型内置知识。

- [ ] Todo2-1：新增工具 `search_knowledge_base(query)`，交给 Agent 自主调用
- [ ] Todo2-2：实现文档加载：支持 Markdown / TXT 文档读取
- [ ] Todo2-3：实现文本分块 Chunk + 重叠分片逻辑
- [ ] Todo2-4：调用 Embedding 接口，生成向量存入 pgvector
- [ ] Todo2-5：实现检索逻辑：相似度查询，返回相关文档片段
- [ ] Todo2-6：测试：上传一份业务文档，提问文档内信息，验证 Agent 会主动调用知识库
- [ ] Todo2-7：增加简单评测脚本：统计召回片段、回答幻觉情况
- [ ] Todo2-8：更新 README，记录 RAG 流程，提交代码

✅ **阶段 2 交付物**：Agent 具备自主检索知识库能力，RAG 作为工具被 Agent 按需调用。

---

## 📋 阶段 3：任务规划 + 多 Agent 编排（4~6 天｜JD 重点：任务规划、多 Agent 协同）
**目标**：先手写简易状态机理解原理；之后迁移 LangGraph TS，不直接跳框架。

- [ ] Todo3-1：新增 `plan_task` 工具，复杂任务自动拆分为子任务列表
- [ ] Todo3-2：手写简易状态机，实现：规划 → 执行 → 校验 的流转
- [ ] Todo3-3：拆分多角色 Agent：Planner（任务拆解）、Executor（工具+RAG 执行）、Reviewer（结果校验与重试判断）
- [ ] Todo3-4：跑通多 Agent 协同案例（例如文档分析任务）
- [ ] Todo3-5：学习 LangGraph TS 官方示例，用 LangGraph **重写**这套多 Agent 流程
- [ ] Todo3-6：对比手写状态机 vs LangGraph，记录两者差异，写进 README
- [ ] Todo3-7：测试多轮复杂任务，验证任务重试、分支跳转逻辑
- [ ] Todo3-8：提交代码，更新文档

✅ **阶段 3 交付物**：多角色协同 Agent；同时拥有手写状态机版本 + LangGraph TS 版本。

---

## 📋 阶段 4：全栈 Web 服务 + 前端控制台（3~5 天｜JD：需求 → 原型 → 上线 → 迭代闭环）
**目标**：做成完整 0-1 全栈 Web 应用，前后端打通，可浏览器交互。

- [ ] Todo4-1：基于 Nest.js / Express，封装 Agent 能力，暴露 HTTP 接口
- [ ] Todo4-2：React 前端页面开发：对话输入框、展示 Agent 思考链路与工具调用日志、知识库文档上传入口、会话切换
- [ ] Todo4-3：前后端联调，浏览器端完整跑通对话、知识库上传
- [ ] Todo4-4：Docker 打包整个项目（后端 + 数据库），编写 Dockerfile、docker-compose.yml
- [ ] Todo4-5：本地容器化部署，验证一键启动
- [ ] Todo4-6：增加基础监控：记录每次请求耗时、任务成功率
- [ ] Todo4-7：完善 README 部署文档，提交代码

✅ **阶段 4 交付物**：可浏览器访问的 Web Agent 应用，支持文档上传、对话、查看 Agent 思考链路。

---

## 📋 阶段 5：加分项（选做，挑 1~2 个即可，面试加分，不用全部做完）
**目标**：按需挑选，优先选 MCP / Ollama 本地 LLM，贴合 JD 加分项。

- [ ] Todo5-1：MCP：改造工具调用，对接 MCP 服务，理解 Model Context Protocol
- [ ] Todo5-2：Ollama 本地部署 LLM，Agent 对接本地模型
- [ ] Todo5-3：Graph RAG 改造知识库，构建知识图谱增强检索
- [ ] Todo5-4：Agent 评测脚本：批量评测任务，统计成功率、幻觉率、token 成本
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
- **进行中 / 下一步**：Todo1-7（长对话测试：多轮对话验证 Agent 记住很早之前的内容）
- ⚠️ 风险项：密钥曾明文出现在 `agent.ts` 源码（历史提交无泄漏，已移至 `.env`），建议尽快轮换曾暴露的 Key
- 总进度：阶段 0 完成 9/9，阶段 1 进行 6/8

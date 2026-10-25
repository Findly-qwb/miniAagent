# ts-minimal-agent

[![CI](https://github.com/Findly-qwb/miniAagent/actions/workflows/ci.yml/badge.svg)](https://github.com/Findly-qwb/miniAagent/actions/workflows/ci.yml)

手写原生 **ReAct Agent**(TypeScript + Node.js)——不依赖任何 Agent 框架,基于 OpenAI Function Calling 协议从零实现的工具调用循环。

## 项目亮点

- **手写 ReAct 循环**:Model → Think → Act(调工具)→ Observe → Loop,完全理解每一步在做什么
- **强类型**:全部类型抽离至 `src/types.ts`,无 `any`;成功/失败统一 `ToolCallResult` 结构回传模型
- **健壮性**:全局异常兜底 + 可重试策略(限流/超时自动续轮)
- **可观测**:INFO / WARN / ERROR 分级日志,打印每一轮模型思考、工具名、入参、返回
- **Token 成本统计**:每轮 + 累计用量,并落盘 `logs/token-usage.log`
- **记忆分层**:会话(工作记忆)+ pgvector 长期记忆(语义向量),跨会话持久
- **RAG 知识库**:文档入库分块 + 向量检索,Agent 自主检索业务资料作答
- **上下文窗口管理**:token 估算 + 超限自动摘要压缩,旧消息不丢关键事实
- **可评测**:`npm run eval` 量化召回质量与回答幻觉,`npm run eval:agent` 批量评测 5 类能力(成功率/幻觉率/token 成本)
- **密钥安全**:所有配置走 `.env`(`dotenv`),绝不硬编码

## 技术栈

TypeScript 5 · Node.js 20+ · OpenAI SDK v4 · tsx(零配置运行) · PostgreSQL 17 + pgvector 0.8 · Express 5(SSE) · React 18 + Vite · LangGraph · Docker

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量(复制模板并填入真实密钥)
cp .env.example .env

# 3. 运行
npm run dev
```

`.env` 配置项:

| 变量 | 说明 | 默认值 |
|---|---|---|
| `OPENAI_API_KEY` | API 密钥(必填) | 无 |
| `OPENAI_BASE_URL` | 兼容 OpenAI 协议的网关地址 | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 模型名 | `deepseek-v4-flash` |
| `MAX_ROUND` | Agent 最大思考轮数 | `3` |
| `MAX_CONTEXT_TOKENS` | 上下文窗口 token 上限(超限自动摘要压缩) | `1000` |
| `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE` | PostgreSQL + pgvector 连接(长期记忆库) | `127.0.0.1/5432/postgres/-/miniagent` |
| `EMBEDDING_MODEL` | 文本向量化模型名 | `text-embedding-nomic-embed-text-v1.5` |
| `EMBEDDING_DIM` | embedding 向量维度 | `768` |

## 工作原理(手写 ReAct + Function Calling)

1. 用户提问进入 `messages`,携带工具定义(`tools`)请求模型
2. 模型返回两种结果之一:
   - **直接回答** → 没有 `tool_calls` 即结束
   - **要求调工具** → 返回工具名与参数(JSON),进入第 3 步
3. Agent 执行工具(当前内置 `get_current_time`、`add_numbers`),把结果序列化为 `[成功]/[失败]` 回填为 `tool` 消息
4. 带上工具结果重新请求模型,模型基于观察继续思考,直到给出最终答案

```
循环: Model(思考) → 调工具(行动) → 观察结果 → 再思考 → ... → 最终回答
```

整个循环由 `src/core/agent.ts` 的 `agentLoop()` 驱动,分层模块各司其职、依赖单向,方便逐行讲解。

## 记忆模块原理(两级记忆)

模拟人类「工作记忆 + 长期记忆」的分层设计:

```
┌─ 工作记忆(短期) ──────────────────────────────┐
│ session(内存 Map,按 sessionId 隔离)           │
│   完整消息流水:user/assistant/tool 逐条       │
│   超限时自动摘要压缩(旧消息→system 摘要)     │
│   进程重启即失                                 │
└──────────────────────────────────────────────┘
          │ 提炼(模型自主 save_memory / 压缩前联动)
          ▼
┌─ 长期记忆(pgvector) ─────────────────────────┐
│ memories 表:content + embedding vector(768)  │
│   HNSW 索引 + 余弦距离(<=>)相似度检索         │
│   进程重启仍在,跨会话可召回                   │
└──────────────────────────────────────────────┘
```

**四道记忆通道**:

1. **会话内连贯**(Todo1-1):`session.messages` 跨轮共享,同 ID 复用、异 ID 隔离
2. **窗口防爆**(Todo1-2):`estimateTokens` 超 `MAX_CONTEXT_TOKENS` 时,旧消息由模型压缩成摘要 system 消息,最近 6 条原样保留(tool_calls 配对不拆散、最后一条必保)
3. **主动存储**(Todo1-5):`save_memory` / `search_memory` 注册为 Function Calling 工具,模型读到用户个人信息/重要事实时自主落库;同内容精确去重
4. **被动注入**(Todo1-6):每轮提问前,代码**强制**用当前问题检索 Top-3 相关记忆(相似度≥0.55),拼成 `[长期记忆]` system 前缀注入请求——不依赖模型自觉调工具;检索失败降级为不注入,不阻塞主循环

**关键原理**:

- **向量化**:`embedText` 调用本地 embedding 模型(如 nomic-embed),文本→768 维向量;入库/查询分别加 `search_document:` / `search_query:` 前缀(instruction-tuned 模型的对齐要求)
- **相似度检索**:pgvector `1 - (embedding <=> $1)` 即余弦相似度(1=完全同向),`ORDER BY 距离 LIMIT K` 取 Top-K,配合 HNSW 索引加速
- **压缩与记忆的协同**:Todo1-2 压缩旧消息前,关键事实早已通过 Todo1-5/1-6 落库——压缩丢的是"对话现场",长期记忆保住的是"事实",两者互补(9 轮长对话实测:两次压缩后仍完整召回第 1 轮事实)

## 多 Agent 编排:手写状态机 vs LangGraph

同一套「规划 → 执行 → 校验 → 交付」流水线,项目里保留两个等价实现(`runTask` / `runTaskLangGraph`,同返回结构可互换):

```
手写版 (state-machine.ts ~140行)          LangGraph版 (langgraph-pipeline.ts ~190行)
  while 循环 + if 判断推进                    StateGraph 声明节点 + 条件边,图引擎驱动
  results: Map / done: Set 原地改            Annotation 状态,节点返回增量合并
  重试 = done.delete + 带 feedback 重跑       重试 = redoIds 状态字段 + 条件边回流
```

| 维度 | 手写状态机 | LangGraph |
|---|---|---|
| 可读性 | 流程一眼看穿,20 行 while 搞定重试 | 简单场景反而啰嗦(状态 reducer+两处条件边) |
| 状态持久化 | 要自己写落盘 | checkpoint 免费获得(可中断恢复/回放) |
| 循环安全 | while 条件自己保证 | `recursionLimit` 框架兜底 |
| 流式进度 | 要自己埋回调 | `graph.stream()` 原生每节点事件 |
| 依赖/体积 | 零依赖 | +22 包(且绑 LangChain 生态) |
| 调试 | 断点直接跟 | 状态合并语义要反应堆(reducer 写错=静默 bug) |

**结论**:≤4 节点的固定流水线手写更透明;节点会增长、要断点续跑/人审中断/进度推送时,框架收益反超成本。本项目实测:重试环在 LangGraph 里需要 `redoIds` 字段 + reviewing 计数 + 两条条件边共 3 处配合,手写版一个 `while` 就完事——**框架不是银弹,是另一种权衡**。

## 内置工具

| 工具 | 说明 |
|---|---|
| `get_current_time` | 获取当前本地时间 |
| `add_numbers` | 计算两个数字相加(含参数校验) |
| `save_memory` | 把用户事实/对话要点保存到 pgvector 长期记忆库 |
| `search_memory` | 按语义相似度检索历史记忆(Top-K,余弦距离) |
| `search_knowledge_base` | 检索已入库的业务文档知识库(产品/价格/流程等,Top-K 分块) |
| `plan_task` | 复杂任务拆解为带依赖的子任务列表(只出计划不执行) |
| `run_task` | 端到端多 Agent 流水线:规划→执行→校验→交付,产出完整成品 |

## RAG 知识库原理

**两段式管道**——离线入库 + 在线检索,全程复用记忆模块的 embedding 基建:

```
入库: docs/*.md(txt)
  → loader 读取全文 → chunker 切分块(300字窗口+50字重叠)
  → embedText("search_document:…") → 768维向量
  → INSERT knowledge_chunks 表(HNSW 余弦索引,启动幂等重灌)

检索: 用户问「专业版多少钱」
  → Agent 自主调 search_knowledge_base(query)
  → embedText("search_query:…") → 查询向量
  → ORDER BY embedding <=> $1 LIMIT K → 最相关分块(带相似度)
  → 分块原文回喂模型 → 基于文档作答(数字/事实来自文档,非模型编造)
```

关键设计:
- **分块 + 重叠**:块是检索的最小单元,重叠防止语义被窗口边界切断
- **幂等入库**:同 doc_id 先删后插,`npm run dev` 重复跑不堆积
- **评测闭环**:`scripts/eval-rag.ts`(7 用例)统计 Top1/Top3 召回与回答命中率,定位瓶颈(召回 or 工具触发)——实测召回 Top3 7/7、回答准确率 5/7,暴露「模型过度自信不调工具」边界

## 目录结构

```
ts-minimal-agent/
├── src/
│   ├── index.ts          # 入口:演示用例(会话隔离/上下文压缩验证)
│   ├── types.ts          # 全部类型定义(Tool / Message / ToolCallResult / TokenUsage)
│   ├── core/             # Agent 核心
│   │   ├── agent.ts      # 核心 Agent 循环(agentLoop)
│   │   ├── context.ts    # 上下文窗口管理:token 估算 + 超限摘要压缩
│   │   └── session.ts    # 会话管理:按 sessionId 隔离
│   ├── llm/              # 模型层
│   │   └── client.ts     # OpenAI 客户端单例
│   ├── tools/            # 工具层
│   │   ├── index.ts      # 工具注册表 + 执行器(统一 ToolCallResult)
│   │   └── memory.ts     # saveMemory/searchMemory/retrieveRelevantMemory
│   ├── rag/              # RAG 知识库层
│   │   ├── loader.ts     # 文档加载(.md/.txt,递归目录)
│   │   ├── chunker.ts    # 分块(300字窗口+50重叠)
│   │   └── knowledge.ts  # 入库/检索(knowledge_chunks 表 + 余弦 Top-K)
│   ├── planning/         # 任务规划与多 Agent 编排层
│   │   ├── planner.ts    # planTask:LLM 拆解子任务(json_schema 约束解码)
│   │   ├── roles.ts      # Planner/Executor/Reviewer/Synthesizer 四角色(人设+工具白名单)
│   │   ├── state-machine.ts     # 手写状态机 runTask(规划→执行→校验→交付)
│   │   └── langgraph-pipeline.ts # LangGraph 等价实现 runTaskLangGraph
│   └── infra/            # 基础设施
│       ├── config.ts     # .env 配置读取与校验
│       ├── logger.ts     # 分级日志(INFO/WARN/ERROR + SSE 事件总线)
│       ├── usage.ts      # Token 统计打印与落盘
│       ├── db.ts         # pg 连接池 + memories/knowledge 表初始化
│       ├── embedding.ts  # 文本→向量(embedText + 前缀对齐)
│       └── metrics.ts    # 请求耗时/任务成功率监控
│   └── server/           # Web 服务层(Todo4)
│       ├── index.ts      # HTTP 入口(初始化数据层后监听)
│       ├── app.ts        # Express 装配 + 静态托管 + 监控中间件
│       └── routes/       # chat(SSE 对话) / knowledge(上传/列表)
├── web/                  # React 控制台(Vite+TS)
│   └── src/              # 对话/思考链路/上传/会话切换四组件
├── scripts/eval-rag.ts  # RAG 评测脚本(召回+幻觉统计)
├── docs/knowledge/      # 业务文档(md/txt 入库源,与项目文档隔离)
├── docs/                # 项目文档(mvp-vs-production 对照等)
├── Dockerfile           # 多阶段构建(后端 tsc + 前端 vite → 生产镜像)
├── docker-compose.yml   # app + pgvector 一键编排
├── .env.example    # 环境变量模板(提交)
├── .env            # 本地密钥(不提交)
├── logs/           # Token 消耗日志(不提交)
└── package.json
```

## 开发命令

```bash
npm run dev        # tsx 直接运行(演示用例:会话隔离/压缩/记忆/规划全流程)
npm run dev:all    # 一键拉起前后端(server:3000 + web:5173,Ctrl+C 全停)
npm run server     # 仅启动 HTTP 服务(开发模式,tsx)
npm run typecheck  # tsc --noEmit 类型检查
npm run build      # 编译后端到 dist/
npm run eval       # RAG 评测(召回 + 回答幻觉统计)
npm run eval:agent # Agent 批量评测(成功率 / 幻觉率 / token 成本)
npm run web:dev    # 仅前端控制台(5173,/api 代理到 3000)
npm run web:build  # 前端打包到 web/dist
```

## 部署

### Docker 一键启动(推荐)

前置:Docker Desktop(Windows 需在 BIOS 开启虚拟化 SVM/VT-x)。

```bash
# 1. 准备环境变量(至少填 OPENAI_API_KEY 与 PG_PASSWORD)
cp .env.example .env

# 2. 构建并启动 app + pgvector 双服务
docker compose up -d --build

# 3. 访问
# 前端 + API 同端口:http://localhost:3000
# 监控快照:http://localhost:3000/api/metrics
```

compose 要点:
- `postgres` 用 `pgvector/pgvector:pg17` 镜像,自带向量扩展;`pg_isready` 健康检查通过后才启动 app
- `pgdata` 命名卷持久化数据库;`./docs/knowledge` 挂载,上传的文档不随容器重建丢失
- 容器内 `PG_HOST=postgres` 走服务名解析;`EMBEDDING_BASE_URL=host.docker.internal:1234` 回连宿主机 LM Studio
- 聊天模型走云端(OPENAI_BASE_URL),embedding 走本地——两者端点独立配置

### 本地生产模式(无 Docker)

```bash
npm run build && npm --prefix web run build   # 编译后端 + 打包前端
node dist/server/index.js                     # 单端口 3000 同时托管前端与 API
```

要求本机已运行:PostgreSQL(带 pgvector)、LM Studio(加载 nomic embedding 模型)。

### 监控

`GET /api/metrics` 返回:各路由请求数/错误数/平均与最大耗时、任务成功率(success/stopped/failed 三分类)。服务每 5 分钟向日志打一条快照。

## 路线图

- [x] 上下文窗口管理与会话隔离
- [x] 向量记忆(pgvector):save_memory / search_memory + 自动注入
- [x] RAG 知识库工具(分块入库 + 检索 + 评测)
- [x] 多 Agent 编排(手写状态机 + LangGraph 重写)
- [x] Web 控制台(Express + React + SSE 思考链路 + Docker 编排)
# ts-minimal-agent

手写原生 **ReAct Agent**(TypeScript + Node.js)——不依赖任何 Agent 框架,基于 OpenAI Function Calling 协议从零实现的工具调用循环。

## 项目亮点

- **手写 ReAct 循环**:Model → Think → Act(调工具)→ Observe → Loop,完全理解每一步在做什么
- **强类型**:全部类型抽离至 `src/types.ts`,无 `any`;成功/失败统一 `ToolCallResult` 结构回传模型
- **健壮性**:全局异常兜底 + 可重试策略(限流/超时自动续轮)
- **可观测**:INFO / WARN / ERROR 分级日志,打印每一轮模型思考、工具名、入参、返回
- **Token 成本统计**:每轮 + 累计用量,并落盘 `logs/token-usage.log`
- **密钥安全**:所有配置走 `.env`(`dotenv`),绝不硬编码

## 技术栈

TypeScript 5 · Node.js 20+ · OpenAI SDK v4 · tsx(零配置运行)

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

## 内置工具

| 工具 | 说明 |
|---|---|
| `get_current_time` | 获取当前本地时间 |
| `add_numbers` | 计算两个数字相加(含参数校验) |
| `save_memory` | 把用户事实/对话要点保存到 pgvector 长期记忆库 |
| `search_memory` | 按语义相似度检索历史记忆(Top-K,余弦距离) |

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
│   │   └── index.ts      # 工具注册表 + 执行器(统一 ToolCallResult)
│   └── infra/            # 基础设施
│       ├── config.ts     # .env 配置读取与校验
│       ├── logger.ts     # 分级日志(INFO/WARN/ERROR)
│       └── usage.ts      # Token 统计打印与落盘
├── .env.example    # 环境变量模板(提交)
├── .env            # 本地密钥(不提交)
├── logs/           # Token 消耗日志(不提交)
└── package.json
```

## 开发命令

```bash
npm run dev        # tsx 直接运行
npm run typecheck  # tsc --noEmit 类型检查
npm run build      # 编译到 dist/
```

## 路线图

- [ ] 上下文窗口管理与会话隔离
- [ ] 向量记忆(pgvector)
- [ ] RAG 知识库工具
- [ ] 多 Agent 编排(手写状态机 + LangGraph 重写)
- [ ] Web 控制台(Express + React)
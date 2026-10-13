# AGENTS.md

手写原生 ReAct Agent（TypeScript + Node.js），基于 OpenAI Function Calling 协议从零实现工具调用循环，不依赖任何 Agent 框架。

## 执行规则（必须严格遵守）

1. 一次只做一个 Todo，做完一个再做下一个（以 `AI-Agent开发岗位-Todo清单.md` 为准）。
2. 每完成一个 Todo，先保证代码可运行（`npm run typecheck` 通过 + 相关 case 实测），再 `git commit` 提交。
3. 每完成一个 Todo，及时同步两处状态：
   - 更新 `AI-Agent开发岗位-Todo清单.md` 中对应条目（勾选 `[x]` 并附简短完成说明）与「当前进度」区；
   - 同步会话 todo 列表状态。
4. 遇到卡住，直接贴代码，当场解决。
5. 每一步都对应 JD 能力点，可写入简历与面试讲解。
6. 禁止将 `.env`、密钥、`node_modules/`、`dist/`、`logs/*.log` 提交入库。

## 项目结构

- `src/index.ts` — 入口：演示用例，导出公共 API
- `src/agent.ts` — 核心 Agent 循环（`agentLoop`）
- `src/tools.ts` — 工具注册表 + 执行器（统一返回 `ToolCallResult`）
- `src/context.ts` — 上下文窗口管理（token 估算 + 超限摘要压缩）
- `src/session.ts` — 会话管理（按 sessionId 隔离）
- `src/usage.ts` — Token 统计打印与落盘
- `src/llm.ts` — OpenAI 客户端单例
- `src/config.ts` — `.env` 配置读取与校验
- `src/logger.ts` — 分级日志
- `src/types.ts` — 全部类型定义（Tool / Message / ToolCallResult / TokenUsage），禁止 `any`
- `.env` / `.env.example` — 配置（apiKey、baseURL、modelName、maxRound），密钥只存 `.env`
- `logs/token-usage.log` — Token 消耗日志（不提交）
- `README.md` — 项目说明与原理
- `AI-Agent开发岗位-Todo清单.md` — 唯一 Todo 真相源

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # tsx 运行 src/index.ts
npm run typecheck  # tsc --noEmit 类型检查（提交前必跑）
npm run build      # 编译到 dist/
```

## 代码约定

- TypeScript 5 · Node.js 20+ · OpenAI SDK v4 · tsx 运行 · ESM（相对导入带 `.js` 后缀）
- 分层架构：新能力放 `src/` 对应模块，依赖单向（index → agent → context/session/tools/usage → llm/config → logger），禁止反向依赖
- 全部类型抽到 `src/types.ts`，工具统一返回 `ToolCallResult`（`{ ok, data?, error? }`）
- 日志用分级 `logger`（INFO/WARN/ERROR，带时间戳与 tag），禁止裸 `console.log`
- Agent 循环：外层全局 try/catch 兜底；API 限流/超时可重试（continue），致命错误终止
- 每轮读取 `usage` 累计 Token，打印并追加写入 `logs/token-usage.log`

## 当前阶段

以 `AI-Agent开发岗位-Todo清单.md` 的「当前进度」区为准，不在此文件重复维护进度。

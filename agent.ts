import OpenAI from "openai";
import "dotenv/config";
import { mkdirSync, appendFileSync } from "node:fs";
import type { ToolArgs, ToolDefinition, ToolCallResult, ChatMessage, TokenUsage, AgentSession } from "./types.js";

// ========== 日志工具 Todo0-5：INFO / WARN / ERROR 分级 ==========
const timestamp = (): string => new Date().toISOString();

const logger = {
  info: (tag: string, message: string): void =>
    console.log(`[${timestamp()}] [INFO] [${tag}] ${message}`),
  warn: (tag: string, message: string): void =>
    console.warn(`[${timestamp()}] [WARN] [${tag}] ${message}`),
  error: (tag: string, message: string, detail?: unknown): void =>
    console.error(`[${timestamp()}] [ERROR] [${tag}] ${message}`, detail ?? ""),
};
// ============================================================

// ========== 配置 Todo0-4：从 .env 读取，禁止硬编码密钥 ==========
const config = {
  apiKey: process.env.OPENAI_API_KEY ?? "",
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL ?? "deepseek-v4-flash",
  maxRound: Number(process.env.MAX_ROUND ?? "3"),
  maxContextTokens: Number(process.env.MAX_CONTEXT_TOKENS ?? "1000"), // 上下文窗口 token 上限（估算值）Todo1-2
};

if (!config.apiKey) {
  logger.error("CONFIG", "缺少 OPENAI_API_KEY，请先复制 .env.example 为 .env 并填入密钥");
  process.exit(1);
}
// =============================================================

// 1. 初始化 OpenAI 客户端
const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
});

// 2. 定义工具
const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前本地时间",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_numbers",
      description: "计算两个数字相加",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number", description: "第一个数字" },
          b: { type: "number", description: "第二个数字" },
        },
        required: ["a", "b"],
      },
    },
  },
];

// 工具执行器：统一返回 ToolCallResult 结构，成功/失败都序列化为字符串回传模型
const executeTool = async (name: string, args: ToolArgs): Promise<ToolCallResult> => {
  switch (name) {
    case "get_current_time":
      return { ok: true, data: new Date().toLocaleString() };
    case "add_numbers": {
      const a = Number(args.a);
      const b = Number(args.b);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        return { ok: false, error: `入参必须为数字，实际收到 a=${args.a}, b=${args.b}` };
      }
      return { ok: true, data: `${a} + ${b} = ${a + b}` };
    }
    default:
      return { ok: false, error: `未知工具：${name}` };
  }
};

// Token 统计打印 + 写入日志文件 Todo0-3
const logTokenUsage = (roundUsage: TokenUsage, total: TokenUsage): void => {
  logger.info(
    "TOKEN",
    `本轮 prompt: ${roundUsage.prompt}, completion: ${roundUsage.completion}, total: ${roundUsage.total}`
  );
  try {
    mkdirSync("logs", { recursive: true });
    appendFileSync(
      "logs/token-usage.log",
      `${new Date().toISOString()} 本轮 prompt=${roundUsage.prompt} completion=${roundUsage.completion} total=${roundUsage.total} 累计=${total.total}\n`
    );
  } catch (err) {
    logger.error("TOKEN", "写入 token 日志文件失败", err);
  }
};

// 累计 Token 汇总打印
const printUsageTotal = (total: TokenUsage): void => {
  logger.info("TOKEN", `累计 prompt: ${total.prompt}, completion: ${total.completion}, total: ${total.total}`);
};

// ========== 会话管理 Todo1-1：按 sessionId 隔离对话 ==========
const sessions = new Map<string, AgentSession>();

// 获取或创建会话：同 sessionId 复用历史，新 sessionId 全新隔离
const getOrCreateSession = (sessionId: string): AgentSession => {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.set(sessionId, session);
    logger.info("SESSION", `创建新会话: ${sessionId}`);
  }
  return session;
};

// 查看会话（只读，便于调试）
const getSession = (sessionId: string): AgentSession | undefined => sessions.get(sessionId);

// 列出全部会话 ID
const listSessions = (): string[] => [...sessions.keys()];

// 清空指定会话历史
const clearSession = (sessionId: string): boolean => sessions.delete(sessionId);
// =================================================================

// ========== 上下文窗口管理 Todo1-2：估算 token + 超限自动摘要压缩 ==========
// 估算参数：约 2 个字符 ≈ 1 token（中文约 1~2 字符/token、英文约 4，取中间偏中文的启发式，足够做阈值判断）
const CHARS_PER_TOKEN = 2;
// 压缩时保留的最近消息条数（太短会丢上下文，太长压不下去）
const KEEP_RECENT_MESSAGES = 6;

// 提取一条消息的纯文本（content 可能是 string 或分段数组，另计 tool_calls 的 JSON 长度）
const messageTextLength = (msg: ChatMessage): number => {
  let len = 0;
  if (typeof msg.content === "string") {
    len += msg.content.length;
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if ("text" in part) len += part.text.length;
    }
  }
  if ("tool_calls" in msg && msg.tool_calls) {
    len += JSON.stringify(msg.tool_calls).length;
  }
  return len;
};

// 估算一组消息的总 token：文本字符数/3 + 每条消息固定开销 4
const estimateTokens = (msgs: ChatMessage[]): number =>
  msgs.reduce((sum, m) => sum + Math.ceil(messageTextLength(m) / CHARS_PER_TOKEN) + 4, 0);

// 调用模型把旧消息压缩成一段简短摘要；失败时返回 null（降级为直接截断）
const summarizeOldMessages = async (oldMessages: ChatMessage[]): Promise<string | null> => {
  // 把旧消息拼成「角色: 内容」的对话稿，超长截断防止摘要请求本身撑爆窗口
  const transcript = oldMessages
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : "[非文本内容]"}`.trim())
    .join("\n")
    .slice(0, 6000);
  try {
    const resp = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "user",
          content: `请用不超过120字的中文总结以下对话要点，保留人名、关键事实、数字与结论：\n\n${transcript}`,
        },
      ],
      max_tokens: 300,
    });
    const summary = resp.choices[0]?.message?.content?.trim();
    return summary || null;
  } catch (err) {
    logger.error("CONTEXT", "摘要压缩调用模型失败，降级为直接截断旧消息", err);
    return null;
  }
};

// 上下文压缩入口：估算 token 超过上限时触发——旧消息 → 摘要 system 消息，最近消息原样保留
// 原地 splice 修改 session.messages，保证外部持有的数组引用（如 agentLoop 内的 messages）依然有效
const compactContextIfNeeded = async (session: AgentSession): Promise<void> => {
  const beforeTokens = estimateTokens(session.messages);
  if (beforeTokens < config.maxContextTokens) return; // 未超限，不处理

  // 1. 从尾部保留最近 N 条完整消息；但至少保住最后 1 条（通常是本轮用户提问，不能被压掉）。
  //    keepStart 下限为 1：即使消息总数少于 KEEP_RECENT，旧消息（第 1 条起）也应参与压缩，
  //    否则短会话里单条超长消息永远压不掉。起始位置不能落在 tool 消息上
  //    （协议要求 tool 消息必须紧跟带 tool_calls 的 assistant 消息）
  let keepStart = Math.max(1, session.messages.length - KEEP_RECENT_MESSAGES);
  keepStart = Math.min(keepStart, session.messages.length - 1); // 最后一条永远保留
  while (keepStart < session.messages.length && session.messages[keepStart].role === "tool") {
    keepStart++;
  }
  const head = session.messages.slice(0, keepStart); // 待压缩的旧消息
  const tail = session.messages.slice(keepStart); // 原样保留的最近消息

  // 2. 没有可压缩的旧消息（如会话只有本轮一条消息）时跳过，避免无效摘要调用
  if (head.length === 0) {
    logger.warn("CONTEXT", `上下文估算 ${beforeTokens} tokens 超限，但没有可压缩的旧消息，跳过`);
    return;
  }

  // 3. 生成摘要；摘要失败则降级，用占位 system 消息代替（至少消息结构合法）
  const summary = await summarizeOldMessages(head);
  const summaryMsg: ChatMessage = {
    role: "system",
    content: summary ? `[历史摘要] ${summary}` : "[历史摘要]（摘要生成失败，早期对话内容已裁剪）",
  };
  const next = [summaryMsg, ...tail];

  // 4. 压缩后仍超限（如最近消息本身很长）→ 继续从尾部往前丢，保底不超过上限
  //    裁剪时不能拆散 tool_calls 配对：若被丢的是带 tool_calls 的 assistant，其后的 tool 回包必须一并丢弃
  while (estimateTokens(next) > config.maxContextTokens && next.length > 2) {
    const dropped = next.splice(1, 1)[0];
    if (
      dropped.role === "assistant" &&
      "tool_calls" in dropped &&
      dropped.tool_calls &&
      next[1] &&
      next[1].role === "tool"
    ) {
      next.splice(1, 1); // 连带丢弃对应的 tool 回包，避免孤立 tool 消息
    }
  }

  session.messages.splice(0, session.messages.length, ...next);
  logger.warn(
    "CONTEXT",
    `上下文压缩：估算 ${beforeTokens} → ${estimateTokens(session.messages)} tokens，旧消息 ${head.length} 条已摘要，保留最近 ${tail.length} 条`
  );
};
// ===========================================================================

// 3. 核心 Agent Loop（会话版：消息挂在 session 上，按 sessionId 隔离）
async function agentLoop(
  sessionId: string,
  prompt: string,
  maxRound: number = config.maxRound
): Promise<string> {
  const session = getOrCreateSession(sessionId);
  session.messages.push({ role: "user", content: prompt });
  session.updatedAt = new Date().toISOString();
  logger.info("SESSION", `会话 ${sessionId} 收到消息，当前历史长度=${session.messages.length}`);

  // Todo1-2：发送前检查上下文窗口，超限则自动摘要压缩（原地修改 session.messages）
  await compactContextIfNeeded(session);

  // 引用会话消息：循环内所有 push 持久化到 session，跨轮共享
  const messages: ChatMessage[] = session.messages;

  // 累计 token 消耗
  let usageTotal: TokenUsage = { prompt: 0, completion: 0, total: 0 };

  // Todo0-2 全局兜底：包裹整个循环，任何未捕获异常统一终止并打印
  try {
    for (let round = 0; round < maxRound; round++) {
      logger.info("AGENT", `===== 第 ${round + 1} 轮思考 =====`);
      let resp;
      try {
        resp = await openai.chat.completions.create({
          model: config.model,
          messages,
          tools,
          tool_choice: "auto",
        });
      } catch (error) {
        // 可重试类错误（限流/超时/服务端错误）：稍等片刻再重试，避免连续请求打满 RPM
        logger.error("API", "调用模型失败", error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
        messages.push({ role: "system", content: "模型调用出错，请重试" });
        continue; // 本轮失败，进入下一轮循环，不再访问resp
      }

      if (!resp) continue;

      // Token统计 Todo0-3
      const usage = resp.usage;
      if (usage) {
        usageTotal.prompt += usage.prompt_tokens;
        usageTotal.completion += usage.completion_tokens;
        usageTotal.total += usage.total_tokens;
        logTokenUsage(
          {
            prompt: usage.prompt_tokens,
            completion: usage.completion_tokens,
            total: usage.total_tokens,
          },
          usageTotal
        );
      }

      const choice = resp.choices[0];
      if (!choice.message) break;

      // 模型思考/输出内容
      if (choice.message.content) {
        logger.info("THINK", `模型输出: ${choice.message.content}`);
      }

      messages.push(choice.message);
      session.updatedAt = new Date().toISOString();

      // 没有工具调用，输出最终回答
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        const finalAnswer = choice.message.content ?? "";
        logger.info("AGENT", `最终回答: ${finalAnswer}`);
        return finalAnswer;
      }

      // 遍历所有工具调用
      for (const toolCall of choice.message.tool_calls) {
        logger.info("TOOL", `调用工具: ${toolCall.function.name}`);
        let args: ToolArgs = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch (parseErr) {
          logger.error("TOOL", `解析工具参数 JSON 失败（工具: ${toolCall.function.name}）`, parseErr);
          args = {};
        }
        logger.info("TOOL", `工具入参: ${JSON.stringify(args)}`);
        const toolResult = await executeTool(toolCall.function.name, args);
        const rendered = toolResult.ok
          ? `[成功] ${toolResult.data}`
          : `[失败] ${toolResult.error}`;
        logger.info("TOOL", `工具返回: ${rendered}`);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: rendered,
        });
      }
    }

    logger.warn("AGENT", "达到最大轮次限制，Agent 停止");
    printUsageTotal(usageTotal);
    return "[已停止] 达到最大轮次限制";
  } catch (error) {
    // 全局兜底：未知异常在此终止，不再继续循环
    logger.error("FATAL", "Agent 循环发生未捕获异常，已终止", error);
    printUsageTotal(usageTotal);
    return "[异常] Agent 循环终止";
  }
}

export { agentLoop, getOrCreateSession, getSession, listSessions, clearSession };

// Todo1-1 会话隔离验证：A 会话记住名字，B 会话独立不可见
// Todo1-2 上下文压缩验证：session-C 投喂长背景资料把估算 token 推过上限，触发自动摘要压缩
const main = async (): Promise<void> => {
  await agentLoop("session-A", "我叫小明，请记住我的名字");
  await agentLoop("session-A", "我叫什么名字？");
  await agentLoop("session-B", "我叫什么名字？");

  // Todo1-2：长文本（约 1500+ tokens 估算）→ 历史超上限 → 触发摘要压缩，再提问验证压缩后仍可正常回答
  const longContext =
    "以下是项目背景资料：公司名叫启明科技，主营业务是企业级 SaaS 客服系统，" +
    "今年营收目标为一个亿，重点客户包括华东银行的智能客服项目、东方航空的工单系统项目。" +
    "团队规模 60 人，其中研发 40 人，产品 10 人，销售 10 人。".repeat(60) +
    "另外补充：我们正在招聘 AI Agent 工程师，要求熟悉 TypeScript、RAG 与多 Agent 编排。";
  await agentLoop("session-C", longContext);
  await agentLoop("session-C", "我刚才提供的背景资料里，公司叫什么名字？主要客户有哪两个？");

  logger.info("SESSION", `当前会话列表: ${listSessions().join(", ")}`);
  const a = getSession("session-A");
  logger.info("SESSION", `session-A 消息数=${a?.messages.length ?? 0}（应 >0）`);
  const c = getSession("session-C");
  logger.info("SESSION", `session-C 消息数=${c?.messages.length ?? 0}（压缩后应明显小于长文本原始条数）`);
};

main();

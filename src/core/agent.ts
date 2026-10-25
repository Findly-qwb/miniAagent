import { openai } from "../llm/client.js";
import { config } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import { executeTool } from "../tools/index.js";
import { getToolDefs, getToolDefsByNames } from "../tools/registry.js";
import { retrieveRelevantMemory } from "../tools/memory.js";
import { logTokenUsage, printUsageTotal } from "../infra/usage.js";
import { getOrCreateSession } from "./session.js";
import { compactContextIfNeeded } from "./context.js";
import type { ChatMessage, ToolArgs, TokenUsage } from "../types.js";

// Todo3-3：角色化运行参数——独立 system prompt + 工具白名单（默认全量、无角色，向后兼容）
export interface AgentRunOptions {
  systemPrompt?: string;
  toolNames?: string[];
  // Todo5-4：每轮 token 用量回调（评测脚本累计成本用），不影响现有调用方
  onUsage?: (round: TokenUsage) => void;
}

// 可重试类 API 错误：限流(429)、超时(408)、服务端 5xx、网络抖动——Todo5-4 评测暴露 3s 退避对 RPM 窗口太短
const isRetryableApiError = (err: unknown): boolean => {
  const e = err as { status?: number; message?: string };
  if (e?.status === 429 || e?.status === 408) return true;
  if (typeof e?.status === "number" && e.status >= 500) return true;
  return /timeout|ETIMEDOUT|ECONNRESET|rate.?limit|429|overloaded/i.test(String(e?.message ?? ""));
};

// 核心 Agent Loop（会话版：消息挂在 session 上，按 sessionId 隔离）
export async function agentLoop(
  sessionId: string,
  prompt: string,
  maxRound: number = config.maxRound,
  opts: AgentRunOptions = {}
): Promise<string> {
  const session = getOrCreateSession(sessionId);
  session.messages.push({ role: "user", content: prompt });
  session.updatedAt = new Date().toISOString();
  logger.info("SESSION", `会话 ${sessionId} 收到消息，当前历史长度=${session.messages.length}`);

  // Todo1-2：发送前检查上下文窗口，超限则自动摘要压缩（原地修改 session.messages）
  await compactContextIfNeeded(session);

  // 引用会话消息：循环内所有 push 持久化到 session，跨轮共享
  const messages: ChatMessage[] = session.messages;

  // Todo1-6：发送前自动检索长期记忆，作为临时 system 前缀注入（不落会话历史，避免逐轮堆积）
  const memoryDigest = await retrieveRelevantMemory(prompt);
  // Todo3-3：角色 system prompt 永远置顶，记忆注入紧随其后；工具按角色白名单裁剪
  const prefix: ChatMessage[] = [];
  if (opts.systemPrompt) prefix.push({ role: "system", content: opts.systemPrompt });
  if (memoryDigest) prefix.push({ role: "system", content: memoryDigest });
  const roleTools = opts.toolNames ? getToolDefsByNames(opts.toolNames) : getToolDefs();

  // 累计 token 消耗
  let usageTotal: TokenUsage = { prompt: 0, completion: 0, total: 0 };

  // Todo0-2 全局兜底：包裹整个循环，任何未捕获异常统一终止并打印
  let apiRetry = 0; // 连续 API 失败计数（指数退避用，成功即清零）
  try {
    for (let round = 0; round < maxRound; round++) {
      logger.info("AGENT", `===== 第 ${round + 1} 轮思考 =====`);
      let resp;
      try {
        resp = await openai.chat.completions.create({
          model: config.model,
          messages: [...prefix, ...messages],
          tools: roleTools,
          tool_choice: "auto",
        });
        apiRetry = 0;
      } catch (error) {
        // 可重试类错误（限流/超时/服务端）：指数退避（429 的 RPM 窗口以分钟计，固定 3s 不够——Todo5-4 实测）；
        // 退避重试不消耗轮次预算，最多 3 次后仍失败才计入轮次（防无限卡死）
        apiRetry++;
        logger.error("API", `调用模型失败（第 ${apiRetry} 次退避重试）`, error);
        if (isRetryableApiError(error) && apiRetry <= 3) {
          const backoffMs = Math.min(30000, 8000 * 2 ** (apiRetry - 1));
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          round--; // 本轮作废重来，不占 maxRound 预算
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
        messages.push({ role: "system", content: "模型调用出错，请重试" });
        continue; // 本轮失败，进入下一轮循环，不再访问resp
      }

      if (!resp) continue;

      // Token统计 Todo0-3
      const usage = resp.usage;
      if (usage) {
        const roundUsage: TokenUsage = {
          prompt: usage.prompt_tokens,
          completion: usage.completion_tokens,
          total: usage.total_tokens,
        };
        usageTotal.prompt += roundUsage.prompt;
        usageTotal.completion += roundUsage.completion;
        usageTotal.total += roundUsage.total;
        opts.onUsage?.(roundUsage);
        logTokenUsage(roundUsage, usageTotal);
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
        const toolResult = await executeTool(toolCall.function.name, args, sessionId);
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

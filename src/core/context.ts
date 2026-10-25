import { openai } from "../llm/client.js";
import { config } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import type { AgentSession, ChatMessage } from "../types.js";

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
export const estimateTokens = (msgs: ChatMessage[]): number =>
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
      max_tokens: 2000, // 推理模型思考吃 token，300 预算会 finish=length 空输出
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
export const compactContextIfNeeded = async (session: AgentSession): Promise<void> => {
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

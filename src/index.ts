import { logger } from "./infra/logger.js";
import { agentLoop } from "./core/agent.js";
import { getSession, listSessions } from "./core/session.js";

export { agentLoop } from "./core/agent.js";
export { getOrCreateSession, getSession, listSessions, clearSession } from "./core/session.js";

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

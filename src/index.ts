import { logger } from "./infra/logger.js";
import { initMemoryStore, pool } from "./infra/db.js";
import { agentLoop } from "./core/agent.js";
import { clearSession, getSession, listSessions } from "./core/session.js";

export { agentLoop } from "./core/agent.js";
export { getOrCreateSession, getSession, listSessions, clearSession } from "./core/session.js";

// Todo1-1 会话隔离验证：A 会话记住名字，B 会话独立不可见
// Todo1-2 上下文压缩验证：session-C 投喂长背景资料把估算 token 推过上限，触发自动摘要压缩
const main = async (): Promise<void> => {
  // Todo1-5：启动即确保向量库表/索引就绪（幂等），供 save_memory/search_memory 工具使用
  await initMemoryStore();

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

  // Todo1-5 长期记忆验证：session-D 让模型自主调 save_memory 落库；
  // 清空其内存会话（模拟进程重启丢失短期记忆）后，在全新 session-E 提问，
  // 模型只能靠 search_memory 从 pgvector 召回答案，证明记忆跨会话持久化
  await agentLoop("session-D", "请记住这个重要事实：我的猫叫秋秋，它是2023年3月3日出生的。保存到长期记忆。");
  clearSession("session-D");
  await agentLoop("session-E", "我的猫叫什么名字？它是什么时候出生的？");

  // Todo1-6 自动检索注入验证：session-G 零历史提问，日志应出现「注入系统 prompt」，
  // 即使模型本轮不调 search_memory，也能直接凭注入的记忆答出名字
  await agentLoop("session-G", "你还记得我叫什么名字吗？");

  logger.info("SESSION", `当前会话列表: ${listSessions().join(", ")}`);
  const a = getSession("session-A");
  logger.info("SESSION", `session-A 消息数=${a?.messages.length ?? 0}（应 >0）`);
  const c = getSession("session-C");
  logger.info("SESSION", `session-C 消息数=${c?.messages.length ?? 0}（压缩后应明显小于长文本原始条数）`);

  // 释放 pg 连接池，否则进程不会退出
  await pool.end();
};

main();

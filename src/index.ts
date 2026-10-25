import { logger } from "./infra/logger.js";
import { initMemoryStore, pool } from "./infra/db.js";
import { agentLoop } from "./core/agent.js";
import { clearSession, getSession, listSessions } from "./core/session.js";
import { initKnowledgeStore, ingestDirectory } from "./rag/knowledge.js";
import { connectMcpServer, closeMcpClients, selfMcpSpec } from "./mcp/client.js";

export { agentLoop } from "./core/agent.js";
export { getOrCreateSession, getSession, listSessions, clearSession } from "./core/session.js";

// Todo1-1 会话隔离验证：A 会话记住名字，B 会话独立不可见
// Todo1-2 上下文压缩验证：session-C 投喂长背景资料把估算 token 推过上限，触发自动摘要压缩
const main = async (): Promise<void> => {
  // Todo1-5：启动即确保向量库表/索引就绪（幂等），供 save_memory/search_memory 工具使用
  await initMemoryStore();
  // Todo2-1~2-5：初始化知识库表并把业务文档（docs/knowledge/，与项目文档隔离）幂等灌入
  await initKnowledgeStore();
  const ingest = await ingestDirectory("docs/knowledge");
  logger.info("RAG", `知识库初始化：${ingest.ok ? ingest.data : ingest.error}`);

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

  // Todo2-6 知识库自主检索验证：产品问题，模型应主动调 search_knowledge_base 后作答
  await agentLoop("session-KB", "我们想采购你们的智能客服系统，专业版一年多少钱？支持多少个坐席？");

  // Todo3-1 任务规划验证：复杂多步任务，模型应调 plan_task 输出子任务列表
  await agentLoop(
    "session-PLAN",
    "我要给老板做一份启明智能客服系统 vs 竞品的分析报告，这个任务比较复杂，请先用工具把它拆解成可执行的子任务计划。"
  );

  // Todo3-4 多 Agent 协同验证：用户要完整交付物，模型应调 run_task 触发
  // 规划→执行→校验→交付 全流水线（内部四角色协作），最终拿到成品而非计划
  await agentLoop(
    "session-PIPE",
    "帮我写一份启明智能客服系统的产品一页纸介绍，必须包含产品定位、全部核心功能和三个版本的价格与坐席数，直接给我成品。"
  );

  // Todo5-1 MCP 验证：运行期接入 MCP 工具服务器，模型应能发现并自主调用 mcp_text_* 工具
  await connectMcpServer(selfMcpSpec("text", "server"));
  await agentLoop(
    "session-MCP",
    "请用工具帮我统计这句话的单词数和字符数：\"the quick brown fox jumps over the lazy dog\""
  );

  logger.info("SESSION", `当前会话列表: ${listSessions().join(", ")}`);
  const a = getSession("session-A");
  logger.info("SESSION", `session-A 消息数=${a?.messages.length ?? 0}（应 >0）`);
  const c = getSession("session-C");
  logger.info("SESSION", `session-C 消息数=${c?.messages.length ?? 0}（压缩后应明显小于长文本原始条数）`);

  // 释放 MCP 子进程与 pg 连接池，否则进程不会退出
  await closeMcpClients();
  await pool.end();
};

main();

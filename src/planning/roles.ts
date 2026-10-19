import { openai } from "../llm/client.js";
import { config } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import { agentLoop } from "../core/agent.js";
import { planTask, extractJson } from "./planner.js";
import type { SubTask, TaskPlan } from "../types.js";

// ========== Todo3-3：多角色 Agent 拆分 ==========
// 每个角色 = 独立 system prompt（人设与边界）+ 工具白名单（能力边界）
// Planner 只拆解不执行；Executor 只执行不再规划；Reviewer 只判断不调工具

// ---------- Planner（复用 planner.ts 的拆解逻辑，包装成角色） ----------
export const plannerAgent = async (task: string, maxSubtasks = 6): Promise<TaskPlan> => {
  logger.info("ROLE", "[Planner] 开始任务拆解");
  return planTask(task, maxSubtasks);
};

// ---------- Executor（带工具的执行者） ----------
const EXECUTOR_SYSTEM = `你是任务执行者（Executor）。你的唯一职责是把交给你的子任务做完并输出结果。
规则：
1. 只做当前子任务，不要规划新任务、不要调用 plan_task
2. 涉及产品、价格、功能、业务流程等业务事实时，必须调用 search_knowledge_base 检索文档，严禁凭记忆或常识编造数字
3. 需要用户历史信息时调用 search_memory
4. 直接输出执行结果，不要反问用户`;

// 执行者工具白名单：只给干活要用的，不给规划类工具（防递归规划）；
// 也不给 save_memory——实测发现子任务把编造的"事实"存进记忆库会长期毒化下游（Todo3-2 踩坑）
export const EXECUTOR_TOOLS = [
  "get_current_time",
  "add_numbers",
  "search_knowledge_base",
  "search_memory",
];

export const executorAgent = async (sessionId: string, prompt: string): Promise<string> => {
  logger.info("ROLE", `[Executor] 执行：${prompt.slice(0, 40)}…`);
  return agentLoop(sessionId, prompt, config.maxRound, {
    systemPrompt: EXECUTOR_SYSTEM,
    toolNames: EXECUTOR_TOOLS,
  });
};

// ---------- Reviewer（只判断，无工具） ----------
const REVIEW_SYSTEM = `你是任务校验员（Reviewer）。对照原始任务，检查各子任务结果合起来是否完整达成任务目标。
规则：
1. 你只做判断，不调用任何工具、不补充内容
2. 重点检查：任务明确要求的要素是否都在结果里出现、数字/事实是否具体而非含糊
3. 若结果里出现"示例数据/假设/待补充/联系销售"等推诿措辞，视为未达标
4. passed=是否达标；incompleteIds=未达标或缺失的子任务 id（达标给空数组）；feedback=一句话指出主要不足`;

const REVIEW_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "review_verdict",
    strict: true,
    schema: {
      type: "object",
      properties: {
        passed: { type: "boolean" },
        incompleteIds: { type: "array", items: { type: "number" } },
        feedback: { type: "string" },
      },
      required: ["passed", "incompleteIds", "feedback"],
      additionalProperties: false,
    },
  },
} as const;

export interface ReviewVerdict {
  passed: boolean;
  incompleteIds: number[];
  feedback: string;
}

export interface SubTaskResult {
  id: number;
  title: string;
  result: string;
}

const normalizeVerdict = (v: Record<string, unknown>): ReviewVerdict => ({
  passed: v.passed === true,
  incompleteIds: Array.isArray(v.incompleteIds)
    ? v.incompleteIds.map(Number).filter(Number.isInteger)
    : [],
  feedback: String(v.feedback ?? ""),
});

export const reviewerAgent = async (
  task: string,
  results: SubTaskResult[]
): Promise<ReviewVerdict> => {
  logger.info("ROLE", "[Reviewer] 校验产出覆盖度");
  // 摘要压缩到每结果 200 字：长 markdown 易触发约束解码空转（实测 finish=length 空输出）
  const digest = results
    .map((r) => `#${r.id} ${r.title}：${r.result.replace(/\s+/g, " ").slice(0, 200)}`)
    .join("\n");
  const messages = [
    { role: "system" as const, content: REVIEW_SYSTEM },
    { role: "user" as const, content: `原始任务：${task}\n\n子任务结果：\n${digest}` },
  ];
  // 三级降级：schema 约束×2 → 无 schema 纯提示词 → 放行留 WARN（不阻塞交付）
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await openai.chat.completions.create({
        model: config.model,
        messages,
        temperature: 0.1,
        response_format: REVIEW_SCHEMA,
        max_tokens: 1000,
      });
      const v = extractJson(resp.choices[0]?.message?.content ?? "");
      if (v) return normalizeVerdict(v);
      logger.warn("ROLE", `Reviewer 输出无合法 JSON，finish=${resp.choices[0]?.finish_reason}`);
    } catch (err) {
      logger.error("ROLE", `Reviewer 第 ${attempt} 次调用失败`, err);
    }
  }
  try {
    const resp = await openai.chat.completions.create({
      model: config.model,
      messages: [
        ...messages,
        { role: "user" as const, content: '只输出 JSON：{"passed":true/false,"incompleteIds":[],"feedback":"..."}' },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });
    const v = extractJson(resp.choices[0]?.message?.content ?? "");
    if (v) return normalizeVerdict(v);
  } catch (err) {
    logger.error("ROLE", "Reviewer 无 schema 兜底也失败", err);
  }
  logger.warn("ROLE", "Reviewer 降级：校验失败视为通过");
  return { passed: true, incompleteIds: [], feedback: "校验降级：调用失败视为通过" };
};

// ---------- 交付整合（汇总角色，复用 Executor 但换人设） ----------
const SYNTHESIZER_SYSTEM = `你是交付整合者。把多个子任务的执行结果整合为一份面向用户的完整交付物。
规则：只整合与改写，不新增未经检索的事实；保留结果中的具体数字与来源信息；直接输出成品。`;

export const synthesizerAgent = async (sessionId: string, prompt: string): Promise<string> => {
  logger.info("ROLE", "[Synthesizer] 整合最终交付");
  return agentLoop(sessionId, prompt, config.maxRound, {
    systemPrompt: SYNTHESIZER_SYSTEM,
    toolNames: ["search_knowledge_base"],
  });
};

export type { SubTask };

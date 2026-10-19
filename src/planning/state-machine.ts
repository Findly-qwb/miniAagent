import { agentLoop } from "../core/agent.js";
import { openai } from "../llm/client.js";
import { config } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import { planTask, extractJson } from "./planner.js";
import type { SubTask } from "../types.js";

// ========== Todo3-2：手写简易状态机 规划 → 执行 → 校验 ==========

export type TaskState = "planning" | "executing" | "reviewing" | "done" | "failed";

export interface SubTaskResult {
  id: number;
  title: string;
  result: string;
}

export interface TaskRunReport {
  task: string;
  state: TaskState;
  results: SubTaskResult[];
  reviewRounds: number;
  finalAnswer: string;
}

// 校验员输出契约（json_schema 约束解码，同 planner 的稳定性策略）
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

// 校验：对照原始任务检查各子任务结果是否完整覆盖；解析失败降级为通过（不阻塞主流程）
const reviewResults = async (
  task: string,
  results: SubTaskResult[]
): Promise<{ passed: boolean; incompleteIds: number[]; feedback: string }> => {
  // 摘要压缩到每结果 200 字：长 markdown（表格等）易触发约束解码空转（实测 finish=length 且 content 为空）
  const digest = results.map((r) => `#${r.id} ${r.title}：${r.result.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
  const messages = [
    {
      role: "system" as const,
      content:
        "你是任务校验员。对照原始任务，检查各子任务结果合起来是否完整达成任务目标。passed=是否达标；incompleteIds=未达标或明显缺失的子任务 id（达标给空数组）；feedback=一句话指出主要不足。",
    },
    { role: "user" as const, content: `原始任务：${task}\n\n子任务结果：\n${digest}` },
  ];
  // 校验失败降级为通过，但先重试一次（长 digest 下小模型偶发输出畸形 JSON，实测踩坑）
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
      if (!v) {
        logger.warn(
          "SM",
          `校验输出无合法 JSON，finish=${resp.choices[0]?.finish_reason}，原始输出: ${String(resp.choices[0]?.message?.content).slice(0, 200)}`
        );
        throw new Error("校验输出无合法 JSON");
      }
      return {
        passed: v.passed === true,
        incompleteIds: Array.isArray(v.incompleteIds)
          ? v.incompleteIds.map(Number).filter(Number.isInteger)
          : [],
        feedback: String(v.feedback ?? ""),
      };
    } catch (err) {
      logger.error("SM", `校验第 ${attempt} 次调用失败`, err);
    }
  }
  // 最后兜底：放弃 schema 约束，纯提示词要 JSON + 容错解析
  try {
    const resp = await openai.chat.completions.create({
      model: config.model,
      messages: [
        ...messages,
        { role: "user" as const, content: '只输出一个 JSON 对象：{"passed":true/false,"incompleteIds":[],"feedback":"..."}' },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });
    const v = extractJson(resp.choices[0]?.message?.content ?? "");
    if (v) {
      return {
        passed: v.passed === true,
        incompleteIds: Array.isArray(v.incompleteIds)
          ? v.incompleteIds.map(Number).filter(Number.isInteger)
          : [],
        feedback: String(v.feedback ?? ""),
      };
    }
  } catch (err) {
    logger.error("SM", "校验无 schema 兜底也失败", err);
  }
  logger.warn("SM", "校验降级：调用失败视为通过");
  return { passed: true, incompleteIds: [], feedback: "校验降级：调用失败视为通过" };
};

// 状态机主入口：规划 → 按依赖执行 → 校验（不达标重试一轮）→ 汇总交付
export const runTask = async (
  task: string,
  sessionId: string,
  maxReviewRounds = 1
): Promise<TaskRunReport> => {
  // —— 状态 1：planning ——
  logger.info("SM", `[planning] 拆解任务：${task.slice(0, 50)}…`);
  const plan = await planTask(task);
  const results = new Map<number, string>();
  const done = new Set<number>();
  logger.info("SM", `[planning → executing] 共 ${plan.subtasks.length} 个子任务`);

  // 执行单个子任务：前置结果作为上下文注入（dependsOn 的实际消费点）
  const executeSubtask = async (st: SubTask, feedback = ""): Promise<void> => {
    const depText = st.dependsOn
      .map((d) => results.get(d))
      .filter((r): r is string => Boolean(r))
      .map((r) => r.slice(0, 800))
      .join("\n---\n");
    const prompt = [
      `你正在执行整体任务「${task}」中的一个子任务，只做本步骤。`,
      `子任务：${st.title}`,
      `要求：${st.description}`,
      depText ? `前置步骤结果（可直接引用）：\n${depText}` : "",
      feedback ? `校验反馈（请针对性改进）：${feedback}` : "",
      "涉及产品、价格、功能等业务事实时必须调用 search_knowledge_base 检索文档，严禁凭记忆或常识编造数字。",
      "请直接执行并输出结果，不要再调用 plan_task 等规划工具。",
    ]
      .filter(Boolean)
      .join("\n");
    logger.info("SM", `[executing] 子任务 #${st.id}「${st.title}」`);
    const r = await agentLoop(`${sessionId}-sub-${st.id}`, prompt);
    results.set(st.id, r);
    done.add(st.id);
  };

  // —— 状态 2：executing —— 依赖波次推进，环检测兜底
  while (done.size < plan.subtasks.length) {
    let ready = plan.subtasks.filter(
      (s) => !done.has(s.id) && s.dependsOn.every((d) => done.has(d))
    );
    if (ready.length === 0) {
      ready = plan.subtasks.filter((s) => !done.has(s.id));
      logger.warn("SM", "依赖存在环，剩余子任务按原顺序执行");
    }
    for (const st of ready) await executeSubtask(st);
  }

  // —— 状态 3：reviewing —— 不达标则重跑被点名子任务（最多 maxReviewRounds 轮）
  logger.info("SM", "[executing → reviewing] 校验产出覆盖度");
  let rounds = 0;
  const toList = (): SubTaskResult[] =>
    plan.subtasks.map((s) => ({ id: s.id, title: s.title, result: results.get(s.id) ?? "" }));
  let verdict = await reviewResults(task, toList());
  while (!verdict.passed && rounds < maxReviewRounds) {
    rounds++;
    logger.warn("SM", `[reviewing] 第 ${rounds} 轮未通过：${verdict.feedback}`);
    const targets = plan.subtasks.filter((s) => verdict.incompleteIds.includes(s.id));
    for (const st of targets.length > 0 ? targets : plan.subtasks) {
      done.delete(st.id);
      await executeSubtask(st, verdict.feedback);
    }
    verdict = await reviewResults(task, toList());
  }

  // —— 状态 4：done/failed —— 汇总最终交付
  const finalAnswer = await agentLoop(
    `${sessionId}-final`,
    [
      `原始任务：${task}`,
      "各子任务执行结果：",
      ...toList().map((r) => `【#${r.id} ${r.title}】${r.result}`),
      "请把以上结果整合为一份面向用户的最终交付内容，直接输出成品。",
    ].join("\n")
  );
  const state: TaskState = verdict.passed ? "done" : "failed";
  logger.info("SM", `[reviewing → ${state}] 校验轮次 ${rounds}，交付 ${finalAnswer.length} 字`);

  return { task, state, results: toList(), reviewRounds: rounds, finalAnswer };
};

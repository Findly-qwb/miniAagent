import { logger } from "../infra/logger.js";
import { clearSession } from "../core/session.js";
import {
  plannerAgent,
  executorAgent,
  reviewerAgent,
  synthesizerAgent,
  type SubTaskResult,
  type ReviewVerdict,
} from "./roles.js";
import type { SubTask } from "../types.js";

// ========== Todo3-2/3-3：状态机编排多角色 Agent：规划 → 执行 → 校验 → 交付 ==========

export type TaskState = "planning" | "executing" | "reviewing" | "done" | "failed";

export interface TaskRunReport {
  task: string;
  state: TaskState;
  results: SubTaskResult[];
  reviewRounds: number;
  finalAnswer: string;
}

// 状态机主入口：Planner 拆解 → Executor 按依赖执行 → Reviewer 校验（不达标重试）→ Synthesizer 交付
export const runTask = async (
  task: string,
  sessionId: string,
  maxReviewRounds = 1
): Promise<TaskRunReport> => {
  // —— 状态 1：planning（Planner 角色）——
  logger.info("SM", `[planning] 拆解任务：${task.slice(0, 50)}…`);
  const plan = await plannerAgent(task);
  const results = new Map<number, string>();
  const done = new Set<number>();
  logger.info("SM", `[planning → executing] 共 ${plan.subtasks.length} 个子任务`);

  // 执行单个子任务：交给 Executor 角色，前置结果作为上下文注入（dependsOn 的实际消费点）
  const executeSubtask = async (st: SubTask, feedback = ""): Promise<void> => {
    const depText = st.dependsOn
      .map((d) => results.get(d))
      .filter((r): r is string => Boolean(r))
      .map((r) => r.slice(0, 800))
      .join("\n---\n");
    const prompt = [
      `整体任务：${task}`,
      `当前子任务 #${st.id}：${st.title}`,
      `要求：${st.description}`,
      depText ? `前置步骤结果（可直接引用）：\n${depText}` : "",
      feedback ? `校验反馈（请针对性改进）：${feedback}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    logger.info("SM", `[executing] 子任务 #${st.id}「${st.title}」`);
    const r = await executorAgent(`${sessionId}-sub-${st.id}`, prompt);
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

  // —— 状态 3：reviewing（Reviewer 角色）—— 不达标重跑点名子任务，最多 maxReviewRounds 轮
  logger.info("SM", "[executing → reviewing]");
  let rounds = 0;
  const toList = (): SubTaskResult[] =>
    plan.subtasks.map((s) => ({ id: s.id, title: s.title, result: results.get(s.id) ?? "" }));
  let verdict: ReviewVerdict = await reviewerAgent(task, toList());
  while (!verdict.passed && rounds < maxReviewRounds) {
    rounds++;
    logger.warn("SM", `[reviewing] 第 ${rounds} 轮未通过：${verdict.feedback}`);
    const targets = plan.subtasks.filter((s) => verdict.incompleteIds.includes(s.id));
    for (const st of targets.length > 0 ? targets : plan.subtasks) {
      done.delete(st.id);
      await executeSubtask(st, verdict.feedback);
    }
    verdict = await reviewerAgent(task, toList());
  }

  // —— 状态 4：done/failed（Synthesizer 角色）—— 汇总最终交付
  const finalAnswer = await synthesizerAgent(
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

  // Todo3-7：回收流水线子会话（sub-1..N/final），防内存 Map 随任务数无限堆积；
  // 子会话只是执行容器，结果已在 results/finalAnswer 中，删之无损
  for (const st of plan.subtasks) clearSession(`${sessionId}-sub-${st.id}`);
  clearSession(`${sessionId}-final`);

  return { task, state, results: toList(), reviewRounds: rounds, finalAnswer };
};

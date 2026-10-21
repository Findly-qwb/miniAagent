import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
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

// ========== Todo3-5：用 LangGraph 重写多 Agent 流水线 ==========
// 与手写 state-machine.ts 行为等价，差异只在编排层：
//   手写 = while 循环 + if 判断推进状态；LangGraph = 声明节点 + 条件边，图引擎驱动

// 图状态 schema：Annotation 声明字段与默认值，节点返回增量合并
const PipelineState = Annotation.Root({
  task: Annotation<string>,
  sessionId: Annotation<string>,
  maxReviewRounds: Annotation<number>,
  subtasks: Annotation<SubTask[]>({ reducer: (_a, b) => b, default: () => [] }),
  results: Annotation<Record<number, string>>({ reducer: (_a, b) => b, default: () => ({}) }),
  done: Annotation<number[]>({ reducer: (a, b) => b, default: () => [] }),
  redoIds: Annotation<number[]>({ reducer: (_a, b) => b, default: () => [] }), // 重试轮：待返工子任务
  feedback: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  reviewRounds: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  verdict: Annotation<ReviewVerdict | null>({ reducer: (_a, b) => b, default: () => null }),
  finalAnswer: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
});

type Pipeline = typeof PipelineState.State;

// 取某子任务的前置产出拼 prompt（与手写版 executeSubtask 逻辑一致）
const buildSubPrompt = (state: Pipeline, st: SubTask): string => {
  const depText = st.dependsOn
    .map((d) => state.results[d])
    .filter((r): r is string => Boolean(r))
    .map((r) => r.slice(0, 800))
    .join("\n---\n");
  return [
    `整体任务：${state.task}`,
    `当前子任务 #${st.id}：${st.title}`,
    `要求：${st.description}`,
    depText ? `前置步骤结果（可直接引用）：\n${depText}` : "",
    state.feedback ? `校验反馈（请针对性改进）：${state.feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const toList = (state: Pipeline): SubTaskResult[] =>
  state.subtasks.map((s) => ({ id: s.id, title: s.title, result: state.results[s.id] ?? "" }));

// —— 节点：planning ——
const planningNode = async (state: Pipeline): Promise<Partial<Pipeline>> => {
  logger.info("LG", "[planning] Planner 拆解任务");
  const plan = await plannerAgent(state.task);
  return { subtasks: plan.subtasks };
};

// —— 节点：executing —— 每轮处理一波就绪子任务，未完成由条件边回流自身
const executingNode = async (state: Pipeline): Promise<Partial<Pipeline>> => {
  const doneSet = new Set(state.done);
  const results = { ...state.results };

  // 重试轮：先撤销点名子任务的完成标记与旧产出（redoIds 消费后即清空）
  if (state.redoIds.length > 0) {
    for (const id of state.redoIds) {
      doneSet.delete(id);
      delete results[id];
    }
  }

  // 依赖全完成的为就绪；环兜底取剩余全部
  let ready = state.subtasks.filter(
    (s) => !doneSet.has(s.id) && s.dependsOn.every((d) => doneSet.has(d))
  );
  if (ready.length === 0) ready = state.subtasks.filter((s) => !doneSet.has(s.id));

  for (const st of ready) {
    logger.info("LG", `[executing] Executor 子任务 #${st.id}「${st.title}」`);
    const r = await executorAgent(`${state.sessionId}-sub-${st.id}`, buildSubPrompt(state, st));
    results[st.id] = r;
    doneSet.add(st.id);
  }

  return { results, done: [...doneSet], redoIds: [], feedback: "" };
};

// —— 节点：reviewing —— 不通过且未超重试上限 → 记下点名任务+反馈+轮次+1（供 executing 返工）
const reviewingNode = async (state: Pipeline): Promise<Partial<Pipeline>> => {
  logger.info("LG", "[reviewing] Reviewer 校验产出");
  const verdict = await reviewerAgent(state.task, toList(state));
  if (verdict.passed) return { verdict, redoIds: [], feedback: "" };
  if (state.reviewRounds >= state.maxReviewRounds) return { verdict, redoIds: [], feedback: "" };
  return {
    verdict,
    redoIds: verdict.incompleteIds.length > 0 ? verdict.incompleteIds : state.subtasks.map((s) => s.id),
    feedback: verdict.feedback,
    reviewRounds: state.reviewRounds + 1,
  };
};

// —— 节点：synthesizing ——
const synthesizingNode = async (state: Pipeline): Promise<Partial<Pipeline>> => {
  logger.info("LG", "[synthesizing] Synthesizer 整合交付");
  const finalAnswer = await synthesizerAgent(
    `${state.sessionId}-final`,
    [
      `原始任务：${state.task}`,
      "各子任务执行结果：",
      ...toList(state).map((r) => `【#${r.id} ${r.title}】${r.result}`),
      "请把以上结果整合为一份面向用户的最终交付内容，直接输出成品。",
    ].join("\n")
  );
  return { finalAnswer };
};

// —— 条件路由 ——
// executing 后：全完成 → reviewing；否则 → 回 executing 跑下一波
const afterExecute = (state: Pipeline): "reviewing" | "executing" =>
  state.done.length >= state.subtasks.length ? "reviewing" : "executing";

// reviewing 后：redoIds 非空（reviewing 判定需返工）→ 回 executing；否则 → synthesizing
const afterReview = (state: Pipeline): "synthesizing" | "executing" =>
  state.redoIds.length > 0 ? "executing" : "synthesizing";

// 构建图（每次新建，无全局副作用）
const buildGraph = () =>
  new StateGraph(PipelineState)
    .addNode("planning", planningNode)
    .addNode("executing", executingNode)
    .addNode("reviewing", reviewingNode)
    .addNode("synthesizing", synthesizingNode)
    .addEdge(START, "planning")
    .addEdge("planning", "executing")
    .addConditionalEdges("executing", afterExecute, ["reviewing", "executing"])
    .addConditionalEdges("reviewing", afterReview, ["synthesizing", "executing"])
    .addEdge("synthesizing", END)
    .compile();

export interface LangGraphRunReport {
  task: string;
  state: "done" | "failed";
  results: SubTaskResult[];
  reviewRounds: number;
  finalAnswer: string;
}

// 与手写 runTask 同名同返回结构，便于入口无缝切换
export const runTaskLangGraph = async (
  task: string,
  sessionId: string,
  maxReviewRounds = 1
): Promise<LangGraphRunReport> => {
  const graph = buildGraph();
  const final = await graph.invoke(
    { task, sessionId, maxReviewRounds },
    { recursionLimit: 50 } // 图循环上限，防条件边死循环
  );
  const state: "done" | "failed" = final.verdict?.passed ? "done" : "failed";
  logger.info("LG", `[完成] 终态=${state}，校验 ${final.reviewRounds} 轮，交付 ${final.finalAnswer.length} 字`);
  // 回收流水线子会话（与手写版一致，防内存堆积）
  for (const st of final.subtasks) clearSession(`${sessionId}-sub-${st.id}`);
  clearSession(`${sessionId}-final`);
  return {
    task,
    state,
    results: toList(final as Pipeline),
    reviewRounds: final.reviewRounds,
    finalAnswer: final.finalAnswer,
  };
};

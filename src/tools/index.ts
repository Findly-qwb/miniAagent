import { registerTool, getToolDefs, getToolDefsByNames, dispatchTool } from "./registry.js";
import { saveMemory, searchMemory } from "./memory.js";
import { searchKnowledgeBase } from "../rag/knowledge.js";
import { planTask } from "../planning/planner.js";
import { logger } from "../infra/logger.js";
import type { ToolArgs, ToolCallResult } from "../types.js";

// ========== 本地工具登记（Todo5-1 起统一走 registry，MCP 工具运行期并入同一张表） ==========

registerTool(
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前本地时间",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  async (): Promise<ToolCallResult> => ({ ok: true, data: new Date().toLocaleString() })
);

registerTool(
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
  async (args: ToolArgs): Promise<ToolCallResult> => {
    const a = Number(args.a);
    const b = Number(args.b);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return { ok: false, error: `入参必须为数字，实际收到 a=${args.a}, b=${args.b}` };
    }
    return { ok: true, data: `${a} + ${b} = ${a + b}` };
  }
);

// Todo1-5：长期记忆工具（pgvector 向量库，见 src/tools/memory.ts）
registerTool(
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "把值得长期记住的用户事实或对话要点保存到长期记忆库（向量数据库）。当用户透露个人信息、偏好、重要事实，或明确要求记住某事时调用。",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string", description: "要保存的记忆内容，应为完整自包含的一句话，如「用户的猫叫秋秋」" },
        },
        required: ["content"],
      },
    },
  },
  async (args: ToolArgs, ctx): Promise<ToolCallResult> => {
    const content = String(args.content ?? "").trim();
    if (!content) return { ok: false, error: "参数 content 不能为空" };
    return saveMemory(ctx.sessionId, content);
  }
);

registerTool(
  {
    type: "function",
    function: {
      name: "search_memory",
      description:
        "按语义相似度检索长期记忆库。当回答需要用到历史对话中的信息（如用户之前提过的名字、事实、偏好）而当前对话上下文里没有时调用。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索查询语句，如「用户的猫叫什么名字」" },
          top_k: { type: "number", description: "返回条数，默认 5" },
        },
        required: ["query"],
      },
    },
  },
  async (args: ToolArgs): Promise<ToolCallResult> => {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, error: "参数 query 不能为空" };
    const topK = args.top_k ? Number(args.top_k) : 5;
    return searchMemory(query, Number.isNaN(topK) ? 5 : topK);
  }
);

// Todo2-1：RAG 知识库工具（业务文档检索，见 src/rag/knowledge.ts）
registerTool(
  {
    type: "function",
    function: {
      name: "search_knowledge_base",
      description:
        "检索已上传的业务文档知识库（如产品手册、操作说明）。当问题涉及产品功能、价格、版本、业务流程等公司业务知识，或用户明确要求查文档时调用。返回最相关的文档片段。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索查询语句，如「专业版价格是多少」" },
          top_k: { type: "number", description: "返回片段条数，默认 3" },
        },
        required: ["query"],
      },
    },
  },
  async (args: ToolArgs): Promise<ToolCallResult> => {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, error: "参数 query 不能为空" };
    const topK = args.top_k ? Number(args.top_k) : 3;
    return searchKnowledgeBase(query, Number.isNaN(topK) ? 3 : topK);
  }
);

// Todo3-1：任务规划工具（LLM 拆解子任务，见 src/planning/planner.ts）
registerTool(
  {
    type: "function",
    function: {
      name: "plan_task",
      description:
        "把复杂任务拆解为有序、可独立执行的子任务列表（含依赖关系），只输出计划不执行。当用户只想看任务怎么拆、要执行计划时调用；若用户要求直接交付成品，改用 run_task。",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "需要拆解的完整任务描述" },
          max_subtasks: { type: "number", description: "子任务数量上限，默认 6" },
        },
        required: ["task"],
      },
    },
  },
  async (args: ToolArgs): Promise<ToolCallResult> => {
    const task = String(args.task ?? "").trim();
    if (!task) return { ok: false, error: "参数 task 不能为空" };
    const max = args.max_subtasks ? Number(args.max_subtasks) : 6;
    try {
      const plan = await planTask(task, Number.isNaN(max) || max < 1 ? 6 : max);
      return { ok: true, data: JSON.stringify(plan) };
    } catch (err) {
      logger.error("TOOL", "plan_task 执行失败", err);
      return { ok: false, error: `任务规划失败: ${String(err)}` };
    }
  }
);

// Todo3-4：多 Agent 流水线工具（规划→执行→校验→交付，见 src/planning/state-machine.ts）
registerTool(
  {
    type: "function",
    function: {
      name: "run_task",
      description:
        "端到端执行复杂多步任务并交付成品：自动完成规划拆解、多角色执行（含知识库检索）、结果校验与返工、最终整合。当用户要求产出一份完整交付物（报告、文档、分析、一页纸介绍等）时调用，比直接回答质量更高但耗时更长。",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "完整任务描述，包含所有必须包含的要素" },
        },
        required: ["task"],
      },
    },
  },
  async (args: ToolArgs, ctx): Promise<ToolCallResult> => {
    const task = String(args.task ?? "").trim();
    if (!task) return { ok: false, error: "参数 task 不能为空" };
    try {
      // 动态 import 打破循环依赖：tools → state-machine → roles → agent → tools
      const { runTask } = await import("../planning/state-machine.js");
      const report = await runTask(task, ctx.sessionId);
      logger.info("TOOL", `run_task 完成：终态=${report.state}，校验 ${report.reviewRounds} 轮，交付 ${report.finalAnswer.length} 字`);
      return {
        ok: true,
        data: JSON.stringify({
          state: report.state,
          reviewRounds: report.reviewRounds,
          subtasks: report.results.map((r) => ({ id: r.id, title: r.title })),
          finalAnswer: report.finalAnswer,
        }),
      };
    } catch (err) {
      logger.error("TOOL", "run_task 执行失败", err);
      return { ok: false, error: `多角色任务执行失败: ${String(err)}` };
    }
  }
);

// 注意：不再导出编译期 tools 快照——MCP 工具是运行期注册的，
// 消费方必须调 getToolDefs() 现取（agent.ts 已改），否则新工具不可见
export { getToolDefs, getToolDefsByNames };

// 工具执行器：统一入口委托注册表分发（本地 + MCP 同一张表）
// sessionId 用于 save_memory 落库时标记记忆来源会话（Todo1-5）
export const executeTool = async (
  name: string,
  args: ToolArgs,
  sessionId = "default"
): Promise<ToolCallResult> => dispatchTool(name, args, { sessionId });

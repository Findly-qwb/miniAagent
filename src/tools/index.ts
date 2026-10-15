import { saveMemory, searchMemory } from "./memory.js";
import { searchKnowledgeBase } from "../rag/knowledge.js";
import type { ToolArgs, ToolDefinition, ToolCallResult } from "../types.js";

// 工具定义（注册表）：新增工具在此追加 schema
export const tools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前本地时间",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
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
  // Todo1-5：长期记忆工具（pgvector 向量库，见 src/tools/memory.ts）
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
  // Todo2-1：RAG 知识库工具（业务文档检索，见 src/rag/knowledge.ts）
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
];

// 工具执行器：统一返回 ToolCallResult 结构，成功/失败都序列化为字符串回传模型
// sessionId 用于 save_memory 落库时标记记忆来源会话（Todo1-5）
export const executeTool = async (
  name: string,
  args: ToolArgs,
  sessionId = "default"
): Promise<ToolCallResult> => {
  switch (name) {
    case "get_current_time":
      return { ok: true, data: new Date().toLocaleString() };
    case "add_numbers": {
      const a = Number(args.a);
      const b = Number(args.b);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        return { ok: false, error: `入参必须为数字，实际收到 a=${args.a}, b=${args.b}` };
      }
      return { ok: true, data: `${a} + ${b} = ${a + b}` };
    }
    case "save_memory": {
      const content = String(args.content ?? "").trim();
      if (!content) {
        return { ok: false, error: "参数 content 不能为空" };
      }
      return saveMemory(sessionId, content);
    }
    case "search_memory": {
      const query = String(args.query ?? "").trim();
      if (!query) {
        return { ok: false, error: "参数 query 不能为空" };
      }
      const topK = args.top_k ? Number(args.top_k) : 5;
      return searchMemory(query, Number.isNaN(topK) ? 5 : topK);
    }
    case "search_knowledge_base": {
      const query = String(args.query ?? "").trim();
      if (!query) {
        return { ok: false, error: "参数 query 不能为空" };
      }
      const topK = args.top_k ? Number(args.top_k) : 3;
      return searchKnowledgeBase(query, Number.isNaN(topK) ? 3 : topK);
    }
    default:
      return { ok: false, error: `未知工具：${name}` };
  }
};

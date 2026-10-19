import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// ========== 工具相关类型 ==========

// 工具入参：所有值必须是 JSON 可序列化的基本类型
export type ToolArgs = Record<string, string | number | boolean | null | undefined>;

// 工具参数 JSON Schema 中的单个字段
export interface ToolParameter {
  type: string;
  description?: string;
}

// 工具参数 JSON Schema（含索引签名，兼容 SDK 的 FunctionParameters = Record<string, unknown>）
export interface ToolSchema {
  type: "object";
  properties: Record<string, ToolParameter>;
  required: string[];
  [key: string]: unknown;
}

// 工具定义（OpenAI Function Calling 协议）
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolSchema;
  };
}

// 工具执行返回值：统一成功/失败结构，便于日志与异常兜底
export interface ToolCallResult {
  ok: boolean;
  data?: string;
  error?: string;
}

// ========== 消息相关类型 ==========

// 对话消息：复用 OpenAI SDK 类型，保证与 /v1/chat/completions 协议一致
export type ChatMessage = ChatCompletionMessageParam;

// ========== 会话 Todo1-1：按 sessionId 隔离 ==========

// 独立会话：同一 sessionId 共享消息历史，不同 sessionId 互不可见
export interface AgentSession {
  sessionId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ========== Token 统计 ==========

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

// ========== 任务规划 Todo3-1 ==========

// 单个子任务：plan_task 拆解产物，供状态机（Todo3-2）按依赖执行
export interface SubTask {
  id: number;
  title: string;
  description: string;
  dependsOn: number[]; // 前置子任务 id，空数组表示可立即执行
}

// 完整执行计划
export interface TaskPlan {
  task: string; // 原始任务描述
  subtasks: SubTask[];
}

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

// ========== Token 统计 ==========

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}
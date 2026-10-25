import type { ToolArgs, ToolDefinition, ToolCallResult } from "../types.js";

// ========== Todo5-1：工具注册表——本地编译期工具 + MCP 运行期工具的统一登记处 ==========
// 从 tools/index.ts 拆出：index.ts 在模块加载时 registerTool() 登记本地工具；
// mcp/client.ts 在运行期 registerExternalTool() 登记发现到的外部工具（schema + 执行器成对注册）

// 执行上下文：sessionId 供 save_memory/run_task 等工具使用（Todo1-5/3-4）
export interface ToolContext {
  sessionId: string;
}

type Runner = (args: ToolArgs, ctx: ToolContext) => Promise<ToolCallResult>;

const registry = new Map<string, { def: ToolDefinition; run: Runner }>();

export const registerTool = (def: ToolDefinition, run: Runner): void => {
  registry.set(def.function.name, { def, run });
};

export const registerExternalTool = registerTool;

// 全量工具 schema（发给模型的 tools 数组）——每次调用现取，保证运行期新注册的 MCP 工具即时可见
export const getToolDefs = (): ToolDefinition[] => [...registry.values()].map((r) => r.def);

// 按白名单取子集（角色化，Todo3-3）
export const getToolDefsByNames = (names: string[]): ToolDefinition[] =>
  getToolDefs().filter((t) => names.includes(t.function.name));

// 统一分发：本地与 MCP 工具走同一入口，未知工具返回失败契约
export const dispatchTool = async (name: string, args: ToolArgs, ctx: ToolContext): Promise<ToolCallResult> => {
  const entry = registry.get(name);
  if (!entry) return { ok: false, error: `未知工具：${name}` };
  return entry.run(args, ctx);
};

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { registerExternalTool } from "../tools/registry.js";
import { logger } from "../infra/logger.js";
import type { ToolCallResult, ToolArgs } from "../types.js";

// ========== Todo5-1：MCP 客户端——连接外部 MCP 服务器，把它的工具并入 Agent 工具表 ==========
// 与本地工具的区别：本地工具是"编译期写死"的 switch 分发；MCP 工具是"运行期发现"的——
// 握手 → tools/list 拿到 schema → 注册进注册表 → 调用时 tools/call 转发给服务器进程

export interface McpServerSpec {
  name: string;
  command: string;
  args: string[];
}

// 本项目自带 MCP 服务器的启动命令：优先编译产物（生产 node dist），否则源码 + tsx（开发）；
// 注意用 tsx 的真实入口 cli.mjs——Windows 下 .bin/tsx 是 cmd 垫片，node 无法直接执行
export const selfMcpSpec = (name: string, module: string): McpServerSpec => {
  const compiled = `dist/mcp/${module}.js`;
  return existsSync(compiled)
    ? { name, command: process.execPath, args: [compiled] }
    : { name, command: process.execPath, args: ["node_modules/tsx/dist/cli.mjs", `src/mcp/${module}.ts`] };
};

const clients: Client[] = [];

// 连接一个 stdio MCP 服务器并注册其全部工具；失败只记日志不抛出（MCP 是增强，不是依赖）
export const connectMcpServer = async (spec: McpServerSpec): Promise<number> => {
  try {
    const transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      stderr: "inherit", // 服务器日志直通控制台，不污染协议通道
    });
    const client = new Client({ name: "miniagent", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);

    const { tools } = await client.listTools();
    for (const t of tools) {
      const toolName = `mcp_${spec.name}_${t.name}`; // 前缀命名空间，防与本地工具撞名
      registerExternalTool(
        {
          type: "function",
          function: {
            name: toolName,
            description: `[MCP:${spec.name}] ${t.description ?? t.name}`,
            parameters: (t.inputSchema as never) ?? { type: "object", properties: {} },
          },
        },
        async (args: ToolArgs): Promise<ToolCallResult> => {
          try {
            const res = await client.callTool({ name: t.name, arguments: args });
            const text = (res.content as { type: string; text?: string }[])
              .filter((c) => c.type === "text")
              .map((c) => c.text ?? "")
              .join("\n");
            return res.isError ? { ok: false, error: text || "MCP 工具执行失败" } : { ok: true, data: text };
          } catch (err) {
            logger.error("MCP", `调用 ${toolName} 失败`, err);
            return { ok: false, error: `MCP 调用失败: ${String(err)}` };
          }
        }
      );
    }
    logger.info("MCP", `服务器 ${spec.name} 已接入，注册 ${tools.length} 个工具`);
    return tools.length;
  } catch (err) {
    logger.error("MCP", `连接服务器 ${spec.name} 失败（降级：跳过 MCP 工具）`, err);
    return 0;
  }
};

export const closeMcpClients = async (): Promise<void> => {
  for (const c of clients) {
    try {
      await c.close();
    } catch {
      // 关闭失败忽略
    }
  }
  clients.length = 0;
};

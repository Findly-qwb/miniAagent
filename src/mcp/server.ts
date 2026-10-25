import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ========== Todo5-1：MCP 服务器——把工具以 Model Context Protocol 暴露给任意 MCP 客户端 ==========
// 独立进程运行（npx tsx src/mcp/server.ts），通过 stdio 收发 JSON-RPC；
// 注意：stdout 是协议通道，任何日志必须走 stderr，否则破坏帧格式

const server = new McpServer({ name: "miniagent-text-tools", version: "1.0.0" });

server.registerTool(
  "word_stats",
  {
    description: "统计一段文本的字符数(chars)、单词数(words)与行数(lines)",
    inputSchema: { text: z.string().describe("要统计的文本") },
  },
  async ({ text }) => {
    const stats = {
      chars: text.length,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      lines: text.split(/\r?\n/).length,
    };
    return { content: [{ type: "text", text: JSON.stringify(stats) }] };
  }
);

server.registerTool(
  "slugify",
  {
    description: "把标题文本转换为 URL slug（小写、空格转连字符、去除特殊字符）",
    inputSchema: { title: z.string().describe("原始标题") },
  },
  async ({ title }) => {
    const slug = title
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-");
    return { content: [{ type: "text", text: slug }] };
  }
);

await server.connect(new StdioServerTransport());
console.error("[MCP-SERVER] miniagent-text-tools 已就绪，等待 stdio 连接…");

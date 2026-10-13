import OpenAI from "openai";
import "dotenv/config";
import { mkdirSync, appendFileSync } from "node:fs";
import type { ToolArgs, ToolDefinition, ToolCallResult, ChatMessage, TokenUsage } from "./types.js";

// ========== 配置 Todo0-4：从 .env 读取，禁止硬编码密钥 ==========
const config = {
  apiKey: process.env.OPENAI_API_KEY ?? "",
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL ?? "deepseek-v4-flash",
  maxRound: Number(process.env.MAX_ROUND ?? "3"),
};

if (!config.apiKey) {
  console.error("❌ 缺少 OPENAI_API_KEY，请先复制 .env.example 为 .env 并填入密钥");
  process.exit(1);
}
// =============================================================

// 1. 初始化 OpenAI 客户端
const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
});

// 2. 定义工具
const tools: ToolDefinition[] = [
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
];

// 工具执行器：统一返回 ToolCallResult 结构，成功/失败都序列化为字符串回传模型
const executeTool = async (name: string, args: ToolArgs): Promise<ToolCallResult> => {
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
    default:
      return { ok: false, error: `未知工具：${name}` };
  }
};

// Token 统计打印 + 写入日志文件 Todo0-3
const logTokenUsage = (roundUsage: TokenUsage, total: TokenUsage): void => {
  console.log(
    `📊 Token统计 | 本轮 prompt: ${roundUsage.prompt}, completion: ${roundUsage.completion}, total: ${roundUsage.total}`
  );
  try {
    mkdirSync("logs", { recursive: true });
    appendFileSync(
      "logs/token-usage.log",
      `${new Date().toISOString()} 本轮 prompt=${roundUsage.prompt} completion=${roundUsage.completion} total=${roundUsage.total} 累计=${total.total}\n`
    );
  } catch (err) {
    console.error("❌ 写入 token 日志文件失败：", err);
  }
};

// 累计 Token 汇总打印
const printUsageTotal = (total: TokenUsage): void => {
  console.log(
    `\n📈 累计 Token | prompt: ${total.prompt}, completion: ${total.completion}, total: ${total.total}`
  );
};

// 3. 核心 Agent Loop
async function agentLoop(prompt: string, maxRound: number = config.maxRound) {
  const messages: ChatMessage[] = [
    { role: "user", content: prompt },
  ];

  // 累计 token 消耗
  let usageTotal: TokenUsage = { prompt: 0, completion: 0, total: 0 };

  // Todo0-2 全局兜底：包裹整个循环，任何未捕获异常统一终止并打印
  try {
    for (let round = 0; round < maxRound; round++) {
      console.log(`\n===== 第 ${round + 1} 轮思考 =====`);
      let resp;
      try {
        resp = await openai.chat.completions.create({
          model: config.model,
          messages,
          tools,
          tool_choice: "auto",
        });
      } catch (error) {
        // 可重试类错误（限流/超时/服务端错误）：注入提示后进入下一轮
        console.error("❌ 调用模型API失败：", (error as Error).message);
        messages.push({ role: "system", content: "模型调用出错，请重试" });
        continue; // 本轮失败，进入下一轮循环，不再访问resp
      }

      if (!resp) continue;

      // Token统计 Todo0-3
      const usage = resp.usage;
      if (usage) {
        usageTotal.prompt += usage.prompt_tokens;
        usageTotal.completion += usage.completion_tokens;
        usageTotal.total += usage.total_tokens;
        logTokenUsage(
          {
            prompt: usage.prompt_tokens,
            completion: usage.completion_tokens,
            total: usage.total_tokens,
          },
          usageTotal
        );
      }

      const choice = resp.choices[0];
      if (!choice.message) break;

      messages.push(choice.message);

      // 没有工具调用，输出最终回答
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        console.log("\n✅ 最终回答：", choice.message.content);
        return;
      }

      // 遍历所有工具调用
      for (const toolCall of choice.message.tool_calls) {
        console.log(`🔧 调用工具：${toolCall.function.name}`);
        let args: ToolArgs = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch (parseErr) {
          console.error("❌ 解析工具参数JSON失败", parseErr);
          args = {};
        }
        const toolResult = await executeTool(toolCall.function.name, args);
        const rendered = toolResult.ok
          ? `[成功] ${toolResult.data}`
          : `[失败] ${toolResult.error}`;
        console.log(`📤 工具返回结果：${rendered}`);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: rendered,
        });
      }
    }

    console.log("\n⚠️ 达到最大轮次限制，Agent停止");
    printUsageTotal(usageTotal);
  } catch (error) {
    // 全局兜底：未知异常在此终止，不再继续循环
    console.error("❌ 全局兜底：Agent 循环发生未捕获异常，已终止");
    console.error(error);
    printUsageTotal(usageTotal);
  }
}

// 运行测试
agentLoop("现在几点了？");
// agentLoop("请帮我计算 123 + 456");

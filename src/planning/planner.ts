import { openai } from "../llm/client.js";
import { config } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import type { SubTask, TaskPlan } from "../types.js";

// 强制 JSON 输出 schema：LM Studio 支持 json_schema 约束解码（实测可用），
// 根治小模型自由输出 JSON 时随机停笔/截断导致的解析失败
const PLAN_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "task_plan",
    strict: true,
    schema: {
      type: "object",
      properties: {
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "number" },
              title: { type: "string" },
              description: { type: "string" },
              dependsOn: { type: "array", items: { type: "number" } },
            },
            required: ["id", "title", "description", "dependsOn"],
            additionalProperties: false,
          },
        },
      },
      required: ["subtasks"],
      additionalProperties: false,
    },
  },
} as const;

// 从模型输出中提取 JSON：容忍 ```json 围栏与前后废话，取首个 { 到末个 }
const extractJson = (raw: string): Record<string, unknown> | null => {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};

// 规整模型返回：缺字段补默认、丢 title 的条目剔除、总量截断
const normalizeSubtasks = (parsed: Record<string, unknown>, maxSubtasks: number): SubTask[] => {
  const list = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
  const subtasks: SubTask[] = [];
  for (const item of list.slice(0, maxSubtasks)) {
    const t = (item ?? {}) as Record<string, unknown>;
    const title = String(t.title ?? "").trim();
    if (!title) continue;
    subtasks.push({
      id: Number(t.id) || subtasks.length + 1,
      title,
      description: String(t.description ?? "").trim(),
      dependsOn: Array.isArray(t.dependsOn)
        ? t.dependsOn.map(Number).filter((n) => Number.isInteger(n))
        : [],
    });
  }
  return subtasks;
};

// 调用 LLM 把复杂任务拆解为有序子任务列表（Todo3-1）
export const planTask = async (task: string, maxSubtasks = 6): Promise<TaskPlan> => {
  const prompt = `你是任务规划专家。把用户的复杂任务拆解为按执行顺序排列、可独立执行的子任务列表。
硬性要求：
1. 子任务不超过 ${maxSubtasks} 个
2. 每个子任务含 id(从1递增)、title(简短标题)、description(一句话说明怎么做)、dependsOn(依赖的前置 id 数组，无依赖给空数组)
3. 只输出 JSON，不要其它文字，格式：{"subtasks":[{"id":1,"title":"...","description":"...","dependsOn":[]}]}`;

  const resp = await openai.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: task },
    ],
    temperature: 0.2,
    // 约束解码强制合法 JSON；max_tokens 防长拆解截断
    response_format: PLAN_SCHEMA,
    max_tokens: 1500,
  });

  const usage = resp.usage;
  if (usage) {
    logger.info("PLAN", `规划调用 tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}`);
  }

  const raw = resp.choices[0]?.message?.content ?? "";
  const parsed = extractJson(raw);
  if (!parsed) {
    logger.error("PLAN", "模型未返回可解析 JSON", raw.slice(0, 200));
    throw new Error("任务规划失败：模型输出无法解析为 JSON");
  }
  const subtasks = normalizeSubtasks(parsed, maxSubtasks);
  if (subtasks.length === 0) {
    throw new Error("任务规划失败：未得到任何有效子任务");
  }
  logger.info("PLAN", `任务拆解完成：${subtasks.length} 个子任务`);
  return { task, subtasks };
};

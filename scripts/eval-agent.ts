import { pool } from "../src/infra/db.js";
import { initMemoryStore } from "../src/infra/db.js";
import { initKnowledgeStore, ingestDirectory } from "../src/rag/knowledge.js";
import { agentLoop } from "../src/core/agent.js";
import type { TokenUsage } from "../src/types.js";

// ========== Todo5-4：Agent 批量评测——成功率 / 幻觉率 / token 成本 ==========

interface EvalCase {
  category: "tool" | "memory" | "rag" | "plan" | "anti-hallucination";
  question: string;
  goldKeywords: string[]; // 任一命中 = 答对
  forbiddenKeywords?: string[]; // 命中 = 幻觉/编造（负向用例）
}

const cases: EvalCase[] = [
  { category: "tool", question: "帮我算一下 123 加 456 等于多少", goldKeywords: ["579"] },
  { category: "memory", question: "我叫什么名字？", goldKeywords: ["小明"] },
  { category: "memory", question: "我的猫叫什么名字？", goldKeywords: ["秋秋"] },
  { category: "rag", question: "专业版一年多少钱？支持多少坐席？", goldKeywords: ["39,800", "39800"] },
  { category: "rag", question: "智能客服系统的核心功能有哪些？", goldKeywords: ["工单"], forbiddenKeywords: ["15项", "15 项"] },
  { category: "rag", question: "系统当前版本号是多少？", goldKeywords: ["3.2.0"] },
  { category: "plan", question: "「先调研需求、再设计架构、然后开发、最后测试上线」——请用工具把这个任务拆解成子任务计划", goldKeywords: ["调研", "设计", "开发", "测试"] },
  { category: "anti-hallucination", question: "你们公司的月球基地接送业务怎么收费？", goldKeywords: ["没有", "未", "抱歉", "无法", "不清楚", "不存在", "没有相关"] },
];

interface Row {
  category: string;
  question: string;
  passed: boolean;
  hallucinated: boolean;
  tokens: number;
  answer: string;
}

const main = async (): Promise<void> => {
  await initMemoryStore();
  await initKnowledgeStore();
  await ingestDirectory("docs/knowledge");

  const rows: Row[] = [];
  let totalTokens = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    // 云端 provider 有 RPM 限制，用例间隔 15s 降压，避免评测自身触发 429
    if (i > 0) await new Promise((r) => setTimeout(r, 15000));
    let tokens = 0;
    const t0 = Date.now();
    // maxRound=5：429 重试会消耗轮次，留足"调工具→拿结果→作答"的完整循环
    const answer = await agentLoop(`eval54-${Date.now()}-${i}`, c.question, 5, {
      onUsage: (u: TokenUsage) => {
        tokens += u.total;
      },
    });
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const hitGold = c.goldKeywords.some((k) => answer.includes(k));
    const hitForbidden = (c.forbiddenKeywords ?? []).some((k) => answer.includes(k));
    const isNegative = c.category === "anti-hallucination";
    const passed = isNegative ? hitGold && !hitForbidden : hitGold;
    const hallucinated = hitForbidden || (isNegative && !hitGold);
    totalTokens += tokens;
    rows.push({ category: c.category, question: c.question, passed, hallucinated, tokens, answer: answer.slice(0, 60) });
    console.log(`[${i + 1}/${cases.length}] ${c.category} ${passed ? "✅" : "❌"}${hallucinated ? " ⚠幻觉" : ""} ${tokens}tok ${sec}s  Q:${c.question.slice(0, 24)}`);
    console.log(`     答: ${answer.slice(0, 80).replace(/\n/g, " ")}`);
  }

  const byCat = new Map<string, { total: number; pass: number; halluc: number; tokens: number }>();
  for (const r of rows) {
    const s = byCat.get(r.category) ?? { total: 0, pass: 0, halluc: 0, tokens: 0 };
    s.total++;
    if (r.passed) s.pass++;
    if (r.hallucinated) s.halluc++;
    s.tokens += r.tokens;
    byCat.set(r.category, s);
  }

  console.log("\n================ Agent 评测汇总 ================");
  console.log(`用例数: ${rows.length} | 总 token: ${totalTokens} | 平均: ${Math.round(totalTokens / rows.length)}/用例`);
  for (const [cat, s] of byCat) {
    console.log(`  ${cat.padEnd(20)} 成功率 ${s.pass}/${s.total}  幻觉 ${s.halluc}  token ${s.tokens}`);
  }
  const passRate = rows.filter((r) => r.passed).length / rows.length;
  const hallucRate = rows.filter((r) => r.hallucinated).length / rows.length;
  console.log(`总体: 成功率 ${(passRate * 100).toFixed(1)}% | 幻觉率 ${(hallucRate * 100).toFixed(1)}%`);
  console.log("===============================================");

  await pool.end();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

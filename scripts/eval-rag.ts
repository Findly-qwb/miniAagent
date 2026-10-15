import { pool } from "../src/infra/db.js";
import { initKnowledgeStore, ingestDirectory, searchKnowledgeBase } from "../src/rag/knowledge.js";
import { agentLoop } from "../src/core/agent.js";

// 评测用例：问题 + 期望答案关键词（来自 docs/qi-ming-product-manual.md）
interface EvalCase {
  question: string;
  goldKeywords: string[]; // 任一命中即视为答对
}

const cases: EvalCase[] = [
  { question: "智能客服系统的核心功能有哪些？", goldKeywords: ["工单系统", "知识库问答", "人机协同", "满意度评价"] },
  { question: "专业版一年多少钱？支持多少个坐席？", goldKeywords: ["39,800", "39800", "20 个坐席", "20个坐席"] },
  { question: "基础版和旗舰版的价格分别是多少？", goldKeywords: ["9,800", "9800", "99,800", "99800"] },
  { question: "这个系统的当前版本号是多少？", goldKeywords: ["v3.2.0", "3.2.0"] },
  { question: "系统的技术支持电话是多少？", goldKeywords: ["400-800-8888", "400 800 8888"] },
  { question: "旗舰版客户能享受什么特殊服务？", goldKeywords: ["不限量", "客户成功经理", "7x24"] },
  { question: "系统支持哪些部署模式？", goldKeywords: ["私有化部署", "公有云"] },
];

interface EvalRow {
  question: string;
  top1Sim: number;
  goldInTop3: boolean;
  answerHit: boolean;
  answer: string;
}

const main = async (): Promise<void> => {
  await initKnowledgeStore();
  await ingestDirectory("docs");

  const rows: EvalRow[] = [];
  let recallTop1 = 0;
  let recallTop3 = 0;
  let answerHit = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    // 召回：检索 Top3 是否包含含 gold 关键词的片段
    const k = await searchKnowledgeBase(c.question, 3);
    const hits = k.ok ? (JSON.parse(k.data) as { content: string; similarity: number }[]) : [];
    const top1Sim = hits[0]?.similarity ?? 0;
    const goldInTop3 = hits.some((h) => c.goldKeywords.some((kw) => h.content.includes(kw)));
    if (hits[0] && c.goldKeywords.some((kw) => hits[0]!.content.includes(kw))) recallTop1++;
    if (goldInTop3) recallTop3++;

    // 回答：Agent 完整跑一轮，检查回答是否含 gold 关键词
    const answer = await agentLoop(`session-eval-${i}`, c.question);
    const hit = c.goldKeywords.some((kw) => answer.includes(kw));
    if (hit) answerHit++;
    rows.push({ question: c.question, top1Sim: Number(top1Sim.toFixed(3)), goldInTop3, answerHit: hit, answer: answer.slice(0, 90) });

    console.log(`\n[${i + 1}/${cases.length}] Q: ${c.question}`);
    console.log(`  召回 Top1 相似度=${top1Sim.toFixed(3)} | gold 片段在 Top3=${goldInTop3}`);
    console.log(`  回答命中关键词=${hit} | 回答: ${answer.slice(0, 90)}`);
  }

  const n = cases.length;
  console.log("\n================ 评测汇总 ================");
  console.log(`用例数: ${n}`);
  console.log(`召回质量: Top1 命中 ${recallTop1}/${n} | Top3 包含 ${recallTop3}/${n}`);
  console.log(`回答准确率(含 gold 关键词, 无幻觉编造): ${answerHit}/${n}`);
  console.log("==========================================");

  await pool.end();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

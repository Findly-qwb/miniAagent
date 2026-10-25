import { pool } from "../infra/db.js";
import { openai } from "../llm/client.js";
import { config } from "../infra/config.js";
import { logger } from "../infra/logger.js";
import { extractJson } from "../planning/planner.js";

// ========== Todo5-3：Graph RAG——LLM 抽取实体/关系建知识图谱，检索时图谱扩展增强向量召回 ==========
// 与纯向量检索的互补：向量抓"语义相似"，图谱抓"关系链路"（如 客户-采购->项目），
// 多跳事实（A 的客户的负责人是谁）光靠 embedding 排序容易漏，图谱一跳就能带出来
//
// 实测教训：部分模型/引擎的 json_schema 约束解码不可靠（step-5-preview 带 response_format
// 会输出空/畸形，不带时反而正常）——故此处改用「提示词内联 schema + extractJson 容错解析」，
// 把语法正确性交给解析层而非解码层

// 建图谱表（幂等）：实体按 (doc_id,name) 去重，关系按四元组去重
export const initGraphStore = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_entities (
      id BIGSERIAL PRIMARY KEY,
      doc_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      UNIQUE (doc_id, name)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS graph_relations (
      id BIGSERIAL PRIMARY KEY,
      doc_id TEXT NOT NULL,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      UNIQUE (doc_id, source, target, type)
    )
  `);
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM graph_entities) AS e, (SELECT count(*) FROM graph_relations) AS r`
  );
  logger.info("DB", `图谱就绪：实体 ${rows[0].e} 个、关系 ${rows[0].r} 条`);
};

// 单文档图谱抽取：全文 → LLM(json_schema) → 实体/关系入库；幂等（先删同 doc 旧数据）
export const extractAndStoreGraph = async (docId: string, text: string): Promise<boolean> => {
  try {
    const resp = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            '你是知识图谱抽取器。从给定业务文档中抽取核心实体与实体间关系。实体不超过 15 个、关系不超过 20 条；实体名用文档中的规范称呼；关系 type 用简短动词（如 采购/支持/包含/部署于）。只输出 JSON，不要解释、不要 markdown 围栏，格式：{"entities":[{"name":"...","type":"...","description":"..."}],"relations":[{"source":"...","target":"...","type":"..."}]}',
        },
        { role: "user", content: text.slice(0, 4000) },
      ],
      temperature: 0.1,
      // step-5 类推理模型思考也吃 token，预算给足
      max_tokens: 8000,
    });
    const parsed = extractJson(resp.choices[0]?.message?.content ?? "");
    if (!parsed) throw new Error("图谱抽取输出无合法 JSON");
    const rawEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
    const relations = Array.isArray(parsed.relations) ? (parsed.relations as Record<string, unknown>[]) : [];
    // 宽容归一：小模型常把 entities 输出成字符串数组（["名称",…]）而非对象数组，
    // 只按对象取 name 会全部跳过（实测 19 关系/0 实体即此因）
    const entities: { name: string; type: string; description: string }[] = [];
    for (const item of rawEntities) {
      if (typeof item === "string") {
        if (item.trim()) entities.push({ name: item.trim(), type: "概念", description: "" });
      } else if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const name = String(o.name ?? "").trim();
        if (name) entities.push({ name, type: String(o.type ?? "概念"), description: String(o.description ?? "") });
      }
    }

    await pool.query(`DELETE FROM graph_entities WHERE doc_id = $1`, [docId]);
    await pool.query(`DELETE FROM graph_relations WHERE doc_id = $1`, [docId]);
    for (const e of entities) {
      await pool.query(
        `INSERT INTO graph_entities (doc_id, name, type, description) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [docId, e.name, e.type, e.description]
      );
    }
    for (const r of relations) {
      const source = String(r.source ?? "").trim();
      const target = String(r.target ?? "").trim();
      if (!source || !target) continue;
      await pool.query(
        `INSERT INTO graph_relations (doc_id, source, target, type) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [docId, source, target, String(r.type ?? "关联")]
      );
    }
    logger.info("GRAPH", `文档 ${docId} 图谱抽取：${entities.length} 实体 / ${relations.length} 关系`);
    return true;
  } catch (err) {
    logger.error("GRAPH", `文档 ${docId} 图谱抽取失败（降级：仅向量检索）`, err);
    return false;
  }
};

// 图谱检索：查询 → LLM 抽实体名 → 匹配实体 → 一跳邻居关系 → 拼成摘要文本
// 无命中或失败返回 null（调用方降级为纯向量结果）
export const searchGraph = async (query: string): Promise<string | null> => {
  try {
    const resp = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content: '从用户查询中抽取最多 3 个业务实体名（如公司、产品、客户、版本）。只输出 JSON：{"entities":["实体1","实体2"]}，不要解释、不要围栏',
        },
        { role: "user", content: query },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });
    const parsed = extractJson(resp.choices[0]?.message?.content ?? "");
    const names = Array.isArray(parsed?.entities) ? (parsed.entities as unknown[]).map(String).filter(Boolean) : [];
    if (names.length === 0) return null;

    // 双向模糊匹配：查询实体名与图谱实体名互相包含即命中
    const matched = new Set<string>();
    for (const n of names) {
      const r = await pool.query(
        `SELECT name FROM graph_entities WHERE name = $1 OR name LIKE '%' || $1 || '%' OR $1 LIKE '%' || name || '%'`,
        [n]
      );
      for (const row of r.rows) matched.add(String(row.name));
    }
    if (matched.size === 0) return null;

    // 一跳扩展：命中实体作为 source 或 target 的全部关系
    const list = [...matched];
    const rel = await pool.query(
      `SELECT source, target, type FROM graph_relations WHERE source = ANY($1::text[]) OR target = ANY($1::text[]) LIMIT 12`,
      [list]
    );
    if (rel.rowCount === 0) return null;
    const lines = rel.rows.map((x) => `- ${x.source} -[${x.type}]-> ${x.target}`);
    logger.info("GRAPH", `图谱检索「${query.slice(0, 24)}」命中实体 ${list.length} 个、关系 ${lines.length} 条`);
    return lines.join("\n");
  } catch (err) {
    logger.error("GRAPH", "图谱检索失败（降级：仅向量结果）", err);
    return null;
  }
};

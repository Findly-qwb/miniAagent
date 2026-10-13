import { pool } from "../infra/db.js";
import { embedText, toVectorLiteral } from "../infra/embedding.js";
import { logger } from "../infra/logger.js";
import type { ToolCallResult } from "../types.js";

// 检索命中的记忆行
export interface MemoryHit {
  id: string;
  sessionId: string;
  content: string;
  similarity: number;
  createdAt: string;
}

// 写入记忆：文本 → embedding（document 前缀）→ 存入 pgvector
// 精确去重：同内容不重复入库（语义级去重留待后续）
export const saveMemory = async (sessionId: string, content: string): Promise<ToolCallResult> => {
  try {
    const dup = await pool.query(`SELECT id FROM memories WHERE content = $1 LIMIT 1`, [content]);
    if (dup.rowCount && dup.rows[0]) {
      logger.info("MEMORY", `记忆已存在 id=${dup.rows[0].id}，跳过重复写入`);
      return { ok: true, data: `记忆已存在 id=${String(dup.rows[0].id)}，未重复写入` };
    }
    const embedding = await embedText(content, "document");
    const res = await pool.query(
      `INSERT INTO memories (session_id, content, embedding) VALUES ($1, $2, $3::vector) RETURNING id`,
      [sessionId, content, toVectorLiteral(embedding)]
    );
    const id = String(res.rows[0].id);
    logger.info("MEMORY", `保存记忆 id=${id} session=${sessionId} 内容长度=${content.length}`);
    return { ok: true, data: `记忆已保存 id=${id}` };
  } catch (err) {
    logger.error("MEMORY", "保存记忆失败", err);
    return { ok: false, error: `保存记忆失败: ${String(err)}` };
  }
};

// 相似度检索：查询文本 → embedding（query 前缀）→ 余弦距离 Top-K，可按 sessionId 过滤
export const searchMemory = async (
  query: string,
  topK = 5,
  sessionId?: string
): Promise<ToolCallResult> => {
  try {
    const embedding = await embedText(query, "query");
    const res = await pool.query(
      `SELECT id, session_id, content, created_at, 1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       WHERE $3::text IS NULL OR session_id = $3
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(embedding), topK, sessionId ?? null]
    );
    const hits: MemoryHit[] = res.rows.map((r) => ({
      id: String(r.id),
      sessionId: r.session_id,
      content: r.content,
      similarity: Number(Number(r.similarity).toFixed(4)),
      createdAt: r.created_at,
    }));
    logger.info("MEMORY", `检索「${query.slice(0, 30)}」命中 ${hits.length} 条（Top1 相似度 ${hits[0]?.similarity ?? "-"}）`);
    return { ok: true, data: JSON.stringify(hits) };
  } catch (err) {
    logger.error("MEMORY", "检索记忆失败", err);
    return { ok: false, error: `检索记忆失败: ${String(err)}` };
  }
};

// ========== Todo1-6：每轮提问前自动检索，注入系统 prompt（不依赖模型主动调工具） ==========
const MEMORY_TOP_K = 3;
// 相似度下限：低于此值视为噪声，宁缺毋滥
const MEMORY_MIN_SIMILARITY = 0.55;

// 返回拼好的 system 提示文本；无相关记忆或检索失败时返回 null（降级为不注入，不阻塞主循环）
export const retrieveRelevantMemory = async (query: string): Promise<string | null> => {
  try {
    const embedding = await embedText(query, "query");
    const res = await pool.query(
      `SELECT content, 1 - (embedding <=> $1::vector) AS similarity
       FROM memories
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(embedding), MEMORY_TOP_K]
    );
    const hits = res.rows.filter((r) => Number(r.similarity) >= MEMORY_MIN_SIMILARITY);
    if (hits.length === 0) {
      logger.info("MEMORY", `自动检索「${query.slice(0, 30)}」无达阈值记忆，跳过注入`);
      return null;
    }
    logger.info("MEMORY", `自动检索命中 ${hits.length} 条记忆，注入系统 prompt`);
    return `[长期记忆] 以下是与当前问题相关的历史记忆，可直接引用：\n${hits
      .map((h) => `- ${h.content}`)
      .join("\n")}`;
  } catch (err) {
    logger.error("MEMORY", "自动检索长期记忆失败，跳过注入", err);
    return null;
  }
};
// =======================================================================================

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
export const saveMemory = async (sessionId: string, content: string): Promise<ToolCallResult> => {
  try {
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

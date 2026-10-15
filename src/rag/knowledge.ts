import { pool } from "../infra/db.js";
import { config } from "../infra/config.js";
import { embedText, toVectorLiteral } from "../infra/embedding.js";
import { logger } from "../infra/logger.js";
import { loadFile, loadDirectory, type LoadedDoc } from "./loader.js";
import { chunkText } from "./chunker.js";
import type { ToolCallResult } from "../types.js";

// 知识库检索命中块
export interface KnowledgeHit {
  docId: string;
  docName: string;
  chunkIndex: number;
  content: string;
  similarity: number;
}

// 建知识库表（幂等）：与 memories 表分开，语义上「业务文档」≠「用户记忆」
export const initKnowledgeStore = async (): Promise<void> => {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id BIGSERIAL PRIMARY KEY,
      doc_id TEXT NOT NULL,
      doc_name TEXT NOT NULL,
      chunk_index INT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${config.embeddingDim}) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
    ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  `);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM knowledge_chunks`);
  logger.info("DB", `知识库就绪：knowledge_chunks 现有 ${rows[0].n} 个分块`);
};

// 单个文档入库：全文分块 → 逐块 embedding → 批量插入；同名 doc_id 先清旧数据（幂等重灌）
export const ingestDocument = async (filePath: string): Promise<ToolCallResult> => {
  try {
    const doc = loadFile(filePath);
    if (!doc) return { ok: false, error: `不支持的文件类型，仅支持 .md/.txt（${filePath}）` };
    await pool.query(`DELETE FROM knowledge_chunks WHERE doc_id = $1`, [doc.docId]);
    const chunks = chunkText(doc.content);
    if (chunks.length === 0) return { ok: false, error: `文档内容为空：${doc.name}` };
    for (const chunk of chunks) {
      const embedding = await embedText(chunk.text, "document");
      await pool.query(
        `INSERT INTO knowledge_chunks (doc_id, doc_name, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [doc.docId, doc.name, chunk.chunkIndex, chunk.text, toVectorLiteral(embedding)]
      );
    }
    logger.info("RAG", `文档入库 ${doc.name}：${chunks.length} 个分块（doc_id=${doc.docId}）`);
    return { ok: true, data: `文档已入库：${doc.name}，共 ${chunks.length} 个分块` };
  } catch (err) {
    logger.error("RAG", "文档入库失败", err);
    return { ok: false, error: `文档入库失败: ${String(err)}` };
  }
};

// 批量入库：目录下全部 md/txt
export const ingestDirectory = async (dirPath: string): Promise<ToolCallResult> => {
  try {
    const docs = loadDirectory(dirPath);
    if (docs.length === 0) return { ok: false, error: `目录下没有 .md/.txt 文档：${dirPath}` };
    let total = 0;
    for (const doc of docs) {
      await pool.query(`DELETE FROM knowledge_chunks WHERE doc_id = $1`, [doc.docId]);
      const chunks = chunkText(doc.content);
      for (const chunk of chunks) {
        const embedding = await embedText(chunk.text, "document");
        await pool.query(
          `INSERT INTO knowledge_chunks (doc_id, doc_name, chunk_index, content, embedding)
           VALUES ($1, $2, $3, $4, $5::vector)`,
          [doc.docId, doc.name, chunk.chunkIndex, chunk.text, toVectorLiteral(embedding)]
        );
        total++;
      }
      logger.info("RAG", `文档入库 ${doc.name}：${chunks.length} 个分块`);
    }
    return { ok: true, data: `知识库入库完成：${docs.length} 个文档，${total} 个分块` };
  } catch (err) {
    logger.error("RAG", "知识库批量入库失败", err);
    return { ok: false, error: `知识库批量入库失败: ${String(err)}` };
  }
};

// 相似度检索：查询文本 → embedding(query 前缀) → Top-K 分块
export const searchKnowledgeBase = async (query: string, topK = 3): Promise<ToolCallResult> => {
  try {
    const embedding = await embedText(query, "query");
    const res = await pool.query(
      `SELECT doc_id, doc_name, chunk_index, content, 1 - (embedding <=> $1::vector) AS similarity
       FROM knowledge_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(embedding), topK]
    );
    const hits: KnowledgeHit[] = res.rows.map((r) => ({
      docId: r.doc_id,
      docName: r.doc_name,
      chunkIndex: r.chunk_index,
      content: r.content,
      similarity: Number(Number(r.similarity).toFixed(4)),
    }));
    if (hits.length === 0) {
      logger.info("RAG", `知识库检索「${query.slice(0, 30)}」无命中`);
    } else {
      logger.info("RAG", `知识库检索「${query.slice(0, 30)}」命中 ${hits.length} 条（Top1 相似度 ${hits[0].similarity}）`);
    }
    return { ok: true, data: JSON.stringify(hits) };
  } catch (err) {
    logger.error("RAG", "知识库检索失败", err);
    return { ok: false, error: `知识库检索失败: ${String(err)}` };
  }
};

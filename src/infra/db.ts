import pg from "pg";
import { config } from "./config.js";
import { logger } from "./logger.js";

// pg 连接池单例：全项目共用
export const pool = new pg.Pool({
  host: config.pg.host,
  port: config.pg.port,
  user: config.pg.user,
  password: config.pg.password,
  database: config.pg.database,
});

// 初始化向量库：确保 pgvector 扩展、memories 表与 HNSW 余弦索引就绪（幂等）
export const initMemoryStore = async (): Promise<void> => {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${config.embeddingDim}) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS memories_embedding_idx
    ON memories USING hnsw (embedding vector_cosine_ops)
  `);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM memories`);
  logger.info("DB", `向量库就绪：memories 表现有 ${rows[0].n} 条记忆（维度 ${config.embeddingDim}）`);
};

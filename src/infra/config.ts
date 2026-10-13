import "dotenv/config";
import { logger } from "./logger.js";

// ========== 配置 Todo0-4：从 .env 读取，禁止硬编码密钥 ==========
export const config = {
  apiKey: process.env.OPENAI_API_KEY ?? "",
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL ?? "deepseek-v4-flash",
  maxRound: Number(process.env.MAX_ROUND ?? "3"),
  maxContextTokens: Number(process.env.MAX_CONTEXT_TOKENS ?? "1000"), // 上下文窗口 token 上限（估算值）Todo1-2
  // Todo1-4：PostgreSQL + pgvector 向量库与 embedding 配置
  pg: {
    host: process.env.PG_HOST ?? "127.0.0.1",
    port: Number(process.env.PG_PORT ?? "5432"),
    user: process.env.PG_USER ?? "postgres",
    password: process.env.PG_PASSWORD ?? "",
    database: process.env.PG_DATABASE ?? "miniagent",
  },
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-nomic-embed-text-v1.5",
  embeddingDim: Number(process.env.EMBEDDING_DIM ?? "768"),
};

if (!config.apiKey) {
  logger.error("CONFIG", "缺少 OPENAI_API_KEY，请先复制 .env.example 为 .env 并填入密钥");
  process.exit(1);
}
// =============================================================

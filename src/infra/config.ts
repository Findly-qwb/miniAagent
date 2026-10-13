import "dotenv/config";
import { logger } from "./logger.js";

// ========== 配置 Todo0-4：从 .env 读取，禁止硬编码密钥 ==========
export const config = {
  apiKey: process.env.OPENAI_API_KEY ?? "",
  baseURL: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  model: process.env.OPENAI_MODEL ?? "deepseek-v4-flash",
  maxRound: Number(process.env.MAX_ROUND ?? "3"),
  maxContextTokens: Number(process.env.MAX_CONTEXT_TOKENS ?? "1000"), // 上下文窗口 token 上限（估算值）Todo1-2
};

if (!config.apiKey) {
  logger.error("CONFIG", "缺少 OPENAI_API_KEY，请先复制 .env.example 为 .env 并填入密钥");
  process.exit(1);
}
// =============================================================

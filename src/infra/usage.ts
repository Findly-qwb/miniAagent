import { mkdirSync, appendFileSync } from "node:fs";
import { logger } from "./logger.js";
import type { TokenUsage } from "../types.js";

// Token 统计打印 + 写入日志文件 Todo0-3
export const logTokenUsage = (roundUsage: TokenUsage, total: TokenUsage): void => {
  logger.info(
    "TOKEN",
    `本轮 prompt: ${roundUsage.prompt}, completion: ${roundUsage.completion}, total: ${roundUsage.total}`
  );
  try {
    mkdirSync("logs", { recursive: true });
    appendFileSync(
      "logs/token-usage.log",
      `${new Date().toISOString()} 本轮 prompt=${roundUsage.prompt} completion=${roundUsage.completion} total=${roundUsage.total} 累计=${total.total}\n`
    );
  } catch (err) {
    logger.error("TOKEN", "写入 token 日志文件失败", err);
  }
};

// 累计 Token 汇总打印
export const printUsageTotal = (total: TokenUsage): void => {
  logger.info("TOKEN", `累计 prompt: ${total.prompt}, completion: ${total.completion}, total: ${total.total}`);
};

import { createApp } from "./app.js";
import { logger } from "../infra/logger.js";
import { initMemoryStore } from "../infra/db.js";
import { initKnowledgeStore, ingestDirectory } from "../rag/knowledge.js";
import { startMetricsReporter } from "../infra/metrics.js";

// Todo4-1：HTTP 服务入口——先备好数据层再监听，启动即自检
const PORT = Number(process.env.PORT ?? "3000");

const main = async (): Promise<void> => {
  await initMemoryStore();
  await initKnowledgeStore();
  const ingest = await ingestDirectory("docs/knowledge");
  logger.info("SERVER", `知识库初始化：${ingest.ok ? ingest.data : ingest.error}`);

  startMetricsReporter(); // Todo4-6：每 5 分钟打印监控快照
  createApp().listen(PORT, () => {
    logger.info("SERVER", `HTTP 服务已启动: http://localhost:${PORT}/api/health`);
  });
};

main().catch((err) => {
  logger.error("SERVER", "启动失败", err);
  process.exit(1);
});

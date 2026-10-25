import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chatRouter } from "./routes/chat.js";
import { knowledgeRouter } from "./routes/knowledge.js";

// Todo4-1：Express 装配——Agent 能力的 HTTP 门面
// Todo4-4：web/dist 存在时同端口托管前端静态资源（单容器部署），不存在则纯 API 模式
export const createApp = (): express.Express => {
  const app = express();
  app.use(cors()); // Todo4-2 前端跨域
  app.use(express.json({ limit: "2mb" })); // 文档上传正文上限

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use("/api", chatRouter);
  app.use("/api/knowledge", knowledgeRouter);

  const webDist = join(process.cwd(), "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    // SPA 回退：非 /api 的 GET 一律回 index.html（Express 5 通配语法 {*path}）
    app.get("/{*path}", (_req, res) => res.sendFile(join(webDist, "index.html")));
  }
  return app;
};

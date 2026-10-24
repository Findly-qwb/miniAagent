import express from "express";
import cors from "cors";
import { chatRouter } from "./routes/chat.js";
import { knowledgeRouter } from "./routes/knowledge.js";

// Todo4-1：Express 装配——Agent 能力的 HTTP 门面
export const createApp = (): express.Express => {
  const app = express();
  app.use(cors()); // Todo4-2 前端跨域
  app.use(express.json({ limit: "2mb" })); // 文档上传正文上限

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use("/api", chatRouter);
  app.use("/api/knowledge", knowledgeRouter);
  return app;
};

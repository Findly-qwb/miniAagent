import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chatRouter } from "./routes/chat.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { recordRequest, routeKeyOf, getMetrics } from "../infra/metrics.js";

// Todo4-1：Express 装配——Agent 能力的 HTTP 门面
// Todo4-4：web/dist 存在时同端口托管前端静态资源（单容器部署），不存在则纯 API 模式
export const createApp = (): express.Express => {
  const app = express();
  app.use(cors()); // Todo4-2 前端跨域
  app.use(express.json({ limit: "2mb" })); // 文档上传正文上限

  // Todo4-6：每请求记录耗时与状态码（res.on("finish") 保证响应真正完成后才计数）
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => recordRequest(routeKeyOf(req), res.statusCode, Date.now() - start));
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // Todo4-6：监控快照（请求量/错误/任务成功率/各路由耗时）
  app.get("/api/metrics", (_req, res) => {
    res.json(getMetrics());
  });

  app.use("/api", chatRouter);
  app.use("/api/knowledge", knowledgeRouter);

  const webDist = join(process.cwd(), "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    // SPA 回退：非 /api 的 GET 一律回 index.html（Express 5 通配语法 {*path}）；
    // /api 下的未知路由必须返回 404 JSON，不能被回退吞成 200 HTML（实测踩坑）
    app.get("/{*path}", (req, res) => {
      if (req.path.startsWith("/api/")) {
        res.status(404).json({ ok: false, error: `未知接口: ${req.path}` });
        return;
      }
      res.sendFile(join(webDist, "index.html"));
    });
  }
  return app;
};

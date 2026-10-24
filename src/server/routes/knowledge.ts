import { Router } from "express";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ingestDocument } from "../../rag/knowledge.js";
import { pool } from "../../infra/db.js";

// Todo4-1：知识库管理接口（上传入口为 Todo4-2 前端准备）
export const knowledgeRouter = Router();

const DOCS_DIR = "docs/knowledge";

// 上传文档：JSON {name, content} → 落盘 docs/knowledge/ → 分块 embedding 入库（幂等重灌）
knowledgeRouter.post("/upload", async (req, res) => {
  const { name, content } = req.body as { name?: string; content?: string };
  if (!name || !content?.trim()) {
    res.status(400).json({ ok: false, error: "name 与 content 必填" });
    return;
  }
  if (!/\.(md|txt)$/i.test(name)) {
    res.status(400).json({ ok: false, error: "仅支持 .md / .txt 文档" });
    return;
  }
  // 防路径穿越：只取文件名部分
  const safeName = name.split(/[\\/]/).pop() ?? name;
  try {
    mkdirSync(DOCS_DIR, { recursive: true });
    writeFileSync(join(DOCS_DIR, safeName), content, "utf8");
    const result = await ingestDocument(join(DOCS_DIR, safeName));
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: `上传失败: ${String(err)}` });
  }
});

// 已入库文档列表（按 doc 聚合分块数）
knowledgeRouter.get("/docs", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT doc_id, doc_name, count(*)::int AS chunks, max(created_at) AS updated_at
       FROM knowledge_chunks GROUP BY doc_id, doc_name ORDER BY max(created_at) DESC`
    );
    res.json({ docs: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: `查询失败: ${String(err)}` });
  }
});

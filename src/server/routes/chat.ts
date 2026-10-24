import { Router } from "express";
import { randomUUID } from "node:crypto";
import { agentLoop } from "../../core/agent.js";
import { listSessions, getSession, clearSession } from "../../core/session.js";
import { logEmitter, requestContext, type LogEvent } from "../../infra/logger.js";

// Todo4-1：对话与会话管理接口
export const chatRouter = Router();

// 会话列表：id + 消息数 + 更新时间
chatRouter.get("/sessions", (_req, res) => {
  const sessions = listSessions().map((id) => {
    const s = getSession(id);
    return { sessionId: id, messages: s?.messages.length ?? 0, updatedAt: s?.updatedAt ?? "" };
  });
  res.json({ sessions });
});

// 清空指定会话
chatRouter.delete("/sessions/:id", (req, res) => {
  res.json({ ok: clearSession(req.params.id) });
});

// 对话接口：SSE 流式返回——思考链路（模型输出/工具调用/检索命中）逐条推送，
// 长任务（run_task 分钟级）不再阻塞 HTTP 响应，前端实时可见进度
chatRouter.post("/chat", (req, res) => {
  const { sessionId, message } = req.body as { sessionId?: string; message?: string };
  if (!sessionId || !message?.trim()) {
    res.status(400).json({ ok: false, error: "sessionId 与 message 必填" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const reqId = randomUUID();
  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 只推本次请求的日志（按 reqId 过滤，多用户并发互不串台）
  const onLog = (ev: LogEvent): void => {
    if (ev.reqId === reqId) send("log", ev);
  };
  logEmitter.on("log", onLog);
  const cleanup = (): void => {
    logEmitter.off("log", onLog);
  };
  // 监听响应连接关闭（客户端断开），而非 req 的 close——POST body 读完 req 就 close，
  // 误用 req 会在 agentLoop 刚起步时就移除 listener，导致后续日志丢失（实测踩坑）
  res.on("close", cleanup);

  // AsyncLocalStorage：agentLoop 调用链内所有 logger 输出自动携带 reqId
  void requestContext.run({ reqId }, async () => {
    try {
      const answer = await agentLoop(sessionId, message);
      send("result", { answer });
    } catch (err) {
      send("error", { error: String(err) });
    } finally {
      send("done", {});
      cleanup();
      res.end();
    }
  });
});

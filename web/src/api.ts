// 与后端 src/infra/logger.ts 的 LogEvent 结构对齐
export interface LogEvent {
  time: string;
  level: "INFO" | "WARN" | "ERROR";
  tag: string;
  message: string;
  reqId?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SessionInfo {
  sessionId: string;
  messages: number;
  updatedAt: string;
}

export interface DocInfo {
  doc_id: string;
  doc_name: string;
  chunks: number;
  updated_at: string;
}

// SSE 事件回调集合
export interface StreamHandlers {
  onLog: (ev: LogEvent) => void;
  onResult: (answer: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

// 解析 SSE 流：fetch + ReadableStream（EventSource 不支持 POST，故手写解析）
export const streamChat = async (
  sessionId: string,
  message: string,
  h: StreamHandlers,
  signal?: AbortSignal
): Promise<void> => {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
    signal,
  });
  if (!resp.ok || !resp.body) {
    h.onError(`HTTP ${resp.status}`);
    h.onDone();
    return;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE 帧以空行分隔
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      try {
        const payload = JSON.parse(data);
        if (event === "log") h.onLog(payload as LogEvent);
        else if (event === "result") h.onResult(String(payload.answer ?? ""));
        else if (event === "error") h.onError(String(payload.error ?? "未知错误"));
        else if (event === "done") h.onDone();
      } catch {
        // 忽略无法解析的帧
      }
    }
  }
  h.onDone();
};

export const api = {
  sessions: async (): Promise<SessionInfo[]> => {
    const r = await fetch("/api/sessions");
    return (await r.json()).sessions ?? [];
  },
  clearSession: async (id: string): Promise<void> => {
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  docs: async (): Promise<DocInfo[]> => {
    const r = await fetch("/api/knowledge/docs");
    return (await r.json()).docs ?? [];
  },
  upload: async (name: string, content: string): Promise<{ ok: boolean; data?: string; error?: string }> => {
    const r = await fetch("/api/knowledge/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content }),
    });
    return r.json();
  },
};

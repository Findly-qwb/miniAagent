import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat, api, type ChatMessage, type LogEvent, type SessionInfo } from "./api";
import { SessionSidebar } from "./components/SessionSidebar";
import { ChatPanel } from "./components/ChatPanel";
import { LogStream } from "./components/LogStream";
import { KnowledgePanel } from "./components/KnowledgePanel";

// Todo4-2：控制台主界面——会话切换 / 对话 / 思考链路 / 知识库上传
const newSessionId = (): string => `web-${Date.now().toString(36)}`;

const App = (): JSX.Element => {
  const [sessionId, setSessionId] = useState<string>(
    () => localStorage.getItem("miniagent.session") ?? newSessionId()
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    localStorage.setItem("miniagent.session", sessionId);
    setMessages([]);
    setLogs([]);
  }, [sessionId]);

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await api.sessions());
    } catch {
      // 后端未启动时静默
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
    const timer = setInterval(refreshSessions, 5000);
    return () => clearInterval(timer);
  }, [refreshSessions]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      if (streaming || !text.trim()) return;
      setMessages((m) => [...m, { role: "user", content: text }]);
      setLogs([]);
      setStreaming(true);
      abortRef.current = new AbortController();
      await streamChat(
        sessionId,
        text,
        {
          onLog: (ev) => setLogs((l) => [...l, ev]),
          onResult: (answer) => setMessages((m) => [...m, { role: "assistant", content: answer }]),
          onError: (error) => setMessages((m) => [...m, { role: "assistant", content: `⚠ ${error}` }]),
          onDone: () => {
            setStreaming(false);
            void refreshSessions();
          },
        },
        abortRef.current.signal
      );
    },
    [sessionId, streaming, refreshSessions]
  );

  const stop = useCallback((): void => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  return (
    <div className="layout">
      <SessionSidebar
        sessions={sessions}
        current={sessionId}
        onSelect={setSessionId}
        onNew={() => setSessionId(newSessionId())}
        onDelete={async (id) => {
          await api.clearSession(id);
          if (id === sessionId) setSessionId(newSessionId());
          void refreshSessions();
        }}
      />
      <main className="main">
        <ChatPanel messages={messages} streaming={streaming} onSend={send} onStop={stop} />
        <LogStream logs={logs} streaming={streaming} />
      </main>
      <KnowledgePanel />
    </div>
  );
};

export default App;

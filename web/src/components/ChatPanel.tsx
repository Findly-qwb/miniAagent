import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../api";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

// 对话面板：消息流 + 输入框
export const ChatPanel = ({ messages, streaming, onSend, onStop }: Props): JSX.Element => {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  const submit = (): void => {
    if (!input.trim() || streaming) return;
    onSend(input);
    setInput("");
  };

  return (
    <section className="chat">
      <div className="messages">
        {messages.length === 0 && !streaming && (
          <div className="placeholder">开始对话吧——试试「帮我算 12+34」「专业版多少钱」或「写一份产品一页纸」</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="role">{m.role === "user" ? "我" : "Agent"}</div>
            <div className="content">{m.content}</div>
          </div>
        ))}
        {streaming && <div className="msg assistant pending"><div className="role">Agent</div><div className="content">思考中…</div></div>}
        <div ref={bottomRef} />
      </div>
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="输入消息，Enter 发送 / Shift+Enter 换行"
          rows={2}
        />
        {streaming ? (
          <button className="btn danger" onClick={onStop}>停止</button>
        ) : (
          <button className="btn primary" onClick={submit} disabled={!input.trim()}>发送</button>
        )}
      </div>
    </section>
  );
};

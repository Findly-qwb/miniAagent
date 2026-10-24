import { useEffect, useRef } from "react";
import type { LogEvent } from "../api";

interface Props {
  logs: LogEvent[];
  streaming: boolean;
}

// 思考链路面板：SSE 实时推送的 Agent 日志（模型输出/工具调用/检索命中/状态迁移）
export const LogStream = ({ logs, streaming }: Props): JSX.Element => {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [logs.length]);

  return (
    <section className="logstream">
      <div className="log-title">
        思考链路
        {streaming && <span className="pulse">● 运行中</span>}
      </div>
      <div className="log-body">
        {logs.length === 0 && <div className="empty">发送消息后，这里实时显示 Agent 的每一步</div>}
        {logs.map((l, i) => (
          <div key={i} className={`log-line ${l.level.toLowerCase()}`}>
            <span className="log-time">{l.time.slice(11, 19)}</span>
            <span className={`log-tag tag-${l.tag.toLowerCase()}`}>{l.tag}</span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
};

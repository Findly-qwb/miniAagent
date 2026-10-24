import type { SessionInfo } from "../api";

interface Props {
  sessions: SessionInfo[];
  current: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

// 会话侧栏：切换 / 新建 / 清空
export const SessionSidebar = ({ sessions, current, onSelect, onNew, onDelete }: Props): JSX.Element => (
  <aside className="sidebar">
    <div className="brand">miniAgent</div>
    <button className="btn primary block" onClick={onNew}>
      + 新会话
    </button>
    <div className="section-title">会话</div>
    <ul className="session-list">
      {sessions.map((s) => (
        <li key={s.sessionId} className={s.sessionId === current ? "active" : ""}>
          <button className="session-item" onClick={() => onSelect(s.sessionId)} title={s.sessionId}>
            <span className="session-name">{s.sessionId}</span>
            <span className="session-meta">{s.messages} 条</span>
          </button>
          <button className="btn danger tiny" onClick={() => onDelete(s.sessionId)} title="清空会话">
            ×
          </button>
        </li>
      ))}
      {sessions.length === 0 && <li className="empty">暂无会话</li>}
    </ul>
  </aside>
);

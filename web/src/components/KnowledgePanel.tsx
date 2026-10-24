import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DocInfo } from "../api";

// 知识库面板：已入库文档列表 + 文件上传（.md/.txt 读取后 POST）
export const KnowledgePanel = (): JSX.Element => {
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const [status, setStatus] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setDocs(await api.docs());
    } catch {
      // 后端未启动时静默
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFile = async (file: File): Promise<void> => {
    if (!/\.(md|txt)$/i.test(file.name)) {
      setStatus("⚠ 仅支持 .md / .txt");
      return;
    }
    setStatus(`正在入库 ${file.name}…`);
    const content = await file.text();
    const r = await api.upload(file.name, content);
    setStatus(r.ok ? `✅ ${r.data}` : `⚠ ${r.error}`);
    if (r.ok) void refresh();
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <aside className="knowledge">
      <div className="section-title">知识库</div>
      <button className="btn block" onClick={() => fileRef.current?.click()}>
        上传文档 (.md / .txt)
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.txt"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
      />
      {status && <div className="upload-status">{status}</div>}
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d.doc_id}>
            <span className="doc-name" title={d.doc_name}>{d.doc_name}</span>
            <span className="doc-chunks">{d.chunks} 块</span>
          </li>
        ))}
        {docs.length === 0 && <li className="empty">尚未入库文档</li>}
      </ul>
    </aside>
  );
};

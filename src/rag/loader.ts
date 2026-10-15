import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

// 支持的文档扩展名：Markdown / TXT
const SUPPORTED_EXT = new Set([".md", ".txt"]);

// 加载后的文档原始结构
export interface LoadedDoc {
  docId: string; // 唯一标识（文件名去扩展）
  name: string; // 原始文件名
  content: string; // 全文
}

// 读取单个文件为 LoadedDoc；仅支持 md/txt，其它扩展名返回 null
export const loadFile = (filePath: string): LoadedDoc | null => {
  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) return null;
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const docId = name.replace(/\.[^.]+$/, "");
  return { docId, name, content: readFileSync(filePath, "utf8") };
};

// 递归读取目录下全部 md/txt 文档
export const loadDirectory = (dirPath: string): LoadedDoc[] => {
  const docs: LoadedDoc[] = [];
  for (const entry of readdirSync(dirPath)) {
    const full = join(dirPath, entry);
    if (statSync(full).isDirectory()) {
      docs.push(...loadDirectory(full));
    } else {
      const doc = loadFile(full);
      if (doc) docs.push(doc);
    }
  }
  return docs;
};

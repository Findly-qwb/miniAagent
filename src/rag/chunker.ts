// 固定窗口分块 + 重叠：相邻块共享一段文本，避免语义被窗口边界切断
export interface Chunk {
  chunkIndex: number;
  text: string;
}

export const CHUNK_SIZE = 300; // 单块目标字符数
export const CHUNK_OVERLAP = 50; // 相邻块重叠字符数

// 按字符窗口切分，末尾不足一块的也保留（不丢弃尾部信息）
export const chunkText = (text: string): Chunk[] => {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const chunks: Chunk[] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  let start = 0;
  let index = 0;
  while (start < normalized.length) {
    const end = Math.min(start + CHUNK_SIZE, normalized.length);
    chunks.push({ chunkIndex: index++, text: normalized.slice(start, end) });
    if (end >= normalized.length) break;
    start += step;
  }
  return chunks;
};

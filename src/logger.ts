// ========== 日志工具 Todo0-5：INFO / WARN / ERROR 分级 ==========
const timestamp = (): string => new Date().toISOString();

export const logger = {
  info: (tag: string, message: string): void =>
    console.log(`[${timestamp()}] [INFO] [${tag}] ${message}`),
  warn: (tag: string, message: string): void =>
    console.warn(`[${timestamp()}] [WARN] [${tag}] ${message}`),
  error: (tag: string, message: string, detail?: unknown): void =>
    console.error(`[${timestamp()}] [ERROR] [${tag}] ${message}`, detail ?? ""),
};
// ============================================================

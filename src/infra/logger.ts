import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";

// ========== 日志工具 Todo0-5：INFO / WARN / ERROR 分级 ==========
const timestamp = (): string => new Date().toISOString();

export type LogLevel = "INFO" | "WARN" | "ERROR";

// 结构化日志事件（Todo4-1：SSE 推送给前端的载荷）
export interface LogEvent {
  time: string;
  level: LogLevel;
  tag: string;
  message: string;
  reqId?: string; // 请求归属：AsyncLocalStorage 注入，SSE 按此过滤
}

// 日志事件总线：console 照常输出，同时广播给订阅者（HTTP 层）
export const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(200);

// 请求上下文：同一次 HTTP 请求内的所有日志（跨 await 链）都带同一个 reqId
export const requestContext = new AsyncLocalStorage<{ reqId?: string }>();

const publish = (level: LogLevel, tag: string, message: string, time: string): void => {
  logEmitter.emit("log", { time, level, tag, message, reqId: requestContext.getStore()?.reqId } as LogEvent);
};

export const logger = {
  info: (tag: string, message: string): void => {
    const t = timestamp();
    console.log(`[${t}] [INFO] [${tag}] ${message}`);
    publish("INFO", tag, message, t);
  },
  warn: (tag: string, message: string): void => {
    const t = timestamp();
    console.warn(`[${t}] [WARN] [${tag}] ${message}`);
    publish("WARN", tag, message, t);
  },
  error: (tag: string, message: string, detail?: unknown): void => {
    const t = timestamp();
    console.error(`[${t}] [ERROR] [${tag}] ${message}`, detail ?? "");
    const suffix = detail === undefined ? "" : ` ${detail instanceof Error ? detail.message : String(detail)}`;
    publish("ERROR", tag, message + suffix, t);
  },
};
// ============================================================

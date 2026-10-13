import { logger } from "./logger.js";
import type { AgentSession } from "./types.js";

// ========== 会话管理 Todo1-1：按 sessionId 隔离对话 ==========
const sessions = new Map<string, AgentSession>();

// 获取或创建会话：同 sessionId 复用历史，新 sessionId 全新隔离
export const getOrCreateSession = (sessionId: string): AgentSession => {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.set(sessionId, session);
    logger.info("SESSION", `创建新会话: ${sessionId}`);
  }
  return session;
};

// 查看会话（只读，便于调试）
export const getSession = (sessionId: string): AgentSession | undefined => sessions.get(sessionId);

// 列出全部会话 ID
export const listSessions = (): string[] => [...sessions.keys()];

// 清空指定会话历史
export const clearSession = (sessionId: string): boolean => sessions.delete(sessionId);
// =================================================================

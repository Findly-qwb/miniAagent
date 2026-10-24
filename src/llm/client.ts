import OpenAI from "openai";
import { config } from "../infra/config.js";

// SDK 的 fetch 选项类型基于 node-fetch 的 RequestInfo，与 Node 原生 fetch 签名不兼容，
// 运行时行为一致。改用原生 fetch 的原因：SDK 默认 node-fetch 会脱离 AsyncLocalStorage
// 上下文，导致 SSE 按 reqId 过滤日志时丢失网络 await 之后的日志（实测踩坑）
type SdkFetch = NonNullable<NonNullable<ConstructorParameters<typeof OpenAI>[0]>["fetch"]>;
export const nativeFetch = globalThis.fetch as unknown as SdkFetch;

// OpenAI 客户端单例：全项目共用一个连接配置
export const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
  fetch: nativeFetch,
});

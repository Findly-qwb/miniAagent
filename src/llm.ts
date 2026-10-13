import OpenAI from "openai";
import { config } from "./config.js";

// OpenAI 客户端单例：全项目共用一个连接配置
export const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
});

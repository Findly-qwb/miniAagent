import { openai } from "../llm/client.js";
import { config } from "./config.js";

// nomic-embed 系列要求区分「入库文档」与「查询语句」前缀，保证同空间对齐
const PREFIX = { document: "search_document: ", query: "search_query: " } as const;

// 调用 embeddings 接口把文本转为向量（维度由 EMBEDDING_DIM 决定）
export const embedText = async (text: string, kind: keyof typeof PREFIX): Promise<number[]> => {
  const resp = await openai.embeddings.create({
    model: config.embeddingModel,
    input: PREFIX[kind] + text,
    // SDK 默认 encoding_format=base64，LM Studio 会返回截断向量（192 维），必须显式要 float
    encoding_format: "float",
  });
  const vector = resp.data[0]?.embedding;
  if (!vector || vector.length !== config.embeddingDim) {
    throw new Error(`embedding 维度异常：期望 ${config.embeddingDim}，实际 ${vector?.length ?? 0}`);
  }
  return vector;
};

// number[] → pgvector 字面量 "[1,2,3]"
export const toVectorLiteral = (vector: number[]): string => `[${vector.join(",")}]`;

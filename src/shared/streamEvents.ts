// src/shared/streamEvents.ts
import { z } from 'zod'

/**
 * NormalizedEvent：stream-json 事件的单一事实来源（discriminated union）。
 *
 * 设计动机：原 `extractResultText` / `toTranscriptItems` 各自 walk 原始 JSON
 * 并重复 shape cast，类型不安全且难以 zod 校验。本 schema 把所有可能形态
 * 收敛到一个 discriminated union，调用方拿到 {@link NormalizedEvent} 后
 * 用 `switch (e.kind)` 即可，TypeScript 自动 narrow。
 */
export const NormalizedEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    kind: z.literal('result'),
    text: z.string(),
    /** 保留 stream-json 原始 is_error 字段，供 TranscriptView 区分成功/失败 */
    isError: z.boolean().optional()
  }),
  z.object({
    kind: z.literal('system'),
    subtype: z.string(),
    data: z.unknown().optional()
  }),
  z.object({ kind: z.literal('unknown'), raw: z.unknown() })
])

export type NormalizedEvent = z.infer<typeof NormalizedEventSchema>
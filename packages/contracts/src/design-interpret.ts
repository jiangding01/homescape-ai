import { z } from 'zod'
import { DesignOperationSchema } from './common'

/** /api/design/interpret 路径（旧接口，不带 /api/v1 前缀）。 */
export const DESIGN_INTERPRET_PATH = '/api/design/interpret'

export const MAX_COMMAND_LENGTH = 500
export const MAX_CONTEXT_OBJECTS = 100
export const MAX_CONTEXT_OBJECT_WIDTH = 100_000
const MAX_SHORT_STRING_LENGTH = 100

const ShortStringSchema = z.string().max(MAX_SHORT_STRING_LENGTH)

/** 非空且不能只含空白；不改写原值。 */
const nonBlank = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim().length > 0, { message: '不能只包含空白字符。' })

export const DesignCommandContextObjectSchema = z.strictObject({
  id: ShortStringSchema,
  category: ShortStringSchema,
  label: ShortStringSchema,
  locked: z.boolean(),
  roomId: ShortStringSchema.optional(),
  zoneId: ShortStringSchema.optional(),
  width: z.number().min(0).max(MAX_CONTEXT_OBJECT_WIDTH).optional(),
  colorFamily: ShortStringSchema.optional(),
})

export const DesignCommandRequestSchema = z.strictObject({
  requestId: nonBlank(MAX_SHORT_STRING_LENGTH),
  command: nonBlank(MAX_COMMAND_LENGTH),
  context: z.strictObject({
    projectId: ShortStringSchema,
    activeRoom: z.strictObject({ id: ShortStringSchema, name: ShortStringSchema }),
    objects: z.array(DesignCommandContextObjectSchema).max(MAX_CONTEXT_OBJECTS),
  }),
})

const ChoiceSignalSchema = z.object({ value: z.string(), confidence: z.number() })

export const DesignInterpretationSchema = z.object({
  status: z.enum(['ready', 'needs_clarification', 'unsupported', 'no_change']),
  message: z.string(),
  operations: z.array(DesignOperationSchema),
  decisions: z.object({
    intent: ChoiceSignalSchema,
    scope: ChoiceSignalSchema,
    target: ChoiceSignalSchema,
    category: ChoiceSignalSchema,
    size: ChoiceSignalSchema,
    color: ChoiceSignalSchema,
    seats: ChoiceSignalSchema,
    style: ChoiceSignalSchema,
    preserveOthers: z.number(),
  }),
  meta: z.object({
    provider: z.string(),
    model: z.string(),
    latencyMs: z.number(),
    usage: z
      .object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        cost: z.number().optional(),
      })
      .optional(),
  }),
})

export type DesignCommandContextObjectDto = z.infer<typeof DesignCommandContextObjectSchema>
export type DesignCommandRequestDto = z.infer<typeof DesignCommandRequestSchema>
export type DesignInterpretation = z.infer<typeof DesignInterpretationSchema>
export type DesignInterpretationMeta = DesignInterpretation['meta']

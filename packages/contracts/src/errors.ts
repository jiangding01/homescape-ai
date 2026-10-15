import { z } from 'zod'
import { ViolationSchema } from './common'

/**
 * /api/v1 错误码与 HTTP 状态：
 * - 400 INVALID_REQUEST：请求体结构不符合契约
 * - 404 PROJECT_NOT_FOUND
 * - 409 REVISION_CONFLICT：baseRevisionId 与当前 head 不一致（附当前 headRevisionId）
 * - 409 NOTHING_TO_UNDO / NOTHING_TO_REDO：撤销 / 重做栈为空（附当前 headRevisionId）
 * - 413 PAYLOAD_TOO_LARGE / 429 RATE_LIMITED
 * - 422 CONSTRAINT_VIOLATION：Planner 约束不通过（附 violations）
 * - 422 NO_EFFECTIVE_CHANGE：操作没有产生任何状态变化
 * - 422 TARGET_LOCKED / UNLOCK_NOT_PERMITTED：Revision 引擎拒绝修改锁定目标或越权解锁
 * - 422 INVALID_SPATIAL_MODEL：空间模型未通过领域校验（附 violations）
 * - 422 UNSUPPORTED_SCHEMA_VERSION：空间模型 schemaVersion 不受支持
 * - 500 INTERNAL_ERROR
 */
export const API_ERROR_CODES = [
  'INVALID_REQUEST',
  'PROJECT_NOT_FOUND',
  'REVISION_CONFLICT',
  'NOTHING_TO_UNDO',
  'NOTHING_TO_REDO',
  'CONSTRAINT_VIOLATION',
  'NO_EFFECTIVE_CHANGE',
  'TARGET_LOCKED',
  'UNLOCK_NOT_PERMITTED',
  'INVALID_SPATIAL_MODEL',
  'UNSUPPORTED_SCHEMA_VERSION',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'BAD_REQUEST',
  'INTERNAL_ERROR',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const ApiErrorSchema = z.object({
  /** 机器可读错误码；/api/v1 使用 API_ERROR_CODES，旧接口可能返回其他码。 */
  code: z.string(),
  /** 面向用户的简体中文说明。 */
  message: z.string(),
  violations: z.array(ViolationSchema).optional(),
  /** 409 时返回服务端当前 head，客户端据此重新拉取。 */
  headRevisionId: z.string().nullable().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})

export const ApiErrorResponseSchema = z.object({ error: ApiErrorSchema })

export type ApiError = z.infer<typeof ApiErrorSchema>
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>

import type { DesignOperation, DesignScope, DesignState } from '@homescape/domain'
import type { HomeSpatialModel } from '@homescape/spatial-model'
import { z } from 'zod'

export const MAX_ID_LENGTH = 100
export const MAX_NAME_LENGTH = 100
export const MAX_REQUEST_TEXT_LENGTH = 500
export const MAX_OPERATIONS_PER_REVISION = 50

export const IdSchema = z.string().min(1).max(MAX_ID_LENGTH)
export const TimestampSchema = z.string().min(1)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * HomeSpatialModel 体量大且有自身的几何校验（validateHomeSpatialModel），
 * 这里只做顶层结构检查；服务端在此之后必须再调用领域校验。
 */
export const HomeSpatialModelSchema = z.custom<HomeSpatialModel>(
  (value) =>
    isRecord(value) &&
    typeof value.schemaVersion === 'string' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.unit === 'meter' &&
    value.coordinateSystem === 'right-handed-y-up' &&
    Array.isArray(value.floors),
  {
    message:
      '空间模型结构无效：缺少 schemaVersion / id / name / unit / coordinateSystem / floors。',
  },
)

/** DesignState 由服务端生成，响应中只做顶层结构检查。 */
export const DesignStateSchema = z.custom<DesignState>(
  (value) =>
    isRecord(value) &&
    typeof value.schemaVersion === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.spatialModelId === 'string' &&
    Number.isInteger(value.version) &&
    isRecord(value.objects) &&
    isRecord(value.materials) &&
    isRecord(value.styleIntents) &&
    isRecord(value.locks),
  { message: 'DesignState 结构无效。' },
)

export const DesignScopeSchema: z.ZodType<DesignScope> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('project'), projectId: IdSchema }),
  z.strictObject({ type: z.literal('floor'), floorId: IdSchema }),
  z.strictObject({ type: z.literal('room'), roomId: IdSchema }),
  z.strictObject({ type: z.literal('zone'), zoneId: IdSchema }),
  z.strictObject({ type: z.literal('object'), objectId: IdSchema }),
])

const UnknownRecordSchema = z.record(z.string(), z.unknown())
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const operationBase = {
  /** 客户端 ID 仅用于对应请求与响应；服务端提交时会重写为 UUID v7。 */
  id: IdSchema,
  scope: DesignScopeSchema,
  source: z.enum(['user', 'ai', 'planner', 'rule', 'system']),
}

export const DesignOperationSchema: z.ZodType<DesignOperation> = z.discriminatedUnion('type', [
  z.strictObject({
    ...operationBase,
    type: z.literal('add_object'),
    category: IdSchema,
    requirements: UnknownRecordSchema,
  }),
  z.strictObject({ ...operationBase, type: z.literal('remove_object'), objectId: IdSchema }),
  z.strictObject({
    ...operationBase,
    type: z.literal('replace_object'),
    objectId: IdSchema,
    requirements: UnknownRecordSchema,
  }),
  z.strictObject({
    ...operationBase,
    type: z.literal('move_object'),
    objectId: IdSchema,
    position: Vec3Schema,
  }),
  z.strictObject({
    ...operationBase,
    type: z.literal('rotate_object'),
    objectId: IdSchema,
    yaw: z.number(),
  }),
  z.strictObject({
    ...operationBase,
    type: z.literal('set_material'),
    targetId: IdSchema,
    material: UnknownRecordSchema,
  }),
  z.strictObject({
    ...operationBase,
    type: z.literal('set_style_intent'),
    targetId: IdSchema,
    style: UnknownRecordSchema,
  }),
  z.strictObject({ ...operationBase, type: z.literal('preserve'), targetId: IdSchema }),
  z.strictObject({ ...operationBase, type: z.literal('lock'), targetId: IdSchema }),
  z.strictObject({ ...operationBase, type: z.literal('unlock'), targetId: IdSchema }),
])

/** 约束 / 校验违规：Planner 约束违规与空间模型校验问题共用。 */
export const ViolationSchema = z.object({
  code: z.string(),
  severity: z.enum(['warning', 'error']),
  message: z.string(),
  operationId: z.string().optional(),
  objectIds: z.array(z.string()).optional(),
  path: z.string().optional(),
  entityId: z.string().optional(),
})

export const PlannerDecisionSchema = z.object({
  operationId: z.string(),
  action: z.string(),
  candidateCount: z.number(),
  selectedAssetId: z.string().optional(),
  selectedVariantId: z.string().optional(),
  roomId: z.string().optional(),
  anchor: z.string().optional(),
  score: z.number().optional(),
})

export type Violation = z.infer<typeof ViolationSchema>
export type PlannerDecisionDto = z.infer<typeof PlannerDecisionSchema>

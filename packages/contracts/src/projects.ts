import { z } from 'zod'
import {
  DesignOperationSchema,
  DesignStateSchema,
  HomeSpatialModelSchema,
  IdSchema,
  MAX_NAME_LENGTH,
  MAX_OPERATIONS_PER_REVISION,
  MAX_REQUEST_TEXT_LENGTH,
  PlannerDecisionSchema,
  TimestampSchema,
  ViolationSchema,
} from './common'

/** /api/v1 路由前缀。 */
export const API_V1_PREFIX = '/api/v1'

/** 项目详情中返回的最近修订条数。 */
export const RECENT_REVISION_LIMIT = 20

// ---------- 响应 ----------

export const RevisionSummarySchema = z.object({
  id: z.string(),
  /** 在所属时间线中的序号，从 1 开始。 */
  seq: z.number().int().positive(),
  kind: z.enum(['commit', 'undo', 'redo']),
  parentRevisionId: z.string().nullable(),
  targetRevisionId: z.string().optional(),
  request: z.string().optional(),
  operationCount: z.number().int().nonnegative(),
  mutationCount: z.number().int().nonnegative(),
  actor: z.enum(['user', 'ai', 'system']),
  provider: z.string().optional(),
  model: z.string().optional(),
  stateVersionAfter: z.number().int(),
  createdAt: TimestampSchema,
})

/** 不可变的空间模型版本；id 为服务端版本 ID，与 model.id（模型自身 ID）不同。 */
export const SpatialModelVersionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  schemaVersion: z.string(),
  createdAt: TimestampSchema,
  model: HomeSpatialModelSchema,
})

export const ProjectDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  spatialModel: SpatialModelVersionSchema,
  /** 当前空间模型对应的修订时间线。 */
  timelineId: z.string(),
  state: DesignStateSchema,
  headRevisionId: z.string().nullable(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  revisionCount: z.number().int().nonnegative(),
  /** 最近的修订，按时间倒序，最多 RECENT_REVISION_LIMIT 条。 */
  recentRevisions: z.array(RevisionSummarySchema),
})

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  currentSpatialModelId: z.string(),
  headRevisionId: z.string().nullable(),
})

export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema),
})

export const PlannerFeedbackSchema = z.object({
  /** 未阻断提交的警告级违规。 */
  violations: z.array(ViolationSchema),
  decisions: z.array(PlannerDecisionSchema),
})

export const CommitRevisionResponseSchema = z.object({
  project: ProjectDetailSchema,
  revision: RevisionSummarySchema,
  /** 客户端操作 ID → 服务端重写后的操作 ID。 */
  operationIdMap: z.record(z.string(), z.string()),
  planner: PlannerFeedbackSchema,
})

export const TimelineChangeResponseSchema = z.object({
  project: ProjectDetailSchema,
  /** 本次追加的 undo / redo 补偿修订。 */
  revision: RevisionSummarySchema,
})

// ---------- 请求 ----------

export const CreateProjectRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
  /** 缺省使用示例户型。 */
  spatialModel: HomeSpatialModelSchema.optional(),
})

export const UploadSpatialModelRequestSchema = z.strictObject({
  spatialModel: HomeSpatialModelSchema,
})

export const CommitRevisionRequestSchema = z.strictObject({
  /** 客户端所见的最新修订 ID；时间线为空时为 null。 */
  baseRevisionId: IdSchema.nullable(),
  operations: z.array(DesignOperationSchema).min(1).max(MAX_OPERATIONS_PER_REVISION),
  /** 用户原始请求文本。 */
  request: z.string().trim().min(1).max(MAX_REQUEST_TEXT_LENGTH).optional(),
  provenance: z
    .strictObject({
      provider: z.string().min(1).max(100).optional(),
      model: z.string().min(1).max(100).optional(),
    })
    .optional(),
})

export const TimelineChangeRequestSchema = z.strictObject({
  baseRevisionId: IdSchema.nullable(),
})

export const UndoRequestSchema = TimelineChangeRequestSchema
export const RedoRequestSchema = TimelineChangeRequestSchema

export type RevisionSummary = z.infer<typeof RevisionSummarySchema>
export type SpatialModelVersion = z.infer<typeof SpatialModelVersionSchema>
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>
export type PlannerFeedback = z.infer<typeof PlannerFeedbackSchema>
export type CommitRevisionResponse = z.infer<typeof CommitRevisionResponseSchema>
export type TimelineChangeResponse = z.infer<typeof TimelineChangeResponseSchema>
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>
export type UploadSpatialModelRequest = z.infer<typeof UploadSpatialModelRequestSchema>
export type CommitRevisionRequest = z.infer<typeof CommitRevisionRequestSchema>
export type TimelineChangeRequest = z.infer<typeof TimelineChangeRequestSchema>

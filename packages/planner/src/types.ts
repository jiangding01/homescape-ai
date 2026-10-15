import type { DesignOperation, DesignState, ResolvedDesignMutation } from '@homescape/domain'
import type { HomeSpatialModel } from '@homescape/spatial-model'

export interface ConstraintViolation {
  code: string
  severity: 'warning' | 'error'
  message: string
  operationId?: string
  objectIds?: readonly string[]
}

export interface PlannerDecision {
  operationId: string
  action: string
  candidateCount: number
  selectedAssetId?: string
  selectedVariantId?: string
  roomId?: string
  anchor?: string
  score?: number
}

export interface PlannerInput {
  spatialModel: HomeSpatialModel
  state: DesignState
  operations: readonly DesignOperation[]
  /**
   * 为 add_object 新建的对象生成 ID。缺省为 `object-<operation.id>`（向后兼容前端本地流程）；
   * 服务端注入全局唯一 ID 生成器（UUID v7），避免与已持久化的同名对象冲突而覆盖。
   */
  createObjectId?: (operation: DesignOperation) => string
}

export function defaultCreateObjectId(operation: DesignOperation) {
  return 'object-' + operation.id
}

export interface PlannerResult {
  mutations: ResolvedDesignMutation[]
  violations: ConstraintViolation[]
  decisions: PlannerDecision[]
  diagnostics: {
    candidateCount: number
    rejectedCandidateCount: number
    elapsedMs: number
  }
}

export interface SpatialPlanner {
  plan(input: PlannerInput): Promise<PlannerResult>
}

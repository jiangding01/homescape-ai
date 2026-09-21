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

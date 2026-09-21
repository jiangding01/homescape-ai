import type { DesignOperation } from '@homescape/domain'
import type { HomeSpatialModel, Vec3 } from '@homescape/spatial-model'

export interface PlannedObject {
  id: string
  assetId: string
  position: Vec3
  yaw: number
  sourceOperationId?: string
}

export interface ConstraintViolation {
  code: string
  severity: 'warning' | 'error'
  message: string
  objectIds?: string[]
}

export interface PlannerInput {
  spatialModel: HomeSpatialModel
  operations: DesignOperation[]
  existingObjects: PlannedObject[]
}

export interface PlannerResult {
  objects: PlannedObject[]
  violations: ConstraintViolation[]
  diagnostics: {
    candidateCount: number
    elapsedMs: number
  }
}

export interface SpatialPlanner {
  plan(input: PlannerInput): Promise<PlannerResult>
}

import type { HomeSpatialModel, SpatialId } from './model'
import type { SpatialSourceKind } from './provenance'
import type { SpatialValidationResult } from './validation'

export type SpatialImportSourceKind = Exclude<SpatialSourceKind, 'manual' | 'inferred' | 'fixture'>

export interface SpatialImportContext {
  projectId: SpatialId
  projectName: string
  sourceKind: SpatialImportSourceKind
  sourceId?: string
  sourceLabel?: string
}

export interface SpatialUnresolvedIssue {
  id: string
  kind:
    | 'missing_dimension'
    | 'ambiguous_wall'
    | 'ambiguous_opening'
    | 'unknown_room_type'
    | 'topology_conflict'
    | 'low_confidence'
    | 'other'
  message: string
  entityIds?: SpatialId[]
  confidence?: number
  requiresHumanReview: boolean
}

export interface SpatialImportResult {
  model: HomeSpatialModel
  validation: SpatialValidationResult
  unresolved: SpatialUnresolvedIssue[]
  overallConfidence?: number
}

export interface SpatialImporter<TInput> {
  id: string
  supports(sourceKind: SpatialImportSourceKind): boolean
  parse(input: TInput, context: SpatialImportContext): Promise<SpatialImportResult>
}

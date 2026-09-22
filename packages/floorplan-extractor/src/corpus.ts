import type {
  FloorPlanDraftSourceKind,
} from '@homescape/spatial-model'

export type FloorPlanCorpusQuality =
  | 'clean'
  | 'compressed'
  | 'blurred'
  | 'scanned'

export type FloorPlanCorpusGeometry =
  | 'rectangular'
  | 'l_shape'
  | 'irregular'

export type FloorPlanCorpusAnnotation =
  | 'full_dimension'
  | 'partial_dimension'
  | 'no_dimension'

export type FloorPlanCorpusLayout =
  | 'single_room'
  | 'open_plan'
  | 'multi_room'

export type FloorPlanCorpusSymbols =
  | 'standard'
  | 'mixed'
  | 'unknown'

export type FloorPlanCorpusTextDensity =
  | 'sparse'
  | 'normal'
  | 'dense'
  | 'overlap'

export interface FloorPlanCorpusTags {
  quality: FloorPlanCorpusQuality
  geometry: FloorPlanCorpusGeometry
  annotation: FloorPlanCorpusAnnotation
  layout: FloorPlanCorpusLayout
  symbols: FloorPlanCorpusSymbols
  textDensity: FloorPlanCorpusTextDensity
}

export interface FloorPlanCorpusCase {
  id: string
  sourceKind: FloorPlanDraftSourceKind
  mediaType: string
  sourcePath: string
  groundTruthPath: string
  tags: FloorPlanCorpusTags
  notes?: string
}

export interface FloorPlanCorpusManifest {
  schemaVersion: '0.1.0'
  dataset: string
  cases: readonly FloorPlanCorpusCase[]
}

export interface FloorPlanCorpusCaseFingerprint {
  id: string
  caseFingerprint: string
  sourceBytes: number
  sourceSha256: string
  groundTruthSha256: string
  roomCount: number
  openingCount: number
}

export interface FloorPlanCorpusDistributions {
  sourceKind: Readonly<Record<string, number>>
  quality: Readonly<Record<string, number>>
  geometry: Readonly<Record<string, number>>
  annotation: Readonly<Record<string, number>>
  layout: Readonly<Record<string, number>>
  symbols: Readonly<Record<string, number>>
  textDensity: Readonly<Record<string, number>>
}

export interface FloorPlanCorpusSummary {
  schemaVersion: '0.1.0'
  dataset: string
  checkedAt: string
  datasetFingerprint: string
  caseCount: number
  totalSourceBytes: number
  roomCount: number
  openingCount: number
  distributions: FloorPlanCorpusDistributions
  cases: readonly FloorPlanCorpusCaseFingerprint[]
}

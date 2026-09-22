import type {
  FloorPlanDraft,
  FloorPlanDraftSourceKind,
} from '@homescape/spatial-model'

export type FloorPlanExtractorSourceKind = FloorPlanDraftSourceKind

export interface FloorPlanExtractorInput {
  sourceId: string
  kind: FloorPlanExtractorSourceKind
  mediaType: string
  bytes: Uint8Array
  filename?: string
}

export interface FloorPlanExtractionMetadata {
  extractorId: string
  provider?: string
  model?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  traceId?: string
}

export interface FloorPlanExtractionResult {
  draft: FloorPlanDraft
  metadata: FloorPlanExtractionMetadata
  warnings?: readonly string[]
}

export interface FloorPlanExtractor {
  readonly id: string
  supports(input: Pick<FloorPlanExtractorInput, 'kind' | 'mediaType'>): boolean
  extract(input: FloorPlanExtractorInput): Promise<FloorPlanExtractionResult>
}

export interface FloorPlanBenchmarkThresholds {
  roomMatchIou: number
  roomPrecisionMin: number
  roomRecallMin: number
  meanRoomIouMin: number
  roomTypeAccuracyMin: number
  candidateRoomOverlapRatioMax: number
  openingCenterToleranceRatio: number
  openingPrecisionMin: number
  openingRecallMin: number
  meanOpeningWidthErrorMax: number
  scaleErrorMax: number
}

export interface FloorPlanBenchmarkMetrics {
  draftValid: boolean
  sourceKindMatch: boolean
  sourceDimensionsMatch: boolean
  roomPrecision: number
  roomRecall: number
  meanRoomIou: number
  roomTypeAccuracy: number
  maxCandidateRoomOverlapRatio: number
  openingPrecision: number
  openingRecall: number
  meanOpeningCenterErrorRatio: number | null
  meanOpeningWidthErrorRatio: number | null
  scaleErrorRatio: number
}

export interface FloorPlanBenchmarkCaseResult {
  caseId: string
  extractorId: string
  expectedGate?: 'pass' | 'fail'
  gatePass: boolean
  expectationMatched?: boolean
  metrics: FloorPlanBenchmarkMetrics
  failures: readonly string[]
}

export interface FloorPlanBenchmarkExtractorSummary {
  extractorId: string
  caseCount: number
  gatePassCount: number
  gatePassRate: number
  meanRoomIou: number
  meanRoomRecall: number
  meanOpeningRecall: number
  meanScaleErrorRatio: number
}

export interface FloorPlanBenchmarkCandidateSpec {
  extractorId: string
  candidatePath: string
  expectedGate?: 'pass' | 'fail'
}

export interface FloorPlanBenchmarkCaseSpec {
  id: string
  sourcePath: string
  groundTruthPath: string
  candidates: readonly FloorPlanBenchmarkCandidateSpec[]
}

export interface FloorPlanBenchmarkManifest {
  schemaVersion: '0.1.0'
  dataset: string
  gridSize?: number
  thresholds: FloorPlanBenchmarkThresholds
  cases: readonly FloorPlanBenchmarkCaseSpec[]
}

export interface FloorPlanBenchmarkReport {
  schemaVersion: '0.1.0'
  dataset: string
  generatedAt: string
  thresholds: FloorPlanBenchmarkThresholds
  caseCount: number
  resultCount: number
  expectationMismatch: boolean
  results: readonly FloorPlanBenchmarkCaseResult[]
  extractors: readonly FloorPlanBenchmarkExtractorSummary[]
}

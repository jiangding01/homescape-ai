import type {
  FloorPlanBenchmarkMetrics,
  FloorPlanExtractionMetadata,
} from './types'
import type { FloorPlanCorpusTags } from './corpus'
import type {
  FloorPlanReviewBurdenRecord,
  FloorPlanReviewEditCounts,
} from './review-burden'

export interface FloorPlanPilotRunSpec {
  caseId: string
  extractorId: string
  candidatePath: string
  extractionMetadataPath?: string
  reviewBurdenPath?: string
}

export interface FloorPlanPilotManifest {
  schemaVersion: '0.1.0'
  dataset: string
  datasetFingerprint: string
  corpusManifestPath: string
  corpusSummaryPath: string
  benchmarkReportPath: string
  runs: readonly FloorPlanPilotRunSpec[]
}

export type FloorPlanPilotReviewRecord = Omit<
  FloorPlanReviewBurdenRecord,
  'sourceLabel'
>

export interface FloorPlanPilotCaseResult {
  caseId: string
  extractorId: string
  candidateSha256: string
  tags: FloorPlanCorpusTags
  gatePass: boolean
  metrics: FloorPlanBenchmarkMetrics
  extraction?: FloorPlanExtractionMetadata
  review?: FloorPlanPilotReviewRecord
}

export interface FloorPlanPilotReviewSummary {
  coverage: number
  meanDurationMs: number | null
  p50DurationMs: number | null
  p95DurationMs: number | null
  meanTotalEdits: number | null
  meanEditCounts: FloorPlanReviewEditCounts | null
}

export interface FloorPlanPilotExtractionSummary {
  coverage: number
  latencyCoverage: number
  costCoverage: number
  meanLatencyMs: number | null
  meanCostUsd: number | null
  providers: readonly string[]
  models: readonly string[]
}

export interface FloorPlanPilotSliceSummary {
  caseCount: number
  gatePassRate: number
  meanRoomIou: number
  meanRoomRecall: number
  meanOpeningRecall: number
  reviewCoverage: number
  meanReviewDurationMs: number | null
  meanTotalEdits: number | null
}

export interface FloorPlanPilotExtractorSummary
  extends FloorPlanPilotSliceSummary {
  extractorId: string
  review: FloorPlanPilotReviewSummary
  extraction: FloorPlanPilotExtractionSummary
  slices: Readonly<
    Record<
      keyof FloorPlanCorpusTags,
      Readonly<Record<string, FloorPlanPilotSliceSummary>>
    >
  >
}

export interface FloorPlanPilotReport {
  schemaVersion: '0.1.0'
  dataset: string
  datasetFingerprint: string
  generatedAt: string
  pilotFingerprint: string
  corpusManifestSha256: string
  corpusSummarySha256: string
  benchmarkSha256: string
  caseCount: number
  resultCount: number
  results: readonly FloorPlanPilotCaseResult[]
  extractors: readonly FloorPlanPilotExtractorSummary[]
  dataQuality: {
    missingBenchmarkCases: readonly string[]
    missingReviewBurden: readonly string[]
    missingExtractionMetadata: readonly string[]
    orphanRuns: readonly string[]
  }
}

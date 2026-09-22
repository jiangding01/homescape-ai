import type { FloorPlanDraftSourceKind } from '@homescape/spatial-model'

export type FloorPlanReviewEditKind =
  | 'room_vertex_move'
  | 'room_metadata'
  | 'opening_geometry'
  | 'calibration'
  | 'assumptions'
  | 'reset'

export interface FloorPlanReviewEditCounts {
  roomVertexMoves: number
  roomMetadataEdits: number
  openingGeometryEdits: number
  calibrationEdits: number
  assumptionEdits: number
  resets: number
}

export interface FloorPlanReviewBurdenRecord {
  schemaVersion: '0.1.0'
  sourceLabel: string
  sourceKind: FloorPlanDraftSourceKind
  startedAt: string
  completedAt: string
  durationMs: number
  totalEdits: number
  editCounts: FloorPlanReviewEditCounts
  touchedRoomIds: readonly string[]
  roomCount: number
  openingCount: number
  sourceImage?: {
    widthPx: number
    heightPx: number
    aspectRatioCompatible: boolean
  }
}

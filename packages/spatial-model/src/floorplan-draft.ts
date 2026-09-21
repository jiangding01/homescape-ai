import type { Opening, RoomType, SpatialId } from './model'
import type { SpatialImportSourceKind } from './importer'

export type PixelPoint = readonly [x: number, y: number]

export type FloorPlanDraftSourceKind = Extract<
  SpatialImportSourceKind,
  'floorplan_image' | 'floorplan_pdf' | 'company_data'
>

export interface FloorPlanCalibration {
  startPx: PixelPoint
  endPx: PixelPoint
  realDistanceMeters: number
}

export interface FloorPlanDraftAssumptions {
  wallThicknessMeters: number
  ceilingHeightMeters: number
  wallThicknessConfirmed: boolean
  ceilingHeightConfirmed: boolean
}

export interface FloorPlanDraftRoom {
  id: SpatialId
  name: string
  type?: RoomType
  boundaryPx: PixelPoint[]
  confidence?: number
}

export interface FloorPlanDraftOpening {
  id: SpatialId
  roomId: SpatialId
  edgeIndex: number
  kind: Opening['kind']
  offsetPx: number
  widthPx: number
  heightMeters: number
  sillHeightMeters?: number
  swing?: Opening['swing']
  confidence?: number
}

export interface FloorPlanDraft {
  schemaVersion: '0.1.0'
  source: {
    kind: FloorPlanDraftSourceKind
    widthPx: number
    heightPx: number
    sourceLabel: string
  }
  calibration: FloorPlanCalibration
  assumptions: FloorPlanDraftAssumptions
  rooms: FloorPlanDraftRoom[]
  openings: FloorPlanDraftOpening[]
}

const roomTypes = new Set<RoomType>([
  'living',
  'dining',
  'kitchen',
  'bedroom',
  'bathroom',
  'study',
  'balcony',
  'hallway',
  'utility',
  'other',
])

const sourceKinds = new Set<FloorPlanDraftSourceKind>([
  'floorplan_image',
  'floorplan_pdf',
  'company_data',
])

const openingKinds = new Set<Opening['kind']>([
  'door',
  'window',
  'opening',
])

const openingSwings = new Set<NonNullable<Opening['swing']>>([
  'left',
  'right',
  'double',
  'sliding',
  'none',
])

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalConfidence(value: unknown) {
  return (
    value === undefined ||
    (isFiniteNumber(value) && value >= 0 && value <= 1)
  )
}

function isPixelPoint(value: unknown): value is PixelPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  )
}

function isDraftRoom(value: unknown): value is FloorPlanDraftRoom {
  const room = asRecord(value)

  if (!room) return false

  return (
    typeof room.id === 'string' &&
    room.id.length > 0 &&
    typeof room.name === 'string' &&
    room.name.length > 0 &&
    (room.type === undefined ||
      (typeof room.type === 'string' &&
        roomTypes.has(room.type as RoomType))) &&
    Array.isArray(room.boundaryPx) &&
    room.boundaryPx.every(isPixelPoint) &&
    isOptionalConfidence(room.confidence)
  )
}

function isDraftOpening(
  value: unknown,
): value is FloorPlanDraftOpening {
  const opening = asRecord(value)

  if (!opening) return false

  return (
    typeof opening.id === 'string' &&
    opening.id.length > 0 &&
    typeof opening.roomId === 'string' &&
    opening.roomId.length > 0 &&
    typeof opening.edgeIndex === 'number' &&
    Number.isInteger(opening.edgeIndex) &&
    opening.edgeIndex >= 0 &&
    typeof opening.kind === 'string' &&
    openingKinds.has(opening.kind as Opening['kind']) &&
    isFiniteNumber(opening.offsetPx) &&
    isFiniteNumber(opening.widthPx) &&
    isFiniteNumber(opening.heightMeters) &&
    (opening.sillHeightMeters === undefined ||
      isFiniteNumber(opening.sillHeightMeters)) &&
    (opening.swing === undefined ||
      (typeof opening.swing === 'string' &&
        openingSwings.has(
          opening.swing as NonNullable<Opening['swing']>,
        ))) &&
    isOptionalConfidence(opening.confidence)
  )
}

export function isFloorPlanDraft(value: unknown): value is FloorPlanDraft {
  const record = asRecord(value)
  if (!record) return false

  const source = asRecord(record.source)
  const calibration = asRecord(record.calibration)
  const assumptions = asRecord(record.assumptions)

  return (
    record.schemaVersion === '0.1.0' &&
    Boolean(source) &&
    typeof source?.kind === 'string' &&
    sourceKinds.has(source.kind as FloorPlanDraftSourceKind) &&
    isFiniteNumber(source?.widthPx) &&
    isFiniteNumber(source?.heightPx) &&
    typeof source?.sourceLabel === 'string' &&
    Boolean(calibration) &&
    isPixelPoint(calibration?.startPx) &&
    isPixelPoint(calibration?.endPx) &&
    isFiniteNumber(calibration?.realDistanceMeters) &&
    Boolean(assumptions) &&
    isFiniteNumber(assumptions?.wallThicknessMeters) &&
    isFiniteNumber(assumptions?.ceilingHeightMeters) &&
    typeof assumptions?.wallThicknessConfirmed === 'boolean' &&
    typeof assumptions?.ceilingHeightConfirmed === 'boolean' &&
    Array.isArray(record.rooms) &&
    record.rooms.every(isDraftRoom) &&
    Array.isArray(record.openings) &&
    record.openings.every(isDraftOpening)
  )
}

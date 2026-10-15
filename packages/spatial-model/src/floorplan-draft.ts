import type { Opening, RoomType, SpatialId } from './model'
import type { SpatialImportSourceKind } from './importer'

export type PixelPoint = readonly [x: number, y: number]

export type FloorPlanDraftSourceKind = Extract<
  SpatialImportSourceKind,
  'floorplan_image' | 'floorplan_pdf' | 'company_data'
>

/**
 * 比例尺来源：
 * - assumed：未从图面读出，使用假设的 px/m（如 Raster 默认值），必须人工确认后才能 Finalize
 * - annotated：人工沿图上尺寸线标注
 * - extracted：自动（OCR / VLM 等）从图上尺寸标注读出，仍属 Candidate
 * - structured：来自米制结构化数据换算，比例精确
 * 缺省表示旧数据未声明来源（兼容已有人工 GT），不阻断 Finalize。
 */
export type FloorPlanCalibrationBasis =
  | 'assumed'
  | 'annotated'
  | 'extracted'
  | 'structured'

export interface FloorPlanCalibration {
  startPx: PixelPoint
  endPx: PixelPoint
  realDistanceMeters: number
  basis?: FloorPlanCalibrationBasis
}

export type FloorPlanCalibrationAxis = 'x' | 'y'

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
  /**
   * 横向（沿图像 x 轴）标定；若未提供 calibrationY，则视为唯一标定并按等比缩放处理。
   */
  calibration: FloorPlanCalibration
  /**
   * 可选的纵向（沿图像 y 轴）标定。网络户型图常被非等比缩放，
   * 提供后像素 → 米换算按 x / y 分轴进行。
   */
  calibrationY?: FloorPlanCalibration
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

const calibrationBases = new Set<FloorPlanCalibrationBasis>([
  'assumed',
  'annotated',
  'extracted',
  'structured',
])

export function isFloorPlanCalibrationBasis(
  value: unknown,
): value is FloorPlanCalibrationBasis {
  return (
    typeof value === 'string' &&
    calibrationBases.has(value as FloorPlanCalibrationBasis)
  )
}

function isCalibration(value: unknown): value is FloorPlanCalibration {
  const calibration = asRecord(value)

  return (
    Boolean(calibration) &&
    isPixelPoint(calibration?.startPx) &&
    isPixelPoint(calibration?.endPx) &&
    isFiniteNumber(calibration?.realDistanceMeters) &&
    (calibration?.basis === undefined ||
      isFloorPlanCalibrationBasis(calibration.basis))
  )
}

/**
 * 双轴标定时检查标定线方向：横向标定须 |dx| ≥ |dy|，纵向标定须 |dy| ≥ |dx|。
 * 方向写反会把 sx / sy 互换，产生与非等比缩放同量级（10%+）的面积误差且无任何征兆，
 * 因此作为硬错误而不是警告。仅有单条标定（等比）时不限制方向，以兼容旧数据。
 * 返回错误信息；方向合格时返回 undefined。
 */
export function getFloorPlanCalibrationAxisError(
  calibration: Pick<FloorPlanCalibration, 'startPx' | 'endPx'>,
  axis: FloorPlanCalibrationAxis,
): string | undefined {
  const dx = Math.abs(calibration.endPx[0] - calibration.startPx[0])
  const dy = Math.abs(calibration.endPx[1] - calibration.startPx[1])

  if (axis === 'x' && dx < dy) {
    return 'calibration（横向标定）必须基本沿水平方向（|dx| ≥ |dy|）'
  }

  if (axis === 'y' && dy < dx) {
    return 'calibrationY（纵向标定）必须基本沿竖直方向（|dy| ≥ |dx|）'
  }

  return undefined
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
  const assumptions = asRecord(record.assumptions)
  const calibrationValid = isCalibration(record.calibration)
  const calibrationYValid =
    record.calibrationY === undefined ||
    isCalibration(record.calibrationY)
  const axesValid =
    record.calibrationY === undefined ||
    (calibrationValid &&
      calibrationYValid &&
      !getFloorPlanCalibrationAxisError(
        record.calibration as FloorPlanCalibration,
        'x',
      ) &&
      !getFloorPlanCalibrationAxisError(
        record.calibrationY as FloorPlanCalibration,
        'y',
      ))

  return (
    record.schemaVersion === '0.1.0' &&
    Boolean(source) &&
    typeof source?.kind === 'string' &&
    sourceKinds.has(source.kind as FloorPlanDraftSourceKind) &&
    isFiniteNumber(source?.widthPx) &&
    isFiniteNumber(source?.heightPx) &&
    typeof source?.sourceLabel === 'string' &&
    calibrationValid &&
    calibrationYValid &&
    axesValid &&
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

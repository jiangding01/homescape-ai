import type {
  Opening,
  PixelPoint,
  RoomType,
} from '@homescape/spatial-model'
import type {
  FloorPlanExtractorInput,
} from './types'

export type GeometryAxis = 'horizontal' | 'vertical'

export interface GeometryWallObservation {
  id: string
  startPx: PixelPoint
  endPx: PixelPoint
  confidence?: number
}

export interface GeometryRoomSeedObservation {
  id: string
  pointPx: PixelPoint
  name?: string
  type?: RoomType
  confidence?: number
}

export interface GeometryOpeningObservation {
  id: string
  kind: Opening['kind']
  centerPx: PixelPoint
  widthPx: number
  orientation: GeometryAxis
  roomSeedId?: string
  heightMeters?: number
  sillHeightMeters?: number
  swing?: Opening['swing']
  confidence?: number
}

export interface FloorPlanGeometryObservationV01 {
  schemaVersion: '0.1.0'
  source: {
    kind: Extract<
      FloorPlanExtractorInput['kind'],
      'floorplan_image' | 'floorplan_pdf'
    >
    sourceLabel: string
    widthPx: number
    heightPx: number
  }
  calibration: {
    startPx: PixelPoint
    endPx: PixelPoint
    realDistanceMeters: number
    confidence?: number
  }
  assumptions?: {
    wallThicknessMeters?: number
    ceilingHeightMeters?: number
  }
  walls: GeometryWallObservation[]
  roomSeeds: GeometryRoomSeedObservation[]
  openings: GeometryOpeningObservation[]
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

const axes = new Set<GeometryAxis>(['horizontal', 'vertical'])

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isConfidence(value: unknown) {
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

function pointWithinSource(
  point: PixelPoint,
  widthPx: number,
  heightPx: number,
) {
  return (
    point[0] >= 0 &&
    point[0] <= widthPx &&
    point[1] >= 0 &&
    point[1] <= heightPx
  )
}

export function parseFloorPlanGeometryObservation(
  value: unknown,
): FloorPlanGeometryObservationV01 {
  const payload = asRecord(value)

  if (!payload || payload.schemaVersion !== '0.1.0') {
    throw new Error('只支持 Floor Plan Geometry Observation v0.1.0')
  }

  const source = asRecord(payload.source)

  if (
    !source ||
    (source.kind !== 'floorplan_image' &&
      source.kind !== 'floorplan_pdf') ||
    typeof source.sourceLabel !== 'string' ||
    !source.sourceLabel.trim() ||
    !isPositiveFinite(source.widthPx) ||
    !isPositiveFinite(source.heightPx)
  ) {
    throw new Error('source 格式无效')
  }

  const calibration = asRecord(payload.calibration)

  if (
    !calibration ||
    !isPixelPoint(calibration.startPx) ||
    !isPixelPoint(calibration.endPx) ||
    !isPositiveFinite(calibration.realDistanceMeters) ||
    !isConfidence(calibration.confidence)
  ) {
    throw new Error('calibration 格式无效')
  }

  if (
    !pointWithinSource(
      calibration.startPx,
      source.widthPx,
      source.heightPx,
    ) ||
    !pointWithinSource(
      calibration.endPx,
      source.widthPx,
      source.heightPx,
    )
  ) {
    throw new Error('calibration 超出 source bounds')
  }

  if (
    Math.hypot(
      calibration.endPx[0] - calibration.startPx[0],
      calibration.endPx[1] - calibration.startPx[1],
    ) <= 1e-9
  ) {
    throw new Error('calibration 两端不能重合')
  }

  const assumptions = asRecord(payload.assumptions)

  if (
    assumptions &&
    ((assumptions.wallThicknessMeters !== undefined &&
      !isPositiveFinite(assumptions.wallThicknessMeters)) ||
      (assumptions.ceilingHeightMeters !== undefined &&
        !isPositiveFinite(assumptions.ceilingHeightMeters)))
  ) {
    throw new Error('assumptions 格式无效')
  }

  if (!Array.isArray(payload.walls) || payload.walls.length < 4) {
    throw new Error('walls 至少需要 4 条')
  }

  if (
    !Array.isArray(payload.roomSeeds) ||
    payload.roomSeeds.length === 0
  ) {
    throw new Error('roomSeeds 至少需要一个')
  }

  if (!Array.isArray(payload.openings)) {
    throw new Error('openings 必须是数组')
  }

  const ids = new Set<string>()
  const seedIds = new Set<string>()

  for (const [index, value] of payload.walls.entries()) {
    const wall = asRecord(value)
    const label = 'walls[' + index + ']'

    if (
      !wall ||
      typeof wall.id !== 'string' ||
      !wall.id.trim() ||
      !isPixelPoint(wall.startPx) ||
      !isPixelPoint(wall.endPx) ||
      !isConfidence(wall.confidence)
    ) {
      throw new Error(label + ' 格式无效')
    }

    if (
      !pointWithinSource(
        wall.startPx,
        source.widthPx,
        source.heightPx,
      ) ||
      !pointWithinSource(
        wall.endPx,
        source.widthPx,
        source.heightPx,
      )
    ) {
      throw new Error(label + ' 超出 source bounds')
    }

    if (
      Math.hypot(
        wall.endPx[0] - wall.startPx[0],
        wall.endPx[1] - wall.startPx[1],
      ) <= 1e-9
    ) {
      throw new Error(label + ' 长度为 0')
    }

    if (ids.has(wall.id)) {
      throw new Error('Observation ID 重复：' + wall.id)
    }

    ids.add(wall.id)
  }

  for (const [index, value] of payload.roomSeeds.entries()) {
    const seed = asRecord(value)
    const label = 'roomSeeds[' + index + ']'

    if (
      !seed ||
      typeof seed.id !== 'string' ||
      !seed.id.trim() ||
      !isPixelPoint(seed.pointPx) ||
      (seed.name !== undefined &&
        (typeof seed.name !== 'string' || !seed.name.trim())) ||
      (seed.type !== undefined &&
        (typeof seed.type !== 'string' ||
          !roomTypes.has(seed.type as RoomType))) ||
      !isConfidence(seed.confidence)
    ) {
      throw new Error(label + ' 格式无效')
    }

    if (
      !pointWithinSource(
        seed.pointPx,
        source.widthPx,
        source.heightPx,
      )
    ) {
      throw new Error(label + ' 超出 source bounds')
    }

    if (ids.has(seed.id)) {
      throw new Error('Observation ID 重复：' + seed.id)
    }

    ids.add(seed.id)
    seedIds.add(seed.id)
  }

  for (const [index, value] of payload.openings.entries()) {
    const opening = asRecord(value)
    const label = 'openings[' + index + ']'

    if (
      !opening ||
      typeof opening.id !== 'string' ||
      !opening.id.trim() ||
      typeof opening.kind !== 'string' ||
      !openingKinds.has(opening.kind as Opening['kind']) ||
      !isPixelPoint(opening.centerPx) ||
      !isPositiveFinite(opening.widthPx) ||
      typeof opening.orientation !== 'string' ||
      !axes.has(opening.orientation as GeometryAxis) ||
      (opening.roomSeedId !== undefined &&
        (typeof opening.roomSeedId !== 'string' ||
          !seedIds.has(opening.roomSeedId))) ||
      (opening.heightMeters !== undefined &&
        !isPositiveFinite(opening.heightMeters)) ||
      (opening.sillHeightMeters !== undefined &&
        !isNonNegativeFinite(opening.sillHeightMeters)) ||
      (opening.swing !== undefined &&
        (typeof opening.swing !== 'string' ||
          !openingSwings.has(
            opening.swing as NonNullable<Opening['swing']>,
          ))) ||
      !isConfidence(opening.confidence)
    ) {
      throw new Error(label + ' 格式无效')
    }

    if (
      !pointWithinSource(
        opening.centerPx,
        source.widthPx,
        source.heightPx,
      )
    ) {
      throw new Error(label + ' 超出 source bounds')
    }

    if (ids.has(opening.id)) {
      throw new Error('Observation ID 重复：' + opening.id)
    }

    ids.add(opening.id)
  }

  return payload as unknown as FloorPlanGeometryObservationV01
}

export interface FloorPlanGeometryDetectionResult {
  observation: FloorPlanGeometryObservationV01
  provider?: string
  model?: string
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  traceId?: string
  warnings?: readonly string[]
}

export interface FloorPlanGeometryDetector {
  readonly id: string
  supports(
    input: Pick<FloorPlanExtractorInput, 'kind' | 'mediaType'>,
  ): boolean
  detect(
    input: FloorPlanExtractorInput,
  ): Promise<FloorPlanGeometryDetectionResult>
}

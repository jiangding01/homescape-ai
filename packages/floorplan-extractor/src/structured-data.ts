import {
  isFloorPlanDraft,
  type FloorPlanDraft,
  type FloorPlanDraftOpening,
  type FloorPlanDraftRoom,
  type Opening,
  type PixelPoint,
  type RoomType,
} from '@homescape/spatial-model'
import type {
  FloorPlanExtractionResult,
  FloorPlanExtractor,
  FloorPlanExtractorInput,
} from './types'

export type MetricPoint = readonly [x: number, z: number]

export interface MetricStructuredFloorPlanRoom {
  id: string
  name: string
  type?: RoomType
  boundaryMeters: MetricPoint[]
  confidence?: number
}

export interface MetricStructuredFloorPlanOpening {
  id: string
  roomId: string
  edgeIndex: number
  kind: Opening['kind']
  offsetMeters: number
  widthMeters: number
  heightMeters: number
  sillHeightMeters?: number
  swing?: Opening['swing']
  confidence?: number
}

export interface MetricStructuredFloorPlanV01 {
  schemaVersion: '0.1.0'
  sourceLabel: string
  canvas: {
    widthMeters: number
    heightMeters: number
  }
  assumptions: {
    wallThicknessMeters: number
    ceilingHeightMeters: number
    wallThicknessConfirmed: boolean
    ceilingHeightConfirmed: boolean
  }
  rooms: MetricStructuredFloorPlanRoom[]
  openings: MetricStructuredFloorPlanOpening[]
}

export interface MetricStructuredFloorPlanExtractorOptions {
  pixelsPerMeter?: number
  maxInputBytes?: number
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

function isMetricPoint(value: unknown): value is MetricPoint {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  )
}

function metricDistance(a: MetricPoint, b: MetricPoint) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function cross(
  a: MetricPoint,
  b: MetricPoint,
  c: MetricPoint,
) {
  return (
    (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0])
  )
}

function onSegment(
  a: MetricPoint,
  b: MetricPoint,
  point: MetricPoint,
) {
  const epsilon = 1e-9

  return (
    Math.abs(cross(a, b, point)) <= epsilon &&
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  )
}

function segmentsIntersect(
  aStart: MetricPoint,
  aEnd: MetricPoint,
  bStart: MetricPoint,
  bEnd: MetricPoint,
) {
  const aToBStart = cross(aStart, aEnd, bStart)
  const aToBEnd = cross(aStart, aEnd, bEnd)
  const bToAStart = cross(bStart, bEnd, aStart)
  const bToAEnd = cross(bStart, bEnd, aEnd)

  if (
    ((aToBStart > 0 && aToBEnd < 0) ||
      (aToBStart < 0 && aToBEnd > 0)) &&
    ((bToAStart > 0 && bToAEnd < 0) ||
      (bToAStart < 0 && bToAEnd > 0))
  ) {
    return true
  }

  return (
    onSegment(aStart, aEnd, bStart) ||
    onSegment(aStart, aEnd, bEnd) ||
    onSegment(bStart, bEnd, aStart) ||
    onSegment(bStart, bEnd, aEnd)
  )
}

function polygonHasSelfIntersection(
  points: readonly MetricPoint[],
) {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length
    const aStart = points[left]
    const aEnd = points[leftNext]

    if (!aStart || !aEnd) continue

    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length

      if (
        left === right ||
        leftNext === right ||
        rightNext === left
      ) {
        continue
      }

      const bStart = points[right]
      const bEnd = points[rightNext]

      if (
        bStart &&
        bEnd &&
        segmentsIntersect(aStart, aEnd, bStart, bEnd)
      ) {
        return true
      }
    }
  }

  return false
}

function polygonSignedArea(points: readonly MetricPoint[]) {
  let sum = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (!current || !next) continue

    sum += current[0] * next[1] - next[0] * current[1]
  }

  return sum / 2
}

function assertMetricStructuredFloorPlan(
  value: unknown,
): asserts value is MetricStructuredFloorPlanV01 {
  const payload = asRecord(value)

  if (!payload || payload.schemaVersion !== '0.1.0') {
    throw new Error('只支持 Metric Structured Floor Plan v0.1.0')
  }

  if (
    typeof payload.sourceLabel !== 'string' ||
    !payload.sourceLabel.trim()
  ) {
    throw new Error('sourceLabel 不能为空')
  }

  const canvas = asRecord(payload.canvas)

  if (
    !canvas ||
    !isPositiveFinite(canvas.widthMeters) ||
    !isPositiveFinite(canvas.heightMeters)
  ) {
    throw new Error('canvas.widthMeters / heightMeters 必须为正数')
  }

  const assumptions = asRecord(payload.assumptions)

  if (
    !assumptions ||
    !isPositiveFinite(assumptions.wallThicknessMeters) ||
    !isPositiveFinite(assumptions.ceilingHeightMeters) ||
    typeof assumptions.wallThicknessConfirmed !== 'boolean' ||
    typeof assumptions.ceilingHeightConfirmed !== 'boolean'
  ) {
    throw new Error('assumptions 格式无效')
  }

  if (!Array.isArray(payload.rooms) || payload.rooms.length === 0) {
    throw new Error('rooms 至少需要一个房间')
  }

  if (!Array.isArray(payload.openings)) {
    throw new Error('openings 必须是数组')
  }

  const ids = new Set<string>()
  const rooms = new Map<string, MetricStructuredFloorPlanRoom>()

  for (const [roomIndex, roomValue] of payload.rooms.entries()) {
    const room = asRecord(roomValue)
    const label = 'rooms[' + roomIndex + ']'

    if (
      !room ||
      typeof room.id !== 'string' ||
      !room.id.trim() ||
      typeof room.name !== 'string' ||
      !room.name.trim() ||
      (room.type !== undefined &&
        (typeof room.type !== 'string' ||
          !roomTypes.has(room.type as RoomType))) ||
      !Array.isArray(room.boundaryMeters) ||
      room.boundaryMeters.length < 3 ||
      !room.boundaryMeters.every(isMetricPoint) ||
      !isConfidence(room.confidence)
    ) {
      throw new Error(label + ' 格式无效')
    }

    if (ids.has(room.id)) {
      throw new Error('存在重复实体 ID：' + room.id)
    }

    const typedRoom = room as unknown as MetricStructuredFloorPlanRoom

    for (const point of typedRoom.boundaryMeters) {
      if (
        point[0] < 0 ||
        point[0] > canvas.widthMeters ||
        point[1] < 0 ||
        point[1] > canvas.heightMeters
      ) {
        throw new Error(label + ' 的 boundaryMeters 超出 canvas')
      }
    }

    if (Math.abs(polygonSignedArea(typedRoom.boundaryMeters)) <= 1e-9) {
      throw new Error(label + ' Polygon 面积为 0')
    }

    if (polygonHasSelfIntersection(typedRoom.boundaryMeters)) {
      throw new Error(label + ' Polygon 存在自相交')
    }

    for (
      let edgeIndex = 0;
      edgeIndex < typedRoom.boundaryMeters.length;
      edgeIndex += 1
    ) {
      const start = typedRoom.boundaryMeters[edgeIndex]
      const end =
        typedRoom.boundaryMeters[
          (edgeIndex + 1) % typedRoom.boundaryMeters.length
        ]

      if (!start || !end || metricDistance(start, end) <= 1e-9) {
        throw new Error(label + ' 包含零长度边')
      }
    }

    ids.add(typedRoom.id)
    rooms.set(typedRoom.id, typedRoom)
  }

  for (const [openingIndex, openingValue] of payload.openings.entries()) {
    const opening = asRecord(openingValue)
    const label = 'openings[' + openingIndex + ']'

    if (
      !opening ||
      typeof opening.id !== 'string' ||
      !opening.id.trim() ||
      typeof opening.roomId !== 'string' ||
      !opening.roomId.trim() ||
      !Number.isInteger(opening.edgeIndex) ||
      (opening.edgeIndex as number) < 0 ||
      typeof opening.kind !== 'string' ||
      !openingKinds.has(opening.kind as Opening['kind']) ||
      !isNonNegativeFinite(opening.offsetMeters) ||
      !isPositiveFinite(opening.widthMeters) ||
      !isPositiveFinite(opening.heightMeters) ||
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

    if (ids.has(opening.id)) {
      throw new Error('存在重复实体 ID：' + opening.id)
    }

    const room = rooms.get(opening.roomId)

    if (!room) {
      throw new Error(label + ' roomId 不存在：' + opening.roomId)
    }

    const edgeIndex = opening.edgeIndex as number

    if (edgeIndex >= room.boundaryMeters.length) {
      throw new Error(label + ' edgeIndex 越界')
    }

    const start = room.boundaryMeters[edgeIndex]
    const end =
      room.boundaryMeters[
        (edgeIndex + 1) % room.boundaryMeters.length
      ]

    if (!start || !end) {
      throw new Error(label + ' 无法解析 Room Edge')
    }

    const edgeLength = metricDistance(start, end)

    if (
      (opening.offsetMeters as number) +
        (opening.widthMeters as number) >
      edgeLength + 1e-9
    ) {
      throw new Error(label + ' 超出 Room Edge')
    }

    const sill =
      opening.sillHeightMeters === undefined
        ? 0
        : (opening.sillHeightMeters as number)

    if (
      sill + (opening.heightMeters as number) >
      (assumptions.ceilingHeightMeters as number) + 1e-9
    ) {
      throw new Error(label + ' 垂直尺寸超过 ceiling height')
    }

    ids.add(opening.id)
  }
}

function optionalRoomFields(
  room: MetricStructuredFloorPlanRoom,
): {
  type?: RoomType
  confidence?: number
} {
  return {
    ...(room.type !== undefined ? { type: room.type } : {}),
    ...(room.confidence !== undefined
      ? { confidence: room.confidence }
      : {}),
  }
}

function optionalOpeningFields(
  opening: MetricStructuredFloorPlanOpening,
): {
  sillHeightMeters?: number
  swing?: Opening['swing']
  confidence?: number
} {
  return {
    ...(opening.sillHeightMeters !== undefined
      ? { sillHeightMeters: opening.sillHeightMeters }
      : {}),
    ...(opening.swing !== undefined ? { swing: opening.swing } : {}),
    ...(opening.confidence !== undefined
      ? { confidence: opening.confidence }
      : {}),
  }
}

export class MetricStructuredFloorPlanExtractor
  implements FloorPlanExtractor
{
  readonly id = 'metric-structured-v0.1'

  private readonly pixelsPerMeter: number
  private readonly maxInputBytes: number

  constructor(options: MetricStructuredFloorPlanExtractorOptions = {}) {
    const pixelsPerMeter = options.pixelsPerMeter ?? 100

    if (
      !Number.isFinite(pixelsPerMeter) ||
      pixelsPerMeter < 1 ||
      pixelsPerMeter > 10_000
    ) {
      throw new Error('pixelsPerMeter 必须位于 1 ~ 10000')
    }

    const maxInputBytes = options.maxInputBytes ?? 5 * 1024 * 1024

    if (
      !Number.isInteger(maxInputBytes) ||
      maxInputBytes < 1024 ||
      maxInputBytes > 100 * 1024 * 1024
    ) {
      throw new Error(
        'maxInputBytes 必须是 1KB ~ 100MB 之间的整数',
      )
    }

    this.pixelsPerMeter = pixelsPerMeter
    this.maxInputBytes = maxInputBytes
  }

  supports(
    input: Pick<FloorPlanExtractorInput, 'kind' | 'mediaType'>,
  ) {
    const mediaType =
      input.mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? ''

    return (
      input.kind === 'company_data' &&
      mediaType ===
        'application/vnd.homescape.metric-floorplan+json'
    )
  }

  async extract(
    input: FloorPlanExtractorInput,
  ): Promise<FloorPlanExtractionResult> {
    if (!this.supports(input)) {
      throw new Error(
        this.id +
          ' 仅支持 company_data + application/vnd.homescape.metric-floorplan+json',
      )
    }

    if (input.bytes.byteLength > this.maxInputBytes) {
      throw new Error(
        '结构化户型输入过大：' +
          input.bytes.byteLength +
          ' bytes，限制 ' +
          this.maxInputBytes +
          ' bytes',
      )
    }

    const startedAt = performance.now()
    let parsed: unknown

    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(
        input.bytes,
      )
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(
        '无法解析结构化户型 JSON：' +
          (error instanceof Error ? error.message : String(error)),
      )
    }

    assertMetricStructuredFloorPlan(parsed)

    const pixelsPerMeter = this.pixelsPerMeter
    const widthPx = parsed.canvas.widthMeters * pixelsPerMeter
    const heightPx = parsed.canvas.heightMeters * pixelsPerMeter
    const calibrationMeters = Math.min(
      1,
      parsed.canvas.widthMeters,
    )

    const toPixel = (point: MetricPoint): PixelPoint => [
      point[0] * pixelsPerMeter,
      heightPx - point[1] * pixelsPerMeter,
    ]

    const rooms: FloorPlanDraftRoom[] = parsed.rooms.map((room) => ({
      id: room.id,
      name: room.name,
      boundaryPx: room.boundaryMeters.map(toPixel),
      ...optionalRoomFields(room),
    }))

    const openings: FloorPlanDraftOpening[] = parsed.openings.map(
      (opening) => ({
        id: opening.id,
        roomId: opening.roomId,
        edgeIndex: opening.edgeIndex,
        kind: opening.kind,
        offsetPx: opening.offsetMeters * pixelsPerMeter,
        widthPx: opening.widthMeters * pixelsPerMeter,
        heightMeters: opening.heightMeters,
        ...optionalOpeningFields(opening),
      }),
    )

    const draft: FloorPlanDraft = {
      schemaVersion: '0.1.0',
      source: {
        kind: 'company_data',
        widthPx,
        heightPx,
        sourceLabel: parsed.sourceLabel,
      },
      calibration: {
        startPx: [0, heightPx],
        endPx: [
          calibrationMeters * pixelsPerMeter,
          heightPx,
        ],
        realDistanceMeters: calibrationMeters,
      },
      assumptions: {
        wallThicknessMeters:
          parsed.assumptions.wallThicknessMeters,
        ceilingHeightMeters:
          parsed.assumptions.ceilingHeightMeters,
        wallThicknessConfirmed:
          parsed.assumptions.wallThicknessConfirmed,
        ceilingHeightConfirmed:
          parsed.assumptions.ceilingHeightConfirmed,
      },
      rooms,
      openings,
    }

    if (!isFloorPlanDraft(draft)) {
      throw new Error(
        '结构化户型转换结果未通过 FloorPlanDraft Contract',
      )
    }

    const warnings: string[] = []

    for (const room of parsed.rooms) {
      if (room.type === undefined) {
        warnings.push(room.name + ' 缺少 Room Type，需要 Human Review')
      }
      if (
        room.confidence !== undefined &&
        room.confidence < 0.75
      ) {
        warnings.push(room.name + ' confidence 低于 0.75')
      }
    }

    for (const opening of parsed.openings) {
      if (
        opening.confidence !== undefined &&
        opening.confidence < 0.75
      ) {
        warnings.push(opening.id + ' confidence 低于 0.75')
      }
    }

    return {
      draft,
      metadata: {
        extractorId: this.id,
        provider: 'homescape',
        model: 'metric-structured-v0.1',
        latencyMs: Math.max(0, performance.now() - startedAt),
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  }
}

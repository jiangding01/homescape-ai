import type { RoomType } from '@homescape/spatial-model'

/**
 * 视觉大模型的结构化输出协议（模型坐标系 = 送入模型的那张图的像素坐标）。
 * 这是模型原始读数，不是 FloorPlanDraft：坐标还要换回原图像素，开口还要绑定到房间边，
 * 比例尺还要从尺寸线读数推导。所有字段都必填，便于 JSON Schema 约束输出。
 */
export const VISION_ROOM_TYPES = [
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
] as const satisfies readonly RoomType[]

export const VISION_OPENING_KINDS = ['door', 'window', 'opening'] as const

export const VISION_OPENING_SWINGS = [
  'left',
  'right',
  'double',
  'sliding',
  'none',
  'unknown',
] as const

export const VISION_DIMENSION_AXES = ['horizontal', 'vertical'] as const

export interface VisionPoint {
  x: number
  y: number
}

export interface VisionRoom {
  label: string
  type: (typeof VISION_ROOM_TYPES)[number]
  polygon: VisionPoint[]
  confidence: number
}

export interface VisionOpening {
  kind: (typeof VISION_OPENING_KINDS)[number]
  start: VisionPoint
  end: VisionPoint
  swing: (typeof VISION_OPENING_SWINGS)[number]
  confidence: number
}

export interface VisionDimensionLine {
  text: string
  valueMillimeters: number
  axis: (typeof VISION_DIMENSION_AXES)[number]
  start: VisionPoint
  end: VisionPoint
  confidence: number
}

export interface VisionFloorPlanResponse {
  isFloorPlan: boolean
  notes: string
  rooms: VisionRoom[]
  openings: VisionOpening[]
  dimensionLines: VisionDimensionLine[]
}

const pointSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
  },
} as const

/** 送给 Provider 的 JSON Schema（Structured Outputs 子集：无数值/长度约束，均在本地校验）。 */
export const VISION_FLOORPLAN_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isFloorPlan', 'notes', 'rooms', 'openings', 'dimensionLines'],
  properties: {
    isFloorPlan: { type: 'boolean' },
    notes: { type: 'string' },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'type', 'polygon', 'confidence'],
        properties: {
          label: { type: 'string' },
          type: { type: 'string', enum: [...VISION_ROOM_TYPES] },
          polygon: { type: 'array', items: pointSchema },
          confidence: { type: 'number' },
        },
      },
    },
    openings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'start', 'end', 'swing', 'confidence'],
        properties: {
          kind: { type: 'string', enum: [...VISION_OPENING_KINDS] },
          start: pointSchema,
          end: pointSchema,
          swing: { type: 'string', enum: [...VISION_OPENING_SWINGS] },
          confidence: { type: 'number' },
        },
      },
    },
    dimensionLines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'valueMillimeters', 'axis', 'start', 'end', 'confidence'],
        properties: {
          text: { type: 'string' },
          valueMillimeters: { type: 'number' },
          axis: { type: 'string', enum: [...VISION_DIMENSION_AXES] },
          start: pointSchema,
          end: pointSchema,
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const

export class VisionResponseSchemaError extends Error {
  constructor(readonly issues: readonly string[]) {
    super('视觉模型输出不符合协议：' + issues.slice(0, 5).join('；'))
    this.name = 'VisionResponseSchemaError'
  }
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

/**
 * 严格校验模型输出。Provider 侧的 Schema 约束不可完全信任（不同 Vendor、回放的旧响应），
 * 因此本地再校验一次；任何一项不合格都整体拒绝，不做静默修补。
 */
export function parseVisionFloorPlanResponse(value: unknown): VisionFloorPlanResponse {
  const issues: string[] = []
  const root = asRecord(value)

  if (!root) throw new VisionResponseSchemaError(['根节点必须是对象'])

  const point = (raw: unknown, path: string): VisionPoint => {
    const record = asRecord(raw)
    if (!record || !isFiniteNumber(record.x) || !isFiniteNumber(record.y)) {
      issues.push(path + ' 必须是 {x, y} 有限数值')
      return { x: 0, y: 0 }
    }
    return { x: record.x, y: record.y }
  }

  const confidence = (raw: unknown, path: string) => {
    if (!isFiniteNumber(raw) || raw < 0 || raw > 1) {
      issues.push(path + ' 必须在 0~1 之间')
      return 0
    }
    return raw
  }

  const list = (raw: unknown, path: string) => {
    if (!Array.isArray(raw)) {
      issues.push(path + ' 必须是数组')
      return []
    }
    return raw
  }

  if (typeof root.isFloorPlan !== 'boolean') {
    issues.push('isFloorPlan 必须是布尔值')
  }
  if (typeof root.notes !== 'string') issues.push('notes 必须是字符串')

  const rooms = list(root.rooms, 'rooms').map((raw, index): VisionRoom => {
    const path = 'rooms[' + index + ']'
    const record = asRecord(raw) ?? {}
    if (typeof record.label !== 'string') issues.push(path + '.label 必须是字符串')
    if (!oneOf(VISION_ROOM_TYPES, record.type)) issues.push(path + '.type 非法')
    return {
      label: typeof record.label === 'string' ? record.label : '',
      type: oneOf(VISION_ROOM_TYPES, record.type) ? record.type : 'other',
      polygon: list(record.polygon, path + '.polygon').map((p, i) =>
        point(p, path + '.polygon[' + i + ']'),
      ),
      confidence: confidence(record.confidence, path + '.confidence'),
    }
  })

  const openings = list(root.openings, 'openings').map((raw, index): VisionOpening => {
    const path = 'openings[' + index + ']'
    const record = asRecord(raw) ?? {}
    if (!oneOf(VISION_OPENING_KINDS, record.kind)) issues.push(path + '.kind 非法')
    if (!oneOf(VISION_OPENING_SWINGS, record.swing)) issues.push(path + '.swing 非法')
    return {
      kind: oneOf(VISION_OPENING_KINDS, record.kind) ? record.kind : 'opening',
      start: point(record.start, path + '.start'),
      end: point(record.end, path + '.end'),
      swing: oneOf(VISION_OPENING_SWINGS, record.swing) ? record.swing : 'unknown',
      confidence: confidence(record.confidence, path + '.confidence'),
    }
  })

  const dimensionLines = list(root.dimensionLines, 'dimensionLines').map(
    (raw, index): VisionDimensionLine => {
      const path = 'dimensionLines[' + index + ']'
      const record = asRecord(raw) ?? {}
      if (typeof record.text !== 'string') issues.push(path + '.text 必须是字符串')
      if (!isFiniteNumber(record.valueMillimeters) || record.valueMillimeters <= 0) {
        issues.push(path + '.valueMillimeters 必须为正数')
      }
      if (!oneOf(VISION_DIMENSION_AXES, record.axis)) issues.push(path + '.axis 非法')
      return {
        text: typeof record.text === 'string' ? record.text : '',
        valueMillimeters: isFiniteNumber(record.valueMillimeters) ? record.valueMillimeters : 0,
        axis: oneOf(VISION_DIMENSION_AXES, record.axis) ? record.axis : 'horizontal',
        start: point(record.start, path + '.start'),
        end: point(record.end, path + '.end'),
        confidence: confidence(record.confidence, path + '.confidence'),
      }
    },
  )

  if (issues.length > 0) throw new VisionResponseSchemaError(issues)

  return {
    isFloorPlan: root.isFloorPlan as boolean,
    notes: root.notes as string,
    rooms,
    openings,
    dimensionLines,
  }
}

import {
  getFloorPlanCalibrationAxisError,
  type FloorPlanCalibration,
  type FloorPlanDraft,
  type FloorPlanDraftOpening,
  type FloorPlanDraftRoom,
  type PixelPoint,
} from '@homescape/spatial-model'
import type {
  VisionDimensionLine,
  VisionFloorPlanResponse,
  VisionOpening,
  VisionPoint,
} from './vision-schema'

export interface VisionDraftConversionOptions {
  sourceId: string
  /** 原图（EXIF 校正后）尺寸，Draft 坐标系。 */
  sourceWidthPx: number
  sourceHeightPx: number
  /** 送入模型的图像尺寸，模型坐标系。 */
  modelWidthPx: number
  modelHeightPx: number
  /** 图上没有可用尺寸线时的假设比例尺（basis: assumed，阻断 Finalize）。 */
  assumedPixelsPerMeter?: number
  wallThicknessMeters?: number
  ceilingHeightMeters?: number
}

export interface VisionDraftConversionStats {
  roomsReturned: number
  roomsKept: number
  openingsReturned: number
  openingsKept: number
  dimensionLinesReturned: number
  dimensionLinesUsedX: number
  dimensionLinesUsedY: number
  pixelsPerMeterX: number | null
  pixelsPerMeterY: number | null
  calibrationBasis: 'extracted' | 'assumed'
}

export interface VisionDraftConversion {
  draft: FloorPlanDraft
  warnings: string[]
  stats: VisionDraftConversionStats
}

const ROOM_TYPE_NAMES: Record<FloorPlanDraftRoom['type'] & string, string> = {
  living: '客餐厅',
  dining: '餐厅',
  kitchen: '厨房',
  bedroom: '卧室',
  bathroom: '卫生间',
  study: '书房',
  balcony: '阳台',
  hallway: '走廊',
  utility: '储物间',
  other: '其他空间',
}

// 门窗高度只是占位值，不代表实测（见 docs/HANDOFF.md 标注规范）。
const OPENING_PLACEHOLDERS = {
  door: { heightMeters: 2.1 },
  opening: { heightMeters: 2.1 },
  window: { heightMeters: 1.5, sillHeightMeters: 0.9 },
} as const

const PARALLEL_SIN_MAX = Math.sin((20 * Math.PI) / 180)
const DIMENSION_OUTLIER_RATIO = 0.15

const round = (value: number) => Math.round(value * 10) / 10
const roundRatio = (value: number) => Math.round(value * 1000) / 1000

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function polygonSignedArea(points: readonly PixelPoint[]) {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

interface AxisCalibration {
  calibration: FloorPlanCalibration
  pixelsPerMeter: number
  used: number
}

/**
 * 每条轴取各尺寸线 px/m 的中位数，再挑最接近中位数的那条作为代表标定线。
 * 偏离中位数超过 15% 的读数视为误读，计入警告但不参与。
 */
function calibrateAxis(
  lines: readonly { line: VisionDimensionLine; start: PixelPoint; end: PixelPoint }[],
  axis: 'x' | 'y',
  warnings: string[],
): AxisCalibration | undefined {
  const candidates = lines
    .map((item) => {
      const lengthPx =
        axis === 'x' ? Math.abs(item.end[0] - item.start[0]) : Math.abs(item.end[1] - item.start[1])
      const meters = item.line.valueMillimeters / 1000
      return { ...item, ratio: lengthPx / meters }
    })
    .filter((item) => Number.isFinite(item.ratio) && item.ratio > 0)

  if (candidates.length === 0) return undefined

  const center = median(candidates.map((item) => item.ratio))
  const inliers = candidates.filter((item) => {
    const deviation = Math.abs(item.ratio - center) / center
    if (deviation > DIMENSION_OUTLIER_RATIO) {
      warnings.push(
        (axis === 'x' ? '横向' : '纵向') +
          '尺寸线「' +
          item.line.text +
          '」与其余读数比例偏差 ' +
          Math.round(deviation * 100) +
          '%，未参与标定',
      )
      return false
    }
    return true
  })
  const inlierCenter = median(inliers.map((item) => item.ratio))
  const representative = [...inliers].sort(
    (a, b) =>
      Math.abs(a.ratio - inlierCenter) - Math.abs(b.ratio - inlierCenter) ||
      b.line.valueMillimeters - a.line.valueMillimeters,
  )[0]!

  // 代表线取最接近中位数的那条，端点保持图上界线位置，只把另一轴坐标对齐到起点使其严格沿轴；
  // Draft 的比例尺因此就是这条图上尺寸线本身的读数。
  const [sx, sy] = representative.start
  const endPx: PixelPoint = axis === 'x' ? [representative.end[0], sy] : [sx, representative.end[1]]

  return {
    calibration: {
      startPx: [sx, sy],
      endPx,
      realDistanceMeters: representative.line.valueMillimeters / 1000,
      basis: 'extracted',
    },
    pixelsPerMeter: representative.ratio,
    used: inliers.length,
  }
}

interface EdgeMatch {
  roomIndex: number
  edgeIndex: number
  offsetPx: number
  widthPx: number
  distancePx: number
}

/**
 * 隔墙两侧的房间都能贴合同一个开口，此时按房间类型决定挂在哪一侧（数字小者优先）：
 * 门窗挂在“被进入”的功能房间（卫、厨、卧、书）上，其次客餐厅，阳台 / 储物 / 走廊最后。
 * 与现有人工 GT 的多数约定一致；Benchmark 对隔墙开口两侧都算匹配，这里只求结果稳定。
 */
const OPENING_HOST_PRIORITY: Record<FloorPlanDraftRoom['type'] & string, number> = {
  bathroom: 0,
  kitchen: 1,
  bedroom: 2,
  study: 2,
  living: 3,
  dining: 3,
  other: 4,
  utility: 5,
  hallway: 6,
  balcony: 7,
}

function hostPriority(room: FloorPlanDraftRoom) {
  return room.type ? OPENING_HOST_PRIORITY[room.type] : OPENING_HOST_PRIORITY.other
}

/** 每个房间里与开口最贴合的那条平行边（距离不超过 maxDistancePx）。 */
function matchOpeningToRoomEdges(
  start: PixelPoint,
  end: PixelPoint,
  rooms: readonly FloorPlanDraftRoom[],
  maxDistancePx: number,
): EdgeMatch[] {
  const sdx = end[0] - start[0]
  const sdy = end[1] - start[1]
  const segmentLength = Math.hypot(sdx, sdy)
  if (segmentLength < 1) return []

  const matches: EdgeMatch[] = []

  rooms.forEach((room, roomIndex) => {
    let best: EdgeMatch | undefined

    room.boundaryPx.forEach((a, edgeIndex) => {
      const b = room.boundaryPx[(edgeIndex + 1) % room.boundaryPx.length]!
      const ex = b[0] - a[0]
      const ey = b[1] - a[1]
      const edgeLength = Math.hypot(ex, ey)
      if (edgeLength < 1) return
      const ux = ex / edgeLength
      const uy = ey / edgeLength

      if (Math.abs((sdx * uy - sdy * ux) / segmentLength) > PARALLEL_SIN_MAX) return

      const project = (p: PixelPoint) => ({
        along: (p[0] - a[0]) * ux + (p[1] - a[1]) * uy,
        across: Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux),
      })
      const ps = project(start)
      const pe = project(end)
      const distancePx = (ps.across + pe.across) / 2
      if (distancePx > maxDistancePx) return

      // 先对端点取整再求宽度，保证 offset + width 不因分别取整而超出边长。
      const from = round(Math.max(0, Math.min(ps.along, pe.along)))
      const to = Math.min(round(Math.min(edgeLength, Math.max(ps.along, pe.along))), edgeLength)
      const widthPx = round(to - from)
      // 至少一半开口宽度落在这条边上，避免绑到相邻的短边。
      if (widthPx < Math.max(1, segmentLength * 0.5)) return

      if (!best || distancePx < best.distancePx - 0.5) {
        best = {
          roomIndex,
          edgeIndex,
          offsetPx: from,
          widthPx,
          distancePx,
        }
      }
    })

    if (best) matches.push(best)
  })

  return matches
}

function chooseOpeningHost(
  matches: readonly EdgeMatch[],
  rooms: readonly FloorPlanDraftRoom[],
): EdgeMatch | undefined {
  return [...matches].sort(
    (a, b) =>
      hostPriority(rooms[a.roomIndex]!) - hostPriority(rooms[b.roomIndex]!) ||
      a.distancePx - b.distancePx ||
      a.roomIndex - b.roomIndex,
  )[0]
}

/**
 * 视觉模型读数 → FloorPlanDraft Candidate。纯函数、确定性：同一份模型响应永远得到同一份 Draft，
 * 回放（replay）因此可以逐字节复现候选结果。
 */
export function visionResponseToDraft(
  response: VisionFloorPlanResponse,
  options: VisionDraftConversionOptions,
): VisionDraftConversion {
  const warnings: string[] = []
  const scaleX = options.sourceWidthPx / options.modelWidthPx
  const scaleY = options.sourceHeightPx / options.modelHeightPx
  const toSource = (point: VisionPoint): PixelPoint => [
    round(Math.min(Math.max(point.x, 0), options.modelWidthPx) * scaleX),
    round(Math.min(Math.max(point.y, 0), options.modelHeightPx) * scaleY),
  ]

  if (response.notes.trim()) warnings.push('模型备注：' + response.notes.trim())

  // ---- Rooms ----
  const rooms: FloorPlanDraftRoom[] = []
  response.rooms.forEach((room, index) => {
    const points: PixelPoint[] = []
    for (const raw of room.polygon) {
      const point = toSource(raw)
      const previous = points[points.length - 1]
      if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.5) {
        points.push(point)
      }
    }
    const first = points[0]
    const last = points[points.length - 1]
    if (
      points.length > 1 &&
      first &&
      last &&
      Math.hypot(first[0] - last[0], first[1] - last[1]) <= 0.5
    ) {
      points.pop()
    }

    const label = room.label.trim()
    const name = label || ROOM_TYPE_NAMES[room.type]
    if (points.length < 3 || Math.abs(polygonSignedArea(points)) < 25) {
      warnings.push('房间「' + name + '」（第 ' + (index + 1) + ' 个）多边形退化，已丢弃')
      return
    }

    rooms.push({
      id: 'vision-room-' + (rooms.length + 1),
      name,
      type: room.type,
      boundaryPx: points,
      confidence: room.confidence,
    })
  })

  // ---- Calibration ----
  const dimensionLines = response.dimensionLines.map((line) => ({
    line,
    start: toSource(line.start),
    end: toSource(line.end),
  }))
  const byAxis = (axis: 'x' | 'y') =>
    dimensionLines.filter((item) => {
      const expected = axis === 'x' ? 'horizontal' : 'vertical'
      if (item.line.axis !== expected) return false
      const error = getFloorPlanCalibrationAxisError({ startPx: item.start, endPx: item.end }, axis)
      if (error) {
        warnings.push('尺寸线「' + item.line.text + '」方向与声明的轴不符，未参与标定')
        return false
      }
      return true
    })
  const calibrationX = calibrateAxis(byAxis('x'), 'x', warnings)
  const calibrationY = calibrateAxis(byAxis('y'), 'y', warnings)

  let calibration: FloorPlanCalibration
  let calibrationYOut: FloorPlanCalibration | undefined
  let basis: 'extracted' | 'assumed' = 'extracted'

  if (calibrationX && calibrationY) {
    calibration = calibrationX.calibration
    calibrationYOut = calibrationY.calibration
    const anisotropy =
      Math.abs(calibrationX.pixelsPerMeter - calibrationY.pixelsPerMeter) /
      Math.min(calibrationX.pixelsPerMeter, calibrationY.pixelsPerMeter)
    if (anisotropy > 0.03) {
      warnings.push(
        '横纵比例尺相差 ' + Math.round(anisotropy * 100) + '%，原图可能被非等比缩放，已分轴标定',
      )
    }
  } else if (calibrationX || calibrationY) {
    // 只有单轴读数时，另一轴按同一 px/m 假设，并显式标记 assumed，导入后阻断 Finalize。
    const only = (calibrationX ?? calibrationY)!
    const [ox, oy] = only.calibration.startPx
    const assumedLengthPx = round(only.pixelsPerMeter)
    const assumedAxis: FloorPlanCalibration = {
      startPx: [ox, oy],
      endPx: calibrationX ? [ox, oy + assumedLengthPx] : [ox + assumedLengthPx, oy],
      realDistanceMeters: assumedLengthPx / only.pixelsPerMeter,
      basis: 'assumed',
    }
    calibration = calibrationX ? only.calibration : assumedAxis
    calibrationYOut = calibrationX ? assumedAxis : only.calibration
    warnings.push(
      '只读到' +
        (calibrationX ? '横向' : '纵向') +
        '尺寸线，另一轴暂按同一比例假设，需人工标定后才能 Finalize',
    )
  } else {
    basis = 'assumed'
    const pixelsPerMeter = options.assumedPixelsPerMeter ?? 100
    calibration = {
      startPx: [0, 0],
      endPx: [pixelsPerMeter, 0],
      realDistanceMeters: 1,
      basis: 'assumed',
    }
    warnings.push(
      '未读到可用尺寸线，比例尺为假设值 ' + pixelsPerMeter + ' px/m，必须人工标定后才能 Finalize',
    )
  }

  // ---- Openings ----
  const pixelsPerMeterForTolerance = calibrationX?.pixelsPerMeter ?? calibrationY?.pixelsPerMeter
  const maxDistancePx = pixelsPerMeterForTolerance
    ? 0.4 * pixelsPerMeterForTolerance
    : 0.02 * Math.max(options.sourceWidthPx, options.sourceHeightPx)

  const openings: FloorPlanDraftOpening[] = []
  response.openings.forEach((opening: VisionOpening, index) => {
    const match = chooseOpeningHost(
      matchOpeningToRoomEdges(toSource(opening.start), toSource(opening.end), rooms, maxDistancePx),
      rooms,
    )
    if (!match) {
      warnings.push(
        '第 ' + (index + 1) + ' 个开口（' + opening.kind + '）无法贴合任何房间边，已丢弃',
      )
      return
    }
    const placeholder = OPENING_PLACEHOLDERS[opening.kind]
    openings.push({
      id: 'vision-opening-' + (openings.length + 1),
      roomId: rooms[match.roomIndex]!.id,
      edgeIndex: match.edgeIndex,
      kind: opening.kind,
      offsetPx: match.offsetPx,
      widthPx: match.widthPx,
      ...placeholder,
      ...(opening.swing !== 'unknown' ? { swing: opening.swing } : {}),
      confidence: opening.confidence,
    })
  })

  const draft: FloorPlanDraft = {
    schemaVersion: '0.1.0',
    source: {
      kind: 'floorplan_image',
      widthPx: options.sourceWidthPx,
      heightPx: options.sourceHeightPx,
      sourceLabel: options.sourceId,
    },
    calibration,
    ...(calibrationYOut ? { calibrationY: calibrationYOut } : {}),
    // 墙厚与层高不从图面推断，保持“假设”状态。
    assumptions: {
      wallThicknessMeters: options.wallThicknessMeters ?? 0.24,
      ceilingHeightMeters: options.ceilingHeightMeters ?? 2.8,
      wallThicknessConfirmed: false,
      ceilingHeightConfirmed: false,
    },
    rooms,
    openings,
  }

  return {
    draft,
    warnings,
    stats: {
      roomsReturned: response.rooms.length,
      roomsKept: rooms.length,
      openingsReturned: response.openings.length,
      openingsKept: openings.length,
      dimensionLinesReturned: response.dimensionLines.length,
      dimensionLinesUsedX: calibrationX?.used ?? 0,
      dimensionLinesUsedY: calibrationY?.used ?? 0,
      pixelsPerMeterX: calibrationX ? roundRatio(calibrationX.pixelsPerMeter) : null,
      pixelsPerMeterY: calibrationY ? roundRatio(calibrationY.pixelsPerMeter) : null,
      calibrationBasis: basis,
    },
  }
}

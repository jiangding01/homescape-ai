import {
  distance2D,
  edgeInwardNormal,
  ensureCounterClockwise,
  yawFacingDirection,
  type Floor,
  type Polygon2D,
  type Room,
  type Vec2,
} from '@homescape/spatial-model'
import type { Footprint2D } from './geometry'

/**
 * 房间（或其 Zone）边界上贴着墙内表面的一段，方向与逆时针（从 +Y 俯视）边界一致，
 * 因此房间内部位于其俯视左侧，内法线为 edgeInwardNormal(start, end)。
 */
export interface WallSpan {
  start: Vec2
  end: Vec2
  length: number
  inwardNormal: Vec2
}

export interface WallPose {
  center: Vec2
  yaw: number
  span: WallSpan
}

const COLLINEAR_TOLERANCE = 0.02
const MIN_SPAN_LENGTH = 1e-6

function edgesOf(polygon: Polygon2D) {
  const { points } = polygon
  const edges: Array<{ start: Vec2; end: Vec2 }> = []

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!

    if (distance2D(start, end) > MIN_SPAN_LENGTH) edges.push({ start, end })
  }

  return edges
}

function makeSpan(start: Vec2, end: Vec2): WallSpan {
  return {
    start,
    end,
    length: distance2D(start, end),
    inwardNormal: edgeInwardNormal(start, end),
  }
}

/**
 * 计算放置区域边界中“贴墙”的边段。
 *
 * - 区域即房间时：房间边界即墙体内表面（ADR 0018），每条边都是贴墙边段。
 * - 区域为 Zone 时：只保留 Zone 边与房间边共线、同向且重叠的部分；Zone 之间的
 *   分隔线不是墙，不生成靠墙候选。
 *
 * 两个多边形都先统一为逆时针，兼容旧数据的绕向。
 */
export function regionWallSpans(regionBoundary: Polygon2D, roomBoundary: Polygon2D): WallSpan[] {
  const region = ensureCounterClockwise(regionBoundary).polygon
  const room = ensureCounterClockwise(roomBoundary).polygon

  if (sameRing(region, room)) {
    return edgesOf(room).map(({ start, end }) => makeSpan(start, end))
  }

  const spans: WallSpan[] = []
  const roomEdges = edgesOf(room)

  for (const edge of edgesOf(region)) {
    const length = distance2D(edge.start, edge.end)
    const direction: Vec2 = [
      (edge.end[0] - edge.start[0]) / length,
      (edge.end[1] - edge.start[1]) / length,
    ]

    for (const roomEdge of roomEdges) {
      const roomLength = distance2D(roomEdge.start, roomEdge.end)
      const roomDirection: Vec2 = [
        (roomEdge.end[0] - roomEdge.start[0]) / roomLength,
        (roomEdge.end[1] - roomEdge.start[1]) / roomLength,
      ]

      // 同向（两者内部都在左侧）且共线。
      if (direction[0] * roomDirection[0] + direction[1] * roomDirection[1] < 1 - 1e-6) continue

      const offsetX = roomEdge.start[0] - edge.start[0]
      const offsetZ = roomEdge.start[1] - edge.start[1]
      const lateral = Math.abs(offsetX * direction[1] - offsetZ * direction[0])

      if (lateral > COLLINEAR_TOLERANCE) continue

      const along = (point: Vec2) =>
        (point[0] - edge.start[0]) * direction[0] + (point[1] - edge.start[1]) * direction[1]
      const from = Math.max(0, along(roomEdge.start))
      const to = Math.min(length, along(roomEdge.end))

      if (to - from <= MIN_SPAN_LENGTH) continue

      spans.push(
        makeSpan(
          [edge.start[0] + direction[0] * from, edge.start[1] + direction[1] * from],
          [edge.start[0] + direction[0] * to, edge.start[1] + direction[1] * to],
        ),
      )
    }
  }

  return spans
}

function sameRing(a: Polygon2D, b: Polygon2D) {
  return (
    a.points.length === b.points.length &&
    a.points.every(
      (point, index) => distance2D(point, b.points[index]!) <= MIN_SPAN_LENGTH,
    )
  )
}

/** 沿边段取若干中心位置（离边起点的距离），保证家具宽度完全落在边段内。 */
function positionsAlongSpan(spanLength: number, width: number) {
  const first = width / 2
  const last = spanLength - width / 2
  const range = last - first

  if (range < -1e-9) return []
  if (range < 0.05) return [spanLength / 2]

  const count = range < 1 ? 3 : 5

  return Array.from({ length: count }, (_, index) => first + (range * index) / (count - 1))
}

/**
 * 靠墙放置的位姿：家具宽度（局部 X）沿边段方向，正面（局部 −Z，见
 * FURNITURE_FRONT_LOCAL_AXIS）朝向房间内法线，背面与内表面的距离 = wallClearance。
 * 房间边界已是墙体内表面，因此不再扣除墙厚。边段短于家具宽度时不生成位姿。
 */
export function wallPoses(
  spans: readonly WallSpan[],
  dimensions: { width: number; depth: number },
  wallClearance: number,
): WallPose[] {
  const poses: WallPose[] = []
  const inset = dimensions.depth / 2 + wallClearance

  for (const span of spans) {
    const direction: Vec2 = [
      (span.end[0] - span.start[0]) / span.length,
      (span.end[1] - span.start[1]) / span.length,
    ]
    const yaw = yawFacingDirection(span.inwardNormal[0], span.inwardNormal[1])

    for (const distance of positionsAlongSpan(span.length, dimensions.width)) {
      poses.push({
        center: [
          span.start[0] + direction[0] * distance + span.inwardNormal[0] * inset,
          span.start[1] + direction[1] * distance + span.inwardNormal[1] * inset,
        ],
        yaw,
        span,
      })
    }
  }

  return poses
}

/** 门 / 开口在房间一侧需要保留的净空进深（米） */
export const OPENING_CLEARANCE_DEPTH = 0.9
/** 门 / 开口净空在宽度方向两侧各加的余量（米） */
export const OPENING_CLEARANCE_SIDE_MARGIN = 0.15

/**
 * 房间内门与开口的净空区域。墙带 sides 时，只在本房间一侧生成：从墙内表面起向房间内
 * 延伸 OPENING_CLEARANCE_DEPTH；旧数据缺少 sides 时退回以墙中心线为中心、两侧对称的区域。
 */
export function openingClearanceFootprints(floor: Floor, room: Room): Footprint2D[] {
  const wallMap = new Map(floor.walls.map((wall) => [wall.id, wall]))
  const openingMap = new Map(floor.openings.map((opening) => [opening.id, opening]))
  const footprints: Footprint2D[] = []

  for (const openingId of room.openingIds) {
    const opening = openingMap.get(openingId)

    if (!opening || (opening.kind !== 'door' && opening.kind !== 'opening')) continue

    const wall = wallMap.get(opening.wallId)

    if (!wall) continue

    const length = distance2D(wall.start, wall.end)

    if (length <= 0.001) continue

    const direction: Vec2 = [
      (wall.end[0] - wall.start[0]) / length,
      (wall.end[1] - wall.start[1]) / length,
    ]
    const along = opening.offset + opening.width / 2
    const onCenterline: Vec2 = [
      wall.start[0] + direction[0] * along,
      wall.start[1] + direction[1] * along,
    ]
    const width = opening.width + OPENING_CLEARANCE_SIDE_MARGIN * 2
    const sideIndex =
      wall.sides?.findIndex((side) => side.kind === 'room' && side.roomId === room.id) ?? -1

    if (sideIndex < 0) {
      if (wall.sides) continue // 墙两侧都不是本房间：与本房间无关

      footprints.push({
        center: onCenterline,
        width,
        depth: wall.thickness + OPENING_CLEARANCE_DEPTH * 2,
        yaw: yawFacingDirection(-direction[1], direction[0]),
      })
      continue
    }

    // sides[0] 位于墙方向俯视左侧，法线 (dz, −dx)；sides[1] 在右侧。
    const left: Vec2 = [direction[1], -direction[0]]
    const toRoom: Vec2 = sideIndex === 0 ? left : [-left[0], -left[1]]
    const offset = wall.thickness / 2 + OPENING_CLEARANCE_DEPTH / 2

    footprints.push({
      center: [onCenterline[0] + toRoom[0] * offset, onCenterline[1] + toRoom[1] * offset],
      width,
      depth: OPENING_CLEARANCE_DEPTH,
      yaw: yawFacingDirection(toRoom[0], toRoom[1]),
    })
  }

  return footprints
}

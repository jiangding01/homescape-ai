import type { FloorPlanDraftOpening, FloorPlanDraftRoom, PixelPoint } from '@homescape/spatial-model'

export interface AnnotationViewport {
  x: number
  y: number
  width: number
  height: number
}

export const fullViewport = (width: number, height: number): AnnotationViewport =>
  ({ x: 0, y: 0, width, height })

export function clampViewport(view: AnnotationViewport, width: number, height: number): AnnotationViewport {
  const w = Math.min(width, Math.max(width / 8, view.width))
  const h = w * height / width
  return {
    x: Math.max(0, Math.min(width - w, view.x)),
    y: Math.max(0, Math.min(height - h, view.y)),
    width: w,
    height: h,
  }
}

export function zoomViewport(current: AnnotationViewport, factor: number, width: number, height: number) {
  const newWidth = Math.min(width, Math.max(width / 8, current.width / factor))
  const newHeight = newWidth * height / width
  return clampViewport({
    x: current.x + (current.width - newWidth) / 2,
    y: current.y + (current.height - newHeight) / 2,
    width: newWidth,
    height: newHeight,
  }, width, height)
}

/**
 * Snap target onto the horizontal/vertical line through previous. When an
 * anchor (the polygon's first point) is given, the free coordinate also snaps
 * to the anchor's axis within tolerance so the closing edge can be orthogonal.
 */
export function orthogonalPoint(
  previous: PixelPoint,
  target: PixelPoint,
  anchor?: PixelPoint,
  tolerance = 0,
): PixelPoint {
  const horizontal = Math.abs(target[0] - previous[0]) >= Math.abs(target[1] - previous[1])
  const free = horizontal ? 0 : 1
  const freeValue = anchor && Math.abs(target[free] - anchor[free]) <= tolerance
    ? anchor[free] : target[free]
  return horizontal ? [freeValue, previous[1]] : [previous[0], freeValue]
}

export const orthogonalEdge = (a: PixelPoint, b: PixelPoint) =>
  Math.abs(a[0] - b[0]) <= 1 || Math.abs(a[1] - b[1]) <= 1

export const clickNearStart = (a: PixelPoint, b: PixelPoint, zoom: number) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) <= Math.max(3, 18 / zoom)

/** Keep unaffected Opening edge references stable when editing polygons. */
export function removePolygonVertex(
  room: FloorPlanDraftRoom,
  openings: readonly FloorPlanDraftOpening[],
  index: number,
): { room: FloorPlanDraftRoom; openings: FloorPlanDraftOpening[] } {
  const n = room.boundaryPx.length
  if (!Number.isInteger(index) || index < 0 || index >= n) throw new Error('请选择有效顶点')
  if (n <= 3) throw new Error('房间至少保留 3 个顶点')
  const previous = (index + n - 1) % n
  if (openings.some((o) => o.roomId === room.id &&
    (o.edgeIndex === index || o.edgeIndex === previous))) {
    throw new Error('该顶点关联的墙边有 Opening，请先调整对应门窗')
  }
  return {
    room: { ...room, boundaryPx: room.boundaryPx.filter((_, i) => i !== index) },
    openings: openings.map((o) => o.roomId === room.id && o.edgeIndex > index
      ? { ...o, edgeIndex: o.edgeIndex - 1 } : o),
  }
}

export function insertPolygonVertex(
  room: FloorPlanDraftRoom,
  openings: readonly FloorPlanDraftOpening[],
  index: number,
): { room: FloorPlanDraftRoom; openings: FloorPlanDraftOpening[] } {
  const n = room.boundaryPx.length
  if (!Number.isInteger(index) || index < 0 || index >= n) throw new Error('请选择有效顶点')
  if (openings.some((o) => o.roomId === room.id && o.edgeIndex === index)) {
    throw new Error('要拆分的墙边有 Opening，请先调整对应门窗')
  }
  const a = room.boundaryPx[index]!
  const b = room.boundaryPx[(index + 1) % n]!
  const mid: PixelPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return {
    room: { ...room, boundaryPx: [
      ...room.boundaryPx.slice(0, index + 1),
      mid,
      ...room.boundaryPx.slice(index + 1),
    ] },
    openings: openings.map((o) => o.roomId === room.id && o.edgeIndex > index
      ? { ...o, edgeIndex: o.edgeIndex + 1 } : o),
  }
}

/**
 * Screen pixels per source pixel for an SVG that fits `view` into a
 * `clientWidth x clientHeight` box with preserveAspectRatio="meet".
 * Returns null while the element has not been laid out yet.
 */
export function viewportScreenScale(
  clientWidth: number,
  clientHeight: number,
  view: AnnotationViewport,
): number | null {
  if (!(clientWidth > 0) || !(clientHeight > 0) || !(view.width > 0) || !(view.height > 0)) return null
  return Math.min(clientWidth / view.width, clientHeight / view.height)
}

/** Convert a size in screen pixels to source-image pixels so handles keep a constant on-screen size. */
export function screenToSource(screenPx: number, scale: number): number {
  return screenPx / (Number.isFinite(scale) && scale > 0 ? scale : 1)
}

export const DEFAULT_MIN_OPENING_WIDTH_PX = 4

export interface EdgeProjection {
  edgeIndex: number
  /** Projection of the query point, clamped onto the edge segment. */
  point: PixelPoint
  /** Distance from the query point to the clamped projection. */
  distancePx: number
  /** Distance from the edge start to the clamped projection. */
  alongPx: number
  edgeLengthPx: number
}

/** Project a point onto one polygon edge. Returns null for an invalid or zero-length edge. */
export function projectPointToEdge(
  boundary: readonly PixelPoint[],
  edgeIndex: number,
  point: PixelPoint,
): EdgeProjection | null {
  const a = boundary[edgeIndex]
  const b = boundary[(edgeIndex + 1) % boundary.length]
  if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || !a || !b) return null
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (length <= 1e-6) return null
  const ux = (b[0] - a[0]) / length
  const uy = (b[1] - a[1]) / length
  const along = Math.min(length, Math.max(0, (point[0] - a[0]) * ux + (point[1] - a[1]) * uy))
  const projected: PixelPoint = [a[0] + ux * along, a[1] + uy * along]
  return {
    edgeIndex,
    point: projected,
    distancePx: Math.hypot(point[0] - projected[0], point[1] - projected[1]),
    alongPx: along,
    edgeLengthPx: length,
  }
}

/** Nearest edge of the polygon within maxDistancePx (ties resolve to the lowest index). */
export function nearestEdgeProjection(
  boundary: readonly PixelPoint[],
  point: PixelPoint,
  maxDistancePx = Infinity,
): EdgeProjection | null {
  let best: EdgeProjection | null = null
  for (let index = 0; index < boundary.length; index += 1) {
    const candidate = projectPointToEdge(boundary, index, point)
    if (candidate && candidate.distancePx <= maxDistancePx &&
        (!best || candidate.distancePx < best.distancePx - 1e-9)) best = candidate
  }
  return best
}

export type OpeningPlacement =
  | {
      ok: true
      edgeIndex: number
      offsetPx: number
      widthPx: number
      start: PixelPoint
      end: PixelPoint
    }
  | { ok: false; reason: string }

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Bind two canvas clicks to an Opening: the first click picks the nearest wall
 * edge, the second is projected onto that same edge. Both are clamped to the
 * edge, so the result always fits inside it.
 */
export function planOpeningFromClicks(
  room: Pick<FloorPlanDraftRoom, 'id' | 'boundaryPx'>,
  openings: readonly FloorPlanDraftOpening[],
  first: PixelPoint,
  second: PixelPoint,
  options: { maxDistancePx?: number; minWidthPx?: number } = {},
): OpeningPlacement {
  const maxDistancePx = options.maxDistancePx ?? Infinity
  const minWidthPx = options.minWidthPx ?? DEFAULT_MIN_OPENING_WIDTH_PX
  const a = nearestEdgeProjection(room.boundaryPx, first, maxDistancePx)
  if (!a) return { ok: false, reason: '第一点离当前房间的墙边太远，请靠近墙边点击' }
  if (a.edgeLengthPx < minWidthPx) {
    return { ok: false, reason: `第 ${a.edgeIndex + 1} 条墙边太短，无法容纳门窗` }
  }
  const b = projectPointToEdge(room.boundaryPx, a.edgeIndex, second)
  if (!b || b.distancePx > maxDistancePx) {
    return { ok: false, reason: '第二点需要落在与第一点相同的墙边附近' }
  }
  const offsetPx = round2(Math.min(a.alongPx, b.alongPx))
  const widthPx = round2(Math.abs(a.alongPx - b.alongPx))
  if (widthPx < minWidthPx) {
    return { ok: false, reason: '两点距离太近，门窗宽度不足，请拉开两点' }
  }
  const clash = openings.find((o) => o.roomId === room.id && o.edgeIndex === a.edgeIndex &&
    offsetPx < o.offsetPx + o.widthPx - 1e-6 && o.offsetPx < offsetPx + widthPx - 1e-6)
  if (clash) return { ok: false, reason: `该位置与已有门窗 ${clash.id} 重叠，请错开或先调整它` }
  const edgeStart = room.boundaryPx[a.edgeIndex]!
  const edgeEnd = room.boundaryPx[(a.edgeIndex + 1) % room.boundaryPx.length]!
  const ux = (edgeEnd[0] - edgeStart[0]) / a.edgeLengthPx
  const uy = (edgeEnd[1] - edgeStart[1]) / a.edgeLengthPx
  return {
    ok: true,
    edgeIndex: a.edgeIndex,
    offsetPx,
    widthPx,
    start: [edgeStart[0] + ux * offsetPx, edgeStart[1] + uy * offsetPx],
    end: [edgeStart[0] + ux * (offsetPx + widthPx), edgeStart[1] + uy * (offsetPx + widthPx)],
  }
}

/** Smallest unused `${prefix}${n}` id (n starts at 1). */
export function nextEntityId(prefix: string, usedIds: Iterable<string>): string {
  const used = new Set(usedIds)
  let sequence = 1
  while (used.has(prefix + sequence)) sequence += 1
  return prefix + sequence
}

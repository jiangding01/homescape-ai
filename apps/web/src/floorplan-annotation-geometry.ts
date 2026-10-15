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

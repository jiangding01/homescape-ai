import { isPointInPolygon, type Polygon2D, type Vec2 } from '@homescape/spatial-model'

export interface Footprint2D {
  center: Vec2
  width: number
  depth: number
  yaw: number
}

const EPSILON = 1e-7

function rotatePoint(localX: number, localZ: number, yaw: number, center: Vec2): Vec2 {
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)

  return [
    center[0] + localX * cosine - localZ * sine,
    center[1] + localX * sine + localZ * cosine,
  ]
}

export function footprintCorners(footprint: Footprint2D): readonly Vec2[] {
  const halfWidth = footprint.width / 2
  const halfDepth = footprint.depth / 2

  return [
    rotatePoint(-halfWidth, -halfDepth, footprint.yaw, footprint.center),
    rotatePoint(halfWidth, -halfDepth, footprint.yaw, footprint.center),
    rotatePoint(halfWidth, halfDepth, footprint.yaw, footprint.center),
    rotatePoint(-halfWidth, halfDepth, footprint.yaw, footprint.center),
  ]
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2) {
  const cross =
    (point[0] - start[0]) * (end[1] - start[1]) -
    (point[1] - start[1]) * (end[0] - start[0])

  if (Math.abs(cross) > EPSILON) return false

  const dot =
    (point[0] - start[0]) * (end[0] - start[0]) +
    (point[1] - start[1]) * (end[1] - start[1])

  if (dot < -EPSILON) return false

  const squaredLength =
    (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2

  return dot <= squaredLength + EPSILON
}

function pointInsideOrOnPolygon(point: Vec2, polygon: Polygon2D) {
  for (let index = 0; index < polygon.points.length; index += 1) {
    const start = polygon.points[index]
    const end = polygon.points[(index + 1) % polygon.points.length]

    if (start && end && pointOnSegment(point, start, end)) return true
  }

  return isPointInPolygon(point, polygon)
}

export function footprintInsidePolygon(footprint: Footprint2D, polygon: Polygon2D) {
  const corners = footprintCorners(footprint)

  if (!corners.every((corner) => pointInsideOrOnPolygon(corner, polygon))) {
    return false
  }

  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index]
    const next = corners[(index + 1) % corners.length]

    if (!current || !next) continue

    const midpoint: Vec2 = [
      (current[0] + next[0]) / 2,
      (current[1] + next[1]) / 2,
    ]

    if (!pointInsideOrOnPolygon(midpoint, polygon)) return false
  }

  return true
}

function axesFor(corners: readonly Vec2[]) {
  const axes: Vec2[] = []

  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index]
    const next = corners[(index + 1) % corners.length]

    if (!current || !next) continue

    const edgeX = next[0] - current[0]
    const edgeZ = next[1] - current[1]
    const length = Math.hypot(edgeX, edgeZ)

    if (length <= EPSILON) continue

    axes.push([-edgeZ / length, edgeX / length])
  }

  return axes
}

function projection(corners: readonly Vec2[], axis: Vec2) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const corner of corners) {
    const value = corner[0] * axis[0] + corner[1] * axis[1]
    min = Math.min(min, value)
    max = Math.max(max, value)
  }

  return { min, max }
}

export function footprintsOverlap(a: Footprint2D, b: Footprint2D) {
  const aCorners = footprintCorners(a)
  const bCorners = footprintCorners(b)

  for (const axis of [...axesFor(aCorners), ...axesFor(bCorners)]) {
    const aProjection = projection(aCorners, axis)
    const bProjection = projection(bCorners, axis)

    if (
      aProjection.max <= bProjection.min + EPSILON ||
      bProjection.max <= aProjection.min + EPSILON
    ) {
      return false
    }
  }

  return true
}

export function expandFootprint(footprint: Footprint2D, padding: number): Footprint2D {
  return {
    ...footprint,
    width: footprint.width + padding * 2,
    depth: footprint.depth + padding * 2,
  }
}

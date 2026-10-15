import {
  isPolygonInsidePolygon,
  polygonBounds,
  rotateLocalToWorld,
  type Polygon2D,
  type Vec2,
} from '@homescape/spatial-model'

export interface Footprint2D {
  center: Vec2
  width: number
  depth: number
  yaw: number
}

const EPSILON = 1e-7
/** 占位超出房间的面积容差（平方米），只吸收浮点误差 */
const INSIDE_AREA_TOLERANCE = 1e-6

// 旋转约定统一由 spatial-model 的 rotateLocalToWorld 定义（与渲染器一致）。
function rotatePoint(localX: number, localZ: number, yaw: number, center: Vec2): Vec2 {
  const [offsetX, offsetZ] = rotateLocalToWorld(localX, localZ, yaw)

  return [center[0] + offsetX, center[1] + offsetZ]
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

export function footprintPolygon(footprint: Footprint2D): Polygon2D {
  return { points: [...footprintCorners(footprint)] }
}

/**
 * 占位是否完全落在多边形内（ADR 0018）：占位减去多边形后的面积近似为零。
 * 与只检查角点 / 边中点的旧实现不同，它能识别 L 形房间内凹角伸入占位的情况。
 */
export function footprintInsidePolygon(footprint: Footprint2D, polygon: Polygon2D) {
  const corners = footprintCorners(footprint)
  const bounds = polygonBounds(polygon)

  // 包围盒快速排除，避免对明显越界的候选做多边形裁剪。
  for (const [x, z] of corners) {
    if (
      x < bounds.min[0] - EPSILON ||
      x > bounds.max[0] + EPSILON ||
      z < bounds.min[1] - EPSILON ||
      z > bounds.max[1] + EPSILON
    ) {
      return false
    }
  }

  return isPolygonInsidePolygon({ points: [...corners] }, polygon, INSIDE_AREA_TOLERANCE)
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

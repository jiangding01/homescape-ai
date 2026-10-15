import * as polygonClippingModule from 'polygon-clipping'
import type { MultiPolygon as ClipMultiPolygon, Polygon as ClipPolygon } from 'polygon-clipping'
import type { Polygon2D, Vec2 } from './geometry'

/**
 * polygon-clipping 的类型声明是具名导出，但 ESM 构建只有 default 导出、CJS 构建是
 * `module.exports = {...}`。这里同时兼容两种形态，避免 Vite / Vitest / tsx 解析差异。
 */
const polygonClipping = ((polygonClippingModule as unknown as { default?: unknown }).default ??
  polygonClippingModule) as typeof polygonClippingModule

/**
 * 绕向约定（ADR 0018）。
 *
 * 平面坐标为 (x, z)，世界坐标系为右手系、+Y 向上。“逆时针”一律指**从 +Y 向下俯视**
 * 时的逆时针，即绕 +Y 轴按右手定则的正向旋转，与 `rotateLocalToWorld` 的 yaw 正方向
 * 一致：+X → −Z → −X → +Z。
 *
 * 注意：从 +Y 俯视时屏幕右为 +X、屏幕上为 −Z。若把 (x, z) 画在“z 轴朝上”的教科书
 * 坐标纸上，看到的是从 −Y 仰视的镜像，绕向恰好相反。因此：
 *
 *   从 +Y 俯视逆时针 ⇔ signedPolygonAreaXZ(points) < 0
 *
 * 对逆时针（从 +Y 俯视）的多边形，沿边方向 d = (dx, dz)，房间内部位于俯视左侧，
 * 内法线为 (dz, −dx)/|d|，外法线为 (−dz, dx)/|d|。
 */
export type PolygonWinding = 'ccw' | 'cw' | 'degenerate'

const AREA_EPSILON = 1e-12

/**
 * 教科书鞋带公式 Σ(x_i·z_{i+1} − x_{i+1}·z_i)/2，直接在 (x, z) 上计算。
 * 结果为负表示从 +Y 俯视逆时针（见上方约定）。
 */
export function signedPolygonAreaXZ(points: readonly Vec2[]) {
  if (points.length < 3) return 0

  let twiceArea = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!
    const next = points[(index + 1) % points.length]!
    twiceArea += current[0] * next[1] - next[0] * current[1]
  }

  return twiceArea / 2
}

/** 从 +Y 俯视的绕向。面积近似为 0 或含非有限坐标时返回 degenerate。 */
export function polygonWinding(polygon: Polygon2D): PolygonWinding {
  const area = signedPolygonAreaXZ(polygon.points)

  if (!Number.isFinite(area) || Math.abs(area) <= AREA_EPSILON) return 'degenerate'

  return area < 0 ? 'ccw' : 'cw'
}

export function isCounterClockwiseFromAbove(polygon: Polygon2D) {
  return polygonWinding(polygon) === 'ccw'
}

/**
 * 把多边形统一为从 +Y 俯视逆时针。反转时保留第 0 个点：
 * [p0, p1, …, p(n−1)] → [p0, p(n−1), …, p1]，原第 i 条边对应新第 (n−1−i) 条边且方向相反，
 * 可用 `reversedEdgeIndex` 换算。
 */
export function ensureCounterClockwise(polygon: Polygon2D): {
  polygon: Polygon2D
  reversed: boolean
} {
  if (polygonWinding(polygon) !== 'cw') {
    return { polygon: { points: [...polygon.points] }, reversed: false }
  }

  const [first, ...rest] = polygon.points

  return {
    polygon: { points: first ? [first, ...rest.reverse()] : [] },
    reversed: true,
  }
}

/** `ensureCounterClockwise` 反转后，原第 edgeIndex 条边在新多边形中的索引。 */
export function reversedEdgeIndex(pointCount: number, edgeIndex: number) {
  return pointCount - 1 - edgeIndex
}

/** 逆时针（从 +Y 俯视）多边形上 start → end 边的单位内法线；零长度边返回 [0, 0]。 */
export function edgeInwardNormal(start: Vec2, end: Vec2): Vec2 {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)

  if (length === 0) return [0, 0]

  return [dz / length, -dx / length]
}

export type PointInPolygonStatus = 'inside' | 'outside' | 'boundary'

function distancePointToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz

  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])

  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared),
  )

  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t))
}

/** 点与多边形关系；距任一边不超过 tolerance 视为在边界上。 */
export function pointInPolygonStatus(
  point: Vec2,
  polygon: Polygon2D,
  tolerance = 1e-9,
): PointInPolygonStatus {
  const { points } = polygon

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!

    if (distancePointToSegment(point, start, end) <= tolerance) return 'boundary'
  }

  let inside = false

  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current++
  ) {
    const [cx, cz] = points[current]!
    const [px, pz] = points[previous]!

    if (
      cz > point[1] !== pz > point[1] &&
      point[0] < ((px - cx) * (point[1] - cz)) / (pz - cz) + cx
    ) {
      inside = !inside
    }
  }

  return inside ? 'inside' : 'outside'
}

function toClipPolygon(polygon: Polygon2D): ClipPolygon {
  return [polygon.points.map((point) => [point[0], point[1]] as [number, number])]
}

function multiPolygonArea(geometry: ClipMultiPolygon) {
  let area = 0

  for (const polygon of geometry) {
    polygon.forEach((ring, ringIndex) => {
      const ringArea = Math.abs(signedPolygonAreaXZ(ring))
      area += ringIndex === 0 ? ringArea : -ringArea
    })
  }

  return area
}

function assertClippable(polygon: Polygon2D, label: string) {
  if (polygon.points.length < 3) return false

  for (const point of polygon.points) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw new Error(label + ' 含非有限坐标')
    }
  }

  return true
}

/** subject 减去 clip 后剩余部分的面积（平方米）。 */
export function polygonDifferenceArea(subject: Polygon2D, clip: Polygon2D) {
  if (!assertClippable(subject, 'subject')) return 0
  if (!assertClippable(clip, 'clip')) return Math.abs(signedPolygonAreaXZ(subject.points))

  return multiPolygonArea(polygonClipping.difference(toClipPolygon(subject), toClipPolygon(clip)))
}

/** 两个多边形相交部分的面积（平方米）。 */
export function polygonIntersectionArea(a: Polygon2D, b: Polygon2D) {
  if (!assertClippable(a, 'a') || !assertClippable(b, 'b')) return 0

  return multiPolygonArea(polygonClipping.intersection(toClipPolygon(a), toClipPolygon(b)))
}

/**
 * inner 是否落在 outer 内：inner 减去 outer 的面积不超过 areaTolerance（平方米）。
 * 这是 ADR 0018 对“家具占位在房间内”的定义，可正确处理 L 形房间的内凹角。
 */
export function isPolygonInsidePolygon(inner: Polygon2D, outer: Polygon2D, areaTolerance = 1e-6) {
  return polygonDifferenceArea(inner, outer) <= areaTolerance
}

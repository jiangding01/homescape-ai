export type Vec2 = readonly [x: number, z: number]
export type Vec3 = readonly [x: number, y: number, z: number]

export interface Polygon2D {
  points: Vec2[]
}

export interface Bounds2D {
  min: Vec2
  max: Vec2
  width: number
  depth: number
}

/**
 * 全项目唯一的平面旋转约定（Planner、Constraint、渲染器必须共用）。
 *
 * 世界平面坐标为 (x, z)，y 轴向上。`yaw` 与 Babylon 右手系下
 * `mesh.rotation.y = yaw` 的结果一致：绕 +Y 旋转 yaw 后，
 *
 *   局部 +X 轴 → 世界 (cos yaw, -sin yaw)
 *   局部 +Z 轴 → 世界 (sin yaw,  cos yaw)
 *
 * 即 world = (lx·cos + lz·sin, -lx·sin + lz·cos)。注意它与教科书里
 * “逆时针 (cos, sin)” 的二维旋转方向相反，业务代码不得自行写 cos/sin 旋转。
 */
export function rotateLocalToWorld(localX: number, localZ: number, yaw: number): Vec2 {
  const cosine = Math.cos(yaw)
  const sine = Math.sin(yaw)

  return [localX * cosine + localZ * sine, -localX * sine + localZ * cosine]
}

/**
 * 返回让对象局部 +X 轴指向世界方向 (dx, dz) 的 yaw（与 rotateLocalToWorld 互逆）。
 * 例如沿墙摆放时传入墙方向，家具宽度（局部 X）即与墙平行。
 */
export function yawFromDirection(dx: number, dz: number) {
  return -Math.atan2(dz, dx)
}

export function distance2D(a: Vec2, b: Vec2) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

export function polygonArea(polygon: Polygon2D) {
  const { points } = polygon

  if (points.length < 3) return 0

  let twiceArea = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (!current || !next) continue

    twiceArea += current[0] * next[1] - next[0] * current[1]
  }

  return Math.abs(twiceArea) / 2
}

export function polygonCenter(polygon: Polygon2D): Vec2 {
  if (polygon.points.length === 0) return [0, 0]

  const sum = polygon.points.reduce(
    (accumulator, point) => [accumulator[0] + point[0], accumulator[1] + point[1]] as Vec2,
    [0, 0] as Vec2,
  )

  return [sum[0] / polygon.points.length, sum[1] / polygon.points.length]
}

export function polygonBounds(polygon: Polygon2D): Bounds2D {
  if (polygon.points.length === 0) {
    return {
      min: [0, 0],
      max: [0, 0],
      width: 0,
      depth: 0,
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [x, z] of polygon.points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }

  return {
    min: [minX, minZ],
    max: [maxX, maxZ],
    width: maxX - minX,
    depth: maxZ - minZ,
  }
}

export function isPointInPolygon(point: Vec2, polygon: Polygon2D) {
  const [x, z] = point
  let inside = false

  for (
    let currentIndex = 0, previousIndex = polygon.points.length - 1;
    currentIndex < polygon.points.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon.points[currentIndex]
    const previous = polygon.points[previousIndex]

    if (!current || !previous) continue

    const [currentX, currentZ] = current
    const [previousX, previousZ] = previous
    const crossesRay =
      currentZ > z !== previousZ > z &&
      x < ((previousX - currentX) * (z - currentZ)) / (previousZ - currentZ) + currentX

    if (crossesRay) inside = !inside
  }

  return inside
}

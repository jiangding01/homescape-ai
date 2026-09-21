import type { Vec2 } from '@homescape/spatial-model'

const EPSILON = 1e-8

function cross(a: Vec2, b: Vec2, c: Vec2) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function signedArea(points: readonly Vec2[]) {
  let area = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (!current || !next) continue

    area += current[0] * next[1] - next[0] * current[1]
  }

  return area / 2
}

function pointInTriangle(point: Vec2, a: Vec2, b: Vec2, c: Vec2) {
  const c1 = cross(a, b, point)
  const c2 = cross(b, c, point)
  const c3 = cross(c, a, point)

  const hasNegative = c1 < -EPSILON || c2 < -EPSILON || c3 < -EPSILON
  const hasPositive = c1 > EPSILON || c2 > EPSILON || c3 > EPSILON

  return !(hasNegative && hasPositive)
}

export function triangulateSimplePolygon(points: readonly Vec2[]) {
  if (points.length < 3) return [] as number[]

  const remaining = points.map((_, index) => index)

  if (signedArea(points) < 0) {
    remaining.reverse()
  }

  const triangles: number[] = []
  let guard = points.length * points.length

  while (remaining.length > 3 && guard > 0) {
    guard -= 1
    let earFound = false

    for (let index = 0; index < remaining.length; index += 1) {
      const previousIndex = remaining[(index - 1 + remaining.length) % remaining.length]
      const currentIndex = remaining[index]
      const nextIndex = remaining[(index + 1) % remaining.length]

      if (
        previousIndex === undefined ||
        currentIndex === undefined ||
        nextIndex === undefined
      ) {
        continue
      }

      const a = points[previousIndex]
      const b = points[currentIndex]
      const c = points[nextIndex]

      if (!a || !b || !c || cross(a, b, c) <= EPSILON) continue

      const containsOtherPoint = remaining.some((candidateIndex) => {
        if (
          candidateIndex === previousIndex ||
          candidateIndex === currentIndex ||
          candidateIndex === nextIndex
        ) {
          return false
        }

        const candidate = points[candidateIndex]
        return candidate ? pointInTriangle(candidate, a, b, c) : false
      })

      if (containsOtherPoint) continue

      triangles.push(previousIndex, nextIndex, currentIndex)
      remaining.splice(index, 1)
      earFound = true
      break
    }

    if (!earFound) break
  }

  if (remaining.length === 3) {
    const [a, b, c] = remaining

    if (a !== undefined && b !== undefined && c !== undefined) {
      triangles.push(a, c, b)
    }
  }

  if (triangles.length === 0 && points.length >= 3) {
    for (let index = 1; index < points.length - 1; index += 1) {
      triangles.push(0, index + 1, index)
    }
  }

  return triangles
}

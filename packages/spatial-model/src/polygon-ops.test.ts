import { describe, expect, it } from 'vitest'
import { rotateLocalToWorld, type Polygon2D, type Vec2 } from './geometry'
import {
  edgeInwardNormal,
  ensureCounterClockwise,
  isPolygonInsidePolygon,
  pointInPolygonStatus,
  polygonDifferenceArea,
  polygonIntersectionArea,
  polygonWinding,
  reversedEdgeIndex,
  signedPolygonAreaXZ,
} from './polygon-ops'

// 从 +Y 俯视逆时针：+X → −Z → −X → +Z（与 yaw 正方向一致）
const ccwSquare: Polygon2D = {
  points: [
    [0, 0],
    [0, 2],
    [2, 2],
    [2, 0],
  ],
}

const lShape: Polygon2D = ensureCounterClockwise({
  points: [
    [0, 0],
    [4, 0],
    [4, 2],
    [2, 2],
    [2, 4],
    [0, 4],
  ],
}).polygon

describe('绕向约定（从 +Y 俯视）', () => {
  it('与 yaw 正方向一致：沿 yaw 递增采样的多边形为逆时针', () => {
    const points: Vec2[] = [0, 1, 2, 3].map((step) =>
      rotateLocalToWorld(1, 0, (step * Math.PI) / 2),
    )
    expect(points[1]![1]).toBeCloseTo(-1, 9) // +X 绕 +Y 转 90° 指向 −Z
    expect(polygonWinding({ points })).toBe('ccw')
    expect(signedPolygonAreaXZ(points)).toBeLessThan(0)
  })

  it('教科书正面积（z 轴朝上作图时的逆时针）在俯视下是顺时针', () => {
    const textbook: Polygon2D = {
      points: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    }
    expect(signedPolygonAreaXZ(textbook.points)).toBeGreaterThan(0)
    expect(polygonWinding(textbook)).toBe('cw')
    expect(polygonWinding(ccwSquare)).toBe('ccw')
    expect(
      polygonWinding({
        points: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      }),
    ).toBe('degenerate')
    expect(
      polygonWinding({
        points: [
          [0, 0],
          [1, Number.NaN],
          [2, 1],
        ],
      }),
    ).toBe('degenerate')
  })

  it('ensureCounterClockwise 保留首点并给出边索引换算', () => {
    const cw: Polygon2D = {
      points: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
    }
    const { polygon, reversed } = ensureCounterClockwise(cw)
    expect(reversed).toBe(true)
    expect(polygon.points[0]).toEqual([0, 0])
    expect(polygonWinding(polygon)).toBe('ccw')

    // 原第 1 条边 (2,0)→(2,2) 对应新第 2 条边 (2,2)→(2,0)
    const newIndex = reversedEdgeIndex(4, 1)
    expect(newIndex).toBe(2)
    expect(polygon.points[newIndex]).toEqual([2, 2])
    expect(polygon.points[(newIndex + 1) % 4]).toEqual([2, 0])

    expect(ensureCounterClockwise(ccwSquare).reversed).toBe(false)
  })

  it('逆时针多边形的内法线指向房间内部', () => {
    const points = ccwSquare.points
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index]!
      const end = points[(index + 1) % points.length]!
      const normal = edgeInwardNormal(start, end)
      const probe: Vec2 = [
        (start[0] + end[0]) / 2 + normal[0] * 0.1,
        (start[1] + end[1]) / 2 + normal[1] * 0.1,
      ]
      expect(pointInPolygonStatus(probe, ccwSquare)).toBe('inside')
    }
  })
})

describe('点与多边形关系', () => {
  it('区分内部、外部与边界', () => {
    expect(pointInPolygonStatus([1, 1], ccwSquare)).toBe('inside')
    expect(pointInPolygonStatus([3, 1], ccwSquare)).toBe('outside')
    expect(pointInPolygonStatus([2, 1], ccwSquare)).toBe('boundary')
    expect(pointInPolygonStatus([2.005, 1], ccwSquare, 0.01)).toBe('boundary')
    expect(pointInPolygonStatus([3, 3], lShape)).toBe('outside')
  })
})

describe('多边形面积运算', () => {
  it('差集与交集面积', () => {
    const shifted: Polygon2D = {
      points: [
        [1, 0],
        [1, 2],
        [3, 2],
        [3, 0],
      ],
    }
    expect(polygonDifferenceArea(ccwSquare, shifted)).toBeCloseTo(2, 9)
    expect(polygonIntersectionArea(ccwSquare, shifted)).toBeCloseTo(2, 9)
  })

  it('L 形房间内凹角：角点都在房间内的占位仍可能越界', () => {
    // 1.5–2.5 的方块四个角点中 3 个在 L 形内，仅 (2.5, 2.5) 在外；用面积判断才能发现越界。
    const footprint: Polygon2D = {
      points: [
        [1.5, 1.5],
        [1.5, 2.5],
        [2.5, 2.5],
        [2.5, 1.5],
      ],
    }
    expect(polygonDifferenceArea(footprint, lShape)).toBeCloseTo(0.25, 9)
    expect(isPolygonInsidePolygon(footprint, lShape)).toBe(false)

    const inside: Polygon2D = {
      points: [
        [0.5, 0.5],
        [0.5, 1.5],
        [3.5, 1.5],
        [3.5, 0.5],
      ],
    }
    expect(isPolygonInsidePolygon(inside, lShape)).toBe(true)
  })

  it('非有限坐标直接报错', () => {
    expect(() =>
      polygonDifferenceArea(
        {
          points: [
            [0, 0],
            [Number.NaN, 1],
            [1, 1],
          ],
        },
        ccwSquare,
      ),
    ).toThrow('非有限坐标')
  })
})

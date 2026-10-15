import { createInitialDesignState } from '@homescape/domain'
import { describe, expect, it } from 'vitest'
import { footprintCorners, footprintsOverlap, type Footprint2D } from './geometry'
import { RuleBasedPlanner } from './rule-based-planner'
import { rotatedSquareModel, testCatalog } from './test-fixtures'

/**
 * 按 Babylon 约定手算：Matrix.RotationY(θ) 为行向量矩阵
 *   [ c 0 -s ]
 *   [ 0 1  0 ]
 *   [ s 0  c ]
 * v' = v·M ⇒ x' = x·c + z·s，z' = -x·s + z·c。
 */
function babylonCorner(footprint: Footprint2D, localX: number, localZ: number) {
  const c = Math.cos(footprint.yaw)
  const s = Math.sin(footprint.yaw)

  return [
    footprint.center[0] + localX * c + localZ * s,
    footprint.center[1] - localX * s + localZ * c,
  ] as const
}

const nonRightAngleYaws = [0.2, 0.61, -0.9, 1.3, 2.2, -2.75, Math.PI / 5]

describe('Planner footprint 旋转约定', () => {
  it.each(nonRightAngleYaws)('footprint 角点与 Babylon 手算一致 (yaw=%s)', (yaw) => {
    const footprint: Footprint2D = { center: [1.5, -2], width: 2.4, depth: 0.8, yaw }
    const hw = footprint.width / 2
    const hd = footprint.depth / 2
    const expected = [
      babylonCorner(footprint, -hw, -hd),
      babylonCorner(footprint, hw, -hd),
      babylonCorner(footprint, hw, hd),
      babylonCorner(footprint, -hw, hd),
    ]

    const corners = footprintCorners(footprint)

    expect(corners).toHaveLength(4)
    corners.forEach((corner, index) => {
      expect(corner[0]).toBeCloseTo(expected[index]![0], 10)
      expect(corner[1]).toBeCloseTo(expected[index]![1], 10)
    })
  })

  it('旋转方向错误会导致柱子等结构 footprint 碰撞判断出错', () => {
    // 细长柱子 yaw=0.5：按 Babylon 约定其长轴指向 (cos0.5, -sin0.5)。
    const column: Footprint2D = { center: [0, 0], width: 3, depth: 0.2, yaw: 0.5 }
    const alongAxis: Footprint2D = {
      center: [1.2 * Math.cos(0.5), -1.2 * Math.sin(0.5)],
      width: 0.2,
      depth: 0.2,
      yaw: 0,
    }
    const mirrored: Footprint2D = {
      center: [1.2 * Math.cos(0.5), 1.2 * Math.sin(0.5)],
      width: 0.2,
      depth: 0.2,
      yaw: 0,
    }

    expect(footprintsOverlap(column, alongAxis)).toBe(true)
    expect(footprintsOverlap(column, mirrored)).toBe(false)
  })
})

describe('沿墙候选方向', () => {
  it.each([0.35, -0.6, 1.0])('倾斜房间内靠墙家具长轴与墙平行 (房间旋转 %s)', async (angle) => {
    const spatialModel = rotatedSquareModel(angle)
    const planner = new RuleBasedPlanner(testCatalog())
    const state = createInitialDesignState({
      projectId: 'project-test',
      spatialModelId: spatialModel.id,
    })

    const result = await planner.plan({
      spatialModel,
      state,
      operations: [
        {
          id: 'op-add-sofa',
          type: 'add_object',
          source: 'user',
          scope: { type: 'room', roomId: 'room-1' },
          category: 'sofa',
          requirements: {},
        },
      ],
    })

    expect(result.violations).toEqual([])
    const upsert = result.mutations.find((mutation) => mutation.type === 'upsert_object')
    expect(upsert?.type).toBe('upsert_object')
    if (upsert?.type !== 'upsert_object') return

    const object = upsert.object
    const [width, , depth] = object.dimensions!
    const corners = footprintCorners({
      center: [object.transform.position[0], object.transform.position[2]],
      width,
      depth,
      yaw: object.transform.yaw,
    })
    // corner0 → corner1 为局部 X（宽度 / 长轴）方向。
    const longAxis = [corners[1]![0] - corners[0]![0], corners[1]![1] - corners[0]![1]]
    const longLength = Math.hypot(longAxis[0]!, longAxis[1]!)
    expect(longLength).toBeCloseTo(width, 10)

    const walls = spatialModel.floors[0]!.walls
    const parallelWall = walls.find((wall) => {
      const dx = wall.end[0] - wall.start[0]
      const dz = wall.end[1] - wall.start[1]
      const cross = (longAxis[0]! * dz - longAxis[1]! * dx) / (longLength * Math.hypot(dx, dz))
      return Math.abs(cross) < 1e-9
    })
    expect(parallelWall).toBeDefined()

    // 并且家具紧贴该墙：中心到墙线的距离 = 半深度 + wallClearance。
    const wall = parallelWall!
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const distanceToWall =
      Math.abs(
        (object.transform.position[0] - wall.start[0]) * dz -
          (object.transform.position[2] - wall.start[1]) * dx,
      ) / Math.hypot(dx, dz)
    expect(distanceToWall).toBeCloseTo(depth / 2 + 0.05, 9)
  })
})

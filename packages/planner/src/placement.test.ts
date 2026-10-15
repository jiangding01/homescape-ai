import { InMemoryCatalog, livingRoomCatalog } from '@homescape/catalog'
import { createInitialDesignState, type DesignOperation } from '@homescape/domain'
import {
  bindRoomEdgeSpanToWall,
  edgeInwardNormal,
  FURNITURE_FRONT_LOCAL_AXIS,
  HOME_SPATIAL_MODEL_SCHEMA_VERSION,
  inferWallsFromRooms,
  pointInPolygonStatus,
  rotateLocalToWorld,
  sampleApartment,
  type HomeSpatialModel,
  type Polygon2D,
  type Vec2,
} from '@homescape/spatial-model'
import { describe, expect, it } from 'vitest'
import {
  footprintInsidePolygon,
  footprintPolygon,
  footprintsOverlap,
  type Footprint2D,
} from './geometry'
import {
  OPENING_CLEARANCE_DEPTH,
  openingClearanceFootprints,
  regionWallSpans,
  wallPoses,
} from './placement-geometry'
import { RuleBasedPlanner } from './rule-based-planner'
import { singleRoomModel, testCatalog, wallSofa } from './test-fixtures'

/** 从 +Y 俯视逆时针的矩形（与示例户型 rect 相同的点序） */
function rect(x0: number, z0: number, x1: number, z1: number): Polygon2D {
  return {
    points: [
      [x0, z0],
      [x0, z1],
      [x1, z1],
      [x1, z0],
    ],
  }
}

/** L 形房间：4 m × 4 m 去掉 x > 2、z > 2 的象限，内凹角在 (2, 2)；从 +Y 俯视逆时针 */
const L_ROOM: Polygon2D = {
  points: [
    [0, 0],
    [0, 4],
    [2, 4],
    [2, 2],
    [4, 2],
    [4, 0],
  ],
}

function frontDirection(yaw: number) {
  return rotateLocalToWorld(FURNITURE_FRONT_LOCAL_AXIS[0], FURNITURE_FRONT_LOCAL_AXIS[1], yaw)
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / (dx * dx + dz * dz)),
  )
  return Math.hypot(point[0] - start[0] - dx * t, point[1] - start[1] - dz * t)
}

function distanceToLine(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  return Math.abs((point[0] - start[0]) * dz - (point[1] - start[1]) * dx) / Math.hypot(dx, dz)
}

describe('占位在房间内判断', () => {
  it('L 形房间内凹角伸入占位时判为不在房间内', () => {
    // 细长占位沿 (1, −1) 方向，内凹角 (2, 2) 落在其长边附近：
    // 4 个角点与 4 个边中点都在房间内（旧实现会误判为在房间内），但长边一段伸进缺口。
    const s = Math.SQRT1_2
    const center: Vec2 = [2 - 0.1 * s + 0.5 * s, 2 - 0.1 * s - 0.5 * s]
    const footprint: Footprint2D = { center, width: 3, depth: 0.4, yaw: Math.PI / 4 }
    const corners = footprintPolygon(footprint).points
    const midpoints = corners.map((corner, index) => {
      const next = corners[(index + 1) % corners.length]!
      return [(corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2] as Vec2
    })

    for (const point of [...corners, ...midpoints]) {
      expect(pointInPolygonStatus(point, L_ROOM)).toBe('inside')
    }
    expect(pointInPolygonStatus([2.05, 2.05], L_ROOM)).toBe('outside')
    expect(footprintInsidePolygon(footprint, L_ROOM)).toBe(false)
  })

  it('完全在 L 形房间内（含贴边）的占位判为在房间内', () => {
    expect(
      footprintInsidePolygon({ center: [1, 3], width: 2, depth: 1, yaw: 0 }, L_ROOM),
    ).toBe(true)
    expect(
      footprintInsidePolygon({ center: [3, 1], width: 2, depth: 2, yaw: 0 }, L_ROOM),
    ).toBe(true)
  })
})

describe('靠墙候选', () => {
  const dimensions = { width: 1.6, depth: 0.8 }
  const clearance = 0.06

  it('沿 L 形房间每条边生成，跳过短于家具宽度的边，全部在房间内且正面朝内', () => {
    const spans = regionWallSpans(L_ROOM, L_ROOM)
    expect(spans).toHaveLength(6)

    const poses = wallPoses(spans, dimensions, clearance)
    const usedSpans = new Set(poses.map((pose) => pose.span))
    // 6 条边长度均为 2 或 4，都不短于 1.6
    expect(usedSpans.size).toBe(6)
    expect(wallPoses(spans, { width: 2.5, depth: 0.8 }, clearance).every((pose) => pose.span.length >= 2.5)).toBe(true)

    for (const pose of poses) {
      const footprint = { center: pose.center, ...dimensions, yaw: pose.yaw }
      expect(footprintInsidePolygon(footprint, L_ROOM)).toBe(true)

      const front = frontDirection(pose.yaw)
      expect(front[0]).toBeCloseTo(pose.span.inwardNormal[0], 9)
      expect(front[1]).toBeCloseTo(pose.span.inwardNormal[1], 9)
      const backCenter = rotateLocalToWorld(0, dimensions.depth / 2, pose.yaw)
      const back: Vec2 = [pose.center[0] + backCenter[0], pose.center[1] + backCenter[1]]
      expect(distanceToLine(back, pose.span.start, pose.span.end)).toBeCloseTo(clearance, 9)
    }
  })

  it('示例客厅的靠墙候选全部位于本房间、不落入相邻房间，正面朝向房间内部', () => {
    const floor = sampleApartment.floors[0]!
    const living = floor.rooms.find((room) => room.id === 'room-living')!
    const poses = wallPoses(regionWallSpans(living.boundary, living.boundary), dimensions, clearance)

    expect(poses.length).toBeGreaterThan(0)

    for (const pose of poses) {
      expect(footprintInsidePolygon({ center: pose.center, ...dimensions, yaw: pose.yaw }, living.boundary)).toBe(true)

      for (const other of floor.rooms) {
        if (other.id === living.id) continue
        expect(pointInPolygonStatus(pose.center, other.boundary)).toBe('outside')
      }

      const front = frontDirection(pose.yaw)
      const ahead: Vec2 = [pose.center[0] + front[0] * 0.5, pose.center[1] + front[1] * 0.5]
      expect(pointInPolygonStatus(ahead, living.boundary)).toBe('inside')
    }
  })

  it('Zone 只沿与房间边重合的边段生成候选，Zone 分隔线不算墙', () => {
    const room = rect(0, 0, 6, 4)
    const zone = rect(0, 0, 4, 4)
    const spans = regionWallSpans(zone, room)

    // 西、北、南三段贴墙；x = 4 的分隔线不是墙
    expect(spans).toHaveLength(3)
    for (const span of spans) {
      expect(Math.abs(span.start[0] - 4) < 1e-9 && Math.abs(span.end[0] - 4) < 1e-9).toBe(false)
    }
    const lengths = spans.map((span) => span.length).sort((a, b) => a - b)
    expect(lengths).toEqual([4, 4, 4])
  })

  it('Planner 选出的沙发背面与内表面距离等于净空、正面朝房间内部', async () => {
    const spatialModel = singleRoomModel(L_ROOM)
    const result = await new RuleBasedPlanner(testCatalog()).plan({
      spatialModel,
      state: createInitialDesignState({ projectId: 'p', spatialModelId: spatialModel.id }),
      operations: [
        {
          id: 'op-sofa',
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
    if (upsert?.type !== 'upsert_object') throw new Error('缺少 upsert')

    const { position, yaw } = upsert.object.transform
    const center: Vec2 = [position[0], position[2]]
    const backOffset = rotateLocalToWorld(0, wallSofa.dimensions.depth / 2, yaw)
    const back: Vec2 = [center[0] + backOffset[0], center[1] + backOffset[1]]
    const points = L_ROOM.points
    const distances = points.map((start, index) =>
      distanceToSegment(back, start, points[(index + 1) % points.length]!),
    )
    const nearestEdge = distances.indexOf(Math.min(...distances))

    expect(distances[nearestEdge]).toBeCloseTo(wallSofa.placement.wallClearance, 9)

    const edgeStart = points[nearestEdge]!
    const edgeEnd = points[(nearestEdge + 1) % points.length]!
    const inward = edgeInwardNormal(edgeStart, edgeEnd)
    const front = frontDirection(yaw)
    expect(front[0]).toBeCloseTo(inward[0], 9)
    expect(front[1]).toBeCloseTo(inward[1], 9)
  })
})

describe('门洞净空只作用于相关房间一侧', () => {
  function twoRoomsWithDoor(): HomeSpatialModel {
    const roomA = { id: 'room-a', boundary: rect(0, 0, 4, 3) }
    const roomB = { id: 'room-b', boundary: rect(4.12, 0, 7, 3) }
    const inference = inferWallsFromRooms([roomA, roomB])
    const walls = inference.walls.map((wall) => ({ ...wall, height: 2.8 }))
    // 房间 A 的第 2 条边（东侧 x = 4，自 z = 3 向 z = 0）上 1.0–1.9 m 处的门
    const binding = bindRoomEdgeSpanToWall(walls, roomA, 2, 1, 1.9)
    if (binding.status !== 'bound') throw new Error('门未绑定到墙段')

    const room = (id: string, boundary: Polygon2D) => ({
      id,
      name: id,
      type: 'bedroom' as const,
      boundary,
      ceilingHeight: 2.8,
      wallIds: inference.roomWallIds.get(id) ?? [],
      openingIds: ['door-ab'],
      zones: [],
    })

    return {
      schemaVersion: HOME_SPATIAL_MODEL_SCHEMA_VERSION,
      id: 'two-rooms',
      name: 'Two Rooms',
      unit: 'meter',
      coordinateSystem: 'right-handed-y-up',
      floors: [
        {
          id: 'floor-1',
          name: '1F',
          elevation: 0,
          rooms: [room('room-a', roomA.boundary), room('room-b', roomB.boundary)],
          walls,
          openings: [
            {
              id: 'door-ab',
              wallId: binding.wallId,
              kind: 'door',
              offset: binding.offset,
              width: binding.width,
              height: 2.1,
            },
          ],
          structuralElements: [],
          utilityAnchors: [],
          connections: [],
        },
      ],
    }
  }

  it('每个房间的净空区从本侧内表面起向房间内延伸，不伸入另一侧', () => {
    const floor = twoRoomsWithDoor().floors[0]!

    for (const room of floor.rooms) {
      const footprints = openingClearanceFootprints(floor, room)
      expect(footprints).toHaveLength(1)
      const footprint = footprints[0]!

      expect(footprintInsidePolygon(footprint, room.boundary)).toBe(true)
      expect(footprint.depth).toBeCloseTo(OPENING_CLEARANCE_DEPTH, 9)

      const other = floor.rooms.find((candidate) => candidate.id !== room.id)!
      for (const corner of footprintPolygon(footprint).points) {
        expect(pointInPolygonStatus(corner, other.boundary, 1e-6)).toBe('outside')
      }
    }
  })

  it('门洞净空会阻止家具贴着门放置', async () => {
    const spatialModel = twoRoomsWithDoor()
    const result = await new RuleBasedPlanner(new InMemoryCatalog([wallSofa])).plan({
      spatialModel,
      state: createInitialDesignState({ projectId: 'p', spatialModelId: spatialModel.id }),
      operations: [
        {
          id: 'op-sofa-a',
          type: 'add_object',
          source: 'user',
          scope: { type: 'room', roomId: 'room-a' },
          category: 'sofa',
          requirements: {},
        },
      ],
    })
    const upsert = result.mutations.find((mutation) => mutation.type === 'upsert_object')
    if (upsert?.type !== 'upsert_object') throw new Error('缺少 upsert')

    const floor = spatialModel.floors[0]!
    const room = floor.rooms[0]!
    const [door] = openingClearanceFootprints(floor, room)
    const sofa: Footprint2D = {
      center: [upsert.object.transform.position[0], upsert.object.transform.position[2]],
      width: wallSofa.dimensions.width,
      depth: wallSofa.dimensions.depth,
      yaw: upsert.object.transform.yaw,
    }
    expect(footprintsOverlap(sofa, door!)).toBe(false)
  })
})

describe('示例客厅三件套', () => {
  it('沙发、茶几、绿植均能生成布局', async () => {
    const operations: DesignOperation[] = [
      {
        id: 'op-sofa',
        type: 'add_object',
        source: 'user',
        scope: { type: 'room', roomId: 'room-living' },
        category: 'sofa',
        requirements: { style: 'warm-modern', minSeats: 3, maxWidth: 2.3 },
      },
      {
        id: 'op-table',
        type: 'add_object',
        source: 'user',
        scope: { type: 'room', roomId: 'room-living' },
        category: 'coffee_table',
        requirements: { style: 'warm-modern', maxWidth: 1.3 },
      },
      {
        id: 'op-plant',
        type: 'add_object',
        source: 'user',
        scope: { type: 'room', roomId: 'room-living' },
        category: 'plant',
        requirements: { styleTags: ['warm-modern', 'greenery'] },
      },
    ]
    const result = await new RuleBasedPlanner(new InMemoryCatalog(livingRoomCatalog)).plan({
      spatialModel: sampleApartment,
      state: createInitialDesignState({ projectId: 'p', spatialModelId: sampleApartment.id }),
      operations,
    })

    expect(result.violations).toEqual([])
    const objects = result.mutations.flatMap((mutation) =>
      mutation.type === 'upsert_object' ? [mutation.object] : [],
    )
    expect(objects.map((object) => object.category)).toEqual(['sofa', 'coffee_table', 'plant'])

    const living = sampleApartment.floors[0]!.rooms.find((room) => room.id === 'room-living')!
    for (const object of objects) {
      const [width, , depth] = object.dimensions!
      expect(
        footprintInsidePolygon(
          {
            center: [object.transform.position[0], object.transform.position[2]],
            width,
            depth,
            yaw: object.transform.yaw,
          },
          living.boundary,
        ),
      ).toBe(true)
    }

    const sofa = objects[0]!
    const front = frontDirection(sofa.transform.yaw)
    const ahead: Vec2 = [
      sofa.transform.position[0] + front[0] * 1,
      sofa.transform.position[2] + front[1] * 1,
    ]
    expect(pointInPolygonStatus(ahead, living.boundary)).toBe('inside')
  })
})

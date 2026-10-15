import { describe, expect, it } from 'vitest'
import type { Polygon2D, Vec2 } from './geometry'
import type { HomeSpatialModel, WallRoomSide } from './model'
import { pointInPolygonStatus, polygonWinding } from './polygon-ops'
import { validateHomeSpatialModel } from './validation'
import {
  bindRoomEdgeSpanToWall,
  inferWallsFromRooms,
  wallRoomSides,
  withWallThickness,
  type InferredWallSegment,
  type WallInferenceResult,
  type WallInferenceRoom,
} from './wall-inference'

/** 从 +Y 俯视逆时针的矩形：边 0 西、1 北、2 东、3 南 */
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

function room(id: string, boundary: Polygon2D): WallInferenceRoom {
  return { id, boundary }
}

function wallLength(wall: InferredWallSegment) {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

/** 墙中点沿俯视左（sides[0]）/ 右（sides[1]）法线偏移 distance 的探针点 */
function probe(wall: InferredWallSegment, sideIndex: 0 | 1, distance: number): Vec2 {
  const length = wallLength(wall)
  const dx = (wall.end[0] - wall.start[0]) / length
  const dz = (wall.end[1] - wall.start[1]) / length
  const sign = sideIndex === 0 ? 1 : -1
  return [
    (wall.start[0] + wall.end[0]) / 2 + dz * distance * sign,
    (wall.start[1] + wall.end[1]) / 2 - dx * distance * sign,
  ]
}

function pairedRoomIds(walls: InferredWallSegment[]) {
  return walls
    .filter((wall) => wall.thicknessSource === 'paired')
    .map((wall) =>
      wallRoomSides(wall)
        .map((side) => side.roomId)
        .sort()
        .join('|'),
    )
    .sort()
}

function sidesOn(walls: InferredWallSegment[], roomId: string, edgeIndex: number) {
  return walls
    .flatMap((wall) => wallRoomSides(wall).map((side) => ({ wall, side })))
    .filter(({ side }) => side.roomId === roomId && side.edgeIndex === edgeIndex)
    .sort((a, b) => a.side.edgeStart - b.side.edgeStart)
}

function modelFromInference(rooms: WallInferenceRoom[], result: WallInferenceResult) {
  const model: HomeSpatialModel = {
    schemaVersion: '0.3.0',
    id: 'model',
    name: 'test',
    unit: 'meter',
    coordinateSystem: 'right-handed-y-up',
    floors: [
      {
        id: 'floor',
        name: '1F',
        elevation: 0,
        rooms: rooms.map((candidate) => ({
          id: candidate.id,
          name: candidate.id,
          type: 'other',
          boundary: candidate.boundary,
          ceilingHeight: 2.8,
          wallIds: result.roomWallIds.get(candidate.id) ?? [],
          openingIds: [],
          zones: [],
        })),
        walls: result.walls.map((wall) => ({ ...wall, height: 2.8 })),
        openings: [],
        structuralElements: [],
        utilityAnchors: [],
        connections: [],
      },
    ],
  }
  return model
}

/** 每面墙的两侧探针必须落在对应房间内（或室外） */
function expectSidesConsistent(rooms: WallInferenceRoom[], walls: InferredWallSegment[]) {
  const byId = new Map(rooms.map((candidate) => [candidate.id, candidate]))

  for (const wall of walls) {
    wall.sides.forEach((side, index) => {
      const point = probe(wall, index as 0 | 1, wall.thickness / 2 + 0.03)
      if (side.kind === 'room') {
        expect(pointInPolygonStatus(point, byId.get(side.roomId)!.boundary)).toBe('inside')
      } else {
        for (const candidate of rooms) {
          expect(pointInPolygonStatus(point, candidate.boundary)).toBe('outside')
        }
      }
    })
  }
}

describe('成对边推导墙体', () => {
  it('两个相邻矩形房间推导出 1 面共享墙，厚度等于间距', () => {
    const rooms = [room('a', rect(0, 0, 4, 3)), room('b', rect(4.12, 0, 7, 3))]
    const result = inferWallsFromRooms(rooms)
    const { walls, roomWallIds } = result
    const shared = walls.filter((wall) => wall.thicknessSource === 'paired')

    expect(shared).toHaveLength(1)
    const wall = shared[0]!
    expect(wall.thickness).toBeCloseTo(0.12, 9)
    expect(wall.start[0]).toBeCloseTo(4.06, 9)
    expect(wall.end[0]).toBeCloseTo(4.06, 9)
    expect(wallLength(wall)).toBeCloseTo(3, 9)
    expect(wall.id).toBe('wall-a-e2-s0')
    expect(wall.sides.map((side) => side.kind === 'room' && side.roomId)).toEqual(['a', 'b'])

    // 其余 6 条边都是外墙
    expect(walls.filter((candidate) => candidate.thicknessSource === 'exterior')).toHaveLength(6)
    expect(roomWallIds.get('a')).toHaveLength(4)
    expect(roomWallIds.get('a')).toContain(wall.id)
    expect(roomWallIds.get('b')).toContain(wall.id)
    expectSidesConsistent(rooms, walls)
    expect(validateHomeSpatialModel(modelFromInference(rooms, result)).issues).toEqual([])
  })

  it('外墙中心线向房间外侧偏移半个假设墙厚', () => {
    const rooms = [room('a', rect(0, 0, 4, 3))]
    const { walls } = inferWallsFromRooms(rooms, { exteriorThickness: 0.24 })
    expect(walls).toHaveLength(4)

    const byEdge = new Map(walls.map((wall) => [wallRoomSides(wall)[0]!.edgeIndex, wall]))
    expect(byEdge.get(0)!.start[0]).toBeCloseTo(-0.12, 9) // 西墙 x = −0.12
    expect(byEdge.get(1)!.start[1]).toBeCloseTo(3.12, 9) // 北墙 z = 3.12
    expect(byEdge.get(2)!.start[0]).toBeCloseTo(4.12, 9) // 东墙 x = 4.12
    expect(byEdge.get(3)!.start[1]).toBeCloseTo(-0.12, 9) // 南墙 z = −0.12

    for (const wall of walls) {
      expect(wall.thickness).toBe(0.24)
      expect(wall.sides[0].kind).toBe('room')
      expect(wall.sides[1].kind).toBe('exterior')
    }

    // 外角封闭：每段外墙伸到相邻外墙外表面
    expect(byEdge.get(3)!.start[0]).toBeCloseTo(4.24, 9)
    expect(byEdge.get(3)!.end[0]).toBeCloseTo(-0.24, 9)
    expectSidesConsistent(rooms, walls)
  })

  it('顺时针输入同样判断出正确的外侧', () => {
    const cw: Polygon2D = {
      points: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    }
    expect(polygonWinding(cw)).toBe('cw')
    const rooms = [room('a', cw)]
    const { walls } = inferWallsFromRooms(rooms)
    expectSidesConsistent(rooms, walls)
    expect(walls.every((wall) => wall.sides[1].kind === 'room')).toBe(true)
  })

  it('T 型接头：大房间一条边被两个小房间切分', () => {
    const rooms = [
      room('big', rect(0, 0, 6, 3)),
      room('left', rect(0, 3.12, 2.9, 6)),
      room('right', rect(3.02, 3.12, 6, 6)),
    ]
    const result = inferWallsFromRooms(rooms)
    const { walls } = result
    const onBigNorth = sidesOn(walls, 'big', 1)

    expect(onBigNorth.map(({ wall }) => wall.thicknessSource)).toEqual(['paired', 'paired'])
    // 两个小房间之间隔墙端头（2.9–3.02）并入前一段共享墙，不生成外墙
    expect(onBigNorth[0]!.side.edgeStart).toBeCloseTo(0, 9)
    expect(onBigNorth[0]!.side.edgeEnd).toBeCloseTo(3.02, 9)
    expect(onBigNorth[1]!.side.edgeStart).toBeCloseTo(3.02, 9)
    expect(onBigNorth[1]!.side.edgeEnd).toBeCloseTo(6, 9)
    expect(wallRoomSides(onBigNorth[0]!.wall).map((side) => side.roomId)).toContain('left')
    expect(wallRoomSides(onBigNorth[1]!.wall).map((side) => side.roomId)).toContain('right')

    expect(pairedRoomIds(walls)).toEqual(['big|left', 'big|right', 'left|right'])
    expect(validateHomeSpatialModel(modelFromInference(rooms, result)).issues).toEqual([])
    expectSidesConsistent(rooms, walls)
  })

  it('轻微不平行（约 1.5°）与端点误差仍配对，且不产生碎片外墙', () => {
    const a = room('a', rect(0, 0, 4, 3))
    const b = room('b', {
      points: [
        [4.12, -0.03],
        [4.2, 3.02],
        [7, 3.02],
        [7, -0.03],
      ],
    })
    const result = inferWallsFromRooms([a, b])
    const { walls } = result
    const shared = walls.filter((wall) => wall.thicknessSource === 'paired')

    expect(shared).toHaveLength(1)
    expect(shared[0]!.thickness).toBeCloseTo(0.16, 2)
    expect(sidesOn(walls, 'a', 2)).toHaveLength(1)
    expect(sidesOn(walls, 'b', 0)).toHaveLength(1)
    expect(walls.every((wall) => wallLength(wall) >= 0.05)).toBe(true)
    expect(validateHomeSpatialModel(modelFromInference([a, b], result)).issues).toEqual([])
  })

  it('夹角超出容差或间距超出墙厚区间时不配对', () => {
    const tilted = inferWallsFromRooms([
      room('a', rect(0, 0, 4, 3)),
      room('b', {
        points: [
          [4.12, 0],
          [4.4, 3],
          [7, 3],
          [7, 0],
        ],
      }),
    ])
    expect(tilted.walls.some((wall) => wall.thicknessSource === 'paired')).toBe(false)

    const far = inferWallsFromRooms([room('a', rect(0, 0, 4, 3)), room('b', rect(4.5, 0, 7, 3))])
    expect(far.walls.some((wall) => wall.thicknessSource === 'paired')).toBe(false)
  })

  it('边界重合（旧的中心线标注）生成 coincident 墙，厚度为假设值', () => {
    const { walls } = inferWallsFromRooms(
      [room('a', rect(0, 0, 4, 3)), room('b', rect(4, 0, 7, 3))],
      { exteriorThickness: 0.18 },
    )
    const coincident = walls.filter((wall) => wall.thicknessSource === 'coincident')
    expect(coincident).toHaveLength(1)
    expect(coincident[0]!.thickness).toBe(0.18)
    expect(coincident[0]!.start[0]).toBeCloseTo(4, 9)
  })

  it('结果确定：同输入同输出，输入顺序不影响墙段 ID 与几何', () => {
    const rooms = [
      room('big', rect(0, 0, 6, 3)),
      room('left', rect(0, 3.12, 2.9, 6)),
      room('right', rect(3.02, 3.12, 6, 6)),
    ]
    const first = inferWallsFromRooms(rooms)
    const second = inferWallsFromRooms(rooms)
    const shuffled = inferWallsFromRooms([rooms[2]!, rooms[0]!, rooms[1]!])
    const byId = (walls: InferredWallSegment[]) => [...walls].sort((a, b) => (a.id < b.id ? -1 : 1))

    expect(second.walls).toEqual(first.walls)
    expect(byId(shuffled.walls)).toEqual(byId(first.walls))
    expect(new Set(first.walls.map((wall) => wall.id)).size).toBe(first.walls.length)
  })

  it('模拟真实标注：8 个房间、相邻边间距 0.12–0.13 m、带端点抖动', () => {
    // 参照常见两居室布局自行构造：南侧阳台 + 客厅 / 主卧，中部走廊，北侧厨房 / 卫生间 / 次卧 / 书房。
    let seed = 7
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return (seed / 2147483648 - 0.5) * 0.016 // ±0.008 m
    }
    const gaps = [0.12, 0.125, 0.13, 0.122, 0.128, 0.13, 0.12, 0.126]
    let gapIndex = 0
    const nextGap = () => gaps[gapIndex++ % gaps.length]!
    // 中心线坐标 → 两侧内表面坐标
    const split = (center: number) => {
      const half = nextGap() / 2
      return [center - half, center + half] as const
    }
    const [livingEast, masterWest] = split(5.6)
    const [balconyNorth, livingSouth] = split(0)
    const [lowerNorth, hallSouth] = split(4.2)
    const [hallNorth, upperSouth] = split(5.4)
    const [kitchenEast, bathWest] = split(2.8)
    const [bathEast, bed2West] = split(4.6)
    const [bed2East, studyWest] = split(7.4)
    const jittered = (polygon: Polygon2D): Polygon2D => ({
      points: polygon.points.map(([x, z]) => [x + jitter(), z + jitter()] as Vec2),
    })
    const rooms = [
      room('balcony', jittered(rect(0.1, -1.4, livingEast, balconyNorth))),
      room('living', jittered(rect(0.1, livingSouth, livingEast, lowerNorth))),
      room('master', jittered(rect(masterWest, livingSouth, 9.5, lowerNorth))),
      room('hall', jittered(rect(0.1, hallSouth, 9.5, hallNorth))),
      room('kitchen', jittered(rect(0.1, upperSouth, kitchenEast, 8.3))),
      room('bath', jittered(rect(bathWest, upperSouth, bathEast, 8.3))),
      room('bedroom2', jittered(rect(bed2West, upperSouth, bed2East, 8.3))),
      room('study', jittered(rect(studyWest, upperSouth, 9.5, 8.3))),
    ]

    const result = inferWallsFromRooms(rooms)
    const { walls } = result

    expect(pairedRoomIds(walls)).toEqual(
      [
        'balcony|living',
        'living|master',
        'hall|living',
        'hall|master',
        'hall|kitchen',
        'bath|hall',
        'bedroom2|hall',
        'hall|study',
        'bath|kitchen',
        'bath|bedroom2',
        'bedroom2|study',
      ].sort(),
    )

    for (const wall of walls.filter((candidate) => candidate.thicknessSource === 'paired')) {
      expect(wall.thickness).toBeGreaterThan(0.1)
      expect(wall.thickness).toBeLessThan(0.15)
    }

    // 走廊北侧被 4 个房间切分，接头空隙全部并入共享墙
    expect(sidesOn(walls, 'hall', 1).map(({ wall }) => wall.thicknessSource)).toEqual([
      'paired',
      'paired',
      'paired',
      'paired',
    ])
    expect(walls.every((wall) => wallLength(wall) >= 0.05)).toBe(true)
    expectSidesConsistent(rooms, walls)
    expect(validateHomeSpatialModel(modelFromInference(rooms, result)).issues).toEqual([])
  })
})

describe('门窗区间换算到墙段', () => {
  const rooms = [
    room('big', rect(0, 0, 6, 3)),
    room('left', rect(0, 3.12, 2.9, 6)),
    room('right', rect(3.02, 3.12, 6, 6)),
  ]
  const { walls } = inferWallsFromRooms(rooms)
  const big = rooms[0]!

  it('落在单个墙段内时返回沿墙偏移', () => {
    // big 第 1 条边 (0,3)→(6,3)；共享墙方向由 ID 较小的 big 决定，与该边同向
    const binding = bindRoomEdgeSpanToWall(walls, big, 1, 4, 4.9)
    expect(binding.status).toBe('bound')
    if (binding.status !== 'bound') return
    const wall = walls.find((candidate) => candidate.id === binding.wallId)!
    expect(wallRoomSides(wall).map((side) => side.roomId)).toContain('right')
    expect(binding.width).toBeCloseTo(0.9, 9)
    const startX =
      wall.start[0] + ((wall.end[0] - wall.start[0]) / wallLength(wall)) * binding.offset
    expect(startX).toBeCloseTo(4, 9)
  })

  it('跨越 T 型接头的区间返回 spans_multiple', () => {
    const binding = bindRoomEdgeSpanToWall(walls, big, 1, 2.6, 3.5)
    expect(binding.status).toBe('spans_multiple')
    if (binding.status === 'spans_multiple') expect(binding.wallIds).toHaveLength(2)
  })

  it('超出房间边时返回 outside', () => {
    expect(bindRoomEdgeSpanToWall(walls, big, 1, 5.5, 6.5).status).toBe('outside')
    expect(bindRoomEdgeSpanToWall(walls, big, 9, 0, 1).status).toBe('outside')
  })
})

describe('外墙改厚度', () => {
  it('保持内表面不动，中心线向室外平移', () => {
    const { walls } = inferWallsFromRooms([room('a', rect(0, 0, 4, 3))])
    const south = walls.find((wall) => (wall.sides[0] as WallRoomSide).edgeIndex === 3)!
    const thicker = withWallThickness({ ...south, height: 2.8 }, 0.3)
    expect(thicker.thickness).toBe(0.3)
    expect(thicker.start[1]).toBeCloseTo(-0.15, 9)
    expect(thicker.end[1]).toBeCloseTo(-0.15, 9)
  })
})

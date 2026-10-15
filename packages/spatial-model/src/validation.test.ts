import { describe, expect, it } from 'vitest'
import type { Vec2 } from './geometry'
import { sampleApartment } from './fixtures/sample-apartment'
import { EXTERIOR_SPACE_ID, type HomeSpatialModel } from './model'
import { polygonArea } from './geometry'
import { isPolygonInsidePolygon, polygonWinding } from './polygon-ops'
import { validateHomeSpatialModel } from './validation'

function clone(model: HomeSpatialModel): HomeSpatialModel {
  return structuredClone(model)
}

function errorCodes(model: HomeSpatialModel) {
  return validateHomeSpatialModel(model)
    .issues.filter((issue) => issue.severity === 'error')
    .map((issue) => issue.code)
}

describe('示例户型（内表面约定）', () => {
  const floor = sampleApartment.floors[0]!

  it('通过新校验', () => {
    expect(validateHomeSpatialModel(sampleApartment)).toEqual({ valid: true, issues: [] })
  })

  it('客厅仍存在且净尺寸合理，所有房间俯视逆时针', () => {
    const living = floor.rooms.find((room) => room.id === 'room-living')!
    expect(living.type).toBe('living')
    expect(polygonArea(living.boundary)).toBeCloseTo(6.64 * 4.64, 6)

    for (const room of floor.rooms) {
      expect(polygonWinding(room.boundary)).toBe('ccw')
      for (const zone of room.zones) {
        expect(isPolygonInsidePolygon(zone.boundary, room.boundary)).toBe(true)
      }
    }
  })

  it('墙体由推导生成：内墙实测 0.12 m，外墙假设 0.2 m，入户门连接室外', () => {
    const paired = floor.walls.filter((wall) => wall.thicknessSource === 'paired')
    const exterior = floor.walls.filter((wall) => wall.thicknessSource === 'exterior')
    expect(paired.length).toBeGreaterThan(0)
    expect(exterior.length).toBeGreaterThan(0)
    paired.forEach((wall) => expect(wall.thickness).toBeCloseTo(0.12, 9))
    exterior.forEach((wall) => expect(wall.thickness).toBe(0.2))

    expect(floor.connections).toContainEqual(
      expect.objectContaining({
        fromRoomId: 'room-hall',
        toRoomId: EXTERIOR_SPACE_ID,
        openingId: 'door-entry',
      }),
    )
    expect(
      floor.connections.filter((connection) => connection.toRoomId === 'room-hall'),
    ).toHaveLength(5)
  })
})

describe('几何校验', () => {
  it('NaN 坐标被拒绝', () => {
    const roomNaN = clone(sampleApartment)
    const points = roomNaN.floors[0]!.rooms[0]!.boundary.points
    points[1] = [Number.NaN, points[1]![1]]
    expect(errorCodes(roomNaN)).toContain('geometry.non_finite')

    const wallNaN = clone(sampleApartment)
    const wall = wallNaN.floors[0]!.walls[0]!
    wall.end = [Number.NaN, Number.NaN] as Vec2
    expect(errorCodes(wallNaN)).toContain('geometry.non_finite')

    const anchorNaN = clone(sampleApartment)
    const anchor = anchorNaN.floors[0]!.utilityAnchors[0]!
    anchor.position = [0, Number.POSITIVE_INFINITY, 1]
    expect(errorCodes(anchorNaN)).toContain('geometry.non_finite')

    const confidenceNaN = clone(sampleApartment)
    confidenceNaN.floors[0]!.provenance = { sourceKind: 'fixture', confidence: Number.NaN }
    expect(errorCodes(confidenceNaN)).toContain('provenance.confidence.out_of_range')
  })

  it('房间绕向必须为俯视逆时针', () => {
    const model = clone(sampleApartment)
    const room = model.floors[0]!.rooms[0]!
    room.boundary.points.reverse()
    expect(errorCodes(model)).toContain('room.winding')
  })

  it('每条房间边都必须被墙段覆盖', () => {
    const model = clone(sampleApartment)
    const floor = model.floors[0]!
    const removedId = floor.walls.find((wall) => wall.thicknessSource === 'exterior')!.id
    floor.walls = floor.walls.filter((wall) => wall.id !== removedId)
    floor.openings = floor.openings.filter((opening) => opening.wallId !== removedId)
    floor.rooms.forEach((room) => {
      room.wallIds = room.wallIds.filter((id) => id !== removedId)
      room.openingIds = room.openingIds.filter((id) =>
        floor.openings.some((opening) => opening.id === id),
      )
    })
    floor.connections = floor.connections.filter((connection) =>
      floor.openings.some((opening) => opening.id === connection.openingId),
    )
    expect(errorCodes(model)).toEqual(['room.edge_uncovered'])
  })

  it('旧数据（无 sides）按几何判断覆盖', () => {
    const model = clone(sampleApartment)
    model.floors[0]!.walls.forEach((wall) => {
      delete wall.sides
      delete wall.thicknessSource
    })
    expect(errorCodes(model)).toEqual([])
  })

  it('开口引用的墙必须存在且不越界', () => {
    const missing = clone(sampleApartment)
    missing.floors[0]!.openings[0]!.wallId = 'wall-missing'
    expect(errorCodes(missing)).toContain('opening.wall_missing')

    const outside = clone(sampleApartment)
    outside.floors[0]!.openings[0]!.offset = 100
    expect(errorCodes(outside)).toContain('opening.outside_wall')

    const nanOffset = clone(sampleApartment)
    nanOffset.floors[0]!.openings[0]!.offset = Number.NaN
    expect(errorCodes(nanOffset)).toContain('opening.invalid_dimensions')
  })

  it('墙侧引用的房间边必须存在，室外保留 ID 不能用作房间', () => {
    const badSide = clone(sampleApartment)
    const wall = badSide.floors[0]!.walls[0]!
    wall.sides = [
      { kind: 'room', roomId: 'room-ghost', edgeIndex: 0, edgeStart: 0, edgeEnd: 1 },
      wall.sides![1],
    ]
    expect(errorCodes(badSide)).toContain('wall.side_room_edge_missing')

    const reserved = clone(sampleApartment)
    reserved.floors[0]!.rooms[0]!.id = EXTERIOR_SPACE_ID
    expect(errorCodes(reserved)).toContain('room.reserved_id')
  })
})

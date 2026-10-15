import type { Polygon2D, Vec2 } from '../geometry'
import {
  EXTERIOR_SPACE_ID,
  HOME_SPATIAL_MODEL_SCHEMA_VERSION,
  type HomeSpatialModel,
  type Opening,
  type Room,
  type RoomConnection,
  type Wall,
} from '../model'
import {
  bindRoomEdgeSpanToWall,
  inferWallsFromRooms,
  isExteriorWall,
  wallRoomSides,
} from '../wall-inference'

const fixtureProvenance = {
  sourceKind: 'fixture' as const,
  confidence: 1,
  sourceId: 'sample-apartment-v2',
}

const CEILING_HEIGHT = 2.8
const EXTERIOR_WALL_THICKNESS = 0.2
const INTERIOR_WALL_THICKNESS = 0.12

/**
 * 示例户型按墙中心线设计：外轮廓 10.8 m × 8.4 m，外墙 0.2 m，内墙 0.12 m。
 * 房间边界取内表面（ADR 0018）：中心线矩形向内收缩半个墙厚。
 *
 * `rect` 生成从 +Y 俯视逆时针的矩形：
 *   边 0 = 西侧（x = x0，+Z 方向），边 1 = 北侧（z = z1），
 *   边 2 = 东侧（x = x1），边 3 = 南侧（z = z0，−X 方向）。
 */
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

const OUTER = { minX: 0, minZ: 0, maxX: 10.8, maxZ: 8.4 }

/** 中心线坐标 → 内表面坐标：外轮廓线收缩半个外墙厚，内墙线收缩半个内墙厚 */
function inset(value: number, towardPositive: boolean, isOuter: boolean) {
  const half = (isOuter ? EXTERIOR_WALL_THICKNESS : INTERIOR_WALL_THICKNESS) / 2
  return towardPositive ? value + half : value - half
}

function innerRect(cx0: number, cz0: number, cx1: number, cz1: number) {
  return rect(
    inset(cx0, true, cx0 === OUTER.minX),
    inset(cz0, true, cz0 === OUTER.minZ),
    inset(cx1, false, cx1 === OUTER.maxX),
    inset(cz1, false, cz1 === OUTER.maxZ),
  )
}

const roomDefinitions: Array<Omit<Room, 'wallIds' | 'openingIds'>> = [
  {
    id: 'room-living',
    name: '客餐厅',
    type: 'living',
    boundary: innerRect(0, 0, 6.8, 4.8),
    ceilingHeight: CEILING_HEIGHT,
    zones: [
      {
        id: 'zone-living',
        name: '会客区',
        function: 'living',
        boundary: rect(0.1, 0.1, 4.3, 4.74),
      },
      {
        id: 'zone-dining',
        name: '餐区',
        function: 'dining',
        boundary: rect(4.3, 0.1, 6.74, 4.74),
      },
    ],
  },
  {
    id: 'room-master',
    name: '主卧',
    type: 'bedroom',
    boundary: innerRect(6.8, 0, 10.8, 4.8),
    ceilingHeight: CEILING_HEIGHT,
    zones: [],
  },
  {
    id: 'room-hall',
    name: '走廊',
    type: 'hallway',
    boundary: innerRect(0, 4.8, 10.8, 5.8),
    ceilingHeight: CEILING_HEIGHT,
    zones: [],
  },
  {
    id: 'room-kitchen',
    name: '厨房',
    type: 'kitchen',
    boundary: innerRect(0, 5.8, 3.6, 8.4),
    ceilingHeight: CEILING_HEIGHT,
    zones: [],
  },
  {
    id: 'room-bath',
    name: '卫生间',
    type: 'bathroom',
    boundary: innerRect(3.6, 5.8, 5.8, 8.4),
    ceilingHeight: CEILING_HEIGHT,
    zones: [],
  },
  {
    id: 'room-bedroom2',
    name: '次卧',
    type: 'bedroom',
    boundary: innerRect(5.8, 5.8, 10.8, 8.4),
    ceilingHeight: CEILING_HEIGHT,
    zones: [],
  },
]

/** 门窗按“房间边 + 洞口中心点”描述，由推导出的墙段换算 wallId 与沿墙偏移 */
interface OpeningDefinition extends Omit<Opening, 'wallId' | 'offset'> {
  roomId: string
  edgeIndex: number
  center: Vec2
}

const openingDefinitions: OpeningDefinition[] = [
  {
    id: 'window-living',
    roomId: 'room-living',
    edgeIndex: 3,
    center: [2.4, 0.1],
    kind: 'window',
    width: 3.2,
    height: 2,
    sillHeight: 0.55,
  },
  {
    id: 'window-master',
    roomId: 'room-master',
    edgeIndex: 3,
    center: [8.6, 0.1],
    kind: 'window',
    width: 2.4,
    height: 1.8,
    sillHeight: 0.7,
  },
  {
    id: 'opening-living-hall',
    roomId: 'room-living',
    edgeIndex: 1,
    center: [3.2, 4.74],
    kind: 'opening',
    width: 1.6,
    height: 2.4,
    sillHeight: 0,
  },
  {
    id: 'door-master-hall',
    roomId: 'room-master',
    edgeIndex: 1,
    center: [8.55, 4.74],
    kind: 'door',
    width: 0.9,
    height: 2.1,
    swing: 'right',
  },
  {
    id: 'door-kitchen-hall',
    roomId: 'room-kitchen',
    edgeIndex: 3,
    center: [1.75, 5.86],
    kind: 'door',
    width: 0.9,
    height: 2.1,
    swing: 'sliding',
  },
  {
    id: 'door-bath-hall',
    roomId: 'room-bath',
    edgeIndex: 3,
    center: [4.6, 5.86],
    kind: 'door',
    width: 0.8,
    height: 2.1,
    swing: 'left',
  },
  {
    id: 'door-bedroom2-hall',
    roomId: 'room-bedroom2',
    edgeIndex: 3,
    center: [7.45, 5.86],
    kind: 'door',
    width: 0.9,
    height: 2.1,
    swing: 'right',
  },
  // 走廊净宽 0.88 m，入户门取 0.8 m。
  {
    id: 'door-entry',
    roomId: 'room-hall',
    edgeIndex: 0,
    center: [0.1, 5.3],
    kind: 'door',
    width: 0.8,
    height: 2.1,
    swing: 'right',
  },
  {
    id: 'window-kitchen',
    roomId: 'room-kitchen',
    edgeIndex: 1,
    center: [1.9, 8.3],
    kind: 'window',
    width: 1.8,
    height: 1.4,
    sillHeight: 1,
  },
  {
    id: 'window-bedroom2',
    roomId: 'room-bedroom2',
    edgeIndex: 1,
    center: [8.6, 8.3],
    kind: 'window',
    width: 2.4,
    height: 1.8,
    sillHeight: 0.7,
  },
]

function buildSampleFloor() {
  const inference = inferWallsFromRooms(roomDefinitions, {
    exteriorThickness: EXTERIOR_WALL_THICKNESS,
    idPrefix: 'wall',
  })
  const walls: Wall[] = inference.walls.map((wall) => ({ ...wall, height: CEILING_HEIGHT }))
  const rooms: Room[] = roomDefinitions.map((room) => ({
    ...room,
    wallIds: inference.roomWallIds.get(room.id) ?? [],
    openingIds: [],
  }))
  const roomById = new Map(rooms.map((room) => [room.id, room]))
  const openings: Opening[] = []
  const connections: RoomConnection[] = []

  for (const { roomId, edgeIndex, center, ...opening } of openingDefinitions) {
    const room = roomById.get(roomId)!
    const start = room.boundary.points[edgeIndex]!
    const end = room.boundary.points[(edgeIndex + 1) % room.boundary.points.length]!
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    const along =
      ((center[0] - start[0]) * (end[0] - start[0]) +
        (center[1] - start[1]) * (end[1] - start[1])) /
      length
    const binding = bindRoomEdgeSpanToWall(
      walls,
      room,
      edgeIndex,
      along - opening.width / 2,
      along + opening.width / 2,
    )

    if (binding.status !== 'bound') {
      throw new Error('示例户型开口无法绑定到墙段：' + opening.id)
    }

    openings.push({ ...opening, wallId: binding.wallId, offset: binding.offset })

    const wall = walls.find((candidate) => candidate.id === binding.wallId)
    const roomSides = wallRoomSides(wall)

    for (const side of roomSides) roomById.get(side.roomId)?.openingIds.push(opening.id)

    if (opening.kind === 'window') continue

    const other = roomSides.find((side) => side.roomId !== roomId)

    if (other) {
      connections.push({
        id: 'connection-' + opening.id,
        fromRoomId: roomId,
        toRoomId: other.roomId,
        kind: opening.kind,
        openingId: opening.id,
      })
    } else if (opening.kind === 'door' && isExteriorWall(wall)) {
      connections.push({
        id: 'connection-' + opening.id,
        fromRoomId: roomId,
        toRoomId: EXTERIOR_SPACE_ID,
        kind: 'door',
        openingId: opening.id,
      })
    }
  }

  return { walls, rooms, openings, connections }
}

const sampleFloor = buildSampleFloor()

export const sampleApartment: HomeSpatialModel = {
  schemaVersion: HOME_SPATIAL_MODEL_SCHEMA_VERSION,
  id: 'home-sample-001',
  name: 'HomeScape 示例住宅',
  unit: 'meter',
  coordinateSystem: 'right-handed-y-up',
  provenance: fixtureProvenance,
  metadata: {
    grossArea: 90.72,
    sourceLabel: '用于 HomeSpatialModel 与渲染调试的真实尺度样例',
  },
  floors: [
    {
      id: 'floor-1',
      name: '一层',
      elevation: 0,
      provenance: fixtureProvenance,
      walls: sampleFloor.walls,
      openings: sampleFloor.openings,
      rooms: sampleFloor.rooms,
      structuralElements: [
        {
          id: 'column-living',
          kind: 'column',
          center: [0.35, 4.45],
          size: [0.35, 0.35],
          height: CEILING_HEIGHT,
          rotation: 0,
        },
        {
          id: 'beam-living',
          kind: 'beam',
          start: [0.1, 4.55],
          end: [6.74, 4.55],
          width: 0.22,
          height: 0.35,
          bottomElevation: 2.45,
        },
      ],
      utilityAnchors: [
        {
          id: 'anchor-tv-power',
          kind: 'electrical',
          position: [0.15, 0.45, 2.2],
          roomId: 'room-living',
          metadata: { voltage: 220, usage: 'tv-wall' },
        },
        {
          id: 'anchor-kitchen-drain',
          kind: 'drain',
          position: [0.45, 0.1, 7.9],
          roomId: 'room-kitchen',
        },
      ],
      connections: sampleFloor.connections,
    },
  ],
}

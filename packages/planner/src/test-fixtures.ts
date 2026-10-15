// 仅供单元测试使用的最小空间 / Catalog 夹具（不从 index 导出）。
import { InMemoryCatalog, type CatalogAsset } from '@homescape/catalog'
import {
  HOME_SPATIAL_MODEL_SCHEMA_VERSION,
  inferWallsFromRooms,
  type HomeSpatialModel,
  type Polygon2D,
  type Vec2,
  type Wall,
} from '@homescape/spatial-model'

/**
 * 单房间模型：边界为墙体内表面（从 +Y 俯视逆时针），墙由 inferWallsFromRooms
 * 推导（全部为外墙，中心线向外偏移半个墙厚）。
 */
export function singleRoomModel(boundary: Polygon2D, id = 'model-single-room'): HomeSpatialModel {
  const inference = inferWallsFromRooms([{ id: 'room-1', boundary }])
  const walls: Wall[] = inference.walls.map((wall) => ({ ...wall, height: 2.8 }))

  return {
    schemaVersion: HOME_SPATIAL_MODEL_SCHEMA_VERSION,
    id,
    name: 'Single Room',
    unit: 'meter',
    coordinateSystem: 'right-handed-y-up',
    floors: [
      {
        id: 'floor-1',
        name: '1F',
        elevation: 0,
        rooms: [
          {
            id: 'room-1',
            name: '客厅',
            type: 'living',
            boundary,
            ceilingHeight: 2.8,
            wallIds: inference.roomWallIds.get('room-1') ?? [],
            openingIds: [],
            zones: [],
          },
        ],
        walls,
        openings: [],
        structuralElements: [],
        utilityAnchors: [],
        connections: [],
      },
    ],
  }
}

/** 生成一个绕 center 旋转 angle 的正方形房间（墙不与坐标轴对齐），从 +Y 俯视逆时针。 */
export function rotatedSquareModel(
  angle: number,
  size = 6,
  center: Vec2 = [5, 5],
): HomeSpatialModel {
  const half = size / 2
  // (x, z) 上 −h,−h → −h,h → h,h → h,−h：鞋带面积为负，即从 +Y 俯视逆时针。
  const local: Vec2[] = [
    [-half, -half],
    [-half, half],
    [half, half],
    [half, -half],
  ]
  // 只为构造倾斜多边形，旋转保持绕向。
  const points = local.map(([x, z]): Vec2 => [
    center[0] + x * Math.cos(angle) - z * Math.sin(angle),
    center[1] + x * Math.sin(angle) + z * Math.cos(angle),
  ])

  return singleRoomModel({ points }, 'model-rotated-square')
}

export const wallSofa: CatalogAsset = {
  id: 'asset-wall-sofa',
  sku: 'SKU-WALL-SOFA',
  name: 'Wall Sofa',
  category: 'sofa',
  dimensions: { width: 2.2, height: 0.8, depth: 0.9 },
  placement: {
    anchors: ['wall'],
    wallClearance: 0.05,
    collisionPadding: 0.02,
    allowRotation: true,
  },
  tags: [],
  active: true,
}

export function testCatalog() {
  return new InMemoryCatalog([wallSofa])
}

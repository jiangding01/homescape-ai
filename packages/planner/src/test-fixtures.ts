// 仅供单元测试使用的最小空间 / Catalog 夹具（不从 index 导出）。
import { InMemoryCatalog, type CatalogAsset } from '@homescape/catalog'
import type { HomeSpatialModel, Vec2, Wall } from '@homescape/spatial-model'

/** 生成一个绕 center 旋转 angle 的正方形房间（墙不与坐标轴对齐）。 */
export function rotatedSquareModel(
  angle: number,
  size = 6,
  center: Vec2 = [5, 5],
): HomeSpatialModel {
  const half = size / 2
  const local: Vec2[] = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]
  // 只为构造倾斜多边形，方向约定与被测代码无关。
  const points = local.map(([x, z]): Vec2 => [
    center[0] + x * Math.cos(angle) - z * Math.sin(angle),
    center[1] + x * Math.sin(angle) + z * Math.cos(angle),
  ])
  const walls: Wall[] = points.map((start, index) => ({
    id: 'wall-' + index,
    start,
    end: points[(index + 1) % points.length] as Vec2,
    thickness: 0.2,
    height: 2.8,
  }))

  return {
    schemaVersion: '0.1.0',
    id: 'model-rotated-square',
    name: 'Rotated Square',
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
            boundary: { points },
            ceilingHeight: 2.8,
            wallIds: walls.map((wall) => wall.id),
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

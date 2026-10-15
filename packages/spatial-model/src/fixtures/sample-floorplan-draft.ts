import type { FloorPlanDraft } from '../floorplan-draft'

/**
 * 演示草稿（对应 apps/web/public/floorplan-demo.svg）。
 *
 * 房间边界按墙体内表面描点（ADR 0018）：图中墙线为中心线、线宽 12 px，标定为
 * 100 px/m，因此每条房间边距墙中心线 6 px，相邻房间之间留 12 px ≈ 0.12 m 的墙厚间隙，
 * 导入时成对推导出实测厚度的共享墙；外墙一侧按假设厚度 0.12 m 外移半墙厚，
 * 恰好回到图中外墙中心线。门窗偏移相应从内表面角点量起。
 */
export const sampleFloorPlanDraft: FloorPlanDraft = {
  schemaVersion: '0.1.0',
  source: {
    kind: 'floorplan_image',
    widthPx: 1080,
    heightPx: 840,
    sourceLabel: '真实户型导入流程演示稿',
  },
  calibration: {
    startPx: [80, 760],
    endPx: [680, 760],
    realDistanceMeters: 6,
  },
  assumptions: {
    wallThicknessMeters: 0.12,
    ceilingHeightMeters: 2.8,
    wallThicknessConfirmed: false,
    ceilingHeightConfirmed: true,
  },
  rooms: [
    {
      id: 'import-room-living',
      name: '客餐厅',
      type: 'living',
      boundaryPx: [
        [86, 426],
        [420, 426],
        [674, 426],
        [674, 754],
        [86, 754],
      ],
      confidence: 0.96,
    },
    {
      id: 'import-room-bedroom',
      name: '卧室',
      type: 'bedroom',
      boundaryPx: [
        [686, 426],
        [994, 426],
        [994, 754],
        [686, 754],
      ],
      confidence: 0.92,
    },
    {
      id: 'import-room-kitchen',
      name: '厨房',
      boundaryPx: [
        [86, 126],
        [414, 126],
        [414, 414],
        [86, 414],
      ],
      confidence: 0.66,
    },
    {
      id: 'import-room-hall',
      name: '走廊',
      type: 'hallway',
      boundaryPx: [
        [426, 126],
        [674, 126],
        [674, 414],
        [426, 414],
      ],
      confidence: 0.88,
    },
    {
      id: 'import-room-bedroom-2',
      name: '次卧',
      type: 'bedroom',
      boundaryPx: [
        [686, 126],
        [994, 126],
        [994, 414],
        [686, 414],
      ],
      confidence: 0.91,
    },
  ],
  openings: [
    {
      id: 'import-opening-living-hall',
      roomId: 'import-room-living',
      edgeIndex: 1,
      kind: 'opening',
      offsetPx: 50,
      widthPx: 120,
      heightMeters: 2.4,
      sillHeightMeters: 0,
      confidence: 0.94,
    },
    {
      id: 'import-door-kitchen-hall',
      roomId: 'import-room-kitchen',
      edgeIndex: 1,
      kind: 'door',
      offsetPx: 169,
      widthPx: 90,
      heightMeters: 2.1,
      swing: 'sliding',
      confidence: 0.8,
    },
    {
      id: 'import-door-bedroom2-hall',
      roomId: 'import-room-bedroom-2',
      edgeIndex: 3,
      kind: 'door',
      offsetPx: 99,
      widthPx: 90,
      heightMeters: 2.1,
      swing: 'right',
      confidence: 0.72,
    },
    {
      id: 'import-window-living',
      roomId: 'import-room-living',
      edgeIndex: 3,
      kind: 'window',
      offsetPx: 144,
      widthPx: 240,
      heightMeters: 1.8,
      sillHeightMeters: 0.7,
      confidence: 0.95,
    },
    {
      id: 'import-window-bedroom',
      roomId: 'import-room-bedroom',
      edgeIndex: 2,
      kind: 'window',
      offsetPx: 49,
      widthPx: 210,
      heightMeters: 1.8,
      sillHeightMeters: 0.7,
      confidence: 0.93,
    },
  ],
}

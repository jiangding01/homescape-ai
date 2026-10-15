import { describe, expect, it } from 'vitest'
import {
  getFloorPlanCalibrationAxisError,
  isFloorPlanDraft,
  type FloorPlanCalibration,
  type FloorPlanDraft,
} from './floorplan-draft'
import {
  FloorPlanDraftImporter,
  resolveFloorPlanDraftScale,
} from './floorplan-draft-importer'
import { polygonArea } from './geometry'
import { EXTERIOR_SPACE_ID, HOME_SPATIAL_MODEL_SCHEMA_VERSION, isExteriorConnection } from './model'
import { polygonWinding } from './polygon-ops'
import { buildRoomGraph } from './room-graph'
import type { SpatialImportContext } from './importer'
import {
  applySpatialCorrection,
  canFinalizeSpatialReview,
  createSpatialReviewSession,
} from './review'
import { sampleFloorPlanDraft } from './fixtures/sample-floorplan-draft'

// 非等比缩放：横向 60 px/m，纵向 70 px/m
const SX = 60
const SY = 70

const calibrationX: FloorPlanCalibration = {
  startPx: [100, 700],
  endPx: [400, 700], // 300 px = 5 m → 60 px/m
  realDistanceMeters: 5,
}

const calibrationY: FloorPlanCalibration = {
  startPx: [900, 100],
  endPx: [900, 450], // 350 px = 5 m → 70 px/m
  realDistanceMeters: 5,
}

const context: SpatialImportContext = {
  projectId: 'test',
  projectName: '比例尺测试',
  sourceKind: 'floorplan_image',
}

// 4 m × 3 m 的矩形房间（按真实横纵比例绘制）
function rectangleDraft(
  overrides: Partial<FloorPlanDraft> = {},
): FloorPlanDraft {
  return {
    schemaVersion: '0.1.0',
    source: {
      kind: 'floorplan_image',
      widthPx: 1000,
      heightPx: 800,
      sourceLabel: 'anisotropic-rectangle',
    },
    calibration: calibrationX,
    assumptions: {
      wallThicknessMeters: 0.2,
      ceilingHeightMeters: 2.8,
      wallThicknessConfirmed: true,
      ceilingHeightConfirmed: true,
    },
    rooms: [
      {
        id: 'room-a',
        name: '卧室',
        type: 'bedroom',
        boundaryPx: [
          [100, 100],
          [100 + 4 * SX, 100],
          [100 + 4 * SX, 100 + 3 * SY],
          [100, 100 + 3 * SY],
        ],
      },
    ],
    openings: [
      {
        id: 'opening-top',
        roomId: 'room-a',
        edgeIndex: 0, // 水平边
        kind: 'window',
        offsetPx: 1 * SX,
        widthPx: 1 * SX,
        heightMeters: 1.5,
        sillHeightMeters: 0.9,
      },
      {
        id: 'opening-right',
        roomId: 'room-a',
        edgeIndex: 1, // 竖直边
        kind: 'door',
        offsetPx: 0.5 * SY,
        widthPx: 1 * SY,
        heightMeters: 2.1,
      },
    ],
    ...overrides,
  }
}

function roomExtent(points: ReadonlyArray<readonly [number, number]>) {
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  return {
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...zs) - Math.min(...zs),
  }
}

async function importDraft(draft: FloorPlanDraft) {
  return new FloorPlanDraftImporter().parse(draft, context)
}

function calibrationIssueIds(
  result: Awaited<ReturnType<typeof importDraft>>,
) {
  return result.unresolved
    .map((issue) => issue.id)
    .filter((id) => id.startsWith('issue-calibration'))
}

describe('FloorPlanDraft 双轴标定导入', () => {
  it('单标定按等比换算（与旧行为一致）', async () => {
    const result = await importDraft(rectangleDraft())
    const room = result.model.floors[0]!.rooms[0]!
    const { width, depth } = roomExtent(room.boundary.points)

    expect(width).toBeCloseTo(4, 6)
    // 纵向仍按 60 px/m 换算：210 px → 3.5 m，面积偏大约 16.7%
    expect(depth).toBeCloseTo(3.5, 6)
    expect(polygonArea(room.boundary)).toBeCloseTo(14, 6)
    expect(resolveFloorPlanDraftScale(rectangleDraft())).toEqual({
      pixelsPerMeterX: SX,
      pixelsPerMeterY: SX,
    })
  })

  it('双标定按 sx / sy 分轴换算房间与开口', async () => {
    const draft = rectangleDraft({ calibrationY })
    expect(isFloorPlanDraft(draft)).toBe(true)
    expect(resolveFloorPlanDraftScale(draft)).toEqual({
      pixelsPerMeterX: SX,
      pixelsPerMeterY: SY,
    })

    const result = await importDraft(draft)
    const floor = result.model.floors[0]!
    const room = floor.rooms[0]!
    const { width, depth } = roomExtent(room.boundary.points)

    expect(width).toBeCloseTo(4, 6)
    expect(depth).toBeCloseTo(3, 6)
    expect(polygonArea(room.boundary)).toBeCloseTo(12, 6)

    const top = floor.openings.find((opening) => opening.id === 'opening-top')
    const right = floor.openings.find(
      (opening) => opening.id === 'opening-right',
    )
    // 偏移沿外墙中心线、从墙起点量起；外角封闭使外墙比房间边多伸出
    // 半墙厚（中心线交点）+ 半墙厚（对方外表面）= 0.2 m。
    const cornerExtension = 0.2
    expect(top?.width).toBeCloseTo(1, 6)
    expect(top?.offset).toBeCloseTo(1 + cornerExtension, 6)
    expect(right?.width).toBeCloseTo(1, 6)
    expect(right?.offset).toBeCloseTo(0.5 + cornerExtension, 6)
    expect(result.validation.valid).toBe(true)
    expect(calibrationIssueIds(result)).toEqual([])
  })
})

describe('旧格式兼容', () => {
  it('旧 JSON（无 basis / calibrationY）仍可校验与导入且不阻断', async () => {
    const legacy = JSON.parse(JSON.stringify(sampleFloorPlanDraft)) as unknown
    expect(isFloorPlanDraft(legacy)).toBe(true)

    const result = await new FloorPlanDraftImporter().parse(
      legacy as FloorPlanDraft,
      context,
    )
    expect(calibrationIssueIds(result)).toEqual([])
  })

  it('仅单条标定时不限制方向（旧数据可沿竖直方向标定）', async () => {
    const draft = rectangleDraft({ calibration: calibrationY })
    expect(isFloorPlanDraft(draft)).toBe(true)

    const result = await importDraft(draft)
    const room = result.model.floors[0]!.rooms[0]!
    // 等比 70 px/m：240 px → 3.4286 m
    expect(roomExtent(room.boundary.points).width).toBeCloseTo(240 / SY, 6)
  })

  it('非法 basis 不通过校验', () => {
    const draft = rectangleDraft({
      calibration: { ...calibrationX, basis: 'guess' as never },
    })
    expect(isFloorPlanDraft(draft)).toBe(false)
  })
})

describe('比例尺来源 basis', () => {
  it('assumed 比例尺生成阻断 Finalize 的问题，确认后可 Finalize', async () => {
    const result = await importDraft(
      rectangleDraft({ calibration: { ...calibrationX, basis: 'assumed' } }),
    )
    expect(calibrationIssueIds(result)).toEqual([
      'issue-calibration-assumption',
    ])
    const issue = result.unresolved.find(
      (candidate) => candidate.id === 'issue-calibration-assumption',
    )!
    expect(issue.kind).toBe('missing_dimension')
    expect(issue.requiresHumanReview).toBe(true)
    expect(issue.message).toContain('60.00 px/m')

    const session = createSpatialReviewSession(result)
    expect(canFinalizeSpatialReview(session)).toBe(false)

    const resolved = applySpatialCorrection(session, {
      type: 'resolve_issue',
      issueId: 'issue-calibration-assumption',
    })
    expect(canFinalizeSpatialReview(resolved)).toBe(true)
  })

  it.each(['annotated', 'extracted', 'structured'] as const)(
    '%s 比例尺不阻断 Finalize',
    async (basis) => {
      const result = await importDraft(
        rectangleDraft({ calibration: { ...calibrationX, basis } }),
      )
      expect(calibrationIssueIds(result)).toEqual([])
      expect(canFinalizeSpatialReview(createSpatialReviewSession(result))).toBe(
        true,
      )
    },
  )

  it('双标定按轴分别生成 assumed 问题', async () => {
    const result = await importDraft(
      rectangleDraft({
        calibration: { ...calibrationX, basis: 'annotated' },
        calibrationY: { ...calibrationY, basis: 'assumed' },
      }),
    )
    expect(calibrationIssueIds(result)).toEqual([
      'issue-calibration-y-assumption',
    ])
    expect(canFinalizeSpatialReview(createSpatialReviewSession(result))).toBe(
      false,
    )
  })
})

describe('非轴向标定', () => {
  it('轴向判定：横向 |dx| ≥ |dy|，纵向 |dy| ≥ |dx|', () => {
    expect(getFloorPlanCalibrationAxisError(calibrationX, 'x')).toBeUndefined()
    expect(getFloorPlanCalibrationAxisError(calibrationY, 'y')).toBeUndefined()
    expect(getFloorPlanCalibrationAxisError(calibrationY, 'x')).toBeDefined()
    expect(getFloorPlanCalibrationAxisError(calibrationX, 'y')).toBeDefined()
    // 45° 恰好满足两侧条件（|dx| = |dy|）
    const diagonal = { startPx: [0, 0], endPx: [10, 10] } as const
    expect(getFloorPlanCalibrationAxisError(diagonal, 'x')).toBeUndefined()
    expect(getFloorPlanCalibrationAxisError(diagonal, 'y')).toBeUndefined()
  })

  it('双标定时横纵方向写反视为无效 Draft，导入直接报错', async () => {
    const swapped = rectangleDraft({
      calibration: calibrationY,
      calibrationY: calibrationX,
    })
    expect(isFloorPlanDraft(swapped)).toBe(false)
    await expect(importDraft(swapped)).rejects.toThrow('横向标定')
  })

  it('纵向标定偏向水平方向时报错', async () => {
    const tilted = rectangleDraft({
      calibrationY: {
        startPx: [500, 100],
        endPx: [800, 200],
        realDistanceMeters: 5,
      },
    })
    expect(isFloorPlanDraft(tilted)).toBe(false)
    await expect(importDraft(tilted)).rejects.toThrow('纵向标定')
  })

  it('calibrationY 超出图像范围时报错', async () => {
    const outside = rectangleDraft({
      calibrationY: {
        startPx: [900, 100],
        endPx: [900, 900],
        realDistanceMeters: 5,
      },
    })
    await expect(importDraft(outside)).rejects.toThrow('calibrationY.endPx')
  })
})

describe('成对边推导墙体后的导入', () => {
  // 100 px/m；房间 A、B 之间 12 px（0.12 m）为内表面间距
  const pairedDraft = (overrides: Partial<FloorPlanDraft> = {}): FloorPlanDraft => ({
    schemaVersion: '0.1.0',
    source: {
      kind: 'floorplan_image',
      widthPx: 1000,
      heightPx: 800,
      sourceLabel: 'paired-rooms',
    },
    calibration: {
      startPx: [100, 700],
      endPx: [600, 700],
      realDistanceMeters: 5,
      basis: 'annotated',
    },
    assumptions: {
      wallThicknessMeters: 0.2,
      ceilingHeightMeters: 2.8,
      wallThicknessConfirmed: false,
      ceilingHeightConfirmed: true,
    },
    rooms: [
      {
        id: 'room-a',
        name: '客厅',
        type: 'living',
        // 图像坐标（y 向下）中按屏幕顺时针描点，导入后为从 +Y 俯视逆时针
        boundaryPx: [
          [100, 100],
          [500, 100],
          [500, 400],
          [100, 400],
        ],
      },
      {
        id: 'room-b',
        name: '卧室',
        type: 'bedroom',
        // 按屏幕逆时针描点，导入时需反转并换算边索引
        boundaryPx: [
          [512, 100],
          [512, 400],
          [800, 400],
          [800, 100],
        ],
      },
    ],
    openings: [
      {
        id: 'door-a-b',
        roomId: 'room-a',
        edgeIndex: 1, // x = 500，自上而下
        kind: 'door',
        offsetPx: 100,
        widthPx: 90,
        heightMeters: 2.1,
      },
      {
        id: 'door-entry',
        roomId: 'room-a',
        edgeIndex: 3, // x = 100，自下而上
        kind: 'door',
        offsetPx: 50,
        widthPx: 90,
        heightMeters: 2.1,
      },
      {
        id: 'window-b',
        roomId: 'room-b',
        edgeIndex: 2, // Draft 中 (800,400)→(800,100)
        kind: 'window',
        offsetPx: 50,
        widthPx: 100,
        heightMeters: 1.5,
        sillHeightMeters: 0.9,
      },
    ],
    ...overrides,
  })

  const openingWorldSpan = (
    floor: Awaited<ReturnType<typeof importDraft>>['model']['floors'][number],
    openingId: string,
  ) => {
    const opening = floor.openings.find((candidate) => candidate.id === openingId)!
    const wall = floor.walls.find((candidate) => candidate.id === opening.wallId)!
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const at = (distance: number) => [
      wall.start[0] + ((wall.end[0] - wall.start[0]) / length) * distance,
      wall.start[1] + ((wall.end[1] - wall.start[1]) / length) * distance,
    ]
    return { opening, wall, from: at(opening.offset), to: at(opening.offset + opening.width) }
  }

  it('相邻房间生成 1 面实测厚度的共享墙，墙段 ID 稳定', async () => {
    const result = await importDraft(pairedDraft())
    const floor = result.model.floors[0]!

    expect(result.model.schemaVersion).toBe(HOME_SPATIAL_MODEL_SCHEMA_VERSION)
    expect(result.validation.issues).toEqual([])

    const shared = floor.walls.filter((wall) => wall.thicknessSource === 'paired')
    expect(shared).toHaveLength(1)
    expect(shared[0]!.id).toBe('test-wall-room-a-e1-s0')
    expect(shared[0]!.thickness).toBeCloseTo(0.12, 9)
    expect(shared[0]!.start[0]).toBeCloseTo(4.06, 9)

    // 房间边界即内表面，不做偏移，绕向统一为俯视逆时针
    for (const room of floor.rooms) {
      expect(polygonWinding(room.boundary)).toBe('ccw')
      expect(room.wallIds).toContain(shared[0]!.id)
    }
    expect(polygonArea(floor.rooms[0]!.boundary)).toBeCloseTo(12, 6)

    // 墙厚假设只针对外墙，不包含实测的共享墙
    const thicknessIssue = result.unresolved.find(
      (issue) => issue.id === 'issue-wall-thickness-assumption',
    )!
    expect(thicknessIssue.entityIds).not.toContain(shared[0]!.id)
    expect(thicknessIssue.entityIds).toHaveLength(6)

    const again = await importDraft(pairedDraft())
    expect(again.model).toEqual(result.model)
  })

  it('门窗换算到所在墙段，并推导房间连接与室外连接', async () => {
    const result = await importDraft(pairedDraft())
    const floor = result.model.floors[0]!

    const door = openingWorldSpan(floor, 'door-a-b')
    expect(door.wall.thicknessSource).toBe('paired')
    expect(door.opening.width).toBeCloseTo(0.9, 9)
    // Draft 边自 z=3 向 z=0，偏移 1 m → 门洞 z ∈ [1.1, 2]
    expect(door.from[1]).toBeCloseTo(2, 9)
    expect(door.to[1]).toBeCloseTo(1.1, 9)

    // 原绕向相反的房间：边索引与偏移换算后指向同一物理位置（z ∈ [0.5, 1.5]）
    const window = openingWorldSpan(floor, 'window-b')
    expect(window.wall.thicknessSource).toBe('exterior')
    // 房间 B 外边 x = 7（坐标以最小 x 为原点），外墙中心线外移 0.1 m
    expect(window.from[0]).toBeCloseTo(7.1, 9)
    expect(Math.min(window.from[1]!, window.to[1]!)).toBeCloseTo(0.5, 9)
    expect(Math.max(window.from[1]!, window.to[1]!)).toBeCloseTo(1.5, 9)

    expect(floor.connections).toEqual([
      expect.objectContaining({
        fromRoomId: 'room-a',
        toRoomId: 'room-b',
        kind: 'door',
        openingId: 'door-a-b',
      }),
      expect.objectContaining({
        fromRoomId: 'room-a',
        toRoomId: EXTERIOR_SPACE_ID,
        kind: 'door',
        openingId: 'door-entry',
      }),
    ])
    expect(isExteriorConnection(floor.connections[1]!)).toBe(true)
    expect(floor.rooms.find((room) => room.id === 'room-b')!.openingIds).toEqual([
      'door-a-b',
      'window-b',
    ])

    const graph = buildRoomGraph(floor)
    expect(graph.neighbors.get('room-a')).toEqual(['room-b'])
    expect(graph.edges).toHaveLength(2)
  })

  it('跨越多个墙段的门生成待复核问题', async () => {
    const draft = pairedDraft({
      rooms: [
        {
          id: 'room-big',
          name: '走廊',
          type: 'hallway',
          boundaryPx: [
            [100, 400],
            [700, 400],
            [700, 500],
            [100, 500],
          ],
        },
        {
          id: 'room-left',
          name: '厨房',
          type: 'kitchen',
          boundaryPx: [
            [100, 100],
            [390, 100],
            [390, 388],
            [100, 388],
          ],
        },
        {
          id: 'room-right',
          name: '卧室',
          type: 'bedroom',
          boundaryPx: [
            [402, 100],
            [700, 100],
            [700, 388],
            [402, 388],
          ],
        },
      ],
      openings: [
        {
          id: 'door-across',
          roomId: 'room-big',
          edgeIndex: 0, // y = 400，被两个房间切分（接头约在 x = 390–402）
          kind: 'door',
          offsetPx: 260,
          widthPx: 90,
          heightMeters: 2.1,
        },
        {
          id: 'door-left',
          roomId: 'room-big',
          edgeIndex: 0,
          kind: 'door',
          offsetPx: 100,
          widthPx: 90,
          heightMeters: 2.1,
        },
      ],
    })
    const result = await importDraft(draft)
    const floor = result.model.floors[0]!
    const issue = result.unresolved.find(
      (candidate) => candidate.id === 'issue-opening-span-door-across',
    )

    expect(issue?.kind).toBe('ambiguous_opening')
    expect(issue?.requiresHumanReview).toBe(true)
    expect(issue?.entityIds).toHaveLength(3)
    expect(floor.openings.map((opening) => opening.id)).toEqual(['door-left'])
    expect(floor.connections).toEqual([
      expect.objectContaining({ fromRoomId: 'room-big', toRoomId: 'room-left' }),
    ])
    expect(result.validation.issues).toEqual([])
  })

  it('旧的中心线式 Draft（房间边界重合）生成需复核的重合墙，仍可推导连接', async () => {
    const result = await new FloorPlanDraftImporter().parse(sampleFloorPlanDraft, context)
    const floor = result.model.floors[0]!
    const issue = result.unresolved.find(
      (candidate) => candidate.id === 'issue-wall-coincident-boundaries',
    )

    expect(issue?.requiresHumanReview).toBe(true)
    expect(floor.walls.some((wall) => wall.thicknessSource === 'coincident')).toBe(true)
    expect(floor.walls.some((wall) => wall.thicknessSource === 'paired')).toBe(false)
    expect(floor.connections.map((connection) => connection.openingId).sort()).toEqual([
      'import-door-bedroom2-hall',
      'import-door-kitchen-hall',
      'import-opening-living-hall',
    ])
    expect(result.validation.valid).toBe(true)
  })
})

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
    expect(top?.width).toBeCloseTo(1, 6)
    expect(top?.offset).toBeCloseTo(1, 6)
    expect(right?.width).toBeCloseTo(1, 6)
    expect(right?.offset).toBeCloseTo(0.5, 6)
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

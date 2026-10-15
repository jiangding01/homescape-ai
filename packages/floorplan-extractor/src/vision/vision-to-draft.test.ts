import { describe, expect, it } from 'vitest'
import {
  FloorPlanDraftImporter,
  isFloorPlanDraft,
  polygonArea,
  type SpatialImportContext,
} from '@homescape/spatial-model'
import { visionResponseToDraft } from './vision-to-draft'
import {
  SYNTHETIC_MODEL_SIZE,
  SYNTHETIC_SOURCE_SIZE,
  syntheticVisionResponse,
} from './fixtures/synthetic-vision-response'

const options = {
  sourceId: 'case-synthetic',
  sourceWidthPx: SYNTHETIC_SOURCE_SIZE.widthPx,
  sourceHeightPx: SYNTHETIC_SOURCE_SIZE.heightPx,
  modelWidthPx: SYNTHETIC_MODEL_SIZE.widthPx,
  modelHeightPx: SYNTHETIC_MODEL_SIZE.heightPx,
}

const context: SpatialImportContext = {
  projectId: 'vision-test',
  projectName: '视觉 Extractor 测试',
  sourceKind: 'floorplan_image',
}

describe('visionResponseToDraft', () => {
  it('把模型坐标换回原图像素并去掉闭合重复点', () => {
    const { draft } = visionResponseToDraft(syntheticVisionResponse(), options)

    expect(isFloorPlanDraft(draft)).toBe(true)
    expect(draft.source).toEqual({
      kind: 'floorplan_image',
      widthPx: 1000,
      heightPx: 800,
      sourceLabel: 'case-synthetic',
    })
    expect(draft.rooms[0]!.boundaryPx).toEqual([
      [100, 100],
      [600, 100],
      [600, 540],
      [100, 540],
    ])
  })

  it('丢弃退化多边形，无名称的房间按类型命名', () => {
    const { draft, warnings, stats } = visionResponseToDraft(syntheticVisionResponse(), options)

    expect(draft.rooms.map((room) => room.name)).toEqual(['客厅', '卧室'])
    expect(stats.roomsReturned).toBe(3)
    expect(stats.roomsKept).toBe(2)
    expect(warnings.some((w) => w.includes('储物') && w.includes('退化'))).toBe(true)
  })

  it('按横纵尺寸线分轴标定，剔除偏差过大的读数', () => {
    const { draft, warnings, stats } = visionResponseToDraft(syntheticVisionResponse(), options)

    expect(stats.calibrationBasis).toBe('extracted')
    expect(stats.pixelsPerMeterX).toBeCloseTo(100, 6)
    expect(stats.pixelsPerMeterY).toBeCloseTo(110, 6)
    expect(stats.dimensionLinesUsedX).toBe(2)
    expect(draft.calibration.basis).toBe('extracted')
    expect(draft.calibrationY?.basis).toBe('extracted')
    expect(warnings.some((w) => w.includes('6000') && w.includes('未参与标定'))).toBe(true)
    expect(warnings.some((w) => w.includes('非等比缩放'))).toBe(true)
  })

  it('开口绑定到平行房间边，隔墙门挂在卧室一侧，贴不上的开口丢弃并告警', () => {
    const { draft, warnings } = visionResponseToDraft(syntheticVisionResponse(), options)

    expect(draft.openings).toEqual([
      {
        // 客厅与卧室之间的门：两侧都能贴合，按约定挂在卧室（左边自下而上）
        id: 'vision-opening-1',
        roomId: 'vision-room-2',
        edgeIndex: 3,
        kind: 'door',
        offsetPx: 150,
        widthPx: 90,
        heightMeters: 2.1,
        swing: 'left',
        confidence: 0.8,
      },
      {
        id: 'vision-opening-2',
        roomId: 'vision-room-1',
        edgeIndex: 0,
        kind: 'window',
        offsetPx: 100,
        widthPx: 100,
        heightMeters: 1.5,
        sillHeightMeters: 0.9,
        swing: 'none',
        confidence: 0.85,
      },
    ])
    expect(warnings.some((w) => w.includes('第 3 个开口'))).toBe(true)
  })

  it('隔墙开口的挂载房间与房间顺序无关，阳台门挂在室内一侧', () => {
    const response = syntheticVisionResponse()
    response.rooms[0]!.type = 'balcony'
    response.rooms.reverse()
    const { draft } = visionResponseToDraft(response, options)
    const door = draft.openings.find((opening) => opening.kind === 'door')!
    const host = draft.rooms.find((room) => room.id === door.roomId)!

    expect(host.type).toBe('bedroom')
  })

  it('只贴合一侧的外墙窗仍挂在最近的边上', () => {
    const response = syntheticVisionResponse()
    response.rooms[1]!.type = 'bathroom'
    const { draft } = visionResponseToDraft(response, options)
    const window = draft.openings.find((opening) => opening.kind === 'window')!

    expect(window.roomId).toBe('vision-room-1')
  })

  it('墙厚与层高保持未确认的假设值', () => {
    const { draft } = visionResponseToDraft(syntheticVisionResponse(), options)

    expect(draft.assumptions.wallThicknessConfirmed).toBe(false)
    expect(draft.assumptions.ceilingHeightConfirmed).toBe(false)
  })

  it('导入后得到真实尺寸（非等比缩放已修正）', async () => {
    const { draft } = visionResponseToDraft(syntheticVisionResponse(), options)
    const result = await new FloorPlanDraftImporter().parse(draft, context)
    const living = result.model.floors[0]!.rooms.find((room) => room.type === 'living')!

    expect(polygonArea(living.boundary)).toBeCloseTo(20, 6)
    expect(result.unresolved.filter((issue) => issue.id.startsWith('issue-calibration'))).toEqual(
      [],
    )
  })

  it('没有尺寸线时使用 assumed 比例尺，导入后阻断 Finalize', async () => {
    const response = { ...syntheticVisionResponse(), dimensionLines: [] }
    const { draft, warnings, stats } = visionResponseToDraft(response, {
      ...options,
      assumedPixelsPerMeter: 80,
    })

    expect(stats.calibrationBasis).toBe('assumed')
    expect(draft.calibration).toEqual({
      startPx: [0, 0],
      endPx: [80, 0],
      realDistanceMeters: 1,
      basis: 'assumed',
    })
    expect(draft.calibrationY).toBeUndefined()
    expect(warnings.some((w) => w.includes('假设值 80 px/m'))).toBe(true)

    const result = await new FloorPlanDraftImporter().parse(draft, context)
    expect(
      result.unresolved.some(
        (issue) => issue.id.startsWith('issue-calibration') && issue.requiresHumanReview,
      ),
    ).toBe(true)
  })

  it('只有单轴尺寸线时另一轴标记为 assumed，导入后阻断 Finalize', async () => {
    const response = syntheticVisionResponse()
    response.dimensionLines = response.dimensionLines.filter((line) => line.axis === 'vertical')
    const { draft, warnings, stats } = visionResponseToDraft(response, options)

    expect(isFloorPlanDraft(draft)).toBe(true)
    expect(stats.pixelsPerMeterY).toBeCloseTo(110, 6)
    expect(draft.calibrationY?.basis).toBe('extracted')
    expect(draft.calibration.basis).toBe('assumed')
    expect(warnings.some((w) => w.includes('只读到纵向尺寸线'))).toBe(true)

    const result = await new FloorPlanDraftImporter().parse(draft, context)
    const ids = result.unresolved.map((issue) => issue.id)
    expect(ids).toContain('issue-calibration-x-assumption')
    expect(ids).not.toContain('issue-calibration-y-assumption')
    const living = result.model.floors[0]!.rooms.find((room) => room.type === 'living')!
    // 横向按纵向 110 px/m 假设：5 m 宽读成 500/110 m
    expect(polygonArea(living.boundary)).toBeCloseTo((500 / 110) * 4, 6)
  })

  it('开口 offset + width 不超过所在边长', () => {
    const response = syntheticVisionResponse()
    response.openings = [
      {
        kind: 'window',
        start: { x: 100.03, y: 48 },
        end: { x: 310, y: 48 },
        swing: 'none',
        confidence: 0.5,
      },
    ]
    const { draft } = visionResponseToDraft(response, options)
    const opening = draft.openings[0]!
    expect(opening.offsetPx + opening.widthPx).toBeLessThanOrEqual(500)
  })

  it('斜边（长度非 0.1 整倍数）上的开口取整后仍不超出边长', () => {
    const response = syntheticVisionResponse()
    // 凸窗式房间：左侧斜边长度为无理数
    response.rooms = [
      {
        label: '阳台',
        type: 'balcony',
        polygon: [
          { x: 100, y: 100 },
          { x: 103.7, y: 87.4 },
          { x: 133.5, y: 87.4 },
          { x: 137.2, y: 100 },
        ],
        confidence: 0.6,
      },
    ]
    response.openings = [
      {
        kind: 'window',
        start: { x: 100, y: 100 },
        end: { x: 103.7, y: 87.4 },
        swing: 'none',
        confidence: 0.5,
      },
      {
        kind: 'window',
        start: { x: 103.7, y: 87.4 },
        end: { x: 133.5, y: 87.4 },
        swing: 'none',
        confidence: 0.5,
      },
      {
        kind: 'window',
        start: { x: 133.5, y: 87.4 },
        end: { x: 137.2, y: 100 },
        swing: 'none',
        confidence: 0.5,
      },
    ]
    const { draft } = visionResponseToDraft(response, options)

    expect(draft.openings).toHaveLength(3)
    for (const opening of draft.openings) {
      const room = draft.rooms.find((candidate) => candidate.id === opening.roomId)!
      const a = room.boundaryPx[opening.edgeIndex]!
      const b = room.boundaryPx[(opening.edgeIndex + 1) % room.boundaryPx.length]!
      // 与 Benchmark 的 Draft 校验相同：不留取整余量
      expect(opening.offsetPx + opening.widthPx).toBeLessThanOrEqual(
        Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-9,
      )
    }
  })

  it('同一份响应总是得到逐字节相同的 Draft', () => {
    const first = JSON.stringify(visionResponseToDraft(syntheticVisionResponse(), options))
    const second = JSON.stringify(visionResponseToDraft(syntheticVisionResponse(), options))
    expect(second).toBe(first)
  })
})

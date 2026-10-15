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

  it('开口绑定到最近的平行房间边，贴不上的开口丢弃并告警', () => {
    const { draft, warnings } = visionResponseToDraft(syntheticVisionResponse(), options)

    expect(draft.openings).toEqual([
      {
        id: 'vision-opening-1',
        roomId: 'vision-room-1',
        edgeIndex: 1,
        kind: 'door',
        offsetPx: 200,
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

  it('只有单轴尺寸线时按等比处理并提示人工确认另一轴', () => {
    const response = syntheticVisionResponse()
    response.dimensionLines = response.dimensionLines.filter((line) => line.axis === 'vertical')
    const { draft, warnings, stats } = visionResponseToDraft(response, options)

    expect(draft.calibrationY).toBeUndefined()
    expect(stats.pixelsPerMeterY).toBeCloseTo(110, 6)
    expect(warnings.some((w) => w.includes('只读到纵向尺寸线'))).toBe(true)
  })

  it('同一份响应总是得到逐字节相同的 Draft', () => {
    const first = JSON.stringify(visionResponseToDraft(syntheticVisionResponse(), options))
    const second = JSON.stringify(visionResponseToDraft(syntheticVisionResponse(), options))
    expect(second).toBe(first)
  })
})

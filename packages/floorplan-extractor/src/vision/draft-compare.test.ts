import { describe, expect, it } from 'vitest'
import type { FloorPlanDraft } from '@homescape/spatial-model'
import { compareFloorPlanDrafts, draftPixelsPerMeter } from './draft-compare'
import { visionResponseToDraft } from './vision-to-draft'
import {
  SYNTHETIC_MODEL_SIZE,
  SYNTHETIC_SOURCE_SIZE,
  syntheticVisionResponse,
} from './fixtures/synthetic-vision-response'

function baseDraft(): FloorPlanDraft {
  return visionResponseToDraft(syntheticVisionResponse(), {
    sourceId: 'case-synthetic',
    sourceWidthPx: SYNTHETIC_SOURCE_SIZE.widthPx,
    sourceHeightPx: SYNTHETIC_SOURCE_SIZE.heightPx,
    modelWidthPx: SYNTHETIC_MODEL_SIZE.widthPx,
    modelHeightPx: SYNTHETIC_MODEL_SIZE.heightPx,
  }).draft
}

describe('compareFloorPlanDrafts', () => {
  it('同一份 Draft 完全一致', () => {
    const draft = baseDraft()
    const result = compareFloorPlanDrafts(draft, draft)

    expect(result.matchedRooms).toBe(2)
    expect(result.meanMatchedRoomIou).toBe(1)
    expect(result.roomTypeAgreement).toBe(1)
    expect(result.livingRoomIou).toBe(1)
    expect(result.matchedOpenings).toBe(2)
    expect(result.scaleDiffRatioX).toBe(0)
    expect(result.scaleDiffRatioY).toBe(0)
  })

  it('房间轻微偏移、类型改变、比例尺变化都能被量化', () => {
    const a = baseDraft()
    const b = structuredClone(a)
    b.rooms[0]!.boundaryPx = b.rooms[0]!.boundaryPx.map(([x, y]) => [x + 25, y] as const)
    b.rooms[1]!.type = 'study'
    b.calibrationY = {
      ...b.calibrationY!,
      realDistanceMeters: b.calibrationY!.realDistanceMeters * 1.1,
    }

    const result = compareFloorPlanDrafts(a, b)
    expect(result.matchedRooms).toBe(2)
    expect(result.meanMatchedRoomIou!).toBeLessThan(1)
    expect(result.livingRoomIou!).toBeGreaterThan(0.85)
    expect(result.roomTypeAgreement).toBe(0.5)
    expect(result.scaleDiffRatioX).toBe(0)
    expect(result.scaleDiffRatioY).toBeCloseTo(0.1, 6)
  })

  it('房间缺失时不计入匹配', () => {
    const a = baseDraft()
    const b = structuredClone(a)
    b.rooms = b.rooms.slice(0, 1)
    b.openings = b.openings.filter((opening) => opening.roomId === b.rooms[0]!.id)

    const result = compareFloorPlanDrafts(a, b)
    expect(result.roomCountA).toBe(2)
    expect(result.roomCountB).toBe(1)
    expect(result.matchedRooms).toBe(1)
  })

  it('源图尺寸不同拒绝比较', () => {
    const a = baseDraft()
    const b = structuredClone(a)
    b.source.widthPx = 999
    expect(() => compareFloorPlanDrafts(a, b)).toThrow()
  })

  it('单条标定视为等比', () => {
    const draft = baseDraft()
    const { calibrationY: _ignored, ...uniform } = draft
    expect(draftPixelsPerMeter(uniform)).toEqual({ x: 100, y: 100 })
  })
})

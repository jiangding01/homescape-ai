import { describe, expect, it } from 'vitest'
import { parseVisionFloorPlanResponse, VisionResponseSchemaError } from './vision-schema'
import { syntheticVisionResponse } from './fixtures/synthetic-vision-response'

describe('parseVisionFloorPlanResponse', () => {
  it('接受合法响应', () => {
    const response = syntheticVisionResponse()
    expect(parseVisionFloorPlanResponse(JSON.parse(JSON.stringify(response)))).toEqual(response)
  })

  it('拒绝越界置信度、非法枚举和缺失字段，不做静默修补', () => {
    const response = JSON.parse(JSON.stringify(syntheticVisionResponse()))
    response.rooms[0].confidence = 1.5
    response.openings[0].kind = 'gate'
    delete response.dimensionLines[0].valueMillimeters

    expect(() => parseVisionFloorPlanResponse(response)).toThrow(VisionResponseSchemaError)
    try {
      parseVisionFloorPlanResponse(response)
    } catch (error) {
      expect((error as VisionResponseSchemaError).issues).toEqual([
        'rooms[0].confidence 必须在 0~1 之间',
        'openings[0].kind 非法',
        'dimensionLines[0].valueMillimeters 必须为正数',
      ])
    }
  })

  it('拒绝非对象根节点', () => {
    expect(() => parseVisionFloorPlanResponse([])).toThrow(VisionResponseSchemaError)
  })
})

import type { VisionFloorPlanResponse } from '../vision-schema'

/**
 * 合成的模型响应（模型坐标系 500 × 400，对应原图 1000 × 800，缩放 2 倍）。
 * 原图被非等比缩放：横向 100 px/m、纵向 110 px/m。客餐厅 5 m × 4 m，卧室 3 m × 4 m。
 */
export const SYNTHETIC_MODEL_SIZE = { widthPx: 500, heightPx: 400 }
export const SYNTHETIC_SOURCE_SIZE = { widthPx: 1000, heightPx: 800 }

export function syntheticVisionResponse(): VisionFloorPlanResponse {
  return {
    isFloorPlan: true,
    notes: '',
    rooms: [
      {
        label: '客厅',
        type: 'living',
        polygon: [
          { x: 50, y: 50 },
          { x: 300, y: 50 },
          { x: 300, y: 270 },
          { x: 50, y: 270 },
          { x: 50, y: 50 },
        ],
        confidence: 0.95,
      },
      {
        label: '',
        type: 'bedroom',
        polygon: [
          { x: 300, y: 50 },
          { x: 450, y: 50 },
          { x: 450, y: 270 },
          { x: 300, y: 270 },
        ],
        confidence: 0.9,
      },
      {
        label: '储物',
        type: 'utility',
        polygon: [
          { x: 10, y: 10 },
          { x: 12, y: 10 },
        ],
        confidence: 0.2,
      },
    ],
    openings: [
      {
        kind: 'door',
        start: { x: 300, y: 150 },
        end: { x: 300, y: 195 },
        swing: 'left',
        confidence: 0.8,
      },
      {
        kind: 'window',
        start: { x: 100, y: 48 },
        end: { x: 150, y: 48 },
        swing: 'none',
        confidence: 0.85,
      },
      {
        kind: 'door',
        start: { x: 480, y: 380 },
        end: { x: 490, y: 380 },
        swing: 'unknown',
        confidence: 0.3,
      },
    ],
    dimensionLines: [
      {
        text: '5000',
        valueMillimeters: 5000,
        axis: 'horizontal',
        start: { x: 50, y: 20 },
        end: { x: 300, y: 20 },
        confidence: 0.9,
      },
      {
        text: '3000',
        valueMillimeters: 3000,
        axis: 'horizontal',
        start: { x: 300, y: 20 },
        end: { x: 450, y: 20 },
        confidence: 0.9,
      },
      {
        text: '6000',
        valueMillimeters: 6000,
        axis: 'horizontal',
        start: { x: 50, y: 10 },
        end: { x: 450, y: 10 },
        confidence: 0.4,
      },
      {
        text: '4000',
        valueMillimeters: 4000,
        axis: 'vertical',
        start: { x: 20, y: 50 },
        end: { x: 20, y: 270 },
        confidence: 0.9,
      },
    ],
  }
}

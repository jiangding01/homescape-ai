import { describe, expect, it } from 'vitest'
import {
  findCalibrationsCopiedFromCandidate,
  getGroundTruthCalibrationBasisErrors,
} from './floorplan-gt-calibration.mjs'

const calibrationX = {
  startPx: [100, 800],
  endPx: [700, 800],
  realDistanceMeters: 9.6,
}
const calibrationY = {
  startPx: [60, 100],
  endPx: [60, 640],
  realDistanceMeters: 7.8,
}

describe('getGroundTruthCalibrationBasisErrors', () => {
  it('允许 annotated、structured 与缺省 basis', () => {
    expect(
      getGroundTruthCalibrationBasisErrors({
        calibration: { ...calibrationX, basis: 'annotated' },
        calibrationY: { ...calibrationY, basis: 'structured' },
      }),
    ).toEqual([])
    expect(
      getGroundTruthCalibrationBasisErrors({ calibration: calibrationX }),
    ).toEqual([])
  })

  it('拒绝自动读出的纵向标定直接进入 GT', () => {
    const errors = getGroundTruthCalibrationBasisErrors({
      calibration: { ...calibrationX, basis: 'annotated' },
      calibrationY: { ...calibrationY, basis: 'extracted' },
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('calibrationY basis 为 extracted')
  })

  it('拒绝假设比例尺进入 GT', () => {
    const errors = getGroundTruthCalibrationBasisErrors({
      calibration: { ...calibrationX, basis: 'assumed' },
    })

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('calibration basis 为 assumed')
  })

  it('非对象输入不报错，交由结构校验处理', () => {
    expect(getGroundTruthCalibrationBasisErrors(null)).toEqual([])
  })
})

describe('findCalibrationsCopiedFromCandidate', () => {
  it('识别从 Candidate 原样复制的纵向标定（含端点顺序互换）', () => {
    const expected = {
      calibration: { ...calibrationX, startPx: [98, 801] },
      calibrationY: { ...calibrationY, basis: 'annotated' },
    }
    const candidate = {
      calibration: calibrationX,
      calibrationY: {
        startPx: calibrationY.endPx,
        endPx: [60.3, 99.8],
        realDistanceMeters: 7.8,
        basis: 'extracted',
      },
    }

    expect(findCalibrationsCopiedFromCandidate(expected, candidate)).toEqual([
      'calibrationY',
    ])
  })

  it('距离不同或端点偏差超过容差时不视为复制', () => {
    const expected = { calibration: calibrationX }

    expect(
      findCalibrationsCopiedFromCandidate(expected, {
        calibration: { ...calibrationX, realDistanceMeters: 9.5 },
      }),
    ).toEqual([])
    expect(
      findCalibrationsCopiedFromCandidate(expected, {
        calibration: { ...calibrationX, endPx: [702, 800] },
      }),
    ).toEqual([])
  })
})

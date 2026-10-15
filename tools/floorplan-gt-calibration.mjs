// Ground Truth 比例尺来源规则：GT 是人工确认后的空间真值，不能直接收录未经人工复核的比例尺。
// - assumed：假设 px/m，本身不是真值
// - extracted：自动从图上读出（VLM / OCR 等），属于 Candidate，须人工沿尺寸线复核后改为 annotated
// - annotated / structured / 缺省（旧数据未声明来源）可以进入 GT

const GROUND_TRUTH_DISALLOWED_BASES = new Map([
  ['assumed', '假设比例尺不能作为 Ground Truth'],
  [
    'extracted',
    '自动读出的比例尺是 Candidate，须人工沿尺寸线复核后标为 annotated',
  ],
])

// 端点与距离都与 Candidate 一致时，认为 GT 标定很可能直接复制自该 Candidate
const COPIED_CALIBRATION_POINT_TOLERANCE_PX = 0.5
const COPIED_CALIBRATION_DISTANCE_TOLERANCE_METERS = 1e-6

const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function getGroundTruthCalibrationBasisErrors(draft) {
  if (!isRecord(draft)) return []

  const errors = []

  for (const field of ['calibration', 'calibrationY']) {
    const calibration = draft[field]
    if (!isRecord(calibration)) continue

    const reason = GROUND_TRUTH_DISALLOWED_BASES.get(calibration.basis)
    if (reason) {
      errors.push(field + ' basis 为 ' + calibration.basis + '：' + reason)
    }
  }

  return errors
}

function samePoint(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    Math.abs(a[0] - b[0]) <= COPIED_CALIBRATION_POINT_TOLERANCE_PX &&
    Math.abs(a[1] - b[1]) <= COPIED_CALIBRATION_POINT_TOLERANCE_PX
  )
}

function sameCalibration(expected, candidate) {
  if (!isRecord(expected) || !isRecord(candidate)) return false

  const sameEndpoints =
    (samePoint(expected.startPx, candidate.startPx) &&
      samePoint(expected.endPx, candidate.endPx)) ||
    (samePoint(expected.startPx, candidate.endPx) &&
      samePoint(expected.endPx, candidate.startPx))

  return (
    sameEndpoints &&
    Math.abs(expected.realDistanceMeters - candidate.realDistanceMeters) <=
      COPIED_CALIBRATION_DISTANCE_TOLERANCE_METERS
  )
}

// 返回 GT 中与 Candidate 完全一致的标定字段；非空时该 Candidate 的比例尺误差不是独立评测结果
export function findCalibrationsCopiedFromCandidate(expected, candidate) {
  if (!isRecord(expected) || !isRecord(candidate)) return []

  const candidateCalibrations = [
    candidate.calibration,
    candidate.calibrationY,
  ].filter(isRecord)

  return ['calibration', 'calibrationY'].filter(
    (field) =>
      isRecord(expected[field]) &&
      candidateCalibrations.some((calibration) =>
        sameCalibration(expected[field], calibration),
      ),
  )
}

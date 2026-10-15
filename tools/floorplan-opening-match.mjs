// Benchmark 的 Opening 匹配辅助：与 Draft 结构相关的纯几何函数，便于单测。

const EPSILON = 1e-9
const SHARED_WALL_PARALLEL_SIN_MAX = Math.sin((20 * Math.PI) / 180)
const SHARED_WALL_MARGIN_METERS = 0.1

/**
 * 与 Opening 所在墙另一侧相邻的 Room。
 * 隔墙上的门窗是同一个物理开口，标注时挂在墙哪一侧的房间只是约定；
 * 匹配时两侧房间都算“所在房间”，否则位置、类型都对的开口会因挂错侧被记为漏检 + 误检。
 */
export function sharedWallRoomIds(draft, opening) {
  const room = draft.rooms.find((candidate) => candidate.id === opening.roomId)
  if (!room) return []

  const a = room.boundaryPx[opening.edgeIndex]
  const b = room.boundaryPx[(opening.edgeIndex + 1) % room.boundaryPx.length]
  if (!a || !b) return []

  const edgeLength = pixelDistance(a, b)
  if (edgeLength <= EPSILON) return []

  const ux = (b[0] - a[0]) / edgeLength
  const uy = (b[1] - a[1]) / edgeLength
  const from = [a[0] + ux * opening.offsetPx, a[1] + uy * opening.offsetPx]
  const to = [
    a[0] + ux * (opening.offsetPx + opening.widthPx),
    a[1] + uy * (opening.offsetPx + opening.widthPx),
  ]
  const wallThicknessMeters = Number.isFinite(draft.assumptions?.wallThicknessMeters)
    ? draft.assumptions.wallThicknessMeters
    : 0.24
  const maxDistancePx =
    (wallThicknessMeters + SHARED_WALL_MARGIN_METERS) *
    Math.max(calibrationPixelsPerMeter(draft, 'x'), calibrationPixelsPerMeter(draft, 'y'))
  const ids = []

  for (const other of draft.rooms) {
    if (other.id === room.id) continue

    const touches = other.boundaryPx.some((p, index) => {
      const q = other.boundaryPx[(index + 1) % other.boundaryPx.length]
      const length = pixelDistance(p, q)
      if (length <= EPSILON) return false

      const vx = (q[0] - p[0]) / length
      const vy = (q[1] - p[1]) / length
      if (Math.abs(ux * vy - uy * vx) > SHARED_WALL_PARALLEL_SIN_MAX) {
        return false
      }

      const project = (point) => ({
        along: (point[0] - p[0]) * vx + (point[1] - p[1]) * vy,
        across: Math.abs((point[0] - p[0]) * vy - (point[1] - p[1]) * vx),
      })
      const start = project(from)
      const end = project(to)
      if ((start.across + end.across) / 2 > maxDistancePx) return false

      const overlap =
        Math.min(length, Math.max(start.along, end.along)) -
        Math.max(0, Math.min(start.along, end.along))
      return overlap >= opening.widthPx * 0.5
    })

    if (touches) ids.push(other.id)
  }

  return ids
}

function pixelDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

// 与 Benchmark 相同：axis = 'y' 时优先 calibrationY，缺省回退到 calibration
function calibrationPixelsPerMeter(draft, axis) {
  const calibration = axis === 'y' && draft.calibrationY ? draft.calibrationY : draft.calibration

  return pixelDistance(calibration.startPx, calibration.endPx) / calibration.realDistanceMeters
}

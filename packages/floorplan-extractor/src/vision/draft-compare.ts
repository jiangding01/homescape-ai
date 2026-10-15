import type { FloorPlanCalibration, FloorPlanDraft, PixelPoint } from '@homescape/spatial-model'

/**
 * 两份同源 FloorPlanDraft 的一致性比较（同一张图、两次运行）。
 * 只衡量运行间稳定性，不是准确率：准确率仍由 Benchmark 对照人工 GT 计算。
 */
export interface DraftComparison {
  roomCountA: number
  roomCountB: number
  matchedRooms: number
  meanMatchedRoomIou: number | null
  /** 匹配上的房间中类型一致的比例。 */
  roomTypeAgreement: number | null
  livingRoomIou: number | null
  openingCountA: number
  openingCountB: number
  matchedOpenings: number
  pixelsPerMeterXA: number
  pixelsPerMeterXB: number
  pixelsPerMeterYA: number
  pixelsPerMeterYB: number
  scaleDiffRatioX: number
  scaleDiffRatioY: number
  calibrationBasisA: string
  calibrationBasisB: string
}

export interface DraftCompareOptions {
  gridCells?: number
  roomMatchIou?: number
  openingCenterToleranceRatio?: number
}

function pixelsPerMeter(calibration: FloorPlanCalibration, axis: 'x' | 'y' | 'any') {
  const dx = Math.abs(calibration.endPx[0] - calibration.startPx[0])
  const dy = Math.abs(calibration.endPx[1] - calibration.startPx[1])
  const length = axis === 'x' ? dx : axis === 'y' ? dy : Math.hypot(dx, dy)
  return length / calibration.realDistanceMeters
}

export function draftPixelsPerMeter(draft: FloorPlanDraft) {
  if (draft.calibrationY) {
    return {
      x: pixelsPerMeter(draft.calibration, 'x'),
      y: pixelsPerMeter(draft.calibrationY, 'y'),
    }
  }
  const uniform = pixelsPerMeter(draft.calibration, 'any')
  return { x: uniform, y: uniform }
}

function pointInPolygon(x: number, y: number, polygon: readonly PixelPoint[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function rasterize(polygon: readonly PixelPoint[], width: number, height: number, cells: number) {
  const step = Math.max(width, height) / cells
  const columns = Math.ceil(width / step)
  const rows = Math.ceil(height / step)
  const mask = new Uint8Array(columns * rows)
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (pointInPolygon((column + 0.5) * step, (row + 0.5) * step, polygon)) {
        mask[row * columns + column] = 1
      }
    }
  }
  return mask
}

function iou(a: Uint8Array, b: Uint8Array) {
  let intersection = 0
  let union = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] && b[i]) intersection += 1
    if (a[i] || b[i]) union += 1
  }
  return union === 0 ? 0 : intersection / union
}

function openingCenters(draft: FloorPlanDraft) {
  const rooms = new Map(draft.rooms.map((room) => [room.id, room]))
  const centers: PixelPoint[] = []
  for (const opening of draft.openings) {
    const room = rooms.get(opening.roomId)
    const a = room?.boundaryPx[opening.edgeIndex]
    const b = room?.boundaryPx[(opening.edgeIndex + 1) % room.boundaryPx.length]
    if (!a || !b) continue
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length === 0) continue
    const t = (opening.offsetPx + opening.widthPx / 2) / length
    centers.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return centers
}

function greedyMatch(scores: { i: number; j: number; score: number }[]) {
  const usedA = new Set<number>()
  const usedB = new Set<number>()
  const matches: { i: number; j: number; score: number }[] = []
  for (const pair of [...scores].sort((x, y) => y.score - x.score || x.i - y.i || x.j - y.j)) {
    if (usedA.has(pair.i) || usedB.has(pair.j)) continue
    usedA.add(pair.i)
    usedB.add(pair.j)
    matches.push(pair)
  }
  return matches
}

export function compareFloorPlanDrafts(
  a: FloorPlanDraft,
  b: FloorPlanDraft,
  options: DraftCompareOptions = {},
): DraftComparison {
  if (a.source.widthPx !== b.source.widthPx || a.source.heightPx !== b.source.heightPx) {
    throw new Error('两份 Draft 的源图尺寸不同，无法比较')
  }
  const { widthPx: width, heightPx: height } = a.source
  const cells = options.gridCells ?? 256
  const roomMatchIou = options.roomMatchIou ?? 0.5
  const masksA = a.rooms.map((room) => rasterize(room.boundaryPx, width, height, cells))
  const masksB = b.rooms.map((room) => rasterize(room.boundaryPx, width, height, cells))

  const roomScores: { i: number; j: number; score: number }[] = []
  masksA.forEach((maskA, i) =>
    masksB.forEach((maskB, j) => {
      const score = iou(maskA, maskB)
      if (score >= roomMatchIou) roomScores.push({ i, j, score })
    }),
  )
  const roomMatches = greedyMatch(roomScores)

  const livingIndex = (draft: FloorPlanDraft) => {
    let best = -1
    let bestArea = -1
    draft.rooms.forEach((room, index) => {
      if (room.type !== 'living') return
      const area = room.boundaryPx.reduce((sum, p, k) => {
        const q = room.boundaryPx[(k + 1) % room.boundaryPx.length]!
        return sum + p[0] * q[1] - q[0] * p[1]
      }, 0)
      if (Math.abs(area) > bestArea) {
        bestArea = Math.abs(area)
        best = index
      }
    })
    return best
  }
  const livingA = livingIndex(a)
  const livingB = livingIndex(b)

  const centersA = openingCenters(a)
  const centersB = openingCenters(b)
  const tolerance = (options.openingCenterToleranceRatio ?? 0.02) * Math.max(width, height)
  const openingScores: { i: number; j: number; score: number }[] = []
  centersA.forEach((p, i) =>
    centersB.forEach((q, j) => {
      const distance = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (distance <= tolerance) openingScores.push({ i, j, score: -distance })
    }),
  )

  const scaleA = draftPixelsPerMeter(a)
  const scaleB = draftPixelsPerMeter(b)
  const relative = (x: number, y: number) => Math.abs(x - y) / Math.min(x, y)

  return {
    roomCountA: a.rooms.length,
    roomCountB: b.rooms.length,
    matchedRooms: roomMatches.length,
    meanMatchedRoomIou: roomMatches.length
      ? roomMatches.reduce((sum, m) => sum + m.score, 0) / roomMatches.length
      : null,
    roomTypeAgreement: roomMatches.length
      ? roomMatches.filter((m) => a.rooms[m.i]!.type === b.rooms[m.j]!.type).length /
        roomMatches.length
      : null,
    livingRoomIou: livingA >= 0 && livingB >= 0 ? iou(masksA[livingA]!, masksB[livingB]!) : null,
    openingCountA: a.openings.length,
    openingCountB: b.openings.length,
    matchedOpenings: greedyMatch(openingScores).length,
    pixelsPerMeterXA: scaleA.x,
    pixelsPerMeterXB: scaleB.x,
    pixelsPerMeterYA: scaleA.y,
    pixelsPerMeterYB: scaleB.y,
    scaleDiffRatioX: relative(scaleA.x, scaleB.x),
    scaleDiffRatioY: relative(scaleA.y, scaleB.y),
    calibrationBasisA: a.calibration.basis ?? 'unspecified',
    calibrationBasisB: b.calibration.basis ?? 'unspecified',
  }
}

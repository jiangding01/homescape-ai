import type { Polygon2D, Vec2 } from './geometry'
import type { SpatialId, Wall, WallRoomSide, WallSide, WallThicknessSource } from './model'
import { polygonWinding } from './polygon-ops'

/**
 * 成对边推导墙体（ADR 0018）。
 *
 * 输入是各房间的内表面多边形（米）。两个房间各取一条边，若
 *   1. 方向相反、夹角在容差内（平行且法线相向），
 *   2. 沿法线的间距落在墙厚区间内，
 *   3. 投影重叠长度不小于 minOverlap，
 * 则重叠段生成一面共享墙：中心线取两边中线，厚度取实测间距。
 * 一条边可被多个邻居切分（T 型接头）；剩余未配对部分生成外墙，中心线向房间外侧
 * 偏移半个假设墙厚。
 *
 * 结果只依赖输入几何与房间 ID：候选配对按（间距、房间 ID、边索引）排序后贪心认领，
 * 墙段 ID 由“所属边”的房间 ID、边索引与沿边序号组成，同输入必得同输出。
 */

export interface WallInferenceRoom {
  id: SpatialId
  /** 内表面多边形；绕向任意（推导按各自绕向判断内外），但模型约定为从 +Y 俯视逆时针 */
  boundary: Polygon2D
}

export interface WallInferenceOptions {
  /** 成对墙最小厚度，默认 0.05 m */
  minThickness?: number
  /** 成对墙最大厚度，默认 0.40 m */
  maxThickness?: number
  /** 两条边投影重叠的最小长度，默认 0.10 m */
  minOverlap?: number
  /** 平行判定角度容差（度），默认 3° */
  angleToleranceDegrees?: number
  /** 外墙（及边界重合墙）的假设厚度，默认 0.20 m */
  exteriorThickness?: number
  /** 两边间距绝对值不超过该值视为边界重合（旧的中心线标注），默认 0.02 m */
  coincidentTolerance?: number
  /** 短于该长度的未配对边段不生成外墙（端点误差产生的碎片），默认 0.05 m */
  minSegmentLength?: number
  /** 墙段 ID 前缀，默认 'wall' */
  idPrefix?: string
}

export interface InferredWallSegment {
  id: SpatialId
  start: Vec2
  end: Vec2
  thickness: number
  thicknessSource: WallThicknessSource
  /** 与 Wall.sides 相同：sides[0] 位于墙方向俯视左侧，sides[1] 位于右侧 */
  sides: readonly [WallSide, WallSide]
}

export interface WallInferenceResult {
  walls: InferredWallSegment[]
  /** roomId → 引用该房间的墙段 ID，按边索引、沿边位置排序 */
  roomWallIds: Map<SpatialId, SpatialId[]>
}

export const DEFAULT_WALL_INFERENCE_OPTIONS: Required<WallInferenceOptions> = {
  minThickness: 0.05,
  maxThickness: 0.4,
  minOverlap: 0.1,
  angleToleranceDegrees: 3,
  exteriorThickness: 0.2,
  coincidentTolerance: 0.02,
  minSegmentLength: 0.05,
  idPrefix: 'wall',
}

interface Interval {
  from: number
  to: number
}

interface EdgeInfo {
  roomId: SpatialId
  edgeIndex: number
  start: Vec2
  length: number
  direction: Vec2
  /** 指向房间外侧的单位法线 */
  outward: Vec2
  /** 尚未被共享墙认领的区间（沿边参数，米） */
  free: Interval[]
}

interface PendingSegment {
  owner: EdgeInfo
  ownerFrom: number
  start: Vec2
  end: Vec2
  thickness: number
  thicknessSource: WallThicknessSource
  sides: [WallSide, WallSide]
}

interface PairCandidate {
  first: EdgeInfo
  second: EdgeInfo
  gap: number
  kind: 'paired' | 'coincident'
  axis: Vec2
  normal: Vec2
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]]
}

function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]]
}

function scale(a: Vec2, factor: number): Vec2 {
  return [a[0] * factor, a[1] * factor]
}

function dot(a: Vec2, b: Vec2) {
  return a[0] * b[0] + a[1] * b[1]
}

function normalize(a: Vec2): Vec2 {
  const length = Math.hypot(a[0], a[1])
  return length === 0 ? [0, 0] : [a[0] / length, a[1] / length]
}

/** 俯视左侧法线（见 polygon-ops.ts 的绕向约定） */
function leftNormal(direction: Vec2): Vec2 {
  return [direction[1], -direction[0]]
}

function compareEdges(a: EdgeInfo, b: EdgeInfo) {
  if (a.roomId !== b.roomId) return a.roomId < b.roomId ? -1 : 1
  return a.edgeIndex - b.edgeIndex
}

function intersectIntervals(a: Interval[], b: Interval[]) {
  const result: Interval[] = []

  for (const left of a) {
    for (const right of b) {
      const from = Math.max(left.from, right.from)
      const to = Math.min(left.to, right.to)
      if (to > from) result.push({ from, to })
    }
  }

  return result.sort((x, y) => x.from - y.from)
}

function subtractInterval(intervals: Interval[], removed: Interval) {
  const result: Interval[] = []

  for (const interval of intervals) {
    if (removed.to <= interval.from || removed.from >= interval.to) {
      result.push(interval)
      continue
    }

    if (removed.from > interval.from) result.push({ from: interval.from, to: removed.from })
    if (removed.to < interval.to) result.push({ from: removed.to, to: interval.to })
  }

  return result
}

function pointOnEdge(edge: EdgeInfo, parameter: number): Vec2 {
  return add(edge.start, scale(edge.direction, parameter))
}

function buildEdges(rooms: readonly WallInferenceRoom[]) {
  const edges: EdgeInfo[] = []

  for (const room of rooms) {
    const winding = polygonWinding(room.boundary)

    if (winding === 'degenerate') continue

    const points = room.boundary.points

    for (let edgeIndex = 0; edgeIndex < points.length; edgeIndex += 1) {
      const start = points[edgeIndex]!
      const end = points[(edgeIndex + 1) % points.length]!
      const vector = sub(end, start)
      const length = Math.hypot(vector[0], vector[1])

      if (!(length > 0) || !Number.isFinite(length)) continue

      const direction = scale(vector, 1 / length)
      const left = leftNormal(direction)
      // 逆时针（俯视）房间内部在左侧，外法线朝右；顺时针反之。
      const outward = winding === 'ccw' ? scale(left, -1) : left

      edges.push({
        roomId: room.id,
        edgeIndex,
        start,
        length,
        direction,
        outward,
        free: [{ from: 0, to: length }],
      })
    }
  }

  return edges.sort(compareEdges)
}

/**
 * 沿公共轴 axis（以 first.start 为原点）把边参数映射为轴坐标 t。
 * 两条边方向相反，因此 second 的映射是递减的。
 */
function edgeToAxis(edge: EdgeInfo, origin: Vec2, axis: Vec2) {
  const offset = dot(sub(edge.start, origin), axis)
  const factor = dot(edge.direction, axis)
  return {
    toAxis: (parameter: number) => offset + parameter * factor,
    fromAxis: (t: number) => (t - offset) / factor,
  }
}

function axisIntervals(edge: EdgeInfo, intervals: Interval[], origin: Vec2, axis: Vec2) {
  const { toAxis } = edgeToAxis(edge, origin, axis)

  return intervals.map((interval) => {
    const a = toAxis(interval.from)
    const b = toAxis(interval.to)
    return { from: Math.min(a, b), to: Math.max(a, b) }
  })
}

function findCandidates(edges: EdgeInfo[], options: Required<WallInferenceOptions>) {
  const cosTolerance = Math.cos((options.angleToleranceDegrees * Math.PI) / 180)
  const candidates: PairCandidate[] = []

  for (let i = 0; i < edges.length; i += 1) {
    const first = edges[i]!

    for (let j = i + 1; j < edges.length; j += 1) {
      const second = edges[j]!

      if (first.roomId === second.roomId) continue
      if (dot(first.direction, second.direction) > -cosTolerance) continue

      const axis = normalize(sub(first.direction, second.direction))
      const normal = normalize(sub(first.outward, second.outward))
      const firstMap = edgeToAxis(first, first.start, axis)
      const secondMap = edgeToAxis(second, first.start, axis)
      const firstEnds = [firstMap.toAxis(0), firstMap.toAxis(first.length)]
      const secondEnds = [secondMap.toAxis(0), secondMap.toAxis(second.length)]
      const from = Math.max(Math.min(...firstEnds), Math.min(...secondEnds))
      const to = Math.min(Math.max(...firstEnds), Math.max(...secondEnds))

      if (to - from < options.minOverlap) continue

      const middle = (from + to) / 2
      const gap = dot(
        sub(
          pointOnEdge(second, secondMap.fromAxis(middle)),
          pointOnEdge(first, firstMap.fromAxis(middle)),
        ),
        normal,
      )

      let kind: PairCandidate['kind'] | undefined

      if (gap >= options.minThickness && gap <= options.maxThickness) {
        kind = 'paired'
      } else if (Math.abs(gap) <= options.coincidentTolerance) {
        kind = 'coincident'
      }

      if (!kind) continue

      candidates.push({ first, second, gap, kind, axis, normal })
    }
  }

  return candidates.sort((a, b) => {
    const gapDelta = Math.abs(a.gap) - Math.abs(b.gap)
    if (Math.abs(gapDelta) > 1e-9) return gapDelta
    return compareEdges(a.first, b.first) || compareEdges(a.second, b.second)
  })
}

function roomSide(edge: EdgeInfo, a: number, b: number): WallRoomSide {
  return {
    kind: 'room',
    roomId: edge.roomId,
    edgeIndex: edge.edgeIndex,
    edgeStart: Math.min(a, b),
    edgeEnd: Math.max(a, b),
  }
}

/** 房间内部是否位于方向 direction 的俯视左侧 */
function roomIsOnLeft(edge: EdgeInfo, direction: Vec2) {
  return dot(scale(edge.outward, -1), leftNormal(direction)) > 0
}

function orderSides(entries: Array<{ side: WallSide; onLeft: boolean }>): [WallSide, WallSide] {
  const left = entries.find((entry) => entry.onLeft)?.side
  const right = entries.find((entry) => !entry.onLeft)?.side

  return [left ?? { kind: 'exterior' }, right ?? { kind: 'exterior' }]
}

function claimPair(
  candidate: PairCandidate,
  options: Required<WallInferenceOptions>,
  segments: PendingSegment[],
) {
  const { first, second, axis, normal } = candidate
  const origin = first.start
  const firstMap = edgeToAxis(first, origin, axis)
  const secondMap = edgeToAxis(second, origin, axis)
  const shared = intersectIntervals(
    axisIntervals(first, first.free, origin, axis),
    axisIntervals(second, second.free, origin, axis),
  ).filter((interval) => interval.to - interval.from >= options.minOverlap)

  for (const interval of shared) {
    const firstFrom = firstMap.fromAxis(interval.from)
    const firstTo = firstMap.fromAxis(interval.to)
    const secondA = secondMap.fromAxis(interval.from)
    const secondB = secondMap.fromAxis(interval.to)
    const p1Start = pointOnEdge(first, firstFrom)
    const p1End = pointOnEdge(first, firstTo)
    const p2Start = pointOnEdge(second, secondA)
    const p2End = pointOnEdge(second, secondB)
    const start = scale(add(p1Start, p2Start), 0.5)
    const end = scale(add(p1End, p2End), 0.5)
    const measured = (dot(sub(p2Start, p1Start), normal) + dot(sub(p2End, p1End), normal)) / 2
    const direction = normalize(sub(end, start))

    segments.push({
      owner: first,
      ownerFrom: Math.min(firstFrom, firstTo),
      start,
      end,
      thickness: candidate.kind === 'paired' ? measured : options.exteriorThickness,
      thicknessSource: candidate.kind,
      sides: orderSides([
        { side: roomSide(first, firstFrom, firstTo), onLeft: roomIsOnLeft(first, direction) },
        { side: roomSide(second, secondA, secondB), onLeft: roomIsOnLeft(second, direction) },
      ]),
    })

    first.free = subtractInterval(first.free, {
      from: Math.min(firstFrom, firstTo),
      to: Math.max(firstFrom, firstTo),
    })
    second.free = subtractInterval(second.free, {
      from: Math.min(secondA, secondB),
      to: Math.max(secondA, secondB),
    })
  }
}

function sideOnEdge(segment: PendingSegment, edge: EdgeInfo) {
  return segment.sides.find(
    (side): side is WallRoomSide =>
      side.kind === 'room' && side.roomId === edge.roomId && side.edgeIndex === edge.edgeIndex,
  )
}

/** 把墙段中心线延长到房间边参数 parameter 处对应的位置（只沿墙方向伸长） */
function extendSegmentTo(segment: PendingSegment, edge: EdgeInfo, parameter: number) {
  const vector = sub(segment.end, segment.start)
  const length = Math.hypot(vector[0], vector[1])
  const direction = scale(vector, 1 / length)
  const t = dot(sub(pointOnEdge(edge, parameter), segment.start), direction)

  if (t > length) segment.end = add(segment.start, scale(direction, t))
  else if (t < 0) segment.start = add(segment.start, scale(direction, t))
}

/**
 * T 型接头：一条边上两段共享墙之间、长度不超过最大墙厚的空隙，对面是垂直隔墙的端头
 * （实心墙体），不是室外。把前一段共享墙沿该边延长覆盖空隙，而不是生成外墙。
 */
function fillJunctionGaps(
  edge: EdgeInfo,
  options: Required<WallInferenceOptions>,
  segments: PendingSegment[],
) {
  const epsilon = 1e-6

  for (const interval of [...edge.free]) {
    const interior = interval.from > epsilon && interval.to < edge.length - epsilon

    if (!interior || interval.to - interval.from > options.maxThickness + epsilon) continue

    const previous = segments.find((segment) => {
      const side = sideOnEdge(segment, edge)
      return side !== undefined && Math.abs(side.edgeEnd - interval.from) <= epsilon
    })
    const next = segments.some((segment) => {
      const side = sideOnEdge(segment, edge)
      return side !== undefined && Math.abs(side.edgeStart - interval.to) <= epsilon
    })

    if (!previous || !next) continue

    sideOnEdge(previous, edge)!.edgeEnd = interval.to
    extendSegmentTo(previous, edge, interval.to)
    edge.free = subtractInterval(edge.free, interval)
  }
}

/**
 * 同一条外墙线上被隔墙端头断开的相邻外墙段（共线、同向、间隙不超过最大墙厚）
 * 各向间隙中点延长，使外墙连续。房间侧的边区间保持不变。
 */
function closeExteriorGaps(segments: PendingSegment[], options: Required<WallInferenceOptions>) {
  const exterior = segments.filter((segment) => segment.thicknessSource === 'exterior')
  const cosTolerance = Math.cos((options.angleToleranceDegrees * Math.PI) / 180)

  for (const first of exterior) {
    const direction = normalize(sub(first.end, first.start))

    for (const second of exterior) {
      if (first === second) continue
      if (dot(direction, normalize(sub(second.end, second.start))) < cosTolerance) continue

      const delta = sub(second.start, first.end)
      const gap = dot(delta, direction)
      const across = Math.abs(dot(delta, leftNormal(direction)))

      if (gap <= 1e-9 || gap > options.maxThickness || across > options.coincidentTolerance) {
        continue
      }

      const middle = add(first.end, scale(delta, 0.5))
      first.end = middle
      second.start = middle
    }
  }
}

/**
 * 同一房间相邻两条边在凸角处都是外墙时，把两段外墙中心线延长到交点再加对方半厚，
 * 封住外角。凹角处两段外墙本已重叠，不做处理。
 */
function closeExteriorCorners(edges: EdgeInfo[], segments: PendingSegment[]) {
  const epsilon = 1e-6
  const exterior = segments.filter((segment) => segment.thicknessSource === 'exterior')
  const byRoom = new Map<SpatialId, EdgeInfo[]>()

  for (const edge of edges) {
    const list = byRoom.get(edge.roomId) ?? []
    list.push(edge)
    byRoom.set(edge.roomId, list)
  }

  for (const roomEdges of byRoom.values()) {
    roomEdges.forEach((edge, index) => {
      const nextEdge = roomEdges[(index + 1) % roomEdges.length]!

      const joint = sub(nextEdge.start, pointOnEdge(edge, edge.length))

      if (nextEdge === edge || Math.hypot(joint[0], joint[1]) > epsilon) return

      // 凸角：下一条边朝本边内侧拐。
      if (dot(nextEdge.direction, scale(edge.outward, -1)) <= epsilon) return

      const first = exterior.find(
        (segment) => Math.abs((sideOnEdge(segment, edge)?.edgeEnd ?? -1) - edge.length) <= epsilon,
      )
      const second = exterior.find(
        (segment) => Math.abs(sideOnEdge(segment, nextEdge)?.edgeStart ?? -1) <= epsilon,
      )

      if (!first || !second) return

      const firstDirection = normalize(sub(first.end, first.start))
      const secondDirection = normalize(sub(second.end, second.start))
      const denominator =
        firstDirection[0] * secondDirection[1] - firstDirection[1] * secondDirection[0]

      if (Math.abs(denominator) < 1e-9) return

      const delta = sub(second.start, first.start)
      const s = (delta[0] * secondDirection[1] - delta[1] * secondDirection[0]) / denominator
      const corner = add(first.start, scale(firstDirection, s))

      first.end = add(corner, scale(firstDirection, second.thickness / 2))
      second.start = sub(corner, scale(secondDirection, first.thickness / 2))
    })
  }
}

function exteriorSegments(
  edge: EdgeInfo,
  options: Required<WallInferenceOptions>,
  segments: PendingSegment[],
) {
  const offset = scale(edge.outward, options.exteriorThickness / 2)

  for (const interval of edge.free) {
    if (interval.to - interval.from < options.minSegmentLength) continue

    const side = roomSide(edge, interval.from, interval.to)

    segments.push({
      owner: edge,
      ownerFrom: interval.from,
      start: add(pointOnEdge(edge, interval.from), offset),
      end: add(pointOnEdge(edge, interval.to), offset),
      thickness: options.exteriorThickness,
      thicknessSource: 'exterior',
      sides: orderSides([
        { side, onLeft: roomIsOnLeft(edge, edge.direction) },
        { side: { kind: 'exterior' }, onLeft: !roomIsOnLeft(edge, edge.direction) },
      ]),
    })
  }
}

export function inferWallsFromRooms(
  rooms: readonly WallInferenceRoom[],
  options: WallInferenceOptions = {},
): WallInferenceResult {
  const resolved: Required<WallInferenceOptions> = {
    ...DEFAULT_WALL_INFERENCE_OPTIONS,
    ...options,
  }

  if (!(resolved.minThickness > 0) || !(resolved.maxThickness >= resolved.minThickness)) {
    throw new Error('墙厚区间无效')
  }

  if (!(resolved.exteriorThickness > 0)) {
    throw new Error('外墙假设厚度必须为正数')
  }

  const roomIds = new Set<SpatialId>()

  for (const room of rooms) {
    if (roomIds.has(room.id)) throw new Error('墙体推导输入存在重复房间 ID：' + room.id)
    roomIds.add(room.id)
  }

  const edges = buildEdges(rooms)
  const segments: PendingSegment[] = []

  for (const candidate of findCandidates(edges, resolved)) {
    claimPair(candidate, resolved, segments)
  }

  for (const edge of edges) {
    fillJunctionGaps(edge, resolved, segments)
  }

  for (const edge of edges) {
    exteriorSegments(edge, resolved, segments)
  }

  closeExteriorGaps(segments, resolved)
  closeExteriorCorners(edges, segments)

  const byOwner = new Map<EdgeInfo, PendingSegment[]>()

  for (const segment of segments) {
    const list = byOwner.get(segment.owner) ?? []
    list.push(segment)
    byOwner.set(segment.owner, list)
  }

  const walls: InferredWallSegment[] = []

  for (const edge of edges) {
    const owned = (byOwner.get(edge) ?? []).sort((a, b) => a.ownerFrom - b.ownerFrom)

    owned.forEach((segment, index) => {
      walls.push({
        id: resolved.idPrefix + '-' + edge.roomId + '-e' + edge.edgeIndex + '-s' + index,
        start: segment.start,
        end: segment.end,
        thickness: segment.thickness,
        thicknessSource: segment.thicknessSource,
        sides: segment.sides,
      })
    })
  }

  const roomWallIds = new Map<SpatialId, SpatialId[]>(rooms.map((room) => [room.id, []]))
  const roomRefs = walls.flatMap((wall) =>
    wall.sides
      .filter((side): side is WallRoomSide => side.kind === 'room')
      .map((side) => ({ wallId: wall.id, side })),
  )

  roomRefs.sort(
    (a, b) =>
      (a.side.roomId < b.side.roomId ? -1 : a.side.roomId > b.side.roomId ? 1 : 0) ||
      a.side.edgeIndex - b.side.edgeIndex ||
      a.side.edgeStart - b.side.edgeStart,
  )

  for (const { wallId, side } of roomRefs) {
    roomWallIds.get(side.roomId)?.push(wallId)
  }

  return { walls, roomWallIds }
}

/** 墙两侧中的房间侧（外墙只有一个，旧数据无 sides 时为空） */
export function wallRoomSides(wall: Pick<Wall, 'sides'> | undefined): WallRoomSide[] {
  const sides: readonly WallSide[] = wall?.sides ?? []
  return sides.filter((side): side is WallRoomSide => side.kind === 'room')
}

/** 墙是否有一侧为室外 */
export function isExteriorWall(wall: Pick<Wall, 'sides'> | undefined) {
  return wall?.sides?.some((side) => side.kind === 'exterior') ?? false
}

export type WallSpanBinding =
  | {
      status: 'bound'
      wallId: SpatialId
      /** 沿墙中心线、从 wall.start 量起的偏移（米） */
      offset: number
      width: number
    }
  | { status: 'spans_multiple'; wallIds: SpatialId[] }
  | { status: 'outside' }

/**
 * 把“房间第 edgeIndex 条边上 [spanStart, spanEnd]（米，从边起点量起）”的门窗区间
 * 换算到包含它的墙段。区间跨越多个墙段时返回 spans_multiple，由调用方生成待复核问题。
 */
export function bindRoomEdgeSpanToWall(
  walls: ReadonlyArray<Pick<Wall, 'id' | 'start' | 'end' | 'sides'>>,
  room: WallInferenceRoom,
  edgeIndex: number,
  spanStart: number,
  spanEnd: number,
  tolerance = 0.01,
): WallSpanBinding {
  const points = room.boundary.points
  const edgeStart = points[edgeIndex]
  const edgeEnd = points[(edgeIndex + 1) % points.length]

  if (!edgeStart || !edgeEnd || !(spanEnd > spanStart)) return { status: 'outside' }

  const edgeLength = Math.hypot(edgeEnd[0] - edgeStart[0], edgeEnd[1] - edgeStart[1])

  if (spanStart < -tolerance || spanEnd > edgeLength + tolerance) return { status: 'outside' }

  const overlapping: Array<{ wall: Pick<Wall, 'id' | 'start' | 'end'>; side: WallRoomSide }> = []

  for (const wall of walls) {
    for (const side of wall.sides ?? []) {
      if (side.kind !== 'room' || side.roomId !== room.id || side.edgeIndex !== edgeIndex) continue
      if (side.edgeEnd > spanStart + tolerance && side.edgeStart < spanEnd - tolerance) {
        overlapping.push({ wall, side })
      }
    }
  }

  const containing = overlapping.find(
    ({ side }) => side.edgeStart - tolerance <= spanStart && spanEnd <= side.edgeEnd + tolerance,
  )

  if (!containing) {
    return overlapping.length > 1
      ? { status: 'spans_multiple', wallIds: overlapping.map(({ wall }) => wall.id) }
      : { status: 'outside' }
  }

  const { wall } = containing
  const wallVector = sub(wall.end, wall.start)
  const wallLength = Math.hypot(wallVector[0], wallVector[1])
  const wallDirection = scale(wallVector, 1 / wallLength)
  const edgeDirection = normalize(sub(edgeEnd, edgeStart))
  const project = (parameter: number) =>
    dot(sub(add(edgeStart, scale(edgeDirection, parameter)), wall.start), wallDirection)
  const width = spanEnd - spanStart
  const rawOffset = Math.min(project(spanStart), project(spanEnd))
  // 只吸收容差内的端点误差，不做大范围平移。
  const offset = Math.min(Math.max(rawOffset, 0), Math.max(wallLength - width, 0))

  if (Math.abs(offset - rawOffset) > tolerance) return { status: 'outside' }

  return { status: 'bound', wallId: wall.id, offset, width }
}

/**
 * 修改外墙厚度时保持内表面不动：中心线沿室外方向平移 (新厚度 − 旧厚度)/2。
 * 非外墙（两侧均为房间或缺少 sides）只修改厚度。
 */
export function withWallThickness<T extends Wall>(wall: T, thickness: number): T {
  const sides = wall.sides
  const exteriorIndex = sides ? sides.findIndex((side) => side.kind === 'exterior') : -1
  const hasRoom = sides?.some((side) => side.kind === 'room') ?? false

  if (exteriorIndex < 0 || !hasRoom) return { ...wall, thickness }

  const direction = normalize(sub(wall.end, wall.start))
  const left = leftNormal(direction)
  const toExterior = exteriorIndex === 0 ? left : scale(left, -1)
  const shift = scale(toExterior, (thickness - wall.thickness) / 2)

  return { ...wall, thickness, start: add(wall.start, shift), end: add(wall.end, shift) }
}

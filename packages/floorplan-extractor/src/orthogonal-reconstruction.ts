import {
  isFloorPlanDraft,
  type FloorPlanDraft,
  type FloorPlanDraftOpening,
  type FloorPlanDraftRoom,
  type PixelPoint,
} from '@homescape/spatial-model'
import type {
  FloorPlanExtractionResult,
} from './types'
import type {
  FloorPlanGeometryObservationV01,
  GeometryAxis,
  GeometryOpeningObservation,
  GeometryRoomSeedObservation,
  GeometryWallObservation,
} from './geometry-observation'

interface NormalizedWall {
  id: string
  axis: GeometryAxis
  fixed: number
  start: number
  end: number
  confidence?: number
}

interface GridCell {
  x: number
  y: number
}

interface ReconstructedRoom {
  seed: GeometryRoomSeedObservation
  boundaryPx: PixelPoint[]
}

export interface OrthogonalGeometryReconstructorOptions {
  axisTolerancePx?: number
  snapTolerancePx?: number
  openingEdgeTolerancePx?: number
  lowConfidenceThreshold?: number
  wallThicknessMeters?: number
  ceilingHeightMeters?: number
  defaultDoorHeightMeters?: number
  defaultOpeningHeightMeters?: number
  defaultWindowHeightMeters?: number
  defaultWindowSillHeightMeters?: number
}

function pointKey(point: PixelPoint) {
  return point[0] + ',' + point[1]
}

function cellKey(x: number, y: number) {
  return x + ':' + y
}

function parseCellKey(value: string): GridCell {
  const parts = value.split(':')
  const x = Number(parts[0])
  const y = Number(parts[1])

  if (
    parts.length !== 2 ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    throw new Error('非法 Grid Cell Key：' + value)
  }

  return { x, y }
}

function clusterCoordinates(
  values: readonly number[],
  tolerance: number,
) {
  const sorted = [...values].sort((a, b) => a - b)
  const clusters: number[][] = []

  for (const value of sorted) {
    const current = clusters.at(-1)

    if (
      !current ||
      Math.abs(
        value -
          current.reduce((sum, item) => sum + item, 0) /
            current.length,
      ) > tolerance
    ) {
      clusters.push([value])
    } else {
      current.push(value)
    }
  }

  return clusters.map(
    (cluster) =>
      cluster.reduce((sum, item) => sum + item, 0) /
      cluster.length,
  )
}

function nearestCoordinate(
  value: number,
  coordinates: readonly number[],
) {
  let best = coordinates[0]

  if (best === undefined) {
    throw new Error('缺少 Grid Coordinate')
  }

  for (const candidate of coordinates) {
    if (Math.abs(candidate - value) < Math.abs(best - value)) {
      best = candidate
    }
  }

  return best
}

function normalizeWall(
  wall: GeometryWallObservation,
  axisTolerancePx: number,
): NormalizedWall | undefined {
  const dx = wall.endPx[0] - wall.startPx[0]
  const dy = wall.endPx[1] - wall.startPx[1]

  if (Math.abs(dy) <= axisTolerancePx && Math.abs(dx) > axisTolerancePx) {
    return {
      id: wall.id,
      axis: 'horizontal',
      fixed: (wall.startPx[1] + wall.endPx[1]) / 2,
      start: Math.min(wall.startPx[0], wall.endPx[0]),
      end: Math.max(wall.startPx[0], wall.endPx[0]),
      ...(wall.confidence !== undefined
        ? { confidence: wall.confidence }
        : {}),
    }
  }

  if (Math.abs(dx) <= axisTolerancePx && Math.abs(dy) > axisTolerancePx) {
    return {
      id: wall.id,
      axis: 'vertical',
      fixed: (wall.startPx[0] + wall.endPx[0]) / 2,
      start: Math.min(wall.startPx[1], wall.endPx[1]),
      end: Math.max(wall.startPx[1], wall.endPx[1]),
      ...(wall.confidence !== undefined
        ? { confidence: wall.confidence }
        : {}),
    }
  }

  return undefined
}

function horizontalEdgeKey(x: number, y: number) {
  return 'h:' + x + ':' + y
}

function verticalEdgeKey(x: number, y: number) {
  return 'v:' + x + ':' + y
}

function buildBlockedEdges(
  walls: readonly NormalizedWall[],
  xs: readonly number[],
  ys: readonly number[],
  snapTolerancePx: number,
) {
  const blocked = new Set<string>()

  for (const wall of walls) {
    if (wall.axis === 'horizontal') {
      const y = nearestCoordinate(wall.fixed, ys)
      const yIndex = ys.indexOf(y)

      for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
        const start = xs[xIndex]
        const end = xs[xIndex + 1]

        if (
          start !== undefined &&
          end !== undefined &&
          start >= wall.start - snapTolerancePx &&
          end <= wall.end + snapTolerancePx
        ) {
          blocked.add(horizontalEdgeKey(xIndex, yIndex))
        }
      }

      continue
    }

    const x = nearestCoordinate(wall.fixed, xs)
    const xIndex = xs.indexOf(x)

    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      const start = ys[yIndex]
      const end = ys[yIndex + 1]

      if (
        start !== undefined &&
        end !== undefined &&
        start >= wall.start - snapTolerancePx &&
        end <= wall.end + snapTolerancePx
      ) {
        blocked.add(verticalEdgeKey(xIndex, yIndex))
      }
    }
  }

  return blocked
}

function findContainingCell(
  point: PixelPoint,
  xs: readonly number[],
  ys: readonly number[],
) {
  const epsilon = 1e-6
  let xIndex = -1
  let yIndex = -1

  for (let index = 0; index < xs.length - 1; index += 1) {
    const start = xs[index]
    const end = xs[index + 1]

    if (
      start !== undefined &&
      end !== undefined &&
      point[0] > start + epsilon &&
      point[0] < end - epsilon
    ) {
      xIndex = index
      break
    }
  }

  for (let index = 0; index < ys.length - 1; index += 1) {
    const start = ys[index]
    const end = ys[index + 1]

    if (
      start !== undefined &&
      end !== undefined &&
      point[1] > start + epsilon &&
      point[1] < end - epsilon
    ) {
      yIndex = index
      break
    }
  }

  if (xIndex < 0 || yIndex < 0) {
    return undefined
  }

  return { x: xIndex, y: yIndex }
}

function floodFill(
  start: GridCell,
  xs: readonly number[],
  ys: readonly number[],
  blocked: ReadonlySet<string>,
) {
  const visited = new Set<string>()
  const queue = [start]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    const key = cellKey(current.x, current.y)
    if (visited.has(key)) continue
    visited.add(key)

    const neighbors = [
      {
        cell: { x: current.x - 1, y: current.y },
        blocked: verticalEdgeKey(current.x, current.y),
      },
      {
        cell: { x: current.x + 1, y: current.y },
        blocked: verticalEdgeKey(current.x + 1, current.y),
      },
      {
        cell: { x: current.x, y: current.y - 1 },
        blocked: horizontalEdgeKey(current.x, current.y),
      },
      {
        cell: { x: current.x, y: current.y + 1 },
        blocked: horizontalEdgeKey(current.x, current.y + 1),
      },
    ]

    for (const neighbor of neighbors) {
      if (
        neighbor.cell.x < 0 ||
        neighbor.cell.y < 0 ||
        neighbor.cell.x >= xs.length - 1 ||
        neighbor.cell.y >= ys.length - 1 ||
        blocked.has(neighbor.blocked) ||
        visited.has(cellKey(neighbor.cell.x, neighbor.cell.y))
      ) {
        continue
      }

      queue.push(neighbor.cell)
    }
  }

  return visited
}

interface BoundaryEdge {
  start: PixelPoint
  end: PixelPoint
}

function boundaryEdges(
  cells: ReadonlySet<string>,
  xs: readonly number[],
  ys: readonly number[],
) {
  const edges: BoundaryEdge[] = []

  for (const key of cells) {
    const cell = parseCellKey(key)
    const x0 = xs[cell.x]
    const x1 = xs[cell.x + 1]
    const y0 = ys[cell.y]
    const y1 = ys[cell.y + 1]

    if (
      x0 === undefined ||
      x1 === undefined ||
      y0 === undefined ||
      y1 === undefined
    ) {
      throw new Error('Grid Cell 越界：' + key)
    }

    if (!cells.has(cellKey(cell.x, cell.y - 1))) {
      edges.push({ start: [x0, y0], end: [x1, y0] })
    }
    if (!cells.has(cellKey(cell.x + 1, cell.y))) {
      edges.push({ start: [x1, y0], end: [x1, y1] })
    }
    if (!cells.has(cellKey(cell.x, cell.y + 1))) {
      edges.push({ start: [x1, y1], end: [x0, y1] })
    }
    if (!cells.has(cellKey(cell.x - 1, cell.y))) {
      edges.push({ start: [x0, y1], end: [x0, y0] })
    }
  }

  return edges
}

function simplifyCollinear(points: readonly PixelPoint[]) {
  if (points.length <= 3) return [...points]

  const simplified: PixelPoint[] = []

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (!previous || !current || !next) continue

    const sameX =
      Math.abs(previous[0] - current[0]) <= 1e-9 &&
      Math.abs(current[0] - next[0]) <= 1e-9
    const sameY =
      Math.abs(previous[1] - current[1]) <= 1e-9 &&
      Math.abs(current[1] - next[1]) <= 1e-9

    if (!sameX && !sameY) {
      simplified.push(current)
    }
  }

  return simplified
}

function traceBoundary(edges: readonly BoundaryEdge[]) {
  const outgoing = new Map<string, BoundaryEdge[]>()

  for (const edge of edges) {
    const key = pointKey(edge.start)
    const current = outgoing.get(key) ?? []
    current.push(edge)
    outgoing.set(key, current)
  }

  const unused = new Set(edges)
  const loops: PixelPoint[][] = []

  while (unused.size > 0) {
    const first = unused.values().next().value as BoundaryEdge | undefined
    if (!first) break

    const loop: PixelPoint[] = [first.start]
    let current = first
    unused.delete(current)

    for (let guard = 0; guard <= edges.length; guard += 1) {
      loop.push(current.end)

      if (pointKey(current.end) === pointKey(first.start)) {
        loop.pop()
        break
      }

      const nextCandidates = (outgoing.get(pointKey(current.end)) ?? [])
        .filter((candidate) => unused.has(candidate))

      if (nextCandidates.length !== 1) {
        throw new Error(
          'Room Boundary 无法唯一追踪，候选边数：' +
            nextCandidates.length,
        )
      }

      current = nextCandidates[0]!
      unused.delete(current)
    }

    if (
      loop.length < 3 ||
      pointKey(current.end) !== pointKey(first.start)
    ) {
      throw new Error('Room Boundary 未闭合')
    }

    loops.push(simplifyCollinear(loop))
  }

  if (loops.length !== 1) {
    throw new Error(
      '当前 Baseline 不支持带孔洞 Room，Boundary Loop=' +
        loops.length,
    )
  }

  return loops[0]!
}

function reconstructRooms(
  observation: FloorPlanGeometryObservationV01,
  walls: readonly NormalizedWall[],
  snapTolerancePx: number,
) {
  const xValues = walls
    .filter((wall) => wall.axis === 'vertical')
    .map((wall) => wall.fixed)
  const yValues = walls
    .filter((wall) => wall.axis === 'horizontal')
    .map((wall) => wall.fixed)
  const xs = clusterCoordinates(xValues, snapTolerancePx)
  const ys = clusterCoordinates(yValues, snapTolerancePx)

  if (xs.length < 2 || ys.length < 2) {
    throw new Error('墙线不足以形成二维 Grid')
  }

  const blocked = buildBlockedEdges(walls, xs, ys, snapTolerancePx)
  const reconstructed: ReconstructedRoom[] = []
  const componentOwners = new Map<string, string>()

  for (const seed of observation.roomSeeds) {
    const start = findContainingCell(seed.pointPx, xs, ys)

    if (!start) {
      throw new Error(
        'Room Seed 不在可重建 Grid Cell 内：' + seed.id,
      )
    }

    const cells = floodFill(start, xs, ys, blocked)
    const fingerprint = [...cells].sort().join('|')
    const owner = componentOwners.get(fingerprint)

    if (owner) {
      throw new Error(
        '多个 Room Seed 落在同一连通空间：' +
          owner +
          ', ' +
          seed.id,
      )
    }

    componentOwners.set(fingerprint, seed.id)
    reconstructed.push({
      seed,
      boundaryPx: traceBoundary(boundaryEdges(cells, xs, ys)),
    })
  }

  return reconstructed
}

function edgeAxis(start: PixelPoint, end: PixelPoint): GeometryAxis {
  return Math.abs(end[0] - start[0]) >=
    Math.abs(end[1] - start[1])
    ? 'horizontal'
    : 'vertical'
}

function openingRangesOverlap(
  left: FloorPlanDraftOpening,
  right: FloorPlanDraftOpening,
) {
  if (
    left.roomId !== right.roomId ||
    left.edgeIndex !== right.edgeIndex
  ) {
    return false
  }

  const leftEnd = left.offsetPx + left.widthPx
  const rightEnd = right.offsetPx + right.widthPx

  return (
    Math.min(leftEnd, rightEnd) -
      Math.max(left.offsetPx, right.offsetPx) >
    1e-6
  )
}

function openingHeight(
  opening: GeometryOpeningObservation,
  options: Required<
    Pick<
      OrthogonalGeometryReconstructorOptions,
      | 'defaultDoorHeightMeters'
      | 'defaultOpeningHeightMeters'
      | 'defaultWindowHeightMeters'
    >
  >,
) {
  if (opening.heightMeters !== undefined) {
    return opening.heightMeters
  }

  if (opening.kind === 'window') {
    return options.defaultWindowHeightMeters
  }

  if (opening.kind === 'opening') {
    return options.defaultOpeningHeightMeters
  }

  return options.defaultDoorHeightMeters
}

function mapOpening(
  opening: GeometryOpeningObservation,
  rooms: readonly FloorPlanDraftRoom[],
  openingEdgeTolerancePx: number,
  defaults: Required<
    Pick<
      OrthogonalGeometryReconstructorOptions,
      | 'defaultDoorHeightMeters'
      | 'defaultOpeningHeightMeters'
      | 'defaultWindowHeightMeters'
      | 'defaultWindowSillHeightMeters'
    >
  >,
) {
  const targetRooms = opening.roomSeedId
    ? rooms.filter((room) => room.id === opening.roomSeedId)
    : rooms
  const candidates: Array<{
    room: FloorPlanDraftRoom
    edgeIndex: number
    offsetPx: number
    distance: number
  }> = []

  for (const room of targetRooms) {
    for (let edgeIndex = 0; edgeIndex < room.boundaryPx.length; edgeIndex += 1) {
      const start = room.boundaryPx[edgeIndex]
      const end =
        room.boundaryPx[
          (edgeIndex + 1) % room.boundaryPx.length
        ]

      if (!start || !end || edgeAxis(start, end) !== opening.orientation) {
        continue
      }

      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const length = Math.hypot(dx, dy)

      if (length <= 1e-9 || opening.widthPx > length + openingEdgeTolerancePx) {
        continue
      }

      const ux = dx / length
      const uy = dy / length
      const vx = opening.centerPx[0] - start[0]
      const vy = opening.centerPx[1] - start[1]
      const projection = vx * ux + vy * uy
      const perpendicular = Math.abs(vx * uy - vy * ux)
      const rawOffset = projection - opening.widthPx / 2

      if (
        perpendicular > openingEdgeTolerancePx ||
        rawOffset < -openingEdgeTolerancePx ||
        rawOffset + opening.widthPx >
          length + openingEdgeTolerancePx
      ) {
        continue
      }

      candidates.push({
        room,
        edgeIndex,
        offsetPx: Math.min(
          Math.max(rawOffset, 0),
          Math.max(0, length - opening.widthPx),
        ),
        distance: perpendicular,
      })
    }
  }

  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.room.id.localeCompare(b.room.id) ||
      a.edgeIndex - b.edgeIndex,
  )
  const best = candidates[0]

  if (!best) {
    return undefined
  }

  const result: FloorPlanDraftOpening = {
    id: opening.id,
    roomId: best.room.id,
    edgeIndex: best.edgeIndex,
    kind: opening.kind,
    offsetPx: best.offsetPx,
    widthPx: opening.widthPx,
    heightMeters: openingHeight(opening, defaults),
    ...(opening.kind === 'window'
      ? {
          sillHeightMeters:
            opening.sillHeightMeters ??
            defaults.defaultWindowSillHeightMeters,
        }
      : opening.sillHeightMeters !== undefined
        ? { sillHeightMeters: opening.sillHeightMeters }
        : {}),
    ...(opening.swing !== undefined
      ? { swing: opening.swing }
      : {}),
    ...(opening.confidence !== undefined
      ? { confidence: opening.confidence }
      : {}),
  }

  return {
    opening: result,
    ambiguous:
      !opening.roomSeedId &&
      candidates.length > 1 &&
      Math.abs(candidates[1]!.distance - best.distance) <= 0.5,
  }
}

export class OrthogonalGeometryReconstructor {
  readonly id = 'orthogonal-geometry-v0.1'

  private readonly options: Required<OrthogonalGeometryReconstructorOptions>

  constructor(options: OrthogonalGeometryReconstructorOptions = {}) {
    this.options = {
      axisTolerancePx: options.axisTolerancePx ?? 6,
      snapTolerancePx: options.snapTolerancePx ?? 4,
      openingEdgeTolerancePx: options.openingEdgeTolerancePx ?? 12,
      lowConfidenceThreshold: options.lowConfidenceThreshold ?? 0.75,
      wallThicknessMeters: options.wallThicknessMeters ?? 0.12,
      ceilingHeightMeters: options.ceilingHeightMeters ?? 2.8,
      defaultDoorHeightMeters: options.defaultDoorHeightMeters ?? 2.1,
      defaultOpeningHeightMeters:
        options.defaultOpeningHeightMeters ?? 2.4,
      defaultWindowHeightMeters:
        options.defaultWindowHeightMeters ?? 1.5,
      defaultWindowSillHeightMeters:
        options.defaultWindowSillHeightMeters ?? 0.9,
    }

    for (const [key, value] of Object.entries(this.options)) {
      if (key === 'lowConfidenceThreshold') continue

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(key + ' 必须为正数')
      }
    }

    if (
      !Number.isFinite(this.options.lowConfidenceThreshold) ||
      this.options.lowConfidenceThreshold < 0 ||
      this.options.lowConfidenceThreshold > 1
    ) {
      throw new Error('lowConfidenceThreshold 必须位于 0~1')
    }

    if (
      this.options.defaultDoorHeightMeters >
        this.options.ceilingHeightMeters ||
      this.options.defaultOpeningHeightMeters >
        this.options.ceilingHeightMeters ||
      this.options.defaultWindowHeightMeters +
        this.options.defaultWindowSillHeightMeters >
        this.options.ceilingHeightMeters
    ) {
      throw new Error(
        '默认 Opening / Window 垂直尺寸不能超过默认层高',
      )
    }
  }

  reconstruct(
    observation: FloorPlanGeometryObservationV01,
  ): FloorPlanExtractionResult {
    const startedAt = performance.now()
    const warnings: string[] = []
    const walls: NormalizedWall[] = []

    for (const wall of observation.walls) {
      const normalized = normalizeWall(
        wall,
        this.options.axisTolerancePx,
      )

      if (!normalized) {
        warnings.push('忽略非正交墙线：' + wall.id)
        continue
      }

      if (
        normalized.confidence !== undefined &&
        normalized.confidence < this.options.lowConfidenceThreshold
      ) {
        warnings.push('低置信度墙线：' + wall.id)
      }

      walls.push(normalized)
    }

    if (walls.length < 4) {
      throw new Error('可用正交墙线不足 4 条')
    }

    const reconstructedRooms = reconstructRooms(
      observation,
      walls,
      this.options.snapTolerancePx,
    )
    const rooms: FloorPlanDraftRoom[] = reconstructedRooms.map(
      ({ seed, boundaryPx }, index) => ({
        id: seed.id,
        name: seed.name ?? '房间 ' + (index + 1),
        boundaryPx,
        ...(seed.type !== undefined ? { type: seed.type } : {}),
        ...(seed.confidence !== undefined
          ? { confidence: seed.confidence }
          : {}),
      }),
    )
    const openings: FloorPlanDraftOpening[] = []

    for (const opening of observation.openings) {
      const mapped = mapOpening(
        opening,
        rooms,
        this.options.openingEdgeTolerancePx,
        this.options,
      )

      if (!mapped) {
        warnings.push('Opening 无法映射到 Room Edge：' + opening.id)
        continue
      }

      if (mapped.ambiguous) {
        warnings.push('Opening Room 归属存在歧义：' + opening.id)
      }

      if (opening.heightMeters === undefined) {
        warnings.push('Opening 使用默认高度：' + opening.id)
      }

      if (
        opening.kind === 'window' &&
        opening.sillHeightMeters === undefined
      ) {
        warnings.push('Window 使用默认窗台高度：' + opening.id)
      }

      const sill = mapped.opening.sillHeightMeters ?? 0

      if (
        sill + mapped.opening.heightMeters >
        (observation.assumptions?.ceilingHeightMeters ??
          this.options.ceilingHeightMeters) +
          1e-9
      ) {
        warnings.push(
          'Opening 垂直尺寸超过默认/观测层高，已忽略：' +
            opening.id,
        )
        continue
      }

      const overlap = openings.find((existing) =>
        openingRangesOverlap(existing, mapped.opening),
      )

      if (overlap) {
        warnings.push(
          'Opening 与同一 Room Edge 上的 Observation 重叠：' +
            overlap.id +
            ', ' +
            opening.id,
        )
      }

      openings.push(mapped.opening)
    }

    for (const seed of observation.roomSeeds) {
      if (
        seed.confidence !== undefined &&
        seed.confidence < this.options.lowConfidenceThreshold
      ) {
        warnings.push('低置信度 Room Seed：' + seed.id)
      }
    }

    if (
      observation.calibration.confidence !== undefined &&
      observation.calibration.confidence <
        this.options.lowConfidenceThreshold
    ) {
      warnings.push('Calibration confidence 低')
    }

    const draft: FloorPlanDraft = {
      schemaVersion: '0.1.0',
      source: observation.source,
      calibration: {
        startPx: observation.calibration.startPx,
        endPx: observation.calibration.endPx,
        realDistanceMeters:
          observation.calibration.realDistanceMeters,
      },
      assumptions: {
        wallThicknessMeters:
          observation.assumptions?.wallThicknessMeters ??
          this.options.wallThicknessMeters,
        ceilingHeightMeters:
          observation.assumptions?.ceilingHeightMeters ??
          this.options.ceilingHeightMeters,
        wallThicknessConfirmed: false,
        ceilingHeightConfirmed: false,
      },
      rooms,
      openings,
    }

    if (!isFloorPlanDraft(draft)) {
      throw new Error('Geometry Reconstruction 生成了非法 FloorPlanDraft')
    }

    return {
      draft,
      metadata: {
        extractorId: this.id,
        provider: 'deterministic',
        model: 'orthogonal-grid-reconstruction-v0.1',
        latencyMs: performance.now() - startedAt,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
    }
  }
}

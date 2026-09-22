import type {
  GeometryRoomSeedObservation,
} from './geometry-observation'
import {
  uniqueLineCoordinates,
  type DetectedAxisLine,
} from './raster-line-analysis'

interface GridCell {
  x: number
  y: number
}

interface ComponentSeed {
  pointPx: readonly [number, number]
  top: number
  left: number
}

function cellKey(x: number, y: number) {
  return x + ':' + y
}

function parseCellKey(value: string) {
  const parts = value.split(':')
  const x = Number(parts[0])
  const y = Number(parts[1])

  if (
    parts.length !== 2 ||
    !Number.isInteger(x) ||
    !Number.isInteger(y)
  ) {
    throw new Error('非法 Raster Grid Cell：' + value)
  }

  return { x, y }
}

function horizontalEdgeKey(x: number, y: number) {
  return 'h:' + x + ':' + y
}

function verticalEdgeKey(x: number, y: number) {
  return 'v:' + x + ':' + y
}

function nearestIndex(value: number, coordinates: readonly number[]) {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index]
    if (coordinate === undefined) continue

    const distance = Math.abs(coordinate - value)

    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  }

  return bestIndex
}

function blockedEdges(
  lines: readonly DetectedAxisLine[],
  xs: readonly number[],
  ys: readonly number[],
) {
  const blocked = new Set<string>()

  for (const line of lines) {
    if (line.axis === 'horizontal') {
      const yIndex = nearestIndex(line.fixed, ys)

      for (let xIndex = 0; xIndex < xs.length - 1; xIndex += 1) {
        const start = xs[xIndex]
        const end = xs[xIndex + 1]

        if (
          start !== undefined &&
          end !== undefined &&
          start >= line.start - 1 &&
          end <= line.end + 1
        ) {
          blocked.add(horizontalEdgeKey(xIndex, yIndex))
        }
      }

      continue
    }

    const xIndex = nearestIndex(line.fixed, xs)

    for (let yIndex = 0; yIndex < ys.length - 1; yIndex += 1) {
      const start = ys[yIndex]
      const end = ys[yIndex + 1]

      if (
        start !== undefined &&
        end !== undefined &&
        start >= line.start - 1 &&
        end <= line.end + 1
      ) {
        blocked.add(verticalEdgeKey(xIndex, yIndex))
      }
    }
  }

  return blocked
}

function floodComponent(
  start: GridCell,
  remaining: Set<string>,
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
    remaining.delete(key)

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
      const nextKey = cellKey(neighbor.cell.x, neighbor.cell.y)

      if (
        neighbor.cell.x < 0 ||
        neighbor.cell.y < 0 ||
        neighbor.cell.x >= xs.length - 1 ||
        neighbor.cell.y >= ys.length - 1 ||
        blocked.has(neighbor.blocked) ||
        visited.has(nextKey)
      ) {
        continue
      }

      queue.push(neighbor.cell)
    }
  }

  return visited
}

function componentSeed(
  cells: ReadonlySet<string>,
  xs: readonly number[],
  ys: readonly number[],
): ComponentSeed {
  let best:
    | {
        area: number
        cell: GridCell
      }
    | undefined
  let top = Number.POSITIVE_INFINITY
  let left = Number.POSITIVE_INFINITY

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
      continue
    }

    const area = Math.abs((x1 - x0) * (y1 - y0))

    if (
      !best ||
      area > best.area ||
      (area === best.area &&
        (cell.y < best.cell.y ||
          (cell.y === best.cell.y && cell.x < best.cell.x)))
    ) {
      best = { area, cell }
    }

    top = Math.min(top, y0)
    left = Math.min(left, x0)
  }

  if (!best) {
    throw new Error('Raster Component 为空')
  }

  const x0 = xs[best.cell.x]
  const x1 = xs[best.cell.x + 1]
  const y0 = ys[best.cell.y]
  const y1 = ys[best.cell.y + 1]

  if (
    x0 === undefined ||
    x1 === undefined ||
    y0 === undefined ||
    y1 === undefined
  ) {
    throw new Error('Raster Component Seed 越界')
  }

  return {
    pointPx: [(x0 + x1) / 2, (y0 + y1) / 2],
    top,
    left,
  }
}

export function deriveRasterRoomSeeds(
  lines: readonly DetectedAxisLine[],
) {
  const xs = uniqueLineCoordinates(lines, 'vertical')
  const ys = uniqueLineCoordinates(lines, 'horizontal')

  if (xs.length < 2 || ys.length < 2) {
    throw new Error('Raster Wall Lines 无法形成二维 Grid')
  }

  const blocked = blockedEdges(lines, xs, ys)
  const remaining = new Set<string>()

  for (let x = 0; x < xs.length - 1; x += 1) {
    for (let y = 0; y < ys.length - 1; y += 1) {
      remaining.add(cellKey(x, y))
    }
  }

  const seeds: ComponentSeed[] = []

  while (remaining.size > 0) {
    const next = remaining.values().next()
    if (next.done) break

    const start = parseCellKey(next.value)
    const component = floodComponent(
      start,
      remaining,
      xs,
      ys,
      blocked,
    )
    seeds.push(componentSeed(component, xs, ys))
  }

  seeds.sort((a, b) => a.top - b.top || a.left - b.left)

  return seeds.map<GeometryRoomSeedObservation>((seed, index) => ({
    id: 'raster-room-' + String(index + 1).padStart(3, '0'),
    pointPx: seed.pointPx,
  }))
}

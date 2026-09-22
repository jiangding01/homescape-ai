import type { GeometryAxis } from './geometry-observation'
import type { RasterImage } from './raster-image'

interface Interval {
  start: number
  end: number
}

export interface DetectedAxisLine {
  axis: GeometryAxis
  fixed: number
  start: number
  end: number
}

export interface DetectedGap {
  axis: GeometryAxis
  fixed: number
  start: number
  end: number
}

export interface RasterAxisDetection {
  lines: readonly DetectedAxisLine[]
  gaps: readonly DetectedGap[]
}

function matchingRuns(
  values: Uint8Array,
  matches: (value: number) => boolean,
  minLength: number,
) {
  const runs: Interval[] = []
  let start = -1

  for (let index = 0; index < values.length; index += 1) {
    const active = matches(values[index] ?? 255)

    if (active && start < 0) {
      start = index
    }

    const atEnd = index === values.length - 1

    if (start >= 0 && (!active || atEnd)) {
      const end = active && atEnd ? index : index - 1

      if (end - start + 1 >= minLength) {
        runs.push({ start, end })
      }

      start = -1
    }
  }

  return runs
}

function rowValues(image: RasterImage, y: number) {
  const start = y * image.width
  return image.luminance.subarray(start, start + image.width)
}

function columnValues(image: RasterImage, x: number) {
  const values = new Uint8Array(image.height)

  for (let y = 0; y < image.height; y += 1) {
    values[y] = image.luminance[y * image.width + x] ?? 255
  }

  return values
}

function consecutiveBands(indices: readonly number[]) {
  const bands: number[][] = []
  let current: number[] = []
  let previous: number | undefined

  for (const index of indices) {
    if (
      previous === undefined ||
      index <= previous + 1
    ) {
      current.push(index)
    } else {
      if (current.length > 0) bands.push(current)
      current = [index]
    }

    previous = index
  }

  if (current.length > 0) bands.push(current)

  return bands
}

function unionCoverage(
  length: number,
  scans: ReadonlyMap<number, readonly Interval[]>,
  band: readonly number[],
) {
  const coverage = new Uint8Array(length)

  for (const index of band) {
    const intervals = scans.get(index) ?? []

    for (const interval of intervals) {
      coverage.fill(1, interval.start, interval.end + 1)
    }
  }

  return coverage
}

function mergeIntervalsWithOpenings(
  intervals: readonly Interval[],
  minOpeningPx: number,
  maxOpeningPx: number,
) {
  const lines: Interval[] = []
  const gaps: Interval[] = []
  let cursor = 0

  while (cursor < intervals.length) {
    const first = intervals[cursor]
    if (!first) break

    const start = first.start
    let end = first.end
    let nextIndex = cursor + 1

    while (nextIndex < intervals.length) {
      const next = intervals[nextIndex]
      if (!next) break

      const gapStart = end + 1
      const gapEnd = next.start - 1
      const gapWidth = gapEnd - gapStart + 1

      if (gapWidth < minOpeningPx) {
        end = next.end
        nextIndex += 1
        continue
      }

      if (gapWidth <= maxOpeningPx) {
        gaps.push({ start: gapStart, end: gapEnd })
        end = next.end
        nextIndex += 1
        continue
      }

      break
    }

    lines.push({ start, end })
    cursor = nextIndex
  }

  return { lines, gaps }
}

export function detectRasterAxis(
  image: RasterImage,
  axis: GeometryAxis,
  threshold: number,
  minRunPx: number,
  minLineThicknessPx: number,
  minOpeningPx: number,
  maxOpeningPx: number,
): RasterAxisDetection {
  const scanCount =
    axis === 'horizontal' ? image.height : image.width
  const runLength =
    axis === 'horizontal' ? image.width : image.height
  const scans = new Map<number, readonly Interval[]>()

  for (let index = 0; index < scanCount; index += 1) {
    const values =
      axis === 'horizontal'
        ? rowValues(image, index)
        : columnValues(image, index)
    const runs = matchingRuns(
      values,
      (value) => value <= threshold,
      minRunPx,
    )

    if (runs.length > 0) {
      scans.set(index, runs)
    }
  }

  const bands = consecutiveBands(
    [...scans.keys()].sort((a, b) => a - b),
  )
  const lines: DetectedAxisLine[] = []
  const gaps: DetectedGap[] = []

  for (const band of bands) {
    if (band.length < minLineThicknessPx) continue

    const coverage = unionCoverage(runLength, scans, band)
    const intervals = matchingRuns(
      coverage,
      (value) => value > 0,
      minRunPx,
    )
    const merged = mergeIntervalsWithOpenings(
      intervals,
      minOpeningPx,
      maxOpeningPx,
    )
    const fixed =
      band.reduce((sum, value) => sum + value, 0) /
      band.length

    for (const interval of merged.lines) {
      lines.push({
        axis,
        fixed,
        start: interval.start,
        end: interval.end,
      })
    }

    for (const gap of merged.gaps) {
      gaps.push({
        axis,
        fixed,
        start: gap.start,
        end: gap.end,
      })
    }
  }

  return { lines, gaps }
}

export function uniqueLineCoordinates(
  lines: readonly DetectedAxisLine[],
  axis: GeometryAxis,
) {
  return [
    ...new Set(
      lines
        .filter((line) => line.axis === axis)
        .map((line) => line.fixed),
    ),
  ].sort((a, b) => a - b)
}

import type {
  FloorPlanExtractorInput,
} from './types'
import type {
  FloorPlanGeometryDetectionResult,
  FloorPlanGeometryDetector,
  FloorPlanGeometryObservationV01,
  GeometryOpeningObservation,
  GeometryWallObservation,
} from './geometry-observation'
import type { RasterImageDecoder } from './raster-image'
import {
  detectRasterAxis,
  uniqueLineCoordinates,
  type DetectedAxisLine,
  type DetectedGap,
} from './raster-line-analysis'
import { deriveRasterRoomSeeds } from './raster-room-seeds'

export interface RasterGeometryDetectorOptions {
  darkThreshold?: number
  minWallRunRatio?: number
  minWallRunPx?: number
  minLineThicknessPx?: number
  minOpeningWidthRatio?: number
  maxOpeningWidthRatio?: number
  largeOpeningWidthRatio?: number
  pixelsPerMeter?: number
  wallThicknessMeters?: number
  ceilingHeightMeters?: number
}

function assertUnitInterval(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(label + ' 必须位于 0~1')
  }

  return value
}

function assertPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(label + ' 必须为正数')
  }

  return value
}

function assertPositiveInteger(value: number, label: string) {
  assertPositive(value, label)

  if (!Number.isInteger(value)) {
    throw new Error(label + ' 必须为整数')
  }

  return value
}

function classifyOpening(
  gap: DetectedGap,
  lines: readonly DetectedAxisLine[],
  largeOpeningPx: number,
) {
  const horizontal = uniqueLineCoordinates(
    lines,
    'horizontal',
  )
  const vertical = uniqueLineCoordinates(lines, 'vertical')
  const minHorizontal = horizontal[0]
  const maxHorizontal = horizontal.at(-1)
  const minVertical = vertical[0]
  const maxVertical = vertical.at(-1)
  const outer =
    gap.axis === 'horizontal'
      ? gap.fixed === minHorizontal ||
        gap.fixed === maxHorizontal
      : gap.fixed === minVertical ||
        gap.fixed === maxVertical

  if (outer) return 'window' as const

  const width = gap.end - gap.start + 1
  return width >= largeOpeningPx
    ? ('opening' as const)
    : ('door' as const)
}

function toWallObservations(
  lines: readonly DetectedAxisLine[],
) {
  return lines.map<GeometryWallObservation>((line, index) => ({
    id:
      'raster-wall-' +
      String(index + 1).padStart(3, '0'),
    startPx:
      line.axis === 'horizontal'
        ? [line.start, line.fixed]
        : [line.fixed, line.start],
    endPx:
      line.axis === 'horizontal'
        ? [line.end, line.fixed]
        : [line.fixed, line.end],
  }))
}

function toOpeningObservations(
  gaps: readonly DetectedGap[],
  lines: readonly DetectedAxisLine[],
  largeOpeningPx: number,
) {
  return gaps.map<GeometryOpeningObservation>((gap, index) => ({
    id:
      'raster-opening-' +
      String(index + 1).padStart(3, '0'),
    kind: classifyOpening(gap, lines, largeOpeningPx),
    centerPx:
      gap.axis === 'horizontal'
        ? [(gap.start + gap.end) / 2, gap.fixed]
        : [gap.fixed, (gap.start + gap.end) / 2],
    widthPx: gap.end - gap.start + 1,
    orientation: gap.axis,
  }))
}

function calibrationFromLines(
  lines: readonly DetectedAxisLine[],
  pixelsPerMeter: number,
) {
  const xs = uniqueLineCoordinates(lines, 'vertical')
  const ys = uniqueLineCoordinates(lines, 'horizontal')
  const minX = xs[0]
  const maxX = xs.at(-1)
  const maxY = ys.at(-1)

  if (
    minX === undefined ||
    maxX === undefined ||
    maxY === undefined ||
    maxX - minX <= 0
  ) {
    throw new Error(
      '无法从 Raster Wall Lines 建立 Calibration',
    )
  }

  const distancePx = Math.min(
    pixelsPerMeter,
    maxX - minX,
  )

  return {
    startPx: [minX, maxY] as const,
    endPx: [minX + distancePx, maxY] as const,
    realDistanceMeters: distancePx / pixelsPerMeter,
  }
}

export class RasterGeometryDetector
  implements FloorPlanGeometryDetector
{
  readonly id = 'raster-orthogonal-v0.1'

  private readonly decoder: RasterImageDecoder
  private readonly options: Required<RasterGeometryDetectorOptions>

  constructor(
    decoder: RasterImageDecoder,
    options: RasterGeometryDetectorOptions = {},
  ) {
    if (!decoder.id.trim()) {
      throw new Error('RasterImageDecoder.id 不能为空')
    }

    const pixelsPerMeter = assertPositive(
      options.pixelsPerMeter ?? 100,
      'pixelsPerMeter',
    )

    if (pixelsPerMeter > 10_000) {
      throw new Error('pixelsPerMeter 不能超过 10000')
    }

    this.decoder = decoder
    this.options = {
      darkThreshold:
        assertUnitInterval(
          (options.darkThreshold ?? 96) / 255,
          'darkThreshold / 255',
        ) * 255,
      minWallRunRatio: assertUnitInterval(
        options.minWallRunRatio ?? 0.08,
        'minWallRunRatio',
      ),
      minWallRunPx: assertPositiveInteger(
        options.minWallRunPx ?? 20,
        'minWallRunPx',
      ),
      minLineThicknessPx: assertPositiveInteger(
        options.minLineThicknessPx ?? 2,
        'minLineThicknessPx',
      ),
      minOpeningWidthRatio: assertUnitInterval(
        options.minOpeningWidthRatio ?? 0.05,
        'minOpeningWidthRatio',
      ),
      maxOpeningWidthRatio: assertUnitInterval(
        options.maxOpeningWidthRatio ?? 0.45,
        'maxOpeningWidthRatio',
      ),
      largeOpeningWidthRatio: assertUnitInterval(
        options.largeOpeningWidthRatio ?? 0.2,
        'largeOpeningWidthRatio',
      ),
      pixelsPerMeter,
      wallThicknessMeters: assertPositive(
        options.wallThicknessMeters ?? 0.12,
        'wallThicknessMeters',
      ),
      ceilingHeightMeters: assertPositive(
        options.ceilingHeightMeters ?? 2.8,
        'ceilingHeightMeters',
      ),
    }

    if (
      this.options.minOpeningWidthRatio <= 0 ||
      this.options.minOpeningWidthRatio >
        this.options.maxOpeningWidthRatio ||
      this.options.largeOpeningWidthRatio <
        this.options.minOpeningWidthRatio ||
      this.options.largeOpeningWidthRatio >
        this.options.maxOpeningWidthRatio
    ) {
      throw new Error('Opening Width 参数顺序无效')
    }
  }

  supports(
    input: Pick<
      FloorPlanExtractorInput,
      'kind' | 'mediaType'
    >,
  ) {
    return (
      input.kind === 'floorplan_image' &&
      this.decoder.supports(input.mediaType)
    )
  }

  async detect(
    input: FloorPlanExtractorInput,
  ): Promise<FloorPlanGeometryDetectionResult> {
    if (!this.supports(input)) {
      throw new Error(
        this.id +
          ' 不支持 ' +
          input.kind +
          ' / ' +
          input.mediaType,
      )
    }

    const sourceId = input.sourceId.trim()

    if (!sourceId) {
      throw new Error('Raster Image sourceId 不能为空')
    }

    if (input.bytes.byteLength === 0) {
      throw new Error('Raster Image 不能为空')
    }

    const image = await this.decoder.decode(input.bytes)

    if (
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width <= 0 ||
      image.height <= 0 ||
      image.luminance.length !==
        image.width * image.height
    ) {
      throw new Error('RasterImage Decoder 输出无效')
    }

    const minRunPx = Math.max(
      this.options.minWallRunPx,
      Math.round(
        Math.min(image.width, image.height) *
          this.options.minWallRunRatio,
      ),
    )
    const baseDimension = Math.min(
      image.width,
      image.height,
    )
    const minOpeningPx =
      this.options.minOpeningWidthRatio * baseDimension
    const maxOpeningPx =
      this.options.maxOpeningWidthRatio * baseDimension
    const largeOpeningPx =
      this.options.largeOpeningWidthRatio * baseDimension

    const horizontal = detectRasterAxis(
      image,
      'horizontal',
      this.options.darkThreshold,
      minRunPx,
      this.options.minLineThicknessPx,
      minOpeningPx,
      maxOpeningPx,
    )
    const vertical = detectRasterAxis(
      image,
      'vertical',
      this.options.darkThreshold,
      minRunPx,
      this.options.minLineThicknessPx,
      minOpeningPx,
      maxOpeningPx,
    )
    const lines = [
      ...horizontal.lines,
      ...vertical.lines,
    ]

    if (
      uniqueLineCoordinates(lines, 'horizontal').length <
        2 ||
      uniqueLineCoordinates(lines, 'vertical').length < 2
    ) {
      throw new Error(
        'Raster Image 未检测到完整正交外轮廓',
      )
    }

    const roomSeeds = deriveRasterRoomSeeds(lines)
    const gaps = [
      ...horizontal.gaps,
      ...vertical.gaps,
    ]
    const calibration = calibrationFromLines(
      lines,
      this.options.pixelsPerMeter,
    )
    const observation: FloorPlanGeometryObservationV01 = {
      schemaVersion: '0.1.0',
      source: {
        kind: 'floorplan_image',
        sourceLabel: sourceId,
        widthPx: image.width,
        heightPx: image.height,
      },
      calibration,
      assumptions: {
        wallThicknessMeters:
          this.options.wallThicknessMeters,
        ceilingHeightMeters:
          this.options.ceilingHeightMeters,
      },
      walls: toWallObservations(lines),
      roomSeeds,
      openings: toOpeningObservations(
        gaps,
        lines,
        largeOpeningPx,
      ),
    }

    return {
      observation,
      provider: 'deterministic',
      model: this.id + '+' + this.decoder.id,
      costUsd: 0,
      warnings: [
        'Calibration 使用 pixelsPerMeter 假设：' +
          this.options.pixelsPerMeter,
        'Room Seed 仅来自几何连通域，未包含 Room Semantic',
        'Opening Kind 使用外轮廓 / 宽度启发式，需要 Human Review',
      ],
    }
  }
}

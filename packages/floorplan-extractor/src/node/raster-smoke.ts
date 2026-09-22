import sharp from 'sharp'
import { GeometryFloorPlanExtractor } from '../geometry-extractor'
import { OrthogonalGeometryReconstructor } from '../orthogonal-reconstruction'
import { RasterGeometryDetector } from '../raster-geometry-detector'
import { SharpRasterImageDecoder } from './sharp-raster-image-decoder'

const fixtureWidth = 800
const fixtureHeight = 600

interface FixtureRect {
  x: number
  y: number
  width: number
  height: number
}

const fixtureRects: readonly FixtureRect[] = [
  { x: 65, y: 65, width: 235, height: 11 },
  { x: 420, y: 65, width: 316, height: 11 },
  { x: 65, y: 525, width: 435, height: 11 },
  { x: 620, y: 525, width: 116, height: 11 },

  { x: 65, y: 295, width: 115, height: 11 },
  { x: 260, y: 295, width: 280, height: 11 },
  { x: 620, y: 295, width: 116, height: 11 },

  { x: 65, y: 65, width: 11, height: 471 },
  { x: 725, y: 65, width: 11, height: 471 },

  { x: 395, y: 65, width: 11, height: 115 },
  { x: 395, y: 260, width: 11, height: 130 },
  { x: 395, y: 470, width: 11, height: 66 },

  // Deliberately short decorative / text-like marks.
  { x: 130, y: 130, width: 16, height: 3 },
  { x: 135, y: 136, width: 16, height: 3 },
  { x: 520, y: 120, width: 21, height: 3 },
  { x: 520, y: 138, width: 21, height: 3 },
  { x: 520, y: 120, width: 3, height: 21 },
  { x: 538, y: 120, width: 3, height: 21 },
]

interface SmokeCase {
  label: string
  mediaType: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}

function buildRawFixture(
  channels: 3 | 4,
  transparentBackground: boolean,
) {
  const data = Buffer.alloc(
    fixtureWidth * fixtureHeight * channels,
    transparentBackground ? 0 : 255,
  )

  for (const rect of fixtureRects) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const offset = (y * fixtureWidth + x) * channels

        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0

        if (channels === 4) {
          data[offset + 3] = 255
        }
      }
    }
  }

  return data
}

async function buildCases(): Promise<readonly SmokeCase[]> {
  const opaque = buildRawFixture(3, false)
  const transparent = buildRawFixture(4, true)

  return [
    {
      label: 'png',
      mediaType: 'image/png',
      bytes: await sharp(opaque, {
        raw: {
          width: fixtureWidth,
          height: fixtureHeight,
          channels: 3,
        },
      })
        .png()
        .toBuffer(),
    },
    {
      label: 'transparent-png',
      mediaType: 'image/png',
      bytes: await sharp(transparent, {
        raw: {
          width: fixtureWidth,
          height: fixtureHeight,
          channels: 4,
        },
      })
        .png()
        .toBuffer(),
    },
    {
      label: 'jpeg',
      mediaType: 'image/jpeg',
      bytes: await sharp(opaque, {
        raw: {
          width: fixtureWidth,
          height: fixtureHeight,
          channels: 3,
        },
      })
        .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
        .toBuffer(),
    },
  ]
}

function openingSummary(
  openings: readonly {
    orientation: string
    centerPx: readonly [number, number]
    widthPx: number
  }[],
) {
  return openings
    .map(
      (opening) =>
        opening.orientation +
        '@' +
        opening.centerPx.join(',') +
        ':' +
        opening.widthPx,
    )
    .join(' | ')
}

async function main() {
  const decoder = new SharpRasterImageDecoder()

  if (
    !decoder.supports('image/png; charset=binary') ||
    !decoder.supports('image/jpeg') ||
    decoder.supports('image/webp')
  ) {
    throw new Error('SharpRasterImageDecoder MIME Gate 无效')
  }

  const reconstructor = new OrthogonalGeometryReconstructor()
  const cases = await buildCases()

  for (const testCase of cases) {
    const detector = new RasterGeometryDetector(decoder)
    const input = {
      sourceId: 'synthetic-raster-smoke',
      kind: 'floorplan_image' as const,
      mediaType: testCase.mediaType,
      filename: 'private-customer-address.png',
      bytes: testCase.bytes,
    }
    const detected = await detector.detect(input)

    if (
      detected.observation.source.widthPx !== fixtureWidth ||
      detected.observation.source.heightPx !== fixtureHeight
    ) {
      throw new Error(
        testCase.label +
          ' Raster 尺寸不匹配：' +
          detected.observation.source.widthPx +
          'x' +
          detected.observation.source.heightPx,
      )
    }

    if (
      detected.observation.source.sourceLabel !==
      input.sourceId
    ) {
      throw new Error(
        testCase.label +
          ' sourceLabel 不应继承本地文件名',
      )
    }

    if (detected.observation.walls.length !== 6) {
      throw new Error(
        testCase.label +
          ' Wall 数不匹配：' +
          detected.observation.walls.length +
          ' != 6',
      )
    }

    if (detected.observation.roomSeeds.length !== 4) {
      throw new Error(
        testCase.label +
          ' Room Seed 数不匹配：' +
          detected.observation.roomSeeds.length +
          ' != 4',
      )
    }

    if (detected.observation.openings.length !== 6) {
      throw new Error(
        testCase.label +
          ' Opening Observation 数不匹配：' +
          detected.observation.openings.length +
          ' != 6；实际=' +
          openingSummary(detected.observation.openings),
      )
    }

    const result = reconstructor.reconstruct(
      detected.observation,
    )
    const extractor = new GeometryFloorPlanExtractor(detector, {
      extractorId: 'raster-orthogonal-v0.1',
    })
    const extracted = await extractor.extract(input)

    if (result.draft.rooms.length !== 4) {
      throw new Error(
        testCase.label +
          ' Room 数不匹配：' +
          result.draft.rooms.length +
          ' != 4',
      )
    }

    if (result.draft.openings.length !== 6) {
      throw new Error(
        testCase.label +
          ' Opening 数不匹配：' +
          result.draft.openings.length +
          ' != 6',
      )
    }

    if (
      extracted.draft.rooms.length !== result.draft.rooms.length ||
      extracted.draft.openings.length !==
        result.draft.openings.length ||
      extracted.metadata.extractorId !==
        'raster-orthogonal-v0.1'
    ) {
      throw new Error(
        testCase.label +
          ' GeometryFloorPlanExtractor 组合链路不一致',
      )
    }

    if (
      result.draft.assumptions.wallThicknessConfirmed ||
      result.draft.assumptions.ceilingHeightConfirmed
    ) {
      throw new Error(
        testCase.label +
          ' 不应自动确认墙厚或层高',
      )
    }
  }

  process.stderr.write(
    'Raster Geometry E2E smoke passed · PNG + transparent PNG + JPEG\n',
  )
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.stack ?? error.message : String(error)) +
      '\n',
  )
  process.exitCode = 1
})

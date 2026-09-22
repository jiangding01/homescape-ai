import sharp from 'sharp'
import { GeometryFloorPlanExtractor } from '../geometry-extractor'
import { OrthogonalGeometryReconstructor } from '../orthogonal-reconstruction'
import { RasterGeometryDetector } from '../raster-geometry-detector'
import { SharpRasterImageDecoder } from './sharp-raster-image-decoder'

const syntheticPlan = `
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect width="800" height="600" fill="white"/>
  <g fill="black">
    <rect x="65" y="65" width="235" height="11"/>
    <rect x="420" y="65" width="316" height="11"/>
    <rect x="65" y="525" width="435" height="11"/>
    <rect x="620" y="525" width="116" height="11"/>

    <rect x="65" y="295" width="115" height="11"/>
    <rect x="260" y="295" width="280" height="11"/>
    <rect x="620" y="295" width="116" height="11"/>

    <rect x="65" y="65" width="11" height="471"/>
    <rect x="725" y="65" width="11" height="471"/>

    <rect x="395" y="65" width="11" height="115"/>
    <rect x="395" y="260" width="11" height="130"/>
    <rect x="395" y="470" width="11" height="66"/>

    <rect x="130" y="130" width="16" height="3"/>
    <rect x="135" y="136" width="16" height="3"/>
    <rect x="520" y="120" width="21" height="3"/>
    <rect x="520" y="138" width="21" height="3"/>
    <rect x="520" y="120" width="3" height="21"/>
    <rect x="538" y="120" width="3" height="21"/>
  </g>
</svg>
`

interface SmokeCase {
  label: string
  mediaType: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
}

async function buildCases(): Promise<readonly SmokeCase[]> {
  const source = Buffer.from(syntheticPlan)
  const transparentSource = Buffer.from(
    syntheticPlan.replace(
      '<rect width="800" height="600" fill="white"/>',
      '',
    ),
  )

  return [
    {
      label: 'png',
      mediaType: 'image/png',
      bytes: await sharp(source).png().toBuffer(),
    },
    {
      label: 'transparent-png',
      mediaType: 'image/png',
      bytes: await sharp(transparentSource).png().toBuffer(),
    },
    {
      label: 'jpeg',
      mediaType: 'image/jpeg',
      bytes: await sharp(source)
        .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
        .toBuffer(),
    },
  ]
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
          ' != 6',
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

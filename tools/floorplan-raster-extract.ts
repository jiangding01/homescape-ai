import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, dirname, resolve } from 'node:path'
import process from 'node:process'
import {
  GeometryFloorPlanExtractor,
  RasterGeometryDetector,
} from '@homescape/floorplan-extractor'
import {
  SharpRasterImageDecoder,
} from '@homescape/floorplan-extractor/node'

function usage() {
  return [
    '用法：',
    '  tsx tools/floorplan-raster-extract.ts',
    '    <input.png|jpg|jpeg> <candidate.json>',
    '    [--metadata <record.json>]',
    '    [--source-id <anonymous-case-id>]',
    '    [--pixels-per-meter <number>]',
  ].join('\n')
}

function mediaTypeForPath(path: string) {
  const extension = extname(path).toLowerCase()

  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }

  throw new Error('当前只支持 PNG / JPEG')
}

function parseArgs(argv: string[]) {
  const args = [...argv]
  const inputValue = args.shift()
  const outputValue = args.shift()

  if (
    !inputValue ||
    !outputValue ||
    inputValue.startsWith('-') ||
    outputValue.startsWith('-')
  ) {
    throw new Error(usage())
  }

  let metadataPath: string | undefined
  let sourceId: string | undefined
  let pixelsPerMeter = 100

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--metadata') {
      const value = args.shift()
      if (!value) throw new Error('--metadata 缺少文件路径')
      metadataPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--source-id') {
      const value = args.shift()
      if (!value?.trim()) throw new Error('--source-id 不能为空')
      sourceId = value.trim()
      continue
    }

    if (arg === '--pixels-per-meter') {
      const value = args.shift()
      const parsed = value ? Number(value) : Number.NaN

      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--pixels-per-meter 必须为正数')
      }

      pixelsPerMeter = parsed
      continue
    }

    throw new Error('未知参数：' + arg + '\n' + usage())
  }

  return {
    inputPath: resolve(process.cwd(), inputValue),
    outputPath: resolve(process.cwd(), outputValue),
    metadataPath,
    sourceId,
    pixelsPerMeter,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const bytes = await readFile(args.inputPath)

  if (bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error('Raw Floor Plan Image 不能超过 20MB')
  }

  const digest = createHash('sha256').update(bytes).digest('hex')
  const sourceId =
    args.sourceId ?? 'floorplan-' + digest.slice(0, 16)
  const mediaType = mediaTypeForPath(args.inputPath)
  const detector = new RasterGeometryDetector(
    new SharpRasterImageDecoder(),
    {
      pixelsPerMeter: args.pixelsPerMeter,
    },
  )
  const extractor = new GeometryFloorPlanExtractor(detector, {
    extractorId: 'raster-orthogonal-v0.1',
  })
  const result = await extractor.extract({
    sourceId,
    kind: 'floorplan_image',
    mediaType,
    bytes,
  })

  await mkdir(dirname(args.outputPath), { recursive: true })
  await writeFile(
    args.outputPath,
    JSON.stringify(result.draft, null, 2) + '\n',
    'utf8',
  )

  if (args.metadataPath) {
    await mkdir(dirname(args.metadataPath), { recursive: true })
    await writeFile(
      args.metadataPath,
      JSON.stringify(
        {
          schemaVersion: '0.1.0',
          sourceId,
          generatedAt: new Date().toISOString(),
          metadata: result.metadata,
          ...(result.warnings
            ? { warnings: result.warnings }
            : {}),
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
  }

  process.stderr.write(
    [
      'Extractor: ' + result.metadata.extractorId,
      'Source ID: ' + sourceId,
      'Rooms: ' + result.draft.rooms.length,
      'Openings: ' + result.draft.openings.length,
      'Warnings: ' + (result.warnings?.length ?? 0),
      'Candidate: ' + args.outputPath,
      ...(args.metadataPath
        ? ['Metadata: ' + args.metadataPath]
        : []),
    ].join('\n') + '\n',
  )
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.stack ?? error.message : String(error)) +
      '\n',
  )
  process.exitCode = 1
})

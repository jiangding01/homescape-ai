import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import {
  FloorPlanExtractorRegistry,
  MetricStructuredFloorPlanExtractor,
} from '@homescape/floorplan-extractor'

function usage() {
  return [
    '用法：',
    '  tsx tools/floorplan-extract.ts <input.json> <output.json>',
    '    [--pixels-per-meter <number>]',
    '    [--extractor <id>]',
    '    [--metadata <record.json>]',
    '',
    '当前 Runner 注册 metric-structured-v0.1。',
  ].join('\n')
}

function parseArgs(argv: string[]) {
  const args = [...argv]
  const inputPath = args.shift()
  const outputPath = args.shift()

  if (
    !inputPath ||
    !outputPath ||
    inputPath.startsWith('-') ||
    outputPath.startsWith('-')
  ) {
    throw new Error(usage())
  }

  let pixelsPerMeter = 100
  let extractorId: string | undefined
  let metadataPath: string | undefined

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--extractor') {
      const value = args.shift()
      if (!value) throw new Error('--extractor 缺少 ID')
      extractorId = value
      continue
    }

    if (arg === '--metadata') {
      const value = args.shift()
      if (!value) throw new Error('--metadata 缺少文件路径')
      metadataPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--pixels-per-meter') {
      const raw = args.shift()
      const parsed = raw ? Number(raw) : Number.NaN

      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--pixels-per-meter 必须为正数')
      }

      pixelsPerMeter = parsed
      continue
    }

    throw new Error('未知参数：' + arg + '\n' + usage())
  }

  return {
    inputPath: resolve(process.cwd(), inputPath),
    outputPath: resolve(process.cwd(), outputPath),
    pixelsPerMeter,
    extractorId,
    metadataPath,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const bytes = await readFile(args.inputPath)
  const registry = new FloorPlanExtractorRegistry().register(
    new MetricStructuredFloorPlanExtractor({
      pixelsPerMeter: args.pixelsPerMeter,
    }),
  )
  const result = await registry.extract(
    {
      sourceId: basename(args.inputPath),
      kind: 'company_data',
      mediaType:
        'application/vnd.homescape.metric-floorplan+json',
      bytes,
      filename: basename(args.inputPath),
    },
    args.extractorId
      ? { extractorId: args.extractorId }
      : {},
  )

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
          sourceId: basename(args.inputPath),
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
      'Rooms: ' + result.draft.rooms.length,
      'Openings: ' + result.draft.openings.length,
      'Warnings: ' + (result.warnings?.length ?? 0),
      'Output: ' + args.outputPath,
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

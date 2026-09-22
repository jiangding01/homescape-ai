import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import process from 'node:process'
import {
  OrthogonalGeometryReconstructor,
  parseFloorPlanGeometryObservation,
} from '@homescape/floorplan-extractor'

function usage() {
  return [
    '用法：',
    '  tsx tools/floorplan-geometry-reconstruct.ts',
    '    <observation.json> <candidate.json>',
    '    [--metadata <record.json>]',
    '',
    '输入是 CV / Geometry Detector 的 Observation，不是原图。',
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

  let metadataPath: string | undefined

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--metadata') {
      const value = args.shift()
      if (!value) throw new Error('--metadata 缺少文件路径')
      metadataPath = resolve(process.cwd(), value)
      continue
    }

    throw new Error('未知参数：' + arg + '\n' + usage())
  }

  return {
    inputPath: resolve(process.cwd(), inputPath),
    outputPath: resolve(process.cwd(), outputPath),
    metadataPath,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const raw = JSON.parse(await readFile(args.inputPath, 'utf8'))
  const observation = parseFloorPlanGeometryObservation(raw)
  const result = new OrthogonalGeometryReconstructor().reconstruct(
    observation,
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
      'Reconstructor: ' + result.metadata.extractorId,
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

#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises'
import {
  dirname,
  extname,
  relative,
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DEFAULT_EXTRACTOR_ID = 'raster-orthogonal-v0.1'
const DEFAULT_BENCHMARK_THRESHOLDS = {
  roomMatchIou: 0.6,
  roomPrecisionMin: 0.95,
  roomRecallMin: 0.95,
  meanRoomIouMin: 0.9,
  roomTypeAccuracyMin: 0.9,
  candidateRoomOverlapRatioMax: 0.03,
  openingCenterToleranceRatio: 0.02,
  openingPrecisionMin: 0.9,
  openingRecallMin: 0.9,
  meanOpeningWidthErrorMax: 0.08,
  scaleErrorMax: 0.02,
}
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
)

function usage() {
  return [
    '用法：',
    '  node tools/floorplan-raster-batch.mjs <corpus.json>',
    '    [--pixels-per-meter <number>]',
    '    [--min-cases <number>]',
    '    [--corpus-report <report.json>]',
    '    [--report <report.json>]',
    '    [--benchmark-manifest <manifest.json>]',
    '    [--benchmark-report <report.json>]',
    '    [--experiment-manifest <manifest.json>]',
    '    [--dry-run]',
    '',
    '说明：',
    '  先执行 Corpus Gate，再为 PNG / JPEG Case 批量生成 Raster Candidate + Metadata。',
    '  同时生成 Benchmark Manifest 与 Pilot Experiment Manifest，避免真实 Pilot 手工拼装路径。',
    '  默认输出到 corpus 根目录下的 candidates/、metadata/、reports/。',
  ].join('\n')
}

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(usage() + '\n')
    return { help: true }
  }

  const args = [...argv]
  const manifestValue = args.shift()

  if (!manifestValue || manifestValue.startsWith('-')) {
    throw new Error(usage())
  }

  const extractorId = DEFAULT_EXTRACTOR_ID
  let pixelsPerMeter = 100
  let minCases = 10
  let corpusReportPath
  let reportPath
  let benchmarkManifestPath
  let benchmarkReportPath
  let experimentManifestPath
  let dryRun = false

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--pixels-per-meter') {
      const value = Number(args.shift())

      if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
        throw new Error('--pixels-per-meter 必须是 0~10000 内的正数')
      }

      pixelsPerMeter = value
      continue
    }

    if (arg === '--min-cases') {
      const value = Number(args.shift())

      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--min-cases 必须是 >= 1 的整数')
      }

      minCases = value
      continue
    }

    if (arg === '--corpus-report') {
      const value = args.shift()
      if (!value) throw new Error('--corpus-report 缺少文件路径')
      corpusReportPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--report') {
      const value = args.shift()
      if (!value) throw new Error('--report 缺少文件路径')
      reportPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--benchmark-manifest') {
      const value = args.shift()
      if (!value) throw new Error('--benchmark-manifest 缺少文件路径')
      benchmarkManifestPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--benchmark-report') {
      const value = args.shift()
      if (!value) throw new Error('--benchmark-report 缺少文件路径')
      benchmarkReportPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--experiment-manifest') {
      const value = args.shift()
      if (!value) throw new Error('--experiment-manifest 缺少文件路径')
      experimentManifestPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    throw new Error('未知参数：' + arg + '\n' + usage())
  }

  return {
    help: false,
    manifestPath: resolve(process.cwd(), manifestValue),
    extractorId,
    pixelsPerMeter,
    minCases,
    corpusReportPath,
    reportPath,
    benchmarkManifestPath,
    benchmarkReportPath,
    experimentManifestPath,
    dryRun,
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' 不能为空')
  }

  return value.trim()
}

function safeSegment(value, label) {
  const normalized = nonEmptyString(value, label)

  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    normalized.includes('\\')
  ) {
    throw new Error(label + ' 不能包含路径分隔符')
  }

  return normalized
}

function normalizeMediaType(value) {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function validateCorpus(value) {
  const manifest = asRecord(value)

  if (
    !manifest ||
    manifest.schemaVersion !== '0.1.0' ||
    !Array.isArray(manifest.cases)
  ) {
    throw new Error('只支持 Floor Plan Corpus Manifest v0.1.0')
  }

  const dataset = nonEmptyString(manifest.dataset, 'dataset')
  const seen = new Set()
  const cases = manifest.cases.map((rawCase, index) => {
    const corpusCase = asRecord(rawCase)
    const label = 'cases[' + index + ']'

    if (!corpusCase) throw new Error(label + ' 格式无效')

    const id = safeSegment(corpusCase.id, label + '.id')

    if (seen.has(id)) {
      throw new Error('Corpus Case ID 重复：' + id)
    }
    seen.add(id)

    if (corpusCase.sourceKind !== 'floorplan_image') {
      throw new Error(
        label +
          '.sourceKind 必须是 floorplan_image，当前 Raster Batch 不处理 PDF / company_data',
      )
    }

    const mediaType = normalizeMediaType(
      nonEmptyString(corpusCase.mediaType, label + '.mediaType'),
    )

    if (!['image/png', 'image/jpeg'].includes(mediaType)) {
      throw new Error(
        label + '.mediaType 当前只支持 image/png / image/jpeg',
      )
    }

    return {
      id,
      mediaType,
      sourcePath: nonEmptyString(
        corpusCase.sourcePath,
        label + '.sourcePath',
      ),
      groundTruthPath: nonEmptyString(
        corpusCase.groundTruthPath,
        label + '.groundTruthPath',
      ),
    }
  })

  return { dataset, cases }
}

function portableRelative(root, target) {
  return relative(root, target).split(sep).join('/')
}

function assertOutputWithinRoot(root, target, label) {
  const rel = relative(resolve(root), resolve(target))

  if (rel === '..' || rel.startsWith('..' + sep) || resolve(root) === resolve(target)) {
    throw new Error(label + ' 必须位于 Corpus 目录内')
  }

  return resolve(target)
}

async function resolveWithinRoot(root, pathValue, label) {
  const target = resolve(root, pathValue)
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target),
  ])
  const rel = relative(realRoot, realTarget)

  if (rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error(label + ' 越过 Corpus 目录')
  }

  return realTarget
}

function assertExtensionMatches(path, mediaType, label) {
  const extension = extname(path).toLowerCase()

  if (mediaType === 'image/png' && extension !== '.png') {
    throw new Error(label + ' mediaType=image/png 但文件扩展名不是 .png')
  }

  if (
    mediaType === 'image/jpeg' &&
    !['.jpg', '.jpeg'].includes(extension)
  ) {
    throw new Error(
      label + ' mediaType=image/jpeg 但文件扩展名不是 .jpg/.jpeg',
    )
  }
}

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(label + ' 失败，exit=' + result.status)
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(
      label +
        ' 无法读取：' +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return

  const root = dirname(args.manifestPath)
  const manifest = validateCorpus(
    await readJson(args.manifestPath, 'Corpus Manifest'),
  )

  if (manifest.cases.length < args.minCases) {
    throw new Error(
      'Raster Pilot Case 数不足：' +
        manifest.cases.length +
        ' < ' +
        args.minCases,
    )
  }

  const corpusReportPath =
    args.corpusReportPath ??
    resolve(root, 'reports/corpus-summary.json')
  const reportPath =
    args.reportPath ??
    resolve(root, 'reports/raster-batch.json')
  const benchmarkManifestPath =
    args.benchmarkManifestPath ??
    resolve(root, 'benchmark-raster.json')
  const benchmarkReportPath =
    args.benchmarkReportPath ??
    resolve(root, 'reports/benchmark-raster.json')
  const experimentManifestPath =
    args.experimentManifestPath ??
    resolve(root, 'experiment-raster.json')

  for (const [label, path] of [
    ['corpus-report', corpusReportPath],
    ['report', reportPath],
    ['benchmark-manifest', benchmarkManifestPath],
    ['benchmark-report', benchmarkReportPath],
    ['experiment-manifest', experimentManifestPath],
  ]) {
    assertOutputWithinRoot(root, path, label)
  }

  await mkdir(dirname(corpusReportPath), { recursive: true })
  await mkdir(dirname(reportPath), { recursive: true })
  await mkdir(dirname(benchmarkManifestPath), { recursive: true })
  await mkdir(dirname(benchmarkReportPath), { recursive: true })
  await mkdir(dirname(experimentManifestPath), { recursive: true })

  run(
    process.execPath,
    [
      'tools/floorplan-corpus.mjs',
      args.manifestPath,
      '--min-cases',
      String(args.minCases),
      '--report',
      corpusReportPath,
    ],
    'Corpus Gate',
  )

  const corpusSummary = await readJson(
    corpusReportPath,
    'Corpus Summary',
  )

  if (
    corpusSummary.dataset !== manifest.dataset ||
    typeof corpusSummary.datasetFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(corpusSummary.datasetFingerprint)
  ) {
    throw new Error('Corpus Summary 与 Manifest / Fingerprint 不一致')
  }

  const candidateRoot = resolve(
    root,
    'candidates',
    args.extractorId,
  )
  const metadataRoot = resolve(
    root,
    'metadata',
    args.extractorId,
  )

  if (!args.dryRun) {
    await mkdir(candidateRoot, { recursive: true })
    await mkdir(metadataRoot, { recursive: true })
  }

  const outputs = []
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

  for (const [index, corpusCase] of manifest.cases.entries()) {
    const sourcePath = await resolveWithinRoot(
      root,
      corpusCase.sourcePath,
      'cases[' + index + '].sourcePath',
    )
    assertExtensionMatches(
      sourcePath,
      corpusCase.mediaType,
      'cases[' + index + ']',
    )

    const candidatePath = resolve(
      candidateRoot,
      corpusCase.id + '.json',
    )
    const metadataPath = resolve(
      metadataRoot,
      corpusCase.id + '.json',
    )

    outputs.push({
      caseId: corpusCase.id,
      sourcePath: corpusCase.sourcePath,
      groundTruthPath: corpusCase.groundTruthPath,
      candidatePath: portableRelative(root, candidatePath),
      extractionMetadataPath: portableRelative(root, metadataPath),
      reviewBurdenPath:
        'review/' + args.extractorId + '/' + corpusCase.id + '.json',
    })

    if (args.dryRun) continue

    run(
      pnpm,
      [
        'exec',
        'tsx',
        'tools/floorplan-raster-extract.ts',
        sourcePath,
        candidatePath,
        '--metadata',
        metadataPath,
        '--source-id',
        corpusCase.id,
        '--pixels-per-meter',
        String(args.pixelsPerMeter),
      ],
      'Raster Extract ' + corpusCase.id,
    )
  }

  const benchmarkManifest = {
    schemaVersion: '0.1.0',
    dataset: manifest.dataset,
    gridSize: 128,
    thresholds: DEFAULT_BENCHMARK_THRESHOLDS,
    cases: outputs.map((item) => ({
      id: item.caseId,
      sourcePath: item.sourcePath,
      groundTruthPath: item.groundTruthPath,
      candidates: [
        {
          extractorId: args.extractorId,
          candidatePath: item.candidatePath,
        },
      ],
    })),
  }

  const experimentManifest = {
    schemaVersion: '0.1.0',
    dataset: manifest.dataset,
    datasetFingerprint: corpusSummary.datasetFingerprint,
    corpusManifestPath: portableRelative(root, args.manifestPath),
    corpusSummaryPath: portableRelative(root, corpusReportPath),
    benchmarkReportPath: portableRelative(root, benchmarkReportPath),
    runs: outputs.map((item) => ({
      caseId: item.caseId,
      extractorId: args.extractorId,
      candidatePath: item.candidatePath,
      extractionMetadataPath: item.extractionMetadataPath,
      reviewBurdenPath: item.reviewBurdenPath,
    })),
  }

  await writeFile(
    benchmarkManifestPath,
    JSON.stringify(benchmarkManifest, null, 2) + '\n',
    'utf8',
  )
  await writeFile(
    experimentManifestPath,
    JSON.stringify(experimentManifest, null, 2) + '\n',
    'utf8',
  )

  const report = {
    schemaVersion: '0.1.0',
    dataset: manifest.dataset,
    datasetFingerprint: corpusSummary.datasetFingerprint,
    generatedAt: new Date().toISOString(),
    extractorId: args.extractorId,
    pixelsPerMeter: args.pixelsPerMeter,
    caseCount: outputs.length,
    dryRun: args.dryRun,
    benchmarkManifestPath: portableRelative(root, benchmarkManifestPath),
    benchmarkReportPath: portableRelative(root, benchmarkReportPath),
    experimentManifestPath: portableRelative(root, experimentManifestPath),
    cases: outputs.map(({ sourcePath, groundTruthPath, reviewBurdenPath, ...item }) => item),
  }

  const output = JSON.stringify(report, null, 2) + '\n'
  await writeFile(reportPath, output, 'utf8')
  process.stdout.write(output)

  process.stderr.write(
    [
      '',
      'Raster Pilot Batch · ' + manifest.dataset,
      'Fingerprint · ' + corpusSummary.datasetFingerprint,
      'Extractor · ' + args.extractorId,
      'Cases · ' + outputs.length,
      'Mode · ' + (args.dryRun ? 'dry-run' : 'extract'),
      'Report · ' + reportPath,
      'Benchmark Manifest · ' + benchmarkManifestPath,
      'Experiment Manifest · ' + experimentManifestPath,
      '',
      'Next · pnpm floorplan:benchmark -- ' +
        benchmarkManifestPath +
        ' --report ' +
        benchmarkReportPath,
      'Then · pnpm floorplan:pilot -- ' +
        experimentManifestPath +
        ' --min-cases ' +
        args.minCases +
        ' --require-corpus-coverage --require-complete-review --require-complete-metadata',
      '',
    ].join('\n'),
  )
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.stack ?? error.message : String(error)) +
      '\n',
  )
  process.exitCode = 1
})

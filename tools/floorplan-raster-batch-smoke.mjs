#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

function fail(message) {
  throw new Error(message)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const root = await mkdtemp(join(tmpdir(), 'homescape-raster-batch-'))

try {
  await mkdir(join(root, 'sources'), { recursive: true })
  await mkdir(join(root, 'ground-truth'), { recursive: true })

  // Dry-run 只需要验证 Corpus / 路径编排；真正 Raster Decode 已由 floorplan:raster:check-demo 覆盖。
  await writeFile(join(root, 'sources', 'plan-a.png'), 'synthetic-a', 'utf8')
  await writeFile(join(root, 'sources', 'plan-b.png'), 'synthetic-b', 'utf8')
  await cp(
    resolve('tools/fixtures/floorplan-benchmark/ground-truth/plan-a.json'),
    join(root, 'ground-truth', 'plan-a.json'),
  )
  await cp(
    resolve('tools/fixtures/floorplan-benchmark/ground-truth/plan-b.json'),
    join(root, 'ground-truth', 'plan-b.json'),
  )

  const corpus = {
    schemaVersion: '0.1.0',
    dataset: 'raster-batch-smoke-v1',
    cases: [
      {
        id: 'plan-a',
        sourceKind: 'floorplan_image',
        mediaType: 'image/png',
        sourcePath: 'sources/plan-a.png',
        groundTruthPath: 'ground-truth/plan-a.json',
        tags: {
          quality: 'clean',
          geometry: 'rectangular',
          annotation: 'partial_dimension',
          layout: 'multi_room',
          symbols: 'standard',
          textDensity: 'normal',
        },
      },
      {
        id: 'plan-b',
        sourceKind: 'floorplan_image',
        mediaType: 'image/png',
        sourcePath: 'sources/plan-b.png',
        groundTruthPath: 'ground-truth/plan-b.json',
        tags: {
          quality: 'clean',
          geometry: 'rectangular',
          annotation: 'partial_dimension',
          layout: 'open_plan',
          symbols: 'standard',
          textDensity: 'normal',
        },
      },
    ],
  }

  const corpusPath = join(root, 'corpus.json')
  await writeFile(corpusPath, JSON.stringify(corpus, null, 2) + '\n', 'utf8')

  const result = spawnSync(
    process.execPath,
    [
      'tools/floorplan-raster-batch.mjs',
      corpusPath,
      '--min-cases',
      '2',
      '--dry-run',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  )

  if (result.error) throw result.error
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    fail('Raster Batch dry-run smoke 执行失败，exit=' + result.status)
  }

  const batch = await readJson(join(root, 'reports', 'raster-batch.json'))
  const benchmark = await readJson(join(root, 'benchmark-raster.json'))
  const experiment = await readJson(join(root, 'experiment-raster.json'))

  if (
    batch.dataset !== corpus.dataset ||
    batch.caseCount !== 2 ||
    batch.dryRun !== true ||
    typeof batch.datasetFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(batch.datasetFingerprint)
  ) {
    fail('Raster Batch Report 基础字段不正确')
  }

  if (
    benchmark.dataset !== corpus.dataset ||
    benchmark.cases.length !== 2 ||
    benchmark.cases[0]?.sourcePath !== 'sources/plan-a.png' ||
    benchmark.cases[1]?.sourcePath !== 'sources/plan-b.png' ||
    benchmark.cases[0]?.candidates[0]?.candidatePath !==
      'candidates/raster-orthogonal-v0.1/plan-a.json'
  ) {
    fail('Benchmark Manifest 生成不正确')
  }

  if (
    experiment.dataset !== corpus.dataset ||
    experiment.datasetFingerprint !== batch.datasetFingerprint ||
    experiment.benchmarkReportPath !== 'reports/benchmark-raster.json' ||
    experiment.runs.length !== 2 ||
    experiment.runs[0]?.reviewBurdenPath !==
      'review/raster-orthogonal-v0.1/plan-a.json'
  ) {
    fail('Pilot Experiment Manifest 生成不正确')
  }

  if (
    (await exists(
      join(
        root,
        'candidates',
        'raster-orthogonal-v0.1',
        'plan-a.json',
      ),
    )) ||
    (await exists(
      join(
        root,
        'metadata',
        'raster-orthogonal-v0.1',
        'plan-a.json',
      ),
    ))
  ) {
    fail('dry-run 不应生成 Candidate / Metadata')
  }

  // 错误输出位置必须在任何写入前拒绝：目录符号链接、文件符号链接与别名。
  const outside = await mkdtemp(join(tmpdir(), 'homescape-raster-escape-'))
  try {
    await symlink(outside, join(root, 'escape-link'), 'dir')
    await writeFile(join(outside, 'sentinel.json'), 'untouched', 'utf8')
    await symlink(
      join(outside, 'sentinel.json'),
      join(root, 'report-link.json'),
      'file',
    )

    function expectBatchRejected(args, expected, label) {
      const result = spawnSync(
        process.execPath,
        [
          'tools/floorplan-raster-batch.mjs',
          corpusPath,
          '--min-cases',
          '2',
          '--dry-run',
          ...args,
        ],
        { cwd: process.cwd(), encoding: 'utf8' },
      )

      if (result.error) throw result.error
      if (result.status === 0 || !result.stderr.includes(expected)) {
        fail(
          label +
            ' 应拒绝，status=' +
            result.status +
            '，stderr=' +
            result.stderr,
        )
      }
    }

    expectBatchRejected(
      ['--report', join(root, 'escape-link', 'escaped.json')],
      '越过 Corpus',
      '输出目录符号链接逃逸',
    )
    expectBatchRejected(
      ['--report', join(root, 'report-link.json')],
      '输出文件不能是符号链接',
      '输出文件符号链接',
    )
    expectBatchRejected(
      ['--report', join(root, 'benchmark-raster.json')],
      '输出路径冲突',
      '输出路径别名',
    )
    expectBatchRejected(
      ['--benchmark-report', join(root, 'benchmark-raster.json')],
      '输出路径冲突',
      'Benchmark 结果与 Manifest 共享目标',
    )
    expectBatchRejected(
      ['--report', join(root, 'ground-truth', 'plan-a.json')],
      'Corpus 输入文件路径冲突',
      'Report 不能覆盖 Ground Truth',
    )
    expectBatchRejected(
      ['--corpus-report', corpusPath],
      'Corpus 输入文件路径冲突',
      'Corpus Summary 不能覆盖 Corpus Manifest',
    )

    if ((await exists(join(outside, 'escaped.json'))) ||
        (await readFile(join(outside, 'sentinel.json'), 'utf8')) !== 'untouched') {
      fail('被拒绝的输出路径不能修改 Corpus 以外的文件')
    }
  } finally {
    await rm(outside, { recursive: true, force: true })
  }

  // 第二个 Case 的扩展名错误必须在任何 Candidate 写入前被发现。
  // 这里故意不加 --dry-run，以验证正常执行模式下的全量输入预检查。
  await writeFile(join(root, 'sources', 'plan-b.jpg'), 'synthetic-b', 'utf8')
  const invalidCorpus = structuredClone(corpus)
  invalidCorpus.cases[1].sourcePath = 'sources/plan-b.jpg'
  const invalidCorpusPath = join(root, 'invalid-corpus.json')
  await writeFile(
    invalidCorpusPath,
    JSON.stringify(invalidCorpus, null, 2) + '\n',
    'utf8',
  )

  const invalidResult = spawnSync(
    process.execPath,
    [
      'tools/floorplan-raster-batch.mjs',
      invalidCorpusPath,
      '--min-cases',
      '2',
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
  if (
    invalidResult.error ||
    invalidResult.status === 0 ||
    !invalidResult.stderr.includes('文件扩展名不是 .png') ||
    (await exists(join(root, 'candidates')))
  ) {
    fail(
      '后续 Case 无效时不得执行前面 Case 的 Extractor' +
        ' · status=' + invalidResult.status +
        ' · error=' + invalidResult.error +
        ' · stderr=' + invalidResult.stderr +
        ' · candidateRootExists=' + (await exists(join(root, 'candidates'))),
    )
  }

  process.stderr.write(
    'Raster Pilot batch smoke passed · manifests + unsafe paths + full preflight\n',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

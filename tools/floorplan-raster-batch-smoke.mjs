#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  access,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
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

  process.stderr.write(
    'Raster Pilot batch smoke passed · corpus gate + manifests + dry-run\n',
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

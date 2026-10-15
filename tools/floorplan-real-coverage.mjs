#!/usr/bin/env node
/**
 * Join real-Corpus GT coverage with pre-GT Raster Intake evidence.
 * This is NOT an image-quality Benchmark and never creates a Candidate.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const hex64 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const object = (value) => value && typeof value === 'object' && !Array.isArray(value)
const fail = (message) => { throw new Error(message) }

function parseArgs(argv) {
  let reportPath
  let extractorId
  const inputs = []
  const args = [...argv]
  while (args.length) {
    const arg = args.shift()
    if (arg === '--report') {
      reportPath = args.shift()
      if (!reportPath) fail('--report 缺少路径')
    } else if (arg === '--extractor-id') {
      extractorId = args.shift()
      if (!extractorId || !/^[a-z][a-z0-9._-]{1,63}$/.test(extractorId)) fail('--extractor-id 无效')
    } else if (arg?.startsWith('-')) {
      fail('未知参数 ' + arg)
    } else {
      inputs.push(arg)
    }
  }
  if (inputs.length < 2 || !extractorId) {
    fail('用法：node tools/floorplan-real-coverage.mjs <corpus-summary.json> <intake-report-a.json> [intake-report-b.json ...] --extractor-id raster-orthogonal-v0.1 [--report coverage.json]')
  }
  const corpusPath = resolve(inputs[0])
  const reportTarget = reportPath ? resolve(reportPath) : null
  if (reportTarget) {
    const root = dirname(corpusPath)
    const rel = relative(root, reportTarget)
    if (rel === '..' || rel.startsWith('..' + sep) || rel === '') {
      fail('Coverage 报告必须保存在 Corpus Summary 所在目录内的另一文件')
    }
    if (inputs.some((p) => resolve(p) === reportTarget)) fail('Coverage 报告不能覆盖输入文件')
  }
  return { corpusPath, intakePaths: inputs.slice(1).map((x) => resolve(x)), extractorId, reportTarget }
}

function checkCorpus(value) {
  if (!object(value) || value.schemaVersion !== '0.1.0' ||
      typeof value.dataset !== 'string' || !value.dataset.trim() ||
      !hex64(value.datasetFingerprint) || !Array.isArray(value.cases) ||
      !value.cases.length || value.caseCount !== value.cases.length) {
    fail('Corpus Summary 无效；必须先运行正式 floorplan:corpus Gate')
  }
  const records = new Map()
  for (const entry of value.cases) {
    if (!object(entry) || typeof entry.id !== 'string' || !entry.id ||
        !hex64(entry.sourceSha256) || !hex64(entry.groundTruthSha256) ||
        !hex64(entry.caseFingerprint) || records.has(entry.id)) {
      fail('Corpus Summary 含有无效或重复 Case')
    }
    records.set(entry.id, entry)
  }
  return records
}

function checkIntake(value) {
  if (!object(value) || value.schemaVersion !== '0.1.0' ||
      value.reportType !== 'real_floorplan_intake_pre_ground_truth' ||
      value.isOfficialCorpusFingerprint !== false ||
      !Array.isArray(value.cases)) {
    fail('Intake 报告合同不正确')
  }
  return value.cases
}

async function main() {
  const options = parseArgs(process.argv.slice(process.argv[2] === '--' ? 3 : 2))
  const corpusBytes = await readFile(options.corpusPath)
  const corpus = JSON.parse(corpusBytes.toString('utf8'))
  const corpusCases = checkCorpus(corpus)
  const found = new Map()

  for (const intakePath of options.intakePaths) {
    const intake = JSON.parse(await readFile(intakePath, 'utf8'))
    // Older Intake reports predate the extractorId field; when present it must match.
    if (object(intake) && intake.extractorId !== undefined &&
        intake.extractorId !== options.extractorId) {
      fail('Intake Report 的 extractorId 与 --extractor-id 不一致：' + String(intake.extractorId))
    }
    const entries = checkIntake(intake)
    for (const entry of entries) {
      if (!object(entry) || typeof entry.id !== 'string' || !entry.id ||
          !hex64(entry.sourceSha256)) fail('Intake 包含无效 Case 或 Source SHA')
      if (!corpusCases.has(entry.id)) continue
      if (found.has(entry.id)) fail('Case ' + entry.id + ' 在多个 Intake Report 中重复')
      const source = corpusCases.get(entry.id)
      if (entry.sourceSha256 !== source.sourceSha256) {
        fail(entry.id + ' Source SHA 与已确认 Corpus 不一致；禁止跨版本混用')
      }
      if (!['failed', 'generated_unverified', 'not_run'].includes(entry.candidateStatus)) {
        fail(entry.id + ' candidateStatus 无效')
      }
      if (entry.candidateStatus === 'failed' &&
          (typeof entry.failureCode !== 'string' || !entry.failureCode.trim())) {
        fail(entry.id + ' 缺少失败原因代码')
      }
      if (entry.candidateStatus === 'generated_unverified' &&
          !hex64(entry.candidateSha256)) {
        fail(entry.id + ' 未确认 Candidate 缺少哈希')
      }
      found.set(entry.id, {
        caseId: entry.id,
        candidateStatus: entry.candidateStatus,
        ...(entry.candidateStatus === 'failed' ? { failureCode: entry.failureCode } : {}),
        ...(entry.candidateStatus === 'generated_unverified' ? { candidateSha256: entry.candidateSha256 } : {}),
      })
    }
  }

  const missing = [...corpusCases.keys()].filter((id) => !found.has(id))
  if (missing.length) fail('以下已确认 Corpus Case 缺少 Intake 证据：' + missing.join(', '))
  const cases = [...found.values()].sort((a,b) => a.caseId.localeCompare(b.caseId))
  const failureCounts = {}
  const statusCounts = { failed: 0, generated_unverified: 0, not_run: 0 }
  for (const record of cases) {
    statusCounts[record.candidateStatus] += 1
    if (record.failureCode) failureCounts[record.failureCode] = (failureCounts[record.failureCode] ?? 0) + 1
  }
  const coverage = {
    schemaVersion: '0.1.0',
    reportType: 'real_floorplan_extraction_coverage',
    dataset: corpus.dataset,
    datasetFingerprint: corpus.datasetFingerprint,
    corpusSummarySha256: sha256(corpusBytes),
    extractorId: options.extractorId,
    groundTruthCaseCount: cases.length,
    ...statusCounts,
    failureCounts: Object.fromEntries(Object.entries(failureCounts).sort(([a],[b]) => a.localeCompare(b))),
    benchmarkStatus: 'not_evaluated',
    note: 'Candidate production coverage only. Failed extraction is not IoU=0; generated_unverified is not a successful Benchmark.',
    cases,
  }
  const output = JSON.stringify(coverage, null, 2) + '\n'
  if (options.reportTarget) {
    await mkdir(dirname(options.reportTarget), { recursive: true })
    await writeFile(options.reportTarget, output, { flag: 'wx' })
  }
  process.stdout.write(output)
}
main().catch((error) => {
  process.stderr.write((error?.stack ?? String(error)) + '\n')
  process.exitCode = 1
})

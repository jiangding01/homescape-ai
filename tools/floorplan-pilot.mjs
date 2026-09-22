#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const TAG_KEYS = [
  'quality',
  'geometry',
  'annotation',
  'layout',
  'symbols',
  'textDensity',
]

const TAG_VALUES = {
  quality: new Set(['clean', 'compressed', 'blurred', 'scanned']),
  geometry: new Set(['rectangular', 'l_shape', 'irregular']),
  annotation: new Set([
    'full_dimension',
    'partial_dimension',
    'no_dimension',
  ]),
  layout: new Set(['single_room', 'open_plan', 'multi_room']),
  symbols: new Set(['standard', 'mixed', 'unknown']),
  textDensity: new Set(['sparse', 'normal', 'dense', 'overlap']),
}

const EDIT_KEYS = [
  'roomVertexMoves',
  'roomMetadataEdits',
  'openingGeometryEdits',
  'calibrationEdits',
  'assumptionEdits',
  'resets',
]

function usage() {
  return [
    '用法：',
    '  node tools/floorplan-pilot.mjs <experiment.json>',
    '    [--report <report.json>]',
    '    [--min-cases <number>]',
    '    [--require-corpus-coverage]',
    '    [--require-complete-review]',
    '    [--require-complete-metadata]',
  ].join('\n')
}

function parseArgs(argv) {
  const args = [...argv]
  const manifestPath = args.shift()

  if (!manifestPath || manifestPath.startsWith('-')) {
    throw new Error(usage())
  }

  let reportPath
  let minCases = 1
  let requireCorpusCoverage = false
  let requireCompleteReview = false
  let requireCompleteMetadata = false

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--report') {
      const value = args.shift()
      if (!value) throw new Error('--report 缺少文件路径')
      reportPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--min-cases') {
      const value = args.shift()
      const parsed = value ? Number(value) : Number.NaN

      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error('--min-cases 必须是 >= 1 的整数')
      }

      minCases = parsed
      continue
    }

    if (arg === '--require-corpus-coverage') {
      requireCorpusCoverage = true
      continue
    }

    if (arg === '--require-complete-review') {
      requireCompleteReview = true
      continue
    }

    if (arg === '--require-complete-metadata') {
      requireCompleteMetadata = true
      continue
    }

    throw new Error('未知参数：' + arg + '\n' + usage())
  }

  return {
    manifestPath: resolve(process.cwd(), manifestPath),
    reportPath,
    minCases,
    requireCorpusCoverage,
    requireCompleteReview,
    requireCompleteMetadata,
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

  return value
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(label + ' 必须是有限数值')
  }

  return value
}

function nonNegativeNumber(value, label) {
  const result = finiteNumber(value, label)

  if (result < 0) {
    throw new Error(label + ' 不能小于 0')
  }

  return result
}

function nonNegativeInteger(value, label) {
  const result = nonNegativeNumber(value, label)

  if (!Number.isInteger(result)) {
    throw new Error(label + ' 必须是整数')
  }

  return result
}

function ratio(value, label) {
  const result = finiteNumber(value, label)

  if (result < 0 || result > 1) {
    throw new Error(label + ' 必须位于 0~1')
  }

  return result
}

function optionalFinite(value, label) {
  if (value === undefined || value === null) return undefined
  return finiteNumber(value, label)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readJson(path, label) {
  let bytes

  try {
    bytes = await readFile(path)
  } catch (error) {
    throw new Error(
      label +
        ' 无法读取：' +
        (error instanceof Error ? error.message : String(error)),
    )
  }

  try {
    return {
      bytes,
      value: JSON.parse(bytes.toString('utf8')),
    }
  } catch (error) {
    throw new Error(
      label +
        ' JSON 无法解析：' +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

async function resolveWithinRoot(root, pathValue, label) {
  const target = resolve(root, nonEmptyString(pathValue, label))
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target),
  ])
  const rel = relative(realRoot, realTarget)

  if (rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error(label + ' 越过 Experiment 目录')
  }

  return realTarget
}

function validateTags(value, label) {
  const tags = asRecord(value)
  if (!tags) throw new Error(label + ' tags 格式无效')

  const normalized = {}

  for (const key of TAG_KEYS) {
    const value = nonEmptyString(
      tags[key],
      label + '.tags.' + key,
    )

    if (!TAG_VALUES[key].has(value)) {
      throw new Error(
        label + '.tags.' + key + ' 无效：' + value,
      )
    }

    normalized[key] = value
  }

  return normalized
}

function validateCorpusManifest(value, dataset) {
  const manifest = asRecord(value)

  if (
    !manifest ||
    manifest.schemaVersion !== '0.1.0' ||
    manifest.dataset !== dataset ||
    !Array.isArray(manifest.cases)
  ) {
    throw new Error('Corpus Manifest 与 Experiment 不匹配')
  }

  const cases = new Map()

  for (const [index, rawCase] of manifest.cases.entries()) {
    const corpusCase = asRecord(rawCase)
    const label = 'corpus.cases[' + index + ']'

    if (!corpusCase) throw new Error(label + ' 格式无效')

    const id = nonEmptyString(corpusCase.id, label + '.id')

    if (cases.has(id)) {
      throw new Error('Corpus Case ID 重复：' + id)
    }

    const sourceKind = nonEmptyString(
      corpusCase.sourceKind,
      label + '.sourceKind',
    )

    if (
      !['floorplan_image', 'floorplan_pdf', 'company_data'].includes(
        sourceKind,
      )
    ) {
      throw new Error(label + '.sourceKind 无效：' + sourceKind)
    }

    cases.set(id, {
      sourceKind,
      tags: validateTags(corpusCase.tags, label),
    })
  }

  return cases
}

function validateCorpusSummary(value, dataset, fingerprint, caseIds) {
  const summary = asRecord(value)

  if (
    !summary ||
    summary.schemaVersion !== '0.1.0' ||
    summary.dataset !== dataset ||
    summary.datasetFingerprint !== fingerprint ||
    !Array.isArray(summary.cases) ||
    !Number.isInteger(summary.caseCount) ||
    summary.caseCount !== summary.cases.length ||
    typeof summary.checkedAt !== 'string' ||
    Number.isNaN(Date.parse(summary.checkedAt))
  ) {
    throw new Error('Corpus Summary 与 Experiment Fingerprint 不匹配')
  }

  const summaryCases = new Map()

  for (const [index, entry] of summary.cases.entries()) {
    const record = asRecord(entry)

    if (!record) {
      throw new Error(
        'corpus-summary.cases[' + index + '] 格式无效',
      )
    }

    const id = nonEmptyString(
      record.id,
      'corpus-summary.cases[' + index + '].id',
    )

    if (summaryCases.has(id)) {
      throw new Error('Corpus Summary Case ID 重复：' + id)
    }

    const caseFingerprint = nonEmptyString(
      record.caseFingerprint,
      'corpus-summary.' + id + '.caseFingerprint',
    )
    const sourceSha256 = nonEmptyString(
      record.sourceSha256,
      'corpus-summary.' + id + '.sourceSha256',
    )
    const groundTruthSha256 = nonEmptyString(
      record.groundTruthSha256,
      'corpus-summary.' + id + '.groundTruthSha256',
    )

    for (const [hashLabel, hash] of [
      ['caseFingerprint', caseFingerprint],
      ['sourceSha256', sourceSha256],
      ['groundTruthSha256', groundTruthSha256],
    ]) {
      if (!/^[a-f0-9]{64}$/i.test(hash)) {
        throw new Error(
          'corpus-summary.' +
            id +
            '.' +
            hashLabel +
            ' 必须是 SHA-256 hex',
        )
      }
    }

    const sourceBytes = nonNegativeInteger(
      record.sourceBytes,
      'corpus-summary.' + id + '.sourceBytes',
    )

    if (sourceBytes <= 0) {
      throw new Error(
        'corpus-summary.' + id + '.sourceBytes 必须大于 0',
      )
    }

    summaryCases.set(id, {
      roomCount: nonNegativeInteger(
        record.roomCount,
        'corpus-summary.' + id + '.roomCount',
      ),
      openingCount: nonNegativeInteger(
        record.openingCount,
        'corpus-summary.' + id + '.openingCount',
      ),
    })
  }

  const expectedIds = [...caseIds]

  if (summaryCases.size !== expectedIds.length) {
    throw new Error(
      'Corpus Summary Case 数与 Corpus Manifest 不一致',
    )
  }

  for (const id of expectedIds) {
    if (!summaryCases.has(id)) {
      throw new Error('Corpus Summary 缺少 Case：' + id)
    }
  }

  return summaryCases
}

function validateMetrics(value, label) {
  const metrics = asRecord(value)
  if (!metrics) throw new Error(label + ' metrics 格式无效')

  return {
    draftValid:
      typeof metrics.draftValid === 'boolean'
        ? metrics.draftValid
        : (() => {
            throw new Error(label + '.draftValid 必须是 boolean')
          })(),
    sourceKindMatch:
      typeof metrics.sourceKindMatch === 'boolean'
        ? metrics.sourceKindMatch
        : (() => {
            throw new Error(label + '.sourceKindMatch 必须是 boolean')
          })(),
    sourceDimensionsMatch:
      typeof metrics.sourceDimensionsMatch === 'boolean'
        ? metrics.sourceDimensionsMatch
        : (() => {
            throw new Error(
              label + '.sourceDimensionsMatch 必须是 boolean',
            )
          })(),
    roomPrecision: ratio(metrics.roomPrecision, label + '.roomPrecision'),
    roomRecall: ratio(metrics.roomRecall, label + '.roomRecall'),
    meanRoomIou: ratio(metrics.meanRoomIou, label + '.meanRoomIou'),
    roomTypeAccuracy: ratio(
      metrics.roomTypeAccuracy,
      label + '.roomTypeAccuracy',
    ),
    maxCandidateRoomOverlapRatio: ratio(
      metrics.maxCandidateRoomOverlapRatio,
      label + '.maxCandidateRoomOverlapRatio',
    ),
    openingPrecision: ratio(
      metrics.openingPrecision,
      label + '.openingPrecision',
    ),
    openingRecall: ratio(
      metrics.openingRecall,
      label + '.openingRecall',
    ),
    meanOpeningCenterErrorRatio:
      metrics.meanOpeningCenterErrorRatio === null
        ? null
        : ratio(
            metrics.meanOpeningCenterErrorRatio,
            label + '.meanOpeningCenterErrorRatio',
          ),
    meanOpeningWidthErrorRatio:
      metrics.meanOpeningWidthErrorRatio === null
        ? null
        : nonNegativeNumber(
            metrics.meanOpeningWidthErrorRatio,
            label + '.meanOpeningWidthErrorRatio',
          ),
    scaleErrorRatio: nonNegativeNumber(
      metrics.scaleErrorRatio,
      label + '.scaleErrorRatio',
    ),
  }
}

function validateBenchmarkReport(value, dataset, corpusCases) {
  const report = asRecord(value)

  if (
    !report ||
    report.schemaVersion !== '0.1.0' ||
    report.dataset !== dataset ||
    !Array.isArray(report.results)
  ) {
    throw new Error('Benchmark Report 与 Experiment 不匹配')
  }

  const seen = new Set()
  const results = []

  for (const [index, rawResult] of report.results.entries()) {
    const result = asRecord(rawResult)
    const label = 'benchmark.results[' + index + ']'

    if (!result) throw new Error(label + ' 格式无效')

    if (typeof result.gatePass !== 'boolean') {
      throw new Error(label + '.gatePass 必须是 boolean')
    }

    const caseId = nonEmptyString(result.caseId, label + '.caseId')
    const extractorId = nonEmptyString(
      result.extractorId,
      label + '.extractorId',
    )

    if (!corpusCases.has(caseId)) {
      throw new Error(label + ' 引用了未知 Corpus Case：' + caseId)
    }

    const key = caseId + '::' + extractorId

    if (seen.has(key)) {
      throw new Error('Benchmark Result 重复：' + key)
    }
    seen.add(key)

    const failures = result.failures ?? []

    if (!Array.isArray(failures)) {
      throw new Error(label + '.failures 必须是数组')
    }

    const normalizedFailures = failures.map((failure, failureIndex) =>
      nonEmptyString(
        failure,
        label + '.failures[' + failureIndex + ']',
      ),
    )

    results.push({
      caseId,
      extractorId,
      gatePass: result.gatePass,
      metrics: validateMetrics(result.metrics, label),
      failures: normalizedFailures,
    })
  }

  if (results.length === 0) {
    throw new Error('Benchmark Report 没有结果')
  }

  if (
    report.resultCount !== undefined &&
    report.resultCount !== results.length
  ) {
    throw new Error('Benchmark Report resultCount 与 results 不一致')
  }

  const uniqueCases = new Set(results.map((result) => result.caseId))

  if (
    report.caseCount !== undefined &&
    report.caseCount !== uniqueCases.size
  ) {
    throw new Error('Benchmark Report caseCount 与 results 不一致')
  }

  return results
}

function validateCandidate(value, label) {
  const candidate = asRecord(value)

  if (
    !candidate ||
    candidate.schemaVersion !== '0.1.0' ||
    !asRecord(candidate.source) ||
    !Array.isArray(candidate.rooms) ||
    !Array.isArray(candidate.openings)
  ) {
    throw new Error(label + ' Candidate FloorPlanDraft 格式无效')
  }
}

function validateExtractionRecord(value, extractorId, label) {
  const record = asRecord(value)

  if (
    !record ||
    record.schemaVersion !== '0.1.0' ||
    typeof record.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(record.generatedAt))
  ) {
    throw new Error(label + ' Extraction Metadata 格式无效')
  }

  nonEmptyString(record.sourceId, label + '.sourceId')

  const metadata = asRecord(record.metadata)

  if (!metadata || metadata.extractorId !== extractorId) {
    throw new Error(label + ' extractorId 与 Experiment 不一致')
  }

  const normalized = {
    extractorId,
    ...(metadata.provider !== undefined
      ? {
          provider: nonEmptyString(
            metadata.provider,
            label + '.metadata.provider',
          ),
        }
      : {}),
    ...(metadata.model !== undefined
      ? {
          model: nonEmptyString(
            metadata.model,
            label + '.metadata.model',
          ),
        }
      : {}),
  }

  const latencyMs = optionalFinite(
    metadata.latencyMs,
    label + '.metadata.latencyMs',
  )
  const costUsd = optionalFinite(
    metadata.costUsd,
    label + '.metadata.costUsd',
  )

  if (latencyMs !== undefined) {
    if (latencyMs < 0) {
      throw new Error(label + '.metadata.latencyMs 不能小于 0')
    }
    normalized.latencyMs = latencyMs
  }

  if (costUsd !== undefined) {
    if (costUsd < 0) {
      throw new Error(label + '.metadata.costUsd 不能小于 0')
    }
    normalized.costUsd = costUsd
  }

  for (const key of ['inputTokens', 'outputTokens']) {
    if (metadata[key] !== undefined) {
      normalized[key] = nonNegativeInteger(
        metadata[key],
        label + '.metadata.' + key,
      )
    }
  }

  return normalized
}

function validateReviewBurden(value, label) {
  const record = asRecord(value)

  if (
    !record ||
    record.schemaVersion !== '0.1.0' ||
    typeof record.sourceLabel !== 'string' ||
    !record.sourceLabel.trim() ||
    !['floorplan_image', 'floorplan_pdf', 'company_data'].includes(
      record.sourceKind,
    ) ||
    typeof record.startedAt !== 'string' ||
    typeof record.completedAt !== 'string'
  ) {
    throw new Error(label + ' Review Burden 格式无效')
  }

  const startedAtMs = Date.parse(record.startedAt)
  const completedAtMs = Date.parse(record.completedAt)

  if (
    Number.isNaN(startedAtMs) ||
    Number.isNaN(completedAtMs) ||
    completedAtMs < startedAtMs
  ) {
    throw new Error(label + ' Review 时间格式无效')
  }

  const durationMs = nonNegativeNumber(
    record.durationMs,
    label + '.durationMs',
  )

  if (Math.abs(completedAtMs - startedAtMs - durationMs) > 1000) {
    throw new Error(
      label + '.durationMs 与 startedAt / completedAt 不一致',
    )
  }
  const totalEdits = nonNegativeInteger(
    record.totalEdits,
    label + '.totalEdits',
  )
  const editCounts = asRecord(record.editCounts)

  if (!editCounts) {
    throw new Error(label + '.editCounts 格式无效')
  }

  const normalizedCounts = {}
  let computedTotal = 0

  for (const key of EDIT_KEYS) {
    const value = nonNegativeInteger(
      editCounts[key],
      label + '.editCounts.' + key,
    )
    normalizedCounts[key] = value
    computedTotal += value
  }

  if (computedTotal !== totalEdits) {
    throw new Error(
      label +
        '.totalEdits 与 editCounts 合计不一致：' +
        totalEdits +
        ' != ' +
        computedTotal,
    )
  }

  if (!Array.isArray(record.touchedRoomIds)) {
    throw new Error(label + '.touchedRoomIds 必须是数组')
  }

  const touchedRoomIds = record.touchedRoomIds.map((id, index) =>
    nonEmptyString(id, label + '.touchedRoomIds[' + index + ']'),
  )

  if (new Set(touchedRoomIds).size !== touchedRoomIds.length) {
    throw new Error(label + '.touchedRoomIds 存在重复 ID')
  }

  const sourceImage = asRecord(record.sourceImage)

  if (
    record.sourceKind === 'floorplan_image' &&
    !sourceImage
  ) {
    throw new Error(label + '.sourceImage 不能为空')
  }

  if (
    sourceImage &&
    sourceImage.aspectRatioCompatible !== true
  ) {
    throw new Error(
      label + '.sourceImage.aspectRatioCompatible 必须为 true',
    )
  }

  return {
    schemaVersion: '0.1.0',
    sourceKind: record.sourceKind,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    durationMs,
    totalEdits,
    editCounts: normalizedCounts,
    touchedRoomIds,
    roomCount: nonNegativeInteger(
      record.roomCount,
      label + '.roomCount',
    ),
    openingCount: nonNegativeInteger(
      record.openingCount,
      label + '.openingCount',
    ),
    ...(sourceImage
      ? {
          sourceImage: {
            widthPx: (() => {
              const value = nonNegativeInteger(
                sourceImage.widthPx,
                label + '.sourceImage.widthPx',
              )
              if (value <= 0) {
                throw new Error(
                  label + '.sourceImage.widthPx 必须大于 0',
                )
              }
              return value
            })(),
            heightPx: (() => {
              const value = nonNegativeInteger(
                sourceImage.heightPx,
                label + '.sourceImage.heightPx',
              )
              if (value <= 0) {
                throw new Error(
                  label + '.sourceImage.heightPx 必须大于 0',
                )
              }
              return value
            })(),
            aspectRatioCompatible: true,
          },
        }
      : {}),
  }
}

function mean(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null
}

function percentile(values, q) {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  )

  return sorted[index]
}

function meanOrZero(values) {
  return mean(values) ?? 0
}

function reviewSummary(results) {
  const reviews = results
    .map((result) => result.review)
    .filter(Boolean)
  const durations = reviews.map((review) => review.durationMs)
  const totalEdits = reviews.map((review) => review.totalEdits)

  const meanEditCounts =
    reviews.length === 0
      ? null
      : Object.fromEntries(
          EDIT_KEYS.map((key) => [
            key,
            meanOrZero(
              reviews.map((review) => review.editCounts[key]),
            ),
          ]),
        )

  return {
    coverage: results.length > 0 ? reviews.length / results.length : 0,
    meanDurationMs: mean(durations),
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    meanTotalEdits: mean(totalEdits),
    meanEditCounts,
  }
}

function extractionSummary(results) {
  const extraction = results
    .map((result) => result.extraction)
    .filter(Boolean)
  const latency = extraction
    .map((metadata) => metadata.latencyMs)
    .filter((value) => value !== undefined)
  const costs = extraction
    .map((metadata) => metadata.costUsd)
    .filter((value) => value !== undefined)

  return {
    coverage:
      results.length > 0 ? extraction.length / results.length : 0,
    latencyCoverage:
      results.length > 0 ? latency.length / results.length : 0,
    costCoverage:
      results.length > 0 ? costs.length / results.length : 0,
    meanLatencyMs: mean(latency),
    meanCostUsd: mean(costs),
    providers: [
      ...new Set(
        extraction
          .map((metadata) => metadata.provider)
          .filter(Boolean),
      ),
    ].sort(),
    models: [
      ...new Set(
        extraction
          .map((metadata) => metadata.model)
          .filter(Boolean),
      ),
    ].sort(),
  }
}

function failureSummary(results) {
  const counts = new Map()
  let failedCaseCount = 0
  let totalFailureCount = 0

  for (const result of results) {
    if ((result.failures?.length ?? 0) > 0) {
      failedCaseCount += 1
    }

    for (const failure of result.failures ?? []) {
      counts.set(failure, (counts.get(failure) ?? 0) + 1)
      totalFailureCount += 1
    }
  }

  return {
    failedCaseCount,
    totalFailureCount,
    failureCounts: Object.fromEntries(
      [...counts.entries()].sort(
        (left, right) =>
          right[1] - left[1] || left[0].localeCompare(right[0]),
      ),
    ),
  }
}

function sliceSummary(results) {
  const reviews = results
    .map((result) => result.review)
    .filter(Boolean)

  return {
    caseCount: results.length,
    gatePassRate:
      results.length > 0
        ? results.filter((result) => result.gatePass).length /
          results.length
        : 0,
    meanRoomIou: meanOrZero(
      results.map((result) => result.metrics.meanRoomIou),
    ),
    meanRoomRecall: meanOrZero(
      results.map((result) => result.metrics.roomRecall),
    ),
    meanOpeningRecall: meanOrZero(
      results.map((result) => result.metrics.openingRecall),
    ),
    reviewCoverage:
      results.length > 0 ? reviews.length / results.length : 0,
    meanReviewDurationMs: mean(
      reviews.map((review) => review.durationMs),
    ),
    meanTotalEdits: mean(
      reviews.map((review) => review.totalEdits),
    ),
    failures: failureSummary(results),
  }
}

function aggregate(results) {
  const extractorIds = [
    ...new Set(results.map((result) => result.extractorId)),
  ].sort()

  return extractorIds.map((extractorId) => {
    const extractorResults = results.filter(
      (result) => result.extractorId === extractorId,
    )
    const slices = Object.fromEntries(
      TAG_KEYS.map((key) => {
        const values = [
          ...new Set(
            extractorResults.map((result) => result.tags[key]),
          ),
        ].sort()

        return [
          key,
          Object.fromEntries(
            values.map((value) => [
              value,
              sliceSummary(
                extractorResults.filter(
                  (result) => result.tags[key] === value,
                ),
              ),
            ]),
          ),
        ]
      }),
    )

    return {
      extractorId,
      ...sliceSummary(extractorResults),
      review: reviewSummary(extractorResults),
      extraction: extractionSummary(extractorResults),
      slices,
    }
  })
}

function printHumanSummary(report) {
  process.stderr.write(
    [
      '',
      'Floor Plan Pilot · ' + report.dataset,
      'Fingerprint · ' + report.pilotFingerprint,
      'Results · ' + report.resultCount,
      ...report.extractors.map(
        (extractor) =>
          extractor.extractorId +
          ' · gate=' +
          (extractor.gatePassRate * 100).toFixed(1) +
          '% · roomIoU=' +
          extractor.meanRoomIou.toFixed(3) +
          ' · review=' +
          (extractor.review.coverage * 100).toFixed(1) +
          '% · edits=' +
          (extractor.review.meanTotalEdits?.toFixed(2) ?? 'n/a'),
      ),
      '',
    ].join('\n'),
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = dirname(args.manifestPath)
  const experimentJson = await readJson(
    args.manifestPath,
    'Experiment Manifest',
  )
  const experiment = asRecord(experimentJson.value)

  if (!experiment || experiment.schemaVersion !== '0.1.0') {
    throw new Error('只支持 Floor Plan Pilot Manifest v0.1.0')
  }

  const dataset = nonEmptyString(experiment.dataset, 'dataset')
  const datasetFingerprint = nonEmptyString(
    experiment.datasetFingerprint,
    'datasetFingerprint',
  )

  if (!/^[a-f0-9]{64}$/i.test(datasetFingerprint)) {
    throw new Error('datasetFingerprint 必须是 SHA-256 hex')
  }

  if (!Array.isArray(experiment.runs)) {
    throw new Error('runs 必须是数组')
  }

  const corpusManifestPath = await resolveWithinRoot(
    root,
    experiment.corpusManifestPath,
    'corpusManifestPath',
  )
  const corpusSummaryPath = await resolveWithinRoot(
    root,
    experiment.corpusSummaryPath,
    'corpusSummaryPath',
  )
  const benchmarkReportPath = await resolveWithinRoot(
    root,
    experiment.benchmarkReportPath,
    'benchmarkReportPath',
  )

  const [corpusManifestJson, corpusSummaryJson, benchmarkJson] =
    await Promise.all([
      readJson(corpusManifestPath, 'Corpus Manifest'),
      readJson(corpusSummaryPath, 'Corpus Summary'),
      readJson(benchmarkReportPath, 'Benchmark Report'),
    ])

  const corpusCases = validateCorpusManifest(
    corpusManifestJson.value,
    dataset,
  )

  const corpusSummaryCases = validateCorpusSummary(
    corpusSummaryJson.value,
    dataset,
    datasetFingerprint,
    corpusCases.keys(),
  )

  const benchmarkResults = validateBenchmarkReport(
    benchmarkJson.value,
    dataset,
    corpusCases,
  )

  const runMap = new Map()
  const runKeys = []
  const sidecarHashes = []

  for (const [index, rawRun] of experiment.runs.entries()) {
    const run = asRecord(rawRun)
    const label = 'runs[' + index + ']'

    if (!run) throw new Error(label + ' 格式无效')

    const caseId = nonEmptyString(run.caseId, label + '.caseId')
    const extractorId = nonEmptyString(
      run.extractorId,
      label + '.extractorId',
    )
    const key = caseId + '::' + extractorId

    if (!corpusCases.has(caseId)) {
      throw new Error(label + ' 引用了未知 Corpus Case：' + caseId)
    }

    if (runMap.has(key)) {
      throw new Error('Pilot Run 重复：' + key)
    }

    const candidatePath = await resolveWithinRoot(
      root,
      run.candidatePath,
      label + '.candidatePath',
    )
    const candidateJson = await readJson(
      candidatePath,
      key + ' Candidate',
    )
    validateCandidate(candidateJson.value, key)
    const candidateSha256 = sha256(candidateJson.bytes)
    const normalized = {
      caseId,
      extractorId,
      candidateSha256,
    }
    sidecarHashes.push(
      key + ':candidate:' + candidateSha256,
    )

    if (run.extractionMetadataPath !== undefined) {
      const path = await resolveWithinRoot(
        root,
        run.extractionMetadataPath,
        label + '.extractionMetadataPath',
      )
      const json = await readJson(path, key + ' Extraction Metadata')
      normalized.extraction = validateExtractionRecord(
        json.value,
        extractorId,
        key,
      )
      sidecarHashes.push(
        key + ':metadata:' + sha256(json.bytes),
      )
    }

    if (run.reviewBurdenPath !== undefined) {
      const path = await resolveWithinRoot(
        root,
        run.reviewBurdenPath,
        label + '.reviewBurdenPath',
      )
      const json = await readJson(path, key + ' Review Burden')
      normalized.review = validateReviewBurden(
        json.value,
        key,
      )

      const corpusCase = corpusCases.get(caseId)

      if (
        !corpusCase ||
        normalized.review.sourceKind !== corpusCase.sourceKind
      ) {
        throw new Error(
          key + ' Review Burden sourceKind 与 Corpus 不一致',
        )
      }

      const expectedCounts = corpusSummaryCases.get(caseId)

      if (
        !expectedCounts ||
        normalized.review.roomCount !== expectedCounts.roomCount ||
        normalized.review.openingCount !== expectedCounts.openingCount
      ) {
        throw new Error(
          key +
            ' Review Burden 的 Room / Opening 数量与 Corpus Summary 不一致',
        )
      }
      sidecarHashes.push(
        key + ':review:' + sha256(json.bytes),
      )
    }

    runMap.set(key, normalized)
    runKeys.push(key)
  }

  const benchmarkKeys = new Set(
    benchmarkResults.map(
      (result) => result.caseId + '::' + result.extractorId,
    ),
  )
  const missingReviewBurden = []
  const missingExtractionMetadata = []
  const results = benchmarkResults.map((result) => {
    const key = result.caseId + '::' + result.extractorId
    const run = runMap.get(key)

    if (!run) {
      throw new Error(
        'Benchmark Result 缺少 Experiment Run：' + key,
      )
    }

    if (!run.review) missingReviewBurden.push(key)
    if (!run.extraction) missingExtractionMetadata.push(key)

    return {
      ...result,
      candidateSha256: run?.candidateSha256 ?? '',
      tags: corpusCases.get(result.caseId).tags,
      ...(run?.extraction ? { extraction: run.extraction } : {}),
      ...(run?.review ? { review: run.review } : {}),
    }
  })

  const benchmarkCaseIds = new Set(
    benchmarkResults.map((result) => result.caseId),
  )
  const missingBenchmarkCases = [...corpusCases.keys()]
    .filter((caseId) => !benchmarkCaseIds.has(caseId))
    .sort()
  const orphanRuns = [...runMap.keys()]
    .filter((key) => !benchmarkKeys.has(key))
    .sort()

  missingReviewBurden.sort()
  missingExtractionMetadata.sort()
  runKeys.sort()
  sidecarHashes.sort()

  const corpusManifestSha256 = sha256(corpusManifestJson.bytes)
  const corpusSummarySha256 = sha256(corpusSummaryJson.bytes)
  const benchmarkSha256 = sha256(benchmarkJson.bytes)
  const pilotFingerprint = sha256(
    Buffer.from(
      [
        dataset,
        datasetFingerprint,
        corpusManifestSha256,
        corpusSummarySha256,
        benchmarkSha256,
        ...runKeys.map((key) => 'run:' + key),
        ...sidecarHashes,
      ].join('\n'),
      'utf8',
    ),
  )

  if (benchmarkCaseIds.size < args.minCases) {
    throw new Error(
      'Pilot Benchmark Case 数不足：' +
        benchmarkCaseIds.size +
        ' < ' +
        args.minCases,
    )
  }

  const report = {
    schemaVersion: '0.1.0',
    dataset,
    datasetFingerprint,
    generatedAt: new Date().toISOString(),
    pilotFingerprint,
    corpusManifestSha256,
    corpusSummarySha256,
    benchmarkSha256,
    caseCount: benchmarkCaseIds.size,
    resultCount: results.length,
    results,
    extractors: aggregate(results),
    dataQuality: {
      missingBenchmarkCases,
      missingReviewBurden,
      missingExtractionMetadata,
      orphanRuns,
    },
  }

  const output = JSON.stringify(report, null, 2) + '\n'

  if (args.reportPath) {
    await mkdir(dirname(args.reportPath), { recursive: true })
    await writeFile(args.reportPath, output, 'utf8')
  }

  process.stdout.write(output)
  printHumanSummary(report)

  if (
    orphanRuns.length > 0 ||
    (args.requireCorpusCoverage &&
      missingBenchmarkCases.length > 0) ||
    (args.requireCompleteReview &&
      missingReviewBurden.length > 0) ||
    (args.requireCompleteMetadata &&
      missingExtractionMetadata.length > 0)
  ) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.stack ?? error.message : String(error)) +
      '\n',
  )
  process.exitCode = 1
})

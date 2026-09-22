#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import process from 'node:process'

function fail(message) {
  throw new Error(message)
}

function sameCounts(actual, expected) {
  const actualEntries = Object.entries(actual ?? {}).sort()
  const expectedEntries = Object.entries(expected).sort()

  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries)
}

const result = spawnSync(
  process.execPath,
  [
    'tools/floorplan-pilot.mjs',
    'tools/fixtures/floorplan-pilot/experiment.json',
    '--min-cases',
    '2',
    '--require-corpus-coverage',
    '--require-complete-review',
    '--require-complete-metadata',
  ],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
  },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.stderr.write(result.stderr)
  fail('Floor Plan Pilot smoke 执行失败，exit=' + result.status)
}

const report = JSON.parse(result.stdout)
const extractors = new Map(
  report.extractors.map((extractor) => [
    extractor.extractorId,
    extractor,
  ]),
)
const reference = extractors.get('reference-json')
const degraded = extractors.get('degraded-json')

if (!reference || !degraded) {
  fail('Pilot Smoke 缺少预期 Extractor 汇总')
}

if (
  reference.failures.failedCaseCount !== 0 ||
  reference.failures.totalFailureCount !== 0 ||
  !sameCounts(reference.failures.failureCounts, {})
) {
  fail('reference-json Failure Summary 不应包含失败')
}

if (
  degraded.failures.failedCaseCount !== 2 ||
  degraded.failures.totalFailureCount !== 3 ||
  !sameCounts(degraded.failures.failureCounts, {
    opening_recall_below_threshold: 1,
    room_iou_below_threshold: 1,
    room_recall_below_threshold: 1,
  })
) {
  fail('degraded-json Failure Summary 与 Benchmark Fixture 不一致')
}

const multiRoom = degraded.slices.layout.multi_room
const openPlan = degraded.slices.layout.open_plan

if (
  !multiRoom ||
  !sameCounts(multiRoom.failures.failureCounts, {
    room_recall_below_threshold: 1,
  })
) {
  fail('layout=multi_room Failure Slice 不正确')
}

if (
  !openPlan ||
  !sameCounts(openPlan.failures.failureCounts, {
    opening_recall_below_threshold: 1,
    room_iou_below_threshold: 1,
  })
) {
  fail('layout=open_plan Failure Slice 不正确')
}

process.stderr.write(
  'Floor Plan Pilot failure slice smoke passed · aggregate + tag slices\n',
)

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = await mkdtemp(join(tmpdir(), 'homescape-real-coverage-'))
const SHA = 'a'.repeat(64)
const GT = 'b'.repeat(64)
const FP = 'c'.repeat(64)
const sourceSummary = { schemaVersion: '0.1.0', dataset: 'smoke-real', datasetFingerprint: FP,
  caseCount: 2, cases: [
    { id: 'case-001', sourceSha256: SHA, groundTruthSha256: GT, caseFingerprint: FP },
    { id: 'case-002', sourceSha256: GT, groundTruthSha256: SHA, caseFingerprint: FP },
  ] }
const intake = (cases) => ({ schemaVersion: '0.1.0',
  reportType: 'real_floorplan_intake_pre_ground_truth',
  isOfficialCorpusFingerprint: false, cases })
const one = { id: 'case-001', sourceSha256: SHA,
  candidateStatus: 'failed', failureCode: 'no_orthogonal_outline' }
const two = { id: 'case-002', sourceSha256: GT,
  candidateStatus: 'generated_unverified', candidateSha256: FP }
const corpusPath = join(root, 'corpus-summary.json')
const intakeA = join(root, 'intake-a.json')
const intakeB = join(root, 'intake-b.json')
const output = join(root, 'coverage.json')
const run = (...files) => spawnSync(process.execPath,
  ['tools/floorplan-real-coverage.mjs', corpusPath, ...files,
    '--extractor-id', 'raster-orthogonal-v0.1'], { encoding: 'utf8' })

try {
  await writeFile(corpusPath, JSON.stringify(sourceSummary))
  await writeFile(intakeA, JSON.stringify(intake([one])))
  await writeFile(intakeB, JSON.stringify(intake([two])))
  let result = run(intakeA, intakeB)
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.groundTruthCaseCount, 2)
  assert.equal(parsed.failed, 1)
  assert.equal(parsed.generated_unverified, 1)
  assert.equal(parsed.benchmarkStatus, 'not_evaluated')
  assert.deepEqual(parsed.failureCounts, { no_orthogonal_outline: 1 })
  assert.equal(parsed.cases[0].candidateStatus, 'failed')
  assert.ok(!('roomIou' in parsed.cases[0]))
  assert.ok(!('sourcePath' in result.stdout))
  result = run(intakeA)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /缺少 Intake 证据/)
  await writeFile(intakeB, JSON.stringify(intake([{ ...two, sourceSha256: SHA }])))
  result = run(intakeA, intakeB)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Source SHA/)
  await writeFile(intakeB, JSON.stringify(intake([two, one])))
  result = run(intakeA, intakeB)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /重复/)
  await writeFile(intakeB, JSON.stringify(intake([two])))
  result = spawnSync(process.execPath, [
    'tools/floorplan-real-coverage.mjs', corpusPath, intakeA, intakeB,
    '--extractor-id', 'raster-orthogonal-v0.1', '--report', output,
  ], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(await readFile(output, 'utf8')).failed, 1)
  result = spawnSync(process.execPath, [
    'tools/floorplan-real-coverage.mjs', corpusPath, intakeA, intakeB,
    '--extractor-id', 'raster-orthogonal-v0.1', '--report', output,
  ], { encoding: 'utf8' })
  assert.notEqual(result.status, 0, '禁止覆盖现有报告')
} finally {
  await rm(root, { force: true, recursive: true })
}
process.stderr.write('Real Corpus / Intake coverage smoke passed\n')

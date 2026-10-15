#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const command = resolve(dirname(fileURLToPath(import.meta.url)), 'floorplan-real-intake.mjs')
const temp = await mkdtemp(join(tmpdir(), 'homescape-real-intake-'))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')
const hash = (v) => createHash('sha256').update(v).digest('hex')
function run(manifest, flags = [], env = {}) {
  return spawnSync(process.execPath, [command, manifest, ...flags], { encoding: 'utf8', env: { ...process.env, ...env } })
}
function assert(v, m) { if (!v) throw new Error(m) }
const manifestPath = join(temp, 'intake.json')
const reportPath = join(temp, 'reports', 'intake-report.json')
const sourcePath = join(temp, 'sources', 'case-001.png')
const goodCase = () => ({ id: 'case-001', sourcePath: 'sources/case-001.png', sourceSha256: hash(png), mediaType: 'image/png', widthPx: 1, heightPx: 1, group: 'pilot_a', geometryStage: 'full_page' })
const makeManifest = (cases) => ({ schemaVersion: '0.1.0', dataset: 'synthetic-intake-smoke', cases })
async function writeManifest(cases) { await writeFile(manifestPath, JSON.stringify(makeManifest(cases))) }
async function shouldFail(cases, reason, flags=[]) {
  await writeManifest(cases)
  const result = run(manifestPath, flags)
  assert(result.status !== 0 && result.stderr.includes(reason), '没有拒绝：' + reason + '\n' + result.stderr)
}
try {
  await mkdir(join(temp, 'sources'))
  await writeFile(sourcePath, png)
  await writeManifest([goodCase()])
  let result = run(manifestPath, ['--report', reportPath])
  assert(result.status === 0, '基础 Intake 失败：' + result.stderr)
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  assert(report.caseCount === 1 && report.groundTruthCaseCount === 0 && report.benchmarkReady === false && report.cases[0]?.gtStatus === 'pending_human_review' && report.cases[0]?.candidateStatus === 'not_run', '预标注报告不得声明正式 Benchmark 已就绪')
  assert(/^[a-f0-9]{64}$/.test(report.sourceSetFingerprint), 'Source Set Fingerprint 缺失')
  await shouldFail([{...goodCase(), sourceSha256: '0'.repeat(64)}], 'SHA-256 不匹配')
  await shouldFail([{...goodCase(), widthPx: 2}], '宽高与清单不一致')
  await shouldFail([{...goodCase(), mediaType: 'image/jpeg'}], '扩展名与实际格式不符')
  await shouldFail([{...goodCase(), sourcePath: '../escape.png'}], '越过 Intake 根目录')
  await shouldFail([goodCase(), {...goodCase(),id:'case-002'}], '完全重复')
  await shouldFail([goodCase(), {...goodCase()}], 'Case ID 重复')
  await shouldFail([goodCase()], 'report 与输入源文件冲突', ['--report', sourcePath])
  await shouldFail([goodCase()], '--extract 必须同时指定 --report', ['--extract'])
  const outside = await mkdtemp(join(tmpdir(), 'homescape-real-external-'))
  try {
    await symlink(outside, join(temp, 'escape-link'), 'dir')
    await shouldFail([goodCase()], '越过 Intake 根目录', ['--report', join(temp,'escape-link', 'report.json')])
    await writeFile(join(outside, 'outside.png'), png)
    await symlink(join(outside, 'outside.png'), join(temp, 'sources', 'external.png'))
    await shouldFail([{...goodCase(),sourcePath:'sources/external.png'}], '越过 Intake 根目录')
  } finally { await rm(outside,{recursive:true,force:true}) }
  // Test failures must not create output candidates in normal check mode.
  let candidatesExist = true
  try { await access(join(temp,'candidates')) } catch { candidatesExist = false }
  assert(!candidatesExist, 'Intake check 不得生成 Candidate')
  // A deterministic fake pnpm checks extract aggregation without requiring TSX/Sharp in CI.
  const binDir = join(temp, 'bin')
  await mkdir(binDir)
  const fakePnpm = join(binDir, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  if (process.platform !== 'win32') {
    await writeFile(fakePnpm, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
const candidatePath = args[4]
const metadataPath = args[args.indexOf('--metadata') + 1]
const sourceId = args[args.indexOf('--source-id') + 1]
if (process.env.MOCK_MODE === 'fail') {
  console.error('Raster Image 未检测到完整正交外轮廓')
  process.exit(1)
}
const output = {
  schemaVersion: '0.1.0',
  source: { kind: 'floorplan_image', widthPx: 1, heightPx: 1, sourceLabel: sourceId },
  rooms: [{ id: 'room-001', boundaryPx: [[0,0],[1,0],[1,1]] }],
  openings: [],
}
const record = {
  schemaVersion: '0.1.0', sourceId: process.env.MOCK_MODE === 'wrong_id' ? 'unrelated' : sourceId,
  metadata: { extractorId: 'raster-orthogonal-v0.1', latencyMs: 37 },
  warnings: ['test warning'],
}
fs.mkdirSync(path.dirname(candidatePath), { recursive: true })
fs.writeFileSync(candidatePath, JSON.stringify(output))
if (process.env.MOCK_MODE !== 'missing_metadata') {
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true })
  fs.writeFileSync(metadataPath, JSON.stringify(record))
}
`)
    await chmod(fakePnpm, 0o755)
    const mockEnv = { PATH: binDir + ':' + process.env.PATH }
    await writeManifest([goodCase()])
    const result = run(manifestPath, ['--extract', '--report', reportPath], mockEnv)
    assert(result.status === 0, 'Mock extract 应成功：' + result.stderr)
    const ok = JSON.parse(await readFile(reportPath, 'utf8'))
    assert(ok.extractedCount === 1 && ok.failedCount === 0 && ok.benchmarkReady === false &&
      ok.cases[0].roomCount === 1 && ok.cases[0].openingCount === 0 && ok.cases[0].warningCount === 1 &&
      ok.cases[0].candidateStatus === 'generated_unverified' &&
      ok.cases[0].candidatePath === 'candidates/raster-orthogonal-v0.1/case-001.json' &&
      /^[a-f0-9]{64}$/.test(ok.cases[0].candidateSha256), '真实提取报告必须包含产物、诊断与非 GT 状态')
    let failure = run(manifestPath, ['--extract', '--report', reportPath], {...mockEnv, MOCK_MODE: 'fail'})
    assert(failure.status === 2, 'Detector 失败应设置退出码 2')
    let failedReport = JSON.parse(await readFile(reportPath, 'utf8'))
    assert(failedReport.failureCounts.no_orthogonal_outline === 1 && !failedReport.cases[0].error,
      '失败报告只保存分类，不应泄漏 stderr 路径')
    failure = run(manifestPath, ['--extract', '--report', reportPath], {...mockEnv, MOCK_MODE: 'wrong_id'})
    assert(failure.status === 2, 'Metadata Source ID 错误应该失败')
    failedReport = JSON.parse(await readFile(reportPath, 'utf8'))
    assert(failedReport.failureCounts.invalid_candidate_artifact === 1,
      '伪造旧 Metadata 不能被当成成功提取')
  }
  process.stdout.write('real intake smoke passed · sources + privacy + extraction artifact verification + failure taxonomy\n')
} finally { await rm(temp, { recursive: true, force: true }) }
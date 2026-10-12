#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const command = resolve(dirname(fileURLToPath(import.meta.url)), 'floorplan-real-intake.mjs')
const temp = await mkdtemp(join(tmpdir(), 'homescape-real-intake-'))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')
const hash = (v) => createHash('sha256').update(v).digest('hex')
function run(manifest, flags = []) {
  return spawnSync(process.execPath, [command, manifest, ...flags], { encoding: 'utf8' })
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
  process.stdout.write('real intake smoke passed · hash + dimensions + privacy + path gates + GT state\n')
} finally { await rm(temp, { recursive: true, force: true }) }
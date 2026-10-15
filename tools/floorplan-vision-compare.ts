// 比较两次视觉 Extractor 运行（同一 Source Set）的候选结果，衡量运行间是否可比 / 稳定。
// 只说明“两次跑出来是否一致”，不是准确率；准确率仍由 Benchmark 对照人工 GT 计算。
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { compareFloorPlanDrafts, type DraftComparison } from '@homescape/floorplan-extractor'
import { isFloorPlanDraft } from '@homescape/spatial-model'

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const fail = (message: string): never => {
  throw new Error(message)
}

function usage() {
  return [
    '用法：tsx tools/floorplan-vision-compare.ts <intake.json> <run-a> <run-b> [--report <out.json>]',
    '  run-a / run-b 为 floorplan-vision-batch 的 run-dir 或其 report.json。',
  ].join('\n')
}

async function loadReport(path: string) {
  const resolved = resolve(path)
  const file = (await stat(resolved)).isDirectory() ? resolve(resolved, 'report.json') : resolved
  const report: unknown = JSON.parse(await readFile(file, 'utf8'))
  if (
    !record(report) ||
    report.reportType !== 'real_floorplan_intake_pre_ground_truth' ||
    typeof report.extractorId !== 'string' ||
    !Array.isArray(report.cases)
  ) {
    fail(file + ' 不是 Extractor 运行报告')
  }
  return report as Record<string, unknown> & { cases: unknown[] }
}

async function loadDraft(root: string, candidatePath: unknown) {
  if (typeof candidatePath !== 'string' || isAbsolute(candidatePath)) {
    fail('candidatePath 无效')
  }
  const path = await realpath(resolve(root, candidatePath as string))
  const rel = relative(root, path)
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel))
    fail('candidatePath 越过 Intake 根目录')
  const draft: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isFloorPlanDraft(draft)) fail(candidatePath + ' 不是有效 FloorPlanDraft')
  return draft as Parameters<typeof compareFloorPlanDrafts>[0]
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null
const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

async function main() {
  const argv = process.argv.slice(process.argv[2] === '--' ? 3 : 2)
  const [intakePath, runA, runB, ...rest] = argv
  if (!intakePath || !runA || !runB) fail(usage())
  let reportTarget: string | undefined
  while (rest.length) {
    const flag = rest.shift()
    if (flag === '--report') reportTarget = resolve(rest.shift() ?? fail('--report 缺少路径'))
    else fail('未知参数：' + flag + '\n' + usage())
  }

  const root = await realpath(dirname(resolve(intakePath!)))
  const a = await loadReport(runA!)
  const b = await loadReport(runB!)
  if (a.sourceSetFingerprint !== b.sourceSetFingerprint) {
    fail('两次运行的 sourceSetFingerprint 不同，输入不是同一批图片，不能比较')
  }

  const configA = record(a.config) ? a.config : {}
  const configB = record(b.config) ? b.config : {}
  const configDiff = [...new Set([...Object.keys(configA), ...Object.keys(configB)])]
    .filter((key) => JSON.stringify(configA[key]) !== JSON.stringify(configB[key]))
    .sort()

  const casesB = new Map<string, Record<string, unknown>>()
  for (const entry of b.cases)
    if (record(entry) && typeof entry.id === 'string') casesB.set(entry.id, entry)

  const cases: Record<string, unknown>[] = []
  const comparisons: DraftComparison[] = []
  for (const entry of a.cases) {
    if (!record(entry) || typeof entry.id !== 'string') fail('报告包含无效 Case')
    const left = entry as Record<string, unknown> & { id: string }
    const right = casesB.get(left.id)
    if (!right) fail(left.id + ' 只出现在第一次运行中')
    if (left.sourceSha256 !== right!.sourceSha256) fail(left.id + ' 两次运行的源图 SHA 不同')
    const statusA = left.candidateStatus
    const statusB = right!.candidateStatus
    const base = {
      id: left.id,
      statusA,
      statusB,
      ...(left.failureCode ? { failureCodeA: left.failureCode } : {}),
      ...(right!.failureCode ? { failureCodeB: right!.failureCode } : {}),
      identicalCandidate:
        Boolean(left.candidateSha256) && left.candidateSha256 === right!.candidateSha256,
    }
    if (statusA === 'generated_unverified' && statusB === 'generated_unverified') {
      const comparison = compareFloorPlanDrafts(
        await loadDraft(root, left.candidatePath),
        await loadDraft(root, right!.candidatePath),
      )
      comparisons.push(comparison)
      cases.push({ ...base, comparable: true, ...comparison })
    } else {
      // 任一侧失败或未运行都保留在报告里，不从分母中移除。
      cases.push({ ...base, comparable: false })
    }
  }

  const scaleDiffs = comparisons.map((c) => Math.max(c.scaleDiffRatioX, c.scaleDiffRatioY))
  const summary = {
    caseCount: cases.length,
    bothGenerated: comparisons.length,
    // 失败需原因也相同才算一致；两侧都未运行不计为一致。
    statusAgreement:
      cases.filter(
        (c) =>
          c.statusA === c.statusB &&
          c.statusA !== 'not_run' &&
          (c.failureCodeA ?? null) === (c.failureCodeB ?? null),
      ).length / cases.length,
    notRunInEither: cases.filter((c) => c.statusA === 'not_run' || c.statusB === 'not_run').length,
    identicalCandidates: cases.filter((c) => c.identicalCandidate).length,
    roomCountEqualRate: comparisons.length
      ? comparisons.filter((c) => c.roomCountA === c.roomCountB).length / comparisons.length
      : null,
    roomMatchRate: comparisons.length
      ? comparisons.reduce((sum, c) => sum + c.matchedRooms, 0) /
        comparisons.reduce((sum, c) => sum + Math.max(c.roomCountA, c.roomCountB), 0)
      : null,
    // 下列均值只在“两侧都有值”的 Case 上计算；缺值 Case 数单独列出，不静默移出。
    casesWithoutMatchedRooms: comparisons.filter((c) => c.meanMatchedRoomIou === null).length,
    casesWithoutLivingInBoth: comparisons.filter((c) => c.livingRoomIou === null).length,
    meanMatchedRoomIou: mean(
      comparisons.flatMap((c) => (c.meanMatchedRoomIou === null ? [] : [c.meanMatchedRoomIou])),
    ),
    meanLivingRoomIou: mean(
      comparisons.flatMap((c) => (c.livingRoomIou === null ? [] : [c.livingRoomIou])),
    ),
    medianScaleDiffRatio: median(scaleDiffs),
    scaleDiffUnder2Percent: scaleDiffs.filter((d) => d < 0.02).length,
    calibrationBasisAgreement: comparisons.length
      ? comparisons.filter((c) => c.calibrationBasisA === c.calibrationBasisB).length /
        comparisons.length
      : null,
    openingMatchRate: comparisons.length
      ? comparisons.reduce((sum, c) => sum + c.matchedOpenings, 0) /
        Math.max(
          1,
          comparisons.reduce((sum, c) => sum + Math.max(c.openingCountA, c.openingCountB), 0),
        )
      : null,
  }

  const report = {
    schemaVersion: '0.1.0',
    reportType: 'floorplan_extractor_run_consistency',
    note: 'Run-to-run consistency only. Not accuracy: compare against human Ground Truth with floorplan:benchmark.',
    sourceSetFingerprint: a.sourceSetFingerprint,
    extractorA: a.extractorId,
    extractorB: b.extractorId,
    configA,
    configB,
    configDiff,
    summary,
    cases,
  }
  const output = JSON.stringify(report, null, 2) + '\n'
  if (reportTarget) {
    await mkdir(dirname(reportTarget), { recursive: true })
    await writeFile(reportTarget, output, 'utf8')
  }
  process.stdout.write(output)
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
})

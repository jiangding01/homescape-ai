// 可复现的视觉大模型户型 Extractor 批量运行器（ADR-0017：模型预填，人工确认）。
// 输入沿用 Real Intake Manifest；输出报告沿用 Intake 报告合同，可直接接 floorplan:real:coverage。
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import {
  RecordingVisionModelClient,
  ReplayVisionModelClient,
  VISION_EXTRACTOR_ID,
  VISION_PROMPT_VERSION,
  VisionExtractionError,
  VisionFloorPlanExtractor,
  visionPromptFingerprint,
  type StoredVisionResponse,
  type VisionEffort,
  type VisionImagePreparer,
  type VisionModelClient,
  type VisionResponseStore,
} from '@homescape/floorplan-extractor'
import {
  AnthropicVisionModelClient,
  SharpVisionImagePreparer,
} from '@homescape/floorplan-extractor/node'

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const fail = (message: string): never => {
  throw new Error(message)
}
const toPosix = (path: string) => path.split(sep).join('/')
const EFFORTS: readonly VisionEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

function usage() {
  return [
    '用法：tsx tools/floorplan-vision-batch.ts <intake.json>',
    '  [--run-dir <dir>]            默认 <intake 目录>/vision-runs/<model>-<时间戳>',
    '  [--model <id>]               默认 claude-opus-5-5',
    '  [--effort <low|medium|high|xhigh|max>]  默认 high',
    '  [--max-long-edge <px>]       送入模型的图像长边上限，默认 1568',
    '  [--assumed-pixels-per-meter <n>]  图上无尺寸线时的假设比例尺，默认 100',
    '  [--concurrency <n>]          默认 2',
    '  [--cases <id,id,...>]        只跑部分 Case（报告中其余 Case 记为 not_run）',
    '  [--dry-run]                  只做预检查并打印请求指纹，不调用模型',
    '  [--replay]                   不调用模型，用 <run-dir>/responses 回放并核对候选结果是否逐字节一致',
    '',
    'API Key 只从服务端环境变量 ANTHROPIC_API_KEY 读取，不写入任何输出或日志。',
    '产物是 generated_unverified 的 Candidate，必须经人工 Review 才能成为 Ground Truth。',
  ].join('\n')
}

interface Args {
  manifest: string
  runDir?: string
  model: string
  effort: VisionEffort
  maxLongEdge: number
  assumedPixelsPerMeter: number
  concurrency: number
  cases?: Set<string>
  dryRun: boolean
  replay: boolean
}

function parseArgs(argv: string[]): Args {
  const all = [...argv]
  const manifest = all.shift()
  if (!manifest || manifest.startsWith('-')) fail(usage())
  const args: Args = {
    manifest: resolve(manifest!),
    model: 'claude-opus-5-5',
    effort: 'high',
    maxLongEdge: 1568,
    assumedPixelsPerMeter: 100,
    concurrency: 2,
    dryRun: false,
    replay: false,
  }
  const value = (flag: string) => {
    const next = all.shift()
    if (!next || next.startsWith('--')) fail(flag + ' 缺少参数值')
    return next!
  }
  const number = (flag: string, min: number, max: number) => {
    const parsed = Number(value(flag))
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      fail(flag + ' 必须在 ' + min + ' ~ ' + max + ' 之间')
    }
    return parsed
  }
  while (all.length) {
    const flag = all.shift()
    if (flag === '--run-dir') args.runDir = resolve(value(flag))
    else if (flag === '--model') args.model = value(flag)
    else if (flag === '--effort') {
      const effort = value(flag) as VisionEffort
      if (!EFFORTS.includes(effort)) fail('--effort 非法')
      args.effort = effort
    } else if (flag === '--max-long-edge') args.maxLongEdge = Math.round(number(flag, 256, 8000))
    else if (flag === '--assumed-pixels-per-meter')
      args.assumedPixelsPerMeter = number(flag, 1, 10000)
    else if (flag === '--concurrency') args.concurrency = Math.round(number(flag, 1, 8))
    else if (flag === '--cases')
      args.cases = new Set(
        value(flag)
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      )
    else if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--replay') args.replay = true
    else fail('未知参数：' + flag + '\n' + usage())
  }
  if (args.dryRun && args.replay) fail('--dry-run 与 --replay 不能同时使用')
  if (args.replay && !args.runDir) fail('--replay 必须指定 --run-dir')
  return args
}

function requireWithin(root: string, target: string, name: string) {
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    fail(name + ' 越过 Intake 根目录')
  }
  return target
}

async function exists(path: string) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

interface SourceCase {
  id: string
  group: string
  style: string
  mediaType: 'image/png' | 'image/jpeg'
  sourcePath: string
  sourceSha256: string
  widthPx: number
  heightPx: number
  geometryStage: string
  roi?: unknown
  bytes: Uint8Array
}

async function loadIntake(manifestPath: string) {
  const root = dirname(manifestPath)
  const rootReal = await realpath(root)
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    !record(manifest) ||
    manifest.schemaVersion !== '0.1.0' ||
    typeof manifest.dataset !== 'string' ||
    !manifest.dataset.trim() ||
    !Array.isArray(manifest.cases) ||
    manifest.cases.length === 0
  ) {
    fail('需要 Real Intake Manifest v0.1')
  }
  const m = manifest as { dataset: string; cases: unknown[] }
  const seenIds = new Set<string>()
  const seenSha = new Set<string>()
  const cases: SourceCase[] = []

  for (const [index, raw] of m.cases.entries()) {
    if (!record(raw)) fail('cases[' + index + '] 无效')
    const c = raw as Record<string, unknown>
    const id = c.id
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      fail('caseId 非法：' + String(id))
    }
    const caseId = id as string
    if (seenIds.has(caseId)) fail('Case ID 重复：' + caseId)
    seenIds.add(caseId)
    if (c.mediaType !== 'image/png' && c.mediaType !== 'image/jpeg')
      fail(caseId + ' mediaType 非法')
    if (!isHash(c.sourceSha256)) fail(caseId + ' sourceSha256 非法')
    if (!Number.isInteger(c.widthPx) || !Number.isInteger(c.heightPx))
      fail(caseId + ' 图像尺寸非法')
    if (typeof c.group !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(c.group))
      fail(caseId + ' group 非法')
    if (typeof c.sourcePath !== 'string' || !c.sourcePath.trim() || isAbsolute(c.sourcePath)) {
      fail(caseId + ' sourcePath 不是相对路径')
    }
    const path = requireWithin(root, resolve(root, c.sourcePath as string), caseId + '.sourcePath')
    const real = requireWithin(rootReal, await realpath(path), caseId + '.sourcePath')
    if (!(await lstat(real)).isFile()) fail(caseId + ' 不是普通文件')
    const ext = extname(real).toLowerCase()
    if (!(c.mediaType === 'image/png' ? ext === '.png' : ext === '.jpg' || ext === '.jpeg')) {
      fail(caseId + ' 扩展名与实际格式不符')
    }
    const bytes = new Uint8Array(await readFile(real))
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) fail(caseId + ' 输入尺寸超出 0~20MB')
    const actualSha = sha256(bytes)
    if (actualSha !== c.sourceSha256) fail(caseId + ' 源文件 SHA-256 不匹配')
    if (seenSha.has(actualSha)) fail(caseId + ' 与已有 Case 完全重复')
    seenSha.add(actualSha)

    cases.push({
      id: caseId,
      group: c.group as string,
      style: typeof c.style === 'string' ? c.style : 'unspecified',
      mediaType: c.mediaType as SourceCase['mediaType'],
      sourcePath: toPosix(relative(rootReal, real)),
      sourceSha256: actualSha,
      widthPx: c.widthPx as number,
      heightPx: c.heightPx as number,
      geometryStage: typeof c.geometryStage === 'string' ? c.geometryStage : 'full_page',
      ...(c.roi !== undefined ? { roi: c.roi } : {}),
      bytes,
    })
  }

  // 与 floorplan:real:intake 相同的 Source Set 指纹，便于跨 Extractor 对照。
  const sourceSetFingerprint = sha256(
    cases
      .map((s) => JSON.stringify([s.id, s.group, s.sourceSha256, s.geometryStage, s.roi ?? null]))
      .sort()
      .join('\n'),
  )
  return { root, rootReal, dataset: m.dataset, cases, sourceSetFingerprint }
}

function fileStore(path: string): VisionResponseStore {
  return {
    async load() {
      if (!(await exists(path))) return undefined
      return JSON.parse(await readFile(path, 'utf8')) as StoredVisionResponse
    },
    async save(value) {
      await writeJson(path, value)
    },
  }
}

function classify(error: unknown) {
  if (error instanceof VisionExtractionError) return error.code
  return 'extractor_failed'
}

function failureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 300)
}

async function pool<T>(items: readonly T[], concurrency: number, run: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) await run(queue.shift()!)
    }),
  )
}

function percentile(values: number[], p: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
}

async function main() {
  const args = parseArgs(process.argv.slice(process.argv[2] === '--' ? 3 : 2))
  const intake = await loadIntake(args.manifest)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '')
  const runDir = args.runDir ?? resolve(intake.root, 'vision-runs', args.model + '-' + stamp)
  requireWithin(intake.root, runDir, '--run-dir')
  const outDir = args.replay ? resolve(runDir, 'replay') : runDir
  const reportPath = resolve(outDir, 'report.json')

  if (args.cases) {
    const known = new Set(intake.cases.map((c) => c.id))
    const unknown = [...args.cases].filter((id) => !known.has(id))
    if (unknown.length) fail('--cases 包含未知 Case：' + unknown.join(', '))
  }
  if (!args.dryRun && !args.replay && (await exists(reportPath))) {
    fail('该 run-dir 已有运行报告，请换一个 --run-dir，避免覆盖既有结果')
  }

  let recordedReport: Record<string, unknown> | undefined
  if (args.replay) {
    const recordedPath = resolve(runDir, 'report.json')
    if (!(await exists(recordedPath))) fail('run-dir 缺少原始 report.json，无法回放')
    recordedReport = JSON.parse(await readFile(recordedPath, 'utf8'))
    const config = record(recordedReport?.config) ? recordedReport.config : {}
    // 回放必须使用与原始运行相同的配置，否则请求指纹不会匹配。
    args.model = typeof config.model === 'string' ? config.model : args.model
    args.effort = EFFORTS.includes(config.effort as VisionEffort)
      ? (config.effort as VisionEffort)
      : args.effort
    args.maxLongEdge =
      typeof config.maxLongEdgePx === 'number' ? config.maxLongEdgePx : args.maxLongEdge
    args.assumedPixelsPerMeter =
      typeof config.assumedPixelsPerMeter === 'number'
        ? config.assumedPixelsPerMeter
        : args.assumedPixelsPerMeter
  }

  // 预检查与正式提取共用同一次预处理结果，避免每张图编码两遍。
  const sharpPreparer = new SharpVisionImagePreparer({ maxLongEdgePx: args.maxLongEdge })
  const prepared = new Map<string, ReturnType<typeof sharpPreparer.prepare>>()
  const preparer: VisionImagePreparer = {
    id: sharpPreparer.id,
    prepare(bytes, mediaType) {
      const key = sha256(bytes) + ':' + mediaType
      let result = prepared.get(key)
      if (!result) {
        result = sharpPreparer.prepare(bytes, mediaType)
        prepared.set(key, result)
      }
      return result
    },
  }
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!args.dryRun && !args.replay && !apiKey) {
    fail('缺少服务端环境变量 ANTHROPIC_API_KEY（只在本地 / 服务端设置，勿写入 VITE_* 或仓库）')
  }
  const liveClient: VisionModelClient | undefined =
    apiKey && !args.replay && !args.dryRun
      ? new AnthropicVisionModelClient({
          apiKey,
          ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
        })
      : undefined
  const extractorFor = (client: VisionModelClient) =>
    new VisionFloorPlanExtractor(preparer, client, {
      model: args.model,
      effort: args.effort,
      assumedPixelsPerMeter: args.assumedPixelsPerMeter,
      sha256,
    })

  // ---- Preflight：全部 Case 先完成图像预处理与尺寸核对，再发出任何模型请求 ----
  const recordedCases = new Map<string, Record<string, unknown>>()
  if (recordedReport && Array.isArray(recordedReport.cases)) {
    for (const entry of recordedReport.cases) {
      if (record(entry) && typeof entry.id === 'string') recordedCases.set(entry.id, entry)
    }
  }
  // 回放默认只覆盖原运行实际跑过的 Case（not_run 的 Case 没有响应可回放）。
  const selected = intake.cases.filter((c) =>
    args.cases
      ? args.cases.has(c.id)
      : !args.replay || (recordedCases.get(c.id)?.candidateStatus ?? 'not_run') !== 'not_run',
  )
  const planned = new Map<
    string,
    { fingerprint: string; modelWidthPx: number; modelHeightPx: number }
  >()
  for (const source of selected) {
    const request = await extractorFor(
      liveClient ?? new ReplayVisionModelClient('anthropic', fileStore('')),
    ).buildRequest({
      sourceId: source.id,
      kind: 'floorplan_image',
      mediaType: source.mediaType,
      bytes: source.bytes,
    })
    if (
      request.image.sourceWidthPx !== source.widthPx ||
      request.image.sourceHeightPx !== source.heightPx
    ) {
      fail(source.id + ' 源图宽高（EXIF 校正后）与清单不一致')
    }
    planned.set(source.id, {
      fingerprint: request.fingerprint,
      modelWidthPx: request.image.modelWidthPx,
      modelHeightPx: request.image.modelHeightPx,
    })
  }

  const promptFingerprint = visionPromptFingerprint(sha256)
  if (args.dryRun) {
    process.stdout.write(
      JSON.stringify(
        {
          dryRun: true,
          dataset: intake.dataset,
          sourceSetFingerprint: intake.sourceSetFingerprint,
          model: args.model,
          effort: args.effort,
          promptVersion: VISION_PROMPT_VERSION,
          promptFingerprint,
          preparerId: preparer.id,
          runDir: toPosix(relative(intake.rootReal, runDir)),
          cases: [...planned.entries()].map(([id, plan]) => ({ id, ...plan })),
        },
        null,
        2,
      ) + '\n',
    )
    return
  }

  const results = new Map<string, Record<string, unknown>>()
  await pool(selected, args.concurrency, async (source) => {
    const responsePath = resolve(runDir, 'responses', source.id + '.json')
    const candidatePath = resolve(outDir, 'candidates', source.id + '.json')
    const metadataPath = resolve(outDir, 'metadata', source.id + '.json')
    const client = args.replay
      ? new ReplayVisionModelClient('anthropic', fileStore(responsePath))
      : new RecordingVisionModelClient(liveClient!, fileStore(responsePath))
    const started = Date.now()
    const entry: Record<string, unknown> = {
      requestFingerprint: planned.get(source.id)!.fingerprint,
      modelWidthPx: planned.get(source.id)!.modelWidthPx,
      modelHeightPx: planned.get(source.id)!.modelHeightPx,
    }

    try {
      const result = await extractorFor(client).extract({
        sourceId: source.id,
        kind: 'floorplan_image',
        mediaType: source.mediaType,
        bytes: source.bytes,
      })
      const candidateJson = JSON.stringify(result.draft, null, 2) + '\n'
      await mkdir(dirname(candidatePath), { recursive: true })
      await writeFile(candidatePath, candidateJson, 'utf8')
      await writeJson(metadataPath, {
        schemaVersion: '0.1.0',
        sourceId: source.id,
        generatedAt: new Date().toISOString(),
        metadata: result.metadata,
        ...(result.warnings ? { warnings: result.warnings } : {}),
        stats: result.stats,
      })
      Object.assign(entry, {
        candidateStatus: 'generated_unverified',
        candidatePath: toPosix(relative(intake.rootReal, candidatePath)),
        candidateSha256: sha256(candidateJson),
        metadataPath: toPosix(relative(intake.rootReal, metadataPath)),
        roomCount: result.draft.rooms.length,
        openingCount: result.draft.openings.length,
        warningCount: result.warnings?.length ?? 0,
        calibrationBasis: result.stats.calibrationBasis,
        pixelsPerMeterX: result.stats.pixelsPerMeterX,
        pixelsPerMeterY: result.stats.pixelsPerMeterY,
        servedModel: result.response.servedModel,
        inputTokens: result.response.inputTokens ?? null,
        outputTokens: result.response.outputTokens ?? null,
        extractorLatencyMs: result.response.latencyMs,
      })
    } catch (error) {
      Object.assign(entry, {
        candidateStatus: 'failed',
        failureCode: classify(error),
        failureMessage: failureMessage(error),
      })
      if (error instanceof VisionExtractionError && error.response) {
        // 失败响应同样消耗 Token，计入用量，避免低估成本。
        entry.servedModel = error.response.servedModel
        entry.inputTokens = error.response.inputTokens ?? null
        entry.outputTokens = error.response.outputTokens ?? null
      }
    }
    entry.elapsedMs = Date.now() - started

    if (args.replay) {
      const recorded = recordedCases.get(source.id)
      entry.matchesRecordedCandidate =
        recorded?.candidateStatus === entry.candidateStatus &&
        recorded?.candidateSha256 === entry.candidateSha256 &&
        recorded?.failureCode === entry.failureCode
    }
    results.set(source.id, entry)
    process.stderr.write(
      source.id +
        ' → ' +
        String(entry.candidateStatus) +
        (entry.failureCode ? ' (' + String(entry.failureCode) + ')' : '') +
        '\n',
    )
  })

  const cases: Record<string, unknown>[] = intake.cases.map(({ bytes, ...source }) => ({
    ...source,
    gtStatus: 'pending_human_review',
    ...(results.get(source.id) ?? { candidateStatus: 'not_run' }),
  }))
  const generated = cases.filter((c) => c.candidateStatus === 'generated_unverified')
  const failed = cases.filter((c) => c.candidateStatus === 'failed')
  const failureCounts: Record<string, number> = {}
  for (const c of failed) {
    const code = String(c.failureCode)
    failureCounts[code] = (failureCounts[code] ?? 0) + 1
  }
  const latencies = generated
    .map((c) => c.extractorLatencyMs)
    .filter((v): v is number => typeof v === 'number')
  const sum = (key: string) =>
    cases.reduce((total, c) => {
      const v = c[key]
      return total + (typeof v === 'number' ? v : 0)
    }, 0)

  const report = {
    schemaVersion: '0.1.0',
    reportType: 'real_floorplan_intake_pre_ground_truth',
    dataset: intake.dataset,
    extractorId: VISION_EXTRACTOR_ID,
    sourceSetFingerprint: intake.sourceSetFingerprint,
    ...(args.replay
      ? { replayOf: toPosix(relative(intake.rootReal, resolve(runDir, 'report.json'))) }
      : {}),
    config: {
      provider: 'anthropic',
      model: args.model,
      effort: args.effort,
      maxLongEdgePx: args.maxLongEdge,
      assumedPixelsPerMeter: args.assumedPixelsPerMeter,
      promptVersion: VISION_PROMPT_VERSION,
      promptFingerprint,
      preparerId: preparer.id,
    },
    caseCount: cases.length,
    selectedCaseCount: selected.length,
    extractedCount: generated.length,
    failedCount: failed.length,
    notRunCount: cases.length - generated.length - failed.length,
    failureCounts: Object.fromEntries(
      Object.entries(failureCounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
    ...(args.replay
      ? {
          replayMismatchCount: [...results.values()].filter(
            (r) => r.matchesRecordedCandidate !== true,
          ).length,
        }
      : {}),
    usage: {
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      latencyP50Ms: percentile(latencies, 50),
      latencyP95Ms: percentile(latencies, 95),
    },
    groundTruthCaseCount: 0,
    benchmarkReady: false,
    isOfficialCorpusFingerprint: false,
    cases,
  }
  await writeJson(reportPath, report)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (report.failedCount || (args.replay && report.replayMismatchCount)) process.exitCode = 2
}

main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
  process.exitCode = 1
})

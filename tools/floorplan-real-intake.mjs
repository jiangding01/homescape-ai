#!/usr/bin/env node

// PR #17: real-image intake is deliberately separate from the verified Ground Truth Corpus.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const EXTRACTOR_ID = 'raster-orthogonal-v0.1'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const isHash = (s) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s)
const record = (x) => x && typeof x === 'object' && !Array.isArray(x)
const fail = (m) => { throw new Error(m) }

function usage() {
  return [
    '用法：node tools/floorplan-real-intake.mjs <intake.json> [--report <report.json>] [--extract] [--pixels-per-meter <number>]',
    '注意：只做真实图片预标注 Intake，不生成或假冒 Ground Truth / Corpus Fingerprint / Benchmark。',
  ].join('\n')
}
function parseArgs(args) {
  const all = [...args]
  const manifest = all.shift()
  if (!manifest || manifest.startsWith('-')) fail(usage())
  const parsed = { manifest: resolve(manifest), report: undefined, extract: false, pixelsPerMeter: 100 }
  while (all.length) {
    const flag = all.shift()
    if (flag === '--report') {
      const path = all.shift()
      if (!path || path.startsWith('-')) fail('--report 需要文件路径')
      parsed.report = resolve(path)
    } else if (flag === '--extract') parsed.extract = true
    else if (flag === '--pixels-per-meter') {
      const value = Number(all.shift())
      if (!Number.isFinite(value) || value <= 0 || value > 10000) fail('--pixels-per-meter 必须是 0~10000 的正数')
      parsed.pixelsPerMeter = value
    } else fail('未知参数：' + flag + '\n' + usage())
  }
  if (parsed.extract && !parsed.report) fail('--extract 必须同时指定 --report，确保失败记录能够留存')
  return parsed
}
function requireWithin(root, target, name) {
  const rel = relative(root, target)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) fail(name + ' 越过 Intake 根目录')
  return target
}
async function inputPath(root, rel, name) {
  if (typeof rel !== 'string' || !rel.trim() || isAbsolute(rel)) fail(name + ' 不是相对路径')
  const path = requireWithin(root, resolve(root, rel), name)
  const realRoot = await realpath(root)
  const realInput = await realpath(path)
  requireWithin(realRoot, realInput, name)
  if (!(await lstat(realInput)).isFile()) fail(name + ' 不是普通文件')
  return realInput
}
async function outputPath(root, target, name) {
  requireWithin(root, target, name)
  const realRoot = await realpath(root)
  let parent = dirname(target)
  while (true) {
    try {
      const realParent = await realpath(parent)
      requireWithin(realRoot, realParent, name)
      break
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e
      const next = dirname(parent)
      if (next === parent) fail(name + ' 父目录不可解析')
      parent = next
    }
  }
  try {
    if ((await lstat(target)).isSymbolicLink()) fail(name + ' 不能指向符号链接')
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e
  }
  return target
}
function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('JPEG 文件头无效')
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) fail('JPEG 段边界无效')
    while (bytes[offset] === 0xff) offset++
    if (offset >= bytes.length) break
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) fail('JPEG 段长度无效')
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 7) fail('JPEG 图像尺寸段无效')
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += length
  }
  fail('JPEG 缺少图像尺寸段')
}
function imageDimensions(bytes, mediaType) {
  if (mediaType === 'image/png') {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('PNG 头部无效')
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (mediaType === 'image/jpeg') return jpegSize(bytes)
  fail('暂不支持 ' + mediaType + '，请先在本地无损标准化')
}
function validateCase(c, i) {
  if (!record(c)) fail('cases[' + i + '] 无效')
  const id = c.id
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) fail('caseId 非法：' + String(id))
  if (!['image/png', 'image/jpeg'].includes(c.mediaType)) fail(id + ' mediaType 非法')
  if (!isHash(c.sourceSha256)) fail(id + ' sourceSha256 非法')
  if (!Number.isInteger(c.widthPx) || c.widthPx < 1 || !Number.isInteger(c.heightPx) || c.heightPx < 1) fail(id + ' 图像尺寸非法')
  if (typeof c.group !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(c.group)) fail(id + ' group 非法')
  if (c.originalSha256 !== undefined && !isHash(c.originalSha256)) fail(id + ' originalSha256 非法')
  if (c.geometryStage !== undefined && !['full_page', 'floorplan_roi'].includes(c.geometryStage)) fail(id + ' geometryStage 非法')
  if (c.geometryStage === 'floorplan_roi' && !record(c.roi)) fail(id + ' ROI 处理未记录几何变换')
  return c
}
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = dirname(args.manifest)
  const m = JSON.parse(await readFile(args.manifest, 'utf8'))
  if (!record(m) || m.schemaVersion !== '0.1.0' || typeof m.dataset !== 'string' || !m.dataset.trim() || !Array.isArray(m.cases) || m.cases.length === 0) fail('需要 Real Intake Manifest v0.1')
  const seenIds = new Set()
  const seenImages = new Set()
  const sources = []
  const rootReal = await realpath(root)
  // 全量 Preflight 必须在创建任何 Candidate 目录前完成。
  for (const [i, raw] of m.cases.entries()) {
    const c = validateCase(raw, i)
    if (seenIds.has(c.id)) fail('Case ID 重复：' + c.id)
    seenIds.add(c.id)
    const path = await inputPath(root, c.sourcePath, c.id + '.sourcePath')
    const ext = extname(path).toLowerCase()
    if (!(c.mediaType === 'image/png' ? ext === '.png' : ext === '.jpg' || ext === '.jpeg')) fail(c.id + ' 扩展名与实际格式不符')
    const bytes = await readFile(path)
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) fail(c.id + ' 输入尺寸超出 0~20MB')
    const actualSha = sha256(bytes)
    if (actualSha !== c.sourceSha256) fail(c.id + ' 源文件 SHA-256 不匹配')
    if (seenImages.has(actualSha)) fail(c.id + ' 与已有 Case 完全重复')
    seenImages.add(actualSha)
    const dimensions = imageDimensions(bytes, c.mediaType)
    if (dimensions.width !== c.widthPx || dimensions.height !== c.heightPx) fail(c.id + ' 源图宽高与清单不一致')
    if (dimensions.width * dimensions.height > 40_000_000) fail(c.id + ' 源图像素超出 40MP')
    sources.push({
      id: c.id,
      group: c.group,
      style: typeof c.style === 'string' ? c.style : 'unspecified',
      mediaType: c.mediaType,
      sourcePath: relative(rootReal, path).split(sep).join('/'),
      sourceSha256: actualSha,
      ...(c.originalSha256 ? { originalSha256: c.originalSha256 } : {}),
      widthPx: dimensions.width,
      heightPx: dimensions.height,
      geometryStage: c.geometryStage ?? 'full_page',
      ...(c.roi ? { roi: c.roi } : {}),
      gtStatus: 'pending_human_review',
      candidateStatus: 'not_run',
      filePath: path,
    })
  }
  const reportTarget = args.report ? await outputPath(root, args.report, 'report') : undefined
  const reserved = new Set([await realpath(args.manifest), ...sources.map((s) => s.filePath)].map((p) => p.toLowerCase()))
  if (reportTarget && reserved.has(reportTarget.toLowerCase())) fail('report 与输入源文件冲突')
  const plannedOutput = []
  for (const c of sources) {
    for (const path of [resolve(root, 'candidates', EXTRACTOR_ID, c.id + '.json'), resolve(root, 'metadata', EXTRACTOR_ID, c.id + '.json')]) {
      if (reserved.has(path.toLowerCase()) || (reportTarget && reportTarget.toLowerCase() === path.toLowerCase())) fail('输出路径与输入或报告冲突')
      if (args.extract) await outputPath(root, path, 'candidate/metadata')
      plannedOutput.push(path)
    }
  }
  const fingerprint = sha256(sources.map((s) => JSON.stringify([s.id,s.group,s.sourceSha256,s.geometryStage,s.roi ?? null])).sort().join('\n'))
  if (args.extract) {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    for (const source of sources) {
      const candidate = resolve(root, 'candidates', EXTRACTOR_ID, source.id + '.json')
      const metadata = resolve(root, 'metadata', EXTRACTOR_ID, source.id + '.json')
      const started = Date.now()
      const result = spawnSync(pnpm, ['exec', 'tsx', 'tools/floorplan-raster-extract.ts', source.filePath, candidate, '--metadata', metadata, '--source-id', source.id, '--pixels-per-meter', String(args.pixelsPerMeter)], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
      source.candidateStatus = result.status === 0 && !result.error ? 'generated_unverified' : 'failed'
      source.elapsedMs = Date.now() - started
      if (source.candidateStatus === 'failed') source.error = String(result.error?.message ?? result.stderr ?? 'Extractor exit=' + result.status).slice(-700)
    }
  }
  const sanitized = sources.map(({filePath, ...item}) => item)
  const report = {
    schemaVersion: '0.1.0',
    reportType: 'real_floorplan_intake_pre_ground_truth',
    dataset: m.dataset,
    sourceSetFingerprint: fingerprint,
    caseCount: sanitized.length,
    extractedCount: sanitized.filter((s) => s.candidateStatus === 'generated_unverified').length,
    failedCount: sanitized.filter((s) => s.candidateStatus === 'failed').length,
    groundTruthCaseCount: 0,
    benchmarkReady: false,
    isOfficialCorpusFingerprint: false,
    cases: sanitized,
  }
  if (reportTarget) {
    await mkdir(dirname(reportTarget), { recursive: true })
    await writeFile(reportTarget, JSON.stringify(report, null, 2) + '\n')
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (report.failedCount) process.exitCode = 2
}
main().catch((e) => { process.stderr.write((e?.stack ?? String(e)) + '\n'); process.exitCode = 1 })
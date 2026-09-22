#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const ROOM_TYPES = new Set([
  'living',
  'dining',
  'kitchen',
  'bedroom',
  'bathroom',
  'study',
  'balcony',
  'hallway',
  'utility',
  'other',
])

const OPENING_KINDS = new Set(['door', 'window', 'opening'])

const VALID = {
  sourceKind: new Set([
    'floorplan_image',
    'floorplan_pdf',
    'company_data',
  ]),
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

function usage() {
  return [
    '用法：',
    '  node tools/floorplan-corpus.mjs <corpus.json>',
    '    [--min-cases <number>]',
    '    [--report <summary.json>]',
  ].join('\n')
}

function parseArgs(argv) {
  const args = [...argv]
  const manifestPath = args.shift()

  if (!manifestPath || manifestPath.startsWith('-')) {
    throw new Error(usage())
  }

  let minCases = 1
  let reportPath

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--min-cases') {
      const raw = args.shift()
      const value = raw ? Number(raw) : Number.NaN

      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--min-cases 必须是 >= 1 的整数')
      }

      minCases = value
      continue
    }

    if (arg === '--report') {
      const value = args.shift()
      if (!value) throw new Error('--report 缺少文件路径')
      reportPath = resolve(process.cwd(), value)
      continue
    }

    throw new Error('未知参数：' + arg + '\n' + usage())
  }

  return {
    manifestPath: resolve(process.cwd(), manifestPath),
    minCases,
    reportPath,
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

async function resolveWithinRoot(root, pathValue, label) {
  const target = resolve(root, nonEmptyString(pathValue, label))
  const [realRoot, realTarget] = await Promise.all([
    realpath(root),
    realpath(target),
  ])
  const rel = relative(realRoot, realTarget)

  if (rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error(label + ' 越过 Corpus 目录')
  }

  return realTarget
}

function validateTag(tags, key, caseId) {
  const value = tags[key]
  const allowed = VALID[key]

  if (!allowed.has(value)) {
    throw new Error(
      caseId +
        '.tags.' +
        key +
        ' 无效：' +
        String(value),
    )
  }

  return value
}

function isFinitePoint(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (entry) => typeof entry === 'number' && Number.isFinite(entry),
    )
  )
}

function pointWithinSource(point, source) {
  return (
    point[0] >= 0 &&
    point[0] <= source.widthPx &&
    point[1] >= 0 &&
    point[1] <= source.heightPx
  )
}

function pointDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function cross(a, b, c) {
  return (
    (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0])
  )
}

function onSegment(a, b, point) {
  const epsilon = 1e-9

  return (
    Math.abs(cross(a, b, point)) <= epsilon &&
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  )
}

function segmentsIntersect(aStart, aEnd, bStart, bEnd) {
  const aToBStart = cross(aStart, aEnd, bStart)
  const aToBEnd = cross(aStart, aEnd, bEnd)
  const bToAStart = cross(bStart, bEnd, aStart)
  const bToAEnd = cross(bStart, bEnd, aEnd)

  if (
    ((aToBStart > 0 && aToBEnd < 0) ||
      (aToBStart < 0 && aToBEnd > 0)) &&
    ((bToAStart > 0 && bToAEnd < 0) ||
      (bToAStart < 0 && bToAEnd > 0))
  ) {
    return true
  }

  return (
    onSegment(aStart, aEnd, bStart) ||
    onSegment(aStart, aEnd, bEnd) ||
    onSegment(bStart, bEnd, aStart) ||
    onSegment(bStart, bEnd, aEnd)
  )
}

function polygonHasSelfIntersection(points) {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length
    const aStart = points[left]
    const aEnd = points[leftNext]

    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length

      if (
        left === right ||
        leftNext === right ||
        rightNext === left
      ) {
        continue
      }

      const bStart = points[right]
      const bEnd = points[rightNext]

      if (segmentsIntersect(aStart, aEnd, bStart, bEnd)) {
        return true
      }
    }
  }

  return false
}

function polygonSignedArea(points) {
  let sum = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    sum += current[0] * next[1] - next[0] * current[1]
  }

  return sum / 2
}

function mediaTypeMatchesSourceKind(sourceKind, mediaType) {
  const normalized =
    mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? ''

  if (sourceKind === 'floorplan_image') {
    return normalized.startsWith('image/')
  }

  if (sourceKind === 'floorplan_pdf') {
    return normalized === 'application/pdf'
  }

  return (
    normalized === 'application/json' ||
    normalized ===
      'application/vnd.homescape.metric-floorplan+json'
  )
}

function validateGroundTruth(value, expectedKind, caseId) {
  const draft = asRecord(value)

  if (!draft || draft.schemaVersion !== '0.1.0') {
    throw new Error(caseId + ' Ground Truth schemaVersion 无效')
  }

  const source = asRecord(draft.source)

  if (
    !source ||
    source.kind !== expectedKind ||
    !Number.isFinite(source.widthPx) ||
    source.widthPx <= 0 ||
    !Number.isFinite(source.heightPx) ||
    source.heightPx <= 0 ||
    typeof source.sourceLabel !== 'string' ||
    !source.sourceLabel.trim()
  ) {
    throw new Error(caseId + ' Ground Truth source 无效')
  }

  const calibration = asRecord(draft.calibration)

  if (
    !calibration ||
    !isFinitePoint(calibration.startPx) ||
    !isFinitePoint(calibration.endPx) ||
    !Number.isFinite(calibration.realDistanceMeters) ||
    calibration.realDistanceMeters <= 0 ||
    pointDistance(calibration.startPx, calibration.endPx) <= 1e-9 ||
    !pointWithinSource(calibration.startPx, source) ||
    !pointWithinSource(calibration.endPx, source)
  ) {
    throw new Error(caseId + ' Ground Truth calibration 无效')
  }

  const assumptions = asRecord(draft.assumptions)

  if (
    !assumptions ||
    !Number.isFinite(assumptions.wallThicknessMeters) ||
    assumptions.wallThicknessMeters <= 0 ||
    !Number.isFinite(assumptions.ceilingHeightMeters) ||
    assumptions.ceilingHeightMeters <= 0 ||
    typeof assumptions.wallThicknessConfirmed !== 'boolean' ||
    typeof assumptions.ceilingHeightConfirmed !== 'boolean'
  ) {
    throw new Error(caseId + ' Ground Truth assumptions 无效')
  }

  if (!Array.isArray(draft.rooms) || draft.rooms.length === 0) {
    throw new Error(caseId + ' Ground Truth 缺少 rooms')
  }

  const entityIds = new Set()
  const roomIds = new Set()

  for (const roomValue of draft.rooms) {
    const room = asRecord(roomValue)

    if (
      !room ||
      typeof room.id !== 'string' ||
      !room.id ||
      typeof room.type !== 'string' ||
      !ROOM_TYPES.has(room.type) ||
      !Array.isArray(room.boundaryPx) ||
      room.boundaryPx.length < 3 ||
      !room.boundaryPx.every(isFinitePoint)
    ) {
      throw new Error(
        caseId + ' Ground Truth Room 必须有 id/type/boundary',
      )
    }

    if (entityIds.has(room.id)) {
      throw new Error(caseId + ' Ground Truth 实体 ID 重复：' + room.id)
    }

    if (!room.boundaryPx.every((point) => pointWithinSource(point, source))) {
      throw new Error(
        caseId + ' Ground Truth Room 超出 source bounds：' + room.id,
      )
    }

    if (Math.abs(polygonSignedArea(room.boundaryPx)) <= 1e-9) {
      throw new Error(
        caseId + ' Ground Truth Room Polygon 面积为 0：' + room.id,
      )
    }

    if (polygonHasSelfIntersection(room.boundaryPx)) {
      throw new Error(
        caseId + ' Ground Truth Room Polygon 自相交：' + room.id,
      )
    }

    for (
      let edgeIndex = 0;
      edgeIndex < room.boundaryPx.length;
      edgeIndex += 1
    ) {
      const start = room.boundaryPx[edgeIndex]
      const end =
        room.boundaryPx[
          (edgeIndex + 1) % room.boundaryPx.length
        ]

      if (pointDistance(start, end) <= 1e-9) {
        throw new Error(
          caseId + ' Ground Truth Room 包含零长度边：' + room.id,
        )
      }
    }

    entityIds.add(room.id)
    roomIds.add(room.id)
  }

  if (!Array.isArray(draft.openings)) {
    throw new Error(caseId + ' Ground Truth openings 必须为数组')
  }

  for (const openingValue of draft.openings) {
    const opening = asRecord(openingValue)

    if (
      !opening ||
      typeof opening.id !== 'string' ||
      !opening.id ||
      typeof opening.roomId !== 'string' ||
      !roomIds.has(opening.roomId) ||
      !Number.isInteger(opening.edgeIndex) ||
      opening.edgeIndex < 0 ||
      !OPENING_KINDS.has(opening.kind) ||
      !Number.isFinite(opening.offsetPx) ||
      opening.offsetPx < 0 ||
      !Number.isFinite(opening.widthPx) ||
      opening.widthPx <= 0 ||
      !Number.isFinite(opening.heightMeters) ||
      opening.heightMeters <= 0
    ) {
      throw new Error(caseId + ' Ground Truth Opening 格式无效')
    }

    if (entityIds.has(opening.id)) {
      throw new Error(
        caseId + ' Ground Truth 实体 ID 重复：' + opening.id,
      )
    }

    const room = draft.rooms.find(
      (roomValue) =>
        asRecord(roomValue)?.id === opening.roomId,
    )
    const typedRoom = asRecord(room)

    if (
      !typedRoom ||
      !Array.isArray(typedRoom.boundaryPx) ||
      opening.edgeIndex >= typedRoom.boundaryPx.length
    ) {
      throw new Error(
        caseId + ' Ground Truth Opening edgeIndex 越界：' + opening.id,
      )
    }

    const start = typedRoom.boundaryPx[opening.edgeIndex]
    const end =
      typedRoom.boundaryPx[
        (opening.edgeIndex + 1) % typedRoom.boundaryPx.length
      ]
    const edgeLength = pointDistance(start, end)

    if (opening.offsetPx + opening.widthPx > edgeLength + 1e-9) {
      throw new Error(
        caseId + ' Ground Truth Opening 超出 Room Edge：' + opening.id,
      )
    }

    const sillHeight =
      opening.sillHeightMeters === undefined
        ? 0
        : opening.sillHeightMeters

    if (
      !Number.isFinite(sillHeight) ||
      sillHeight < 0 ||
      sillHeight + opening.heightMeters >
        assumptions.ceilingHeightMeters + 1e-9
    ) {
      throw new Error(
        caseId + ' Ground Truth Opening 垂直尺寸无效：' + opening.id,
      )
    }

    entityIds.add(opening.id)
  }

  return {
    roomCount: draft.rooms.length,
    openingCount: draft.openings.length,
  }
}

function increment(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(
    await readFile(args.manifestPath, 'utf8'),
  )
  const record = asRecord(manifest)

  if (!record || record.schemaVersion !== '0.1.0') {
    throw new Error('只支持 Floor Plan Corpus v0.1.0')
  }

  const dataset = nonEmptyString(record.dataset, 'dataset')

  if (!Array.isArray(record.cases)) {
    throw new Error('cases 必须是数组')
  }

  if (record.cases.length < args.minCases) {
    throw new Error(
      'Corpus Case 数不足：' +
        record.cases.length +
        ' < ' +
        args.minCases,
    )
  }

  const root = dirname(args.manifestPath)
  const ids = new Set()
  const distributions = {
    sourceKind: {},
    quality: {},
    geometry: {},
    annotation: {},
    layout: {},
    symbols: {},
    textDensity: {},
  }
  let totalSourceBytes = 0
  let roomCount = 0
  let openingCount = 0
  const caseFingerprints = []

  for (const [index, caseValue] of record.cases.entries()) {
    const corpusCase = asRecord(caseValue)
    const label = 'cases[' + index + ']'

    if (!corpusCase) throw new Error(label + ' 格式无效')

    const id = nonEmptyString(corpusCase.id, label + '.id')

    if (ids.has(id)) throw new Error('Case ID 重复：' + id)
    ids.add(id)

    if (!VALID.sourceKind.has(corpusCase.sourceKind)) {
      throw new Error(id + '.sourceKind 无效')
    }

    const mediaType = nonEmptyString(
      corpusCase.mediaType,
      id + '.mediaType',
    )

    if (
      !mediaTypeMatchesSourceKind(
        corpusCase.sourceKind,
        mediaType,
      )
    ) {
      throw new Error(
        id +
          '.mediaType 与 sourceKind 不匹配：' +
          mediaType,
      )
    }

    const tags = asRecord(corpusCase.tags)
    if (!tags) throw new Error(id + '.tags 格式无效')

    increment(distributions.sourceKind, corpusCase.sourceKind)

    const normalizedTags = {}

    for (const key of [
      'quality',
      'geometry',
      'annotation',
      'layout',
      'symbols',
      'textDensity',
    ]) {
      const value = validateTag(tags, key, id)
      normalizedTags[key] = value
      increment(distributions[key], value)
    }

    const sourcePath = await resolveWithinRoot(
      root,
      corpusCase.sourcePath,
      id + '.sourcePath',
    )
    const groundTruthPath = await resolveWithinRoot(
      root,
      corpusCase.groundTruthPath,
      id + '.groundTruthPath',
    )

    const sourceBytes = await readFile(sourcePath)
    if (sourceBytes.length === 0) {
      throw new Error(id + ' Source 文件为空')
    }
    totalSourceBytes += sourceBytes.length

    const groundTruthBytes = await readFile(groundTruthPath)
    const groundTruth = JSON.parse(
      groundTruthBytes.toString('utf8'),
    )
    const gt = validateGroundTruth(
      groundTruth,
      corpusCase.sourceKind,
      id,
    )

    roomCount += gt.roomCount
    openingCount += gt.openingCount
    const sourceSha256 = sha256(sourceBytes)
    const groundTruthSha256 = sha256(groundTruthBytes)
    const caseFingerprint = sha256(
      Buffer.from(
        JSON.stringify({
          id,
          sourceKind: corpusCase.sourceKind,
          mediaType,
          tags: normalizedTags,
          sourceSha256,
          groundTruthSha256,
        }),
        'utf8',
      ),
    )

    caseFingerprints.push({
      id,
      caseFingerprint,
      sourceBytes: sourceBytes.length,
      sourceSha256,
      groundTruthSha256,
      roomCount: gt.roomCount,
      openingCount: gt.openingCount,
    })
  }

  caseFingerprints.sort((a, b) => a.id.localeCompare(b.id))
  const datasetFingerprint = sha256(
    Buffer.from(
      caseFingerprints
        .map(
          (entry) =>
            entry.id +
            ':' +
            entry.caseFingerprint,
        )
        .join('\n'),
      'utf8',
    ),
  )

  const summary = {
    schemaVersion: '0.1.0',
    dataset,
    checkedAt: new Date().toISOString(),
    datasetFingerprint,
    caseCount: record.cases.length,
    totalSourceBytes,
    roomCount,
    openingCount,
    distributions,
    cases: caseFingerprints,
  }
  const output = JSON.stringify(summary, null, 2) + '\n'

  if (args.reportPath) {
    await mkdir(dirname(args.reportPath), { recursive: true })
    await writeFile(args.reportPath, output, 'utf8')
  }

  process.stdout.write(output)
}

main().catch((error) => {
  process.stderr.write(
    (error instanceof Error ? error.stack ?? error.message : String(error)) +
      '\n',
  )
  process.exitCode = 1
})

#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const DEFAULT_GRID_SIZE = 96
const EPSILON = 1e-9

function usage() {
  return [
    '用法：',
    '  node tools/floorplan-benchmark.mjs <manifest.json>',
    '    [--report <report.json>]',
    '    [--require-pass]',
    '',
    '--require-pass：任意 Candidate gate fail 时进程返回非 0。',
    '默认只在 expectedGate 与实际 Gate 不一致时返回非 0。',
  ].join('\n')
}

function parseArgs(argv) {
  const args = [...argv]
  const manifest = args.shift()

  if (!manifest || manifest.startsWith('-')) {
    throw new Error(usage())
  }

  let reportPath
  let requirePass = false

  while (args.length > 0) {
    const arg = args.shift()

    if (arg === '--report') {
      const value = args.shift()
      if (!value) throw new Error('--report 缺少文件路径')
      reportPath = resolve(process.cwd(), value)
      continue
    }

    if (arg === '--require-pass') {
      requirePass = true
      continue
    }

    throw new Error('未知参数：' + arg + '\n' + usage())
  }

  return {
    manifestPath: resolve(process.cwd(), manifest),
    reportPath,
    requirePass,
  }
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(label + ' 必须是有限数值')
  }

  return value
}

function integerInRange(value, min, max, label) {
  const result = finiteNumber(value, label)

  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(
      label + ' 必须是 ' + min + ' ~ ' + max + ' 之间的整数',
    )
  }

  return result
}

function numberInRange(value, min, max, label) {
  const result = finiteNumber(value, label)

  if (result < min || result > max) {
    throw new Error(
      label + ' 必须位于 ' + min + ' ~ ' + max + ' 之间',
    )
  }

  return result
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(label + ' 不能为空')
  }

  return value
}

function resolveWithinManifest(manifestPath, value, label) {
  const root = dirname(manifestPath)
  const target = resolve(root, nonEmptyString(value, label))
  const rel = relative(root, target)

  if (rel === '..' || rel.startsWith('..' + sep)) {
    throw new Error(label + ' 不能越过 Benchmark Manifest 目录')
  }

  return target
}

function validateThresholds(value) {
  const thresholds = asRecord(value)
  if (!thresholds) throw new Error('thresholds 格式无效')

  return {
    roomMatchIou: numberInRange(
      thresholds.roomMatchIou,
      0,
      1,
      'thresholds.roomMatchIou',
    ),
    roomPrecisionMin: numberInRange(
      thresholds.roomPrecisionMin,
      0,
      1,
      'thresholds.roomPrecisionMin',
    ),
    roomRecallMin: numberInRange(
      thresholds.roomRecallMin,
      0,
      1,
      'thresholds.roomRecallMin',
    ),
    meanRoomIouMin: numberInRange(
      thresholds.meanRoomIouMin,
      0,
      1,
      'thresholds.meanRoomIouMin',
    ),
    roomTypeAccuracyMin: numberInRange(
      thresholds.roomTypeAccuracyMin,
      0,
      1,
      'thresholds.roomTypeAccuracyMin',
    ),
    candidateRoomOverlapRatioMax: numberInRange(
      thresholds.candidateRoomOverlapRatioMax,
      0,
      1,
      'thresholds.candidateRoomOverlapRatioMax',
    ),
    openingCenterToleranceRatio: numberInRange(
      thresholds.openingCenterToleranceRatio,
      0,
      1,
      'thresholds.openingCenterToleranceRatio',
    ),
    openingPrecisionMin: numberInRange(
      thresholds.openingPrecisionMin,
      0,
      1,
      'thresholds.openingPrecisionMin',
    ),
    openingRecallMin: numberInRange(
      thresholds.openingRecallMin,
      0,
      1,
      'thresholds.openingRecallMin',
    ),
    meanOpeningWidthErrorMax: numberInRange(
      thresholds.meanOpeningWidthErrorMax,
      0,
      1,
      'thresholds.meanOpeningWidthErrorMax',
    ),
    scaleErrorMax: numberInRange(
      thresholds.scaleErrorMax,
      0,
      1,
      'thresholds.scaleErrorMax',
    ),
  }
}

function validateManifest(value, manifestPath) {
  const manifest = asRecord(value)

  if (!manifest || manifest.schemaVersion !== '0.1.0') {
    throw new Error(
      '只支持 Floor Plan Benchmark Manifest v0.1.0',
    )
  }

  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error('manifest.cases 至少需要一个 Case')
  }

  const caseIds = new Set()
  const cases = manifest.cases.map((rawCase, caseIndex) => {
    const benchmarkCase = asRecord(rawCase)
    if (!benchmarkCase) {
      throw new Error('cases[' + caseIndex + '] 格式无效')
    }

    const id = nonEmptyString(
      benchmarkCase.id,
      'cases[' + caseIndex + '].id',
    )

    if (caseIds.has(id)) throw new Error('Case ID 重复：' + id)
    caseIds.add(id)

    if (
      !Array.isArray(benchmarkCase.candidates) ||
      benchmarkCase.candidates.length === 0
    ) {
      throw new Error(id + ' 至少需要一个 Candidate')
    }

    const extractorIds = new Set()
    const candidates = benchmarkCase.candidates.map(
      (rawCandidate, candidateIndex) => {
        const candidate = asRecord(rawCandidate)

        if (!candidate) {
          throw new Error(
            id + '.candidates[' + candidateIndex + '] 格式无效',
          )
        }

        const extractorId = nonEmptyString(
          candidate.extractorId,
          id + '.candidates[' + candidateIndex + '].extractorId',
        )

        if (extractorIds.has(extractorId)) {
          throw new Error(
            id + ' 内 extractorId 重复：' + extractorId,
          )
        }
        extractorIds.add(extractorId)

        if (
          candidate.expectedGate !== undefined &&
          candidate.expectedGate !== 'pass' &&
          candidate.expectedGate !== 'fail'
        ) {
          throw new Error(
            id + '/' + extractorId + ' expectedGate 只能是 pass / fail',
          )
        }

        return {
          extractorId,
          candidatePath: resolveWithinManifest(
            manifestPath,
            candidate.candidatePath,
            id + '/' + extractorId + '.candidatePath',
          ),
          ...(candidate.expectedGate
            ? { expectedGate: candidate.expectedGate }
            : {}),
        }
      },
    )

    return {
      id,
      sourcePath: resolveWithinManifest(
        manifestPath,
        benchmarkCase.sourcePath,
        id + '.sourcePath',
      ),
      groundTruthPath: resolveWithinManifest(
        manifestPath,
        benchmarkCase.groundTruthPath,
        id + '.groundTruthPath',
      ),
      candidates,
    }
  })

  return {
    schemaVersion: '0.1.0',
    dataset: nonEmptyString(manifest.dataset, 'dataset'),
    gridSize:
      manifest.gridSize === undefined
        ? DEFAULT_GRID_SIZE
        : integerInRange(
            manifest.gridSize,
            32,
            256,
            'gridSize',
          ),
    thresholds: validateThresholds(manifest.thresholds),
    cases,
  }
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

function pixelDistance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
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

function validateDraft(value, label) {
  const draft = asRecord(value)
  const failures = []

  if (!draft || draft.schemaVersion !== '0.1.0') {
    return {
      valid: false,
      failures: [label + ': schemaVersion 必须为 0.1.0'],
    }
  }

  const source = asRecord(draft.source)
  const calibration = asRecord(draft.calibration)
  const assumptions = asRecord(draft.assumptions)
  const roomTypes = new Set([
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
  const openingSwings = new Set([
    'left',
    'right',
    'double',
    'sliding',
    'none',
  ])

  if (
    !source ||
    !['floorplan_image', 'floorplan_pdf', 'company_data'].includes(
      source.kind,
    ) ||
    typeof source.sourceLabel !== 'string' ||
    !Number.isFinite(source.widthPx) ||
    source.widthPx <= 0 ||
    !Number.isFinite(source.heightPx) ||
    source.heightPx <= 0
  ) {
    failures.push(label + ': source 无效')
  }

  const pointWithinSource = (point) =>
    source &&
    Number.isFinite(source.widthPx) &&
    Number.isFinite(source.heightPx) &&
    point[0] >= 0 &&
    point[0] <= source.widthPx &&
    point[1] >= 0 &&
    point[1] <= source.heightPx

  if (
    !calibration ||
    !isFinitePoint(calibration.startPx) ||
    !isFinitePoint(calibration.endPx) ||
    !Number.isFinite(calibration.realDistanceMeters) ||
    calibration.realDistanceMeters <= 0 ||
    (isFinitePoint(calibration.startPx) &&
      isFinitePoint(calibration.endPx) &&
      pixelDistance(
        calibration.startPx,
        calibration.endPx,
      ) <= EPSILON)
  ) {
    failures.push(label + ': calibration 无效')
  } else if (
    !pointWithinSource(calibration.startPx) ||
    !pointWithinSource(calibration.endPx)
  ) {
    failures.push(label + ': calibration point 超出 source bounds')
  }

  if (
    !assumptions ||
    !Number.isFinite(assumptions.wallThicknessMeters) ||
    assumptions.wallThicknessMeters <= 0 ||
    !Number.isFinite(assumptions.ceilingHeightMeters) ||
    assumptions.ceilingHeightMeters <= 0 ||
    typeof assumptions.wallThicknessConfirmed !== 'boolean' ||
    typeof assumptions.ceilingHeightConfirmed !== 'boolean'
  ) {
    failures.push(label + ': assumptions 无效')
  }

  const rooms = Array.isArray(draft.rooms) ? draft.rooms : []
  const openings = Array.isArray(draft.openings)
    ? draft.openings
    : []

  if (rooms.length === 0) {
    failures.push(label + ': rooms 至少需要一个 Room')
  }

  const ids = new Set()
  const roomMap = new Map()

  for (const [roomIndex, roomValue] of rooms.entries()) {
    const room = asRecord(roomValue)
    const prefix = label + '.rooms[' + roomIndex + ']'

    if (
      !room ||
      typeof room.id !== 'string' ||
      !room.id ||
      typeof room.name !== 'string' ||
      !room.name ||
      (room.type !== undefined && !roomTypes.has(room.type)) ||
      !Array.isArray(room.boundaryPx) ||
      room.boundaryPx.length < 3 ||
      !room.boundaryPx.every(isFinitePoint)
    ) {
      failures.push(prefix + ': Room 格式无效')
      continue
    }

    if (ids.has(room.id)) {
      failures.push(prefix + ': ID 重复 ' + room.id)
    }
    ids.add(room.id)
    roomMap.set(room.id, room)

    if (Math.abs(polygonSignedArea(room.boundaryPx)) <= EPSILON) {
      failures.push(prefix + ': Polygon 面积为 0')
    }

    if (!room.boundaryPx.every(pointWithinSource)) {
      failures.push(prefix + ': Polygon point 超出 source bounds')
    }

    for (let edgeIndex = 0; edgeIndex < room.boundaryPx.length; edgeIndex += 1) {
      const start = room.boundaryPx[edgeIndex]
      const end =
        room.boundaryPx[
          (edgeIndex + 1) % room.boundaryPx.length
        ]

      if (pixelDistance(start, end) <= EPSILON) {
        failures.push(prefix + ': Polygon 包含零长度边')
        break
      }
    }

    if (
      room.confidence !== undefined &&
      (!Number.isFinite(room.confidence) ||
        room.confidence < 0 ||
        room.confidence > 1)
    ) {
      failures.push(prefix + ': confidence 必须位于 0~1')
    }
  }

  if (!Array.isArray(draft.openings)) {
    failures.push(label + ': openings 必须为数组')
  }

  for (const [openingIndex, openingValue] of openings.entries()) {
    const opening = asRecord(openingValue)
    const prefix = label + '.openings[' + openingIndex + ']'

    if (
      !opening ||
      typeof opening.id !== 'string' ||
      !opening.id ||
      typeof opening.roomId !== 'string' ||
      !Number.isInteger(opening.edgeIndex) ||
      opening.edgeIndex < 0 ||
      !['door', 'window', 'opening'].includes(opening.kind) ||
      !Number.isFinite(opening.offsetPx) ||
      opening.offsetPx < 0 ||
      !Number.isFinite(opening.widthPx) ||
      opening.widthPx <= 0 ||
      !Number.isFinite(opening.heightMeters) ||
      opening.heightMeters <= 0 ||
      (opening.sillHeightMeters !== undefined &&
        (!Number.isFinite(opening.sillHeightMeters) ||
          opening.sillHeightMeters < 0)) ||
      (opening.swing !== undefined &&
        !openingSwings.has(opening.swing))
    ) {
      failures.push(prefix + ': Opening 格式无效')
      continue
    }

    if (ids.has(opening.id)) {
      failures.push(prefix + ': ID 重复 ' + opening.id)
    }
    ids.add(opening.id)

    const room = roomMap.get(opening.roomId)

    if (!room) {
      failures.push(prefix + ': roomId 不存在 ' + opening.roomId)
      continue
    }

    if (opening.edgeIndex >= room.boundaryPx.length) {
      failures.push(prefix + ': edgeIndex 越界')
      continue
    }

    const start = room.boundaryPx[opening.edgeIndex]
    const end =
      room.boundaryPx[
        (opening.edgeIndex + 1) % room.boundaryPx.length
      ]
    const length = pixelDistance(start, end)

    if (
      opening.offsetPx + opening.widthPx >
      length + EPSILON
    ) {
      failures.push(prefix + ': Opening 超出 Room Edge')
    }

    if (
      opening.sillHeightMeters !== undefined &&
      assumptions &&
      Number.isFinite(assumptions.ceilingHeightMeters) &&
      opening.sillHeightMeters + opening.heightMeters >
        assumptions.ceilingHeightMeters + EPSILON
    ) {
      failures.push(prefix + ': Opening 垂直尺寸超过 ceiling height')
    }

    if (
      opening.confidence !== undefined &&
      (!Number.isFinite(opening.confidence) ||
        opening.confidence < 0 ||
        opening.confidence > 1)
    ) {
      failures.push(prefix + ': confidence 必须位于 0~1')
    }
  }

  return {
    valid: failures.length === 0,
    failures,
  }
}

function pointInPolygon(point, polygon) {
  const [x, y] = point
  let inside = false

  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const [xi, yi] = polygon[current]
    const [xj, yj] = polygon[previous]

    const intersects =
      yi > y !== yj > y &&
      x <
        ((xj - xi) * (y - yi)) / (yj - yi + EPSILON) + xi

    if (intersects) inside = !inside
  }

  return inside
}

function polygonBounds(points) {
  return {
    minX: Math.min(...points.map((point) => point[0])),
    maxX: Math.max(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxY: Math.max(...points.map((point) => point[1])),
  }
}

function polygonRasterStats(a, b, gridSize) {
  const aBounds = polygonBounds(a)
  const bBounds = polygonBounds(b)
  const minX = Math.min(aBounds.minX, bBounds.minX)
  const maxX = Math.max(aBounds.maxX, bBounds.maxX)
  const minY = Math.min(aBounds.minY, bBounds.minY)
  const maxY = Math.max(aBounds.maxY, bBounds.maxY)

  if (
    maxX - minX <= EPSILON ||
    maxY - minY <= EPSILON
  ) {
    return {
      iou: 0,
      overlapRatio: 0,
    }
  }

  let countA = 0
  let countB = 0
  let intersection = 0
  let union = 0

  for (let yIndex = 0; yIndex < gridSize; yIndex += 1) {
    const y =
      minY + ((yIndex + 0.5) / gridSize) * (maxY - minY)

    for (let xIndex = 0; xIndex < gridSize; xIndex += 1) {
      const x =
        minX + ((xIndex + 0.5) / gridSize) * (maxX - minX)
      const inA = pointInPolygon([x, y], a)
      const inB = pointInPolygon([x, y], b)

      if (inA) countA += 1
      if (inB) countB += 1
      if (inA || inB) union += 1
      if (inA && inB) intersection += 1
    }
  }

  return {
    iou: union > 0 ? intersection / union : 0,
    overlapRatio:
      Math.min(countA, countB) > 0
        ? intersection / Math.min(countA, countB)
        : 0,
  }
}

function polygonIou(a, b, gridSize) {
  return polygonRasterStats(a, b, gridSize).iou
}

function maxRoomOverlapRatio(rooms, gridSize) {
  let maximum = 0

  for (let left = 0; left < rooms.length; left += 1) {
    for (let right = left + 1; right < rooms.length; right += 1) {
      maximum = Math.max(
        maximum,
        polygonRasterStats(
          rooms[left].boundaryPx,
          rooms[right].boundaryPx,
          gridSize,
        ).overlapRatio,
      )
    }
  }

  return maximum
}

function matchRooms(expected, candidate, threshold, gridSize) {
  const pairs = []

  for (const expectedRoom of expected.rooms) {
    for (const candidateRoom of candidate.rooms) {
      pairs.push({
        expectedRoom,
        candidateRoom,
        iou: polygonIou(
          expectedRoom.boundaryPx,
          candidateRoom.boundaryPx,
          gridSize,
        ),
      })
    }
  }

  pairs.sort(
    (a, b) =>
      b.iou - a.iou ||
      a.expectedRoom.id.localeCompare(b.expectedRoom.id) ||
      a.candidateRoom.id.localeCompare(b.candidateRoom.id),
  )

  const usedExpected = new Set()
  const usedCandidate = new Set()
  const matches = []

  for (const pair of pairs) {
    if (pair.iou < threshold) break
    if (
      usedExpected.has(pair.expectedRoom.id) ||
      usedCandidate.has(pair.candidateRoom.id)
    ) {
      continue
    }

    usedExpected.add(pair.expectedRoom.id)
    usedCandidate.add(pair.candidateRoom.id)
    matches.push(pair)
  }

  return matches
}

function openingCenter(draft, opening) {
  const room = draft.rooms.find(
    (candidate) => candidate.id === opening.roomId,
  )

  if (!room) return undefined

  const start = room.boundaryPx[opening.edgeIndex]
  const end =
    room.boundaryPx[
      (opening.edgeIndex + 1) % room.boundaryPx.length
    ]

  if (!start || !end) return undefined

  const edgeLength = pixelDistance(start, end)
  if (edgeLength <= EPSILON) return undefined

  const distance = opening.offsetPx + opening.widthPx / 2
  const t = distance / edgeLength

  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ]
}

function matchOpenings(
  expected,
  candidate,
  roomMatches,
  toleranceRatio,
) {
  const expectedToCandidateRoom = new Map(
    roomMatches.map((match) => [
      match.expectedRoom.id,
      match.candidateRoom.id,
    ]),
  )
  const diagonal = Math.hypot(
    expected.source.widthPx,
    expected.source.heightPx,
  )
  const candidates = []

  for (const expectedOpening of expected.openings) {
    const candidateRoomId = expectedToCandidateRoom.get(
      expectedOpening.roomId,
    )

    if (!candidateRoomId) continue

    const expectedCenter = openingCenter(expected, expectedOpening)
    if (!expectedCenter) continue

    for (const candidateOpening of candidate.openings) {
      if (
        candidateOpening.roomId !== candidateRoomId ||
        candidateOpening.kind !== expectedOpening.kind
      ) {
        continue
      }

      const candidateCenter = openingCenter(
        candidate,
        candidateOpening,
      )
      if (!candidateCenter) continue

      const centerErrorRatio =
        pixelDistance(expectedCenter, candidateCenter) /
        Math.max(diagonal, EPSILON)

      candidates.push({
        expectedOpening,
        candidateOpening,
        centerErrorRatio,
        widthErrorRatio:
          Math.abs(
            candidateOpening.widthPx - expectedOpening.widthPx,
          ) / Math.max(expectedOpening.widthPx, EPSILON),
      })
    }
  }

  candidates.sort(
    (a, b) =>
      a.centerErrorRatio - b.centerErrorRatio ||
      a.expectedOpening.id.localeCompare(b.expectedOpening.id) ||
      a.candidateOpening.id.localeCompare(b.candidateOpening.id),
  )

  const usedExpected = new Set()
  const usedCandidate = new Set()
  const matches = []

  for (const pair of candidates) {
    if (pair.centerErrorRatio > toleranceRatio) break

    if (
      usedExpected.has(pair.expectedOpening.id) ||
      usedCandidate.has(pair.candidateOpening.id)
    ) {
      continue
    }

    usedExpected.add(pair.expectedOpening.id)
    usedCandidate.add(pair.candidateOpening.id)
    matches.push(pair)
  }

  return matches
}

function calibrationPixelsPerMeter(draft) {
  return (
    pixelDistance(
      draft.calibration.startPx,
      draft.calibration.endPx,
    ) / draft.calibration.realDistanceMeters
  )
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 1
}

function mean(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) /
        values.length
    : 0
}

function evaluateCase(
  caseId,
  extractorId,
  expected,
  candidate,
  thresholds,
  gridSize,
) {
  const validation = validateDraft(
    candidate,
    caseId + '/' + extractorId,
  )

  if (!validation.valid) {
    return {
      gatePass: false,
      metrics: {
        draftValid: false,
        sourceKindMatch: false,
        sourceDimensionsMatch: false,
        roomPrecision: 0,
        roomRecall: 0,
        meanRoomIou: 0,
        roomTypeAccuracy: 0,
        maxCandidateRoomOverlapRatio: 1,
        openingPrecision: 0,
        openingRecall: 0,
        meanOpeningCenterErrorRatio: null,
        meanOpeningWidthErrorRatio: null,
        scaleErrorRatio: 1,
      },
      failures: validation.failures,
    }
  }

  const sourceKindMatch =
    candidate.source.kind === expected.source.kind
  const sourceDimensionsMatch =
    candidate.source.widthPx === expected.source.widthPx &&
    candidate.source.heightPx === expected.source.heightPx

  const roomMatches = matchRooms(
    expected,
    candidate,
    thresholds.roomMatchIou,
    gridSize,
  )

  const roomPrecision = safeRatio(
    roomMatches.length,
    candidate.rooms.length,
  )
  const roomRecall = safeRatio(
    roomMatches.length,
    expected.rooms.length,
  )
  const meanRoomIou = mean(roomMatches.map((match) => match.iou))

  const typedMatches = roomMatches.filter(
    (match) => match.expectedRoom.type !== undefined,
  )
  const roomTypeAccuracy = safeRatio(
    typedMatches.filter(
      (match) =>
        match.candidateRoom.type === match.expectedRoom.type,
    ).length,
    typedMatches.length,
  )

  const maxCandidateRoomOverlapRatio = maxRoomOverlapRatio(
    candidate.rooms,
    gridSize,
  )

  const openingMatches = matchOpenings(
    expected,
    candidate,
    roomMatches,
    thresholds.openingCenterToleranceRatio,
  )
  const openingPrecision = safeRatio(
    openingMatches.length,
    candidate.openings.length,
  )
  const openingRecall = safeRatio(
    openingMatches.length,
    expected.openings.length,
  )

  const expectedScale = calibrationPixelsPerMeter(expected)
  const candidateScale = calibrationPixelsPerMeter(candidate)
  const scaleErrorRatio =
    Math.abs(candidateScale - expectedScale) /
    Math.max(expectedScale, EPSILON)

  const metrics = {
    draftValid: true,
    sourceKindMatch,
    sourceDimensionsMatch,
    roomPrecision,
    roomRecall,
    meanRoomIou,
    roomTypeAccuracy,
    maxCandidateRoomOverlapRatio,
    openingPrecision,
    openingRecall,
    meanOpeningCenterErrorRatio:
      openingMatches.length > 0
        ? mean(
            openingMatches.map(
              (match) => match.centerErrorRatio,
            ),
          )
        : null,
    meanOpeningWidthErrorRatio:
      openingMatches.length > 0
        ? mean(
            openingMatches.map(
              (match) => match.widthErrorRatio,
            ),
          )
        : null,
    scaleErrorRatio,
  }

  const failures = []

  if (!sourceKindMatch) {
    failures.push('source_kind_mismatch')
  }
  if (!sourceDimensionsMatch) {
    failures.push('source_dimensions_mismatch')
  }
  if (roomPrecision < thresholds.roomPrecisionMin) {
    failures.push('room_precision_below_threshold')
  }
  if (roomRecall < thresholds.roomRecallMin) {
    failures.push('room_recall_below_threshold')
  }
  if (meanRoomIou < thresholds.meanRoomIouMin) {
    failures.push('room_iou_below_threshold')
  }
  if (roomTypeAccuracy < thresholds.roomTypeAccuracyMin) {
    failures.push('room_type_accuracy_below_threshold')
  }
  if (
    maxCandidateRoomOverlapRatio >
    thresholds.candidateRoomOverlapRatioMax
  ) {
    failures.push('candidate_room_overlap_ratio_above_threshold')
  }
  if (openingPrecision < thresholds.openingPrecisionMin) {
    failures.push('opening_precision_below_threshold')
  }
  if (openingRecall < thresholds.openingRecallMin) {
    failures.push('opening_recall_below_threshold')
  }
  if (
    metrics.meanOpeningWidthErrorRatio !== null &&
    metrics.meanOpeningWidthErrorRatio >
      thresholds.meanOpeningWidthErrorMax
  ) {
    failures.push('opening_width_error_above_threshold')
  }
  if (scaleErrorRatio > thresholds.scaleErrorMax) {
    failures.push('scale_error_above_threshold')
  }

  return {
    gatePass: failures.length === 0,
    metrics,
    failures,
  }
}

function validateGroundTruthCompleteness(draft, label) {
  const failures = []

  for (const room of draft.rooms) {
    if (room.type === undefined) {
      failures.push(label + ': Ground Truth Room 缺少 type：' + room.id)
    }
  }

  return failures
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function aggregate(results) {
  const groups = new Map()

  for (const result of results) {
    const current = groups.get(result.extractorId) ?? []
    current.push(result)
    groups.set(result.extractorId, current)
  }

  return [...groups.entries()]
    .map(([extractorId, cases]) => ({
      extractorId,
      caseCount: cases.length,
      gatePassCount: cases.filter((item) => item.gatePass).length,
      gatePassRate:
        cases.filter((item) => item.gatePass).length / cases.length,
      meanRoomIou: mean(
        cases.map((item) => item.metrics.meanRoomIou),
      ),
      meanRoomRecall: mean(
        cases.map((item) => item.metrics.roomRecall),
      ),
      meanOpeningRecall: mean(
        cases.map((item) => item.metrics.openingRecall),
      ),
      meanScaleErrorRatio: mean(
        cases.map((item) => item.metrics.scaleErrorRatio),
      ),
    }))
    .sort((a, b) => a.extractorId.localeCompare(b.extractorId))
}

function formatPercent(value) {
  return (value * 100).toFixed(1) + '%'
}

function printHumanSummary(report) {
  process.stderr.write(
    '\nFloor Plan Extractor Benchmark · ' +
      report.dataset +
      '\n',
  )

  for (const summary of report.extractors) {
    process.stderr.write(
      [
        summary.extractorId,
        'gate=' +
          summary.gatePassCount +
          '/' +
          summary.caseCount,
        'roomIoU=' + formatPercent(summary.meanRoomIou),
        'roomRecall=' + formatPercent(summary.meanRoomRecall),
        'openingRecall=' + formatPercent(summary.meanOpeningRecall),
        'scaleError=' +
          formatPercent(summary.meanScaleErrorRatio),
      ].join('  ') + '\n',
    )
  }

  process.stderr.write('\n')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifest = validateManifest(
    await readJson(args.manifestPath),
    args.manifestPath,
  )
  const results = []
  let expectationMismatch = false
  let gateFailure = false

  for (const benchmarkCase of manifest.cases) {
    // Source existence is part of dataset integrity even though this
    // benchmark consumes precomputed extractor outputs.
    await readFile(benchmarkCase.sourcePath)
    const expected = await readJson(benchmarkCase.groundTruthPath)
    const expectedValidation = validateDraft(
      expected,
      benchmarkCase.id + '/ground-truth',
    )

    if (!expectedValidation.valid) {
      throw new Error(
        'Ground Truth 无效：' +
          expectedValidation.failures.join('；'),
      )
    }

    const completenessFailures = validateGroundTruthCompleteness(
      expected,
      benchmarkCase.id + '/ground-truth',
    )

    if (completenessFailures.length > 0) {
      throw new Error(
        'Ground Truth 不完整：' +
          completenessFailures.join('；'),
      )
    }

    for (const candidateSpec of benchmarkCase.candidates) {
      const candidate = await readJson(candidateSpec.candidatePath)
      const evaluated = evaluateCase(
        benchmarkCase.id,
        candidateSpec.extractorId,
        expected,
        candidate,
        manifest.thresholds,
        manifest.gridSize,
      )
      const expectedGate = candidateSpec.expectedGate
      const expectationMatched =
        expectedGate === undefined
          ? undefined
          : evaluated.gatePass === (expectedGate === 'pass')

      if (expectationMatched === false) {
        expectationMismatch = true
      }
      if (!evaluated.gatePass) gateFailure = true

      results.push({
        caseId: benchmarkCase.id,
        extractorId: candidateSpec.extractorId,
        ...(expectedGate ? { expectedGate } : {}),
        gatePass: evaluated.gatePass,
        ...(expectationMatched !== undefined
          ? { expectationMatched }
          : {}),
        metrics: evaluated.metrics,
        failures: evaluated.failures,
      })
    }
  }

  const report = {
    schemaVersion: '0.1.0',
    dataset: manifest.dataset,
    generatedAt: new Date().toISOString(),
    thresholds: manifest.thresholds,
    caseCount: manifest.cases.length,
    resultCount: results.length,
    expectationMismatch,
    results,
    extractors: aggregate(results),
  }

  const output = JSON.stringify(report, null, 2) + '\n'

  if (args.reportPath) {
    await mkdir(dirname(args.reportPath), { recursive: true })
    await writeFile(args.reportPath, output, 'utf8')
  }

  process.stdout.write(output)
  printHumanSummary(report)

  if (
    expectationMismatch ||
    (args.requirePass && gateFailure)
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

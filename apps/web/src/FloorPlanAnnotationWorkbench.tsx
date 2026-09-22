import type { FloorPlanReviewBurdenRecord } from '@homescape/floorplan-extractor'
import {
  isFloorPlanDraft,
  type FloorPlanDraft,
  type FloorPlanDraftOpening,
  type FloorPlanDraftRoom,
  type PixelPoint,
  type RoomType,
} from '@homescape/spatial-model'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

const roomTypeOptions: Array<{ value: RoomType; label: string }> = [
  { value: 'living', label: '客厅' },
  { value: 'dining', label: '餐厅' },
  { value: 'kitchen', label: '厨房' },
  { value: 'bedroom', label: '卧室' },
  { value: 'bathroom', label: '卫生间' },
  { value: 'study', label: '书房' },
  { value: 'balcony', label: '阳台' },
  { value: 'hallway', label: '走廊' },
  { value: 'utility', label: '家政/设备间' },
  { value: 'other', label: '其他' },
]

type DragTarget =
  | {
      type: 'room_vertex'
      roomId: string
      pointIndex: number
    }
  | {
      type: 'calibration'
      endpoint: 'start' | 'end'
    }

type EditCounts = FloorPlanReviewBurdenRecord['editCounts']

interface SourceImage {
  url: string
  widthPx: number
  heightPx: number
  objectUrl: boolean
}

const initialEditCounts: EditCounts = {
  roomVertexMoves: 0,
  roomMetadataEdits: 0,
  openingGeometryEdits: 0,
  calibrationEdits: 0,
  assumptionEdits: 0,
  resets: 0,
}

function cloneDraft(draft: FloorPlanDraft): FloorPlanDraft {
  return structuredClone(draft)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function pointDistance(a: PixelPoint, b: PixelPoint) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function polygonSignedArea(points: readonly PixelPoint[]) {
  let sum = 0

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]

    if (!current || !next) continue

    sum += current[0] * next[1] - next[0] * current[1]
  }

  return sum / 2
}

function polygonCenter(points: readonly PixelPoint[]): PixelPoint {
  if (points.length === 0) return [0, 0]

  const sum = points.reduce(
    (current, point) => [
      current[0] + point[0],
      current[1] + point[1],
    ] as PixelPoint,
    [0, 0] as PixelPoint,
  )

  return [sum[0] / points.length, sum[1] / points.length]
}

function cross(a: PixelPoint, b: PixelPoint, c: PixelPoint) {
  return (
    (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0])
  )
}

function onSegment(a: PixelPoint, b: PixelPoint, point: PixelPoint) {
  const epsilon = 1e-6

  return (
    Math.abs(cross(a, b, point)) <= epsilon &&
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  )
}

function segmentsIntersect(
  aStart: PixelPoint,
  aEnd: PixelPoint,
  bStart: PixelPoint,
  bEnd: PixelPoint,
) {
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

function polygonHasSelfIntersection(points: readonly PixelPoint[]) {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length
    const aStart = points[left]
    const aEnd = points[leftNext]

    if (!aStart || !aEnd) continue

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

      if (
        bStart &&
        bEnd &&
        segmentsIntersect(aStart, aEnd, bStart, bEnd)
      ) {
        return true
      }
    }
  }

  return false
}

function getDraftIssues(draft: FloorPlanDraft) {
  const issues: string[] = []

  if (!isFloorPlanDraft(draft)) {
    issues.push('Draft 未通过 FloorPlanDraft v0.1 Contract')
    return issues
  }

  if (
    draft.source.widthPx <= 0 ||
    draft.source.heightPx <= 0
  ) {
    issues.push('Source 尺寸必须为正数')
  }

  const calibrationPoints = [
    draft.calibration.startPx,
    draft.calibration.endPx,
  ]

  if (
    calibrationPoints.some(
      (point) =>
        point[0] < 0 ||
        point[0] > draft.source.widthPx ||
        point[1] < 0 ||
        point[1] > draft.source.heightPx,
    )
  ) {
    issues.push('标尺端点超出 Source')
  }

  if (
    pointDistance(
      draft.calibration.startPx,
      draft.calibration.endPx,
    ) <= 1
  ) {
    issues.push('标尺两端距离过短')
  }

  if (draft.calibration.realDistanceMeters <= 0) {
    issues.push('标尺真实距离必须大于 0')
  }

  if (draft.assumptions.wallThicknessMeters <= 0) {
    issues.push('墙厚必须大于 0')
  }

  if (draft.assumptions.ceilingHeightMeters <= 0) {
    issues.push('层高必须大于 0')
  }

  if (!draft.assumptions.wallThicknessConfirmed) {
    issues.push('墙厚尚未人工确认')
  }

  if (!draft.assumptions.ceilingHeightConfirmed) {
    issues.push('层高尚未人工确认')
  }

  const entityIds = new Set<string>()
  const roomById = new Map(
    draft.rooms.map((room) => [room.id, room]),
  )

  for (const room of draft.rooms) {
    if (entityIds.has(room.id)) {
      issues.push('实体 ID 重复：' + room.id)
    }
    entityIds.add(room.id)
    if (!room.type) {
      issues.push(room.name + ' 缺少 Room Type')
    }

    if (room.boundaryPx.length < 3) {
      issues.push(room.name + ' 边界点不足 3 个')
      continue
    }

    if (
      room.boundaryPx.some(
        (point) =>
          point[0] < 0 ||
          point[0] > draft.source.widthPx ||
          point[1] < 0 ||
          point[1] > draft.source.heightPx,
      )
    ) {
      issues.push(room.name + ' 边界超出 Source')
    }

    if (Math.abs(polygonSignedArea(room.boundaryPx)) <= 1) {
      issues.push(room.name + ' Polygon 面积过小')
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

      if (start && end && pointDistance(start, end) <= 1) {
        issues.push(room.name + ' Polygon 包含零长度边')
        break
      }
    }

    if (polygonHasSelfIntersection(room.boundaryPx)) {
      issues.push(room.name + ' Polygon 存在自相交')
    }
  }

  for (const opening of draft.openings) {
    if (entityIds.has(opening.id)) {
      issues.push('实体 ID 重复：' + opening.id)
    }
    entityIds.add(opening.id)
    const room = roomById.get(opening.roomId)

    if (!room) {
      issues.push(opening.id + ' 找不到所属 Room')
      continue
    }

    if (
      !Number.isInteger(opening.edgeIndex) ||
      opening.edgeIndex < 0
    ) {
      issues.push(opening.id + ' edgeIndex 无效')
      continue
    }

    if (opening.offsetPx < 0) {
      issues.push(opening.id + ' offsetPx 不能小于 0')
    }

    if (opening.widthPx <= 0) {
      issues.push(opening.id + ' widthPx 必须大于 0')
    }

    if (opening.heightMeters <= 0) {
      issues.push(opening.id + ' heightMeters 必须大于 0')
    }

    if (
      opening.sillHeightMeters !== undefined &&
      opening.sillHeightMeters < 0
    ) {
      issues.push(opening.id + ' sillHeightMeters 不能小于 0')
    }

    const start = room.boundaryPx[opening.edgeIndex]
    const end =
      room.boundaryPx[
        (opening.edgeIndex + 1) % room.boundaryPx.length
      ]

    if (!start || !end) {
      issues.push(opening.id + ' edgeIndex 越界')
      continue
    }

    if (
      opening.offsetPx + opening.widthPx >
      pointDistance(start, end) + 0.5
    ) {
      issues.push(opening.id + ' 超出所属 Room Edge')
    }

    if (
      (opening.sillHeightMeters ?? 0) +
        opening.heightMeters >
      draft.assumptions.ceilingHeightMeters + 0.001
    ) {
      issues.push(opening.id + ' 垂直尺寸超过层高')
    }
  }

  return issues
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function safeFilename(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'floorplan'
}

function openingSegment(
  room: FloorPlanDraftRoom,
  opening: FloorPlanDraftOpening,
) {
  const start = room.boundaryPx[opening.edgeIndex]
  const end =
    room.boundaryPx[
      (opening.edgeIndex + 1) % room.boundaryPx.length
    ]

  if (!start || !end) return null

  const length = pointDistance(start, end)
  if (length <= 1e-6) return null

  const dx = (end[0] - start[0]) / length
  const dy = (end[1] - start[1]) / length

  return {
    start: [
      start[0] + dx * opening.offsetPx,
      start[1] + dy * opening.offsetPx,
    ] as PixelPoint,
    end: [
      start[0] + dx * (opening.offsetPx + opening.widthPx),
      start[1] + dy * (opening.offsetPx + opening.widthPx),
    ] as PixelPoint,
  }
}

export interface FloorPlanAnnotationWorkbenchProps {
  draft: FloorPlanDraft
  resetKey: number
  disabled?: boolean
  onApply: (draft: FloorPlanDraft) => Promise<void> | void
}

export function FloorPlanAnnotationWorkbench({
  draft,
  resetKey,
  disabled = false,
  onApply,
}: FloorPlanAnnotationWorkbenchProps) {
  const [workingDraft, setWorkingDraft] = useState(() =>
    cloneDraft(draft),
  )
  const [sourceImage, setSourceImage] =
    useState<SourceImage | null>(null)
  const [overlayOpacity, setOverlayOpacity] = useState(0.62)
  const [selectedRoomId, setSelectedRoomId] = useState(
    draft.rooms[0]?.id ?? '',
  )
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(
    null,
  )
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [editCounts, setEditCounts] =
    useState<EditCounts>(initialEditCounts)
  const [touchedRoomIds, setTouchedRoomIds] = useState<Set<string>>(
    () => new Set<string>(),
  )
  const [annotationError, setAnnotationError] = useState<
    string | null
  >(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const sourceLoadSequenceRef = useRef(0)

  useEffect(() => {
    setWorkingDraft(cloneDraft(draft))
    setSelectedRoomId(draft.rooms[0]?.id ?? '')
    setStartedAt(null)
    setEditCounts(initialEditCounts)
    setTouchedRoomIds(new Set<string>())
    sourceLoadSequenceRef.current += 1
    setSourceImage(null)
    setAnnotationError(null)
  }, [resetKey])

  useEffect(() => {
    return () => {
      if (sourceImage?.objectUrl) {
        URL.revokeObjectURL(sourceImage.url)
      }
    }
  }, [sourceImage])

  const recordEdit = (
    kind: keyof EditCounts,
    roomId?: string,
  ) => {
    setStartedAt((current) => current ?? Date.now())
    setEditCounts((current) => ({
      ...current,
      [kind]: current[kind] + 1,
    }))

    if (roomId) {
      setTouchedRoomIds((current) => {
        const next = new Set(current)
        next.add(roomId)
        return next
      })
    }
  }

  const updateRoom = (
    roomId: string,
    updater: (room: FloorPlanDraftRoom) => FloorPlanDraftRoom,
  ) => {
    setWorkingDraft((current) => ({
      ...current,
      rooms: current.rooms.map((room) =>
        room.id === roomId ? updater(room) : room,
      ),
    }))
  }

  const updateOpening = (
    openingId: string,
    updater: (
      opening: FloorPlanDraftOpening,
    ) => FloorPlanDraftOpening,
  ) => {
    setWorkingDraft((current) => ({
      ...current,
      openings: current.openings.map((opening) =>
        opening.id === openingId ? updater(opening) : opening,
      ),
    }))
  }

  const selectedRoom =
    workingDraft.rooms.find((room) => room.id === selectedRoomId) ??
    null

  const selectedOpenings = useMemo(
    () =>
      workingDraft.openings.filter(
        (opening) => opening.roomId === selectedRoomId,
      ),
    [selectedRoomId, workingDraft.openings],
  )

  const issues = useMemo(
    () => getDraftIssues(workingDraft),
    [workingDraft],
  )

  const aspectRatioCompatible = useMemo(() => {
    if (!sourceImage) return true

    const sourceRatio = sourceImage.widthPx / sourceImage.heightPx
    const draftRatio =
      workingDraft.source.widthPx / workingDraft.source.heightPx

    return Math.abs(sourceRatio - draftRatio) / draftRatio < 0.005
  }, [sourceImage, workingDraft.source])

  const groundTruthIssues = useMemo(
    () => [
      ...issues,
      ...(workingDraft.source.kind === 'floorplan_image' &&
      !sourceImage
        ? ['图片户型 Ground Truth 导出前必须加载对应原图']
        : []),
      ...(workingDraft.source.kind === 'floorplan_pdf'
        ? ['PR #13 暂不支持 PDF 原图视觉复核']
        : []),
      ...(sourceImage && !aspectRatioCompatible
        ? ['原图与 Draft 宽高比不一致']
        : []),
    ],
    [
      aspectRatioCompatible,
      issues,
      sourceImage,
      workingDraft.source.kind,
    ],
  )

  const setDemoSource = () => {
    sourceLoadSequenceRef.current += 1

    if (sourceImage?.objectUrl) {
      URL.revokeObjectURL(sourceImage.url)
    }

    setStartedAt((current) => current ?? Date.now())
    setSourceImage({
      url: '/floorplan-demo.svg',
      widthPx: 1080,
      heightPx: 840,
      objectUrl: false,
    })
  }

  const uploadSource = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    sourceLoadSequenceRef.current += 1
    const loadSequence = sourceLoadSequenceRef.current

    if (file.size > 15 * 1024 * 1024) {
      setAnnotationError('户型原图不能超过 15MB')
      return
    }

    if (!file.type.startsWith('image/')) {
      setAnnotationError('PR #13 Overlay 当前只支持图片，PDF 后续单独接入')
      return
    }

    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      if (sourceLoadSequenceRef.current !== loadSequence) {
        URL.revokeObjectURL(url)
        return
      }
      setStartedAt((current) => current ?? Date.now())
      setSourceImage((current) => {
        if (current?.objectUrl) {
          URL.revokeObjectURL(current.url)
        }

        return {
          url,
          widthPx: image.naturalWidth,
          heightPx: image.naturalHeight,
          objectUrl: true,
        }
      })
      setAnnotationError(null)
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)

      if (sourceLoadSequenceRef.current === loadSequence) {
        setAnnotationError('无法读取户型原图')
      }
    }

    image.src = url
  }

  const clearSource = () => {
    sourceLoadSequenceRef.current += 1
    setSourceImage(null)
    setAnnotationError(null)
  }

  const pointFromPointer = (
    event: ReactPointerEvent<SVGSVGElement>,
  ): PixelPoint | null => {
    const svg = svgRef.current
    if (!svg) return null

    const ctm = svg.getScreenCTM()
    if (!ctm) return null

    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(ctm.inverse())

    return [
      clamp(local.x, 0, workingDraft.source.widthPx),
      clamp(local.y, 0, workingDraft.source.heightPx),
    ]
  }

  const startRoomDrag = (
    roomId: string,
    pointIndex: number,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedRoomId(roomId)
    setDragTarget({
      type: 'room_vertex',
      roomId,
      pointIndex,
    })
    recordEdit('roomVertexMoves', roomId)
  }

  const startCalibrationDrag = (
    endpoint: 'start' | 'end',
    event: ReactPointerEvent<SVGCircleElement>,
  ) => {
    if (disabled) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragTarget({ type: 'calibration', endpoint })
    recordEdit('calibrationEdits')
  }

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragTarget || disabled) return

    const point = pointFromPointer(event)
    if (!point) return

    if (dragTarget.type === 'room_vertex') {
      updateRoom(dragTarget.roomId, (room) => ({
        ...room,
        boundaryPx: room.boundaryPx.map((currentPoint, index) =>
          index === dragTarget.pointIndex ? point : currentPoint,
        ),
      }))
      return
    }

    setWorkingDraft((current) => ({
      ...current,
      calibration: {
        ...current.calibration,
        [dragTarget.endpoint === 'start' ? 'startPx' : 'endPx']:
          point,
      },
    }))
  }

  const stopDrag = () => {
    setDragTarget(null)
  }

  const resetAnnotation = () => {
    setWorkingDraft(cloneDraft(draft))
    setSelectedRoomId(draft.rooms[0]?.id ?? '')
    recordEdit('resets')
    setAnnotationError(null)
  }

  const applyAnnotation = async () => {
    if (groundTruthIssues.length > 0) {
      setAnnotationError(
        '当前 Draft 仍有 ' +
          groundTruthIssues.length +
          ' 个 Ground Truth 问题',
      )
      return
    }

    try {
      await onApply(cloneDraft(workingDraft))
      setAnnotationError(null)
    } catch (error) {
      setAnnotationError(
        error instanceof Error ? error.message : '应用校正失败',
      )
    }
  }

  const buildGroundTruth = () => ({
    ...cloneDraft(workingDraft),
    rooms: workingDraft.rooms.map((room) => ({
      ...room,
      confidence: 1,
    })),
    openings: workingDraft.openings.map((opening) => ({
      ...opening,
      confidence: 1,
    })),
  })

  const buildBurdenRecord = (): FloorPlanReviewBurdenRecord => {
    const now = Date.now()
    const effectiveStart = startedAt ?? now
    const counts = editCounts

    return {
      schemaVersion: '0.1.0',
      sourceLabel: workingDraft.source.sourceLabel,
      sourceKind: workingDraft.source.kind,
      startedAt: new Date(effectiveStart).toISOString(),
      completedAt: new Date(now).toISOString(),
      durationMs: Math.max(0, now - effectiveStart),
      totalEdits:
        counts.roomVertexMoves +
        counts.roomMetadataEdits +
        counts.openingGeometryEdits +
        counts.calibrationEdits +
        counts.assumptionEdits +
        counts.resets,
      editCounts: counts,
      touchedRoomIds: [...touchedRoomIds].sort(),
      roomCount: workingDraft.rooms.length,
      openingCount: workingDraft.openings.length,
      ...(sourceImage
        ? {
            sourceImage: {
              widthPx: sourceImage.widthPx,
              heightPx: sourceImage.heightPx,
              aspectRatioCompatible,
            },
          }
        : {}),
    }
  }

  const exportGroundTruth = () => {
    if (groundTruthIssues.length > 0) {
      setAnnotationError(
        'Ground Truth 导出前仍需解决：' + groundTruthIssues[0],
      )
      return
    }

    const base = safeFilename(workingDraft.source.sourceLabel)
    downloadJson(base + '.ground-truth.json', buildGroundTruth())
    setAnnotationError(null)
  }

  const exportReviewBurden = () => {
    if (groundTruthIssues.length > 0) {
      setAnnotationError(
        'Review Burden 导出前仍需解决：' + groundTruthIssues[0],
      )
      return
    }

    const base = safeFilename(workingDraft.source.sourceLabel)
    downloadJson(base + '.review-burden.json', buildBurdenRecord())
    setAnnotationError(null)
  }

  const viewBox =
    '0 0 ' +
    workingDraft.source.widthPx +
    ' ' +
    workingDraft.source.heightPx

  return (
    <div className="floorplan-annotation">
      <div className="floorplan-annotation-head">
        <div>
          <strong>Ground Truth Annotation</strong>
          <span>
            原图 Overlay + Polygon / Opening / Calibration 人工校正
          </span>
        </div>
        <div className="floorplan-annotation-actions">
          <button type="button" disabled={disabled} onClick={setDemoSource}>
            加载示例原图
          </button>
          <label className="floorplan-file-button">
            上传户型图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              disabled={disabled}
              onChange={uploadSource}
            />
          </label>
          {sourceImage ? (
            <button type="button" disabled={disabled} onClick={clearSource}>
              清除原图
            </button>
          ) : null}
          <button type="button" disabled={disabled} onClick={resetAnnotation}>
            重置校正
          </button>
        </div>
      </div>

      <div className="floorplan-annotation-layout">
        <div className="floorplan-annotation-canvas-shell">
          <div className="floorplan-overlay-toolbar">
            <span>
              Draft {workingDraft.source.widthPx} ×{' '}
              {workingDraft.source.heightPx}
            </span>
            {sourceImage ? (
              <span
                className={
                  aspectRatioCompatible ? 'metric-ok' : 'metric-error'
                }
              >
                Source {sourceImage.widthPx} × {sourceImage.heightPx}
              </span>
            ) : (
              <span>Source 未加载</span>
            )}
            <label>
              Overlay
              <input
                type="range"
                min="0.15"
                max="1"
                step="0.05"
                value={overlayOpacity}
                onChange={(event) =>
                  setOverlayOpacity(Number(event.target.value))
                }
              />
            </label>
          </div>

          <svg
            ref={svgRef}
            className="floorplan-annotation-canvas"
            viewBox={viewBox}
            onPointerMove={moveDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onPointerLeave={stopDrag}
            role="img"
            aria-label="户型 Ground Truth 几何校正画布"
          >
            {sourceImage && aspectRatioCompatible ? (
              <image
                href={sourceImage.url}
                x="0"
                y="0"
                width={workingDraft.source.widthPx}
                height={workingDraft.source.heightPx}
                opacity={overlayOpacity}
                preserveAspectRatio="none"
              />
            ) : null}

            {workingDraft.rooms.map((room) => {
              const selected = room.id === selectedRoomId
              const center = polygonCenter(room.boundaryPx)
              const points = room.boundaryPx
                .map((point) => point.join(','))
                .join(' ')

              return (
                <g key={room.id}>
                  <polygon
                    className={
                      selected
                        ? 'floorplan-annotation-room selected'
                        : 'floorplan-annotation-room'
                    }
                    points={points}
                    onPointerDown={() => setSelectedRoomId(room.id)}
                  />
                  <text
                    className="floorplan-annotation-label"
                    x={center[0]}
                    y={center[1]}
                  >
                    {room.name}
                  </text>
                  {room.boundaryPx.map((point, pointIndex) => (
                    <circle
                      key={room.id + '-' + pointIndex}
                      className={
                        selected
                          ? 'floorplan-vertex selected'
                          : 'floorplan-vertex'
                      }
                      cx={point[0]}
                      cy={point[1]}
                      r={selected ? 8 : 5}
                      onPointerDown={(event) =>
                        startRoomDrag(room.id, pointIndex, event)
                      }
                    />
                  ))}
                </g>
              )
            })}

            {workingDraft.openings.map((opening) => {
              const room = workingDraft.rooms.find(
                (candidate) => candidate.id === opening.roomId,
              )
              if (!room) return null

              const segment = openingSegment(room, opening)
              if (!segment) return null

              return (
                <line
                  key={opening.id}
                  className={
                    'floorplan-annotation-opening ' +
                    'opening-' +
                    opening.kind
                  }
                  x1={segment.start[0]}
                  y1={segment.start[1]}
                  x2={segment.end[0]}
                  y2={segment.end[1]}
                />
              )
            })}

            <line
              className="floorplan-calibration-line"
              x1={workingDraft.calibration.startPx[0]}
              y1={workingDraft.calibration.startPx[1]}
              x2={workingDraft.calibration.endPx[0]}
              y2={workingDraft.calibration.endPx[1]}
            />
            <circle
              className="floorplan-calibration-handle"
              cx={workingDraft.calibration.startPx[0]}
              cy={workingDraft.calibration.startPx[1]}
              r="9"
              onPointerDown={(event) =>
                startCalibrationDrag('start', event)
              }
            />
            <circle
              className="floorplan-calibration-handle"
              cx={workingDraft.calibration.endPx[0]}
              cy={workingDraft.calibration.endPx[1]}
              r="9"
              onPointerDown={(event) =>
                startCalibrationDrag('end', event)
              }
            />
          </svg>

          {!aspectRatioCompatible ? (
            <div className="floorplan-annotation-warning">
              原图与 Draft 宽高比不一致，Overlay 已暂停。请确认上传的是同一张源图。
            </div>
          ) : null}
        </div>

        <aside className="floorplan-annotation-panel">
          <label>
            当前房间
            <select
              value={selectedRoomId}
              disabled={disabled}
              onChange={(event) => setSelectedRoomId(event.target.value)}
            >
              {workingDraft.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>

          {selectedRoom ? (
            <>
              <label>
                房间名称
                <input
                  value={selectedRoom.name}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.target.value
                    updateRoom(selectedRoom.id, (room) => ({
                      ...room,
                      name: value,
                    }))
                  }}
                  onBlur={() =>
                    recordEdit(
                      'roomMetadataEdits',
                      selectedRoom.id,
                    )
                  }
                />
              </label>
              <label>
                Room Type
                <select
                  value={selectedRoom.type ?? ''}
                  disabled={disabled}
                  onChange={(event) => {
                    const value = event.target.value
                    updateRoom(selectedRoom.id, (room) => {
                      if (value) {
                        return {
                          ...room,
                          type: value as RoomType,
                        }
                      }

                      const { type: _type, ...withoutType } = room
                      return withoutType
                    })
                    recordEdit('roomMetadataEdits', selectedRoom.id)
                  }}
                >
                  <option value="">待确认</option>
                  {roomTypeOptions.map((option) => (
                    <option
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="floorplan-opening-editor">
                <strong>Openings · {selectedOpenings.length}</strong>
                {selectedOpenings.length === 0 ? (
                  <span>当前房间没有 Opening</span>
                ) : (
                  selectedOpenings.map((opening) => (
                    <div
                      className="floorplan-opening-row"
                      key={opening.id}
                    >
                      <code>{opening.id}</code>
                      <label>
                        Kind
                        <select
                          value={opening.kind}
                          disabled={disabled}
                          onChange={(event) => {
                            const kind = event.target
                              .value as FloorPlanDraftOpening['kind']
                            updateOpening(opening.id, (current) => ({
                              ...current,
                              kind,
                            }))
                            recordEdit(
                              'openingGeometryEdits',
                              selectedRoom.id,
                            )
                          }}
                        >
                          <option value="door">door</option>
                          <option value="window">window</option>
                          <option value="opening">opening</option>
                        </select>
                      </label>
                      <label>
                        Offset px
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={opening.offsetPx}
                          disabled={disabled}
                          onChange={(event) => {
                            const value = Number(event.target.value)
                            updateOpening(opening.id, (current) => ({
                              ...current,
                              offsetPx: value,
                            }))
                          }}
                          onBlur={() =>
                            recordEdit(
                              'openingGeometryEdits',
                              selectedRoom.id,
                            )
                          }
                        />
                      </label>
                      <label>
                        Width px
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={opening.widthPx}
                          disabled={disabled}
                          onChange={(event) => {
                            const value = Number(event.target.value)
                            updateOpening(opening.id, (current) => ({
                              ...current,
                              widthPx: value,
                            }))
                          }}
                          onBlur={() =>
                            recordEdit(
                              'openingGeometryEdits',
                              selectedRoom.id,
                            )
                          }
                        />
                      </label>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}

          <div className="floorplan-annotation-group">
            <strong>Calibration</strong>
            <label>
              Real Distance m
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={workingDraft.calibration.realDistanceMeters}
                disabled={disabled}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setWorkingDraft((current) => ({
                    ...current,
                    calibration: {
                      ...current.calibration,
                      realDistanceMeters: value,
                    },
                  }))
                }}
                onBlur={() => recordEdit('calibrationEdits')}
              />
            </label>
          </div>

          <div className="floorplan-annotation-group">
            <strong>Assumptions</strong>
            <label>
              Wall Thickness m
              <input
                type="number"
                min="0.05"
                step="0.01"
                value={workingDraft.assumptions.wallThicknessMeters}
                disabled={disabled}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setWorkingDraft((current) => ({
                    ...current,
                    assumptions: {
                      ...current.assumptions,
                      wallThicknessMeters: value,
                    },
                  }))
                }}
                onBlur={() => recordEdit('assumptionEdits')}
              />
            </label>
            <label className="floorplan-check">
              <input
                type="checkbox"
                checked={
                  workingDraft.assumptions.wallThicknessConfirmed
                }
                disabled={disabled}
                onChange={(event) => {
                  const checked = event.target.checked
                  setWorkingDraft((current) => ({
                    ...current,
                    assumptions: {
                      ...current.assumptions,
                      wallThicknessConfirmed: checked,
                    },
                  }))
                  recordEdit('assumptionEdits')
                }}
              />
              墙厚已人工确认
            </label>
            <label>
              Ceiling Height m
              <input
                type="number"
                min="1.8"
                step="0.01"
                value={workingDraft.assumptions.ceilingHeightMeters}
                disabled={disabled}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setWorkingDraft((current) => ({
                    ...current,
                    assumptions: {
                      ...current.assumptions,
                      ceilingHeightMeters: value,
                    },
                  }))
                }}
                onBlur={() => recordEdit('assumptionEdits')}
              />
            </label>
            <label className="floorplan-check">
              <input
                type="checkbox"
                checked={
                  workingDraft.assumptions.ceilingHeightConfirmed
                }
                disabled={disabled}
                onChange={(event) => {
                  const checked = event.target.checked
                  setWorkingDraft((current) => ({
                    ...current,
                    assumptions: {
                      ...current.assumptions,
                      ceilingHeightConfirmed: checked,
                    },
                  }))
                  recordEdit('assumptionEdits')
                }}
              />
              层高已人工确认
            </label>
          </div>

          <div
            className={
              groundTruthIssues.length === 0
                ? 'floorplan-annotation-gate gate-ready'
                : 'floorplan-annotation-gate'
            }
          >
            <strong>
              Ground Truth Gate ·{' '}
              {groundTruthIssues.length === 0
                ? 'READY'
                : groundTruthIssues.length}
            </strong>
            {groundTruthIssues.slice(0, 4).map((issue) => (
              <span key={issue}>{issue}</span>
            ))}
            {groundTruthIssues.length > 4 ? (
              <span>
                还有 {groundTruthIssues.length - 4} 个问题…
              </span>
            ) : null}
          </div>

          <div className="floorplan-annotation-footer">
            <button
              type="button"
              disabled={disabled || groundTruthIssues.length > 0}
              onClick={() => void applyAnnotation()}
            >
              应用校正到 Candidate
            </button>
            <button
              type="button"
              disabled={disabled || groundTruthIssues.length > 0}
              onClick={exportGroundTruth}
            >
              导出 Ground Truth
            </button>
            <button
              type="button"
              disabled={disabled || groundTruthIssues.length > 0}
              onClick={exportReviewBurden}
            >
              导出 Review Burden
            </button>
          </div>

          {annotationError ? (
            <div className="floorplan-import-error">
              {annotationError}
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

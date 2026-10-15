import type { FloorPlanReviewBurdenRecord } from '@homescape/floorplan-extractor'
import {
  getFloorPlanCalibrationAxisError,
  isFloorPlanDraft,
  type FloorPlanDraft,
  type FloorPlanDraftOpening,
  type FloorPlanDraftRoom,
  type PixelPoint,
  type RoomType,
} from '@homescape/spatial-model'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  createTrailingThrottle,
  deleteAnnotationDraft,
  loadAnnotationDrafts,
  saveAnnotationDraft,
  type StoredAnnotationDraft,
} from './floorplan-annotation-draft-store'
import { clickNearStart, clampViewport, createVerticalCalibration, fitOpeningsToRoomEdges, fullViewport, getGroundTruthCalibrationBasisIssues, OPENING_EDGE_TOLERANCE_PX, moveCalibrationEndpoint, removeVerticalCalibration, setCalibrationDistance, type CalibrationAxisKey, insertPolygonVertex, nearestEdgeProjection, nextEntityId, orthogonalEdge, orthogonalPoint, planOpeningFromClicks, projectPointToEdge, removePolygonVertex, screenToSource, viewportScreenScale, zoomViewport, type AnnotationViewport } from './floorplan-annotation-geometry'
import { lockAnnotationBackgroundScroll } from './floorplan-annotation-scroll-lock'

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
      axis: CalibrationAxisKey
      endpoint: 'start' | 'end'
    }

type EditCounts = FloorPlanReviewBurdenRecord['editCounts']

interface SourceImage {
  url: string
  widthPx: number
  heightPx: number
  objectUrl: boolean
  /** The uploaded file, kept so the draft autosave can persist it. */
  blob?: Blob
}

/** On-screen sizes (CSS px) of interactive handles; converted to source px by the current zoom. */
const HANDLE_PX = {
  vertex: 5,
  vertexSelected: 7,
  vertexHit: 11,
  vertexSelectedHit: 15,
  calibration: 8,
  calibrationHit: 16,
  drawingPoint: 4,
  drawingFirstPoint: 6,
  snapDot: 5,
  labelFont: 13,
  labelStroke: 4,
  openingSnapDistance: 24,
} as const

const AUTOSAVE_INTERVAL_MS = 1000

const initialEditCounts: EditCounts = {
  roomVertexMoves: 0,
  roomMetadataEdits: 0,
  openingGeometryEdits: 0,
  calibrationEdits: 0,
  assumptionEdits: 0,
  resets: 0,
  roomStructureEdits: 0,
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
  const rawDraft: FloorPlanDraft = draft

  if (!isFloorPlanDraft(draft)) {
    issues.push('Draft 未通过 FloorPlanDraft v0.1 Contract')
    // 标尺方向不合法同样会导致 Contract 失败，单独给出可操作的原因。
    if (rawDraft.calibrationY) {
      for (const axisError of [
        getFloorPlanCalibrationAxisError(rawDraft.calibration, 'x'),
        getFloorPlanCalibrationAxisError(rawDraft.calibrationY, 'y'),
      ]) {
        if (axisError) issues.push(axisError)
      }
    }
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
    ...(draft.calibrationY
      ? [draft.calibrationY.startPx, draft.calibrationY.endPx]
      : []),
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

  if (draft.calibrationY) {
    if (
      pointDistance(draft.calibrationY.startPx, draft.calibrationY.endPx) <= 1
    ) {
      issues.push('纵向标尺两端距离过短')
    }

    if (draft.calibrationY.realDistanceMeters <= 0) {
      issues.push('纵向标尺真实距离必须大于 0')
    }

    for (const axisError of [
      getFloorPlanCalibrationAxisError(draft.calibration, 'x'),
      getFloorPlanCalibrationAxisError(draft.calibrationY, 'y'),
    ]) {
      if (axisError) issues.push(axisError)
    }
  }

  if (draft.assumptions.wallThicknessMeters <= 0) {
    issues.push('墙厚必须大于 0')
  }

  if (draft.assumptions.ceilingHeightMeters <= 0) {
    issues.push('层高必须大于 0')
  }

  // GT 可以包含未知墙厚 / 层高，必须保留 confirmed=false。
  // 不得因为 Ground Truth Gate 要求而让标注者虚构真实尺寸。
  if (draft.rooms.length === 0) {
    issues.push('Ground Truth 至少需要一个已标注的 Room')
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

    if (room.name.startsWith('待命名房间-')) {
      issues.push(room.name + ' 必须填写真实房间名称')
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
      pointDistance(start, end) + OPENING_EDGE_TOLERANCE_PX
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
  const [blankCaseId, setBlankCaseId] = useState('')
  const [drawingPoints, setDrawingPoints] = useState<PixelPoint[] | null>(null)
  const [geometryReviewed, setGeometryReviewed] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [orthogonalMode, setOrthogonalMode] = useState(true)
  const [panMode, setPanMode] = useState(false)
  const [optionHeld, setOptionHeld] = useState(false)
  const [canvasHovered, setCanvasHovered] = useState(false)
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [viewport, setViewport] = useState<AnnotationViewport | null>(null)
  const [cursorPoint, setCursorPoint] = useState<PixelPoint | null>(null)
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
  const panStart = useRef<{ x: number; y: number; view: AnnotationViewport } | null>(null)
  const editDragStart = useRef<{ point: PixelPoint; counted: boolean } | null>(null)
  const sourceLoadSequenceRef = useRef(0)
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null)
  const [openingMode, setOpeningMode] = useState(false)
  const [openingFirst, setOpeningFirst] = useState<{ roomId: string; point: PixelPoint } | null>(null)
  const [restoreCandidates, setRestoreCandidates] = useState<StoredAnnotationDraft[]>([])
  const [draftStatus, setDraftStatus] = useState<
    { kind: 'idle' } | { kind: 'saved'; at: number } | { kind: 'unavailable' }
  >({ kind: 'idle' })
  const fieldBaselines = useRef(new Map<string, string>())
  const savedKeyRef = useRef<string | null>(null)
  const savedImageRef = useRef<{ label: string; blob: Blob } | null>(null)
  const persistChainRef = useRef<Promise<void>>(Promise.resolve())
  const latestRef = useRef({ workingDraft, editCounts, startedAt, touchedRoomIds, sourceImage })

  useEffect(() => {
    setWorkingDraft(cloneDraft(draft))
    setSelectedRoomId(draft.rooms[0]?.id ?? '')
    setStartedAt(null)
    setDrawingPoints(null)
    setGeometryReviewed(false)
    setViewport(null)
    setPanMode(false)
    setOptionHeld(false)
    setSelectedVertexIndex(null)
    setCursorPoint(null)
    setBlankCaseId('')
    setEditCounts(initialEditCounts)
    setTouchedRoomIds(new Set<string>())
    sourceLoadSequenceRef.current += 1
    setSourceImage(null)
    setAnnotationError(null)
    setOpeningMode(false)
    setOpeningFirst(null)
    fieldBaselines.current.clear()
    savedKeyRef.current = null
    savedImageRef.current = null
  }, [resetKey])

  // Look for unfinished drafts left by a previous session (refresh, crash, closed tab).
  useEffect(() => {
    let cancelled = false
    setRestoreCandidates([])
    void (async () => {
      try {
        const stored = (await loadAnnotationDrafts()).filter((item) => !item.exported)
        if (cancelled) return
        const label = draft.source.sourceLabel
        stored.sort((a, b) => Number(b.sourceLabel === label) - Number(a.sourceLabel === label) ||
          b.savedAt - a.savedAt)
        setRestoreCandidates(stored.slice(0, 3))
      } catch {
        if (!cancelled) setDraftStatus({ kind: 'unavailable' })
      }
    })()
    return () => { cancelled = true }
  }, [resetKey])

  useLayoutEffect(() => {
    latestRef.current = { workingDraft, editCounts, startedAt, touchedRoomIds, sourceImage }
  })

  // Measure the rendered canvas so handle sizes can be kept constant in screen pixels.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => {
      const rect = svg.getBoundingClientRect()
      setCanvasSize((previous) =>
        previous && previous.width === rect.width && previous.height === rect.height
          ? previous : { width: rect.width, height: rect.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  // Only the foreground sidebar may scroll while the annotation workspace is open.
  // Cleanup restores the exact previous page styles on close, unmount and HMR.
  useEffect(() => {
    if (!focusMode) return
    return lockAnnotationBackgroundScroll(document)
  }, [focusMode])

  useEffect(() => {
    return () => {
      if (sourceImage?.objectUrl) {
        URL.revokeObjectURL(sourceImage.url)
      }
    }
  }, [sourceImage])

  // Best-effort autosave to IndexedDB: failures only change the status hint.
  const persistDraft = (exported: boolean) => {
    const run = async () => {
      const latest = latestRef.current
      const totalEdits = Object.values(latest.editCounts).reduce((sum, value) => sum + (value ?? 0), 0)
      const upload = latest.sourceImage?.blob
      if (!exported && totalEdits === 0 && !upload) return
      const label = latest.workingDraft.source.sourceLabel
      const image = latest.sourceImage
      const record: StoredAnnotationDraft = {
        version: 1,
        sourceLabel: label,
        savedAt: Date.now(),
        exported,
        workingDraft: latest.workingDraft,
        editCounts: latest.editCounts,
        startedAt: latest.startedAt,
        touchedRoomIds: [...latest.touchedRoomIds],
        sourceImage: !image ? null : upload
          ? { kind: 'upload', blob: upload, widthPx: image.widthPx, heightPx: image.heightPx }
          : { kind: 'demo', widthPx: image.widthPx, heightPx: image.heightPx },
      }
      const previousImage = savedImageRef.current
      const writeImage = upload
        ? !(previousImage && previousImage.label === label && previousImage.blob === upload)
        : previousImage !== null
      try {
        await saveAnnotationDraft(record, writeImage)
        const previousKey = savedKeyRef.current
        savedKeyRef.current = label
        savedImageRef.current = upload ? { label, blob: upload } : null
        if (previousKey && previousKey !== label) await deleteAnnotationDraft(previousKey)
        setDraftStatus({ kind: 'saved', at: record.savedAt })
      } catch {
        setDraftStatus({ kind: 'unavailable' })
      }
    }
    persistChainRef.current = persistChainRef.current.then(run, run)
  }
  const persistDraftRef = useRef(persistDraft)
  persistDraftRef.current = persistDraft
  const autosave = useMemo(
    () => createTrailingThrottle(() => persistDraftRef.current(false), AUTOSAVE_INTERVAL_MS),
    [],
  )

  useEffect(() => {
    // Keep the old draft intact until the person chooses to restore or discard it.
    if (restoreCandidates.length > 0 || startedAt === null) return
    autosave.schedule()
  }, [autosave, restoreCandidates.length, workingDraft, editCounts, startedAt, touchedRoomIds, sourceImage])

  useEffect(() => {
    const flush = () => autosave.flush()
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [autosave])

  const restoreDraft = (stored: StoredAnnotationDraft) => {
    sourceLoadSequenceRef.current += 1
    const stamp = stored.sourceImage
    setWorkingDraft(cloneDraft(stored.workingDraft))
    setSelectedRoomId(stored.workingDraft.rooms[0]?.id ?? '')
    setSourceImage(!stamp ? null : stamp.kind === 'upload'
      ? {
          url: URL.createObjectURL(stamp.blob),
          widthPx: stamp.widthPx,
          heightPx: stamp.heightPx,
          objectUrl: true,
          blob: stamp.blob,
        }
      : { url: '/floorplan-demo.svg', widthPx: stamp.widthPx, heightPx: stamp.heightPx, objectUrl: false })
    setEditCounts({ ...initialEditCounts, ...stored.editCounts })
    setStartedAt(stored.startedAt ?? Date.now())
    setTouchedRoomIds(new Set(stored.touchedRoomIds))
    setGeometryReviewed(false)
    setViewport(null)
    setSelectedVertexIndex(null)
    setDrawingPoints(null)
    setOpeningMode(false)
    setOpeningFirst(null)
    setCursorPoint(null)
    setBlankCaseId('')
    savedKeyRef.current = stored.sourceLabel
    savedImageRef.current = stamp?.kind === 'upload'
      ? { label: stored.sourceLabel, blob: stamp.blob } : null
    setRestoreCandidates([])
    setAnnotationError('已恢复上次未完成的标注；请重新核对后再勾选「已人工核对」')
  }

  const discardDraft = async (label: string) => {
    setRestoreCandidates((current) => current.filter((item) => item.sourceLabel !== label))
    try {
      await deleteAnnotationDraft(label)
    } catch {
      setDraftStatus({ kind: 'unavailable' })
    }
  }

  // Count a text/number field edit only if its value actually differs from when it gained focus.
  const beginFieldEdit = (field: string, value: string | number) => {
    fieldBaselines.current.set(field, String(value))
  }
  const commitFieldEdit = (
    field: string,
    value: string | number,
    kind: keyof EditCounts,
    roomId?: string,
  ) => {
    const baseline = fieldBaselines.current.get(field)
    fieldBaselines.current.delete(field)
    if (baseline !== undefined && baseline === String(value)) return
    recordEdit(kind, roomId)
  }

  const recordEdit = (
    kind: keyof EditCounts,
    roomId?: string,
  ) => {
    setStartedAt((current) => current ?? Date.now())
    setEditCounts((current) => ({
      ...current,
      [kind]: (current[kind] ?? 0) + 1,
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
    setGeometryReviewed(false)
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
    setGeometryReviewed(false)
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
        ? ['暂不支持 PDF 原图视觉复核']
        : []),
      ...getGroundTruthCalibrationBasisIssues(workingDraft),
      ...(drawingPoints !== null ? ['房间多边形尚未绘制完成'] : []),
      ...(!geometryReviewed ? ['请人工核对全部房间与开口后确认'] : []),
      ...(sourceImage && !aspectRatioCompatible
        ? ['原图与 Draft 宽高比不一致']
        : []),
    ],
    [
      aspectRatioCompatible,
      drawingPoints,
      geometryReviewed,
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
    setGeometryReviewed(false)
    setViewport(null)
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
      setAnnotationError('原图叠加当前只支持图片，PDF 后续单独接入')
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
      setGeometryReviewed(false)
      setViewport(null)
      setSourceImage((current) => {
        if (current?.objectUrl) {
          URL.revokeObjectURL(current.url)
        }

        return {
          url,
          widthPx: image.naturalWidth,
          heightPx: image.naturalHeight,
          objectUrl: true,
          blob: file,
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
    setGeometryReviewed(false)
    setViewport(null)
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

  const sourceWidth = workingDraft.source.widthPx
  const sourceHeight = workingDraft.source.heightPx
  const visibleView = viewport ?? fullViewport(sourceWidth, sourceHeight)
  const zoom = sourceWidth / visibleView.width
  // Screen pixels per source pixel; falls back to 1 until the canvas is measured.
  const screenScale = (canvasSize
    ? viewportScreenScale(canvasSize.width, canvasSize.height, visibleView) : null) ?? 1
  const px = (screenPx: number) => screenToSource(screenPx, screenScale)
  const closeSnapTolerance = Math.max(3, px(12))
  const isPanning = panMode || optionHeld
  const zoomBy = (factor: number) => setViewport((old) =>
    zoomViewport(old ?? fullViewport(sourceWidth, sourceHeight), factor, sourceWidth, sourceHeight))

  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )
    const onDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        if (!isEditable(event.target)) setOptionHeld(true)
        return
      }
      if (disabled || (!canvasHovered && !focusMode) || isEditable(event.target) ||
          event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '[' || event.key === ']' || event.key === '0') {
        event.preventDefault()
        if (event.key === '0') setViewport(null)
        else setViewport((current) => zoomViewport(
          current ?? fullViewport(sourceWidth, sourceHeight),
          event.key === ']' ? 1.5 : 1 / 1.5,
          sourceWidth, sourceHeight,
        ))
      }
    }
    const onUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setOptionHeld(false)
    }
    const onBlur = () => setOptionHeld(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [canvasHovered, focusMode, disabled, sourceWidth, sourceHeight])

  // Esc: first cancels a pending first click, then leaves the opening placement mode.
  useEffect(() => {
    if (!openingMode) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      event.preventDefault()
      if (openingFirst) {
        setOpeningFirst(null)
        setAnnotationError('已取消起点；再按 Esc 退出画门窗')
      } else {
        setOpeningMode(false)
        setCursorPoint(null)
        setAnnotationError(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openingMode, openingFirst])

  const startRoomDrag = (
    roomId: string,
    pointIndex: number,
    event: ReactPointerEvent<SVGCircleElement>,
  ) => {
    if (disabled || drawingPoints !== null || openingMode || isPanning) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedRoomId(roomId)
    setSelectedVertexIndex(pointIndex)
    setDragTarget({
      type: 'room_vertex',
      roomId,
      pointIndex,
    })
    const point = workingDraft.rooms.find((room) => room.id === roomId)?.boundaryPx[pointIndex]
    editDragStart.current = point ? { point, counted: false } : null
  }

  const startCalibrationDrag = (
    axis: CalibrationAxisKey,
    endpoint: 'start' | 'end',
    event: ReactPointerEvent<SVGCircleElement>,
  ) => {
    if (disabled || drawingPoints !== null || openingMode || isPanning) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const target = workingDraft[axis]
    if (!target) return
    setDragTarget({ type: 'calibration', axis, endpoint })
    editDragStart.current = {
      point: target[endpoint === 'start' ? 'startPx' : 'endPx'],
      counted: false,
    }
  }

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panStart.current) {
      const pan = panStart.current
      const svgScale = svgRef.current?.getScreenCTM()?.a
      if (!svgScale) return
      setViewport(clampViewport({
        ...pan.view,
        x: pan.view.x - (event.clientX - pan.x) / svgScale,
        y: pan.view.y - (event.clientY - pan.y) / svgScale,
      }, sourceWidth, sourceHeight))
      return
    }
    if (drawingPoints !== null && !disabled) {
      const pointer = pointFromPointer(event)
      if (pointer) setCursorPoint(orthogonalMode && drawingPoints.length
        ? orthogonalPoint(drawingPoints[drawingPoints.length - 1]!, pointer,
          drawingPoints[0], closeSnapTolerance) : pointer)
    } else if (openingMode && !disabled) {
      setCursorPoint(pointFromPointer(event))
    }
    if (!dragTarget || disabled) return

    const point = pointFromPointer(event)
    if (!point) return
    const gesture = editDragStart.current
    if (gesture && !gesture.counted) {
      if (pointDistance(gesture.point, point) <= 1) return
      gesture.counted = true
      if (dragTarget.type === 'room_vertex') recordEdit('roomVertexMoves', dragTarget.roomId)
      else recordEdit('calibrationEdits')
    }
    setGeometryReviewed(false)

    if (dragTarget.type === 'room_vertex') {
      updateRoom(dragTarget.roomId, (room) => ({
        ...room,
        boundaryPx: room.boundaryPx.map((currentPoint, index) =>
          index === dragTarget.pointIndex ? point : currentPoint,
        ),
      }))
      return
    }

    setWorkingDraft((current) =>
      moveCalibrationEndpoint(current, dragTarget.axis, dragTarget.endpoint, point),
    )
  }

  const stopDrag = () => {
    setDragTarget(null)
    editDragStart.current = null
    panStart.current = null
  }

  const enterOpeningMode = () => {
    if (!selectedRoom || disabled || drawingPoints !== null) return
    setOpeningMode(true)
    setOpeningFirst(null)
    setPanMode(false)
    setCursorPoint(null)
    setAnnotationError('画门窗：依次点击当前房间某条墙边上的起点和终点；Esc 取消')
  }

  const exitOpeningMode = () => {
    setOpeningMode(false)
    setOpeningFirst(null)
    setCursorPoint(null)
  }

  const placeOpeningClick = (point: PixelPoint) => {
    const room = selectedRoom
    if (!room) {
      setAnnotationError('请先选择要放置门窗的房间')
      return
    }
    const maxDistancePx = px(HANDLE_PX.openingSnapDistance)
    if (!openingFirst || openingFirst.roomId !== room.id) {
      const hit = nearestEdgeProjection(room.boundaryPx, point, maxDistancePx)
      if (!hit) {
        setAnnotationError('请在当前房间的墙边附近点击门窗起点')
        return
      }
      setOpeningFirst({ roomId: room.id, point })
      setAnnotationError(`已记录起点（第 ${hit.edgeIndex + 1} 条边），请点击门窗终点；Esc 取消`)
      return
    }
    const plan = planOpeningFromClicks(room, workingDraft.openings, openingFirst.point, point, { maxDistancePx })
    if (!plan.ok) {
      setAnnotationError(plan.reason)
      return
    }
    const id = nextEntityId('manual-opening-', [
      ...workingDraft.rooms.map((item) => item.id),
      ...workingDraft.openings.map((item) => item.id),
    ])
    setWorkingDraft((current) => ({
      ...current,
      openings: [...current.openings, {
        id,
        roomId: room.id,
        edgeIndex: plan.edgeIndex,
        kind: 'door',
        offsetPx: plan.offsetPx,
        widthPx: plan.widthPx,
        heightMeters: 2.1,
      }],
    }))
    setGeometryReviewed(false)
    recordEdit('openingGeometryEdits', room.id)
    setOpeningFirst(null)
    setAnnotationError(`已在第 ${plan.edgeIndex + 1} 条边放置 ${id}（默认门，高度 2.1m 仅为占位）；可继续放置，Esc 退出，类型与尺寸请在右侧核对`)
  }

  const resetAnnotation = () => {
    if (!window.confirm('将丢弃当前全部校正，恢复到导入时的 Draft。确定继续？')) return
    setViewport(null)
    setSelectedVertexIndex(null)
    setDrawingPoints(null)
    exitOpeningMode()
    setGeometryReviewed(false)
    setWorkingDraft(cloneDraft(draft))
    setSelectedRoomId(draft.rooms[0]?.id ?? '')
    recordEdit('resets')
    setAnnotationError(null)
  }

  const addVerticalScale = () => {
    if (disabled || workingDraft.calibrationY) return
    setGeometryReviewed(false)
    setWorkingDraft((current) => ({
      ...current,
      calibrationY: createVerticalCalibration(
        current.calibration,
        current.source.widthPx,
        current.source.heightPx,
      ),
    }))
    recordEdit('calibrationEdits')
    setAnnotationError('已添加纵向标尺（距离按横向比例推算，仅为假设）；请拖到图上已知竖直尺寸并填写实际距离')
  }

  const removeVerticalScale = () => {
    if (disabled || !workingDraft.calibrationY) return
    setGeometryReviewed(false)
    setWorkingDraft((current) => removeVerticalCalibration(current) as FloorPlanDraft)
    recordEdit('calibrationEdits')
  }

  const startBlankAnnotation = () => {
    if (!sourceImage || disabled) return
    const caseId = blankCaseId.trim()
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(caseId)) {
      setAnnotationError('请先输入匿名 Case ID（小写字母、数字、短横线或下划线）')
      return
    }
    if (!window.confirm('将清空当前 Room / Opening，并从已上传的原图开始标注。确定继续？')) return
    const { widthPx, heightPx } = sourceImage
    setWorkingDraft(({ calibrationY: _staleCalibrationY, ...current }) => ({
      // 从空白开始时丢弃旧图的纵向标定，避免沿用到新图
      ...current,
      source: { kind: 'floorplan_image', sourceLabel: caseId, widthPx, heightPx },
      calibration: {
        startPx: [Math.min(10, widthPx / 4), Math.max(0, heightPx - 10)],
        endPx: [Math.min(widthPx, 110), Math.max(0, heightPx - 10)],
        realDistanceMeters: 0,
        basis: 'assumed',
      },
      assumptions: {
        ...current.assumptions,
        wallThicknessConfirmed: false,
        ceilingHeightConfirmed: false,
      },
      rooms: [],
      openings: [],
    }))
    setSelectedRoomId('')
    setSelectedVertexIndex(null)
    setDrawingPoints(null)
    exitOpeningMode()
    setViewport(null)
    setGeometryReviewed(false)
    setTouchedRoomIds(new Set<string>())
    // A blank annotation is a new case: its Review Burden starts from zero.
    setEditCounts(initialEditCounts)
    setStartedAt(Date.now())
    setAnnotationError('已开始空白标注：请逐房间描边，核对尺寸、墙厚和层高')
  }

  const finishDrawingRoom = () => {
    if (!drawingPoints) return
    const points = [...drawingPoints]
    if (points.length >= 2 && pointDistance(points[0]!, points[points.length - 1]!) < 3) {
      points.pop()
    }
    if (orthogonalMode && points.length >= 3 &&
        !orthogonalEdge(points[points.length - 1]!, points[0]!)) {
      setAnnotationError('正交模式下末边未对齐，请补一个水平/竖直转角再闭合，或关闭正交绘制')
      return
    }
    if (points.length < 3 ||
        Math.abs(polygonSignedArea(points)) <= 1 ||
        polygonHasSelfIntersection(points) ||
        points.some((p, index) => pointDistance(p, points[(index + 1) % points.length]!) <= 1)) {
      setAnnotationError('房间多边形无效：至少 3 个不重复的顶点，不能自交或面积为 0')
      return
    }
    const ids = new Set([
      ...workingDraft.rooms.map((room) => room.id),
      ...workingDraft.openings.map((opening) => opening.id),
    ])
    let sequence = 1
    while (ids.has('manual-room-' + sequence)) sequence += 1
    const id = 'manual-room-' + sequence
    setWorkingDraft((current) => ({
      ...current,
      rooms: [...current.rooms, {
        id,
        name: '待命名房间-' + sequence,
        boundaryPx: points,
      }],
    }))
    setSelectedRoomId(id)
    setSelectedVertexIndex(null)
    setDrawingPoints(null)
    setCursorPoint(null)
    setGeometryReviewed(false)
    recordEdit('roomStructureEdits', id)
    setAnnotationError(null)
  }

  const editSelectedVertex = (action: 'delete' | 'insert') => {
    if (!selectedRoom || selectedVertexIndex === null || disabled || drawingPoints !== null) return
    try {
      const result = action === 'delete'
        ? removePolygonVertex(selectedRoom, workingDraft.openings, selectedVertexIndex)
        : insertPolygonVertex(selectedRoom, workingDraft.openings, selectedVertexIndex)
      const points = result.room.boundaryPx
      if (points.some((point, index) =>
        pointDistance(point, points[(index + 1) % points.length]!) <= 1) ||
          Math.abs(polygonSignedArea(points)) <= 1 || polygonHasSelfIntersection(points)) {
        setAnnotationError('操作将产生零长度边或无效多边形，请先调整顶点位置')
        return
      }
      setWorkingDraft((current) => ({
        ...current,
        rooms: current.rooms.map((room) => room.id === selectedRoom.id ? result.room : room),
        openings: result.openings,
      }))
      setGeometryReviewed(false)
      recordEdit('roomStructureEdits', selectedRoom.id)
      setSelectedVertexIndex(action === 'delete'
        ? Math.min(selectedVertexIndex, points.length - 1)
        : selectedVertexIndex + 1)
      setAnnotationError(null)
    } catch (error) {
      setAnnotationError(error instanceof Error ? error.message : '顶点修改失败')
    }
  }

  const removeSelectedRoom = () => {
    if (!selectedRoom || disabled || !window.confirm('删除房间及其所有 Opening？')) return
    const id = selectedRoom.id
    setWorkingDraft((current) => ({
      ...current,
      rooms: current.rooms.filter((room) => room.id !== id),
      openings: current.openings.filter((opening) => opening.roomId !== id),
    }))
    setSelectedRoomId(workingDraft.rooms.find((room) => room.id !== id)?.id ?? '')
    setSelectedVertexIndex(null)
    setGeometryReviewed(false)
    recordEdit('roomStructureEdits', id)
  }

  const addOpeningToSelectedRoom = () => {
    if (!selectedRoom || selectedRoom.boundaryPx.length < 2 || disabled) return
    const a = selectedRoom.boundaryPx[0]!
    const b = selectedRoom.boundaryPx[1]!
    const length = pointDistance(a, b)
    if (length <= 2) return
    const widthPx = Math.min(60, length / 3)
    const ids = new Set(workingDraft.openings.map((opening) => opening.id))
    let sequence = 1
    while (ids.has('manual-opening-' + sequence)) sequence += 1
    setWorkingDraft((current) => ({
      ...current,
      openings: [...current.openings, {
        id: 'manual-opening-' + sequence,
        roomId: selectedRoom.id,
        edgeIndex: 0,
        kind: 'door',
        offsetPx: (length - widthPx) / 2,
        widthPx,
        heightMeters: 2.1,
      }],
    }))
    setGeometryReviewed(false)
    recordEdit('openingGeometryEdits', selectedRoom.id)
    setAnnotationError('新增 Opening 的边、宽度及高度只是占位，请人工逐项校正')
  }

  const deleteOpening = (openingId: string) => {
    if (disabled || !window.confirm('删除此 Opening？')) return
    setWorkingDraft((current) => ({
      ...current,
      openings: current.openings.filter((opening) => opening.id !== openingId),
    }))
    setGeometryReviewed(false)
    recordEdit('openingGeometryEdits', selectedRoomId)
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
    // 取整噪声可能让门窗越过墙边不到 0.5 px，导出前收回墙边，避免语料库 Gate 拒收。
    openings: fitOpeningsToRoomEdges(workingDraft.rooms, workingDraft.openings).map((opening) => ({
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
        counts.resets +
        (counts.roomStructureEdits ?? 0),
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
    autosave.cancel()
    persistDraft(true)
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

  const viewBox = [visibleView.x, visibleView.y, visibleView.width, visibleView.height].join(' ')

  return (
    <div className={['floorplan-annotation', focusMode ? 'is-focused' : '', focusMode && sidebarCollapsed ? 'sidebar-collapsed' : ''].filter(Boolean).join(' ')}>
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
          <button type="button" onClick={() => setFocusMode((old) => !old)}>
            {focusMode ? '退出专注模式' : '大画布专注模式'}
          </button>
          {draftStatus.kind === 'saved' ? (
            <span className="floorplan-draft-status" role="status">
              草稿已自动保存 {new Date(draftStatus.at).toLocaleTimeString()}
            </span>
          ) : null}
          {draftStatus.kind === 'unavailable' ? (
            <span className="floorplan-draft-status is-warning" role="status">
              浏览器存储不可用，未自动保存草稿，请及时导出
            </span>
          ) : null}
        </div>
      </div>

      {restoreCandidates.length > 0 ? (
        <div className="floorplan-restore-banner" role="status">
          {restoreCandidates.map((item) => (
            <div className="floorplan-restore-row" key={item.sourceLabel}>
              <span>
                发现未导出的标注草稿「{item.sourceLabel}」（{item.workingDraft.rooms.length} 个房间、
                {item.workingDraft.openings.length} 个 Opening，保存于 {new Date(item.savedAt).toLocaleString()}
                {item.sourceImage?.kind === 'upload' ? '，含原图' : ''}）。处理前不会自动保存新的修改。
              </span>
              <button type="button" disabled={disabled} onClick={() => restoreDraft(item)}>
                恢复上次未完成的标注
              </button>
              <button type="button" disabled={disabled} onClick={() => void discardDraft(item.sourceLabel)}>
                丢弃
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="floorplan-manual-toolbar">
        <label>
          匿名 Case ID
          <input value={blankCaseId} disabled={disabled} placeholder="case-001"
            onChange={(event) => setBlankCaseId(event.target.value)} />
        </label>
        <button type="button" disabled={disabled || !sourceImage} onClick={startBlankAnnotation}>
          从原图开始空白标注
        </button>
        <label className="floorplan-orthogonal-toggle">
          <input type="checkbox" checked={orthogonalMode}
            disabled={disabled}
            onChange={(event) => { setOrthogonalMode(event.target.checked); setCursorPoint(null) }} />
          正交绘制（锁定水平/垂直）
        </label>
        {drawingPoints === null ? (
          <button type="button" disabled={disabled || !sourceImage || !aspectRatioCompatible}
            onClick={() => { exitOpeningMode(); setDrawingPoints([]); setPanMode(false); setGeometryReviewed(false); setAnnotationError(null) }}>
            绘制新房间
          </button>
        ) : (
          <>
            <span>已放置 {drawingPoints.length} 个顶点（点击首点闭合）</span>
            <button type="button" disabled={disabled || drawingPoints.length < 3} onClick={finishDrawingRoom}>完成房间</button>
            <button type="button" disabled={disabled || drawingPoints.length === 0}
              onClick={() => { setDrawingPoints((points) => points?.slice(0, -1) ?? null); setCursorPoint(null) }}>撤销顶点</button>
            <button type="button" disabled={disabled} onClick={() => { setDrawingPoints(null); setCursorPoint(null) }}>取消绘制</button>
          </>
        )}
        {openingMode ? (
          <>
            <span>
              {openingFirst && openingFirst.roomId === selectedRoomId
                ? '请点击门窗终点（Esc 取消起点）'
                : '画门窗：在当前房间墙边点击起点（Esc 退出）'}
            </span>
            <button type="button" onClick={exitOpeningMode}>退出画门窗</button>
          </>
        ) : (
          <button type="button" disabled={disabled || !selectedRoom || drawingPoints !== null}
            onClick={enterOpeningMode}>
            画门窗
          </button>
        )}
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
            <div className="floorplan-zoom-controls">
              <button type="button" disabled={zoom >= 8} onClick={() => zoomBy(1.5)}>＋ 放大</button>
              <span>{zoom.toFixed(1)}×</span>
              <button type="button" disabled={zoom <= 1} onClick={() => zoomBy(1 / 1.5)}>－ 缩小</button>
              <button type="button" onClick={() => setViewport(null)}>适应</button>
              <button type="button" aria-pressed={panMode} onClick={() => setPanMode((v) => !v)}>
                {panMode ? '停止平移' : '平移画布'}
              </button>
              {focusMode ? (
                <button type="button" onClick={() => setSidebarCollapsed((v) => !v)}>
                  {sidebarCollapsed ? '展开右侧面板' : '收起右侧面板'}
                </button>
              ) : null}
              <span className="floorplan-shortcut-tip">按住 Option 平移 · [ / ] 缩放 · 0 适应</span>
            </div>
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
            className={['floorplan-annotation-canvas', isPanning ? 'is-panning' : '', openingMode && !isPanning ? 'is-placing' : ''].filter(Boolean).join(' ')}
            viewBox={viewBox}
            style={{ aspectRatio: `${sourceWidth} / ${sourceHeight}` }}
            onPointerDown={(event) => {
              if (disabled || event.button !== 0) return
              if (isPanning) {
                if (zoom <= 1) return
                event.currentTarget.setPointerCapture(event.pointerId)
                panStart.current = { x: event.clientX, y: event.clientY, view: visibleView }
                event.preventDefault()
                return
              }
              if (openingMode) {
                const placed = pointFromPointer(event)
                if (!placed) return
                event.preventDefault()
                placeOpeningClick(placed)
                return
              }
              if (drawingPoints === null || !sourceImage || !aspectRatioCompatible) return
              const point = pointFromPointer(event)
              if (!point) return
              event.preventDefault()
              if (drawingPoints.length >= 3 && clickNearStart(drawingPoints[0]!, point, screenScale)) {
                finishDrawingRoom()
                return
              }
              const snapped = orthogonalMode && drawingPoints.length
                ? orthogonalPoint(drawingPoints[drawingPoints.length - 1]!, point,
                  drawingPoints[0], closeSnapTolerance) : point
              setGeometryReviewed(false)
              setDrawingPoints((current) => current === null ? null :
                [...current, [Math.round(snapped[0] * 100) / 100, Math.round(snapped[1] * 100) / 100]])
            }}
            onPointerMove={moveDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onPointerEnter={() => setCanvasHovered(true)}
            onPointerLeave={() => {
              setCanvasHovered(false)
              if (!panStart.current) stopDrag()
              setCursorPoint(null)
            }}
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
                    onPointerDown={() => {
                      if (!isPanning && !openingMode) { setSelectedRoomId(room.id); setSelectedVertexIndex(null) }
                    }}
                  />
                  <text
                    className="floorplan-annotation-label"
                    x={center[0]}
                    y={center[1]}
                    style={{ fontSize: px(HANDLE_PX.labelFont), strokeWidth: px(HANDLE_PX.labelStroke) }}
                  >
                    {room.name}
                  </text>
                </g>
              )
            })}

            {/* Vertex handles: constant on-screen size with a larger transparent hit area.
                The selected room is drawn last so its handles win on shared corners. */}
            {[...workingDraft.rooms]
              .sort((a, b) => Number(a.id === selectedRoomId) - Number(b.id === selectedRoomId))
              .map((room) => {
                const selected = room.id === selectedRoomId
                return (
                  <g key={room.id + '-vertices'}>
                    {room.boundaryPx.map((point, pointIndex) => (
                      <g key={pointIndex}>
                        <circle
                          className={
                            selected && selectedVertexIndex === pointIndex
                              ? 'floorplan-vertex active'
                              : selected ? 'floorplan-vertex selected' : 'floorplan-vertex'
                          }
                          cx={point[0]}
                          cy={point[1]}
                          r={px(selected ? HANDLE_PX.vertexSelected : HANDLE_PX.vertex)}
                          pointerEvents="none"
                        />
                        <circle
                          className="floorplan-handle-hit"
                          cx={point[0]}
                          cy={point[1]}
                          r={px(selected ? HANDLE_PX.vertexSelectedHit : HANDLE_PX.vertexHit)}
                          onPointerDown={(event) =>
                            startRoomDrag(room.id, pointIndex, event)
                          }
                        />
                      </g>
                    ))}
                  </g>
                )
              })}

            {drawingPoints !== null && drawingPoints.length > 0 ? (
              <g pointerEvents="none">
                <polyline
                  className="floorplan-drawing-line"
                  fill="none"
                  points={drawingPoints.map((point) => point.join(',')).join(' ')}
                />
                {cursorPoint ? (
                  <line className="floorplan-drawing-line floorplan-preview-line"
                    x1={drawingPoints[drawingPoints.length - 1]![0]}
                    y1={drawingPoints[drawingPoints.length - 1]![1]}
                    x2={cursorPoint[0]} y2={cursorPoint[1]} />
                ) : null}
                {drawingPoints.map((point, index) => (
                  <circle key={index}
                    className={index === 0 ? 'floorplan-drawing-point first' : 'floorplan-drawing-point'}
                    cx={point[0]} cy={point[1]}
                    r={px(index === 0 ? HANDLE_PX.drawingFirstPoint : HANDLE_PX.drawingPoint)} />
                ))}
              </g>
            ) : null}

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

            {openingMode && selectedRoom && !disabled ? (() => {
              const first = openingFirst && openingFirst.roomId === selectedRoom.id ? openingFirst : null
              const snap = px(HANDLE_PX.openingSnapDistance)
              const anchor = first ? nearestEdgeProjection(selectedRoom.boundaryPx, first.point, snap) : null
              const hover = !first && cursorPoint
                ? nearestEdgeProjection(selectedRoom.boundaryPx, cursorPoint, snap) : null
              const target = anchor && cursorPoint
                ? projectPointToEdge(selectedRoom.boundaryPx, anchor.edgeIndex, cursorPoint) : null
              const hint = hover ?? anchor
              const hintStart = hint ? selectedRoom.boundaryPx[hint.edgeIndex] : undefined
              const hintEnd = hint
                ? selectedRoom.boundaryPx[(hint.edgeIndex + 1) % selectedRoom.boundaryPx.length] : undefined
              return (
                <g pointerEvents="none">
                  {hintStart && hintEnd ? (
                    <line className="floorplan-opening-edge-hint"
                      x1={hintStart[0]} y1={hintStart[1]} x2={hintEnd[0]} y2={hintEnd[1]} />
                  ) : null}
                  {anchor && target ? (
                    <line className="floorplan-opening-preview"
                      x1={anchor.point[0]} y1={anchor.point[1]} x2={target.point[0]} y2={target.point[1]} />
                  ) : null}
                  {hover ? (
                    <circle className="floorplan-opening-snap" cx={hover.point[0]} cy={hover.point[1]}
                      r={px(HANDLE_PX.snapDot)} />
                  ) : null}
                  {anchor ? (
                    <circle className="floorplan-opening-snap" cx={anchor.point[0]} cy={anchor.point[1]}
                      r={px(HANDLE_PX.snapDot)} />
                  ) : null}
                </g>
              )
            })() : null}

            {([
              ['calibration', workingDraft.calibration, '横向'],
              ['calibrationY', workingDraft.calibrationY, '纵向'],
            ] as const).map(([axis, cal, axisLabel]) =>
              cal ? (
                <g
                  key={axis}
                  className={axis === 'calibrationY' ? 'floorplan-calibration is-vertical' : 'floorplan-calibration'}
                  data-calibration-axis={axis}
                >
                  <line
                    className="floorplan-calibration-line"
                    x1={cal.startPx[0]}
                    y1={cal.startPx[1]}
                    x2={cal.endPx[0]}
                    y2={cal.endPx[1]}
                  />
                  <text
                    className="floorplan-calibration-label"
                    x={(cal.startPx[0] + cal.endPx[0]) / 2}
                    y={(cal.startPx[1] + cal.endPx[1]) / 2}
                    dy={axis === 'calibrationY' ? 0 : px(-10)}
                    dx={axis === 'calibrationY' ? px(10) : 0}
                    textAnchor={axis === 'calibrationY' ? 'start' : 'middle'}
                    style={{ fontSize: px(HANDLE_PX.labelFont), strokeWidth: px(HANDLE_PX.labelStroke) }}
                  >
                    {axisLabel} {cal.realDistanceMeters}m
                  </text>
                  {(['start', 'end'] as const).map((endpoint) => {
                    const point = endpoint === 'start' ? cal.startPx : cal.endPx
                    return (
                      <g key={endpoint}>
                        <circle
                          className="floorplan-calibration-handle"
                          cx={point[0]}
                          cy={point[1]}
                          r={px(HANDLE_PX.calibration)}
                          pointerEvents="none"
                        />
                        <circle
                          className="floorplan-handle-hit"
                          data-handle={`${axis}-${endpoint}`}
                          cx={point[0]}
                          cy={point[1]}
                          r={px(HANDLE_PX.calibrationHit)}
                          onPointerDown={(event) =>
                            startCalibrationDrag(axis, endpoint, event)
                          }
                        />
                      </g>
                    )
                  })}
                </g>
              ) : null,
            )}
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
              onChange={(event) => { setSelectedRoomId(event.target.value); setSelectedVertexIndex(null); setOpeningFirst(null) }}
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
              <div className="floorplan-vertex-editor">
                <strong>房间顶点编辑</strong>
                <span>{selectedVertexIndex === null
                  ? '点击或拖动顶点以选中'
                  : `第 ${selectedVertexIndex + 1} / ${selectedRoom.boundaryPx.length} 个顶点`}</span>
                <div className="floorplan-manual-actions">
                  <button type="button" disabled={disabled || drawingPoints !== null || selectedVertexIndex === null}
                    onClick={() => editSelectedVertex('insert')}>在选中点后插入中点</button>
                  <button type="button" disabled={disabled || drawingPoints !== null ||
                    selectedVertexIndex === null || selectedRoom.boundaryPx.length <= 3}
                    onClick={() => editSelectedVertex('delete')}>删除选中顶点</button>
                </div>
              </div>
              <div className="floorplan-manual-actions">
                <button type="button" disabled={disabled || drawingPoints !== null}
                  onClick={removeSelectedRoom}>删除当前房间及其 Opening</button>
                <button type="button" disabled={disabled || drawingPoints !== null}
                  onClick={addOpeningToSelectedRoom}>新增 Opening（需复核）</button>
              </div>
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
                  onFocus={() => beginFieldEdit('room-name:' + selectedRoom.id, selectedRoom.name)}
                  onBlur={() =>
                    commitFieldEdit(
                      'room-name:' + selectedRoom.id,
                      selectedRoom.name,
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
                      <button type="button" disabled={disabled}
                        onClick={() => deleteOpening(opening.id)}>删除 Opening</button>
                      <label>
                        Edge Index
                        <select value={opening.edgeIndex} disabled={disabled}
                          onChange={(event) => {
                            const edgeIndex = Number(event.target.value)
                            updateOpening(opening.id, (current) => ({ ...current, edgeIndex, offsetPx: 0 }))
                            recordEdit('openingGeometryEdits', selectedRoom.id)
                          }}>
                          {selectedRoom.boundaryPx.map((_, index) =>
                            <option key={index} value={index}>{index}</option>)}
                        </select>
                      </label>
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
                          onFocus={() => beginFieldEdit('opening-offset:' + opening.id, opening.offsetPx)}
                          onChange={(event) => {
                            const value = Number(event.target.value)
                            updateOpening(opening.id, (current) => ({
                              ...current,
                              offsetPx: value,
                            }))
                          }}
                          onBlur={() =>
                            commitFieldEdit(
                              'opening-offset:' + opening.id,
                              opening.offsetPx,
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
                          onFocus={() => beginFieldEdit('opening-width:' + opening.id, opening.widthPx)}
                          onChange={(event) => {
                            const value = Number(event.target.value)
                            updateOpening(opening.id, (current) => ({
                              ...current,
                              widthPx: value,
                            }))
                          }}
                          onBlur={() =>
                            commitFieldEdit(
                              'opening-width:' + opening.id,
                              opening.widthPx,
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
                  setGeometryReviewed(false)
                  setWorkingDraft((current) =>
                    setCalibrationDistance(current, 'calibration', value),
                  )
                }}
                onFocus={() => beginFieldEdit('calibration-distance', workingDraft.calibration.realDistanceMeters)}
                onBlur={() => commitFieldEdit('calibration-distance', workingDraft.calibration.realDistanceMeters, 'calibrationEdits')}
              />
            </label>
            <label>
              Real Distance Y m（纵向）
              <input
                type="number"
                min="0.01"
                step="0.01"
                data-testid="calibration-y-distance"
                value={workingDraft.calibrationY?.realDistanceMeters ?? ''}
                placeholder="未添加纵向标尺"
                disabled={disabled || !workingDraft.calibrationY}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setGeometryReviewed(false)
                  setWorkingDraft((current) =>
                    setCalibrationDistance(current, 'calibrationY', value),
                  )
                }}
                onFocus={() => beginFieldEdit('calibration-y-distance', workingDraft.calibrationY?.realDistanceMeters ?? '')}
                onBlur={() => commitFieldEdit('calibration-y-distance', workingDraft.calibrationY?.realDistanceMeters ?? '', 'calibrationEdits')}
              />
            </label>
            <div className="floorplan-annotation-actions">
              {workingDraft.calibrationY ? (
                <button type="button" disabled={disabled} onClick={removeVerticalScale}>
                  移除纵向标尺
                </button>
              ) : (
                <button type="button" disabled={disabled} onClick={addVerticalScale}>
                  添加纵向标尺
                </button>
              )}
            </div>
            <small>
              基准：横向 {workingDraft.calibration.basis ?? '未声明'}
              {workingDraft.calibrationY ? ' / 纵向 ' + (workingDraft.calibrationY.basis ?? '未声明') : ''}
              。拖动端点或改距离后记为 annotated；assumed 会阻断 Finalize。
            </small>
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
                onFocus={() => beginFieldEdit('wall-thickness', workingDraft.assumptions.wallThicknessMeters)}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setGeometryReviewed(false)
                  setWorkingDraft((current) => ({
                    ...current,
                    assumptions: {
                      ...current.assumptions,
                      wallThicknessMeters: value,
                    },
                  }))
                }}
                onBlur={() => commitFieldEdit('wall-thickness', workingDraft.assumptions.wallThicknessMeters, 'assumptionEdits')}
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
                  setGeometryReviewed(false)
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
              墙厚有可靠建筑资料佐证（否则不要勾选）
            </label>
            <label>
              Ceiling Height m
              <input
                type="number"
                min="1.8"
                step="0.01"
                value={workingDraft.assumptions.ceilingHeightMeters}
                disabled={disabled}
                onFocus={() => beginFieldEdit('ceiling-height', workingDraft.assumptions.ceilingHeightMeters)}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setGeometryReviewed(false)
                  setWorkingDraft((current) => ({
                    ...current,
                    assumptions: {
                      ...current.assumptions,
                      ceilingHeightMeters: value,
                    },
                  }))
                }}
                onBlur={() => commitFieldEdit('ceiling-height', workingDraft.assumptions.ceilingHeightMeters, 'assumptionEdits')}
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
                  setGeometryReviewed(false)
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
              层高有可靠建筑资料佐证（否则不要勾选）
            </label>
          </div>

          <label className="floorplan-check">
            <input type="checkbox" checked={geometryReviewed} disabled={disabled || drawingPoints !== null}
              onChange={(event) => setGeometryReviewed(event.target.checked)} />
            已人工核对 Room / Opening / 比例尺；未知墙厚或层高请保持「未确认」
          </label>
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

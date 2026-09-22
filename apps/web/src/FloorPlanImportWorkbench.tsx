import { FloorPlanAnnotationWorkbench } from './FloorPlanAnnotationWorkbench'
import {
  FloorPlanDraftImporter,
  applySpatialCorrection,
  canFinalizeSpatialReview,
  createSpatialReviewSession,
  finalizeSpatialReview,
  getPendingSpatialReviewIssues,
  isFloorPlanDraft,
  polygonCenter,
  sampleFloorPlanDraft,
  validateHomeSpatialModel,
  type FloorPlanDraft,
  type HomeSpatialModel,
  type RoomType,
  type SpatialReviewSession,
  type Vec2,
} from '@homescape/spatial-model'
import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
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

function projectPoint(
  point: Vec2,
  minX: number,
  maxZ: number,
  scale: number,
  padding: number,
) {
  return [
    (point[0] - minX) * scale + padding,
    (maxZ - point[1]) * scale + padding,
  ] as const
}

export interface FloorPlanImportWorkbenchProps {
  activeSpatialModelId?: string
  disabled?: boolean
  onFinalized?: (model: HomeSpatialModel) => void
}

export function FloorPlanImportWorkbench({
  activeSpatialModelId,
  disabled = false,
  onFinalized,
}: FloorPlanImportWorkbenchProps) {
  const importer = useMemo(() => new FloorPlanDraftImporter(), [])
  const [draft, setDraft] = useState<FloorPlanDraft>(sampleFloorPlanDraft)
  const [session, setSession] = useState<SpatialReviewSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importSequenceRef = useRef(0)
  const [annotationResetKey, setAnnotationResetKey] = useState(0)
  const [roomTypeDrafts, setRoomTypeDrafts] = useState<
    Record<string, RoomType>
  >({})

  const importDraft = async (
    nextDraft: FloorPlanDraft,
    resetAnnotation = false,
  ) => {
    setLoading(true)
    setError(null)
    importSequenceRef.current += 1
    const importProjectId =
      'project-import-preview-' + importSequenceRef.current

    try {
      const result = await importer.parse(nextDraft, {
        projectId: importProjectId,
        projectName: nextDraft.source.sourceLabel,
        sourceKind: nextDraft.source.kind,
        sourceId: nextDraft.source.sourceLabel,
        sourceLabel: nextDraft.source.sourceLabel,
      })

      setDraft(nextDraft)
      setSession(createSpatialReviewSession(result))
      if (resetAnnotation) {
        setAnnotationResetKey((current) => current + 1)
      }
      setRoomTypeDrafts({})
    } catch (importError) {
      setSession(null)
      setError(
        importError instanceof Error
          ? importError.message
          : '户型 Draft 导入失败',
      )
    } finally {
      setLoading(false)
    }
  }

  const loadSample = () => {
    void importDraft(sampleFloorPlanDraft, true)
  }

  const uploadDraft = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      setError('FloorPlanDraft JSON 不能超过 2MB')
      return
    }

    setError(null)

    try {
      const parsed: unknown = JSON.parse(await file.text())

      if (!isFloorPlanDraft(parsed)) {
        throw new Error(
          '文件不是 HomeScape FloorPlanDraft v0.1.0 格式',
        )
      }

      await importDraft(parsed, true)
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : '无法读取户型 Draft',
      )
    }
  }

  const pendingIssues = session
    ? getPendingSpatialReviewIssues(session)
    : []
  const finalized =
    session !== null && session.model.id === activeSpatialModelId
  const validation = session
    ? validateHomeSpatialModel(session.model)
    : null

  const preview = useMemo(() => {
    if (!session) return null

    const floor = session.model.floors[0]
    if (!floor) return null

    const points = floor.rooms.flatMap((room) => room.boundary.points)
    if (points.length === 0) return null

    const minX = Math.min(...points.map((point) => point[0]))
    const maxX = Math.max(...points.map((point) => point[0]))
    const minZ = Math.min(...points.map((point) => point[1]))
    const maxZ = Math.max(...points.map((point) => point[1]))
    const scale = 74
    const padding = 24

    return {
      floor,
      minX,
      maxZ,
      scale,
      padding,
      width: (maxX - minX) * scale + padding * 2,
      height: (maxZ - minZ) * scale + padding * 2,
    }
  }, [session])

  const resolveIssue = (issueId: string, note: string) => {
    if (!session) return

    setSession(
      applySpatialCorrection(session, {
        type: 'resolve_issue',
        issueId,
        note,
      }),
    )
  }

  const confirmWallThickness = (
    issueId: string,
    wallIds: string[],
  ) => {
    if (!session) return

    setSession(
      applySpatialCorrection(session, {
        type: 'set_wall_thickness',
        wallIds,
        thicknessMeters: draft.assumptions.wallThicknessMeters,
        issueIds: [issueId],
      }),
    )
  }

  const confirmRoomType = (
    issueId: string,
    roomId: string,
  ) => {
    if (!session) return

    const selectedType = roomTypeDrafts[roomId] ?? 'other'

    setSession(
      applySpatialCorrection(session, {
        type: 'set_room_type',
        roomId,
        roomType: selectedType,
        issueIds: [issueId],
      }),
    )
  }

  const finalize = () => {
    if (!session) return

    try {
      const model = finalizeSpatialReview(session)
      onFinalized?.(model)
      setError(null)
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error
          ? finalizeError.message
          : '户型确认失败',
      )
    }
  }

  return (
    <section className="floorplan-import-section">
      <div className="floorplan-import-copy">
        <div className="eyebrow">
          PR #13 · GROUND TRUTH ANNOTATION
        </div>
        <h2>把真实户型原图和结构化 Draft 放到同一张校正画布。</h2>
        <p>
          现在可以叠加真实户型图片，直接拖动 Room Polygon 顶点与标尺端点，并校正房间类型、Opening
          和尺寸假设。校正结果仍要经过 Importer / Review / Validation，且可以导出 Ground Truth
          与 Review Burden 记录。
        </p>

        <div className="floorplan-import-actions">
          <button
            type="button"
            disabled={loading || disabled}
            onClick={loadSample}
          >
            {loading ? '正在导入…' : '加载示例 Draft'}
          </button>
          <label className="floorplan-file-button">
            导入 Draft JSON
            <input
              type="file"
              accept="application/json,.json"
              disabled={disabled}
              onChange={(event) => void uploadDraft(event)}
            />
          </label>
        </div>

        <div className="floorplan-contract-note">
          <strong>输入 Contract</strong>
          <span>像素坐标 + 一条已知真实尺寸</span>
          <span>Room Polygon + Opening on Edge</span>
          <span>Confidence + 明确的假设项</span>
        </div>
      </div>

      <div className="floorplan-import-workbench">
        <FloorPlanAnnotationWorkbench
          draft={draft}
          resetKey={annotationResetKey}
          disabled={disabled || loading}
          onApply={(nextDraft) => importDraft(nextDraft, false)}
        />

        <div className="floorplan-review-divider">
          <span>Candidate Import / Human Review</span>
        </div>
        {!session ? (
          <div className="floorplan-empty">
            <strong>尚未生成 Candidate</strong>
            <span>
              加载示例或上传 FloorPlanDraft JSON 开始导入。
            </span>
          </div>
        ) : (
          <>
            <div className="floorplan-import-status">
              <div>
                <span>Candidate</span>
                <strong>{session.model.name}</strong>
              </div>
              <div>
                <span>Rooms</span>
                <strong>{preview?.floor.rooms.length ?? 0}</strong>
              </div>
              <div>
                <span>Pending Review</span>
                <strong>{pendingIssues.length}</strong>
              </div>
              <div>
                <span>Validation</span>
                <strong
                  className={
                    validation?.valid
                      ? 'metric-ok'
                      : 'metric-error'
                  }
                >
                  {validation?.valid ? 'VALID' : 'INVALID'}
                </strong>
              </div>
            </div>

            {preview ? (
              <svg
                className="floorplan-candidate-canvas"
                viewBox={
                  '0 0 ' +
                  preview.width +
                  ' ' +
                  preview.height
                }
                role="img"
                aria-label="导入户型候选模型预览"
              >
                {preview.floor.rooms.map((room) => {
                  const center = polygonCenter(room.boundary)
                  const [labelX, labelY] = projectPoint(
                    center,
                    preview.minX,
                    preview.maxZ,
                    preview.scale,
                    preview.padding,
                  )
                  const polygonPoints = room.boundary.points
                    .map((point) =>
                      projectPoint(
                        point,
                        preview.minX,
                        preview.maxZ,
                        preview.scale,
                        preview.padding,
                      ).join(','),
                    )
                    .join(' ')

                  return (
                    <g key={room.id}>
                      <polygon
                        className="floorplan-candidate-room"
                        points={polygonPoints}
                      />
                      <text
                        className="floorplan-candidate-label"
                        x={labelX}
                        y={labelY}
                      >
                        {room.name}
                      </text>
                    </g>
                  )
                })}

                {preview.floor.walls.map((wall) => {
                  const [x1, y1] = projectPoint(
                    wall.start,
                    preview.minX,
                    preview.maxZ,
                    preview.scale,
                    preview.padding,
                  )
                  const [x2, y2] = projectPoint(
                    wall.end,
                    preview.minX,
                    preview.maxZ,
                    preview.scale,
                    preview.padding,
                  )

                  return (
                    <line
                      key={wall.id}
                      className="floorplan-candidate-wall"
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                    />
                  )
                })}
              </svg>
            ) : null}

            <div className="floorplan-review-list">
              {pendingIssues.length === 0 ? (
                <div className="floorplan-review-done">
                  <strong>人工确认已完成</strong>
                  <span>
                    Candidate 可以进入后续 DesignState / Planner 链路。
                  </span>
                </div>
              ) : (
                pendingIssues.map((issue) => {
                  const roomId = issue.entityIds?.[0]
                  const isUnknownRoom =
                    issue.kind === 'unknown_room_type' && roomId
                  const isWallThickness =
                    issue.id === 'issue-wall-thickness-assumption'

                  return (
                    <article
                      className="floorplan-review-item"
                      key={issue.id}
                    >
                      <div>
                        <strong>{issue.kind}</strong>
                        <p>{issue.message}</p>
                        {issue.confidence !== undefined ? (
                          <code>
                            confidence={issue.confidence.toFixed(2)}
                          </code>
                        ) : null}
                      </div>

                      {isUnknownRoom && roomId ? (
                        <div className="floorplan-review-action">
                          <select
                            disabled={disabled}
                            value={
                              roomTypeDrafts[roomId] ?? 'other'
                            }
                            onChange={(event) =>
                              setRoomTypeDrafts((current) => ({
                                ...current,
                                [roomId]:
                                  event.target.value as RoomType,
                              }))
                            }
                          >
                            {roomTypeOptions.map((option) => (
                              <option
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() =>
                              confirmRoomType(issue.id, roomId)
                            }
                          >
                            应用
                          </button>
                        </div>
                      ) : isWallThickness ? (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            confirmWallThickness(
                              issue.id,
                              issue.entityIds ?? [],
                            )
                          }
                        >
                          确认当前墙厚
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() =>
                            resolveIssue(
                              issue.id,
                              '人工确认当前识别结果',
                            )
                          }
                        >
                          确认当前结果
                        </button>
                      )}
                    </article>
                  )
                })
              )}
            </div>

            <div className="floorplan-finalize-row">
              <span>
                {finalized
                  ? 'ACTIVE · 当前 Candidate 已进入 Real Room Workbench'
                  : canFinalizeSpatialReview(session)
                    ? '所有门禁已通过'
                    : '完成全部人工确认后才能 Finalize'}
              </span>
              <button
                type="button"
                disabled={
                  disabled ||
                  finalized ||
                  !canFinalizeSpatialReview(session)
                }
                onClick={finalize}
              >
                Finalize Candidate
              </button>
            </div>
          </>
        )}

        {error ? (
          <div className="floorplan-import-error">{error}</div>
        ) : null}
      </div>
    </section>
  )
}

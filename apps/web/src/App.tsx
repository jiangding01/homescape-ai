import { InMemoryCatalog, livingRoomCatalog } from '@homescape/catalog'
import {
  commitToTimeline,
  createInitialDesignState,
  createRevisionTimeline,
  redoTimeline,
  undoTimeline,
  type DesignOperation,
  type DesignRevisionDraft,
} from '@homescape/domain'
import { RuleBasedPlanner, type PlannerResult } from '@homescape/planner'
import { createRenderSnapshot } from '@homescape/renderer-contract'
import {
  buildRoomGraph,
  polygonCenter,
  sampleApartment,
  validateHomeSpatialModel,
  type Vec2,
} from '@homescape/spatial-model'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { BabylonViewport } from './BabylonViewport'
import { FloorPlanImportWorkbench } from './FloorPlanImportWorkbench'
import './floorplan-import.css'

type Health = {
  ok: boolean
  service: string
  version: string
}

type SpatialView = '3d' | '2d'

type AIInterpretationResponse = {
  status: 'ready' | 'needs_clarification' | 'unsupported' | 'no_change'
  message: string
  operations: DesignOperation[]
  decisions: {
    intent: { value: string; confidence: number }
    scope: { value: string; confidence: number }
    target: { value: string; confidence: number }
    category: { value: string; confidence: number }
    size: { value: string; confidence: number }
    color: { value: string; confidence: number }
    seats: { value: string; confidence: number }
    style: { value: string; confidence: number }
    preserveOthers: number
  }
  meta: {
    provider: string
    model: string
    latencyMs: number
    usage?: {
      inputTokens?: number
      outputTokens?: number
      cost?: number
    }
  }
}

type AIExecutionMeta = AIInterpretationResponse['meta']

type APIErrorResponse = {
  error?: {
    code?: string
    message?: string
  }
}

const initialDesignState = createInitialDesignState({
  projectId: 'project-sample-001',
  spatialModelId: sampleApartment.id,
})

function projectPoint(point: Vec2, minX: number, maxZ: number, scale: number) {
  return [(point[0] - minX) * scale, (maxZ - point[1]) * scale] as const
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [view, setView] = useState<SpatialView>('3d')
  const [timeline, setTimeline] = useState(() =>
    createRevisionTimeline(initialDesignState),
  )
  const [planning, setPlanning] = useState(false)
  const [interpreting, setInterpreting] = useState(false)
  const [command, setCommand] = useState(
    '为客厅布置现代原木风的沙发、茶几和绿植',
  )
  const [aiFeedback, setAiFeedback] =
    useState<AIInterpretationResponse | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [plannerFeedback, setPlannerFeedback] =
    useState<PlannerResult | null>(null)
  const revisionSequence = useRef(1)
  const aiRequestSequence = useRef(1)
  const catalog = useMemo(() => new InMemoryCatalog(livingRoomCatalog), [])
  const planner = useMemo(() => new RuleBasedPlanner(catalog), [catalog])

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.json())
      .then((data: Health) => setHealth(data))
      .catch(() => setHealth(null))

    return () => controller.abort()
  }, [])

  const validation = useMemo(() => validateHomeSpatialModel(sampleApartment), [])
  const renderSnapshot = useMemo(
    () => createRenderSnapshot(sampleApartment, timeline.state),
    [timeline.state],
  )
  const floor = sampleApartment.floors[0]

  if (!floor) {
    return <main className="shell">示例空间数据缺少楼层。</main>
  }

  const graph = buildRoomGraph(floor)
  const points = floor.rooms.flatMap((room) => room.boundary.points)
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const scale = 84
  const canvasWidth = (maxX - minX) * scale
  const canvasHeight = (maxZ - minZ) * scale
  const objects = Object.values(timeline.state.objects)
  const sofa = objects.find((object) => object.category === 'sofa')
  const layoutReady = objects.length > 0
  const busy = planning || interpreting

  const executePlan = async (
    request: string,
    operations: DesignOperation[],
    aiMeta?: AIExecutionMeta,
  ) => {
    if (planning) return

    setPlanning(true)

    try {
      const baseTimeline = timeline
      const result = await planner.plan({
        spatialModel: sampleApartment,
        state: baseTimeline.state,
        operations,
      })

      setPlannerFeedback(result)

      const hasBlockingViolation = result.violations.some(
        (violation) => violation.severity === 'error',
      )

      if (result.mutations.length === 0 || hasBlockingViolation) return

      const sequence = revisionSequence.current
      revisionSequence.current += 1
      const revisionId = 'revision-planner-' + sequence
      const draft: DesignRevisionDraft = {
        id: revisionId,
        projectId: baseTimeline.state.projectId,
        expectedParentRevisionId: baseTimeline.state.headRevisionId ?? null,
        request,
        operations,
        mutations: result.mutations,
        provenance: {
          actor: operations.some((operation) => operation.source === 'ai')
            ? 'ai'
            : 'system',
          plannerVersion: 'rule-based-v0.1',
          schemaVersion: '0.1.0',
          ...(aiMeta
            ? {
                provider: aiMeta.provider,
                model: aiMeta.model,
              }
            : {}),
        },
        createdAt: new Date().toISOString(),
      }

      setTimeline((current) => {
        const currentHead = current.state.headRevisionId ?? null
        const expectedHead = baseTimeline.state.headRevisionId ?? null

        if (currentHead !== expectedHead) return current

        return commitToTimeline(current, draft).timeline
      })
    } finally {
      setPlanning(false)
    }
  }

  const generateLivingRoom = () => {
    const sequence = revisionSequence.current
    const roomScope = { type: 'room', roomId: 'room-living' } as const

    void executePlan('为客餐厅生成现代原木风基础软装布局', [
      {
        id: 'operation-layout-' + sequence + '-sofa',
        type: 'add_object',
        source: 'user',
        scope: roomScope,
        category: 'sofa',
        requirements: {
          style: 'warm-modern',
          minSeats: 3,
          maxWidth: 2.3,
        },
      },
      {
        id: 'operation-layout-' + sequence + '-table',
        type: 'add_object',
        source: 'user',
        scope: roomScope,
        category: 'coffee_table',
        requirements: {
          style: 'warm-modern',
          maxWidth: 1.3,
        },
      },
      {
        id: 'operation-layout-' + sequence + '-plant',
        type: 'add_object',
        source: 'user',
        scope: roomScope,
        category: 'plant',
        requirements: {
          styleTags: ['warm-modern', 'greenery'],
        },
      },
    ])
  }

  const replaceWithCompactSofa = () => {
    if (!sofa) return

    const sequence = revisionSequence.current

    void executePlan('沙发小一点，换成浅灰色三人位，其他家具保持不变', [
      {
        id: 'operation-replace-' + sequence + '-sofa',
        type: 'replace_object',
        source: 'user',
        scope: {
          type: 'object',
          objectId: sofa.id,
        },
        objectId: sofa.id,
        requirements: {
          maxWidth: 1.95,
          minSeats: 3,
          colorFamily: 'light-gray',
          style: 'warm-modern',
        },
      },
      ...objects
        .filter((object) => object.id !== sofa.id)
        .map(
          (object): DesignOperation => ({
            id: 'operation-preserve-' + sequence + '-' + object.id,
            type: 'preserve',
            source: 'user',
            scope: {
              type: 'object',
              objectId: object.id,
            },
            targetId: object.id,
          }),
        ),
    ])
  }

  const lockSofa = () => {
    if (!sofa) return

    const sequence = revisionSequence.current
    const locked = Boolean(timeline.state.locks[sofa.id])
    const operation: DesignOperation = locked
      ? {
          id: 'operation-lock-' + sequence + '-sofa',
          type: 'unlock',
          source: 'user',
          scope: {
            type: 'object',
            objectId: sofa.id,
          },
          targetId: sofa.id,
        }
      : {
          id: 'operation-lock-' + sequence + '-sofa',
          type: 'lock',
          source: 'user',
          scope: {
            type: 'object',
            objectId: sofa.id,
          },
          targetId: sofa.id,
        }

    void executePlan(
      locked ? '解除沙发锁定' : '锁定沙发，后续自动设计不要修改',
      [operation],
    )
  }

  const submitNaturalLanguageCommand = async (event: FormEvent) => {
    event.preventDefault()

    const normalizedCommand = command.trim()
    if (!normalizedCommand || busy) return

    setInterpreting(true)
    setAiError(null)

    try {
      const requestId = 'design-command-' + aiRequestSequence.current
      aiRequestSequence.current += 1

      const contextObjects = objects.map((object) => {
        const catalogName = object.metadata?.catalogName
        const currentColor = object.metadata?.colorFamily

        return {
          id: object.id,
          category: object.category,
          label: typeof catalogName === 'string' ? catalogName : object.category,
          locked: Boolean(timeline.state.locks[object.id]),
          ...(object.roomId ? { roomId: object.roomId } : {}),
          ...(object.zoneId ? { zoneId: object.zoneId } : {}),
          ...(object.dimensions ? { width: object.dimensions[0] } : {}),
          ...(typeof currentColor === 'string'
            ? { colorFamily: currentColor }
            : {}),
        }
      })

      const response = await fetch('/api/design/interpret', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          command: normalizedCommand,
          context: {
            projectId: timeline.state.projectId,
            activeRoom: {
              id: 'room-living',
              name: '客餐厅',
            },
            objects: contextObjects,
          },
        }),
      })

      const payload: unknown = await response.json()

      if (!response.ok) {
        const apiError = payload as APIErrorResponse
        throw new Error(
          apiError.error?.message ?? '自然语言设计接口请求失败',
        )
      }

      const interpretation = payload as AIInterpretationResponse
      setAiFeedback(interpretation)

      if (
        interpretation.status === 'ready' &&
        interpretation.operations.length > 0
      ) {
        await executePlan(
          normalizedCommand,
          interpretation.operations,
          interpretation.meta,
        )
      }
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : '自然语言设计指令解析失败',
      )
    } finally {
      setInterpreting(false)
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">HOMESCAPE AI · REAL ROOM PIPELINE</div>
        <h1>从真实户型开始，再用一句话持续修改这个家。</h1>
        <p>
          PR #7 增加真实户型 Candidate + Human Review 链路，并保留既有自然语言设计能力。
          户型解析结果和 AI 决策都不能直接成为真值，必须经过校验、确认与确定性执行。
        </p>
        <div className="status-row">
          <span className={health?.ok ? 'dot dot-online' : 'dot'} />
          <span>{health?.ok ? 'API 已连接' : 'API 未连接'}</span>
          {health ? <code>{health.version}</code> : null}
        </div>
      </header>

      <section className="flow" aria-label="Core flow">
        <span>Real Floor Plan</span><b>→</b><span>HomeSpatialModel</span><b>→</b>
        <span>Natural Language</span><b>→</b><span>Planner</span><b>→</b>
        <span>Revision</span><b>→</b><span>Realtime 3D</span>
      </section>

      <FloorPlanImportWorkbench />

      <section className="command-section">
        <div>
          <div className="eyebrow">CONVERSATIONAL DESIGN · SERVER-SIDE AI</div>
          <h2>告诉 HomeScape 你想怎么改</h2>
          <p>
            API Key 只保留在服务端。当前 Decision Pack 会并行判断意图、作用域、目标家具、尺寸、颜色、
            座位数、风格和 Preserve 语义，再由确定性代码生成操作。
          </p>
        </div>

        <div className="command-workbench">
          <form className="command-composer" onSubmit={submitNaturalLanguageCommand}>
            <textarea
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              rows={3}
              placeholder="例如：沙发小一点，换成浅灰色三人位，其他地方别动"
            />
            <button type="submit" disabled={busy || !command.trim()}>
              {interpreting
                ? 'JEV 正在判断…'
                : planning
                  ? 'Planner 正在执行…'
                  : '执行自然语言修改'}
            </button>
          </form>

          <div className="command-samples">
            <button
              type="button"
              onClick={() =>
                setCommand('为客厅布置现代原木风的沙发、茶几和绿植')
              }
            >
              第一版布局
            </button>
            <button
              type="button"
              onClick={() =>
                setCommand('沙发小一点，换成浅灰色三人位，其他地方别动')
              }
            >
              局部替换
            </button>
            <button
              type="button"
              onClick={() => setCommand('把沙发锁定，后面都不要改它')}
            >
              Lock
            </button>
          </div>

          {aiError ? (
            <div className="ai-feedback ai-feedback-error">
              <strong>AI Runtime</strong>
              <span>{aiError}</span>
            </div>
          ) : null}

          {aiFeedback ? (
            <div className="ai-feedback">
              <div className="ai-feedback-head">
                <strong>{aiFeedback.status}</strong>
                <span>
                  {aiFeedback.meta.provider} · {aiFeedback.meta.model} ·{' '}
                  {aiFeedback.meta.latencyMs}ms
                </span>
              </div>
              <span>{aiFeedback.message}</span>
              <div className="decision-chips">
                <code>
                  intent={aiFeedback.decisions.intent.value} (
                  {aiFeedback.decisions.intent.confidence.toFixed(2)})
                </code>
                <code>
                  target={aiFeedback.decisions.target.value} (
                  {aiFeedback.decisions.target.confidence.toFixed(2)})
                </code>
                <code>
                  preserve={aiFeedback.decisions.preserveOthers.toFixed(2)}
                </code>
                <code>ops={aiFeedback.operations.length}</code>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="runtime-section">
        <div className="runtime-toolbar">
          <div>
            <div className="eyebrow">
              VERTICAL SLICE · {livingRoomCatalog.length} CURATED SKU
            </div>
            <h2>{sampleApartment.name}</h2>
          </div>

          <div className="segmented-control" role="group" aria-label="空间视图">
            <button
              className={view === '3d' ? 'active' : ''}
              type="button"
              onClick={() => setView('3d')}
            >
              3D Runtime
            </button>
            <button
              className={view === '2d' ? 'active' : ''}
              type="button"
              onClick={() => setView('2d')}
            >
              2D Debug
            </button>
          </div>
        </div>

        <div className="runtime-grid">
          <aside className="runtime-info">
            <p>
              AI 只决定“想改什么”，不生成最终坐标。所有 AI Operation 继续走同一套 Catalog、
              Geometry Constraint、Revision 与 Undo / Redo。
            </p>

            <dl className="metrics">
              <div><dt>Catalog SKU</dt><dd>{livingRoomCatalog.length}</dd></div>
              <div><dt>Design Objects</dt><dd>{objects.length}</dd></div>
              <div><dt>State Version</dt><dd>{timeline.state.version}</dd></div>
              <div><dt>Revision</dt><dd>{timeline.past.length}</dd></div>
              <div><dt>Room Graph</dt><dd>{graph.edges.length}</dd></div>
              <div>
                <dt>空间校验</dt>
                <dd className={validation.valid ? 'metric-ok' : 'metric-error'}>
                  {validation.valid ? 'VALID' : 'INVALID'}
                </dd>
              </div>
            </dl>

            <div className="revision-controls">
              <strong>Deterministic Controls</strong>
              <button
                type="button"
                disabled={busy || layoutReady}
                onClick={generateLivingRoom}
              >
                自动布置客厅
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  !sofa ||
                  Boolean(sofa && timeline.state.locks[sofa.id])
                }
                onClick={replaceWithCompactSofa}
              >
                沙发小一点 + 浅灰色
              </button>
              <button
                type="button"
                disabled={busy || !sofa}
                onClick={lockSofa}
              >
                {sofa && timeline.state.locks[sofa.id]
                  ? '解除沙发锁定'
                  : '锁定沙发'}
              </button>
              <div className="revision-control-row">
                <button
                  type="button"
                  disabled={busy || timeline.past.length === 0}
                  onClick={() =>
                    setTimeline((current) => undoTimeline(current).timeline)
                  }
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={busy || timeline.future.length === 0}
                  onClick={() =>
                    setTimeline((current) => redoTimeline(current).timeline)
                  }
                >
                  Redo
                </button>
              </div>
            </div>

            {plannerFeedback ? (
              <div className="planner-feedback">
                <strong>Last Plan</strong>
                <span>候选：{plannerFeedback.diagnostics.candidateCount}</span>
                <span>
                  淘汰：{plannerFeedback.diagnostics.rejectedCandidateCount}
                </span>
                <span>通过决策：{plannerFeedback.decisions.length}</span>
                <span>约束问题：{plannerFeedback.violations.length}</span>
                <span>耗时：{plannerFeedback.diagnostics.elapsedMs}ms</span>
                {plannerFeedback.violations[0] ? (
                  <code>{plannerFeedback.violations[0].message}</code>
                ) : null}
              </div>
            ) : null}
          </aside>

          <div className="viewport-shell">
            {view === '3d' ? (
              <BabylonViewport snapshot={renderSnapshot} />
            ) : (
              <svg
                className="plan-canvas"
                viewBox={'0 0 ' + canvasWidth + ' ' + canvasHeight}
                role="img"
                aria-label="HomeSpatialModel 二维调试视图"
              >
                {floor.rooms.map((room) => {
                  const center = polygonCenter(room.boundary)
                  const [labelX, labelY] = projectPoint(center, minX, maxZ, scale)
                  const polygonPoints = room.boundary.points
                    .map((point) =>
                      projectPoint(point, minX, maxZ, scale).join(','),
                    )
                    .join(' ')

                  return (
                    <g key={room.id}>
                      <polygon className="room-shape" points={polygonPoints} />
                      <text className="room-label" x={labelX} y={labelY}>
                        {room.name}
                      </text>
                    </g>
                  )
                })}

                {floor.walls.map((wall) => {
                  const [x1, y1] = projectPoint(wall.start, minX, maxZ, scale)
                  const [x2, y2] = projectPoint(wall.end, minX, maxZ, scale)

                  return (
                    <line
                      className="wall-line"
                      key={wall.id}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                    />
                  )
                })}
              </svg>
            )}

            <div className="viewport-caption">
              <span>
                {view === '3d'
                  ? 'AI → OPERATIONS → CONSTRAINTS → REAL SCALE'
                  : 'HomeSpatialModel Debug View'}
              </span>
              <span>HEAD · {timeline.state.headRevisionId ?? 'INITIAL'}</span>
              <span>V{timeline.state.version}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="runtime-principles">
        <article>
          <span>01</span>
          <h3>AI Proposes</h3>
          <p>JEV 只产生 typed decisions，确定性解释器组合成受限 DesignOperation。</p>
        </article>
        <article>
          <span>02</span>
          <h3>Confidence Gates</h3>
          <p>Intent 或 Target 置信度不足时不执行，直接要求进一步澄清。</p>
        </article>
        <article>
          <span>03</span>
          <h3>Planner Executes</h3>
          <p>空间、商品、碰撞、Lock 和 Revision 仍由确定性系统拥有最终决定权。</p>
        </article>
      </section>

      <footer>PR #7 · Real Floor Plan Import · 下一步：Finalized Model → Real Room Workbench</footer>
    </main>
  )
}

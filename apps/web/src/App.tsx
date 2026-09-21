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
import { useEffect, useMemo, useRef, useState } from 'react'
import { BabylonViewport } from './BabylonViewport'

type Health = {
  ok: boolean
  service: string
  version: string
}

type SpatialView = '3d' | '2d'

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
  const [plannerFeedback, setPlannerFeedback] = useState<PlannerResult | null>(null)
  const revisionSequence = useRef(1)
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

  const executePlan = async (request: string, operations: DesignOperation[]) => {
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
          actor: 'system',
          plannerVersion: 'rule-based-v0.1',
          schemaVersion: '0.1.0',
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

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">HOMESCAPE AI · CATALOG + RULE-BASED PLANNER</div>
        <h1>设计意图开始变成有尺寸、能落地的家具布局。</h1>
        <p>
          PR #5 引入有限 Catalog 与首个确定性 Planner：先过滤真实尺寸商品，再生成墙边/中心/自由 Anchor，
          经过房间边界、家具碰撞、柱体和门洞净空校验后，才写入 Revision。
        </p>
        <div className="status-row">
          <span className={health?.ok ? 'dot dot-online' : 'dot'} />
          <span>{health?.ok ? 'API 已连接' : 'API 未连接'}</span>
          {health ? <code>{health.version}</code> : null}
        </div>
      </header>

      <section className="flow" aria-label="Core flow">
        <span>DesignOperation</span><b>→</b><span>Catalog Filter</span><b>→</b>
        <span>Anchor Candidates</span><b>→</b><span>Hard Constraints</span><b>→</b>
        <span>Scoring</span><b>→</b><span>Resolved Mutation</span>
      </section>

      <section className="runtime-section">
        <div className="runtime-toolbar">
          <div>
            <div className="eyebrow">PLANNER DEMO · {livingRoomCatalog.length} CURATED SKU</div>
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
              当前使用精选 Mock SKU，但 Schema 已按生产 Catalog 设计。3D 中的占位盒严格使用商品真实尺寸，
              Planner 不允许对象穿墙、重叠柱体、堵住门洞或与已有家具碰撞。
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
              <strong>Rule-based Planner</strong>
              <button
                type="button"
                disabled={planning || layoutReady}
                onClick={generateLivingRoom}
              >
                {planning ? '正在规划…' : '自动布置客厅'}
              </button>
              <button
                type="button"
                disabled={planning || !sofa || Boolean(sofa && timeline.state.locks[sofa.id])}
                onClick={replaceWithCompactSofa}
              >
                沙发小一点 + 浅灰色
              </button>
              <button
                type="button"
                disabled={planning || !sofa}
                onClick={lockSofa}
              >
                {sofa && timeline.state.locks[sofa.id] ? '解除沙发锁定' : '锁定沙发'}
              </button>
              <div className="revision-control-row">
                <button
                  type="button"
                  disabled={planning || timeline.past.length === 0}
                  onClick={() => setTimeline((current) => undoTimeline(current).timeline)}
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={planning || timeline.future.length === 0}
                  onClick={() => setTimeline((current) => redoTimeline(current).timeline)}
                >
                  Redo
                </button>
              </div>
            </div>

            {plannerFeedback ? (
              <div className="planner-feedback">
                <strong>Last Plan</strong>
                <span>候选：{plannerFeedback.diagnostics.candidateCount}</span>
                <span>淘汰：{plannerFeedback.diagnostics.rejectedCandidateCount}</span>
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
                    .map((point) => projectPoint(point, minX, maxZ, scale).join(','))
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
              <span>{view === '3d' ? 'CATALOG DIMENSIONS · REAL SCALE' : 'HomeSpatialModel Debug View'}</span>
              <span>HEAD · {timeline.state.headRevisionId ?? 'INITIAL'}</span>
              <span>V{timeline.state.version}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="runtime-principles">
        <article>
          <span>01</span>
          <h3>Hard Filter First</h3>
          <p>品类、宽度、深度、座位数、价格和颜色先做结构化过滤，不让 Embedding 取代硬约束。</p>
        </article>
        <article>
          <span>02</span>
          <h3>Geometry Before Taste</h3>
          <p>候选先通过房间边界、家具碰撞、结构柱和门洞净空，再进行软评分。</p>
        </article>
        <article>
          <span>03</span>
          <h3>Planner Writes Mutations</h3>
          <p>Planner 不直接操作 Babylon Scene，而是输出可审计的 ResolvedDesignMutation。</p>
        </article>
      </section>

      <footer>PR #5 · Catalog + Rule-based Planner · 下一步：AI Runtime / JEV Decision</footer>
    </main>
  )
}

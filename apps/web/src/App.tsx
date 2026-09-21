import {
  commitToTimeline,
  createInitialDesignState,
  createRevisionTimeline,
  redoTimeline,
  undoTimeline,
  type DesignOperation,
  type DesignRevisionDraft,
  type ResolvedDesignMutation,
} from '@homescape/domain'
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

const demoObjectId = 'object-demo-sofa'

const initialDesignState = createInitialDesignState({
  projectId: 'project-sample-001',
  spatialModelId: sampleApartment.id,
  objects: [
    {
      id: demoObjectId,
      assetId: 'fixture-sofa',
      category: 'sofa',
      roomId: 'room-living',
      transform: {
        position: [2.1, 0, 2.7] as const,
        yaw: 0,
      },
      dimensions: [2.2, 0.85, 0.95] as const,
      provenance: {
        source: 'system',
      },
    },
  ],
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
  const revisionSequence = useRef(1)

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
  const sofaLocked = Boolean(timeline.state.locks[demoObjectId])

  const commitDemoRevision = (
    request: string,
    operation: DesignOperation,
    mutation: ResolvedDesignMutation,
  ) => {
    setTimeline((current) => {
      const revisionId = 'revision-demo-' + revisionSequence.current
      revisionSequence.current += 1

      const draft: DesignRevisionDraft = {
        id: revisionId,
        projectId: current.state.projectId,
        expectedParentRevisionId: current.state.headRevisionId ?? null,
        request,
        operations: [operation],
        mutations: [mutation],
        provenance: {
          actor: 'user',
          schemaVersion: '0.1.0',
        },
        createdAt: new Date().toISOString(),
      }

      return commitToTimeline(current, draft).timeline
    })
  }

  const moveDemoSofa = () => {
    const sofa = timeline.state.objects[demoObjectId]

    if (!sofa || sofaLocked) return

    const position = [
      sofa.transform.position[0] + 0.4,
      sofa.transform.position[1],
      sofa.transform.position[2],
    ] as const
    const operationId = 'operation-demo-' + revisionSequence.current

    commitDemoRevision(
      '将客厅沙发向右移动 0.4 米',
      {
        id: operationId,
        type: 'move_object',
        source: 'user',
        scope: {
          type: 'object',
          objectId: demoObjectId,
        },
        objectId: demoObjectId,
        position,
      },
      {
        type: 'move_object',
        objectId: demoObjectId,
        position,
      },
    )
  }

  const rotateDemoSofa = () => {
    const sofa = timeline.state.objects[demoObjectId]

    if (!sofa || sofaLocked) return

    const yaw = sofa.transform.yaw + Math.PI / 12
    const operationId = 'operation-demo-' + revisionSequence.current

    commitDemoRevision(
      '将客厅沙发旋转 15 度',
      {
        id: operationId,
        type: 'rotate_object',
        source: 'user',
        scope: {
          type: 'object',
          objectId: demoObjectId,
        },
        objectId: demoObjectId,
        yaw,
      },
      {
        type: 'rotate_object',
        objectId: demoObjectId,
        yaw,
      },
    )
  }

  const toggleDemoLock = () => {
    const locked = Boolean(timeline.state.locks[demoObjectId])
    const operationId = 'operation-demo-' + revisionSequence.current
    const operation: DesignOperation = locked
      ? {
          id: operationId,
          type: 'unlock',
          source: 'user',
          scope: {
            type: 'object',
            objectId: demoObjectId,
          },
          targetId: demoObjectId,
        }
      : {
          id: operationId,
          type: 'lock',
          source: 'user',
          scope: {
            type: 'object',
            objectId: demoObjectId,
          },
          targetId: demoObjectId,
        }

    commitDemoRevision(
      locked ? '解除沙发锁定' : '锁定沙发，不允许后续自动修改',
      operation,
      {
        type: 'set_lock',
        targetId: demoObjectId,
        locked: !locked,
        lockedBy: 'user',
      },
    )
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">HOMESCAPE AI · DESIGN STATE + REVISION</div>
        <h1>每一次修改，都应该能解释、撤销和重放。</h1>
        <p>
          PR #4 建立权威 Design State 与 Revision Engine。AI、Planner 和人工操作最终都落成可执行 Mutation；
          Renderer 只读取最新快照，Undo / Redo 不再依赖组件状态技巧。
        </p>
        <div className="status-row">
          <span className={health?.ok ? 'dot dot-online' : 'dot'} />
          <span>{health?.ok ? 'API 已连接' : 'API 未连接'}</span>
          {health ? <code>{health.version}</code> : null}
        </div>
      </header>

      <section className="flow" aria-label="Core flow">
        <span>DesignOperation</span><b>→</b><span>Planner / Domain</span><b>→</b>
        <span>Resolved Mutation</span><b>→</b><span>Revision</span><b>→</b>
        <span>Design State</span><b>→</b><span>RenderSnapshot</span>
      </section>

      <section className="runtime-section">
        <div className="runtime-toolbar">
          <div>
            <div className="eyebrow">REVISION DEMO · REAL-SCALE FIXTURE</div>
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
              示例沙发使用占位几何，但位置、旋转、锁定和历史都来自 Design State。每次操作都会产生 Revision，
              再重新生成 RenderSnapshot。
            </p>

            <dl className="metrics">
              <div><dt>State Version</dt><dd>{timeline.state.version}</dd></div>
              <div><dt>历史 Revision</dt><dd>{timeline.past.length}</dd></div>
              <div><dt>可 Redo</dt><dd>{timeline.future.length}</dd></div>
              <div><dt>沙发锁定</dt><dd>{sofaLocked ? 'LOCKED' : 'OPEN'}</dd></div>
              <div><dt>空间连接</dt><dd>{graph.edges.length}</dd></div>
              <div>
                <dt>模型校验</dt>
                <dd className={validation.valid ? 'metric-ok' : 'metric-error'}>
                  {validation.valid ? 'VALID' : 'INVALID'}
                </dd>
              </div>
            </dl>

            <div className="revision-controls">
              <strong>Revision Engine</strong>
              <button type="button" disabled={sofaLocked} onClick={moveDemoSofa}>
                沙发右移 0.4m
              </button>
              <button type="button" disabled={sofaLocked} onClick={rotateDemoSofa}>
                沙发旋转 15°
              </button>
              <button type="button" onClick={toggleDemoLock}>
                {sofaLocked ? '解除沙发锁定' : '锁定沙发'}
              </button>
              <div className="revision-control-row">
                <button
                  type="button"
                  disabled={timeline.past.length === 0}
                  onClick={() =>
                    setTimeline((current) => undoTimeline(current).timeline)
                  }
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={timeline.future.length === 0}
                  onClick={() =>
                    setTimeline((current) => redoTimeline(current).timeline)
                  }
                >
                  Redo
                </button>
              </div>
              <code>{timeline.state.headRevisionId ?? 'initial-state'}</code>
            </div>
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
              <span>{view === '3d' ? 'Drag · Orbit / Wheel · Zoom' : 'HomeSpatialModel Debug View'}</span>
              <span>HEAD · {timeline.state.headRevisionId ?? 'INITIAL'}</span>
              <span>V{timeline.state.version}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="runtime-principles">
        <article>
          <span>01</span>
          <h3>Authoritative State</h3>
          <p>设计对象、材质、风格和 Lock 都由 Domain State 持有。</p>
        </article>
        <article>
          <span>02</span>
          <h3>Invertible Revision</h3>
          <p>提交 Revision 时生成逆向 Mutation，Undo / Redo 使用同一执行器。</p>
        </article>
        <article>
          <span>03</span>
          <h3>Optimistic Concurrency</h3>
          <p>expectedParentRevisionId 防止基于旧版本覆盖新的设计结果。</p>
        </article>
      </section>

      <footer>PR #4 · Design State + Revision Engine · 下一步：Catalog + Planner</footer>
    </main>
  )
}

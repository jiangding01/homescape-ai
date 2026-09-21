import {
  buildRoomGraph,
  polygonCenter,
  sampleApartment,
  validateHomeSpatialModel,
  type Vec2,
} from '@homescape/spatial-model'
import { useEffect, useMemo, useState } from 'react'
import { BabylonViewport } from './BabylonViewport'

type Health = {
  ok: boolean
  service: string
  version: string
}

type SpatialView = '3d' | '2d'

function projectPoint(point: Vec2, minX: number, maxZ: number, scale: number) {
  return [(point[0] - minX) * scale, (maxZ - point[1]) * scale] as const
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [view, setView] = useState<SpatialView>('3d')

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.json())
      .then((data: Health) => setHealth(data))
      .catch(() => setHealth(null))

    return () => controller.abort()
  }, [])

  const validation = useMemo(() => validateHomeSpatialModel(sampleApartment), [])
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

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">HOMESCAPE AI · PARAMETRIC ROOM RUNTIME</div>
        <h1>同一份空间真值，开始长成可以进入的家。</h1>
        <p>
          PR #3 把 HomeSpatialModel 转换为参数化 3D：房间地面、墙体、门窗开口、梁柱与设备锚点全部来自领域模型，而不是在渲染代码中重新维护一份场景数据。
        </p>
        <div className="status-row">
          <span className={health?.ok ? 'dot dot-online' : 'dot'} />
          <span>{health?.ok ? 'API 已连接' : 'API 未连接'}</span>
          {health ? <code>{health.version}</code> : null}
        </div>
      </header>

      <section className="flow" aria-label="Core flow">
        <span>HomeSpatialModel</span><b>→</b><span>RenderSnapshot</span><b>→</b>
        <span>Renderer Adapter</span><b>→</b><span>Babylon.js</span><b>→</b>
        <span>Interactive 3D</span>
      </section>

      <section className="runtime-section">
        <div className="runtime-toolbar">
          <div>
            <div className="eyebrow">REAL-SCALE FIXTURE · 90.72㎡</div>
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
              现在 2D Debug View 与 3D Runtime 消费完全相同的 HomeSpatialModel。渲染器只接收
              RenderSnapshot，不直接解释 DesignRevision，避免 3D 引擎成为第二份业务状态。
            </p>

            <dl className="metrics">
              <div><dt>房间</dt><dd>{floor.rooms.length}</dd></div>
              <div><dt>墙体</dt><dd>{floor.walls.length}</dd></div>
              <div><dt>门窗 / 开口</dt><dd>{floor.openings.length}</dd></div>
              <div><dt>空间连接</dt><dd>{graph.edges.length}</dd></div>
              <div><dt>结构构件</dt><dd>{floor.structuralElements.length}</dd></div>
              <div>
                <dt>模型校验</dt>
                <dd className={validation.valid ? 'metric-ok' : 'metric-error'}>
                  {validation.valid ? 'VALID' : 'INVALID'}
                </dd>
              </div>
            </dl>

            <div className="runtime-note">
              <strong>当前 Runtime</strong>
              <span>Babylon.js 9 · WebGL</span>
              <span>ArcRotate Camera · 参数化几何</span>
              <span>引擎最终锁定仍受 Whole-home Benchmark 门禁约束</span>
            </div>
          </aside>

          <div className="viewport-shell">
            {view === '3d' ? (
              <BabylonViewport />
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
              <span>{sampleApartment.coordinateSystem}</span>
              <span>{sampleApartment.unit}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="runtime-principles">
        <article>
          <span>01</span>
          <h3>Snapshot Driven</h3>
          <p>Renderer 只消费解析后的快照，不拥有 Design State。</p>
        </article>
        <article>
          <span>02</span>
          <h3>Parametric Geometry</h3>
          <p>墙体与门窗开口根据真实尺寸动态生成，支持异形房间地面。</p>
        </article>
        <article>
          <span>03</span>
          <h3>Replaceable Runtime</h3>
          <p>Babylon.js 是首个 Adapter，最终选择仍由整屋性能 Benchmark 决定。</p>
        </article>
      </section>

      <footer>PR #3 · Parametric Room Renderer · 下一步：Design State + Revision Engine</footer>
    </main>
  )
}

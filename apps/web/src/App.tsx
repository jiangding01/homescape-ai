import {
  buildRoomGraph,
  polygonCenter,
  sampleApartment,
  validateHomeSpatialModel,
  type Vec2,
} from '@homescape/spatial-model'
import { useEffect, useMemo, useState } from 'react'

type Health = {
  ok: boolean
  service: string
  version: string
}

const pillars = [
  ['Spatial Model', '真实户型与 Room / Zone / Object 统一空间模型'],
  ['Design Operations', 'AI 与 GUI 都通过可验证的领域操作修改方案'],
  ['AI Capability Runtime', 'JEV、LLM、VLM 等 Provider 可插拔、可路由'],
  ['Planner', '规则、锚点、碰撞与约束决定真实空间执行结果'],
  ['Revision', '所有修改可撤销、重放、比较和审计'],
  ['Renderer Adapter', 'Domain 与 Babylon.js / Three.js 完全解耦'],
] as const

function projectPoint(point: Vec2, minX: number, maxZ: number, scale: number) {
  return [(point[0] - minX) * scale, (maxZ - point[1]) * scale] as const
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)

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
        <div className="eyebrow">HOMESCAPE AI · SPATIAL MODEL CORE</div>
        <h1>先把真实的家，变成可计算的空间。</h1>
        <p>
          PR #2 建立住宅空间真值：统一几何、房间拓扑、结构构件、设备锚点、来源置信度和导入协议，为后续户型识别、Planner 与 3D Runtime 提供稳定边界。
        </p>
        <div className="status-row">
          <span className={health?.ok ? 'dot dot-online' : 'dot'} />
          <span>{health?.ok ? 'API 已连接' : 'API 未连接'}</span>
          {health ? <code>{health.version}</code> : null}
        </div>
      </header>

      <section className="flow" aria-label="Core flow">
        <span>户型来源</span><b>→</b><span>Importer</span><b>→</b>
        <span>HomeSpatialModel</span><b>→</b><span>Validation</span><b>→</b>
        <span>Planner / Renderer</span>
      </section>

      <section className="spatial-section">
        <div className="spatial-copy">
          <div className="eyebrow">REAL-SCALE FIXTURE · 90.72㎡</div>
          <h2>{sampleApartment.name}</h2>
          <p>
            这不是渲染场景，而是与引擎无关的住宅空间数据。所有坐标使用 meter、right-handed、Y-up，
            后续 Babylon.js 或 Three.js 只能通过 Adapter 消费它。
          </p>

          <dl className="metrics">
            <div><dt>房间</dt><dd>{floor.rooms.length}</dd></div>
            <div><dt>功能 Zone</dt><dd>{floor.rooms.reduce((sum, room) => sum + room.zones.length, 0)}</dd></div>
            <div><dt>墙体</dt><dd>{floor.walls.length}</dd></div>
            <div><dt>门窗 / 开口</dt><dd>{floor.openings.length}</dd></div>
            <div><dt>空间连接</dt><dd>{graph.edges.length}</dd></div>
            <div>
              <dt>模型校验</dt>
              <dd className={validation.valid ? 'metric-ok' : 'metric-error'}>
                {validation.valid ? 'VALID' : 'INVALID'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="plan-shell">
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

              return <line className="wall-line" key={wall.id} x1={x1} y1={y1} x2={x2} y2={y2} />
            })}
          </svg>
          <div className="plan-caption">
            <span>2D Debug View</span>
            <span>{sampleApartment.coordinateSystem}</span>
            <span>{sampleApartment.unit}</span>
          </div>
        </div>
      </section>

      <section className="grid">
        {pillars.map(([title, description]) => (
          <article className="card" key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <footer>PR #2 · HomeSpatialModel Core · 下一步：参数化 Room Renderer</footer>
    </main>
  )
}

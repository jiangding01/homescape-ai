import { useEffect, useState } from 'react'

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

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">HOMESCAPE AI · FOUNDATION</div>
        <h1>让业主说一句话，真实的家就开始变化。</h1>
        <p>
          从真实户型出发，把自然语言转成可验证的设计操作，再由空间规划与约束系统生成可实时预览的可编辑方案。
        </p>
        <div className="status-row">
          <span className={health?.ok ? 'dot dot-online' : 'dot'} />
          <span>{health?.ok ? 'API 已连接' : 'API 未连接'}</span>
          {health ? <code>{health.version}</code> : null}
        </div>
      </header>

      <section className="flow" aria-label="Core flow">
        <span>真实户型</span><b>→</b><span>Design Intent</span><b>→</b>
        <span>DesignOperation</span><b>→</b><span>Planner</span><b>→</b>
        <span>Realtime 3D</span>
      </section>

      <section className="grid">
        {pillars.map(([title, description]) => (
          <article className="card" key={title}>
            <h2>{title}</h2>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <footer>P0 Foundation · 下一步：Floor Plan → HomeSpatialModel → Real Room Vertical Slice</footer>
    </main>
  )
}

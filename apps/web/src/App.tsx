import { livingRoomCatalog } from '@homescape/catalog'
import { MAX_COMMAND_LENGTH } from '@homescape/contracts'
import { createRenderSnapshot } from '@homescape/renderer-contract'
import {
  buildRoomGraph,
  polygonCenter,
  sampleApartment,
  validateHomeSpatialModel,
  type Vec2,
} from '@homescape/spatial-model'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BabylonViewport } from './BabylonViewport'
import { FloorPlanImportWorkbench } from './FloorPlanImportWorkbench'
import { selectPrimaryDesignRoom } from './store/operations'
import { useWorkspace } from './store/use-workspace'
import { getWorkspaceStore } from './store/workspace-store'
import './floorplan-import.css'

type Health = {
  ok: boolean
  service: string
  version: string
}

type SpatialView = '3d' | '2d'

/**
 * 平面视图按从 +Y 俯视绘制：屏幕右为 +X、屏幕下为 +Z（与 3D 俯视、导入原图方向一致），
 * 因此 z 直接映射为屏幕 y，不做翻转。
 */
function projectPoint(point: Vec2, minX: number, minZ: number, scale: number) {
  return [(point[0] - minX) * scale, (point[1] - minZ) * scale] as const
}

function defaultCommandFor(roomName: string) {
  return '为' + roomName + '布置现代原木风的沙发、茶几和绿植'
}

export function App() {
  // 领域状态与编排都在 workspace store；组件只订阅与派发，UI 局部状态（输入框、视图）留在这里。
  const status = useWorkspace((state) => state.status)
  const loadError = useWorkspace((state) => state.loadError)
  const project = useWorkspace((state) => state.project)
  const planning = useWorkspace((state) => state.planning)
  const interpreting = useWorkspace((state) => state.interpreting)
  const switching = useWorkspace((state) => state.switching)
  const revisionError = useWorkspace((state) => state.revisionError)
  const notice = useWorkspace((state) => state.notice)
  const plannerFeedback = useWorkspace((state) => state.plannerFeedback)
  const aiFeedback = useWorkspace((state) => state.aiFeedback)
  const aiError = useWorkspace((state) => state.aiError)
  const pendingProposal = useWorkspace((state) => state.pendingProposal)
  const actions = getWorkspaceStore().getState()

  const [health, setHealth] = useState<Health | null>(null)
  const [view, setView] = useState<SpatialView>('3d')
  const [command, setCommand] = useState(defaultCommandFor('客厅'))

  const activeSpatialModel = project?.spatialModel.model
  const spatialModelVersionId = project?.spatialModel.id
  const designState = project?.state
  const renderAssetResolver = useMemo(() => {
    const assets = new Map(livingRoomCatalog.map((asset) => [asset.id, asset.renderAsset]))

    return (assetId: string) => assets.get(assetId)
  }, [])

  useEffect(() => {
    void actions.initialize()
    // actions 是 store 的稳定引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.json())
      .then((data: Health) => setHealth(data))
      .catch(() => setHealth(null))

    return () => controller.abort()
  }, [])

  const activeRoom = useMemo(
    () => (activeSpatialModel ? selectPrimaryDesignRoom(activeSpatialModel) : undefined),
    [activeSpatialModel],
  )

  // 切换空间模型（新时间线）时重置输入示例与视图。
  const activeRoomName = activeRoom?.name
  useEffect(() => {
    if (!spatialModelVersionId || !activeRoomName) return
    setCommand(defaultCommandFor(activeRoomName))
    setView('3d')
  }, [spatialModelVersionId, activeRoomName])

  const validation = useMemo(
    () => (activeSpatialModel ? validateHomeSpatialModel(activeSpatialModel) : undefined),
    [activeSpatialModel],
  )
  const renderSnapshot = useMemo(
    () =>
      activeSpatialModel && designState
        ? // 服务端 DesignState.spatialModelId 是空间模型版本 ID，与户型自身 ID 不同；
          // RenderSnapshot 以户型自身 ID 校验配对，这里按所属模型对齐。
          createRenderSnapshot(
            activeSpatialModel,
            { ...designState, spatialModelId: activeSpatialModel.id },
            { resolveAsset: renderAssetResolver },
          )
        : undefined,
    [activeSpatialModel, designState, renderAssetResolver],
  )
  const floor = activeSpatialModel?.floors[0]

  if (status === 'error') {
    return (
      <main className="shell">
        <div className="ai-feedback ai-feedback-error">
          <strong>项目加载失败</strong>
          <span>{loadError}</span>
          <div className="ai-proposal-actions">
            <button type="button" onClick={() => void actions.initialize()}>
              重试
            </button>
          </div>
        </div>
      </main>
    )
  }

  if (
    !project ||
    !designState ||
    !activeSpatialModel ||
    !validation ||
    !floor ||
    !activeRoom ||
    !renderSnapshot
  ) {
    return <main className="shell">正在加载项目…</main>
  }

  const graph = buildRoomGraph(floor)
  // 外墙中心线位于房间内表面之外，包围盒同时纳入墙体端点，避免被裁切。
  const points = [
    ...floor.rooms.flatMap((room) => room.boundary.points),
    ...floor.walls.flatMap((wall) => [wall.start, wall.end]),
  ]
  const xs = points.map((point) => point[0])
  const zs = points.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const scale = 84
  const canvasWidth = (maxX - minX) * scale
  const canvasHeight = (maxZ - minZ) * scale
  const objects = Object.values(designState.objects)
  const sofa = objects.find((object) => object.category === 'sofa')
  const sofaLocked = Boolean(sofa && designState.locks[sofa.id])
  const layoutReady = objects.length > 0
  const renderAssetCount = livingRoomCatalog.filter((asset) => asset.renderAsset).length
  const busy = planning || interpreting || switching
  const usingImportedModel = activeSpatialModel.id !== sampleApartment.id

  const submitNaturalLanguageCommand = (event: FormEvent) => {
    event.preventDefault()
    void actions.interpret(command)
  }

  return (
    <main className="shell">
      <header className="hero">
        <div className="eyebrow">HOMESCAPE AI · REAL ROOM PIPELINE</div>
        <h1>从真实户型开始，再用一句话持续修改这个家。</h1>
        <p>
          当前链路已经覆盖 Ground Truth 标注、空间导入、Catalog / Planner、自然语言设计和 Babylon Runtime。
          AI 负责提出结构化意图，空间真值、几何约束、Revision 与可执行状态仍由确定性系统控制。
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

      <FloorPlanImportWorkbench
        activeSpatialModelId={activeSpatialModel.id}
        disabled={busy}
        onFinalized={actions.switchSpatialModel}
      />

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
              maxLength={MAX_COMMAND_LENGTH}
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
            <button type="button" onClick={() => setCommand(defaultCommandFor(activeRoom.name))}>
              第一版布局
            </button>
            <button
              type="button"
              onClick={() => setCommand('沙发小一点，换成浅灰色三人位，其他地方别动')}
            >
              局部替换
            </button>
            <button type="button" onClick={() => setCommand('把沙发锁定，后面都不要改它')}>
              Lock
            </button>
          </div>

          {aiError ? (
            <div className="ai-feedback ai-feedback-error">
              <strong>AI Runtime</strong>
              <span>{aiError}</span>
            </div>
          ) : null}

          {pendingProposal ? (
            <div className="ai-feedback ai-proposal" role="alertdialog">
              <strong>需要确认的操作</strong>
              <ul>
                {pendingProposal.targets.map((target, index) => (
                  <li key={index}>
                    将{target.action}：{target.name}
                  </li>
                ))}
              </ul>
              <div className="ai-proposal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void actions.confirmPendingProposal()}
                >
                  确认执行
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => actions.dismissPendingProposal()}
                >
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {aiFeedback ? (
            <div className="ai-feedback">
              <div className="ai-feedback-head">
                <strong>{aiFeedback.status}</strong>
                <span>
                  {aiFeedback.meta.provider} · {aiFeedback.meta.model} · {aiFeedback.meta.latencyMs}ms
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
                <code>preserve={aiFeedback.decisions.preserveOthers.toFixed(2)}</code>
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
            <h2>{activeSpatialModel.name}</h2>
            <div className="workspace-badge">
              <span>{usingImportedModel ? 'IMPORTED MODEL' : 'SAMPLE MODEL'}</span>
              <strong>{activeRoom.name}</strong>
            </div>
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
              当前 Workbench 同时绑定真实空间真值与 Catalog 视觉资产。Planner 使用 Catalog
              的真实尺寸做碰撞与摆放，Babylon 只消费已经标准化的 glTF / GLB，不在运行时猜测单位或 Pivot。
            </p>

            <dl className="metrics">
              <div><dt>Catalog SKU</dt><dd>{livingRoomCatalog.length}</dd></div>
              <div><dt>Model Assets</dt><dd>{renderAssetCount}/{livingRoomCatalog.length}</dd></div>
              <div><dt>Design Objects</dt><dd>{objects.length}</dd></div>
              <div><dt>State Version</dt><dd>{designState.version}</dd></div>
              <div><dt>Revision</dt><dd>{project.revisionCount}</dd></div>
              <div><dt>Room Graph</dt><dd>{graph.edges.length}</dd></div>
              <div><dt>Active Room</dt><dd>{activeRoom.name}</dd></div>
              <div>
                <dt>空间校验</dt>
                <dd className={validation.valid ? 'metric-ok' : 'metric-error'}>
                  {validation.valid ? 'VALID' : 'INVALID'}
                </dd>
              </div>
            </dl>

            <div className="workspace-controls">
              <strong>Active Spatial Model</strong>
              <code>{activeSpatialModel.id}</code>
              <button
                type="button"
                disabled={busy || !usingImportedModel}
                onClick={() => void actions.switchToSampleSpace()}
              >
                切回示例空间（开启新时间线）
              </button>
            </div>

            <div className="revision-controls">
              <strong>Deterministic Controls</strong>
              <button
                type="button"
                disabled={busy || layoutReady}
                onClick={() => void actions.generateLayout()}
              >
                自动布置{activeRoom.name}
              </button>
              <button
                type="button"
                disabled={busy || !sofa || sofaLocked}
                onClick={() => void actions.replaceWithCompactSofa()}
              >
                沙发小一点 + 浅灰色
              </button>
              <button
                type="button"
                disabled={busy || !sofa}
                onClick={() => void actions.toggleSofaLock()}
              >
                {sofaLocked ? '解除沙发锁定' : '锁定沙发'}
              </button>
              <div className="revision-control-row">
                <button
                  type="button"
                  disabled={busy || !project.canUndo}
                  onClick={() => void actions.undo()}
                >
                  Undo
                </button>
                <button
                  type="button"
                  disabled={busy || !project.canRedo}
                  onClick={() => void actions.redo()}
                >
                  Redo
                </button>
              </div>
              {notice ? (
                <div className="ai-feedback" role="status">
                  <strong>已同步</strong>
                  <span>{notice}</span>
                </div>
              ) : null}
              {revisionError ? (
                <div className="ai-feedback ai-feedback-error">
                  <strong>Revision</strong>
                  <span>{revisionError}</span>
                </div>
              ) : null}
            </div>

            {plannerFeedback ? (
              <div className="planner-feedback">
                <strong>Last Plan</strong>
                <span>通过决策：{plannerFeedback.decisions.length}</span>
                <span>约束问题：{plannerFeedback.violations.length}</span>
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
                  const [labelX, labelY] = projectPoint(center, minX, minZ, scale)
                  const polygonPoints = room.boundary.points
                    .map((point) => projectPoint(point, minX, minZ, scale).join(','))
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
                  const [x1, y1] = projectPoint(wall.start, minX, minZ, scale)
                  const [x2, y2] = projectPoint(wall.end, minX, minZ, scale)

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
              <span>HEAD · {project.headRevisionId ?? 'INITIAL'}</span>
              <span>{activeRoom.name} · V{designState.version}</span>
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

      <footer>HomeScape AI · 对话式家装空间设计</footer>
    </main>
  )
}

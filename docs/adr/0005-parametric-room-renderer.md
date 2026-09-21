# ADR-0005：参数化 Room Renderer 与首个 Babylon.js Adapter

- Status: Accepted for P1, benchmark-gated for final runtime selection
- Date: 2026-09-21

## 决策

HomeScape 的 3D Runtime 必须通过 Renderer Adapter 消费 RenderSnapshot。

Renderer 不直接消费 DesignRevision，也不拥有 Design State。Domain / Planner 负责把 Revision 解析成新的权威状态，Renderer 只同步最终快照。

PR #3 使用 Babylon.js 9 作为首个完整 Adapter，用于打通参数化住宅空间的实时 3D 链路。

## 当前实现范围

由 HomeSpatialModel 动态生成：

- Room floor polygon
- Wall
- Door / window / opening cutout
- Column
- Beam
- Utility Anchor debug marker
- PlannedObject proxy
- Project / Floor / Room / Zone / Object focus

异形简单多边形地面通过内部 ear-clipping triangulation 生成，不要求户型是矩形。

## 为什么不让 Renderer apply Revision

Revision 是业务语义，不是图形命令。若 Renderer 自己解释 Revision：

1. Domain State 和 3D Scene 容易产生双状态漂移。
2. Babylon / Three Adapter 会重复实现业务逻辑。
3. Undo / Replay / Server-side Planner 无法共享同一条执行路径。

因此正式链路是：

~~~text
DesignRevision
      ↓
Domain + Planner
      ↓
Resolved RenderSnapshot
      ↓
Renderer.sync()
~~~

## Babylon.js 状态

Babylon.js 是 P1 的首个 Runtime Candidate，不代表永久锁定。

在进入整屋规模前，仍需完成 Whole-home Runtime Benchmark，与 Three.js/R3F 在相同 fixture 和设备矩阵上比较：

- 首屏时间
- FPS
- CPU / GPU memory
- 大量 mesh / material update
- picking / gizmo
- room visibility
- LOD / streaming
- 移动端稳定性

只有 Benchmark 通过后才将 Babylon.js 提升为长期生产 Runtime。

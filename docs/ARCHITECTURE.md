# HomeScape AI Architecture v0.4

## 1. 产品目标

HomeScape AI 面向真实住宅空间，支持：

1. 将户型图、CAD、扫描等输入统一为 HomeSpatialModel。
2. 根据风格和业主需求生成可编辑设计方案。
3. 通过自然语言、GUI 和 3D 操作持续修改同一份 Design State。
4. 在真实尺寸、商品、空间和业务约束下生成可执行方案。
5. 使用实时 3D 提供秒级反馈，并保留高质量异步渲染能力。

## 2. 总体架构

~~~text
Interaction
文本 / 语音 / GUI / 3D
        │
        ▼
Design Request + Scope
        │
        ▼
AI Capability Runtime
        │
        ▼
DesignOperation[]
        │
        ▼
Catalog + Planner + Constraint
        │
        ▼
ResolvedDesignMutation[]
        │
        ▼
Revision Engine
        │
        ▼
DesignState
        │
        ├──────────► RenderSnapshot ──► Interactive Renderer
        │
        └──────────► Quote / Hi-Fi Render / Business Runtime
~~~

## 3. 双层 Source of Truth

### HomeSpatialModel

住宅本体真值：

- Floor / Room / Zone
- Wall / Opening
- Column / Beam
- UtilityAnchor
- RoomConnection
- provenance / confidence

Canonical：meter、right-handed、Y-up。

### DesignState

设计叠加真值：

- DesignObject
- MaterialAssignment
- StyleIntent
- Lock
- headRevisionId
- state version

住宅几何与设计方案不混在一个 Scene JSON 中。

## 4. Operation、Mutation 与 Revision

DesignOperation 表达用户 / AI 的语义意图，例如：

~~~text
replace sofa
move object
preserve tv cabinet
lock object
~~~

ResolvedDesignMutation 是经过 Catalog / Planner / Constraint 后可以确定执行的状态变化，例如：

~~~text
upsert_object
move_object
rotate_object
set_material
set_style_intent
set_lock
~~~

Revision 同时保存 Operation 和 Mutation，使系统既能解释“用户想做什么”，也能审计“系统实际做了什么”。

Commit 时自动生成 inverseMutations：

~~~text
Revision
├── operations
├── mutations
└── inverseMutations
~~~

因此 Undo / Redo / Replay 使用 Domain Engine，而不是依赖 React / Zustand 快照。

## 5. Revision 并发模型

客户端提交 RevisionDraft 时携带 expectedParentRevisionId。

~~~text
client expected head == server current head
          │
     yes ─┴─ no
      │      │
    commit  conflict
~~~

这为未来 AI 长任务、多人设计和异步 Planner 留出乐观并发控制。

## 6. Lock / Preserve

- Lock：持久化到 DesignState，阻止后续修改。
- Preserve：只约束当前请求，不永久锁定。

用户说“电视柜先别动”和“以后别动这个电视柜”因此是两种不同领域语义。

## 7. Renderer

Renderer 不依赖 Planner，不解释 Revision。

~~~text
HomeSpatialModel + DesignState
             ↓
    createRenderSnapshot()
             ↓
        RenderSnapshot
             ↓
       Renderer Adapter
~~~

Babylon.js 是当前 P1 Adapter，最终 Runtime 仍需 Whole-home Benchmark。

## 8. Planner

下一阶段将建立 Catalog + Planner：

~~~text
DesignOperation
      ↓
Catalog Candidate
      ↓
Anchor Generation
      ↓
Hard Constraint Filter
      ↓
Scoring / Ranking
      ↓
ResolvedDesignMutation
~~~

P1 先使用 Rule + Anchor + Collision + Scoring，复杂度达到门槛后再评估 CP-SAT。

## 9. AI 边界

业务依赖 Capability，不依赖 Vendor。JEV 可作为 typed_decision primary，但不能直接写 DesignState。

## 10. 后续基础设施

按需求逐步引入 PostgreSQL、Object Storage/CDN、Redis、Durable Workflow、OpenTelemetry 与 Yjs；均不阻塞首个 Vertical Slice。

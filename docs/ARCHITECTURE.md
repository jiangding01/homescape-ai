# HomeScape AI Architecture v0.3

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
Intent / Decision / Vision / Retrieval
        │
        ▼
DesignOperation[]
        │
        ▼
Schema + Authorization + Domain Validation
        │
        ▼
Catalog Retrieval
        │
        ▼
Planner + Constraint Engine
        │
        ▼
Design Revision
        │
        ▼
Resolved Domain State
        │
        ├──────────► RenderSnapshot ──► Interactive Renderer
        │
        └──────────► Hi-Fi Render / Business Runtime
~~~

## 3. HomeSpatialModel

HomeSpatialModel 是住宅空间 Source of Truth，与 AI Provider 和 3D Engine 无关。

~~~text
HomeSpatialModel
└── Floor
    ├── Room
    │   └── Zone
    ├── Wall
    ├── Opening
    ├── StructuralElement
    │   ├── Column
    │   └── Beam
    ├── UtilityAnchor
    └── RoomConnection
~~~

Canonical 约定：

- unit：meter
- coordinate：right-handed
- up axis：+Y
- Floor.elevation 表达楼层高度
- RoomConnection 表达空间拓扑
- provenance / confidence 记录户型来源可靠度

无法确定的尺寸、墙体、门窗或房间类型进入 unresolved issue，不允许 AI 猜测后直接成为几何真值。

## 4. Design State 与 Revision

Design State 包含叠加在 HomeSpatialModel 上的家具、材质、灯光、设计语言和锁定状态。

所有 AI 和人工编辑统一转成 DesignOperation，再由 Domain / Planner 形成新的权威状态。Revision 是 Undo / Redo / Replay / Compare / Audit 的基础。

## 5. AI 边界

业务依赖 Capability，不依赖 Vendor。typed_decision 当前以 JEV 为 primary，但 JEV 不进入 Domain Contract。

AI 只能产生受限 Domain Operation 或候选结果；正式空间变化必须经过 Schema、Domain 和 Planner 校验。

## 6. Scope Model

~~~text
Project
└── Floor
    └── Room
        └── Zone
            └── Object
~~~

Scope 是 AI 请求的一等数据，Lock / Preserve 高于 AI 建议。

## 7. Planner

P1 使用 Rule + Anchor + Collision + Scoring：

~~~text
DesignOperation
      ↓
Catalog Candidate
      ↓
Anchor Generation
      ↓
Candidate Placement
      ↓
Hard Constraint Filter
      ↓
Scoring / Ranking
      ↓
Geometry Refinement
      ↓
Final Validation
~~~

复杂度达到门槛后再评估 CP-SAT。

## 8. Renderer

Renderer 不拥有业务状态，不解释 DesignRevision，只消费 RenderSnapshot。

~~~text
HomeSpatialModel + PlannedObjects
             ↓
       RenderSnapshot
             ↓
      Renderer Adapter
        ┌────┴────┐
        │         │
     Babylon   Future Runtime
~~~

PR #3 使用 Babylon.js 9 作为首个 P1 Adapter，提供参数化墙体、开口、梁柱、地面、Camera Focus 和实时交互。

最终 3D Runtime 仍需通过 Whole-home Runtime Benchmark 后锁定。

## 9. 后续基础设施

按需求逐步引入 PostgreSQL、Object Storage/CDN、Redis、Durable Workflow、OpenTelemetry 与 Yjs；均不阻塞首个 Vertical Slice。

# HomeScape AI Architecture v0.2

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
        ├──────────► Interactive Renderer
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
- RoomConnection 表达空间拓扑，不依赖渲染场景推断邻接关系
- provenance / confidence 用于记录户型识别和扫描来源的可靠度

导入链路：

~~~text
Floor Plan / CAD / Scan / Company Data
                ↓
             Importer
                ↓
      HomeSpatialModel Candidate
                ↓
             Validation
          ┌─────┴─────┐
          │           │
       valid      unresolved
          │           │
          │      Human Review
          └─────┬─────┘
                ↓
       HomeSpatialModel
~~~

无法确定的尺寸、墙体、门窗或房间类型进入 unresolved issue，不允许通过 AI 猜测后直接当作几何真值。

## 4. Design State 与 Revision

Design State 包含在 HomeSpatialModel 上叠加的设计对象、材质、灯光、设计语言和锁定状态。

所有 AI 和人工编辑统一转为 DesignOperation，并形成 Revision。Revision 是 Undo / Redo / Replay / Compare / Audit 的基础。

## 5. AI 边界

业务层不直接调用 JEV、OpenAI、Anthropic 等 Vendor。

~~~ts
ai.execute({
  capability: 'typed_decision',
  input,
})
~~~

Capability 首批定义：

- typed_decision
- reasoning
- vision
- structured_extraction
- embedding
- rerank
- image_generation
- speech

typed_decision 当前以 JEV 为 primary，但不进入 Domain Contract。AI 只能产生受限 Domain Operation 或候选结果；正式场景变更必须经过验证与 Planner。

## 6. Scope Model

~~~text
Project
└── Floor
    └── Room
        └── Zone
            └── Object
~~~

Scope 是 AI 请求的一等数据。Lock / Preserve 高于 AI 建议。

## 7. Planner

P1 先使用 Rule + Anchor + Collision + Scoring：

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

Domain 不依赖 Babylon.js 或 Three.js。Renderer Adapter 负责把 canonical HomeSpatialModel 转换为具体引擎。

最终 3D Runtime 通过 Whole-home Runtime Benchmark 决定。

## 9. 后续基础设施

按需求逐步引入 PostgreSQL、Object Storage/CDN、Redis、Durable Workflow、OpenTelemetry 与 Yjs；均不阻塞首个 Vertical Slice。

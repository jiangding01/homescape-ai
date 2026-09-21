# HomeScape AI Architecture v0.1

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

## 3. Source of Truth

### HomeSpatialModel

描述住宅真实几何和拓扑：

- Project / Floor
- Room
- Zone
- Wall / Door / Window / Opening
- Column / Beam
- 固定设施与 Utility Anchor
- Room Graph

约定：

- Canonical unit：meter
- Canonical coordinate：right-handed, Y-up
- Renderer Adapter 负责转换到具体引擎坐标约定

### Design State

包含在 HomeSpatialModel 上叠加的设计对象、材质、灯光、设计语言和锁定状态。

### Revision

所有 AI 和人工编辑统一转为 DesignOperation，并形成 Revision。Revision 是 Undo / Redo / Replay / Compare / Audit 的基础。

## 4. AI 边界

业务层不直接调用 JEV、OpenAI、Anthropic 等 Vendor。

调用形式：

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

当前计划：

- typed_decision：JEV primary
- 其他能力：按专项 Spike 后配置
- Provider 必须通过统一结果 Contract 归一化

AI 只能产生受限 Domain Operation 或候选结果；任何正式场景变更必须经过验证与 Planner。

## 5. Scope Model

~~~text
Project
└── Floor
    └── Room
        └── Zone
            └── Object
~~~

Scope 是 AI 请求的一等数据。

## 6. Planner

P1 先使用 Rule + Anchor + Collision + Scoring。复杂度达到门槛后再接 CP-SAT，不提前过度设计。

## 7. Renderer

Domain 不依赖 Babylon.js 或 Three.js。最终 3D Runtime 通过 Whole-home Runtime Benchmark 决定。

## 8. 后续基础设施

按需求逐步引入 PostgreSQL、Object Storage/CDN、Redis、Durable Workflow、OpenTelemetry 与 Yjs；均不阻塞首个 Vertical Slice。

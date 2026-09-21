# HomeScape AI Architecture v0.5

## 1. 产品目标

HomeScape AI 面向真实住宅空间，将真实户型、自然语言、商品数据和空间约束统一为可持续编辑的设计状态。

## 2. 当前核心链路

~~~text
Interaction
文本 / GUI / 3D
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
Structured Catalog
        │
        ▼
Rule-based Planner
Anchor + Collision + Constraint + Scoring
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

## 4. Operation、Mutation 与 Revision

DesignOperation 表达用户 / AI 语义意图。

ResolvedDesignMutation 是 Catalog / Planner / Domain 确认后可执行的状态变化。

Revision 同时保存 Operation、Mutation 与 inverseMutation，因此 Undo / Redo / Replay 使用 Domain Engine，不依赖 React 状态快照。

## 5. Catalog

Catalog 是 Planner 的真实候选来源，而不是纯视觉素材目录。

~~~text
CatalogAsset
├── sku / category / name
├── dimensions
├── variants
├── style tags
├── price / attributes
└── placement rules
    ├── anchors
    ├── wall clearance
    └── collision padding
~~~

P1 先使用精选 Mock SKU 验证协议与算法；接真实商品数据时保持相同 Contract。

检索顺序：

~~~text
Hard structured filter
品类 / 尺寸 / 座位 / 价格 / 颜色
        ↓
Semantic retrieval / rerank (future)
        ↓
Spatial feasibility
~~~

## 6. Rule-based Planner

P1 不让 AI 直接生成最终坐标。

Planner 流程：

~~~text
DesignOperation
      ↓
Resolve Scope
      ↓
Catalog Candidates
      ↓
Wall / Center / Free Anchors
      ↓
Room / Zone Boundary
      ↓
Furniture Collision
      ↓
Column Collision
      ↓
Door / Opening Clearance
      ↓
Soft Score
      ↓
ResolvedDesignMutation
~~~

家具 footprint 使用 2D oriented rectangle，碰撞采用 SAT。

Replace 优先保留原 Transform，只有尺寸/约束不满足才重新布局。

## 7. Lock / Preserve

- Lock：持久化 DesignState，跨请求阻止修改。
- Preserve：只约束当前 Planner Request。

## 8. Renderer

Renderer 不依赖 Planner，也不解释 Revision。

~~~text
HomeSpatialModel + DesignState
             ↓
    createRenderSnapshot()
             ↓
        RenderSnapshot
             ↓
       Renderer Adapter
~~~

RenderObject 已携带商品 dimensions，当前 Babylon 占位几何按真实尺寸显示。未来替换 GLB 不改变 Domain Contract。

## 9. 下一阶段 AI Runtime

下一步将把自然语言解释接入已经存在的 AI Capability Runtime：

~~~text
"沙发小一点，换浅灰色，其他地方别动"
                    ↓
           Scope / Intent Decision
                    ↓
DesignOperation[]
- replace sofa
- preserve other objects
                    ↓
               Planner
~~~

JEV 可作为 typed_decision primary，但 AI 永远不直接写 DesignState。

## 10. 后续基础设施

按需求逐步引入 PostgreSQL、Object Storage/CDN、Redis、Durable Workflow、OpenTelemetry 与 Yjs。

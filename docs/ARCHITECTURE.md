# HomeScape AI Architecture v0.8

## 1. 当前端到端闭环

~~~text
Real Floor Plan / Company Data
        ↓
FloorPlanDraft / SpatialImporter
        ↓
HomeSpatialModel Candidate
        ↓
Validation + Human Review
        ↓
Finalize HomeSpatialModel
        ↓
Active Workspace
        ├── DesignState
        ├── AI Context
        ├── Catalog + Planner
        └── RenderSnapshot
                ↓
Natural Language / GUI
        ↓
AI Capability Runtime
        ↓
Design Intelligence
        ↓
DesignOperation[]
        ↓
Rule-based Planner
        ↓
ResolvedDesignMutation[]
        ↓
Revision Engine
        ↓
DesignState
        ↓
Interactive 3D
~~~

PR #8 的核心变化是：Finalize 不再只是“得到一个模型”，而是把该模型切换成当前设计会话唯一的 Active HomeSpatialModel。

## 2. Active Workspace

Web Vertical Slice 当前维护一组必须一致的运行时状态：

- Active HomeSpatialModel
- DesignState.spatialModelId
- Active Room
- Revision Timeline
- Planner input
- AI command context
- RenderSnapshot

切换空间模型时不会迁移旧 DesignObject。系统会创建新的空 DesignState 与 Revision Timeline，因为旧家具坐标、Room ID、Zone ID 和约束结果不能安全地假定对新空间仍然有效。

默认设计房间按以下确定性顺序选择：

~~~text
living
→ dining
→ largest room by polygon area
~~~

后续可以把这个策略升级成用户显式选择 Room / Zone，但不应让 LLM 隐式决定当前编辑上下文。

## 3. 并发与状态一致性

Planner 是异步的。

如果在 Planner 执行期间切换 HomeSpatialModel，旧结果可能在新 Timeline 上落盘。因此 PR #8 引入 workspace epoch：

~~~text
plan starts at epoch N
        ↓
async planning
        ↓
commit only if current epoch === N
and current DesignState.spatialModelId === planned model.id
and current revision head === expected head
~~~

同时 Import Workbench 在 planning / interpreting 期间禁用 Finalize，形成 UI Gate + Runtime Gate 双保险。

## 4. Source of Truth

HomeSpatialModel 描述住宅本体：

- Floor / Room / Zone
- Wall / Opening
- Column / Beam
- UtilityAnchor
- RoomConnection
- provenance / confidence

Canonical：meter、right-handed、Y-up。

DesignState 只描述设计叠加。Render Scene 仍然只是 View。

## 5. Real Floor Plan Import

FloorPlanDraft 是解析器与 HomeSpatialModel 之间的过渡协议，不是长期真值。

不确定信息进入 unresolved，经 Human Review / Correction 解决。只有 Validation 通过且所有 requiresHumanReview 已解决，才能 Finalize。

## 6. AI Runtime

AI 仍不直接修改 Scene 或 DesignState。

JEV typed_decision 接收到的 activeRoom 来自 Active Workspace，而不是固定 room-living。这样同一套 Design Intelligence 可以作用在导入户型的真实 Room ID 上。

## 7. Planner

Planner 的 spatialModel 与 DesignState.spatialModelId 必须指向同一 Active Workspace。

所有 Add / Replace / Move / Rotate 继续经过：

~~~text
Catalog hard filter
→ candidate generation
→ room / zone boundary
→ collision
→ column / opening clearance
→ scoring
→ mutation
~~~

## 8. Renderer

RenderSnapshot 在创建时验证：

~~~text
spatialModel.id === designState.spatialModelId
~~~

因此模型切换后，Babylon Runtime、2D Debug View、Planner 与 AI Context 都消费同一份 Active HomeSpatialModel。

## 9. 下一阶段

P1 的结构闭环已经成立。下一优先级是 Real Asset Pipeline：

~~~text
真实 SKU Source
→ asset normalization
→ GLB / glTF
→ LOD
→ Meshopt / KTX2
→ dimensions / footprint / anchors
→ CatalogAsset
→ Babylon Runtime
~~~

Whole-home Runtime Benchmark 与真实 Floor Plan Extractor 继续作为并行 Technical Spike。

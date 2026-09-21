# HomeScape AI Architecture v0.7

## 1. 当前产品闭环

~~~text
Real Floor Plan / Company Data
        ↓
FloorPlanDraft / SpatialImporter
        ↓
HomeSpatialModel Candidate
        ↓
Validation + Human Review
        ↓
HomeSpatialModel
        ↓
Natural Language / GUI
        ↓
AI Capability Runtime
        ↓
Design Intelligence
        ↓
DesignOperation[]
        ↓
Structured Catalog
        ↓
Rule-based Planner
        ↓
ResolvedDesignMutation[]
        ↓
Revision Engine
        ↓
DesignState
        ↓
RenderSnapshot
        ↓
Interactive 3D
~~~

AI 与视觉识别都只能产生 Candidate / Proposal；确定性校验和领域状态仍拥有最终执行权。

## 2. 住宅空间真值

HomeSpatialModel 描述住宅本体：

- Floor / Room / Zone
- Wall / Opening
- Column / Beam
- UtilityAnchor
- RoomConnection
- provenance / confidence

Canonical：

- unit: meter
- coordinate: right-handed
- up axis: +Y

3D Scene、户型图片坐标和任何第三方识别 JSON 都不是 Source of Truth。

## 3. Real Floor Plan Import

PR #7 引入 FloorPlanDraft，作为图片/PDF解析器与 HomeSpatialModel 之间的过渡协议。

~~~text
Pixels
+ Calibration
+ Room Polygons
+ Openings
+ Confidence
+ Explicit Assumptions
        ↓
FloorPlanDraftImporter
        ↓
metric geometry
+ shared wall normalization
+ room connection
+ provenance
        ↓
Candidate
~~~

P1 要求上游 Draft 在共享墙交点处切分边界。Importer 会去重完全相同或反向相同的共墙。

不确定信息不会被静默接受，而进入 unresolved：

- missing_dimension
- ambiguous_wall
- ambiguous_opening
- unknown_room_type
- topology_conflict
- low_confidence

Human Review 通过 SpatialCorrection 修改 Candidate。只有 validation 通过且所有必须审核项已解决，Candidate 才能 Finalize。

## 4. Design State

HomeSpatialModel 与 DesignState 分离：

~~~text
HomeSpatialModel = 房屋本体
DesignState      = 设计叠加
Render Scene     = View
~~~

DesignState 包含 DesignObject、MaterialAssignment、StyleIntent、Lock、Revision head 与 version。

## 5. AI Capability Runtime

业务依赖 Capability，不依赖 Vendor。

当前能力：

- typed_decision → JEV Provider
- reasoning
- vision
- structured_extraction
- embedding
- rerank
- image_generation
- speech

JEV 只负责 typed decisions。家装语义组合位于 design-intelligence。

## 6. Operation → State

~~~text
DesignOperation
      ↓
Catalog hard filter
      ↓
Anchor candidates
      ↓
Boundary / collision / opening clearance
      ↓
Soft scoring
      ↓
ResolvedDesignMutation
      ↓
Revision Engine
      ↓
DesignState
~~~

Lock / Preserve / Geometry Constraint 不能被 AI 绕过。

## 7. Renderer

Renderer 只消费 RenderSnapshot，不解释 Revision。

Babylon.js 仍是 P1 Runtime Candidate，整屋规模前需要 Whole-home Runtime Benchmark。

## 8. Security

- TypeSafe API Key 只在服务端
- 户型源文件与识别结果视为用户项目敏感数据
- AI / Extractor 输出按不可信输入处理
- Importer 与 Review 后仍必须经过 Schema / Geometry Validation
- 不记录 Authorization 等敏感 Header

## 9. 下一阶段

PR #7 完成的是“真实户型 Candidate + Review Gate”。

后续应并行推进：

~~~text
真实 Extractor / 公司户型数据 Adapter
        +
Finalized HomeSpatialModel → 当前 3D / Planner Vertical Slice
        +
真实 GLB Asset Pipeline
~~~

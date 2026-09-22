# Roadmap

## P0 — Foundation

- [x] Monorepo
- [x] Spatial Model contract
- [x] DesignOperation / Revision contract
- [x] AI Capability Runtime contract
- [x] Planner contract
- [x] Renderer contract
- [x] CI 基础链路
- [ ] 首次 pnpm lockfile
- [ ] 基础单元测试

## PR #2 — HomeSpatialModel Core

- [x] Canonical meter / right-handed / Y-up
- [x] Room / Zone / Wall / Opening
- [x] Column / Beam / Utility Anchor
- [x] Room Connection / Room Graph
- [x] provenance / confidence
- [x] Spatial Importer / unresolved issue contract
- [x] 空间模型 validation
- [x] 真实尺度多空间 fixture
- [x] 2D Debug View

## PR #3 — Parametric Room Renderer

- [x] RenderSnapshot 单向同步边界
- [x] Babylon.js 首个 Renderer Adapter
- [x] 参数化 Room floor / Wall / Opening
- [x] Column / Beam / Utility Anchor
- [x] Scope focus contract
- [x] 3D / 2D Debug 双视图
- [ ] Whole-home Runtime Benchmark

## PR #4 — Design State + Revision Engine

- [x] DesignState
- [x] ResolvedDesignMutation
- [x] Undo / Redo / Replay
- [x] 乐观并发控制
- [x] Lock enforcement
- [x] DesignState → RenderSnapshot
- [x] Web Revision Demo

## PR #5 — Catalog + Rule-based Planner

- [x] CatalogAsset / CatalogRepository
- [x] 精选客厅 Mock SKU
- [x] 结构化硬过滤
- [x] Wall / Center / Free Anchor
- [x] Room / Zone boundary validation
- [x] 2D OBB / SAT 家具碰撞
- [x] Column / Door / Opening constraint
- [x] Lock / Preserve enforcement
- [x] Planner → ResolvedDesignMutation
- [x] 商品真实尺寸进入 RenderSnapshot

## PR #6 — AI Runtime / JEV Decision

- [x] typed_decision 通用 Contract
- [x] TypeSafe JEV Provider
- [x] 客厅 Natural Language Decision Pack
- [x] Confidence Gate
- [x] Typed Decision → DesignOperation
- [x] API / Web Conversational Design
- [x] AI provenance 进入 Revision
- [ ] structured_extraction 支持精确 move / rotate

## PR #7 — Real Floor Plan Import

- [x] FloorPlanDraft v0.1 过渡协议
- [x] 像素坐标 → meter 标尺校准
- [x] Room polygon → HomeSpatialModel Candidate
- [x] 共墙去重
- [x] Door / Opening → RoomConnection
- [x] confidence / provenance
- [x] missing dimension / low confidence / topology unresolved
- [x] Spatial Review Session
- [x] Room type / wall thickness / ceiling height correction
- [x] Finalize Gate
- [x] Draft JSON 导入与 2D Review Workbench
- [ ] CV / VLM / 公司户型数据 Extractor
- [ ] 户型原图 overlay + 几何交互校正

## PR #8 — Real Room Integration

- [x] Finalized HomeSpatialModel → Active Workspace
- [x] DesignState 与 spatialModelId 同步重建
- [x] Planner 使用 Active HomeSpatialModel
- [x] RenderSnapshot / Babylon 使用 Active HomeSpatialModel
- [x] AI Context 使用动态 Active Room
- [x] 默认设计房间选择：Living → Dining → Largest Room
- [x] 模型切换时清空 Revision / AI / Planner 派生状态
- [x] 异步 Planner 使用 workspace epoch 防止旧结果污染新模型
- [x] 导入 Review 在设计任务执行期间禁止 Finalize
- [x] 一键切回示例空间

## PR #9 — Real Asset Pipeline

- [x] CatalogRenderAsset contract
- [x] meter / right-handed-y-up / floor-center normalization contract
- [x] LOD manifest contract
- [x] Catalog validation：dimensions / URI / duplicate ID / duplicate SKU
- [x] RenderSnapshot Asset Resolver
- [x] Babylon glTF / GLB AssetContainer loader
- [x] AssetContainer cache + per-object instantiation
- [x] 异步 sync generation 防止旧资产写入新 Scene
- [x] 加载失败时按 Catalog dimensions 降级尺寸代理
- [x] 7 个本地 normalized demo glTF 资产
- [x] Production Asset Ingestion / Geometry QA Gate
- [ ] 公司真实 SKU GLB 入库
- [ ] 自动 Meshopt / KTX2 压缩流水线
- [ ] 多级 LOD 生成与运行时距离选择
- [x] 资产几何尺寸自动 QA / 阻断（PR #10）

## PR #10 — Production Asset Ingestion

- [x] 独立 @homescape/asset-pipeline Contract
- [x] Asset Ingestion Manifest v0.1
- [x] 显式 sourceRoot，阻断 sourcePath 越界
- [x] glTF / GLB 2.0 离线检查器
- [x] Scene Node Transform → World Bounds
- [x] Catalog Dimensions 自动对比与误差门禁
- [x] floor-center Pivot 自动 QA
- [x] Triangle / File Size / Texture Size Budget
- [x] Animation / Skin / Morph Target 阻断
- [x] LOD0 必须存在 + LOD Triangle 单调检查
- [x] Meshopt / KTX2 Production Policy Gate
- [x] Self-contained GLB Production Policy Gate
- [x] SHA-256 / byteSize / Release Manifest
- [x] CatalogRenderAsset Activation Gate
- [x] 事务式发布：任一 SKU blocked 时不发布模型文件
- [x] 7 个现有 Demo SKU 的 Ingestion Check Manifest
- [ ] 原始 FBX / OBJ / USD 自动转换 Processor
- [ ] Meshopt / KTX2 自动生成 Processor
- [ ] 公司真实 SKU 数据源 Adapter
- [ ] CDN / OSS 实际上传 Adapter

## P1 — Real Room Vertical Slice

目标：证明真实产品价值，而不是完成整个平台。

- [x] 真实户型 Candidate 输入协议
- [x] 快速人工确认 / 校正门禁
- [x] 参数化房间 3D
- [x] 有限家具 Catalog
- [x] 自然语言连续修改基础链路
- [x] Room / Zone / Object Scope
- [x] Planner：Anchor + Collision + Scoring
- [x] 实时 3D
- [x] Undo / Redo / Revision
- [x] AI 调试信息
- [x] Finalized Import → 现有 3D Workbench 切换
- [x] glTF / GLB 真实加载链路
- [ ] 公司真实 SKU GLB
- [ ] 真实户型自动 Extractor

## 下一阶段候选

### PR #11 — Floor Plan Extractor Benchmark

PR #10 后先暂停功能开发。下一次继续时，优先验证真实户型图片 / PDF → FloorPlanDraft 的 Extractor 方案与评测集，再决定 CV / VLM / 公司数据 Adapter 的组合。

### Technical Spikes

1. Floor Plan Extractor Benchmark
2. Whole-home Runtime Benchmark
3. AI Decision Evaluation / Shadow Model
4. Asset Pipeline
5. End-to-End Real Room Vertical Slice

## P2 — Whole Home

多 Room / Zone、整屋总览、Global Design Language、跨空间一致性、Room Streaming / LOD、Preference Profile。

## P3 — Real Commerce

真实 SKU、库存/价格、预算、BOM/报价、商品替换与推荐。

## P4 — Delivery

施工规则、物料、阶段衔接、验收与交付。

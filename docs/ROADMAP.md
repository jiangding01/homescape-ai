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
- [x] 户型原图 overlay + 几何交互校正（PR #13）

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

## PR #11 — Floor Plan Extractor Benchmark

- [x] 独立 @homescape/floorplan-extractor Contract
- [x] Vendor-neutral Extractor Input / Result / Metadata
- [x] Benchmark Manifest v0.1
- [x] Ground Truth / Candidate 与 Extractor ID 解耦
- [x] Room Polygon Raster IoU
- [x] Room ID 无关的几何匹配
- [x] Room Precision / Recall / Mean IoU
- [x] Room Type Accuracy
- [x] Candidate Room Overlap Ratio Gate
- [x] Opening Center / Width / Precision / Recall
- [x] Calibration Scale Error
- [x] Source Kind / Dimensions Gate
- [x] Threshold-based Pass / Fail Gate
- [x] 按 Extractor 汇总指标
- [x] reference / degraded 正反 Smoke Fixture
- [ ] 30~50 张真实户型图 / PDF Benchmark Corpus
- [x] Normalized Structured Data Baseline Adapter（PR #12）
- [ ] 公司原始户型数据 Schema Mapper
- [ ] CV Extractor 实际跑数
- [ ] VLM Extractor 实际跑数
- [x] Human Review 修正量 / 修正耗时 Contract（PR #13）

## PR #12 — Real Corpus Intake + Structured Extractor Baseline

- [x] Metric Structured Floor Plan v0.1 Contract
- [x] FloorPlanExtractorRegistry
- [x] metric-structured-v0.1 FloorPlanExtractor
- [x] company_data + HomeScape Vendor MIME 支持
- [x] meter geometry → canonical FloorPlanDraft pixel space
- [x] Room / Opening / Confidence / Assumption 校验
- [x] Source Bounds / Edge / Self-intersection / Ceiling Height Gate
- [x] UTF-8 JSON Runner
- [x] Corpus Manifest v0.1
- [x] Corpus Tag Taxonomy
- [x] Corpus path realpath 安全检查
- [x] Ground Truth 基础完整性检查
- [x] Corpus Distribution Summary + Dataset Fingerprint
- [x] Synthetic Corpus Smoke Manifest
- [ ] 30~50 张真实户型图 / PDF Corpus
- [ ] 公司原始户型数据 Schema Mapper
- [ ] CV Geometry Adapter
- [ ] VLM Structured Extraction Adapter
- [x] Human Review Burden 数据采集（PR #13）

## PR #13 — Ground Truth Annotation Workbench

- [x] 原图 Overlay（PNG / JPEG / WebP / SVG）
- [x] Draft / Source Aspect Ratio Gate
- [x] Room Polygon 顶点拖拽
- [x] Calibration 端点拖拽
- [x] Room Name / Type 校正
- [x] Opening Kind / Offset / Width 校正
- [x] Wall Thickness / Ceiling Height 人工确认
- [x] Ground Truth 结构门禁
- [x] Polygon Self-intersection Gate
- [x] Opening Edge / Ceiling Gate
- [x] Ground Truth JSON 导出
- [x] Review Burden Sidecar 导出
- [x] Review Edit Counts / Touched Room IDs / Duration
- [x] Demo Source Overlay
- [ ] PDF 原图 Overlay / Rasterization
- [ ] Opening Edge 交互式重绑定
- [ ] Room Polygon 增删顶点
- [ ] 真实 30~50 Case Corpus

## PR #14 — Real Corpus Pilot Evaluation Pipeline

- [x] Pilot Experiment Manifest v0.1
- [x] Corpus Manifest / Summary / Benchmark Join
- [x] Dataset Fingerprint Consistency Gate
- [x] Benchmark SHA-256
- [x] Pilot Fingerprint
- [x] Extraction Metadata Join
- [x] Review Burden Join
- [x] Review Duration / Edit Count Integrity Gate
- [x] Corpus Case / Review Room-Opening Count Consistency
- [x] Missing Benchmark Case Reporting
- [x] Missing Review / Metadata Coverage Reporting
- [x] Orphan Run Gate
- [x] --min-cases Gate
- [x] --require-corpus-coverage
- [x] --require-complete-review
- [x] --require-complete-metadata
- [x] Extractor Aggregate
- [x] p50 / p95 Human Review Duration
- [x] Corpus Tag Slice Aggregate
- [x] Synthetic Pilot Smoke Fixture
- [ ] 去敏真实 10 Case Pilot
- [ ] CV / Geometry Baseline 实际跑数

## PR #15 — Orthogonal Geometry Reconstruction Baseline

- [x] Geometry Observation v0.1 Contract
- [x] FloorPlanGeometryDetector Contract
- [x] Detector / Reconstruction 解耦
- [x] Near-axis Wall Normalization
- [x] Wall Coordinate Snap / Cluster
- [x] Blocked-edge Grid Reconstruction
- [x] Room Seed Flood Fill
- [x] 多 Seed 同连通域冲突 Gate
- [x] Rectangular / L-shape Polygon Reconstruction
- [x] Collinear Vertex Simplification
- [x] Opening → Room Edge Mapping
- [x] Opening Room Hint / Ambiguity Warning
- [x] Opening Height / Sill vs Ceiling Gate
- [x] Low Confidence Warning
- [x] GeometryFloorPlanExtractor Composition
- [x] Detector Output Runtime Validation
- [x] Observation → Candidate CLI
- [x] Plan A / Plan B / L-shape Smoke Fixture
- [ ] Raw PNG / JPEG Geometry Detector
- [ ] PDF Rasterization
- [ ] OCR / Dimension Detector
- [ ] 去敏真实 10 Case 跑数

## PR #16 — Raw Raster Geometry Detector Baseline

- [x] RasterImageDecoder Contract
- [x] Sharp PNG / JPEG Decoder
- [x] EXIF Orientation Normalize
- [x] Transparent Pixel → White Composite
- [x] Input Byte / Pixel Limit
- [x] Grayscale / Luminance Conversion
- [x] Horizontal / Vertical Dark-run Scan
- [x] Wall Thickness Band Merge
- [x] Opening Gap Detection
- [x] Geometry Connectivity → Room Seed
- [x] Deterministic Door / Window / Opening Heuristic
- [x] Image → Observation → Reconstructor E2E Smoke
- [x] PNG + JPEG Smoke
- [x] Raw Image → Candidate CLI
- [x] Anonymous sourceId Default
- [ ] Real 10 Case Pilot
- [ ] OCR / Dimension Detector
- [ ] Room Semantic Detector
- [ ] Symbol Detector
- [ ] PDF Rasterization

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
- [x] Floor Plan Extractor Benchmark / Evaluation Harness
- [ ] 真实户型自动 Extractor

## 下一阶段候选

### PR #17 — Real 10 Case Raster Pilot

PR #16 已把 PNG / JPEG 像素接入 Geometry Observation，并通过 Synthetic E2E 验证 Decoder → Detector → Reconstructor 链路。

当前进度：

- [x] Pilot 保留 Benchmark Failure Codes
- [x] Extractor 级 Failure Summary
- [x] Corpus Tag Slice Failure Summary
- [x] Failure Slice Synthetic Regression Smoke
- [x] Real Corpus Raster Batch Runner
- [x] Batch Runner 先执行 Corpus Gate 并记录 datasetFingerprint
- [ ] 准备第一批 10 张去敏真实户型图
- [ ] 用 PR #13 Workbench 完成 Ground Truth
- [ ] 跑 PR #12 Corpus Check 生成真实 datasetFingerprint
- [ ] 用 PR #16 Raster Detector 生成 Candidate
- [ ] 人工 Review + Burden
- [ ] PR #11 Benchmark + PR #14 Pilot Report
- [ ] 根据 Failure Slice 形成下一阶段技术决策记录

下一阶段不应该继续扩 Synthetic Heuristic，而应拿真实数据验证：

1. 准备第一批 10 张去敏真实户型图
2. 用 PR #13 Workbench 完成 Ground Truth
3. 跑 PR #12 Corpus Check 生成真实 datasetFingerprint
4. 用 PR #16 Raster Detector 生成 Candidate
5. 人工 Review + Burden
6. PR #11 Benchmark + PR #14 Pilot Report
7. 按 Failure Slice 判断：
   - wall / geometry miss → 继续 CV Geometry
   - dimension / text → OCR
   - room semantic / symbol ambiguity → VLM / Hybrid


### Technical Spikes

1. [x] Floor Plan Extractor Benchmark
2. [ ] Whole-home Runtime Benchmark
3. [ ] AI Decision Evaluation / Shadow Model
4. [x] Asset Pipeline
5. [ ] End-to-End Real Room Vertical Slice

## P2 — Whole Home

多 Room / Zone、整屋总览、Global Design Language、跨空间一致性、Room Streaming / LOD、Preference Profile。

## P3 — Real Commerce

真实 SKU、库存/价格、预算、BOM/报价、商品替换与推荐。

## P4 — Delivery

施工规则、物料、阶段衔接、验收与交付。

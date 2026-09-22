# HomeScape AI Architecture v0.16

## 1. 当前端到端闭环

~~~text
Real Floor Plan / PDF / Company Data
        ↓
Floor Plan Extractor Layer
        ├── Metric Structured Baseline
        ├── Geometry Detector → Orthogonal Reconstructor
        ├── future VLM
        └── future Hybrid
        ↓
FloorPlanDraft
        ↓
Benchmark / Confidence
        ↓
Importer + Human Review
        ↓
HomeSpatialModel
        ↓
Active Workspace
        ↓
Design / Planner / Revision / Babylon Runtime
~~~

PR #12 的重点是把“真实数据进入评测系统”与“第一个实际 Extractor Adapter”补齐，但不伪造公司原始 Schema，也不在没有真实 Corpus 的情况下宣布模型选型结果。

## 2. Metric Structured Baseline

新增：

~~~text
MetricStructuredFloorPlanV01
        ↓
MetricStructuredFloorPlanExtractor
        ↓
FloorPlanDraft
~~~

输入面向已经具有结构化几何的上游系统：

- sourceLabel
- canvas width / height in meter
- Room polygon in meter
- Opening offset / width in meter
- wall / ceiling assumptions
- optional confidence

Extractor ID：

~~~text
metric-structured-v0.1
~~~

它支持：

~~~text
kind      = company_data
mediaType = application/vnd.homescape.metric-floorplan+json
~~~

## 3. Extractor Registry

PR #12 同时增加 FloorPlanExtractorRegistry。

自动路由只在“恰好一个 Extractor supports 当前输入”时成立；如果多个 Provider 同时支持 image/png，必须显式指定 extractorId，而不是隐式按注册顺序挑一个。

这避免未来 CV 与 VLM 同时接入后出现不可复现的 Provider 选择。

## 4. 为什么仍然输出 Pixel FloorPlanDraft

FloorPlanDraft 是 Extractor 与 Spatial Importer 之间已经稳定的边界。

公司结构化数据虽然天然使用 meter，但如果让 company_data 绕开 FloorPlanDraft，会形成第二套 Import Path。

因此 Structured Adapter 使用确定性比例：

~~~text
default pixelsPerMeter = 100

metric x
→ pixel x = x × ppm

metric z
→ pixel y = canvasHeightPx - z × ppm

calibration
→ 1 meter = ppm pixels
~~~

这样经过 FloorPlanDraftImporter 后会恢复同一 metric geometry。

这不是把 meter 降级成“图片数据”，而是复用统一的 Calibration / Import / Review / Validation 链路。

## 5. Structured Data Validation

Metric Structured Adapter 在生成 Draft 前执行：

- schemaVersion
- canvas positive dimensions
- Room / Opening ID 唯一
- Room polygon 至少 3 点
- Point 在 canvas 内
- Polygon 非零面积
- Polygon 自相交阻断
- 零长度边阻断
- Room Type enum
- confidence 0~1
- Opening Room reference
- Opening edgeIndex
- offset + width 不越过 Edge
- sill + height 不超过 Ceiling
- wall / ceiling assumption validity
- UTF-8 JSON strict decode
- 默认 5MB Structured Input Size Gate

输出后仍再次通过 isFloorPlanDraft Contract。

## 6. Company Schema Boundary

MetricStructuredFloorPlanV01 是 **HomeScape Normalized Structured Contract**，不是对任何公司内部户型 Schema 的猜测。

Metric Structured Contract 使用专用 Vendor MIME，而不抢占普通 application/json。这样未来原始公司 JSON Adapter 可以安全共存。

未来如果真实公司数据字段是：

~~~text
house.graph.nodes
roomContours
doors
windows
cadEntities
...
~~~

应该增加：

~~~text
Company Raw Schema
→ Company Schema Mapper
→ MetricStructuredFloorPlanV01
→ metric-structured-v0.1
→ FloorPlanDraft
~~~

而不是把公司字段直接写进 HomeSpatialModel 或 Renderer。

## 7. Real Corpus Intake

新增 FloorPlan Corpus Manifest：

~~~text
dataset
cases[]
  ├── id
  ├── sourceKind
  ├── mediaType
  ├── sourcePath
  ├── groundTruthPath
  └── tags
~~~

Corpus 工具验证：

- Case ID 唯一
- Source 文件存在且非空
- Source / Ground Truth 不越过 Corpus Root
- realpath 防止 symlink 绕过
- Ground Truth v0.1
- Ground Truth source kind 一致
- Ground Truth Room 必须有合法 type
- Ground Truth Polygon 非零面积、无自相交、无零长度边
- Opening Room / Edge / Ceiling 约束合法
- Ground Truth 至少一个 Room
- openings 必须是数组

## 8. Corpus Stratification

每个 Case 必须标记：

~~~text
quality
  clean / compressed / blurred / scanned

geometry
  rectangular / l_shape / irregular

annotation
  full_dimension / partial_dimension / no_dimension

layout
  single_room / open_plan / multi_room

symbols
  standard / mixed / unknown

textDensity
  sparse / normal / dense / overlap
~~~

Corpus Summary 会输出各维度分布，避免 50 张数据其实全部来自同一种“干净矩形户型”。

## 9. Local Private Corpus

真实公司户型图不要求提交到 Git。

建议：

~~~text
.floorplan-corpus/
  corpus.json
  sources/
  ground-truth/
  candidates/
  reports/
~~~

该目录已加入 .gitignore。

这样可以在本地或受控 CI 环境中跑：

~~~text
Corpus Check
→ Extractor Runner
→ Candidate JSON
→ Benchmark
→ Report
~~~

而不把敏感户型素材混进仓库历史。

## 10. Runner

Structured Baseline 可直接运行：

~~~bash
pnpm floorplan:extract -- input.json output.json \
  --metadata output.meta.json
~~~

Candidate JSON 与 Extraction Metadata 分离保存。Benchmark 继续只消费 FloorPlanDraft，实验记录则保留 extractorId / provider / model / latency 等 Sidecar Metadata。

Demo：

~~~bash
pnpm floorplan:extract-demo
~~~

Corpus Intake：

~~~bash
pnpm floorplan:corpus -- .floorplan-corpus/corpus.json --min-cases 30
~~~

## 11. 仍然没有完成的事情

PR #12 没有声称完成：

- 30~50 张真实 Corpus
- 公司原始数据字段 Mapper
- CV 户型识别
- VLM 户型识别
- PDF Rasterization
- OCR
- Human Review Burden 自动采集

这些需要真实输入和实际 Provider，不能用 Synthetic Fixture 代替。

## 12. 下一阶段

PR #13 应围绕真实 Corpus 展开，而不是继续增加 Synthetic Demo。

在有真实 30~50 Case 前，最值得继续编码的只有：

- Company Raw Schema Mapper（需要真实 Schema）
- Corpus Annotation / Review Tooling
- CV Geometry Baseline（需要真实图跑数）

核心原则保持不变：

> Extractor 只产生 Candidate，HomeSpatialModel 最终真值仍然由 Importer + Human Review + Validation 确认。


## 13. Ground Truth Annotation / Review Burden

PR #13 把真实 Corpus 最关键的人工作业补进 Web Workbench：

~~~text
Source Image
   +
Extractor / Imported FloorPlanDraft
        ↓
Overlay Annotation
        ├── Room Polygon Vertex
        ├── Calibration
        ├── Room Name / Type
        ├── Opening Kind / Offset / Width
        └── Wall / Ceiling Assumptions
        ↓
Ground Truth Gate
        ↓
FloorPlanDraft Ground Truth
        +
Review Burden Sidecar
~~~

### 坐标真值

Annotation Canvas 的 viewBox 直接使用 FloorPlanDraft source.widthPx / heightPx。

Source 图片只有在宽高比与 Draft 兼容时才进入 Overlay。不同分辨率但相同比例可以按 Draft Pixel Space 缩放；宽高比不一致时暂停 Overlay，避免用户在错误坐标系下修正。

### Ground Truth Gate

导出前至少阻断：

- 非法 FloorPlanDraft
- Source / Calibration 非法
- 未确认墙厚 / 层高
- Room 缺少 type
- Polygon 越界 / 面积过小 / 自相交
- Entity ID 重复
- Opening Room / Edge 引用错误
- Opening offset / width 越界
- Opening 垂直尺寸超过 ceiling
- 已加载 Source 与 Draft 宽高比不一致

导出的 Ground Truth 会把 Room / Opening confidence 统一标记为 1，表示“已经完成人工确认”，但不会绕过 Importer / Spatial Validation。

### Review Burden

Sidecar Contract 记录：

~~~text
startedAt / completedAt / durationMs
totalEdits
roomVertexMoves
roomMetadataEdits
openingGeometryEdits
calibrationEdits
assumptionEdits
resets
touchedRoomIds
source image dimensions
~~~

后续 Extractor 选型不能只比较 IoU / Recall，也要比较：

~~~text
结构质量
+ Human Review Time
+ Human Edit Count
+ Failure Taxonomy
+ Latency
+ Cost
~~~

这更接近真实生产效率。

### 当前边界

PR #13 只支持图片 Overlay；PDF 仍需要 Rasterization / Page Selection。

当前可以拖动已有 Room Polygon 顶点，但尚未提供增删顶点和 Opening Edge 重新绑定。这些应该在真实 Corpus Pilot 暴露真实需求后再补，不提前堆编辑器复杂度。


## 14. Pilot Evaluation Plane

PR #14 把 Extractor Evaluation 从单一 Benchmark 扩展成一次完整 Experiment：

~~~text
Corpus Manifest
+ Corpus Summary / Dataset Fingerprint
+ Benchmark Report
+ Extraction Metadata
+ Human Review Burden
        ↓
Pilot Evaluation
        ↓
Per Case Result
+ Per Extractor Aggregate
+ Corpus Tag Slices
+ Data Quality Report
+ Pilot Fingerprint
~~~

### 为什么 Benchmark 不直接塞进 Review 指标

PR #11 Benchmark 仍保持纯结构评测：

~~~text
Ground Truth
vs
Candidate FloorPlanDraft
~~~

Human Review、Provider Metadata 属于实验上下文，不应该污染几何 Benchmark 的确定性输入。

因此 PR #14 使用独立 Join Layer，把各类 Sidecar 在 caseId + extractorId 上关联。

### Reproducibility

真实实验至少锁定：

~~~text
datasetFingerprint
benchmarkSha256
pilotFingerprint
extractorId
provider / model
~~~

这避免同名数据集或同名模型在内容已经变化时仍被当成同一轮结果。

### Selection Signal

后续技术选型建议同时观察：

~~~text
Structure Quality
Human Review Duration
Human Edit Count
Failure Slice
Latency
Cost
~~~

例如全局 IoU 类似时，irregular / scanned 子集和人工修正时间可能会暴露明显差异。

### 真实数据边界

PR #14 仍不根据 Synthetic Fixture 得出 CV / VLM 结论。

PR #14 当时没有实现 Geometry Algorithm；PR #15 只建立 Vendor-neutral 的确定性 Reconstruction Baseline，并保持参数为 provisional。真正参数冻结、Detector 选型与适用范围仍必须等第一批真实 10 Case 跑数后决定，避免针对演示图形过拟合。


## 15. Geometry Detector / Reconstructor Split

PR #15 增加第一个确定性 Geometry Baseline，但刻意不把“像素检测”和“空间重建”写成一个大 Extractor。

~~~text
Raw Floor Plan Image / PDF
        ↓
FloorPlanGeometryDetector
        ↓
Geometry Observation v0.1
  ├── source dimensions
  ├── calibration
  ├── wall segments
  ├── room seeds
  └── openings
        ↓
OrthogonalGeometryReconstructor
        ↓
FloorPlanDraft
        ↓
Benchmark / Human Review / Importer
~~~

### 为什么拆成两层

真实户型识别里存在两类完全不同的问题：

1. Perception：从 PNG / JPEG / PDF 中找到墙线、房间语义、门窗和尺寸；
2. Reconstruction：把不稳定的观测转成闭合、无重叠、可编辑的结构。

如果二者绑死：

~~~text
OpenCV Algorithm
→ 直接写 FloorPlanDraft
~~~

后续切换 VLM、CV Model、公司视觉服务时，Room Polygon / Opening Mapping / Grid Topology 会被重复实现。

因此 HomeScape 固定：

~~~text
Detector = 可替换感知层
Reconstructor = 确定性几何层
~~~

### Geometry Observation v0.1

当前 Observation 包含：

~~~text
source
calibration
assumptions?
walls[]
roomSeeds[]
openings[]
~~~

Observation 不是 HomeSpatialModel，也不是最终 Ground Truth。它保留感知层的不确定结果，由确定性 Reconstructor 与 Human Review 收口。

### Orthogonal Geometry Baseline

PR #15 的第一版算法面向大量常见正交住宅平面：

~~~text
Wall Segment
→ near-axis normalize
→ X / Y coordinate clustering
→ blocked-edge grid
→ Room Seed flood fill
→ cell union boundary tracing
→ collinear simplification
→ Room Polygon
~~~

支持矩形 Room、L-shape 正交 Polygon、共享墙以及轻微墙线抖动。

当前明确不支持任意斜墙、曲线墙、Room Polygon holes，以及没有 Room Seed 的纯拓扑语义分区。Grid Bounding Box 目前也是计算域边界，因此外轮廓缺墙不会自动被当作 Exterior Leak；这类问题必须由真实 Benchmark / Human Review 暴露，后续如有必要再引入 explicit exterior seed / outline contract。

非正交墙线不会被静默当成正交墙，而是产生 Warning；可用正交墙不足时直接失败。

### Room Seed

Room Seed 是感知层对“这个连通空间里存在一个 Room”的最小语义提示。

~~~text
wall topology
+
one seed per connected room
        ↓
room polygon
~~~

如果两个 Seed 落入同一个 Flood Fill 连通域，Reconstructor 直接报错。

Open-plan living / dining 后续应优先建模为 one Room + multiple Zone，而不是人为制造重叠 Room。

### Opening Mapping

Opening Observation 使用 centerPx / widthPx / orientation / optional roomSeedId。

Reconstructor 在 Room Boundary 上寻找方向一致、距离最近且 Width 可容纳的 Edge，然后转换为 roomId / edgeIndex / offsetPx / widthPx。

没有 roomSeedId 时，如果多个 Room Edge 同样接近，会输出 ambiguity Warning。

Opening 高度或窗台高度缺失时可以使用 Baseline Default，但必须进入 Warning；wall / ceiling assumption 仍保持未确认状态。

### Composed Extractor

FloorPlanGeometryDetector 可以被组合成正式 FloorPlanExtractor：

~~~text
Detector
+
OrthogonalGeometryReconstructor
=
GeometryFloorPlanExtractor
~~~

Detector 返回的数据即使在 TypeScript 上声明为 Geometry Observation，运行时仍再次经过 Schema Validation。

核心原则仍然是：

> AI / CV / VLM 输出永远是 Untrusted Proposal。

### CLI

~~~bash
pnpm floorplan:geometry -- \
  observation.json \
  candidate.json \
  --metadata candidate.meta.json
~~~

Smoke：

~~~bash
pnpm floorplan:geometry:check-demo
~~~

当前 Smoke 包含五房间平面 A、五房间错层边界平面 B 和一个 L-shape Room。它们只验证 Reconstruction，不代表真实图像检测效果。

### 下一边界

真正下一步是：

~~~text
PNG / JPEG
→ Raw Image Geometry Detector
→ Geometry Observation
→ PR #15 Reconstructor
→ Candidate
→ PR #11 Benchmark
→ PR #13 Human Review
→ PR #14 Pilot
~~~

第一批真实 10 Case 到位后，Detector 的参数、失败分类和是否需要 VLM / OCR 才有意义。


## 16. Raw Raster Geometry Detection

PR #16 把 PR #15 的 Geometry Detector Contract 接到真实 PNG / JPEG 像素输入。

~~~text
PNG / JPEG
   ↓
SharpRasterImageDecoder
   ↓
Luminance Raster
   ↓
RasterGeometryDetector
   ├── horizontal dark-run scan
   ├── vertical dark-run scan
   ├── wall band merge
   ├── opening gap detect
   └── connectivity room seeds
   ↓
FloorPlanGeometryObservationV01
   ↓
OrthogonalGeometryReconstructor
   ↓
FloorPlanDraft
~~~

### Decoder Boundary

Node Decoder 通过 package subpath 暴露：

~~~text
@homescape/floorplan-extractor/node
~~~

Web 继续只依赖主入口，不会把 Sharp 打进浏览器 Bundle。

Decoder 当前负责：

- PNG / JPEG decode
- EXIF orientation normalize
- sRGB normalize
- alpha composite on white
- luminance conversion
- maximum input pixel gate

### Raster Wall Baseline

RasterGeometryDetector 当前只做 classical deterministic baseline：

1. 在 Row / Column 上扫描连续暗像素；
2. 只保留达到最小长度的 run；
3. 将相邻 scan line 合并成 wall band；
4. 把合理宽度的白色 gap 当作 Opening Candidate；
5. 用补全后的 Wall Topology 形成 Grid；
6. 根据连通域生成 Room Seed；
7. 交给 PR #15 Reconstructor 生成 Polygon。

默认 minWallRunRatio 使用较保守的 8%，用于降低家具线、文字下划线、尺寸短线被误识别为墙的概率。

### Opening Classification

当前 Opening Kind 仍是启发式，Gap Width 使用图像短边比例而不是 provisional pixelsPerMeter，避免未知尺度直接污染 Topology：

~~~text
outer boundary gap → window
inner gap >= largeOpeningWidthRatio → opening
other inner gap → door
~~~

这不是最终语义真值，所以 Detector 始终输出 Human Review Warning。

### Calibration

Raw Raster 本身没有可靠尺度时，第一版使用 pixelsPerMeter 假设生成 Calibration，并明确输出 Warning。

后续真实 Corpus 如果大量有尺寸标注，应增加独立 Dimension / OCR Detector，而不是把 OCR 塞进墙线扫描器。

### Privacy

CLI 默认不用本地文件名作为 sourceLabel。

未传 --source-id 时：

~~~text
floorplan-<sha256-prefix>
~~~

因此 Candidate / Metadata 不会因为用户文件名包含地址或客户姓名而自动带入敏感信息。

### Current Limits

PR #16 仍不是生产级 CV：

- 只适合高对比、近正交户型；
- 文字、家具、尺寸线仍可能产生 false positive；
- 墙线断裂可能导致空间泄漏；
- Opening Symbol 仍是宽度 / 外轮廓启发式；
- 无 OCR；
- 无 Room Semantic；
- 无 PDF Rasterization；
- 尚未跑真实 10 Case。

是否加入 morphology、Hough、connected-component filter、OCR、VLM 或 learned detector，必须由真实 Pilot Failure Slice 决定。

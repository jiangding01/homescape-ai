# HomeScape AI Architecture v0.12

## 1. 当前端到端闭环

~~~text
Real Floor Plan / PDF / Company Data
        ↓
Floor Plan Extractor Layer
        ├── Metric Structured Baseline
        ├── future CV Geometry
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

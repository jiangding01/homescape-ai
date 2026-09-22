# Floor Plan Geometry Baseline

## 目标

PR #15 建立 HomeScape 第一个确定性户型几何重建 Baseline。

它解决的是：

> 已经从图片 / PDF 得到墙线、Room Seed、Opening 等低层观测后，如何稳定生成 FloorPlanDraft。

它不是一个已经完成的 PNG / JPEG 识别器。这样做是为了避免把真实图像感知算法与 Room Topology 重建绑死。

## Pipeline

~~~text
Raw Image / PDF
        ↓
FloorPlanGeometryDetector
        ↓
FloorPlanGeometryObservationV01
        ↓
OrthogonalGeometryReconstructor
        ↓
FloorPlanDraft
        ↓
Benchmark
        ↓
Human Review
        ↓
HomeSpatialModel
~~~

## Observation Contract

示意：

~~~json
{
  "schemaVersion": "0.1.0",
  "source": {
    "kind": "floorplan_image",
    "sourceLabel": "case-001",
    "widthPx": 1600,
    "heightPx": 1200
  },
  "calibration": {
    "startPx": [100, 1100],
    "endPx": [700, 1100],
    "realDistanceMeters": 6,
    "confidence": 0.98
  },
  "walls": [
    {
      "id": "wall-001",
      "startPx": [100, 100],
      "endPx": [700, 102],
      "confidence": 0.91
    }
  ],
  "roomSeeds": [
    {
      "id": "room-seed-living",
      "pointPx": [350, 650],
      "name": "客厅",
      "type": "living",
      "confidence": 0.88
    }
  ],
  "openings": [
    {
      "id": "opening-001",
      "kind": "door",
      "centerPx": [700, 420],
      "widthPx": 90,
      "orientation": "vertical",
      "roomSeedId": "room-seed-living",
      "confidence": 0.86
    }
  ]
}
~~~

所有 Entity ID 必须唯一。Calibration / Wall / Seed / Opening 都必须在 Source Bounds 内。

## Reconstruction Algorithm

### 1. Near-axis Normalization

墙线先按 axisTolerancePx 判断：

~~~text
|dy| <= tolerance → horizontal
|dx| <= tolerance → vertical
otherwise          → unsupported / warning
~~~

这允许图像检测存在轻微倾斜，但不会把真正的斜墙硬压成横平竖直。

### 2. Coordinate Clustering

平行墙的 fixed coordinate 经过 snapTolerancePx 聚类：

~~~text
419 px
420 px
421 px
→ canonical 420 px
~~~

用于吸收线宽、抗锯齿和 Detector 抖动。

### 3. Blocked-edge Grid

所有 canonical X / Y 形成二维 Cell Grid。Wall Segment 会把对应 Cell Edge 标记为 blocked。

### 4. Room Seed Flood Fill

每个 Room Seed 找到所在 Cell 后做 Flood Fill。同一个连通域只允许一个 Room Seed。

如果两个 Seed 进入同一连通域，说明隔墙检测遗漏、Room Semantic Split 不合理，或 Open-plan 应该使用 Zone；此时直接失败，不生成重叠 Room。

### 5. Polygonization

Flood Fill Cell Union 的外边界会被追踪成闭合 Polygon，然后删除共线冗余顶点。

因此不仅支持矩形，也支持正交 L-shape。

当前如果一个 Room 产生多个 Boundary Loop，例如带洞空间，会直接失败而不是丢失洞信息。

### 6. Opening Mapping

Opening 根据 center / orientation / width 映射到最近合法 Room Edge。

如果提供 roomSeedId，只在对应 Room 上搜索；否则允许全局搜索，但多个候选距离几乎一致时会输出 ambiguity warning。

## Defaults and Human Review

Baseline 可以为缺失字段提供 Door Height、Opening Height、Window Height、Window Sill、Wall Thickness 和 Ceiling Height。

但是所有默认值都不是 Ground Truth。

Wall Thickness / Ceiling Height 在生成 FloorPlanDraft 时始终保持未确认；Opening 使用默认高度 / 窗台时也会产生 Warning。最终必须经过 PR #13 Human Review。

## Detector Contract

实际 Raw Image Detector 只需要实现 FloorPlanGeometryDetector，然后与 OrthogonalGeometryReconstructor 组合成 GeometryFloorPlanExtractor。

这意味着后续可以独立接 OpenCV、ONNX geometry model、internal vision service、VLM geometry proposal 或 CV + VLM hybrid，而不重写 Room Reconstruction。

Detector 输出在进入 Reconstruction 前仍会做 runtime validation。组合 Extractor 的 model metadata 会同时包含 Detector Model 与 Reconstructor ID，避免升级几何算法后实验记录仍看起来是同一个模型版本。

## CLI

从 Observation 生成 Candidate：

~~~bash
pnpm floorplan:geometry -- \
  .floorplan-corpus/observations/case-001.json \
  .floorplan-corpus/candidates/orthogonal-geometry-v0.1/case-001.json \
  --metadata .floorplan-corpus/metadata/orthogonal-geometry-v0.1/case-001.json
~~~

Smoke：

~~~bash
pnpm floorplan:geometry:check-demo
~~~

## Smoke Fixture

当前包含 3 个 Synthetic Observation：

~~~text
plan-a   → 5 rooms / 5 openings
plan-b   → 5 rooms / 6 openings
l-shape  → 1 L-shape room
~~~

Smoke 要求 Observation Schema 可解析、Reconstruction 不产生 Warning、Room / Opening 数量一致，并确认 L-shape 最终为 6 个边界顶点。

它只证明 Reconstructor 行为，不用于模型选型。

## 当前限制

PR #15 有意保持 Baseline 边界：

- 只处理正交 / 近正交墙线；
- 不直接 decode PNG / JPEG；
- 不做 PDF Rasterization；
- 不做 OCR；
- 不做 Room Text Detection；
- 不做 Door Symbol Detection；
- 不做斜墙 Polygon Reconstruction；
- 不做带 Hole 的 Room；
- 不自动把 Open-plan 拆成多个 Room；
- Grid Bounding Box 当前是计算域边界，外轮廓缺墙不会自动被判成“外部空间”，必须依赖 Detector 质量、Benchmark 与 Human Review 发现。

这些功能是否进入 Baseline，应由真实 10 Case Failure Slice 决定。

## 下一阶段

PR #16 应接一个真正 Raw Image Geometry Detector。

第一轮：

~~~text
10 anonymized real plans
→ Ground Truth
→ Raw Image Detector
→ Geometry Observation
→ Orthogonal Reconstructor
→ Benchmark
→ Human Review Burden
→ Pilot Report
~~~

如果失败主要来自 geometry / wall miss，优先继续 Geometry Detector；如果主要来自 room semantic / symbol ambiguity / text，再引入 VLM / OCR / Hybrid。

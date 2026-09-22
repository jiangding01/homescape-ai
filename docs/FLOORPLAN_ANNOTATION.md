# Floor Plan Ground Truth Annotation

## 目标

PR #13 的作用不是把 HomeScape 变成完整 CAD 编辑器，而是提供一个足够快的 Ground Truth / Human Review 工具，让真实户型 Extractor 有可重复的评测数据。

核心流程：

~~~text
户型原图
+
FloorPlanDraft Candidate
        ↓
Overlay
        ↓
人工几何 / 语义校正
        ↓
Ground Truth Gate
        ↓
Ground Truth JSON
+
Review Burden JSON
~~~

## 使用方式

在 Web 的 Real Floor Plan Workbench：

1. 加载示例 Draft 或导入 Candidate Draft JSON；
2. 上传对应 PNG / JPEG / WebP / SVG 户型图；
3. 拖动 Room Polygon 顶点对齐墙线；
4. 拖动 Calibration 两端对齐真实尺寸标注；
5. 校正 Room Name / Type；
6. 校正 Opening Kind / Offset / Width；
7. 确认墙厚与层高；
8. Ground Truth Gate 变为 READY；
9. 应用到 Candidate 验证；
10. 分别导出 Ground Truth 与 Review Burden Sidecar。

## Source Overlay

Canvas 采用 Draft Pixel Space：

~~~text
viewBox = 0 0 source.widthPx source.heightPx
~~~

如果真实图片只是等比例缩放，例如：

~~~text
Draft 1080 × 840
Image 2160 × 1680
~~~

仍然可以正确 Overlay。

如果宽高比不同则暂停 Overlay，因为强行拉伸会让 Polygon 校正失真。

## 当前可编辑项

Room：

- Polygon vertex drag
- name
- type

Opening：

- kind
- offsetPx
- widthPx

Calibration：

- startPx
- endPx
- realDistanceMeters

Assumptions：

- wallThicknessMeters
- wallThicknessConfirmed
- ceilingHeightMeters
- ceilingHeightConfirmed

## Ground Truth Gate

当前导出会检查：

- Draft Contract
- Source Dimensions
- Calibration Bounds / Distance / Real Distance
- Assumption 值与人工确认状态
- Room Type
- Room Bounds
- Polygon Area
- Polygon Self-intersection
- Duplicate Entity ID
- Opening Room / Edge
- Opening offset / width
- Opening height / sill vs ceiling
- Source / Draft Aspect Ratio

只有 Gate 为 READY 时才能导出。对于 floorplan_image，必须先加载对应原图；floorplan_pdf 在 PR #13 仍会被 Gate 阻断，等待后续 Rasterization / Page Selection。

## Review Burden

Review Burden 使用独立按钮导出：

~~~text
<source>.review-burden.json
~~~

Ground Truth 与 Sidecar 分开下载，避免浏览器一次用户手势触发多个文件下载时被多文件下载策略拦截。

示意：

~~~json
{
  "schemaVersion": "0.1.0",
  "sourceLabel": "case-001",
  "sourceKind": "floorplan_image",
  "startedAt": "2026-09-22T00:00:00.000Z",
  "completedAt": "2026-09-22T00:01:42.000Z",
  "durationMs": 102000,
  "totalEdits": 8,
  "editCounts": {
    "roomVertexMoves": 3,
    "roomMetadataEdits": 1,
    "openingGeometryEdits": 2,
    "calibrationEdits": 1,
    "assumptionEdits": 1,
    "resets": 0
  },
  "touchedRoomIds": ["room-living"]
}
~~~

这些数据后面会与 Benchmark 结构指标一起使用。

例如两个 Extractor 都有 0.92 Mean Room IoU，但：

~~~text
Extractor A 平均人工修正 25 秒 / 2 次操作
Extractor B 平均人工修正 90 秒 / 11 次操作
~~~

生产价值显然不同。

## 数据管理

真实数据仍建议使用：

~~~text
.floorplan-corpus/
├── corpus.json
├── sources/
├── ground-truth/
├── candidates/
└── reports/
~~~

Ground Truth 文件和 Review Burden Sidecar 可以先通过浏览器导出，再放入对应 Case 目录。

## 非目标

PR #13 暂不实现：

- PDF Rasterization
- CAD / DWG 编辑
- Polygon 增删顶点
- Opening Edge 拖拽重绑定
- 多楼层标注
- 自动吸附墙线
- OCR 尺寸自动确认

先用真实 10 Case Pilot 验证哪些编辑能力最影响标注效率，再决定下一轮。

## Review Sidecar 隐私边界

Review Burden Sidecar 不记录本地原图文件名，只保留 Source 尺寸与是否通过宽高比校验。

真实 Corpus 的 sourceLabel / Case ID 应使用匿名标识，避免把住址、客户姓名等信息写进 Ground Truth 或 Review Report。

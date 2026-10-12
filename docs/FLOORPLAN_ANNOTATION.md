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

## PR #17 · 真实样本无 Candidate 时的人工标注

首轮真实 Pilot 中仅 10/20 张生成未审核 Candidate，且多份存在漏分房 / 碎片化。
仅修改已有顶点无法标注 `no_orthogonal_outline` Case，因此现在支持：

1. 导入原图，输入**匿名** Case ID（勿使用地址 / 人名），点击「从原图开始空白标注」。该操作清空当前房间与 Opening，并将 Source 尺寸设为原图实际尺寸；**真实距离设为 0**，强制重新测量，不能用假设比例尺当 GT。
2. 点击「绘制新房间」，在原图上按房间真实边界依次点击任意数量的顶点；完成 / 撤销顶点 / 取消均可操作。无效、重复点、自交多边形不能完成。
3. 给新 Room 填写真实名称与类型；可删除误识别房间（连同其 Opening）；手工新增 Opening 时需逐项检查 Room Edge、Offset、Width、Kind。
4. 核对图片、房间划分、室内与室外的分类、所有 Opening、Calibration 与墙厚层高；勾选「已人工核对」后方可经原 Gate 导出 GT。
5. `roomStructureEdits` 记录新增或删除 Room 的次数；既有 Review Burden 允许该字段缺失，按 0 统计。此字段不会让手工生成的 Ground Truth 冒充自动 Candidate。

注意：PR #17 的手工标注能力并不能自动判断房间边界。原图、私有 Ground Truth 及任何带真实楼盘信息的素材都保留在 `.floorplan-corpus`，不能提交公开仓库。

### 未知墙厚 / 层高的诚实标注

对真实户型图片，墙厚与层高通常无法从平面图独立确认。Workbench 现在允许在人工完成空间几何复核后将 `wallThicknessConfirmed` / `ceilingHeightConfirmed` 保持为 `false`，不会为了通过 Gate 而冒充确认。数值仍是 Draft 的临时假设；后续若取得可靠建筑数据再标记 confirmed=true。**Calibration 则必须有实际的已知尺寸线；未知比例尺时仍不得导出正式 GT。**

图纸中无法归入室内类型的室外花园暂记为 `type: other` + `name: 花园`，并在内部审核记录说明室外语义。正式室外 Zone Contract 待后续单独设计，不能强行标成客厅或阳台。

从空白原图手工建立 GT 的耗时属于**GT 创建工作量**，不代表某个 Extractor 的 Candidate 修正成本；不能把这种 Sidecar 混入 Extractor Review Burden 均值，否则会污染模型比较。

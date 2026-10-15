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
- basis（可选）

### 双轴标定与比例尺来源

网络户型图常被非等比缩放（实测横纵 px/m 可差 10%–17%），单一比例会让房间面积系统性偏大或偏小。协议因此支持两条标定：

- `calibration`：横向标定（沿 x 轴的尺寸线），给出 sx；若没有 `calibrationY`，它就是唯一标定，按等比处理（与旧数据一致，不限制方向）。
- `calibrationY`（可选）：纵向标定（沿 y 轴的尺寸线），给出 sy。提供后导入按 x / y 分轴换算，开口宽度按所在边方向换算。
- 双轴时横向标定须 |dx| ≥ |dy|、纵向标定须 |dy| ≥ |dx|，否则 Draft 无效、导入报错：方向写反会静默互换 sx / sy，误差与要修的问题同量级，不能只当警告。
- `basis` 表示比例尺来源：`assumed`（假设 px/m，如 Raster 默认值）、`annotated`（人工沿尺寸线标注）、`extracted`（自动从图上尺寸标注读出）、`structured`（米制结构化数据换算）。缺省视为旧数据未声明来源。
- `basis: 'assumed'` 导入时生成 `issue-calibration-assumption`（双轴时为 `issue-calibration-x/y-assumption`）待确认问题，阻断 Finalize，与墙厚 / 层高未确认一致；缺省 basis 不阻断，以兼容已有人工 GT。
- 标注工作台：可添加 / 移除纵向标尺（蓝色，横向为红色），两端可拖动、距离可输入；拖动端点或修改距离后该标定 `basis` 记为 `annotated`。新增纵向标尺的初始距离按横向比例推算，仍记为 `assumed`，直到人工确认。纵向标定的编辑计入 Review Burden 的 `calibrationEdits`，导出的 Ground Truth 含 `calibrationY`。
- Benchmark 分别比较 X / Y 轴比例尺（任一侧缺 Y 时回退到 X），报告新增 `scaleErrorRatioX` / `scaleErrorRatioY`，原 `scaleErrorRatio` 取两轴最大值。

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
\n## PR #17 · 精细标注操作

首份真实人工标注（case-001，7 Room / 12 Opening）耗时约 35 分钟，因绘制区域小和线段偏移增加了修正成本。现支持：

- 大画布专注模式；
- SVG viewBox 1～8 倍放大、缩小、适应视野，以及切换「平移画布」后拖动；缩放不更改原始像素坐标及 Ground Truth 契约；
- 默认开启正交绘制，新线段根据点击位置主方向被约束为水平/垂直；斜墙和曲线墙需要先关闭；
- 至少 3 个顶点后点击起点附近闭合（仍执行无效面积、自交、零长度边校验）；正交模式要求尾边亦正交，必要时先补拐点或绘制过程中关闭正交模式；
- 绘制时预览下一条线段及高亮首点。

墙厚、层高「已确认」仅适用于有可靠建筑资料时；仅有默认数值保持 confirmed=false。操作前/升级前建议导出 GT 与 Review Sidecar。自动正交约束不是自动识别墙体或自动确定 Ground Truth。

## PR #17 · 顶点编辑、键盘平移与全屏工作区

针对首个真实样本在放大模式下仍有频繁顶点修正的问题：
- 选中已完成 Room 的顶点后，可在侧栏删除该顶点或向下一边插入中点；不必删除整个房间重画。
- 至少保留三个顶点；如果删除或插入会改动关联 Opening 所在的墙边，则阻止该操作，并提示先处理对应门窗。其他 Opening 的 edgeIndex 将随顶点顺序重新映射。
- 在画布上按住 macOS Option（Alt）并拖动可临时平移，松开后恢复原有编辑模式；输入框、下拉框不受影响，窗口失焦释放临时模式。
- 鼠标位于画布上（或专注模式）时，用 `]` 放大、`[` 缩小、`0` 适应画布。Cmd / Ctrl 组合键不予拦截，避免影响浏览器原生缩放。
- 修复专注模式样式边界，固定工作区占满视口，右侧栏独立滚动，可一键隐藏并恢复。
- 修改任何 Room 几何后清空已确认状态，仍需人工复核方可导出 Ground Truth。

**Review Burden 精度**：只点击顶点以选中不再计作 `roomVertexMoves`，只有实际移动超过 1 个源图像素的拖动才记录一次；标尺拖动同理。此前的操作次数可能包含选中点击，进行跨版本效率比较时必须注明计数口径变化。

## PR #17 · 全屏工作区滚轮穿透修复

全屏标注时，背景首页不得随着鼠标滚轮或触控板滚动。进入「大画布专注模式」时临时锁定 HTML/body 的背景滚动；右侧房间、Opening 与 Calibration 表单继续独立滚动，且滚动到顶/底不会继续传递到背景。退出专注模式、React 卸载或开发期热更新时，恢复进入前的滚动样式。保留 Option 临时平移及 `[`、`]`、`0` 快捷键，不修改户型图或标注数据。

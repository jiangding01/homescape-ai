# Raw Raster Geometry Detector Baseline

## 目标

PR #16 建立第一个真正读取 PNG / JPEG 像素的 Geometry Detector Baseline。

它的定位是：

~~~text
Raw Raster
→ Geometry Observation
~~~

不是直接输出 HomeSpatialModel，也不是最终模型选型结果。

## Pipeline

~~~text
PNG / JPEG
→ SharpRasterImageDecoder
→ Uint8 Luminance
→ RasterGeometryDetector
→ Geometry Observation
→ OrthogonalGeometryReconstructor
→ FloorPlanDraft
→ Benchmark / Human Review / Pilot
~~~

## Decoder

Node Decoder 位于：

~~~text
@homescape/floorplan-extractor/node
~~~

主 package entry 不导出 Sharp，因此 Web Workbench 不会引入 Node Native Dependency。

Decoder 处理：

- PNG
- JPEG
- EXIF rotate
- sRGB normalize
- alpha → white composite
- luminance
- input byte limit
- input pixel limit

透明区域合成到白色而不是黑色，避免透明 PNG 背景被错误识别成大面积墙体。

## Wall Scan

每一行与每一列分别执行 Dark Run Scan。

只有长度达到：

~~~text
max(minWallRunPx, min(width, height) * minWallRunRatio)
~~~

的连续暗区才进入 Wall Candidate。

默认：

~~~text
minWallRunPx          = 20
minWallRunRatio       = 0.08
darkThreshold         = 96
minOpeningWidthRatio  = 0.05
largeOpeningWidthRatio = 0.20
maxOpeningWidthRatio  = 0.45
~~~

较高的 8% Ratio 是有意设置，用于先过滤大量短文本线、家具边缘和尺寸短线。

## Wall Band

连续多行 / 多列都出现 Long Dark Run 时合并为一个 Wall Band。

Band 的固定坐标取平均值：

~~~text
y = mean(rows)
x = mean(columns)
~~~

这样可以把 8~12 px 墙厚还原为单条中心墙线。

## Opening Gap

同一 Wall Band 内，如果两个 Long Run 之间存在白色 Gap：

~~~text
minOpeningWidthRatio * min(imageWidth, imageHeight)
<= gap <=
maxOpeningWidthRatio * min(imageWidth, imageHeight)
~~~

则：

- Wall Topology 继续视为连通墙；
- 同时记录一个 Opening Observation。

因此 Door / Window 不会让 Room Flood Fill 直接泄漏到相邻空间。

## Room Seed

完成 Wall Topology 后：

~~~text
wall grid
→ blocked edges
→ connected components
→ one geometric seed per component
~~~

第一版 Seed 只表达“这里存在一个空间”，不猜 room type / room name。

Room Semantic 仍留给后续 OCR / VLM / Company Data。

## Opening Kind

第一版启发式：

- 外轮廓 Gap → window
- 内部大 Gap → opening
- 其他内部 Gap → door

所有结果都需要 Human Review。

## Calibration

Raster 没有尺度真值时，通过：

~~~text
--pixels-per-meter
~~~

提供 provisional scale。

默认 100 px/m，只用于形成可运行 Candidate，并且 Detector 会明确输出 Warning。

有尺寸标注的真实图后，应增加 Dimension Detector / OCR。

## CLI

~~~bash
pnpm floorplan:raster -- \
  input.png \
  .floorplan-corpus/candidates/raster-orthogonal-v0.1/case-001.json \
  --metadata .floorplan-corpus/metadata/raster-orthogonal-v0.1/case-001.json \
  --source-id case-001 \
  --pixels-per-meter 100
~~~

如果没有传 source-id，会使用图片 SHA-256 Prefix 生成匿名 ID。

## E2E Smoke

~~~bash
pnpm floorplan:raster:check-demo
~~~

Smoke 在运行时生成同一张 Synthetic Plan 的：

- PNG
- transparent PNG
- JPEG

然后执行完整链路：

~~~text
encoded image
→ Sharp decode
→ luminance
→ wall / opening detect
→ room seed
→ geometry observation
→ orthogonal reconstruction
→ FloorPlanDraft
~~~

当前 Smoke 断言：

~~~text
6 wall lines
4 room seeds
6 opening observations
4 reconstructed rooms
6 reconstructed openings
wall / ceiling assumptions remain unconfirmed
~~~

Fixture 中故意加入短家具 / 文本样式线段，用于验证默认 minWallRunRatio 不会把这些短线直接当成主墙；transparent PNG 用于验证透明背景会先合成白色，不会被误识别成整片黑墙。

该 Smoke 也作为现有 CI quality job 的一个轻量步骤运行，不新增独立 CI Job。

## Known Failure Modes

当前必须重点通过真实 Corpus 验证：

1. 文本 / 尺寸长线被识别为墙；
2. 墙体被家具遮挡后形成 false opening；
3. 门窗符号导致 Gap 宽度不稳定；
4. 外墙断裂造成 Room Leak；
5. 双线墙 / 填充墙造成重复 Wall Band；
6. 压缩 JPEG / 扫描件灰度变化；
7. 非正交、弧形、斜墙；
8. 尺度未知。

这些问题不应该继续靠 Synthetic Fixture 猜参数。

## 下一步

PR #17 使用真实 10 Case 跑：

~~~text
Ground Truth
+ Raster Candidate
+ Structure Benchmark
+ Human Review Burden
+ Pilot Report
~~~

再决定是否需要：

- morphology
- Hough / LSD
- connected component cleanup
- OCR dimension detector
- room semantic VLM
- symbol detector
- learned geometry model

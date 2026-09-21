# ADR-0009：真实户型采用 Candidate + Human Review 导入链路

- Status: Accepted for P1
- Date: 2026-09-21

## 决策

P1 不把“户型图片识别结果”直接当成 HomeSpatialModel 真值。

真实户型输入统一经过：

~~~text
Floor Plan Image / PDF / Company Data
              ↓
       Upstream Extractor
              ↓
        FloorPlanDraft
像素坐标 + 标尺 + confidence
              ↓
   FloorPlanDraftImporter
              ↓
 HomeSpatialModel Candidate
              ↓
Validation + Unresolved Issues
              ↓
        Human Review
              ↓
   Final HomeSpatialModel
~~~

FloorPlanDraft 是过渡协议，不是长期住宅空间真值。

## 为什么先做 Human-in-the-loop

户型图存在大量现实问题：

- 尺寸缺失或模糊
- 非标准绘图比例
- 房间文字遮挡
- 门窗符号风格不一致
- 共墙拓扑不完整
- 开放空间边界不明确
- 承重墙、梁柱、设备点可能缺失

P1 的目标是建立可运行、可校正、不会把不确定数据伪装成真值的链路，而不是追求一次全自动识别。

## FloorPlanDraft

Draft 使用图像像素坐标，并至少携带：

- source width / height
- 一条 calibration 标尺
- Room polygon
- Opening 所在 Room edge
- confidence
- 明确的 wall thickness / ceiling height 假设

Importer 将像素坐标归一化为：

- meter
- right-handed
- Y-up

然后生成 HomeSpatialModel Candidate。

## 共享墙与拓扑

P1 Draft Contract 要求上游在共墙交点处切分 Room polygon 边，使真正共享的墙段拥有相同端点。

Importer 对反向相同边进行去重，并根据 Door / Opening 所在共享墙自动生成 RoomConnection。

后续更强的几何 Normalizer 可以支持容差吸附、部分共线边切分和 CAD 级拓扑修复，但不阻塞当前 Vertical Slice。

## Review Gate

以下情况进入 unresolved issue：

- unknown room type
- low confidence
- missing dimension assumption
- ambiguous opening
- topology conflict

只有：

1. HomeSpatialModel validation 通过；
2. 所有 requiresHumanReview 问题被确认或校正；

才能 Finalize Candidate。

## Correction

Review 不直接改 3D Scene，而是修改 Candidate HomeSpatialModel。

首批 Correction 支持：

- set room type
- set room ceiling height
- set wall thickness
- resolve reviewed issue

最终仍由统一 validation 再次门禁。

## 非目标

PR #7 不实现完整 CV / OCR / VLM 自动户型识别模型。

后续 Extractor 可以是：

- 公司已有户型数据
- CV + geometry pipeline
- VLM-assisted extraction
- CAD / DXF parser
- 人工标注工具

只要输出 FloorPlanDraft 或直接实现 SpatialImporter 即可。

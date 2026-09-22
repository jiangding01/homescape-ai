# Floor Plan Extractor Benchmark

## 目标

把“户型识别看起来不错”转换成可重复、可比较、可回归的结构化评测。

Benchmark 的唯一 Candidate Contract 是 FloorPlanDraft v0.1。

## 快速运行

~~~bash
pnpm floorplan:benchmark
~~~

当前 Fixture 同时包含：

- reference-json：预期通过
- degraded-json：预期失败

默认模式检查 expectedGate 是否符合实际结果，因此 negative fixture 不会让命令失败。

如果要把某个 Extractor 当成 Release Gate：

~~~bash
node tools/floorplan-benchmark.mjs path/to/manifest.json \
  --require-pass \
  --report .floorplan-benchmark/report.json
~~~

此时任意 Candidate 未通过 Threshold，进程都会返回非 0。

## Manifest

~~~json
{
  "schemaVersion": "0.1.0",
  "dataset": "real-floorplans-v1",
  "gridSize": 128,
  "thresholds": {
    "roomMatchIou": 0.6,
    "roomPrecisionMin": 0.95,
    "roomRecallMin": 0.95,
    "meanRoomIouMin": 0.9,
    "roomTypeAccuracyMin": 0.9,
    "candidateRoomOverlapRatioMax": 0.03,
    "openingCenterToleranceRatio": 0.02,
    "openingPrecisionMin": 0.9,
    "openingRecallMin": 0.9,
    "meanOpeningWidthErrorMax": 0.08,
    "scaleErrorMax": 0.02
  },
  "cases": []
}
~~~

Threshold 应由真实数据和业务容忍度校准，不要因为某个模型当前分数低就反向调低门槛。

## Case

每个 Case 包含：

~~~text
source image / pdf
ground-truth FloorPlanDraft
candidate A FloorPlanDraft
candidate B FloorPlanDraft
...
~~~

Candidate 通过 extractorId 区分。

Benchmark 不要求 Candidate ID 与 Ground Truth ID 一致。

## Room Metric

Room Match 流程：

~~~text
all Ground Truth Room × all Candidate Room
→ raster Polygon IoU
→ IoU descending
→ one-to-one greedy match
→ threshold filter
~~~

输出：

- roomPrecision
- roomRecall
- meanRoomIou
- roomTypeAccuracy
- maxCandidateRoomOverlapRatio

Candidate Room 两两之间还会计算 overlap ratio = intersection / min(roomA area, roomB area)。这样即使一个小房间被完全错误地嵌套在大房间内，也会得到接近 1 的重叠率而被阻断。共享边本身不会产生面积，因此不会被当成重叠。

Greedy Match 是当前 P1 实现。真实 Corpus 出现大量重叠 / 嵌套复杂 Room 时，可以升级为 Hungarian / min-cost matching，但 Metric Contract 不需要变化。

## Opening Metric

Opening 先依赖已匹配 Room。

Opening Center 根据：

~~~text
room edge start
+ normalized(edge vector) × (offset + width / 2)
~~~

再按：

- matched room
- same kind
- nearest center
- normalized center tolerance

做一对一匹配。

Width Error 单独计算，避免“中心点对了但门宽严重错误”仍然通过。

## Calibration Metric

使用 Pixels Per Meter 相对误差。

这允许不同 Extractor 选择不同的标尺线，只要最终比例一致。

## Source Integrity

Candidate 还必须满足：

- source kind 与 Ground Truth 一致
- source width / height 一致
- Draft 基础结构合法
- Room / Opening ID 唯一
- Opening 不越出其 Room Edge

## Provider Metadata

@homescape/floorplan-extractor 的 Result Metadata 预留：

- provider
- model
- latencyMs
- token usage
- costUsd
- traceId

Benchmark Report 当前聚焦几何正确性；后续真实模型跑数时，应把质量指标与 latency / cost 放在同一个实验记录中，但不要把它们混成一个不可解释的总分。

## Production Corpus

Smoke Fixture 不能用于选型。

真实数据建议第一批 30~50 张，并按以下维度分层抽样：

| 维度 | 示例 |
| --- | --- |
| Source | PNG / JPEG / PDF / scan |
| Quality | clean / compressed / blurred |
| Geometry | rectangular / L-shape / irregular |
| Annotation | full dimension / partial / none |
| Layout | one-room / open-plan / multi-room |
| Symbols | different door/window conventions |
| Text | clear / overlapping / dense |

每张 Ground Truth 都需要人工确认，并且所有 Room 必须有明确 type。Benchmark 会拒绝 Room Type 不完整的 Ground Truth，避免 Type Accuracy 被缺失标注虚高。

## 建议实验矩阵

第一轮建议至少比较：

~~~text
A. Company structured-data baseline
B. CV / geometry baseline
C. VLM structured extraction
D. CV geometry + VLM semantics hybrid
~~~

最终是否采用某个方案，要看真实 Corpus 上的结构指标、Review Burden、延迟、成本和失败模式，而不是单张 Demo 效果。

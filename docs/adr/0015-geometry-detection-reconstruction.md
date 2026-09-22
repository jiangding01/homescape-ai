# ADR 0015: Split Geometry Detection from Reconstruction

- Status: Accepted
- Date: 2026-09-22

## Context

Floor Plan Extractor 已经有统一 FloorPlanDraft 输出和 Benchmark，但 Raw Image 户型识别同时包含两类职责：

1. 像素感知：墙、门窗、文字、尺度、Room Semantic；
2. 拓扑重建：闭合空间、共享墙、Room Polygon、Opening on Edge。

如果每个 CV / VLM Provider 都直接生成 FloorPlanDraft，则确定性空间重建会被重复实现，也很难区分“感知失败”和“拓扑算法失败”。

## Decision

新增中间协议 FloorPlanGeometryObservationV01，并明确两层：

~~~text
FloorPlanGeometryDetector
→ Geometry Observation
→ OrthogonalGeometryReconstructor
→ FloorPlanDraft
~~~

Detector 可替换；Reconstructor 保持 Vendor-neutral 和 deterministic。

FloorPlanGeometryDetector 的输出必须在运行时重新校验，不能因为 TypeScript 类型就被当作可信输入。

## Consequences

优点：

- CV / VLM / Hybrid 可以复用同一 Reconstruction；
- Benchmark Failure 可以区分 Detector 与 Reconstruction；
- Room Topology 不依赖 AI Vendor；
- Synthetic Smoke 可以独立验证几何算法；
- 后续可以 Shadow 多个 Detector 而不改变 Importer。

代价：

- 多一个 Observation Contract；
- 需要维护 Observation Schema Version；
- 当前 Orthogonal Baseline 无法覆盖所有异形空间。

## Non-goals

本 ADR 不决定 OpenCV / Neural CV / VLM / OCR Provider，也不冻结真实图像 Detector 参数；这些必须基于真实 Corpus Pilot 决定。

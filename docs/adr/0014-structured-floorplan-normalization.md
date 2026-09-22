# ADR-0014：公司结构化户型先归一化，再进入统一 Extractor Contract

- Status: Accepted for P1
- Date: 2026-09-22

## 决策

公司结构化户型数据不直接写 HomeSpatialModel。

先映射到 MetricStructuredFloorPlanV01，再通过 metric-structured-v0.1 生成 FloorPlanDraft。

## 原因

HomeScape 已经有稳定链路：

~~~text
FloorPlanDraft
→ Importer
→ Unresolved Issues
→ Human Review
→ Validation
→ HomeSpatialModel
~~~

如果 company_data 直接构造 HomeSpatialModel，会绕过这套门禁并产生第二条空间真值入口。

## Metric Coordinate

Normalized Structured Contract 使用 meter + X/Z 平面。

Extractor 确定性转换到 FloorPlanDraft Pixel Space，默认 100 px/m，再通过 calibration 恢复 metric。

## Raw Company Schema

PR #12 不猜测公司真实 Schema。

后续 Company Adapter 的职责只是：

~~~text
Raw Company Data
→ MetricStructuredFloorPlanV01
~~~

字段差异被限制在 Mapper 内。

## Corpus

真实户型 Corpus 默认保存在被 Git 忽略的 .floorplan-corpus。

只有去敏后的 Manifest、统计规则或公开 Fixture 才考虑进入仓库。

## 非目标

本 ADR 不决定 CV / VLM Provider，也不根据 Synthetic Fixture 做 Extractor 排名。

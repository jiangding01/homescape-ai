# ADR-0013：户型 Extractor 先 Benchmark，后选 Provider

- Status: Accepted for P1
- Date: 2026-09-22

## 决策

HomeScape 不把某个 CV / VLM Provider 直接写入 Floor Plan Import 主链路。

所有 Extractor 必须实现统一 FloorPlanExtractor Contract，并输出 FloorPlanDraft。

Provider 选择必须基于同一 Ground Truth Corpus 和同一 Benchmark Gate。

## 原因

户型识别输出最终会影响：

- HomeSpatialModel
- Planner 可用空间
- 门窗净空
- 商品碰撞
- 3D 尺度

因此“视觉上大体像”不足以作为选型依据。

## ID Independence

Benchmark 不要求 Candidate Room / Opening ID 和 Ground Truth 一致。

Room 先用 Polygon IoU 做一对一几何匹配；Opening 再在匹配 Room 内按 Kind + Center 匹配。

## Offline Evaluation

Benchmark CLI 消费已生成 Candidate JSON，而不是直接调用 Provider。

这样可以：

- 可重复评测
- 保存历史输出
- 避免 API 波动影响 Metric
- 独立统计调用成本 / 延迟
- 对 Provider / Model Version 做回归

## Fixture Boundary

仓库自带 Fixture 只验证 Benchmark Harness 正常工作。

任何生产技术选型必须基于真实户型 Corpus，第一阶段目标至少 30~50 张并人工校验 Ground Truth。

## 后续

下一阶段先建立真实 Corpus，再实现第一个实际 Adapter。没有真实数据前不宣布 CV、VLM 或 Hybrid 的最终选择。

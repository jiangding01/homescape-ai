# ADR-0003：Renderer 解耦

- Status: Accepted
- Date: 2026-09-21

HomeSpatialModel / Design State 与具体 3D Engine 解耦。

当前候选：

- Babylon.js
- Three.js / React Three Fiber

最终选择等待 Whole-home Runtime Benchmark。Renderer Adapter 负责把 canonical right-handed Y-up / meter 模型转换为具体引擎。

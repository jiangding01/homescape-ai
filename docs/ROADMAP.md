# Roadmap

## P0 — Foundation

- [x] Monorepo
- [x] Spatial Model contract
- [x] DesignOperation / Revision contract
- [x] AI Capability Runtime contract
- [x] Planner contract
- [x] Renderer contract
- [x] CI 基础链路
- [ ] 首次 pnpm lockfile
- [ ] 基础单元测试

## PR #2 — HomeSpatialModel Core

- [x] Canonical meter / right-handed / Y-up
- [x] Room / Zone / Wall / Opening
- [x] Column / Beam / Utility Anchor
- [x] Room Connection / Room Graph
- [x] provenance / confidence
- [x] Spatial Importer / unresolved issue contract
- [x] 空间模型 validation
- [x] 真实尺度多空间 fixture
- [x] 2D Debug View

## PR #3 — Parametric Room Renderer

- [x] RenderSnapshot 单向同步边界
- [x] Babylon.js 首个 Renderer Adapter
- [x] 参数化 Room floor / Wall / Opening
- [x] Column / Beam / Utility Anchor
- [x] Scope focus contract
- [x] 3D / 2D Debug 双视图
- [ ] Whole-home Runtime Benchmark

## PR #4 — Design State + Revision Engine

- [x] DesignState
- [x] DesignObject / Material / StyleIntent / Lock
- [x] ResolvedDesignMutation
- [x] Revision commit
- [x] inverseMutations
- [x] Undo / Redo
- [x] Replay
- [x] expectedParentRevisionId 乐观并发控制
- [x] Lock enforcement
- [x] DesignState → RenderSnapshot
- [x] Renderer Contract 移除 Planner 类型依赖
- [x] Web Revision Demo

## P1 — Real Room Vertical Slice

目标：证明真实产品价值，而不是完成整个平台。

- 户型图输入
- 客厅 / 客餐厅识别与快速人工校正
- 参数化房间 3D
- 有限家具 Catalog
- 初始风格设计
- 自然语言连续修改
- Room / Zone / Object Scope
- Planner：Anchor + Collision + Scoring
- 实时 3D
- Undo / Redo / Revision
- AI 调试面板

验收核心：

> 用户上传真实户型图后，可以获得一个可编辑客厅，并通过自然语言连续修改家具、材质、颜色、数量和布局；有效修改在约 1~2 秒进入实时预览。

## Technical Spikes

1. Floor Plan → HomeSpatialModel
2. Whole-home Runtime Benchmark
3. Constraint Planner
4. AI Decision Runtime
5. Asset Pipeline
6. End-to-End Vertical Slice

## P2 — Whole Home

多 Room / Zone、整屋总览、Global Design Language、跨空间一致性、Room Streaming / LOD、Preference Profile。

## P3 — Real Commerce

真实 SKU、库存/价格、预算、BOM/报价、商品替换与推荐。

## P4 — Delivery

施工规则、物料、阶段衔接、验收与交付。

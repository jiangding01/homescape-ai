# Roadmap

## P0 — Foundation

- [x] Monorepo
- [x] Spatial Model contract
- [x] DesignOperation / Revision contract
- [x] AI Capability Runtime contract
- [x] Planner contract
- [x] Renderer contract
- [ ] 首次 pnpm lockfile
- [ ] 基础单元测试
- [ ] CI 全绿

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

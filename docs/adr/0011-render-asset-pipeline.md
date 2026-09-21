# ADR-0011：视觉资产采用离线标准化 + Runtime Manifest

- Status: Accepted for P1
- Date: 2026-09-21

## 决策

CatalogAsset 的业务尺寸与规则是 Planner 真值；glTF / GLB 只是视觉表达。

浏览器 Runtime 不负责猜测或修正 source unit、axis 与 pivot。

进入 Runtime 的模型必须已经满足：

- meter
- right-handed-y-up
- floor-center pivot

## 依赖边界

Domain 只保存 assetId / variantId。

Renderer Contract 定义通用 RenderAssetSource。

Web/应用层通过 assetId 把 Catalog Render Asset 映射到 RenderSnapshot。

Babylon Adapter 只消费 RenderSnapshot，不依赖 Catalog package。

## 缓存

Babylon 使用 AssetContainer 以 version + URI 为 key 缓存模型源，并按 DesignObject 实例化。

## Fallback

模型加载失败时，以 Catalog dimensions 生成 deterministic proxy。

不能因为视觉资源不可用而破坏空间方案、Revision 或 Undo / Redo。

## Demo 与生产

仓库内 Demo glTF 仅用于验证 Pipeline Contract。

公司真实 SKU 必须通过后续离线 Ingestion / QA 流水线后才能标记为 Production Asset。

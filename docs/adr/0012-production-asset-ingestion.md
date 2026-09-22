# ADR-0012：Production Asset Ingestion 采用严格 QA Gate

- Status: Accepted for P1
- Date: 2026-09-21

## 决策

真实商品模型必须在进入 Catalog Activation 前通过离线 Ingestion Gate。

Runtime 只加载已发布资产，不承担单位、坐标轴、Pivot、尺寸、LOD 或压缩修复。

## Source Root

Manifest 必须显式声明 sourceRoot。

所有 sourcePath 必须落在 sourceRoot 内，并通过 realpath 再次确认，避免符号链接绕过目录边界。

Catalog Asset ID 与 Release Version 会进入输出路径，因此禁止 . / .. 等危险 path segment；SKU 不参与文件路径，不额外改变业务格式。

## Geometry Truth

Catalog expectedDimensions 是业务尺寸真值。

Ingestion 从 glTF Scene Graph 计算 World Bounds，并验证：

- width / height / depth
- floor-center pivot

超出 Policy tolerance 时阻断。

## Release Atomicity

先检查整批资产。

只要有一个资产 blocked，就不复制任何模型 Bundle，只输出 blocked report。

只有全批 ready 才生成 asset-release.json。

## Compression

PR #10 会验证实际 Meshopt / KTX2 使用，并拒绝 Draco，但不内置编码器。

转换与压缩属于 Processor Adapter。这样 Pipeline 可以替换 Blender、gltf-transform、内部 DCC 服务或其他工具，而不改变 Catalog / Runtime Contract。

## Activation

Release 必须通过 @homescape/asset-pipeline 的 Activation Gate，才能转换为 CatalogRenderAsset Map。

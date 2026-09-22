# HomeScape AI Architecture v0.10

## 1. 当前端到端闭环

~~~text
Real Floor Plan
→ Candidate + Human Review
→ Active HomeSpatialModel
→ Natural Language
→ DesignOperation[]
→ Catalog + Planner
→ DesignState / Revision
→ RenderSnapshot
→ Babylon glTF / GLB Runtime
~~~

视觉资产链路现在进一步扩展为：

~~~text
Prepared glTF / GLB Candidate
→ Production Asset Ingestion
→ Geometry / Budget / Security QA
→ Release Manifest
→ CatalogRenderAsset Activation
→ Runtime
~~~

PR #10 的重点不是在浏览器中继续增加模型修复逻辑，而是把“不合格资产不能进入 Catalog”变成可执行 Gate。

## 2. Asset Pipeline 边界

当前资产系统分为三层：

### Source / Processor

DCC、供应商或公司资产系统提供源模型。原始 FBX / OBJ / USD 的转换、减面、Meshopt、KTX2 等属于 Processor 层。

PR #10 不伪造这些能力，而是要求 Processor 产出 glTF / GLB Candidate，再由 Ingestion Gate 验证。

### Production Asset Ingestion

新的离线 Ingestion 工具负责：

- Manifest / Source Root
- glTF / GLB 2.0 解析
- Node Transform 后的 World Bounds
- Catalog Dimensions QA
- floor-center Pivot QA
- Triangle / File / Texture Budget
- LOD QA
- Meshopt / KTX2 / Self-contained GLB Policy
- 安全资源路径检查
- SHA-256 / byteSize
- Release Manifest
- Activation Gate

### Runtime

Runtime 只加载已经激活的 CatalogRenderAsset，不承担生产资产修复职责。

## 3. Geometry QA

商品尺寸仍以 Catalog 为业务真值。

Ingestion 根据 glTF Scene Graph，把 Mesh POSITION accessor 的 local bounds 经过 Node world transform 后计算最终 AABB：

~~~text
POSITION min/max
→ Node local transform
→ parent world transform
→ World Bounds
→ width / height / depth
→ compare Catalog dimensions
~~~

同时检查：

~~~text
centerX ≈ 0
minY    ≈ 0
centerZ ≈ 0
~~~

以确认 floor-center Pivot。

POSITION accessor 缺少 min / max 时直接阻断，因为 Ingestion 无法证明模型尺寸正确。

## 4. Production Policy

Policy 可按业务调整，但默认生产建议要求：

- LOD0 存在
- LOD triangle 不随级别增加
- LOD0 / LOD1 / LOD2 都必须配置 Triangle Budget
- LOD0 / LOD1 / LOD2 都必须配置 File Size Budget
- Texture Edge Budget
- self-contained GLB
- 实际 BufferView 使用 EXT_meshopt_compression
- 实际 Texture/Image 使用 KTX2 / KHR_texture_basisu（存在纹理时）
- 禁止 KHR_draco_mesh_compression
- 禁止 Animation / Skin / Morph Target

Demo Fixture 可以使用宽松 Policy 验证流程，但不能因此获得 Production SKU 身份。

## 5. Security

Manifest 明确声明 sourceRoot。

所有 sourcePath 必须位于 sourceRoot 内；检查同时使用 realpath，避免通过符号链接绕过目录边界。

Catalog Asset ID 与 Release Version 会进入发布路径，因此只允许安全路径字符并禁止 . / ..。SKU 只作为业务标识与报告字段，不强行限制为路径字符集。

glTF 外部 Buffer / Image：

- 不允许 HTTP / HTTPS 等远程引用
- 不允许绝对路径
- 不允许越过模型所在目录

Publish URI 由 Ingestion 生成，不直接信任 Source Filename。

## 6. Transactional Release

Ingestion 先完成整批 SKU 的 QA。

~~~text
inspect all assets
        ↓
any blocked?
   ├─ yes → no model files published
   │        asset-release.blocked.json
   └─ no  → copy bundles
            asset-release.json
~~~

避免“前几个 SKU 已发布、后一个 SKU 失败”形成半发布状态。

## 7. Activation Contract

@homescape/asset-pipeline 提供 Release 类型和 Activation Gate。

只有 release.status === ready 且每个 Record 都带 renderAsset 时，才能收集成：

~~~text
catalogAssetId → CatalogRenderAsset
~~~

这让后续 API / Catalog 同步可以共享同一个发布语义。

## 8. 当前未实现能力

PR #10 尚未内置：

- FBX / OBJ / USD → glTF / GLB 转换
- 自动 LOD 生成
- Meshopt 编码
- KTX2 转码
- CDN / OSS 上传
- 公司真实 SKU 数据源 Adapter

这些是明确的 Processor / Publisher Adapter，不应该通过 Runtime 猜测补齐。

## 9. P1 下一重点

Real Room 的空间、设计、AI、Catalog、Render Asset 与 Production Ingestion 基础闭环已经形成。

下一轮更值得优先验证的是：

~~~text
真实户型图片 / PDF
→ Extractor
→ FloorPlanDraft
→ Benchmark
→ Human Review
→ HomeSpatialModel
~~~

以补上目前 P1 最大的真实输入缺口。

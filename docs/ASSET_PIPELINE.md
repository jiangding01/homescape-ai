# Production Asset Pipeline

## 目标

PR #9 建立了 Runtime glTF / GLB 加载链路；PR #10 把质量门禁前移到离线 Ingestion。

核心原则：

> Catalog dimensions 是业务尺寸真值；不合格视觉资产不能进入 Catalog Activation。

## 1. 输入边界

当前 Ingestion 接受已经转换为 glTF 2.0 / GLB 2.0 的 Candidate。

~~~text
FBX / OBJ / USD / DCC Source
        ↓
external / future Processor
        ↓
glTF / GLB Candidate
        ↓
HomeScape Asset Ingestion
~~~

PR #10 不在 Node 脚本里实现 DCC 级转换，也不会假装已经完成 Meshopt / KTX2 编码。

## 2. Manifest

Asset Ingestion Manifest v0.1：

~~~json
{
  "schemaVersion": "0.1.0",
  "releaseVersion": "2026.09.21.1",
  "sourceRoot": "../../../asset-source",
  "catalogBaseUri": "https://cdn.example.com/homescape/assets",
  "policy": {},
  "assets": []
}
~~~

sourcePath 相对于 sourceRoot，而不是相对于进程 cwd。

这使 Manifest 可迁移，同时阻止单个 SKU 通过 ../ 越出允许的 Source Root。

## 3. Geometry QA

Ingestion 会解析 glTF Scene Graph：

~~~text
Accessor POSITION min/max
→ Node matrix / TRS
→ parent world transform
→ final world AABB
~~~

得到：

- width
- height
- depth
- min / max

再和 Catalog expectedDimensions 做误差比较。

Pivot 标准为：

~~~text
center X ≈ 0
floor Y  ≈ 0
center Z ≈ 0
~~~

POSITION accessor 没有 min / max 时阻断。生产链路不应在浏览器里扫描全部 Vertex 来补救坏资产。

## 4. QA Policy

当前支持：

- dimension tolerance
- pivot tolerance
- triangle budget per LOD（0/1/2 必须全部配置）
- file byte budget per LOD（0/1/2 必须全部配置）
- max texture edge
- require Meshopt（检查真实 BufferView Extension，而不是只看 extensionsUsed 声明）
- require KTX2（检查真实 Texture/Image 使用）
- require self-contained GLB
- reject Draco

并直接阻断：

- Animation
- Skin
- Morph Target
- unsafe external resource
- invalid glTF / GLB
- missing LOD0
- 后级 LOD triangle 高于前级

Production Policy 示例：

~~~text
tools/fixtures/asset-ingestion/production-policy.example.json
~~~

## 5. Texture QA

Ingestion 当前可以读取：

- PNG
- JPEG
- KTX2

包括：

- data URI
- 本地外部 Image
- GLB bufferView Image

无法确认尺寸的纹理按 error 处理，而不是默认放行。

## 6. Security

Asset ID 与 Release Version 会用于发布路径，因此只允许：

~~~text
A-Z a-z 0-9 . _ -
~~~

并明确禁止 . 与 ..。SKU 不参与输出路径，可以保持业务侧原始标识。

sourceRoot / sourcePath 与模型外部资源都会经过 realpath 边界检查，符号链接也不能把读取范围带到允许目录之外。

Source 外部资源必须：

- 本地
- 相对路径
- 不越出模型目录

HTTP / HTTPS、绝对路径和 path traversal 都会阻断。

## 7. Transactional Release

整批 SKU 先 Inspect，再决定是否发布。

任意一个 SKU 有 error：

~~~text
no model bundle copy
→ asset-release.blocked.json
→ process exit code 1
~~~

全部通过：

~~~text
copy normalized bundles
→ canonical model.gltf / model.glb
→ SHA-256
→ byteSize
→ asset-release.json
→ ready for Catalog Activation
~~~

这样不会出现半批次发布。

## 8. Activation

@homescape/asset-pipeline 定义了 Release Contract。

下游必须通过 assertAssetReleaseReady / collectCatalogRenderAssets，把 Release 转换为：

~~~text
catalogAssetId
→ CatalogRenderAsset
~~~

blocked Release 不能被激活。

## 9. 本地验证

当前 7 个 Demo SKU 可用于 Smoke Check：

~~~bash
pnpm asset:check-demo
~~~

生成本地 Release：

~~~bash
pnpm asset:ingest \
  tools/fixtures/asset-ingestion/demo-release.json \
  --out .asset-release
~~~

Demo Policy 特意关闭 Meshopt / KTX2 / self-contained GLB 强制要求，因为这些 Fixture 只用于验证流程。

## 10. 下一步 Processor Adapter

后续生产接入仍需补齐：

~~~text
Company SKU Source
→ FBX / OBJ / USD Conversion
→ unit / axis / pivot normalize
→ mesh cleanup
→ LOD generation
→ Meshopt
→ KTX2
→ Ingestion QA
→ OSS / CDN Publisher
→ Catalog Activation
~~~

这些应作为可替换 Processor / Publisher Adapter 实现，而不是耦合 Babylon Runtime。

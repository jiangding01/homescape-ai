# Real Asset Pipeline

## 目标

把商品视觉模型从“浏览器里临时修一修”升级为可验证、可版本化、可发布的生产资产。

## Runtime Contract

HomeScape Runtime 只接受已经归一化的资产：

~~~text
meter
right-handed / Y-up
floor-center pivot
~~~

Catalog dimensions 是 Planner 的业务真值，模型 Bounding Box 应在离线 QA 阶段与其对齐。

## Manifest

每个 CatalogAsset 可以携带 renderAsset：

~~~text
version
normalization
lods[]
  ├── level
  ├── uri
  ├── format
  ├── byteSize?
  └── contentHash?
compression
  ├── meshopt?
  ├── ktx2?
  └── draco?
~~~

## Runtime Loading

Babylon 以 version + URI 缓存 AssetContainer，并针对每个 DesignObject 实例化模型。

加载失败不会抛弃整个场景，而是使用 Catalog dimensions 创建 deterministic proxy。

## Demo Fixtures

apps/web/public/assets/catalog 下的模型是自包含 glTF Pipeline Fixture。

它们的作用是让开发环境不依赖第三方 CDN，即可验证：

- loader 注册
- cache
- instantiation
- transform
- material
- fallback

它们不是生产级商品模型。

## Production Ingestion

推荐离线流水线：

~~~text
FBX / OBJ / USD / GLB
→ source inspection
→ unit normalize
→ axis normalize
→ pivot normalize
→ mesh cleanup
→ material / texture normalize
→ dimension QA
→ LOD0 / LOD1 / LOD2
→ Meshopt
→ KTX2
→ manifest + hash
→ CDN publish
→ Catalog activation
~~~

### 必须阻断的问题

- 非法单位或尺寸差异超过阈值
- Pivot 不在 floor-center
- 缺失材质/纹理
- 非法 URI
- 重复 SKU / Asset ID
- 模型超出面数、纹理或文件大小预算
- Catalog dimensions 与模型 Bounds 明显不一致

## 后续

PR #10 应优先做公司真实 SKU Ingestion + Geometry QA，而不是继续在 Runtime 中增加自动修复逻辑。

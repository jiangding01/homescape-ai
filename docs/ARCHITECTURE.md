# HomeScape AI Architecture v0.9

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
      ├── Spatial Model
      ├── Object Transform
      └── Render Asset Source
→ Babylon Runtime
~~~

PR #9 新增的原则是：**空间几何真值、商品业务真值与视觉模型资产继续分离。**

## 2. 三类真值

### HomeSpatialModel

房屋本体：Room / Wall / Opening / Structure / Utility。

### CatalogAsset

商品业务与空间约束真值：

- SKU
- width / height / depth
- category
- price
- variants
- placement rules
- render asset manifest

Planner 只依赖这里的真实尺寸与规则。

### Render Asset

视觉表达，不反向决定业务尺寸。

标准化资产必须满足：

~~~text
unit              = meter
coordinateSystem  = right-handed-y-up
pivot             = floor-center
~~~

运行时不允许通过“看起来差不多”自动猜厘米、毫米、Z-up 或 Pivot。

## 3. Asset Manifest

CatalogRenderAsset 当前包含：

- version
- normalization contract
- LOD list
- format: glTF / GLB
- URI
- optional byteSize / contentHash
- compression metadata

P1 已支持 LOD manifest，但 Babylon 当前选择最小 level 作为 LOD0。动态 LOD 选择在后续整屋性能阶段实现。

## 4. Catalog Validation

Catalog 初始化时验证：

- ID / SKU 唯一
- dimensions 为正数
- Render Asset normalization contract
- LOD level 唯一
- 资产 URI 仅允许站内绝对路径或 HTTPS
- byteSize（若存在）为正整数

错误 Catalog 不进入 Planner / Renderer。

## 5. RenderSnapshot Asset Resolver

Domain 的 DesignObject 仍只保存 assetId / variantId，不保存 Babylon 或 URL。

~~~text
DesignObject.assetId
      ↓
Render Asset Resolver
      ↓
RenderSnapshot.renderAsset
      ↓
Renderer Adapter
~~~

这样 Domain 不依赖 Catalog 的视觉实现，Renderer Contract 也不依赖 Catalog package。

## 6. Babylon Asset Runtime

Babylon Adapter 使用 AssetContainer：

~~~text
Render Asset URI
→ LoadAssetContainer
→ cache by version + URI
→ instantiate per DesignObject
→ parent to object transform
~~~

同一 SKU 多次出现时不重复下载/解析源文件。

如果模型不存在或加载失败：

~~~text
Catalog dimensions
→ deterministic Box Proxy
~~~

视觉失败不能破坏 Planner、Revision 或整个 3D Scene。

## 7. Async Safety

每次 sync 都生成单调 generation。

资产异步加载完成后，只有 generation 和 spatialRoot 仍属于本次 sync 才允许实例化，避免旧 Revision 的慢请求污染新场景。

## 8. 当前 Demo Asset

PR #9 提交 7 个本地、自包含、已按规范归一化的 glTF Demo Asset，用来真实验证：

- glTF Loader
- AssetContainer cache
- 多实例
- transform
- material
- fallback

这些资产是 Pipeline Fixture，不宣称为公司生产 SKU。

## 9. Production Pipeline

下一阶段：

~~~text
Company SKU Source
→ source validation
→ unit / axis / pivot normalize
→ mesh cleanup
→ dimension QA
→ LOD generation
→ Meshopt
→ KTX2
→ manifest + version + hash
→ CDN publish
→ CatalogAsset
~~~

生产资产必须在离线阶段被拒绝或修复，不应把模型质量问题推给浏览器 Runtime。

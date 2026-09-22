# HomeScape AI Architecture v0.11

## 1. 当前端到端闭环

~~~text
Real Floor Plan / PDF
→ Floor Plan Extractor
→ FloorPlanDraft
→ Candidate + Human Review
→ HomeSpatialModel
→ Active Workspace
→ Natural Language
→ DesignOperation[]
→ Catalog + Planner
→ DesignState / Revision
→ RenderSnapshot
→ Babylon glTF / GLB Runtime
~~~

PR #11 不选择某个识图模型，而是先建立 **Extractor Contract + Benchmark Gate**。

这样后续 CV、VLM、公司已有户型数据或 Hybrid Pipeline 都必须输出同一个 FloorPlanDraft，并在同一评测集上比较。

## 2. Extractor Contract

@homescape/floorplan-extractor 定义：

~~~text
FloorPlanExtractorInput
  ├── sourceId
  ├── kind: image / pdf / company_data
  ├── mediaType
  └── bytes

FloorPlanExtractor
  ├── id
  ├── supports()
  └── extract()

FloorPlanExtractionResult
  ├── FloorPlanDraft
  ├── metadata
  │    ├── extractorId
  │    ├── provider / model
  │    ├── latency
  │    ├── token usage
  │    ├── cost
  │    └── traceId
  └── warnings
~~~

业务代码只消费 FloorPlanDraft，不直接依赖 Provider。

## 3. 为什么先 Benchmark

户型识别不能只看“图片看起来像”。

真正影响后续 Planner / 3D 的误差包括：

- Room 漏检 / 多检
- Room Polygon 偏移
- 房间类型错误
- 门窗漏检
- Door / Window 位置偏移
- Opening 宽度错误
- 标尺 / 尺寸比例错误
- Source 尺寸或类型不一致

因此模型选型必须落到结构化指标，而不是只靠肉眼抽查。

## 4. Benchmark Metrics

PR #11 首批指标：

~~~text
Draft Validity
Source Kind Match
Source Dimensions Match

Room
  ├── Precision
  ├── Recall
  ├── Mean Polygon IoU
  ├── Type Accuracy
  └── Max Candidate Room Overlap Ratio

Opening
  ├── Precision
  ├── Recall
  ├── Center Error Ratio
  └── Width Error Ratio

Scale
  └── Calibration Error Ratio
~~~

Room ID 不参与匹配。

Candidate Room 与 Ground Truth Room 使用 Polygon IoU 做几何匹配，因此不同模型可以自由生成自己的实体 ID。

## 5. Polygon IoU

Benchmark 使用 deterministic raster IoU，而不是要求第三方几何依赖。

每对 Polygon 在其联合 Bounds 内使用固定网格采样：

~~~text
Ground Truth Polygon
        +
Candidate Polygon
        ↓
fixed raster grid
        ↓
intersection samples / union samples
        ↓
approximate IoU
~~~

Smoke Dataset 使用 96×96。

真实 Benchmark 可以在 Manifest 中提高到 128~256，但要平衡运行成本。

## 6. Opening Match

Opening 不能依赖 edgeIndex 相同，因为 Candidate Polygon 顶点数量可能不同。

评测先完成 Room Geometry Match，然后：

~~~text
Ground Truth Opening
→ matched Candidate Room
→ same opening kind
→ derive opening center from edge + offset + width
→ nearest center within normalized tolerance
→ one-to-one match
~~~

同时记录 Width Relative Error。

## 7. Scale

比例尺统一比较 Pixels Per Meter：

~~~text
distance(startPx, endPx)
------------------------
realDistanceMeters
~~~

Candidate 和 Ground Truth 的相对误差超过 Gate 即失败。

这比只比较 realDistanceMeters 更稳，因为不同 Extractor 可能选择不同的标尺线段。

## 8. Benchmark 与 Extractor 执行解耦

当前 CLI 消费已经生成的 Candidate JSON：

~~~text
Extractor A ─┐
Extractor B ─┼→ FloorPlanDraft JSON
Extractor C ─┘
                  ↓
        floorplan-benchmark.mjs
                  ↓
              report.json
~~~

这样 Benchmark 本身：

- 不持有 Provider API Key
- 不受网络波动影响
- 可以复跑相同输出
- 可以把模型调用成本和评测成本分开
- 可以对历史模型版本做回归

后续可以增加 Runner，但不应该让 Benchmark 工具直接绑定某家 API。

## 9. Smoke Fixture 与真实 Corpus

仓库当前的 2 张 SVG Fixture 只用于验证 Benchmark Harness：

- reference-json 应通过
- degraded-json 应失败

它们**不是模型效果结论，也不是生产 Benchmark Corpus**。

模型选型前必须准备至少 30~50 张真实户型图 / PDF，并覆盖：

- 标准 CAD 导出图
- 截图 / 压缩图
- 扫描件
- 有 / 无尺寸标注
- 开放式客餐厅
- 异形房间
- 多门窗
- 文本遮挡
- 旋转 / 轻微透视
- 不同公司 / 设计软件图例风格

Ground Truth 要由人工校验，而不是由另一个模型自动生成。

## 10. 选型原则

不要先问“VLM 还是 CV”。

真实评测后再决定：

~~~text
Company Structured Data
CV Geometry
VLM Semantic
Hybrid CV + VLM
~~~

可能的生产方案完全可以是 Hybrid：

~~~text
CV / Geometry
  → walls / rooms / openings
VLM
  → room semantics / ambiguous symbol interpretation
Deterministic Normalizer
  → topology / calibration / confidence
Human Review
  → final correction
~~~

## 11. 下一阶段

PR #12 应优先做真实 Benchmark Corpus 和第一个实际 Adapter。

在真实数据量不足之前，不根据当前 2 个 Smoke Fixture 宣布任何模型或技术路线胜出。

## 12. 保持不变的核心边界

PR #11 只增加 Extractor / Evaluation Layer，不改变此前已经稳定的真值边界：

~~~text
HomeSpatialModel = 住宅空间真值
DesignState      = 设计状态真值
CatalogAsset     = 商品尺寸 / SKU / 摆放规则真值
RenderAsset      = 视觉表达
~~~

Production Asset Ingestion 仍负责 glTF / GLB 的 Geometry QA、Pivot、LOD、Meshopt / KTX2 与 Release Gate。

AI 仍只能产生 Proposal / DesignOperation，不能直接修改 HomeSpatialModel、DesignState 或 Render Scene。

因此 Floor Plan Extractor 即使使用 VLM，也只能产出 FloorPlanDraft Candidate：

~~~text
Extractor Output
→ Benchmark / Confidence
→ Importer
→ Human Review
→ Validation
→ HomeSpatialModel
~~~

识图 Provider 不拥有住宅空间最终真值。

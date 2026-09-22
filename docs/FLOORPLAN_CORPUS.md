# Real Floor Plan Corpus

## 目标

真实户型 Extractor 的技术选型必须依赖分层、可复查的真实 Corpus，而不是几张 Demo。

PR #12 建立 Corpus Intake Contract；仓库内仍只保留 Synthetic Smoke Fixture。

## 推荐目录

真实素材建议放在仓库根目录下：

~~~text
.floorplan-corpus/
├── corpus.json
├── sources/
│   ├── case-001.png
│   ├── case-002.pdf
│   └── ...
├── ground-truth/
│   ├── case-001.json
│   ├── case-002.json
│   └── ...
├── candidates/
└── reports/
~~~

.floorplan-corpus 已加入 .gitignore。

## Corpus Manifest v0.1

~~~json
{
  "schemaVersion": "0.1.0",
  "dataset": "real-floorplans-v1",
  "cases": [
    {
      "id": "case-001",
      "sourceKind": "floorplan_image",
      "mediaType": "image/png",
      "sourcePath": "sources/case-001.png",
      "groundTruthPath": "ground-truth/case-001.json",
      "tags": {
        "quality": "clean",
        "geometry": "rectangular",
        "annotation": "full_dimension",
        "layout": "multi_room",
        "symbols": "standard",
        "textDensity": "normal"
      }
    }
  ]
}
~~~

## Corpus Check

~~~bash
pnpm floorplan:corpus -- \
  .floorplan-corpus/corpus.json \
  --min-cases 30 \
  --report .floorplan-corpus/reports/corpus-summary.json
~~~

检查内容包括：

- Case ID 唯一
- sourceKind / mediaType 一致性
- Tag enum
- 文件存在与非空
- realpath 目录边界
- Ground Truth schemaVersion
- Ground Truth source.kind / source dimensions / calibration / assumptions
- Room Type 完整性
- Room / Opening 基础结构与实体 ID 唯一性
- Corpus Case 数量门槛
- 每个 Source / Ground Truth 的 SHA-256
- Dataset Fingerprint

## 为什么必须有 Tag

只看平均分会隐藏分布问题。

例如：

~~~text
40 张 clean rectangular PNG
+ 10 张 clean rectangular PDF
~~~

并不能证明 Extractor 能处理：

- scan
- blur
- irregular room
- no dimension
- overlapping text
- mixed door/window symbols

所以 Corpus Check 会输出每个 Tag 维度的数量分布。

第一批 30~50 张不追求统计学完美，但至少应避免单一来源占满全部样本。

Corpus Check 会按 Case 计算 Source / Ground Truth SHA-256，并把 sourceKind、mediaType、tags 一并纳入 caseFingerprint，最终生成 datasetFingerprint。模型回归报告应记录这个 Fingerprint，避免“同名数据集内容或分层标签已经变化”却被误认为同一次 Benchmark。

## Ground Truth

Ground Truth 使用 FloorPlanDraft v0.1。

要求：

- 人工确认
- 所有 Room 有 type
- Room Polygon 与 Source 对齐
- Opening kind / edge / offset / width 已检查
- Calibration 已确认

不要使用被评估模型自己的输出直接当 Ground Truth。

可以用模型预标注加速，但最终必须人工确认。

## 数据安全

真实住宅户型可能包含地址、项目名、业主信息或内部业务标识。

进入 Corpus 前建议：

1. 去除住址、姓名、手机号等非评测所需信息；
2. Case ID 使用匿名 ID；
3. Ground Truth sourceLabel 不包含用户身份信息；
4. 素材默认保留在 .floorplan-corpus，不提交 Git；
5. 若未来上传评测服务，再单独设计权限、保留周期与审计策略。

## 第一批样本建议

建议 30~50 张覆盖：

- 10+ clean CAD / designer export
- 5+ compressed screenshot
- 5+ scan / blur
- 5+ open-plan
- 5+ irregular / L-shape
- 5+ partial / no dimension
- 多种 door/window symbol
- sparse / dense / overlap text

同一张图可以同时覆盖多个维度。

## 下一步

Corpus 建好后：

~~~text
Real Source
→ Company / CV / VLM Extractor
→ Candidate FloorPlanDraft
→ Benchmark
→ Review Burden
→ Failure Taxonomy
→ Provider / Hybrid Decision
~~~

模型选择在这一步之后再做。

## Structured Baseline MIME

HomeScape Normalized Metric Structured Floor Plan 使用：

~~~text
application/vnd.homescape.metric-floorplan+json
~~~

普通 company_data 可以继续使用 application/json 留给未来 Company Raw Schema Mapper。

这样 Registry 不会仅凭“都是 JSON”把公司原始数据错误路由到 metric-structured-v0.1。

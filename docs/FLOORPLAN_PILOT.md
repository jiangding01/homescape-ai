# Floor Plan Pilot Evaluation

## 目标

PR #14 把 PR #11 的结构指标、PR #12 的 Corpus Fingerprint、PR #13 的 Human Review Burden 和 Extractor Metadata 合并成一次可回归的 Experiment Report。

这里不生成“模型赢家”，而是把同一批 Case 的结构质量、人工修正成本、延迟与成本放进同一份报告，供后续技术选型使用。

## Experiment Manifest

建议真实 Pilot 放在：

~~~text
.floorplan-corpus/
├── corpus.json
├── reports/
│   ├── corpus-summary.json
│   ├── benchmark.json
│   └── pilot.json
├── candidates/
│   └── <extractor-id>/
├── metadata/
│   └── <extractor-id>/
└── review/
    └── <extractor-id>/
~~~

Experiment：

~~~json
{
  "schemaVersion": "0.1.0",
  "dataset": "real-floorplans-pilot-v1",
  "datasetFingerprint": "<64-char-sha256>",
  "corpusManifestPath": "corpus.json",
  "corpusSummaryPath": "reports/corpus-summary.json",
  "benchmarkReportPath": "reports/benchmark.json",
  "runs": [
    {
      "caseId": "case-001",
      "extractorId": "geometry-baseline-v0.1",
      "candidatePath": "candidates/geometry-baseline-v0.1/case-001.json",
      "extractionMetadataPath": "metadata/geometry-baseline-v0.1/case-001.json",
      "reviewBurdenPath": "review/geometry-baseline-v0.1/case-001.json"
    }
  ]
}
~~~

所有引用文件必须位于 Experiment Manifest 所在目录之内，realpath 后也不能越界。

## 运行

~~~bash
pnpm floorplan:pilot -- \
  .floorplan-corpus/experiment.json \
  --min-cases 10 \
  --require-corpus-coverage \
  --require-complete-review \
  --require-complete-metadata \
  --report .floorplan-corpus/reports/pilot.json
~~~

Smoke Fixture：

~~~bash
pnpm floorplan:pilot:check-demo
~~~

Smoke 数据全部是 Synthetic，只验证 Join / Gate / Aggregate，不代表任何真实 Extractor 效果。

## 数据完整性

Pilot Tool 会校验：

- dataset 一致
- datasetFingerprint 必须是 SHA-256 hex
- Corpus Manifest / Summary Case 集一致
- Benchmark Case 必须存在于 Corpus
- Result 的 caseId + extractorId 唯一
- Experiment Run 的 caseId + extractorId 唯一
- Orphan Run 直接返回非 0
- 每个 Benchmark Result 必须有对应 Experiment Run
- Candidate 必须是 FloorPlanDraft v0.1，并记录 Candidate SHA-256
- Extraction Metadata extractorId 必须匹配
- Review Burden editCounts 合计必须等于 totalEdits
- startedAt / completedAt / durationMs 一致
- floorplan_image Review 必须包含 Source Image 校验信息
- sourceImage.aspectRatioCompatible 必须为 true
- Review 的 Room / Opening 数量必须与 Corpus Summary 对齐

这些检查的目的，是避免“报告能生成，但实际混用了不同 Case / 不同数据版本 / 错误 Sidecar”。

## 聚合指标

每个 Extractor 汇总：

### Structure

- gatePassRate
- meanRoomIou
- meanRoomRecall
- meanOpeningRecall

### Human Review

- review coverage
- mean duration
- p50 duration
- p95 duration
- mean total edits
- 各类 edit count mean

### Extraction Runtime

- metadata coverage
- latency coverage
- cost coverage
- mean latency
- mean cost
- provider set
- model set

### Corpus Slice

会按以下维度分别聚合：

- quality
- geometry
- annotation
- layout
- symbols
- textDensity

每个 Slice 除结构指标与 Review Burden 外，还会保留 Benchmark Failure Summary：

~~~text
failedCaseCount
totalFailureCount
failureCounts
~~~

例如可以直接看到：

~~~text
geometry=irregular
  roomIoU
  openingRecall
  reviewDuration
  editCount
  failureCounts:
    room_recall_below_threshold: 4
    room_iou_below_threshold: 3
~~~

或者：

~~~text
annotation=no_dimension
  failureCounts:
    scale_error_above_threshold: 5
~~~

这样 PR #17 的真实 Pilot 可以直接按失败分布判断下一步研发方向，而不是只看一个全局平均数。

Failure Code 仍来自 Benchmark，不在 Pilot 阶段重新推断。Pilot 只负责保持并聚合证据，避免 Join 后丢失原始失败原因。

## Fingerprint

报告包含：

- datasetFingerprint
- corpusManifestSha256
- corpusSummarySha256
- benchmarkSha256
- pilotFingerprint

pilotFingerprint 会覆盖：

~~~text
dataset
datasetFingerprint
corpus manifest hash
corpus summary hash
benchmark report hash
run identities
candidate hashes
metadata sidecar hashes
review sidecar hashes
~~~

因此同名 Experiment 中只要 Benchmark 或 Sidecar 内容变化，就会产生新的 Fingerprint。

## 完整性 Gate

可选 Gate：

~~~text
--min-cases N
--require-corpus-coverage
--require-complete-review
--require-complete-metadata
~~~

建议真实 Pilot 全部开启。

Orphan Run 无论是否开启 Optional Gate 都会使进程返回非 0，因为这通常代表 Experiment Manifest 和 Benchmark Report 已经不同步。

## PR #14 的边界

PR #14 解决的是“如何严谨地跑真实 Pilot 并比较结果”。

它仍然没有伪造：

- 真实 10 Case
- CV Geometry Baseline 的真实效果
- VLM 的真实效果
- Company Raw Schema Mapper

没有真实输入前继续写一个复杂 CV 算法只会针对 Synthetic Fixture 过拟合。

下一步需要把第一批去敏真实户型图放进 .floorplan-corpus，然后再实现并跑第一个 Geometry Baseline。

## Pilot Report 隐私收口

Review Burden Sidecar 本地文件仍保留 sourceLabel，便于标注阶段定位 Case；Pilot Report 在 Join 后会主动移除 sourceLabel，只保留匿名 caseId 和指标。

Extraction Sidecar 中的 sourceId / traceId 也不会复制进 Pilot Report，只保留评测需要的 extractorId、provider、model、latency、token / cost 字段。

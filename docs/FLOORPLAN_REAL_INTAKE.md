# PR #17 · Real Image Intake（Ground Truth 前阶段）

## 目标与边界

此工具服务于 *已取得真实图片、尚未完成人工 Ground Truth* 的阶段。

流程为：

```text
PNG / JPEG (private, .floorplan-corpus/)
→ source-only Intake Gate (case ID / MIME / magic / dimensions / SHA / paths)
→ optional Raw Raster Candidate + Metadata (unverified)
→ Ground Truth Workbench + human confirmation
→ Official Corpus Gate + datasetFingerprint
→ Raster Batch → Benchmark → Review Burden → Pilot Failure Slice
```

Intake 报告固定 `groundTruthCaseCount: 0`、`benchmarkReady: false`，输出 `sourceSetFingerprint` 仅用于固定输入源集，**不是**正式 Corpus `datasetFingerprint`。不得把 Candidate 复制成 Ground Truth。

## 本地输入

放在已被 Git 忽略的 `.floorplan-corpus/pilot-a/`、`.floorplan-corpus/pilot-b/` 下。各自准备 `intake.json` 与 `sources/`：

```json
{
  "schemaVersion": "0.1.0",
  "dataset": "pilot-a-intake-v1",
  "cases": [
    {
      "id": "case-001",
      "sourcePath": "sources/case-001.jpg",
      "sourceSha256": "<64位小写SHA-256>",
      "originalSha256": "<可选：原始 WebP 的 SHA-256>",
      "mediaType": "image/jpeg",
      "widthPx": 992,
      "heightPx": 992,
      "group": "pilot_a",
      "style": "regular_plan",
      "geometryStage": "full_page"
    }
  ]
}
```

只接受标准 PNG/JPEG 文件头及匹配扩展名。WebP 要先离线转为 PNG，转换前后各记录 SHA；不能直接把 .webp 更名为 .png。包含 ROI 的样本须设置 `geometryStage=floorplan_roi` 并记录 `roi` 几何变换；不要把 ROI 成果冒充 full-page 零预处理结果。

## 使用

```bash
pnpm floorplan:real:intake -- .floorplan-corpus/pilot-a/intake.json \
  --report .floorplan-corpus/pilot-a/reports/intake-report.json
```

需要生成**待人工校验**的候选结果时（须安装依赖）：

```bash
pnpm floorplan:real:intake -- .floorplan-corpus/pilot-a/intake.json \
  --report .floorplan-corpus/pilot-a/reports/intake-report.json \
  --extract --pixels-per-meter 100
```

`--extract` 调用现有 Node Raster Extractor，默认 provisional 100 px/m，不代表真实尺寸。若某张图失败，记录该 Case 的失败原因；程序最终非零退出，不得当成完成批次。路径预检查在任何 Extractor 开始之前运行，避免后续 Case 错误提前污染前面结果。

```bash
pnpm floorplan:real:intake:check-demo
```

Smoke 使用极小 Synthetic PNG，不包含任何真实用户图片，不增加新 CI Job。

## 当前素材与评估口径

2026-10-12 的用户素材：Pilot A 10 张同风格 JPEG；Pilot B 10 张跨风格图（8 张 WebP 离线标准化为 PNG、2 张 JPEG 原样保留）。二者都通过**离线文件级 Intake**。这不代表 Raster Extractor 已运行或 Ground Truth 已确认。

像素分布的初步探索表明 A/B 深色像素比例差异明显，但该探索 **不是** RasterGeometryDetector 的完整结果，不是识别准确率。

当前未完成：真实 Raster 产物复核、房间几何及开口标注、尺寸标定、室内/室外区域规则、Corpus Gate、Benchmark、人工 Review、Failure Slice 决策。图像不提交 Git，CI 只能验证通用工具和 Synthetic Smoke。


## 提取诊断报告（Ground Truth 之前）

`--extract` 成功退出后，Intake 会验证 Candidate 与 Metadata 的 JSON 结构、
`sourceLabel` / `sourceId`、原图像素尺寸和 extractorId，并记录：
`candidateSha256`、`metadataSha256`、相对路径、`roomCount`、
`openingCount`、`warningCount`、`extractorLatencyMs`。
成功仅记为 `generated_unverified`，仍不代表模型识别准确。

失败仅保留结构化 `failureCode`（例如 `no_orthogonal_outline`、
`decode_failure`、`reconstruction_failure`、`invalid_candidate_artifact`、
`extractor_command_missing`），以及聚合 `failureCounts`，避免报告复制命令行堆栈、
本地绝对路径或用户文件名。这是**预标注阶段的运行失败分类**，与官方
Benchmark 的 Room IoU、Opening Recall 等指标不同。

本地独立墙线扫描对 20 张真实图片做过探索性检查：在默认
`darkThreshold=96`、`minWallRunRatio=0.08` 下，
Pilot A 有 2/10、Pilot B 有 8/10 满足“至少两个水平与垂直墙线位置”的 Detector
前置条件。该扫描由独立脚本复现墙线逻辑，不等于官方 Extractor 的实际运行结果，
也不代表任何准确率；真实图片仍需用 `--extract` 跑正式代码，再经人工 Ground Truth
与 Benchmark 验证。

真实案例失败时不得为了凑出 `benchmarkReady=true` 而直接修改阈值、
推测真实尺寸或将 Candidate 充当 Ground Truth。

# 视觉大模型户型 Extractor（ADR-0017）

## 目标与边界

ADR-0017 把户型识别主路径改为“视觉大模型预填 + 人工确认”。盲测（2 Case）用的是多轮裁剪的智能体流程，无法复现。本工具把同一思路变成**单次、参数固定、可录制可回放**的批量运行，用于在 20 张私有样本上复测，并能和后续改动做前后对比。

```text
PNG / JPEG (.floorplan-corpus/, Intake Manifest)
→ 预检查（SHA / 路径 / 尺寸，全部 Case 先过）
→ 确定性预处理（EXIF 校正 → 白底 → 长边缩放到 1568 → PNG）
→ 视觉模型单次调用（Structured Outputs 约束 JSON）
→ 原始响应落盘（responses/）
→ 本地严格校验 → FloorPlanDraft Candidate（generated_unverified）
→ 标注工作台人工确认 → Ground Truth / Benchmark
```

产物是 Candidate，不是 Ground Truth；报告固定 `groundTruthCaseCount: 0`、`benchmarkReady: false`。

## 模型输出与转换规则

模型只报告图面读数（`packages/floorplan-extractor/src/vision/vision-schema.ts`）：

- 房间：沿墙体内表面的多边形、类型、图上原文名称、置信度
- 门窗：沿墙的起止端点、类型、开启方式
- 尺寸线：图上原文、毫米值、横 / 纵、两条界线的像素位置

转换（`vision-to-draft.ts`，纯函数）：

- 坐标从模型图像换回原图像素；去掉闭合重复点；面积过小的多边形丢弃并告警
- 比例尺按横纵两轴分别取尺寸线 px/m 的中位数，偏离中位数超过 15% 的读数视为误读，不参与；`basis: extracted`
- 只有单轴尺寸线时按等比处理并告警；完全没有尺寸线时用 `--assumed-pixels-per-meter`，`basis: assumed`，导入后阻断 Finalize
- 门窗绑定到最近的平行房间边（距离上限 0.4 m，至少一半宽度落在边上），贴不上的丢弃并告警
- 墙厚 0.24 m、层高 2.8 m、门高 2.1 m、窗高 1.5 m / 窗台 0.9 m 均为未确认占位值

## 可复现性

大模型本身不保证逐字节相同输出（当前模型不接受 temperature），因此可复现分三层：

1. **配置固定**：模型 ID、effort、长边上限、Prompt 版本与哈希、Schema、预处理器（含 libvips 版本）都写入报告 `config`，每个 Case 记录请求指纹。
2. **转换可回放**：原始响应保存在 `<run-dir>/responses/`。`--replay` 不调用模型、不需要 Key，重新生成 Candidate 并核对与原运行逐字节一致（`replayMismatchCount` 必须为 0）。配置或 Prompt 改了，指纹不匹配，回放直接失败。
3. **运行间可比**：同一批图片跑两次，用 `floorplan:vision:compare` 量化差异（房间匹配率、匹配 IoU、客厅 IoU、横纵比例尺相对差、门窗匹配率）。这衡量稳定性，不是准确率。

改 Prompt 措辞时必须升级 `VISION_PROMPT_VERSION`。

## 使用

本地 `.env`（已被 Git 忽略）：

```bash
ANTHROPIC_API_KEY=...
```

Key 只在本地 CLI / 服务端读取，不写入报告、日志，也不能放进 `VITE_*`。

```bash
# 预检查 + 打印请求指纹，不调用模型
pnpm floorplan:vision -- .floorplan-corpus/pilot-a/intake.json --dry-run

# 正式运行（默认 claude-opus-5-5、effort high、并发 2）
pnpm floorplan:vision -- .floorplan-corpus/pilot-a/intake.json \
  --run-dir .floorplan-corpus/pilot-a/vision-runs/run-1

# 回放核对（无需 Key）
pnpm floorplan:vision -- .floorplan-corpus/pilot-a/intake.json \
  --run-dir .floorplan-corpus/pilot-a/vision-runs/run-1 --replay

# 再跑一次，比较两次运行
pnpm floorplan:vision -- .floorplan-corpus/pilot-a/intake.json \
  --run-dir .floorplan-corpus/pilot-a/vision-runs/run-2
pnpm floorplan:vision:compare -- .floorplan-corpus/pilot-a/intake.json \
  .floorplan-corpus/pilot-a/vision-runs/run-1 .floorplan-corpus/pilot-a/vision-runs/run-2 \
  --report .floorplan-corpus/pilot-a/vision-runs/compare-1-2.json
```

其他参数：`--model`、`--effort`、`--max-long-edge`、`--concurrency`、`--cases case-001,case-004`。

`<run-dir>` 必须在 Intake 目录内，已有 `report.json` 的目录不会被覆盖。

## 输出

```text
<run-dir>/
  report.json              运行报告（Intake 报告合同 + config / usage）
  responses/<case>.json    模型原始响应（含拒绝 / 截断）
  candidates/<case>.json   FloorPlanDraft Candidate
  metadata/<case>.json     Extraction Record + 转换统计与告警
  replay/                  --replay 的产物
```

失败 Case 留在报告里，带 `failureCode`：`model_refusal`、`output_truncated`、`invalid_json`、`schema_violation`、`not_a_floorplan`、`no_rooms`、`invalid_draft`、`provider_error`、`replay_missing`、`replay_mismatch`。程序以非零退出，不得当成完成批次；失败 Case 不伪造 IoU。

报告合同与 `floorplan:real:intake` 相同，可直接用于覆盖率：

```bash
pnpm floorplan:real:coverage -- <corpus-summary.json> <run-dir>/report.json --extractor-id vision-llm-v0.1
```

对已批准 GT 的 Case（case-001、case-004），把 `candidates/<case>.json` 写进 Benchmark Manifest 的 `candidatePath`，用现有 `floorplan:benchmark` 正式评测（评测工具冻结，不为本 Extractor 扩展）。

## Provider

`VisionModelClient` 是 Vendor 无关的接口；当前唯一实现是 `AnthropicVisionModelClient`（`@homescape/floorplan-extractor/node`）。不启用跨模型 fallback：评测需要知道是哪个模型给出的结果，拒绝按失败 Case 记录。换 Provider 只需实现同一接口，Prompt、Schema、转换与报告不变。

## 数据合规

当前样本为网络公开户型图，可发送给外部模型。公司或客户户型接入前须另行取得授权与合规审批（见 `docs/HANDOFF.md`）。

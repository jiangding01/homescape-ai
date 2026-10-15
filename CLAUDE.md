# HomeScape AI · 工程协作说明

对话式家装空间设计引擎：真实户型 → HomeSpatialModel → 自然语言 → DesignOperation → Planner / Constraint → Revision → DesignState → 实时 3D。

背景、未决业务问题与决策记录见 `docs/HANDOFF.md`；架构见 `docs/ARCHITECTURE.md` 与 `docs/adr/`。

## 不可妥协的原则

1. AI 只提出解释与候选操作，不直接写 DesignState，不绕过 Planner / Constraint / Revision，不把 Render Scene 当业务真值。
2. 识别结果（CV / VLM / Raster）只是 Candidate；人工 Review + Validation 后才是空间真值。
3. 来源不可靠的尺寸、比例尺、墙厚、层高、门窗高度必须保留“假设”状态，不能为通过校验而填成确认值。
4. Provider 与渲染引擎可替换、可比较、可追溯，业务代码不绑定单一 Vendor。
5. 评测不造假：GT 与 Candidate 隔离；失败 Case 计入覆盖率，不静默移出分母，也不伪造成 IoU=0；Synthetic 指标不代表真实质量。
6. 用户可见的每次修改都可 Undo / Redo / Replay / Audit。

## 数据规则

- 真实户型图、人工 GT、Review Burden 只放在被 Git 忽略的 `.floorplan-corpus/`，绝不提交（仓库公开）。
- 当前真实样本均为网络公开户型图，可用于外部模型实验；公司或客户数据接入前必须另行获得授权。
- 不在仓库中写入内网地址、个人机器路径、密钥。`TYPESAFE_API_KEY`、`ANTHROPIC_API_KEY` 只在服务端 / 本地 CLI 使用，不得出现在 `VITE_*`、浏览器或日志中。

## 常用命令

```bash
pnpm install
pnpm dev                      # web :5173 + api :3001
pnpm typecheck
pnpm test                     # vitest，测试文件为 src/**/*.test.ts 与 tools/**/*.test.mjs
pnpm build
pnpm floorplan:raster:check-demo   # 其余 *:check-demo 见 package.json
pnpm floorplan:vision -- <intake.json>   # 视觉大模型 Extractor，需 ANTHROPIC_API_KEY；--dry-run / --replay 无需 Key
```

## 协作约定

- Commit 信息使用简体中文；避免零碎 Commit。
- 每个 PR 完成后先 Code Review，合并由仓库负责人决定。
- 不在 UI 文案、错误信息中引用 PR 编号。
- 新代码优先补单元测试（vitest），几何与 Revision 逻辑尤其需要。

## 并行会话分工

本仓库同时由两条工作线推进，按模块划分，互不越界：

| 工作线 | 负责范围 | 主要目录 |
|---|---|---|
| 工程主线（单独的云端会话） | 几何内核 → 状态服务端化 → 对话式设计 Agent → 布局规划器 | `packages/spatial-model`、`domain`、`planner`、`catalog`、`renderer-*`、`ai-runtime`、`design-intelligence`、`apps/*` |
| 数据与评测（项目线程） | 真实户型标注、视觉大模型 Extractor 批量运行与调优、评测报告 | `packages/floorplan-extractor`、`tools/floorplan-*`、私有 `.floorplan-corpus/` |

- 两条线的交接契约是 FloorPlanDraft。任何一方修改该协议，须在 PR 描述中写明，另一方合并前先同步 `main`。
- 开工前先 `git fetch origin main` 并查看最近合并的 PR，避免重复实现。
- 验收或评测请基于 `main` 的最新提交，并在报告中注明所用 commit。
- 确需改动对方目录时，改动保持最小，并在 PR 描述中说明原因。

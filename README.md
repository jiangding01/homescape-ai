# HomeScape AI

> Conversational Home Design Engine / 对话式家装空间设计引擎

HomeScape AI 从真实住宅空间出发，把自然语言转换为受限、可验证、可撤销的设计操作，再由确定性 Catalog / Planner / Constraint 系统生成可执行设计状态和实时 3D。

## 当前核心链路

~~~text
Real Floor Plan
→ Candidate + Human Review
→ Final HomeSpatialModel
→ 服务端项目 / 时间线
→ Natural Language
→ AI Capability Runtime
→ DesignOperation[]
→ Catalog + Planner
→ Revision
→ DesignState
→ Render Asset Resolver
→ glTF / GLB Realtime 3D
~~~

AI 不直接修改 Scene，也不直接写 DesignState。

## Monorepo

~~~text
apps/
├── web                     # React 交互层 / 3D Workbench
└── api                     # Fastify / server-side AI orchestration

packages/
├── spatial-model           # 住宅空间真值
├── contracts               # 前后端共用 API 契约（zod）
├── domain                  # DesignState / Operation / Revision
├── catalog                 # SKU / dimensions / placement rules
├── asset-pipeline          # Production Asset Ingestion / Geometry QA
├── floorplan-extractor     # Floor Plan Extractor / Benchmark Contract
├── planner                 # Rule + Anchor + Constraint + Scoring
├── ai-runtime              # Capability abstraction + JEV Provider
├── design-intelligence     # 家装自然语言 → DesignOperation
├── renderer-contract       # Renderer 边界
└── renderer-babylon        # Babylon.js P1 Adapter
~~~

## 本地启动

需要 Node.js 22.13+（API 使用内置 `node:sqlite`）与 pnpm 11.18.0（与 `package.json` 的 `packageManager` 一致；版本不一致时 pnpm 会自动下载切换，经内部镜像源可能因缺少签名而失败）。

~~~bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
~~~

Web: http://localhost:5173  
API: http://localhost:3001

API 默认只监听 127.0.0.1，可用 `HOST` 覆盖；写接口尚无鉴权，不得公开部署。设计状态持久化到 SQLite，默认 `apps/api/.data/homescape.sqlite`，可用 `HOMESCAPE_DB_PATH` 覆盖（该目录已被忽略，不入库）。

### 自然语言设计

JEV 通过 API 服务端调用。把 TypeSafe Key 配置到本地 .env：

~~~bash
TYPESAFE_API_KEY=your_key_here
TYPESAFE_MODEL=jev-latest
~~~

不要使用 VITE_TYPESAFE_API_KEY，也不要把 Key 放到浏览器存储或前端代码中。

如果没有配置 Key，空间、Catalog、Planner、Revision 与 3D 仍可运行，但 /api/design/interpret 会返回 AI_NOT_CONFIGURED。

### 服务端接口

设计状态由服务端持有，前端通过 `/api/v1` 读写，契约见 `packages/contracts`，设计见 [ADR-0019](docs/adr/0019-server-side-design-state.md)。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST | `/projects` | 列出 / 创建项目 |
| GET | `/projects/:id` | 项目当前状态 |
| POST | `/projects/:id/spatial-models` | 追加不可变的空间模型版本 |
| POST | `/projects/:id/revisions` | 提交操作，服务端运行 Planner；基线冲突 409，约束违规 422 |
| POST | `/projects/:id/undo`、`/redo` | 补偿式撤销 / 重做 |

自然语言解释仍走 `/api/design/interpret`。

## 核心原则

1. HomeSpatialModel 是住宅空间真值，DesignState 是设计真值，Render Scene 只是 View。
2. AI 只提出语义决策和 DesignOperation；Planner / Constraint 决定是否可执行。
3. 业务依赖 AI Capability，不依赖 Vendor。
4. JEV 当前实现 typed_decision，但可以被其他 Provider 替换或进入 Shadow Evaluation。
5. Lock、碰撞、商品尺寸、门洞净空和 Revision 不能被 AI 绕过。
6. 所有可接受的修改都必须可 Undo / Redo / Replay / Audit。

## 当前阶段

- 已完成：空间真值与几何内核（[ADR-0018](docs/adr/0018-geometry-kernel.md)）、参数化 3D、Design State / Revision、Catalog / Planner、自然语言 Decision Runtime、glTF / GLB Runtime、资产入库，以及设计状态服务端化（[ADR-0019](docs/adr/0019-server-side-design-state.md)）。
- 户型识别：主路径为视觉大模型预填 + 人工确认（[ADR-0017](docs/adr/0017-floorplan-extraction-strategy.md)）；经典 Raster Extractor 仅作 Baseline。真实 Corpus 样本量仍小，Synthetic 指标不代表真实质量。
- 工程主线下一步：对话式设计 Agent，然后布局规划器 v2。

详见 [路线图](docs/ROADMAP.md) 与 [工程交接](docs/HANDOFF.md)。

目标闭环：

> 真实户型图 → HomeSpatialModel → 客厅方案 → 自然语言连续修改 → 实时 3D → Undo / Replay / Save。

## 户型 Extractor / Corpus

~~~bash
pnpm floorplan:benchmark:check-demo
pnpm floorplan:extract-demo
pnpm floorplan:corpus:check-demo
pnpm floorplan:pilot:check-demo
pnpm floorplan:geometry:check-demo
pnpm floorplan:raster:check-demo
~~~

真实结构化数据：

~~~bash
pnpm floorplan:extract -- input.json output.json \
  --metadata .floorplan-corpus/candidates/output.meta.json
~~~

Geometry Observation 重建：

~~~bash
pnpm floorplan:geometry -- observation.json candidate.json \
  --metadata candidate.meta.json
~~~

PNG / JPEG Raster Baseline：

~~~bash
pnpm floorplan:raster -- input.png candidate.json \
  --metadata candidate.meta.json \
  --source-id case-001
~~~

真实 10 Case Raster Pilot 准备：

~~~bash
pnpm floorplan:raster:batch -- \
  .floorplan-corpus/corpus.json \
  --min-cases 10
~~~

该命令会批量生成 Candidate / Metadata，同时生成 `benchmark-raster.json` 与 `experiment-raster.json`。

视觉大模型 Extractor（ADR-0017 主路径，需在本地 .env 配置服务端 `ANTHROPIC_API_KEY`）：

~~~bash
pnpm floorplan:vision -- .floorplan-corpus/pilot-a/intake.json --dry-run
pnpm floorplan:vision -- .floorplan-corpus/pilot-a/intake.json --run-dir .floorplan-corpus/pilot-a/vision-runs/run-1
~~~

说明见 [Vision Extractor](docs/FLOORPLAN_VISION_EXTRACTOR.md)。

真实 Corpus：

~~~bash
pnpm floorplan:corpus -- .floorplan-corpus/corpus.json --min-cases 30
~~~

说明见 [Floor Plan Extractor Benchmark](docs/FLOORPLAN_EXTRACTOR_BENCHMARK.md)、[Real Floor Plan Corpus](docs/FLOORPLAN_CORPUS.md)、[Ground Truth Annotation](docs/FLOORPLAN_ANNOTATION.md)、[Pilot Evaluation](docs/FLOORPLAN_PILOT.md)、[Geometry Baseline](docs/FLOORPLAN_GEOMETRY_BASELINE.md) 与 [Raster Geometry Baseline](docs/FLOORPLAN_RASTER_BASELINE.md)。

## 资产入库

~~~bash
pnpm asset:check-demo

pnpm asset:ingest tools/fixtures/asset-ingestion/demo-release.json --out .asset-release
~~~

Production Policy 示例见 tools/fixtures/asset-ingestion/production-policy.example.json。

## 文档

- [工程交接与决策记录](docs/HANDOFF.md)
- [架构设计](docs/ARCHITECTURE.md)
- [资产流水线](docs/ASSET_PIPELINE.md)
- [户型 Extractor Benchmark](docs/FLOORPLAN_EXTRACTOR_BENCHMARK.md)
- [视觉大模型 Extractor](docs/FLOORPLAN_VISION_EXTRACTOR.md)
- [真实户型 Intake](docs/FLOORPLAN_REAL_INTAKE.md)
- [真实 GT Staging](docs/FLOORPLAN_REAL_GT_STAGING.md)
- [真实户型 Corpus](docs/FLOORPLAN_CORPUS.md)
- [Ground Truth 标注](docs/FLOORPLAN_ANNOTATION.md)
- [Pilot Evaluation](docs/FLOORPLAN_PILOT.md)
- [Geometry Baseline](docs/FLOORPLAN_GEOMETRY_BASELINE.md)
- [Raster Geometry Baseline](docs/FLOORPLAN_RASTER_BASELINE.md)
- [路线图](docs/ROADMAP.md)
- [ADR](docs/adr/)

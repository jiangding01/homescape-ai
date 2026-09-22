# HomeScape AI

> Conversational Home Design Engine / 对话式家装空间设计引擎

HomeScape AI 从真实住宅空间出发，把自然语言转换为受限、可验证、可撤销的设计操作，再由确定性 Catalog / Planner / Constraint 系统生成可执行设计状态和实时 3D。

## 当前核心链路

~~~text
Real Floor Plan
→ Candidate + Human Review
→ Final HomeSpatialModel
→ Active Workspace
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

需要 Node.js 22+ 与 pnpm 10+。

~~~bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
~~~

Web: http://localhost:5173  
API: http://localhost:3001

### 自然语言设计

JEV 通过 API 服务端调用。把 TypeSafe Key 配置到本地 .env：

~~~bash
TYPESAFE_API_KEY=your_key_here
TYPESAFE_MODEL=jev-latest
~~~

不要使用 VITE_TYPESAFE_API_KEY，也不要把 Key 放到浏览器存储或前端代码中。

如果没有配置 Key，空间、Catalog、Planner、Revision 与 3D 仍可运行，但 /api/design/interpret 会返回 AI_NOT_CONFIGURED。

## 核心原则

1. HomeSpatialModel 是住宅空间真值，DesignState 是设计真值，Render Scene 只是 View。
2. AI 只提出语义决策和 DesignOperation；Planner / Constraint 决定是否可执行。
3. 业务依赖 AI Capability，不依赖 Vendor。
4. JEV 当前实现 typed_decision，但可以被其他 Provider 替换或进入 Shadow Evaluation。
5. Lock、碰撞、商品尺寸、门洞净空和 Revision 不能被 AI 绕过。
6. 所有可接受的修改都必须可 Undo / Redo / Replay / Audit。

## 当前阶段

已完成 Foundation、HomeSpatialModel、参数化 3D、Design State / Revision、Catalog / Planner、自然语言 Decision Runtime、Real Floor Plan + Active Workspace、glTF / GLB Runtime、Production Asset Ingestion，以及 Floor Plan Extractor Benchmark 基础设施。

户型识别现在有独立 FloorPlanExtractor Contract 与离线 Benchmark Gate，可以用统一指标比较公司结构化数据、CV、VLM 或 Hybrid 输出，而不把业务绑定到某个 Provider。

仓库自带的 SVG 仍只用于验证 Benchmark Harness。PR #12 新增 metric-structured-v0.1 结构化数据 Baseline；PR #13 加入 Ground Truth Annotation；PR #14 固定 Pilot Evaluation；PR #15 增加 Geometry Observation Contract 与确定性正交几何重建 Baseline。

PR #15 当前处理的是“Detector Observation → FloorPlanDraft”，并没有声称已经实现 Raw PNG / JPEG CV。

真正模型选型仍需真实 Corpus。建议先用 10 张去敏真实户型图做标注 Pilot，稳定后扩充到 30~50 张；素材继续保存在被 Git 忽略的 .floorplan-corpus 中。

目标闭环：

> 真实户型图 → HomeSpatialModel → 客厅方案 → 自然语言连续修改 → 实时 3D → Undo / Replay / Save。

## 户型 Extractor / Corpus

~~~bash
pnpm floorplan:benchmark
pnpm floorplan:extract-demo
pnpm floorplan:corpus:check-demo
pnpm floorplan:pilot:check-demo
pnpm floorplan:geometry:check-demo
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

真实 Corpus：

~~~bash
pnpm floorplan:corpus -- .floorplan-corpus/corpus.json --min-cases 30
~~~

说明见 [Floor Plan Extractor Benchmark](docs/FLOORPLAN_EXTRACTOR_BENCHMARK.md)、[Real Floor Plan Corpus](docs/FLOORPLAN_CORPUS.md)、[Ground Truth Annotation](docs/FLOORPLAN_ANNOTATION.md)、[Pilot Evaluation](docs/FLOORPLAN_PILOT.md) 与 [Geometry Baseline](docs/FLOORPLAN_GEOMETRY_BASELINE.md)。

## 资产入库

~~~bash
pnpm asset:check-demo

pnpm asset:ingest tools/fixtures/asset-ingestion/demo-release.json --out .asset-release
~~~

Production Policy 示例见 tools/fixtures/asset-ingestion/production-policy.example.json。

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [资产流水线](docs/ASSET_PIPELINE.md)
- [户型 Extractor Benchmark](docs/FLOORPLAN_EXTRACTOR_BENCHMARK.md)
- [真实户型 Corpus](docs/FLOORPLAN_CORPUS.md)
- [Ground Truth 标注](docs/FLOORPLAN_ANNOTATION.md)
- [Pilot Evaluation](docs/FLOORPLAN_PILOT.md)
- [Geometry Baseline](docs/FLOORPLAN_GEOMETRY_BASELINE.md)
- [路线图](docs/ROADMAP.md)
- [ADR](docs/adr/)
